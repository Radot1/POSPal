@echo off
:: Check for admin rights
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Please run this script as Administrator!
    pause
    exit /b
)

:: Stop and remove service
sc stop POSPalService >nul 2>&1
timeout /t 3 /nobreak >nul
sc delete POSPalService

echo Service uninstalled!
echo Note: POSPal.exe was NOT deleted for safety reasons.
pause