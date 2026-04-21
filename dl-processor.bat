@echo off
cd /d "%~dp0"
chcp 65001 >nul
title DL-Processor

:: ---- Find Node.js ----
where node >nul 2>&1 && goto GOTNODE
if exist "%~dp0nodejs\node.exe"                set "PATH=%~dp0nodejs;%PATH%"                & goto GOTNODE
if exist "%USERPROFILE%\nodejs\node.exe"        set "PATH=%USERPROFILE%\nodejs;%PATH%"        & goto GOTNODE
if exist "%USERPROFILE%\Desktop\p-charter\nodejs\node.exe" set "PATH=%USERPROFILE%\Desktop\p-charter\nodejs;%PATH%" & goto GOTNODE
if exist "%PROGRAMFILES%\nodejs\node.exe"       set "PATH=%PROGRAMFILES%\nodejs;%PATH%"       & goto GOTNODE
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%" & goto GOTNODE
if exist "%PROGRAMFILES(x86)%\nodejs\node.exe"  set "PATH=%PROGRAMFILES(x86)%\nodejs;%PATH%"  & goto GOTNODE
:GOTNODE

node -v >nul 2>&1
if errorlevel 1 (
    echo.
    echo   ERROR: Node.js not found on this machine.
    echo   Install Node.js or drop a portable copy into:  %USERPROFILE%\nodejs\
    echo.
    pause
    exit /b 1
)

:: ---- First-run bootstrap ----
if not exist "node_modules" if exist "package.json" (
    echo.
    echo   First run - installing dependencies...
    echo.
    call npm install --silent
    echo   Done.
    echo.
)

:: ---- Launch interactive menu ----
node src\menu.js

exit /b 0
