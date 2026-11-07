' Starts the Hub dashboard in the background (no window) when Windows starts. Installed by "Install Hub Autostart.bat".
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = WScript.ScriptFullName
For i = 1 To 4
  root = fso.GetParentFolderName(root)
Next
sh.CurrentDirectory = root
sh.Run """" & root & "\Start Hub Dashboard.bat"" boot", 0, False
