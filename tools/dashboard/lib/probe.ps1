# Game probe (plan step 13.1). Reads only: which of the watched programs are running, which app is in front and whether it covers
# the whole screen. One JSON line every -Seconds seconds (or once with -Once). Runs as ONE long-lived process so it costs almost nothing.
param([int]$Seconds = 10, [string]$Watch = "", [int]$ParentPid = 0, [switch]$Once)
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HubProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, int flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  // returns: pid, whether the window covers its whole monitor, and its window class
  public static void Front(out int pid, out bool full, out string cls) {
    pid = 0; full = false; cls = "";
    IntPtr h = GetForegroundWindow(); if (h == IntPtr.Zero) return;
    GetWindowThreadProcessId(h, out pid);
    StringBuilder sb = new StringBuilder(256); GetClassName(h, sb, 256); cls = sb.ToString();
    RECT r; if (!GetWindowRect(h, out r)) return;
    IntPtr m = MonitorFromWindow(h, 2); if (m == IntPtr.Zero) return;
    MONITORINFO mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(m, ref mi)) return;
    full = r.Left <= mi.rcMonitor.Left && r.Top <= mi.rcMonitor.Top && r.Right >= mi.rcMonitor.Right && r.Bottom >= mi.rcMonitor.Bottom;
  }
}
"@
$watch = @(); if ($Watch) { $watch = $Watch.ToLower().Split(",") | Where-Object { $_ } }
do {
  if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }  # the Hub's server is gone: stop
  $fgPid = 0; $full = $false; $cls = ""
  [HubProbe]::Front([ref]$fgPid, [ref]$full, [ref]$cls)
  $fg = $null; if ($fgPid -gt 0) { $p = Get-Process -Id $fgPid -ErrorAction SilentlyContinue; if ($p) { $fg = $p.ProcessName.ToLower() } }
  $hits = @()
  if ($watch.Count -gt 0) { $hits = @(Get-Process -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName.ToLower() } | Where-Object { $watch -contains $_ } | Sort-Object -Unique) }
  [pscustomobject]@{ at = (Get-Date).ToString("o"); fg = $fg; full = $full; cls = $cls; running = $hits } | ConvertTo-Json -Compress
  if (-not $Once) { Start-Sleep -Seconds $Seconds }
} while (-not $Once)
