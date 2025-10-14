@echo off
REM ============================================================================
REM Build script for POSPal
REM Description: This script creates a new 'build_output' directory and performs
REM              the entire build process within it, keeping the root
REM              directory clean.
REM Version: 1.2.1 (Containerized Build Process)
REM ============================================================================
setlocal

set VERSION=1.2.1
set BUILD_DIR=build_output
set RELEASE_DIR=POSPal_v%VERSION%
set RELEASE_DIR_ONEDIR=POSPal_onedir_v%VERSION%

REM Optional toggles (set before running script or here)
REM set BUILD_ONEDIR=1
REM For optional code signing, set env vars before running:
REM   SIGNING_PFX=absolute_path_to_certificate.pfx
REM   SIGNING_PFX_PASSWORD=your_password
REM   SIGNING_TIMESTAMP_URL=http://timestamp.sectigo.com

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
echo [CHECK] Verifying essential files...
if not exist "app.py" (
    echo [ERROR] app.py not found. Cannot build without main application file.
    pause
    exit /b 1
)
if not exist "pospalCore.js" (
    echo [ERROR] pospalCore.js not found. Cannot build without core JavaScript.
    pause
    exit /b 1
)
if not exist "POSPal.html" (
    echo [ERROR] POSPal.html not found. Cannot build without main HTML interface.
    pause
    exit /b 1
)
if not exist "POSPalDesktop.html" (
    echo [ERROR] POSPalDesktop.html not found. Cannot build without desktop HTML interface.
    pause
    exit /b 1
)
if not exist "requirements.txt" (
    echo [ERROR] requirements.txt not found. Cannot install dependencies.
    pause
    exit /b 1
)
echo [CHECK] All essential files found.
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
pip install -r ..\requirements.txt
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
    --clean ^
    --noupx ^
    --hidden-import dotenv ^
    --hidden-import python-dotenv ^
    --hidden-import cryptography ^
    --hidden-import cryptography.fernet ^
    --hidden-import cryptography.hazmat ^
    --hidden-import cryptography.hazmat.primitives ^
    --hidden-import cryptography.hazmat.primitives.kdf ^
    --hidden-import cryptography.hazmat.primitives.kdf.pbkdf2 ^
    --hidden-import cryptography.hazmat.backends ^
    --add-data "..\UISelect.html;." ^
    --add-data "..\POSPal.html;." ^
    --add-data "..\POSPalDesktop.html;." ^
    --add-data "..\POSPal_Demo.html;." ^
    --add-data "..\demo_generator.html;." ^
    --add-data "..\customer-portal.html;." ^
    --add-data "..\account.html;." ^
    --add-data "..\managementComponent.html;." ^
    --add-data "..\managementComponent.js;." ^
    --add-data "..\i18n.js;." ^
    --add-data "..\locales;locales" ^
    --add-data "..\pospalCore.js;." ^
    --icon "..\app_icon.ico" ^
    ..\app.py

if %errorlevel% neq 0 (
    echo [ERROR] PyInstaller failed to build the executable.
    pause
    popd
    exit /b 1
)
echo [SUCCESS] Executable built successfully.

REM --- 3b. Optionally build a 'onedir' variant (often fewer AV false positives) ---
if defined BUILD_ONEDIR (
    echo.
    echo [BUILD] Building ONEDIR variant...
    pyinstaller ^
        --onedir ^
        --noconsole ^
        --name "POSPal" ^
        --clean ^
        --noupx ^
        --hidden-import dotenv ^
    --hidden-import python-dotenv ^
    --hidden-import cryptography ^
    --hidden-import cryptography.fernet ^
    --hidden-import cryptography.hazmat ^
    --hidden-import cryptography.hazmat.primitives ^
    --hidden-import cryptography.hazmat.primitives.kdf ^
    --hidden-import cryptography.hazmat.primitives.kdf.pbkdf2 ^
    --hidden-import cryptography.hazmat.backends ^
        --add-data "..\UISelect.html;." ^
        --add-data "..\POSPal.html;." ^
        --add-data "..\POSPalDesktop.html;." ^
        --add-data "..\POSPal_Demo.html;." ^
        --add-data "..\demo_generator.html;." ^
            --add-data "..\customer-portal.html;." ^
        --add-data "..\account.html;." ^
        --add-data "..\managementComponent.html;." ^
        --add-data "..\managementComponent.js;." ^
        --add-data "..\i18n.js;." ^
        --add-data "..\locales;locales" ^
        --add-data "..\pospalCore.js;." ^
        --icon "..\app_icon.ico" ^
        ..\app.py
    if %errorlevel% neq 0 (
        echo [ERROR] PyInstaller failed to build the ONEDIR variant.
        pause
        popd
        exit /b 1
    )
    echo [SUCCESS] ONEDIR variant built successfully.
)

