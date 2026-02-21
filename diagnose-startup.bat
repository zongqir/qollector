@echo off
echo ========================================
echo PasteHarbor Startup Diagnostics
echo ========================================
echo.

echo [%time%] Starting Vite dev server...
start /B npm run dev > vite-startup.log 2>&1

echo Waiting for Vite to be ready...
timeout /t 5 /nobreak > nul

echo.
echo [%time%] Checking if Vite is responding...
curl -s http://localhost:5173 > nul
if %errorlevel% equ 0 (
    echo [OK] Vite is ready
) else (
    echo [ERROR] Vite is not responding
    echo Check vite-startup.log for details
    type vite-startup.log
    exit /b 1
)

echo.
echo [%time%] Starting Tauri app...
echo Watch for these timestamps:
echo   - [Startup:setup] setup_complete
echo   - [Startup:frontend] main.jsx executing
echo   - [Startup:frontend] window shown
echo.

npm run tauri dev
