# Slow-down helper (plan step 13.2, D30/D36). Called by lib/throttle.mjs, only ever with process ids of programs the Hub itself started.
#   -Action tree    -Pids a,b                         every live process id below those programs (children, grandchildren), JSON
#   -Action apply   -Pids a,b -Cores N -WorkingSetMB M  lowest priority, only the LAST N logical processors, a working-set cap per process;
#                                                      prints the original values as JSON so they can be put back exactly
#   -Action restore -StateFile file.json              puts every saved original back (only if the process is still the same one)
#   -Action get     -Pids a,b                         priority, cores and working-set cap of those processes (for tests and the dashboard)
# The working-set cap keeps at most M MB of a process in RAM and pages the rest out: nothing crashes, it just gets slower.
param([string]$Action, [string]$Pids = "", [int]$Cores = 0, [int]$WorkingSetMB = 0, [string]$StateFile = "")
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class HubThrottle {
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool GetProcessWorkingSetSizeEx(IntPtr h, out UIntPtr min, out UIntPtr max, out uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetProcessWorkingSetSizeEx(IntPtr h, UIntPtr min, UIntPtr max, uint flags);
}
"@
$ids = @(); if ($Pids) { $ids = @($Pids.Split(",") | Where-Object { $_ } | ForEach-Object { [int]$_ }) }
$total = [Environment]::ProcessorCount

function Tree-Pids($roots) {
  $all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
  $seen = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  foreach ($r in $roots) { if (Get-Process -Id $r -ErrorAction SilentlyContinue) { [void]$seen.Add($r); $queue.Enqueue($r) } }
  while ($queue.Count -gt 0) { $cur = $queue.Dequeue(); foreach ($k in ($all | Where-Object { $_.ParentProcessId -eq $cur })) { if ($seen.Add([int]$k.ProcessId)) { $queue.Enqueue([int]$k.ProcessId) } } }
  return @($seen)
}
function Ws-Get($p) { $mn = [UIntPtr]::Zero; $mx = [UIntPtr]::Zero; $fl = [uint32]0; [void][HubThrottle]::GetProcessWorkingSetSizeEx($p.Handle, [ref]$mn, [ref]$mx, [ref]$fl); return @{ min = [string]$mn.ToUInt64(); max = [string]$mx.ToUInt64(); flags = [int]$fl } }

switch ($Action) {
  "tree" { ConvertTo-Json -Compress -InputObject @(Tree-Pids $ids) }
  "get" {
    $out = @(foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p) { $w = Ws-Get $p; @{ pid = $id; priority = [string]$p.PriorityClass; affinity = [string][int64]$p.ProcessorAffinity; wsMax = $w.max; wsFlags = $w.flags } } })
    ConvertTo-Json -Compress -InputObject @($out)
  }
  "apply" {
    $n = [Math]::Max(1, [Math]::Min($Cores, $total))
    $mask = [int64]0; for ($i = $total - $n; $i -lt $total; $i++) { $mask = $mask -bor ([int64]1 -shl $i) }
    $entries = @(); $failed = @()
    foreach ($id in $ids) {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if (-not $p) { continue }
      try {
        $w = Ws-Get $p
        $entry = @{ pid = $id; start = $p.StartTime.ToString("o"); priority = [string]$p.PriorityClass; affinity = [string][int64]$p.ProcessorAffinity; wsMin = $w.min; wsMax = $w.max }
        $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::Idle
        $orig = [int64]$p.ProcessorAffinity; $use = $orig -band $mask; if ($use -ne 0) { $p.ProcessorAffinity = [IntPtr]$use }
        if ($WorkingSetMB -gt 0) { [void][HubThrottle]::SetProcessWorkingSetSizeEx($p.Handle, (New-Object UIntPtr ([uint64]1MB)), (New-Object UIntPtr ([uint64]$WorkingSetMB * 1MB)), 6) }  # 6 = hard maximum on, hard minimum off
        $entries += $entry
      } catch { $failed += @{ pid = $id; error = $_.Exception.Message } }
    }
    ConvertTo-Json -Compress -Depth 4 -InputObject @{ entries = @($entries); failed = @($failed); mask = [string]$mask; cores = $n }
  }
  "restore" {
    $state = Get-Content $StateFile -Raw | ConvertFrom-Json
    $done = 0; $skipped = 0
    foreach ($e in @($state.entries)) {
      $p = Get-Process -Id ([int]$e.pid) -ErrorAction SilentlyContinue
      if (-not $p -or $p.StartTime.ToString("o") -ne $e.start) { $skipped++; continue }   # gone, or the id was reused by another program
      try {
        $p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]$e.priority
        $p.ProcessorAffinity = [IntPtr][int64]$e.affinity
        [void][HubThrottle]::SetProcessWorkingSetSizeEx($p.Handle, (New-Object UIntPtr ([uint64]$e.wsMin)), (New-Object UIntPtr ([uint64]$e.wsMax)), 10)  # 10 = both hard limits off
        $done++
      } catch { $skipped++ }
    }
    ConvertTo-Json -Compress -InputObject @{ restored = $done; skipped = $skipped }
  }
}
