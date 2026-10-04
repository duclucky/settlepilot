Option Explicit

Dim shell, files, root, script, powershell, command, port, noBrowser, status
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
script = files.BuildPath(root, "Open-SettlePilot.ps1")
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
port = "4317"
noBrowser = False

If WScript.Arguments.Count > 0 Then
  port = WScript.Arguments(0)
  If Not IsNumeric(port) Then WScript.Quit 2
  If CStr(CLng(port)) <> port Then WScript.Quit 2
  If CLng(port) < 1024 Or CLng(port) > 65535 Then WScript.Quit 2
End If
If WScript.Arguments.Count > 1 Then
  If WScript.Arguments(1) <> "--no-browser" Then WScript.Quit 2
  noBrowser = True
End If
If WScript.Arguments.Count > 2 Then WScript.Quit 2

shell.CurrentDirectory = root
command = Chr(34) & powershell & Chr(34) & " -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File " & Chr(34) & script & Chr(34) & " -Port " & port
If noBrowser Then command = command & " -NoBrowser"
' Window style 0 keeps the launcher hidden; the backend also starts hidden.
status = shell.Run(command, 0, True)
If status <> 0 Then
  shell.Popup "SettlePilot could not start. Install Node.js 24.11 or newer, then run npm ci and npm run build once in this folder. See README.md for port conflicts and startup troubleshooting.", 0, "SettlePilot startup", 16
End If
WScript.Quit status
