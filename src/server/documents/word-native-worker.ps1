param([switch]$Cleanup)
$ErrorActionPreference='Stop'
$folder=(Get-Location).Path
$ownedPath=Join-Path $folder 'owned-word.json'
if($Cleanup){
 if(Test-Path -LiteralPath $ownedPath){
  $owned=Get-Content -LiteralPath $ownedPath -Raw -Encoding UTF8|ConvertFrom-Json
  $process=Get-Process -Id ([int]$owned.pid) -ErrorAction SilentlyContinue
  if($process -and $process.ProcessName -eq 'WINWORD' -and $process.StartTime.ToUniversalTime().Ticks.ToString() -eq [string]$owned.startedTicks){Stop-Process -Id $process.Id}
 }
 exit 0
}
Add-Type -TypeDefinition @"
using System;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;
public static class LocalWordInstance {
 public delegate bool Callback(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(Callback f,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h,Callback f,IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("oleacc.dll")] public static extern int AccessibleObjectFromWindow(IntPtr h,uint id,ref Guid iid,[MarshalAs(UnmanagedType.IDispatch)] out object value);
 public static bool OwnsProcess(uint launched,uint window,long launchedTicks,long currentTicks,bool exited,uint[] before){return launched==window&&launchedTicks==currentTicks&&!exited&&Array.IndexOf(before,window)<0;}
 public static object Open(object documents,string file){return documents.GetType().InvokeMember("Open",System.Reflection.BindingFlags.InvokeMethod,null,documents,new object[]{file,false,true,false});}
 public static IntPtr[] Find(uint pid){var found=new List<IntPtr>();Callback child=(h,l)=>{uint p;GetWindowThreadProcessId(h,out p);var c=new StringBuilder(256);GetClassName(h,c,256);if(p==pid&&c.ToString()=="_WwG")found.Add(h);return true;};Callback root=(h,l)=>{uint p;GetWindowThreadProcessId(h,out p);if(p==pid)EnumChildWindows(h,child,IntPtr.Zero);return true;};EnumWindows(root,IntPtr.Zero);return found.ToArray();}
 public static object Native(IntPtr h){Guid iid=new Guid("00020400-0000-0000-C000-000000000046");object v;int code=AccessibleObjectFromWindow(h,0xFFFFFFF0,ref iid,out v);if(code!=0)Marshal.ThrowExceptionForHR(code);return v;}
}
"@
$word=$null;$doc=$null;$ownedProcess=$null;$bound=$false;$noSave=0;$records=@()
try{
 $before=@(Get-Process WINWORD -ErrorAction SilentlyContinue|ForEach-Object {$_.Id})
 $candidates=@('C:/Program Files (x86)/Microsoft Office/root/Office16/WINWORD.EXE','C:/Program Files/Microsoft Office/root/Office16/WINWORD.EXE')
 $exe=$null;foreach($candidate in $candidates){if(Test-Path -LiteralPath $candidate){$exe=$candidate;break}}
 if(-not $exe){throw 'WORD_NATIVE_UNAVAILABLE'}
 # /x creates a separate process. /a avoids global templates/add-ins and locks
 # saved Word settings; /m suppresses AutoExec. No archive file is opened yet.
 $launched=Start-Process -FilePath $exe -ArgumentList '/x','/a','/q','/w','/m','/automation' -WindowStyle Hidden -PassThru
 for($attempt=0;$attempt -lt 100;$attempt++){
  foreach($windowHandle in [LocalWordInstance]::Find([uint32]$launched.Id)){
   try{
    $native=[LocalWordInstance]::Native($windowHandle)
    $candidate=$native.Application
    [uint32]$actualPid=0
    [void][LocalWordInstance]::GetWindowThreadProcessId([IntPtr]([int64]$candidate.ActiveWindow.Hwnd),[ref]$actualPid)
    $candidateProcess=Get-Process -Id $actualPid -ErrorAction SilentlyContinue
    if($candidateProcess -and $candidateProcess.ProcessName -eq 'WINWORD' -and [LocalWordInstance]::OwnsProcess([uint32]$launched.Id,$actualPid,$launched.StartTime.ToUniversalTime().Ticks,$candidateProcess.StartTime.ToUniversalTime().Ticks,$launched.HasExited,[uint32[]]$before)){$word=$candidate;$ownedProcess=$candidateProcess;$bound=$true;break}
   }catch{}
  }
  if($bound){break};Start-Sleep -Milliseconds 150
 }
 if(-not $bound){throw 'WORD_NATIVE_INSTANCE_UNVERIFIED'}
 # Only the directly bound HWND -> launched PID may be marked for cleanup.
 [ordered]@{pid=$ownedProcess.Id;startedTicks=$ownedProcess.StartTime.ToUniversalTime().Ticks.ToString();priorPids=@($before);hwnd=[int64]$word.ActiveWindow.Hwnd}|ConvertTo-Json|Out-File -LiteralPath $ownedPath -Encoding UTF8
 $word.Visible=$false;$word.DisplayAlerts=0;$word.AutomationSecurity=3
 $source=Join-Path $folder 'source.docx'
 $doc=[LocalWordInstance]::Open($word.Documents,[string]$source)
 [uint32]$actualPid=0
 [void][LocalWordInstance]::GetWindowThreadProcessId([IntPtr]([int64]$doc.ActiveWindow.Hwnd),[ref]$actualPid)
 if($actualPid -ne $ownedProcess.Id -or -not $doc.ReadOnly -or $doc.FullName -ne $source){throw 'WORD_NATIVE_INSTANCE_UNVERIFIED'}
 $doc.ExportAsFixedFormat([string](Join-Path $folder 'source.pdf'),17)
 $doc.Close([ref]$noSave);$doc=$null
 $targets=Get-Content -LiteralPath (Join-Path $folder 'targets.json') -Raw -Encoding UTF8|ConvertFrom-Json
 $index=0
 foreach($target in $targets){
  $copy=Join-Path $folder ('probe-'+$index+'.docx');Copy-Item -LiteralPath $source -Destination $copy
  $doc=[LocalWordInstance]::Open($word.Documents,[string]$copy)
  if(-not $doc.ReadOnly -or $doc.FullName -ne $copy){throw 'WORD_NATIVE_SOURCE_UNVERIFIED'}
  $matches=@();foreach($shape in $doc.Shapes){if($shape.Name -eq [string]$target.name){$matches+=,$shape}}
  if($matches.Count -eq 1){
   $shape=$matches[0]
   # Only a non-text AutoShape from the known passive OOXML representation.
   if($shape.Type -eq 1 -and -not $shape.TextFrame.HasText){
    $filename='without-'+$index+'.pdf'
    $entry=[ordered]@{name=$shape.Name;widthPoints=$shape.Width;heightPoints=$shape.Height;rotationDegrees=$shape.Rotation;anchorPage=$shape.Anchor.Information(3);file=$filename;readOnly=$doc.ReadOnly}
    $shape.Delete()
    $doc.ExportAsFixedFormat([string](Join-Path $folder $filename),17)
    $records+=,[pscustomobject]$entry
   }
  }
  $doc.Close([ref]$noSave);$doc=$null;$index++
 }
 ConvertTo-Json -InputObject @($records) -Depth 6|Out-File -LiteralPath (Join-Path $folder 'shapes.json') -Encoding UTF8
}finally{
 if($bound -and $ownedProcess){
  if($doc){try{$doc.Close([ref]$noSave)}catch{}}
  if($word){try{$word.Quit([ref]$noSave)}catch{}}
 }
}
