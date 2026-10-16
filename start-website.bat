@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_EXE="
set "NODE_VERSION="

where node >nul 2>nul
if not errorlevel 1 node --version >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo.
  echo [错误] 未检测到可用的 Node.js，网站服务无法启动。
  echo 请重新安装 Node.js，或确认内置 Node 目录存在。
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%V in ('"%NODE_EXE%" --version 2^>nul') do set "NODE_VERSION=%%V"
echo.
echo 正在启动湖北视感闪租相机库存管理...
echo Node.js 版本：%NODE_VERSION%
echo 数据将保存到：%~dp0data\state.json
echo 启动成功后浏览器会自动打开。
echo 请保留此窗口，关闭窗口或按 Ctrl+C 可停止服务。
echo.
"%NODE_EXE%" server.js --open
echo.
if errorlevel 1 (
  echo [错误] 网站服务启动失败，请将上方错误信息截图反馈。
) else (
  echo [提示] 网站服务已停止。
)
echo.
pause