REM --- 4. Create Final Release Package ---
echo.
echo [PACKAGE] Assembling final application folder...
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\data"

rem Copy the executable from the temporary dist folder to the final release folder
copy "dist\POSPal.exe" "%RELEASE_DIR%\"

rem Ensure data directory exists in release
if not exist "%RELEASE_DIR%\data" mkdir "%RELEASE_DIR%\data"

rem Move/copy config.json into data folder
if exist "..\data\config.json" (
    copy "..\data\config.json" "%RELEASE_DIR%\data\"
) else if exist "..\config.json" (
    echo [MIGRATE] Found legacy config.json in root. Moving into data folder.
    copy "..\config.json" "%RELEASE_DIR%\data\config.json"
) else (
    echo [SETUP] No config.json found. Creating default config.
    (
        echo {
        echo     "printer_name": "Microsoft Print to PDF",
        echo     "port": 5000,
        echo     "management_password": "9999"
        echo }
    ) > "%RELEASE_DIR%\data\config.json"
)

rem For deployment builds, always create an empty menu (comment out to include existing menu)
echo [SETUP] Creating empty menu for deployment build.
echo {} > "%RELEASE_DIR%\data\menu.json"

rem Copy existing data files if they exist (DISABLED FOR DEPLOYMENT)
rem if exist "..\data\menu.json" (
rem     copy "..\data\menu.json" "%RELEASE_DIR%\data\"
rem     echo [COPY] Copied existing menu.json
rem ) else (
rem     echo [SETUP] No existing menu.json found. Creating an empty menu.
rem     echo {} > "%RELEASE_DIR%\data\menu.json"
rem )

rem Copy other existing data files
if exist "..\data\trial.json" (
    copy "..\data\trial.json" "%RELEASE_DIR%\data\"
    echo [COPY] Copied existing trial.json
)
if exist "..\data\current_order.json" (
    copy "..\data\current_order.json" "%RELEASE_DIR%\data\"
    echo [COPY] Copied existing current_order.json
)
if exist "..\data\device_sessions.json" (
    copy "..\data\device_sessions.json" "%RELEASE_DIR%\data\"
    echo [COPY] Copied existing device_sessions.json
)

rem Create essential files if they don't exist
if not exist "%RELEASE_DIR%\data\trial.json" (
    echo [SETUP] Creating trial.json
    echo {"trial_active": true, "days_remaining": 30} > "%RELEASE_DIR%\data\trial.json"
)
if not exist "%RELEASE_DIR%\data\current_order.json" (
    echo [SETUP] Creating current_order.json
    echo {"items": [], "total": 0} > "%RELEASE_DIR%\data\current_order.json"
)
if not exist "%RELEASE_DIR%\data\device_sessions.json" (
    echo [SETUP] Creating device_sessions.json
    echo {"sessions": []} > "%RELEASE_DIR%\data\device_sessions.json"
)

echo [SUCCESS] Final package created in "%RELEASE_DIR%"

REM If ONEDIR was built, package it as well
if defined BUILD_ONEDIR (
    echo.
    echo [PACKAGE] Assembling ONEDIR package...
    mkdir "%RELEASE_DIR_ONEDIR%"
    xcopy /e /i /y "dist\POSPal\" "%RELEASE_DIR_ONEDIR%\" >nul
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to copy ONEDIR files.
        pause
        popd
        exit /b 1
    )
    echo [SUCCESS] ONEDIR package created in "%RELEASE_DIR_ONEDIR%"
)

REM --- 5. Final Cleanup and Move to Root ---
echo.
echo [CLEANUP] Moving final release to root and cleaning up...
REM Move the final release folder to the root directory
move "%RELEASE_DIR%" "..\"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to move release folder to root directory.
    pause
    popd
    exit /b 1
)

REM Move ONEDIR release if present
if defined BUILD_ONEDIR (
    move "%RELEASE_DIR_ONEDIR%" "..\" >nul
)

REM Remove all temporary build files and folders
if exist "build" rd /s /q build
if exist "dist" rd /s /q dist
if exist "venv" rd /s /q venv
if exist "POSPal.spec" del "POSPal.spec"

REM Return to the original directory
popd

REM Remove the now-empty build_output directory
if exist "%BUILD_DIR%" rd /s /q "%BUILD_DIR%"

echo.
echo ============================================================================
echo  Build Complete!
echo  Your final, runnable application is located in the folder:
echo  %RELEASE_DIR%
if defined BUILD_ONEDIR echo  An alternative ONEDIR build is also available: %RELEASE_DIR_ONEDIR%
echo.
echo  The application includes:
echo  - All essential HTML and JavaScript files
echo  - Default menu with sample items
echo  - Configuration file
echo  - Trial and session management files
echo ============================================================================
echo.
pause
