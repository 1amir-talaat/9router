Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)
electronExe = fso.BuildPath(fso.BuildPath(fso.BuildPath(repoRoot, "node_modules"), "electron"), "dist\electron.exe")
mainFile = fso.BuildPath(fso.BuildPath(repoRoot, "desktop"), "main.cjs")

If Not fso.FileExists(electronExe) Then
  MsgBox "Electron is not installed in this repo. Run npm install first.", vbExclamation, "9Router"
  WScript.Quit 1
End If

hiddenArg = ""
For i = 0 To WScript.Arguments.Count - 1
  If LCase(WScript.Arguments.Item(i)) = "--hidden" Then
    hiddenArg = " --hidden"
  End If
Next

command = "cmd.exe /c set ""ELECTRON_RUN_AS_NODE="" && " & Chr(34) & electronExe & Chr(34) & " " & Chr(34) & mainFile & Chr(34) & hiddenArg
shell.Run command, 0, False
