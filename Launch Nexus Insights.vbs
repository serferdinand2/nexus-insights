' Launch Nexus Insights without a console window.
'
' Running "npm start" from a shortcut leaves a black cmd window open behind the
' app for as long as it runs. This starts Electron directly, hidden.
'
' Self-locating: it uses its own folder, so moving or renaming the project
' folder won't break the desktop shortcut.

Option Explicit

Dim fso, shell, appDir, electronCmd

Set fso   = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appDir      = fso.GetParentFolderName(WScript.ScriptFullName)
electronCmd = appDir & "\node_modules\.bin\electron.cmd"

If Not fso.FileExists(electronCmd) Then
    MsgBox "Electron isn't installed yet." & vbCrLf & vbCrLf & _
           "Open a terminal in:" & vbCrLf & appDir & vbCrLf & vbCrLf & _
           "and run:  npm install", _
           vbExclamation, "Nexus Insights"
    WScript.Quit 1
End If

shell.CurrentDirectory = appDir

' 0 = hidden window, False = don't wait for it to exit
shell.Run """" & electronCmd & """ .", 0, False
