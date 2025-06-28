@echo off
:: Check for admin rights
NET SESSION >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo Please run this script as Administrator!
    pause
    exit /b
)

:: Install service
sc create POSPalService binPath= "%cd%\POSPal.exe" start= auto DisplayName= "POSPal Service"
sc description POSPalService "POSPal Restaurant Order System"
sc config POSPalService start= delayed-auto
sc failure POSPalService reset= 86400 actions= restart/60000/restart/60000/restart/60000
sc start POSPalService

echo Service installed and started!
echo You can manage it via:
echo - services.msc
echo - "sc stop POSPalService"
echo - "sc start POSPalService"
pause