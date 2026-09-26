@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "dist\server.mjs" (
  if not exist "node_modules\vite" (
    call npm ci
    if errorlevel 1 goto failed
  )
  call npm run build
  if errorlevel 1 goto failed
)
node scripts\launch.mjs
if errorlevel 1 goto failed
exit /b 0
:failed
echo.
echo GraspPortable could not start. Please keep this output for diagnosis.
pause
exit /b 1
