@echo off
REM patch-apply.cmd — bundled in the DL-Processor install at resources\patch-apply.cmd.
REM
REM Invoked by the main app when applying a patch zip. Waits for the main app
REM process to exit, swaps app.asar with the staged app.asar.pending, deletes
REM the .patch-pending marker, and relaunches DL-Processor.exe.
REM
REM Args:
REM   %1  Process ID of the main app (we wait for it to exit)
REM   %2  Path to <install-dir>\resources (where app.asar lives)
REM   %3  Path to <install-dir>\DL-Processor.exe (for relaunch)
REM
REM On failure mid-swap, restores app.asar.bak so the app stays bootable.

setlocal enableextensions

set "APP_PID=%~1"
set "RES_DIR=%~2"
set "APP_EXE=%~3"

if "%APP_PID%"=="" goto :usage
if "%RES_DIR%"=="" goto :usage
if "%APP_EXE%"=="" goto :usage

REM ---- Wait up to 10 seconds for the main app to exit ----
set "WAITED=0"
:wait_loop
tasklist /FI "PID eq %APP_PID%" 2>nul | findstr /R /C:" %APP_PID% " >nul
if errorlevel 1 goto :proceed
if %WAITED% GEQ 10 (
  echo [patch-apply] timed out waiting for PID %APP_PID% to exit
  goto :end
)
timeout /t 1 /nobreak >nul
set /a WAITED=%WAITED%+1
goto :wait_loop

:proceed
set "ASAR=%RES_DIR%\app.asar"
set "ASAR_BAK=%RES_DIR%\app.asar.bak"
set "ASAR_PENDING=%RES_DIR%\app.asar.pending"
set "MARKER=%RES_DIR%\.patch-pending"

if not exist "%ASAR_PENDING%" (
  echo [patch-apply] no pending asar at %ASAR_PENDING%; aborting
  goto :end
)

REM ---- Backup current asar ----
if exist "%ASAR_BAK%" del /q "%ASAR_BAK%"
move /y "%ASAR" "%ASAR_BAK%" >nul
if errorlevel 1 (
  echo [patch-apply] failed to back up app.asar
  goto :end
)

REM ---- Swap in pending ----
move /y "%ASAR_PENDING%" "%ASAR%" >nul
if errorlevel 1 (
  echo [patch-apply] swap failed; restoring backup
  move /y "%ASAR_BAK%" "%ASAR%" >nul
  goto :end
)

REM ---- Clean up marker ----
if exist "%MARKER%" del /q "%MARKER%"

REM ---- Relaunch ----
start "" "%APP_EXE%"
goto :end

:usage
echo Usage: patch-apply.cmd ^<pid^> ^<resources-dir^> ^<exe-path^>
exit /b 1

:end
endlocal
exit /b 0
