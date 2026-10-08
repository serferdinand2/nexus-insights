; installer.nsh - custom NSIS steps for the Nexus Insights installer.
; Included via "build.nsis.include" in package.json.

!macro customUnInstall
  ; The app registers itself to start with Windows (Settings > "Start with
  ; Windows", on by default). Remove that entry on a real uninstall, or Windows
  ; keeps trying to launch a program that no longer exists at every login.
  ; Skipped during an upgrade: the old version's uninstaller runs first, and the
  ; new version re-registers itself on its next launch anyway.
  ; Value name must match LOGIN_ITEM_NAME in src/main.js.
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Nexus Insights"
  ${endIf}

  ; Match history and settings in %APPDATA%\nexus-insights are deliberately
  ; kept, so reinstalling doesn't mean re-syncing a whole season.
!macroend
