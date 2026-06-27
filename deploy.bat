@echo off
REM ============================================================
REM Eastern Farm — 一键部署(Windows 双击运行)
REM 双击本文件即可把当前改动部署到 farm.easternmarket.ca
REM 它只是调用同目录的 deploy.sh(用 Git 自带的 bash)。
REM ============================================================
cd /d "%~dp0"
set "BASH=%PROGRAMFILES%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%PROGRAMFILES(x86)%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=%LOCALAPPDATA%\Programs\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo 找不到 Git Bash,请确认已安装 Git for Windows。
  pause
  exit /b 1
)
"%BASH%" deploy.sh %*
echo.
pause
