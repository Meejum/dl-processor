; Custom NSIS hooks for the DL-Processor installer / uninstaller.
;
; Wired up via electron-builder.yml -> nsis.include: build/installer.nsh

!macro customInstall
  ; Wipe any cached first-run config from prior dev sessions or earlier
  ; installs. Without this, the new install reads the previous
  ; config.json (which might point to a dev path that doesn't exist on
  ; this user's machine) and silently uses the wrong data folder.
  ; The app re-creates the file on first launch with the production
  ; default (Desktop\DL-Processor).
  Delete "$APPDATA\dl-processor\config.json"
!macroend

!macro customUnInstall
  ; Always remove the per-user app cache (config.json, Electron's
  ; userData scratch) so a re-install is a clean slate.
  RMDir /r "$APPDATA\dl-processor"

  ; Ask before deleting the user's data folder — that's where their
  ; imported DLD/SF data, master_data, and generated reports live.
  ; Default to "No" on Enter so a careless click can't nuke months of work.
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete the DL-Processor data folder?$\r$\n$\r$\nThis will permanently remove the contents of $DESKTOP\DL-Processor — including imported DLD files, Salesforce snapshots, the SQLite database, and all generated reports.$\r$\n$\r$\nPick 'No' to keep your data (recommended)." /SD IDNO IDNO skipData
    RMDir /r "$DESKTOP\DL-Processor"
  skipData:
!macroend
