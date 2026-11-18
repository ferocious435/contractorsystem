param()

$ErrorActionPreference = 'Stop'
$encoding = [Text.UTF8Encoding]::new($false, $true)
[Console]::InputEncoding = $encoding
[Console]::OutputEncoding = $encoding
$shared = ConvertFrom-Json -InputObject ([Console]::ReadLine())
$worker = @'
namespace ContractorStorage {
    using System;
    using System.Collections.Generic;
    using System.ComponentModel;
    using System.IO;
    using System.IO.Compression;
    using System.Linq;
    using System.Runtime.InteropServices;
    using System.Security.Cryptography;
    using System.Text;
    using System.Text.RegularExpressions;
    using System.Web.Script.Serialization;
    using Microsoft.Win32.SafeHandles;
    using Guard = global::ContractorInspection;

    public static class ArchiveWorker {
        private const uint DirectoryFlag = 0x10;
        private const uint ReparseFlag = 0x400;
        private const long MaxMetadataBytes = 64 * 1024 * 1024;
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer {
            MaxJsonLength = (int)MaxMetadataBytes, RecursionLimit = 64
        };
        private static readonly StringComparer Names = StringComparer.OrdinalIgnoreCase;
        private static readonly byte[] Buffer = new byte[65536];

        public sealed class Entry {
            public string path { get; set; }
            public long size { get; set; }
            public string sha256 { get; set; }
            public bool directory { get; set; }
        }

        public sealed class Reference {
            public string prefix { get; set; }
            public string file { get; set; }
            public string sha256 { get; set; }
        }

        public sealed class Manifest {
            public string format { get; set; }
            public string sha256 { get; set; }
            public string verifiedAt { get; set; }
            public List<Entry> entries { get; set; }
            public List<Reference> references { get; set; }
            public List<string> omittedJunctions { get; set; }
            public Derivation generated { get; set; }
        }

        public sealed class Derivation {
            public string proof { get; set; }
            public string target { get; set; }
            public string identity { get; set; }
            public List<Entry> entries { get; set; }
        }

        public sealed class Generated {
            public int version { get; set; }
            public string target { get; set; }
            public string identity { get; set; }
            public List<Entry> entries { get; set; }
        }

        public sealed class Group {
            public string source { get; set; }
            public string prefix { get; set; }
            public string[] files { get; set; }
            public string[] directories { get; set; }
            public string skipDirectory { get; set; }
            public bool omitNodeModulesJunction { get; set; }
            public Dictionary<string, string> expectedFiles { get; set; }
        }

        public sealed class Request {
            public string operation { get; set; }
            public string file { get; set; }
            public string destination { get; set; }
            public string target { get; set; }
            public string targetIdentity { get; set; }
            public string targetFingerprint { get; set; }
            public string archiveSha256 { get; set; }
            public bool resume { get; set; }
            public Group[] groups { get; set; }
            public string[] records { get; set; }
            public Reference[] references { get; set; }
            public string[] omittedJunctions { get; set; }
            public StateWrite[] writes { get; set; }
            public Derivation generated { get; set; }
        }

        public sealed class StateWrite {
            public string path { get; set; }
            public string data { get; set; }
            public bool overwrite { get; set; }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security,
            uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern bool CreateDirectoryW(string path, IntPtr security);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern bool MoveFileExW(string source, string destination, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
        private static extern bool DeleteFileW(string path);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass, ref byte info, uint size);
        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentProcess();
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool DuplicateHandle(IntPtr source, SafeFileHandle handle, IntPtr target,
            out SafeFileHandle copy, uint access, bool inherit, uint options);

        private sealed class HeldPath : IDisposable {
            private readonly Stack<SafeFileHandle> chain;
            public SafeFileHandle Handle { get { return chain.Peek(); } }
            public HeldPath(string path, bool directory, bool delete = false, string pinnedRoot = null, bool shareWrite = false) {
                chain = Guard.HoldPath(path, directory, delete, pinnedRoot, shareWrite);
            }
            public void Dispose() { Guard.ClosePath(chain); }
        }

