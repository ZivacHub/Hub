# Starts the persona relay (if not already running), then the isair/jarvis trial app, and hides its face window.
$hub = 'C:\Users\Ivan\Desktop\BUSNUS\Hub'
if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'gemini_relay\.py' })) {
    Start-Process "$hub\.venv\Scripts\python.exe" -ArgumentList "$hub\tools\jarvis_trial\gemini_relay.py", '8787' -WindowStyle Hidden
    Start-Sleep 2
}
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class HwStart { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }
"@
Start-Process 'C:\Program Files\Jarvis\Jarvis.exe' -WorkingDirectory 'C:\Program Files\Jarvis'
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep 3
    $d = Get-Process Jarvis | Where-Object { $_.MainWindowTitle -match 'recommendations|Wizard' }
    if ($d) { $d | ForEach-Object { $_.CloseMainWindow() | Out-Null }; break }
}
Start-Sleep 30
Get-Process Jarvis | Where-Object { $_.MainWindowTitle -match '^.. Jarvis$' } | ForEach-Object { [HwStart]::ShowWindow($_.MainWindowHandle, 0) | Out-Null }
