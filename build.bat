@echo off
REM ============================================================================
REM Build script for POSPal
REM Description: This script creates a new 'build_output' directory and performs
REM              the entire build process within it, keeping the root
REM              directory clean.
REM Version: 1.9.0 (Containerized Build Process)
REM ============================================================================
setlocal

set VERSION=1.0.5
set BUILD_DIR=build_output
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


REM --- 1. Clean and Prepare Build Directory ---
echo.
echo [SETUP] Preparing a clean build environment...
if exist "%BUILD_DIR%" rd /s /q "%BUILD_DIR%"
mkdir "%BUILD_DIR%"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create the build directory. Halting script.
    pause
    exit /b 1
)

REM Change into the build directory to keep the root clean
pushd "%BUILD_DIR%"

echo.
echo [SETUP] Creating new virtual environment inside '%BUILD_DIR%'...
python -m venv venv
if %errorlevel% neq 0 (
    echo [ERROR] Failed to create the virtual environment. Halting script.
    pause
    popd
    exit /b 1
)

echo [SETUP] Activating virtual environment...
call venv\Scripts\activate

REM --- 2. Install Dependencies ---
echo.
echo [DEPS] Installing dependencies from requirements.txt...
REM Use ..\ to reference requirements.txt from the parent (root) directory
pip install -r ..\requirements.txt >nul
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install packages from requirements.txt.
    echo [ERROR] The script cannot continue.
    pause
    popd
    exit /b 1
)
echo [SUCCESS] All dependencies installed successfully.

REM --- 3. Build Executable ---
echo.
echo [BUILD] Building the application executable (this may take a moment)...
REM Use ..\ to reference source files from the parent (root) directory
pyinstaller ^
    --onefile ^
    --noconsole ^
    --name "POSPal" ^
    --add-data "..\index.html;." ^
    --add-data "..\POSPal.html;." ^
    --add-data "..\sushaki.html;." ^
    --add-data "..\pospal-core.js;." ^
    --icon "..\app_icon.ico" ^
    ..\app.py

if %errorlevel% neq 0 (
    echo [ERROR] PyInstaller failed to build the executable.
    pause
    popd
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

rem Copy essential config and data files from the parent (root) directory
copy "..\config.json" "%RELEASE_DIR%\"
if exist "..\data\menu.json" (
    copy "..\data\menu.json" "%RELEASE_DIR%\data\"
) else (
    echo [SETUP] No existing menu.json found. Creating a default menu.
    (
        echo {
        echo   "Appetizers": [
        echo     { "id": 1, "name": "Garlic Bread with Cheese", "price": 4.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 2, "name": "Bruschetta", "price": 5.00, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ],
        echo   "Main Courses": [
        echo     { "id": 21, "name": "Chicken Alfredo", "price": 13.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 22, "name": "Fish and Chips", "price": 14.00, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ],
        echo   "From The Grill": [
        echo     { "id": 30, "name": "Ribeye Steak (250g)", "price": 22.50, "hasGeneralOptions": true, "generalOptions": [ { "name": "Peppercorn Sauce", "priceChange": 1.50 }, { "name": "Mushroom Sauce", "priceChange": 1.50 } ] }
        echo   ],
        echo   "Beverages": [
        echo     { "id": 60, "name": "Coca-Cola", "price": 2.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 61, "name": "Sprite", "price": 2.50, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ]
        echo }
    ) > "%RELEASE_DIR%\data\menu.json"
)

echo [SUCCESS] Final package created in "%RELEASE_DIR%"

REM --- 5. Final Cleanup (within the build directory) ---
echo.
echo [CLEANUP] Removing temporary build files...
rd /s /q build
rd /s /q dist
del "POSPal.spec"

REM Return to the original directory
popd

echo.
echo ============================================================================
echo  Build Complete!
echo  Your final, runnable application is located in the folder:
echo  %BUILD_DIR%\%RELEASE_DIR%
echo ============================================================================
echo.
pause