        private static string Hex(byte[] bytes) {
            return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        }
        private static bool IsHash(string value) {
            return value != null && Regex.IsMatch(value, @"\A[a-f0-9]{64}\z");
        }
        private static void Require(bool valid, string message) {
            if (!valid) throw new IOException(message);
        }
        private static string SafeName(string value) {
            Require(!string.IsNullOrEmpty(value) && value.Length < 32700 &&
                !value.Split('/').Any(part => string.IsNullOrEmpty(part) || part == "." || part == ".." ||
                    part.Length > 255 || part.EndsWith(".") || part.EndsWith(" ") ||
                    Regex.IsMatch(part, @"[\\<>:""|?*\x00-\x1f]") ||
                    Regex.IsMatch(part, @"\A(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|\z)",
                        RegexOptions.IgnoreCase)),
                "Unsafe ZIP entry or relative path");
            return value;
        }
        private static string Join(string root, string relative) {
            return root + @"\" + SafeName(relative).Replace('/', '\\');
        }
        private static string AddPrefix(string prefix, string name) {
            return string.IsNullOrEmpty(prefix) ? name : prefix + "/" + name;
        }
        private static string ParentName(string name) {
            int i = name.LastIndexOf('/');
            return i < 0 ? "" : name.Substring(0, i);
        }
        private static string[] Children(string directory) {
            var entries = System.IO.Directory.GetFileSystemEntries(Guard.ExtendedPath(directory));
            Array.Sort(entries, StringComparer.Ordinal);
            return entries.Select(entry => entry.Substring(entry.LastIndexOf('\\') + 1)).ToArray();
        }

        private static FileStream Reader(SafeFileHandle handle) {
            var current = GetCurrentProcess();
            SafeFileHandle copy;
            if (!DuplicateHandle(current, handle, current, out copy, 0, false, 2))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            return new FileStream(copy, FileAccess.Read, 65536, false);
        }

        private static FileStream Create(string file) {
            var handle = CreateFileW(Guard.ExtendedPath(file), 0xc0000000, 0, IntPtr.Zero, 1, 0x80, IntPtr.Zero);
            if (handle.IsInvalid) {
                int error = Marshal.GetLastWin32Error();
                handle.Dispose();
                throw new Win32Exception(error);
            }
            return new FileStream(handle, FileAccess.ReadWrite, 65536, false);
        }

