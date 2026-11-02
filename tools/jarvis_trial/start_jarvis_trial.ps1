# Starts Daniel's speaker service and the persona relay (if not already running), then the isair/jarvis trial app
# (its own voice is switched off in its config: Daniel speaks instead), and hides Jarvis's face window.
# To go back to Jarvis's own voice: set "tts_enabled": true in C:\Users\Ivan\.config\jarvis\config.json and start the
# relay without --speak.
$hub = 'C:\Users\Ivan\Desktop\BUSNUS\Hub'
$py = "$hub\.venv\Scripts\python.exe"
if (-not (Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'kokoro_speaker\.py' })) {
    $env:KOKORO_DEVICE = 'cuda'
    Start-Process $py -ArgumentList "$hub\tools\jarvis_trial\kokoro_speaker.py", '8788' -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep 2; try { Invoke-WebRequest http://127.0.0.1:8788/health -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch {} }
}
$relay = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'gemini_relay\.py' }
if ($relay -and -not ($relay | Where-Object { $_.CommandLine -match '--speak' })) {
    $relay | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep 1
    $relay = $null
}
if (-not $relay) {
    Start-Process $py -ArgumentList "$hub\tools\jarvis_trial\gemini_relay.py", '8787', '--speak', 'http://127.0.0.1:8788' -WindowStyle Hidden
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
