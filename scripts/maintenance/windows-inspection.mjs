// Enumeration and file hashing run in the process that owns the guarded handles.
export const windowsInspectionScript = String.raw`
  $query = ConvertFrom-Json -InputObject $env:CODEX_MAINTENANCE_QUERY
  Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class ContractorInspection {
    private const uint ReadDataAndAttributes = 0x81;
    private const uint ShareRead = 1;
    private const uint OpenExisting = 3;
    private const uint BackupSemantics = 0x02000000;
    private const uint OpenReparsePoint = 0x00200000;
    private const uint ReparsePoint = 0x400;
    private const uint Directory = 0x10;
    private const uint DiskFileType = 1;
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo {
        public uint Attributes;
        private uint CreatedLow, CreatedHigh, AccessedLow, AccessedHigh;
        public uint WrittenLow, WrittenHigh;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        public long Length {
            get { return checked((long)(((ulong)SizeHigh << 32) | SizeLow)); }
        }
    }

    public sealed class Snapshot {
        public string Path { get; internal set; }
        public long Files { get; internal set; }
        public long Bytes { get; internal set; }
        public string Fingerprint { get; internal set; }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security,
                                                     uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo information);
    [DllImport("kernel32.dll")]
    private static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder name, uint size, uint flags);

    private static FileInfo ReadInfo(SafeFileHandle handle) {
        FileInfo info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return info;
    }

    public static SafeFileHandle OpenPlain(string path, bool requireDirectory) {
        // Read sharing excludes attempts to write or rename this object while it is held.
        var handle = CreateFileW(@"\\?\" + path, ReadDataAndAttributes, ShareRead, IntPtr.Zero,
                                 OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        try {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info = ReadInfo(handle);
            if ((info.Attributes & ReparsePoint) != 0 || GetFileType(handle) != DiskFileType ||
                (requireDirectory && (info.Attributes & Directory) == 0))
                throw new InvalidOperationException("The path is a reparse point or an unexpected file type");
            return handle;
        } catch {
            handle.Dispose();
            throw;
        }
    }

    private static string CanonicalPath(SafeFileHandle handle) {
        var buffer = new StringBuilder(32768);
        var length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (length >= buffer.Capacity) throw new IOException("Path too long");
        var value = buffer.ToString();
        if (!value.StartsWith(@"\\?\", StringComparison.Ordinal)) throw new IOException("Unexpected final path");
        return value.Substring(4);
    }

    private static void RequireUnchanged(FileInfo before, SafeFileHandle handle) {
        var after = ReadInfo(handle);
        if (before.Volume != after.Volume || before.IndexHigh != after.IndexHigh || before.IndexLow != after.IndexLow ||
            before.Attributes != after.Attributes || before.SizeHigh != after.SizeHigh || before.SizeLow != after.SizeLow ||
            before.Links != after.Links || before.WrittenHigh != after.WrittenHigh || before.WrittenLow != after.WrittenLow)
            throw new IOException("The inspected object changed");
    }

    private static void Visit(string path, string relative, SafeFileHandle handle, Snapshot snapshot,
                              SHA256 fileHash, BinaryWriter fingerprint) {
        var before = ReadInfo(handle);
        if ((before.Attributes & Directory) != 0) {
            fingerprint.Write((byte)0);
            fingerprint.Write(relative);
            // The entire directory chain stays open until this recursion returns.
            var children = System.IO.Directory.GetFileSystemEntries(@"\\?\" + path);
            Array.Sort(children, StringComparer.Ordinal);
            foreach (var child in children) {
                var name = child.Substring(child.LastIndexOf('\\') + 1);
                if (name.Length == 0 || name.EndsWith(".", StringComparison.Ordinal) ||
                    name.EndsWith(" ", StringComparison.Ordinal) || name.IndexOf(':') >= 0)
                    throw new IOException("An entry has an ambiguous name");
                var childPath = path + @"\" + name;
                var childRelative = relative.Length == 0 ? name : relative + "/" + name;
                using (var childHandle = OpenPlain(childPath, false)) {
                    Visit(childPath, childRelative, childHandle, snapshot, fileHash, fingerprint);
                }
            }
            RequireUnchanged(before, handle);
        } else {
            if (before.Links != 1) throw new IOException("A file has multiple links");
            using (var stream = new FileStream(handle, FileAccess.Read, 65536, false)) {
                var digest = fileHash.ComputeHash(stream);
                if (stream.Position != before.Length) throw new IOException("The file length changed");
                RequireUnchanged(before, handle);
                snapshot.Files = checked(snapshot.Files + 1);
                snapshot.Bytes = checked(snapshot.Bytes + before.Length);
                fingerprint.Write((byte)1);
                fingerprint.Write(relative);
                fingerprint.Write(before.Length);
                fingerprint.Write(digest);
            }
        }
    }

    public static Snapshot Inspect(string target) {
        var handles = new Stack<SafeFileHandle>();
        try {
            var root = System.IO.Path.GetPathRoot(target);
            var names = target.Substring(root.Length).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
            var current = root;
            handles.Push(OpenPlain(current, true));
            for (var index = 0; index < names.Length; index++) {
                current = System.IO.Path.Combine(current, names[index]);
                handles.Push(OpenPlain(current, index < names.Length - 1));
            }
            var actual = CanonicalPath(handles.Peek());
            if (!string.Equals(target, actual, StringComparison.OrdinalIgnoreCase))
                throw new IOException("The inspected path changed");
            var snapshot = new Snapshot { Path = actual };
            using (var fileHash = SHA256.Create())
            using (var treeHash = SHA256.Create())
            using (var sink = new CryptoStream(Stream.Null, treeHash, CryptoStreamMode.Write))
            using (var writer = new BinaryWriter(sink, new UTF8Encoding(false, true), true)) {
                writer.Write("windows-inspection-v1");
                Visit(actual, "", handles.Peek(), snapshot, fileHash, writer);
                writer.Flush();
                sink.FlushFinalBlock();
                snapshot.Fingerprint = BitConverter.ToString(treeHash.Hash).Replace("-", "").ToLowerInvariant();
            }
            return snapshot;
        } finally {
            while (handles.Count > 0) handles.Pop().Dispose();
        }
    }
}
'@
  $result = [ContractorInspection]::Inspect($query.target)
  [Console]::WriteLine((ConvertTo-Json -InputObject @{
    path = $result.Path
    files = $result.Files
    bytes = $result.Bytes
    fingerprint = $result.Fingerprint
  } -Compress))
`;