        private static void CreateDirectory(string path) {
            if (!CreateDirectoryW(Guard.ExtendedPath(path), IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        private static void MoveNew(string from, string to) {
            if (!MoveFileExW(Guard.ExtendedPath(from), Guard.ExtendedPath(to), 8))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        private static string CopyHash(Stream input, Stream output, long size) {
            Require(size >= 0, "Invalid declared length");
            using (var digest = SHA256.Create())
            using (var hashing = new CryptoStream(output, digest, CryptoStreamMode.Write, true)) {
                long remaining = size;
                int count;
                while ((count = input.Read(Buffer, 0, Buffer.Length)) != 0) {
                    Require(count <= remaining, "Entry is larger than declared");
                    hashing.Write(Buffer, 0, count);
                    remaining -= count;
                }
                Require(remaining == 0, "Entry is shorter than declared");
                hashing.FlushFinalBlock();
                return Hex(digest.Hash);
            }
        }

        private static byte[] ReadSmall(SafeFileHandle handle) {
            var info = Guard.ReadInfo(handle);
            Require((info.Attributes & DirectoryFlag) == 0 && info.Links == 1 && info.Length <= MaxMetadataBytes,
                "Expected a plain, bounded metadata file");
            using (var reader = Reader(handle))
            using (var buffer = new MemoryStream()) {
                CopyHash(reader, buffer, info.Length);
                Guard.RequireUnchanged(info, handle);
                return buffer.ToArray();
            }
        }

        private static Entry PlainFile(string relative, SafeFileHandle handle, Stream output) {
            var info = Guard.ReadInfo(handle);
            Require((info.Attributes & DirectoryFlag) == 0 && info.Links == 1, "Expected a file with one link");
            using (var reader = Reader(handle)) {
                reader.Position = 0;
                var result = new Entry { path = relative, size = info.Length, sha256 = CopyHash(reader, output, info.Length) };
                Guard.RequireUnchanged(info, handle);
                return result;
            }
        }

        private static Entry Folder(string path) {
            return new Entry { path = path, directory = true, size = 0, sha256 = null };
        }

        private static void ValidateEntries(IEnumerable<Entry> rows) {
            var seen = new Dictionary<string, Entry>(Names);
            var parents = new Dictionary<string, string>(Names);
            foreach (var entry in rows) {
                SafeName(entry.path);
                Require(!seen.ContainsKey(entry.path), "Duplicate ZIP entry");
                Require(entry.size >= 0 && (entry.directory ? entry.size == 0 && entry.sha256 == null : IsHash(entry.sha256)),
                    "Invalid ZIP manifest entry");
                seen.Add(entry.path, entry);
            }
            foreach (var entry in seen.Values) {
                for (string parent = ParentName(entry.path); parent.Length > 0; parent = ParentName(parent)) {
                    Entry ancestor;
                    string spelling;
                    if (parents.TryGetValue(parent, out spelling)) Require(spelling == parent, "Ambiguous ZIP directory spelling");
                    else parents.Add(parent, parent);
                    if (seen.TryGetValue(parent, out ancestor)) {
                        Require(ancestor.directory && ancestor.path == parent, "A ZIP file conflicts with its child or spelling");
                    }
                }
            }
        }

        private static void ListGroup(string root, string relative, SafeFileHandle handle, Group group,
            List<string> files, List<string> dirs, List<string> junctions) {
            var before = Guard.ReadInfo(handle);
            foreach (var name in Children(root)) {
                if (group.prefix == "artifact") CheckCleanupName(name);
                var child = AddPrefix(relative, SafeName(name));
                var file = Join(root, name);
                if (relative.Length == 0 && name == group.skipDirectory) continue;
                if (relative.Length == 0 && name == "node_modules" && group.omitNodeModulesJunction) {
                    var flags = (uint)File.GetAttributes(Guard.ExtendedPath(file));
                    if ((flags & ReparseFlag) != 0) {
                        Require((flags & DirectoryFlag) != 0, "Unexpected node_modules reparse file");
                        junctions.Add(AddPrefix(group.prefix, child));
                        continue;
                    }
                }
                using (var item = Guard.OpenPlain(file, false)) {
                    var info = Guard.ReadInfo(item);
                    if ((info.Attributes & DirectoryFlag) != 0) {
                        dirs.Add(child);
                        ListGroup(file, child, item, group, files, dirs, junctions);
                    } else {
                        Require(info.Links == 1, "A source file has multiple links");
                        files.Add(child);
                    }
                }
            }
            Guard.RequireUnchanged(before, handle);
        }

        private static Group Catalog(Group group, List<string> junctions) {
            var dirs = new List<string>();
            var files = new List<string>();
            using (var held = new HeldPath(group.source, true))
                ListGroup(group.source, "", held.Handle, group, files, dirs, junctions);
            return new Group { source = group.source, prefix = group.prefix, files = files.ToArray(),
                directories = dirs.ToArray(), expectedFiles = group.expectedFiles };
        }

        private static void WriteEntry(ZipArchive zip, string source, string relative, string prefix, SafeFileHandle handle,
            ILookup<string, string> files, ILookup<string, string> dirs, List<Entry> rows, HashSet<string> names,
            Dictionary<string, string> expectedFiles, Dictionary<string, Entry> generated, List<Entry> omitted) {
            var before = Guard.ReadInfo(handle);
            string fullName = AddPrefix(prefix, relative).TrimEnd('/');
            if (fullName.Length > 0) {
                Require(names.Add(fullName), "Duplicate ZIP entry");
                zip.CreateEntry(fullName + "/", CompressionLevel.NoCompression);
                rows.Add(Folder(fullName));
            }
            foreach (var directory in dirs[relative]) {
                var child = Join(source, directory.Split('/').Last());
                using (var item = Guard.OpenPlain(child, true)) {
                    WriteEntry(zip, child, directory, prefix, item, files, dirs, rows, names, expectedFiles, generated, omitted);
                }
            }
            foreach (var file in files[relative]) {
                var name = AddPrefix(prefix, file);
                Require(names.Add(name), "Duplicate ZIP entry");
                using (var item = Guard.OpenPlain(Join(source, file.Split('/').Last()), false)) {
                    Entry candidate;
                    if (prefix == "artifact" && generated.TryGetValue(file, out candidate)) {
                        var measured = PlainFile(file, item, Stream.Null);
                        if (SameEntry(candidate, measured)) {
                            measured.path = name;
                            omitted.Add(measured);
                            continue;
                        }
                    }
                    using (var entry = zip.CreateEntry(name, CompressionLevel.Optimal).Open()) {
                        var row = PlainFile(name, item, entry);
                        string digest;
                        if (expectedFiles.TryGetValue(file, out digest)) {
                            Require(digest == row.sha256, "Archived source or receipt differs from its registered hash");
                            expectedFiles.Remove(file);
                        }
                        rows.Add(row);
                    }
                }
            }
            Guard.RequireUnchanged(before, handle);
        }

        private static void WriteGroup(ZipArchive zip, Group group, List<Entry> rows, HashSet<string> names,
            Dictionary<string, Entry> generated, List<Entry> omitted) {
            var files = group.files.Select(SafeName).ToArray();
            var dirs = new HashSet<string>((group.directories ?? new string[0]).Select(SafeName), StringComparer.Ordinal);
            // Explicit files may name nested files without listing their ancestor entries.
            foreach (var entry in files.Concat(dirs.ToArray())) {
                for (var parent = ParentName(entry); parent.Length > 0 && dirs.Add(parent); parent = ParentName(parent)) { }
            }
            var prefix = string.IsNullOrEmpty(group.prefix) ? "" : SafeName(group.prefix);
            var expected = new Dictionary<string, string>(group.expectedFiles ?? new Dictionary<string, string>(), StringComparer.Ordinal);
            using (var held = new HeldPath(group.source, true))
                WriteEntry(zip, group.source, "", prefix, held.Handle, files.ToLookup(ParentName), dirs.ToLookup(ParentName),
                    rows, names, expected, generated, omitted);
            Require(expected.Count == 0, "Registered archived files are missing");
        }

        private static bool SameEntry(Entry expected, Entry actual) {
            return expected.path == actual.path && expected.directory == actual.directory &&
                expected.size == actual.size && expected.sha256 == actual.sha256;
        }

        private static void CheckZip(ZipArchive archive, List<Entry> entries) {
            ValidateEntries(entries);
            var expected = entries.ToDictionary(row => row.path, Names);
            foreach (var member in archive.Entries) {
                bool folder = member.FullName.EndsWith("/", StringComparison.Ordinal);
                string name = SafeName(folder ? member.FullName.Substring(0, member.FullName.Length - 1) : member.FullName);
                Entry row;
                int unixType = (member.ExternalAttributes >> 16) & 0xf000;
                Require((member.ExternalAttributes & ReparseFlag) == 0 &&
                    (unixType == 0 || (folder ? unixType == 0x4000 : unixType == 0x8000)), "ZIP entry is a link or special file");
                Require(expected.TryGetValue(name, out row) && row.path == name && row.directory == folder &&
                    row.size == member.Length, "Unexpected ZIP entry, duplicate or length");
                using (var stream = member.Open()) {
                    var digest = CopyHash(stream, Stream.Null, row.size);
                    Require(folder || digest == row.sha256, "ZIP entry hash differs");
                }
                expected.Remove(name);
            }
            Require(expected.Count == 0, "ZIP entries are missing");
        }

        private static void CheckGenerated(ZipArchive archive, Derivation omitted) {
            if (omitted == null) return;
            var proof = archive.GetEntry(SafeName(omitted.proof));
            Require(proof != null && proof.Length <= MaxMetadataBytes, "The generated-output proof is missing");
            Generated ledger;
            using (var stream = proof.Open())
            using (var bytes = new MemoryStream()) {
                CopyHash(stream, bytes, proof.Length);
                ledger = Json.Deserialize<Generated>(Utf8.GetString(bytes.ToArray()));
            }
            Require(ledger != null && ledger.version == 1 && ledger.target == omitted.target &&
                ledger.identity == omitted.identity, "The generated-output proof does not match");
            ValidateEntries(ledger.entries);
            var covered = ledger.entries.ToDictionary(row => "artifact/" + row.path, StringComparer.Ordinal);
            foreach (var omittedEntry in omitted.entries) {
                Entry captured;
                Require(omittedEntry.path.StartsWith("artifact/cache/", StringComparison.Ordinal) &&
                    covered.TryGetValue(omittedEntry.path, out captured) && !captured.directory &&
                    !omittedEntry.directory && captured.size == omittedEntry.size && captured.sha256 == omittedEntry.sha256,
                    "An omitted file was not captured as generated output");
            }
        }

        private sealed class Verified : IDisposable {
            private HeldPath manifestPath;
            private HeldPath archivePath;
            private FileStream stream;
            public ZipArchive Archive;
            public Manifest Manifest;
            public readonly List<KeyValuePair<Reference, Verified>> Bases = new List<KeyValuePair<Reference, Verified>>();

            public Verified(string file, string expected, bool permitReferences) {
                try {
                    manifestPath = new HeldPath(file + ".manifest.json", false);
                    Manifest = Json.Deserialize<Manifest>(Utf8.GetString(ReadSmall(manifestPath.Handle)));
                    Require(Manifest != null && Manifest.format == "zip-v1" && IsHash(Manifest.sha256) &&
                        (expected == null || expected == Manifest.sha256), "Archive metadata or expected hash mismatch");
                    archivePath = new HeldPath(file, false);
                    var info = Guard.ReadInfo(archivePath.Handle);
                    Require((info.Attributes & DirectoryFlag) == 0 && info.Links == 1, "ZIP path is not a plain single-link file");
                    stream = Reader(archivePath.Handle);
                    Require(CopyHash(stream, Stream.Null, info.Length) == Manifest.sha256, "ZIP archive hash differs");
                    stream.Position = 0;
                    Archive = new ZipArchive(stream, ZipArchiveMode.Read, true, Utf8);
                    CheckZip(Archive, Manifest.entries);
                    CheckGenerated(Archive, Manifest.generated);
                    foreach (var reference in Manifest.references ?? new List<Reference>()) {
                        Require(permitReferences && IsHash(reference.sha256) && SafeName(reference.file) == reference.file &&
                            reference.file == "dependencies-" + reference.sha256 + ".zip", "Invalid dependency archive reference");
                        SafeName(reference.prefix);
                        Bases.Add(new KeyValuePair<Reference, Verified>(reference,
                            new Verified(Join(Path.GetDirectoryName(file), reference.file), reference.sha256, false)));
                    }
                    ValidateEntries(EffectiveEntries(true).ToList());
                } catch {
                    Dispose();
                    throw;
                }
            }

            public IEnumerable<Entry> EffectiveEntries(bool includeGenerated = false) {
                foreach (var row in Manifest.entries) yield return row;
                foreach (var pair in Bases) {
                    yield return Folder(pair.Key.prefix);
                    foreach (var row in pair.Value.Manifest.entries)
                        yield return new Entry {
                            path = AddPrefix(pair.Key.prefix, row.path), directory = row.directory, size = row.size, sha256 = row.sha256,
                        };
                }
                if (includeGenerated && Manifest.generated != null)
                    foreach (var row in Manifest.generated.entries) yield return row;
            }

            public object Receipt(string file) {
                return new {
                    format = "zip-v1", path = file, sha256 = Manifest.sha256, verifiedAt = Manifest.verifiedAt,
                    entries = EffectiveEntries().Where(row => !row.directory).Select(row => new { row.path, row.size, row.sha256 }).ToArray(),
                    references = Manifest.references, omittedJunctions = Manifest.omittedJunctions,
                    generatedOmissions = Manifest.generated == null ? new List<Entry>() : Manifest.generated.entries,
                    contentFingerprint = Fingerprint(Manifest.entries, ""),
                };
            }

            public void Dispose() {
                foreach (var pair in Bases) pair.Value.Dispose();
                if (Archive != null) Archive.Dispose();
                if (stream != null) stream.Dispose();
                if (archivePath != null) archivePath.Dispose();
                if (manifestPath != null) manifestPath.Dispose();
            }
        }

        private static string Publish(Request request) {
            var destination = request.destination;
            var directory = Path.GetDirectoryName(destination);
            using (var parent = new HeldPath(directory, true, shareWrite: true)) {
                var temp = Join(directory, ".zip-" + Guid.NewGuid().ToString("N") + ".partial");
                var tempManifest = temp + ".manifest.json";
                bool archiveOwned = false, manifestOwned = false;
                try {
                    var rows = new List<Entry>();
                    var omitted = new List<Entry>();
                    var captured = (request.generated == null ? new List<Entry>() : request.generated.entries)
                        .ToDictionary(row => row.path, StringComparer.Ordinal);
                    string digest;
                    using (var stream = Create(temp)) {
                        archiveOwned = true;
                        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, true, Utf8)) {
                            var names = new HashSet<string>(Names);
                            foreach (var group in request.groups) WriteGroup(zip, group, rows, names, captured, omitted);
                        }
                        stream.Flush(true);
                        stream.Position = 0;
                        using (var check = new ZipArchive(stream, ZipArchiveMode.Read, true, Utf8)) {
                            CheckZip(check, rows);
                            if (omitted.Count > 0) {
                                request.generated.entries = omitted;
                                CheckGenerated(check, request.generated);
                            }
                        }
                        stream.Position = 0;
                        digest = CopyHash(stream, Stream.Null, stream.Length);
                    }
                    if (request.operation == "publish-base")
                        destination = Join(directory, "dependencies-" + digest + ".zip");
                    if (request.operation == "publish-base")
                        Require(Fingerprint(rows, "") == request.targetFingerprint, "The baseline changed while archiving");
                    else if (request.targetFingerprint != null) {
                        var effective = new List<Entry>(rows);
                        effective.AddRange(omitted);
                        foreach (var reference in request.references ?? new Reference[0]) {
                            Require(IsHash(reference.sha256) && reference.file == "dependencies-" + reference.sha256 + ".zip",
                                "Invalid dependency archive reference");
                            using (var basis = new Verified(Join(directory, reference.file), reference.sha256, false)) {
                                effective.Add(Folder(reference.prefix));
                                effective.AddRange(basis.Manifest.entries.Select(row => new Entry {
                                    path = AddPrefix(reference.prefix, row.path), directory = row.directory, size = row.size, sha256 = row.sha256,
                                }));
                            }
                        }
                        ValidateEntries(effective);
                        Require(Fingerprint(effective, "artifact") == request.targetFingerprint, "scheduled-target-changed");
                    }
                    var manifest = new Manifest {
                        format = "zip-v1", sha256 = digest, verifiedAt = DateTime.UtcNow.ToString("o"), entries = rows,
                        references = (request.references ?? new Reference[0]).ToList(),
                        omittedJunctions = (request.omittedJunctions ?? new string[0]).ToList(),
                        generated = omitted.Count > 0 ? request.generated : null,
                    };
                    using (var stream = Create(tempManifest)) {
                        manifestOwned = true;
                        var bytes = Utf8.GetBytes(Json.Serialize(manifest));
                        stream.Write(bytes, 0, bytes.Length);
                        stream.Flush(true);
                    }
                    MoveNew(temp, destination);
                    archiveOwned = false;
                    MoveNew(tempManifest, destination + ".manifest.json");
                    manifestOwned = false;
                    return destination;
                } finally {
                    if (archiveOwned) DeleteFileW(Guard.ExtendedPath(temp));
                    if (manifestOwned) DeleteFileW(Guard.ExtendedPath(tempManifest));
                }
            }
        }

        private static void Unpack(Verified verified, string destination, string prefix) {
            var rows = verified.Manifest.entries.ToDictionary(row => row.path, StringComparer.Ordinal);
            foreach (var member in verified.Archive.Entries) {
                var local = member.FullName.TrimEnd('/');
                var name = AddPrefix(prefix, local);
                var output = Join(destination, name);
                if (member.FullName.EndsWith("/", StringComparison.Ordinal)) continue;
                using (var ancestors = new HeldPath(Path.GetDirectoryName(output), true))
                using (var file = Create(output))
                using (var input = member.Open()) {
                    var expected = rows[local];
                    Require(CopyHash(input, file, expected.size) == expected.sha256, "Extracted bytes differ");
                    file.Flush(true);
                }
            }
            foreach (var pair in verified.Bases) Unpack(pair.Value, destination, AddPrefix(prefix, pair.Key.prefix));
        }

        private static object Extract(string file, string destination) {
            using (var verified = new Verified(file, null, true))
            using (var parent = new HeldPath(Path.GetDirectoryName(destination), true)) {
                CreateDirectory(destination);
                using (var owned = new HeldPath(destination, true)) {
                    var dirs = new SortedSet<string>(StringComparer.Ordinal);
                    foreach (var row in verified.EffectiveEntries()) {
                        string parentName = row.directory ? row.path : ParentName(row.path);
                        while (parentName.Length > 0 && dirs.Add(parentName)) parentName = ParentName(parentName);
                    }
                    foreach (var dir in dirs) {
                        var output = Join(destination, dir);
                        using (var ancestors = new HeldPath(Path.GetDirectoryName(output), true)) CreateDirectory(output);
                    }
                    Unpack(verified, destination, "");
                }
                return verified.Receipt(file);
            }
        }

        private sealed class DeletionEntry : IDisposable {
            public Entry Row;
            public SafeFileHandle Handle;
            public void Dispose() { Handle.Dispose(); }
        }

        private static void CheckCleanupName(string name) {
            Require(!Names.Equals(name, ".git") && !Names.Equals(name, ".superpowers") &&
                !Names.Equals(name, "$Recycle.Bin") && !Regex.IsMatch(name, @"\AOneDrive(?: - .+)?\z", RegexOptions.IgnoreCase),
                "An unexpected protected directory marker prevents cleanup");
        }

        private static Entry GatherDeletion(string file, string name, SafeFileHandle handle,
            IDictionary<string, Entry> expected, List<DeletionEntry> held) {
            var before = Guard.ReadInfo(handle);
            var isDirectory = (before.Attributes & DirectoryFlag) != 0;
            Entry saved;
            Require(expected.TryGetValue(name, out saved), "An unarchived entry prevents deletion");
            var actual = isDirectory ? Folder(name) : PlainFile(name, handle, Stream.Null);
            Require(SameEntry(saved, actual), "The target differs from the verified archive");
            expected.Remove(name);
            if (isDirectory) {
                foreach (var child in Children(file)) {
                    CheckCleanupName(child);
                    var relative = AddPrefix(name, SafeName(child));
                    var childPath = Join(file, child);
                    var item = Guard.OpenPlain(childPath, false, true);
                    // Record ownership immediately, even when reading the entry fails.
                    var retained = new DeletionEntry { Handle = item };
                    held.Add(retained);
                    retained.Row = GatherDeletion(childPath, relative, item, expected, held);
                }
                Guard.RequireUnchanged(before, handle);
            }
            return actual;
        }

        private static int ComparePath(string left, string right) {
            var a = left.Split('/'); var b = right.Split('/');
            for (int i = 0; i < Math.Min(a.Length, b.Length); i++) {
                int order = string.CompareOrdinal(a[i], b[i]);
                if (order != 0) return order;
            }
            return a.Length.CompareTo(b.Length);
        }

        private static string Fingerprint(IEnumerable<Entry> effective, string root) {
            var rows = (root.Length == 0 ? effective : effective.Where(row =>
                row.path == root || row.path.StartsWith(root + "/", StringComparison.Ordinal))).ToList();
            rows.Sort((left, right) => ComparePath(left.path, right.path));
            using (var digest = SHA256.Create())
            using (var sink = new CryptoStream(Stream.Null, digest, CryptoStreamMode.Write))
            using (var writer = new BinaryWriter(sink, Utf8, true)) {
                writer.Write("windows-inspection-v1");
                if (root.Length == 0) {
                    writer.Write((byte)0);
                    writer.Write("");
                }
                foreach (var row in rows) {
                    writer.Write((byte)(row.directory ? 0 : 1));
                    writer.Write(root.Length == 0 ? row.path : row.path == root ? "" : row.path.Substring(root.Length + 1));
                    if (!row.directory) {
                        writer.Write(row.size);
                        for (int i = 0; i < row.sha256.Length; i += 2) writer.Write(Convert.ToByte(row.sha256.Substring(i, 2), 16));
                    }
                }
                writer.Flush();
                sink.FlushFinalBlock();
                return Hex(digest.Hash);
            }
        }

        private static void MarkDelete(SafeFileHandle handle) {
            byte delete = 1;
            if (!SetFileInformationByHandle(handle, 4, ref delete, 1))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            handle.Dispose();
        }

        private static object Delete(Request request) {
            using (var archive = new Verified(request.file, request.archiveSha256, true))
            using (var root = new HeldPath(request.target, true, true)) {
                Require(Guard.Identity(root.Handle) == request.targetIdentity, "The target directory was replaced");
                if (archive.Manifest.generated != null) Require(Names.Equals(archive.Manifest.generated.target, request.target) &&
                    archive.Manifest.generated.identity == request.targetIdentity, "Generated output belongs to another target");
                var rows = archive.EffectiveEntries(true).ToList();
                Require(Fingerprint(rows, "artifact") == request.targetFingerprint, "ZIP does not contain the scheduled target");
                var expected = rows.Where(row => row.path == "artifact" || row.path.StartsWith("artifact/", StringComparison.Ordinal))
                    .ToDictionary(row => row.path, Names);
                var held = new List<DeletionEntry>();
                try {
                    GatherDeletion(request.target, "artifact", root.Handle, expected, held);
                    Require(request.resume || expected.Count == 0, "The target lost entries before deletion");
                    Console.WriteLine(@"{""ready"":true}");
                    if (Console.ReadLine() != "delete") return new { status = "skipped", deletedBytes = 0L };
                    long bytes = 0;
                    try {
                        // Leave identifying records until last so a partial target remains discoverable.
                        foreach (var item in held.Where(x => !x.Row.directory)
                            .OrderBy(x => Names.Equals(x.Row.path, "artifact/release.json") ||
                                Names.Equals(x.Row.path, "artifact/BUILD_ID") ||
                                (x.Row.path.EndsWith("/BUILD_ID", StringComparison.OrdinalIgnoreCase) && x.Row.path.Count(c => c == '/') == 2))
                            .ThenBy(x => x.Row.path, StringComparer.Ordinal)) {
                            MarkDelete(item.Handle);
                            bytes = checked(bytes + item.Row.size);
                        }
                        foreach (var item in held.Where(x => x.Row.directory).Reverse()) MarkDelete(item.Handle);
                        MarkDelete(root.Handle);
                        try {
                            File.GetAttributes(Guard.ExtendedPath(request.target));
                            return new { status = "failed", deletedBytes = bytes, reason = "target-still-exists" };
                        } catch (FileNotFoundException) {
                            // The root is gone after the final handle is closed.
                        } catch (DirectoryNotFoundException) {
                            // The root is gone after the final handle is closed.
                        } catch (UnauthorizedAccessException) {
                            return new { status = "failed", deletedBytes = bytes, reason = "target-removal-unverified" };
                        }
                        return new { status = "completed", deletedBytes = bytes };
                    } catch (Win32Exception error) {
                        return new { status = "failed", deletedBytes = bytes, reason = "delete-win32-" + error.NativeErrorCode };
                    }
                } finally {
                    foreach (var item in held) item.Dispose();
                }
            }
        }

        private static object ReadRecords(string[] files, string pinnedRoot) {
            return files.Select(file => {
                try {
                    using (var held = new HeldPath(file, false, false, pinnedRoot))
                        return new { path = file, bytes = Convert.ToBase64String(ReadSmall(held.Handle)) };
                } catch (IOException) {
                    return new { path = file, bytes = (string)null };
                } catch (Win32Exception) {
                    return new { path = file, bytes = (string)null };
                } catch (InvalidOperationException) {
                    return new { path = file, bytes = (string)null };
                }
            }).ToArray();
        }

        private static object Measure(string[] targets) {
            return targets.Select(target => {
                try {
                    var snapshot = Guard.Inspect(target, true);
                    return new { path = target, bytes = (long?)snapshot.Bytes, files = (long?)snapshot.Files,
                        fingerprint = snapshot.Fingerprint, identity = snapshot.Identity, dependencyFingerprint = snapshot.DependencyFingerprint };
                } catch (Exception error) {
                    if (!(error is IOException || error is Win32Exception || error is InvalidOperationException)) throw;
                    return new { path = target, bytes = (long?)null, files = (long?)null,
                        fingerprint = (string)null, identity = (string)null, dependencyFingerprint = (string)null };
                }
            }).ToArray();
        }

        private static void WriteState(StateWrite record) {
            var directory = Path.GetDirectoryName(record.path);
            using (var parent = new HeldPath(directory, true, shareWrite: true)) {
                var temp = Join(directory, ".write-" + Guid.NewGuid().ToString("N") + ".partial");
                bool owned = false;
                try {
                    using (var stream = Create(temp)) {
                        owned = true;
                        var bytes = Utf8.GetBytes(record.data);
                        stream.Write(bytes, 0, bytes.Length);
                        stream.Flush(true);
                    }
                    if (!MoveFileExW(Guard.ExtendedPath(temp), Guard.ExtendedPath(record.path), record.overwrite ? 9u : 8u))
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    owned = false;
                } finally {
                    if (owned) DeleteFileW(Guard.ExtendedPath(temp));
                }
            }
        }

        private static void EnsureDirectory(string directory) {
            using (var parent = new HeldPath(Path.GetDirectoryName(directory), true)) {
                if (!CreateDirectoryW(Guard.ExtendedPath(directory), IntPtr.Zero)) {
                    int error = Marshal.GetLastWin32Error();
                    if (error != 183) throw new Win32Exception(error);
                }
                using (var owned = new HeldPath(directory, true)) { }
            }
        }

        private static string[] ListDirectory(string directory) {
            try {
                using (var held = new HeldPath(directory, true)) return Children(directory);
            } catch (Win32Exception error) {
                if (error.NativeErrorCode == 2 || error.NativeErrorCode == 3) return new string[0];
                throw;
            }
        }

        public static string Run(string requestJson) {
            var request = Json.Deserialize<Request>(requestJson);
            object result;
            switch (request.operation) {
                case "catalog":
                    var junctions = new List<string>();
                    result = new { groups = request.groups.Select(group => Catalog(group, junctions)).ToArray(), omittedJunctions = junctions };
                    break;
                case "publish":
                case "publish-base":
                    string published = Publish(request);
                    // All written entries were reread before publication. Reopen finalized bytes
                    // and dependency references before a receipt can authorize an operation.
                    using (var verified = new Verified(published, null, true)) result = verified.Receipt(published);
                    break;
                case "verify":
                    using (var verified = new Verified(request.file, request.archiveSha256, true)) result = verified.Receipt(request.file);
                    break;
                case "extract":
                    result = Extract(request.file, request.destination);
                    break;
                case "delete":
                    result = Delete(request);
                    break;
                case "read":
                    result = ReadRecords(request.records, request.target);
                    break;
                case "measure":
                    result = Measure(request.records);
                    break;
                case "capture":
                    var snapshot = Guard.Inspect(request.target, false, true);
                    result = new { version = 1, target = snapshot.Path, identity = snapshot.Identity,
                        fingerprint = snapshot.Fingerprint, entries = snapshot.Entries };
                    break;
                case "write":
                    foreach (var record in request.writes) WriteState(record);
                    result = new { written = request.writes.Length };
                    break;
                case "ensure-directories":
                    foreach (var directory in request.records) EnsureDirectory(directory);
                    result = new { verified = request.records.Length };
                    break;
                case "list":
                    result = ListDirectory(request.target);
                    break;
                default: throw new IOException("Unknown storage operation");
            }
            return Json.Serialize(result);
        }
    }
}
'@

Add-Type -TypeDefinition ($shared + $worker) -ReferencedAssemblies @(
    'System.dll', 'System.Core.dll', 'System.IO.Compression.dll', 'System.Web.Extensions.dll'
)
try {
    [Console]::WriteLine([ContractorStorage.ArchiveWorker]::Run([Console]::ReadLine()))
} catch {
    [Console]::Error.WriteLine($_.Exception.GetBaseException().ToString())
    exit 1
}
