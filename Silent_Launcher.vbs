Set WshShell = CreateObject("WScript.Shell")
' Run Start_WebUI.bat with WindowStyle=0 (Hidden) and SILENT argument
WshShell.Run "cmd /c scripts\Windows\Start_WebUI.bat SILENT", 0, False
