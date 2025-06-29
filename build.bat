@echo off
REM ============================================================================
REM Build script for POSPal
REM Description: This script creates a clean virtual environment, installs all
REM              necessary dependencies, and packages the application into a
REM              final, runnable folder.
REM Version: 1.6.0
REM ============================================================================
setlocal

set VERSION=1.0.1
set RELEASE_DIR=POSPal_v%VERSION%

REM --- 0. Pre-flight Check ---
echo.
echo [CHECK] Verifying Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not found in your system's PATH.
    echo [ERROR] Please install Python 3 and ensure it is added to your PATH.
    pause
    exit /b 1
)
echo [CHECK] Python found.
echo.
echo [CHECK] Verifying icon file...
if not exist "app_icon.ico" (
    echo [WARN] Icon file 'app_icon.ico' not found. The executable will be built without an icon.
) else (
    echo [CHECK] Icon file found.
)


REM --- 1. Clean Environment ---
echo.
echo [SETUP] Preparing a clean environment...
if exist "venv" rd /s /q venv
if exist "dist" rd /s /q dist
if exist "build" rd /s /q build
if exist "%RELEASE_DIR%" rd /s /q "%RELEASE_DIR%"
if exist "*.spec" del "*.spec"

echo.
echo [SETUP] Creating new virtual environment...
python -m venv venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create the virtual environment. Halting script.
    pause
    exit /b 1
)

echo [SETUP] Activating virtual environment...
call venv\Scripts\activate

REM --- 2. Install Dependencies ---
echo.
echo [DEPS] Installing dependencies from requirements.txt...
pip install -r requirements.txt >nul
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install packages from requirements.txt.
    echo [ERROR] The script cannot continue.
    pause
    exit /b 1
)
echo [SUCCESS] All dependencies installed successfully.

REM --- 3. Build Executable ---
echo.
echo [BUILD] Building the application executable (this may take a moment)...
pyinstaller ^
    --onefile ^
    --noconsole ^
    --name "POSPal" ^
    --add-data "POSPal.html;." ^
    --icon "app_icon.ico" ^
    app.py

if %errorlevel% neq 0 (
    echo [ERROR] PyInstaller failed to build the executable.
    pause
    exit /b 1
)
echo [SUCCESS] Executable built successfully.

REM --- 4. Create Final Release Package ---
echo.
echo [PACKAGE] Assembling final application folder...
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\data"
mkdir "%RELEASE_DIR%\logs"

rem Copy the executable from the temporary dist folder to the final release folder
copy "dist\POSPal.exe" "%RELEASE_DIR%\"

rem Copy essential config and data files
copy "config.json" "%RELEASE_DIR%\"
if exist "data\menu.json" (
    copy "data\menu.json" "%RELEASE_DIR%\data\"
) else (
    echo {} > "%RELEASE_DIR%\data\menu.json"
)

echo [SUCCESS] Final package created in "%RELEASE_DIR%"

REM --- 5. Final Cleanup ---
echo.
echo [CLEANUP] Removing temporary build files...
rd /s /q build
rd /s /q dist
del "POSPal.spec"

echo.
echo ============================================================================
echo  Build Complete!
echo  Your final, runnable application is located in the folder:
echo  %RELEASE_DIR%
echo ============================================================================
echo.
pause
