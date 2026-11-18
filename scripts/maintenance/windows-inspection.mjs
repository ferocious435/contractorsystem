// Windows must keep directories pinned while Node enumerates paths beneath them.
// FileShare.Read excludes both write and delete sharing on the guarded handles.
export const windowsInspectionScript = String.raw`
  $query = ConvertFrom-Json -InputObject $env:CODEX_MAINTENANCE_QUERY
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false, $true)
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
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
        private uint CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh;
        private uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security,
                                                     uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo information);
    [DllImport("kernel32.dll")]
    private static extern uint GetFileType(SafeFileHandle handle);

    public static SafeFileHandle OpenPlain(string path, bool requireDirectory) {
        var handle = CreateFileW(@"\\?\" + path, ReadDataAndAttributes, ShareRead, IntPtr.Zero,
                                 OpenExisting, BackupSemantics | OpenReparsePoint, IntPtr.Zero);
        try {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            FileInfo info;
            if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.Attributes & ReparsePoint) != 0 || GetFileType(handle) != DiskFileType ||
                (requireDirectory && (info.Attributes & Directory) == 0))
                throw new InvalidOperationException("The path is a reparse point or an unexpected file type");
            return handle;
        } catch {
            handle.Dispose();
            throw;
        }
    }
}
'@
  $handles = [Collections.Generic.List[object]]::new()
  function Hold-Path([string]$file) {
    if (!$file.Equals($query.target, [StringComparison]::OrdinalIgnoreCase) -and
        !$file.StartsWith($query.target + '\', [StringComparison]::OrdinalIgnoreCase)) {
      throw 'Inspection path is outside the target'
    }
    $root = [IO.Path]::GetPathRoot($file)
    $parts = @($file.Substring($root.Length).Split('\') | Where-Object { $_ })
    $paths = [Collections.Generic.List[string]]::new()
    $paths.Add($root)
    foreach ($part in $parts) { $paths.Add([IO.Path]::Combine($paths[$paths.Count - 1], $part)) }
    $shared = 0
    while ($shared -lt $handles.Count -and $shared -lt $paths.Count -and
           $handles[$shared].Path.Equals($paths[$shared], [StringComparison]::Ordinal)) {
      $shared++
    }
    for ($i = $handles.Count - 1; $i -ge $shared; $i--) {
      $handles[$i].Handle.Dispose()
      $handles.RemoveAt($i)
    }
    for ($i = $shared; $i -lt $paths.Count; $i++) {
      $handle = [ContractorInspection]::OpenPlain($paths[$i], $i -lt ($paths.Count - 1))
      $handles.Add(@{ Path = $paths[$i]; Handle = $handle })
    }
    [Console]::WriteLine('ready')
  }
  try {
    Hold-Path $query.target
    while ($null -ne ($next = [Console]::ReadLine())) {
      $file = ConvertFrom-Json -InputObject $next
      Hold-Path $file
    }
  } finally {
    for ($i = $handles.Count - 1; $i -ge 0; $i--) { $handles[$i].Handle.Dispose() }
  }
`;
