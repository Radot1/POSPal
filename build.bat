@echo off
REM ============================================================================
REM Build script for POSPal
REM Description: This script creates a new 'build_output' directory and performs
REM              the entire build process within it, keeping the root
REM              directory clean.
REM Version: 1.2.2(Containerized Build Process)
REM ============================================================================
setlocal

set VERSION=1.2.2
set BUILD_DIR=build_output
set RELEASE_DIR=POSPal_v%VERSION%
set RELEASE_DIR_ONEDIR=POSPal_onedir_v%VERSION%

REM ============================================================================
REM BUILD PHILOSOPHY: Always create deployment-ready builds
REM This ensures you test exactly what customers will receive
REM
REM The build creates:
REM   - Empty menu (customers configure their own)
REM   - Fresh 30-day trial period
REM   - Clean data files (no test data)
REM   - All license system components
REM
REM For testing: Run the built POSPal.exe and add test menu items manually
REM This simulates the actual customer experience
REM ============================================================================

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
    --collect-data limits ^
    --hidden-import dotenv ^
    --hidden-import python-dotenv ^
    --hidden-import cryptography ^
    --hidden-import cryptography.fernet ^
    --hidden-import cryptography.hazmat ^
    --hidden-import cryptography.hazmat.primitives ^
    --hidden-import cryptography.hazmat.primitives.kdf ^
    --hidden-import cryptography.hazmat.primitives.kdf.pbkdf2 ^
    --hidden-import cryptography.hazmat.backends ^
    --hidden-import limits.storage.memory ^
    --hidden-import limits.strategies ^
    --hidden-import license_integration ^
    --hidden-import license_controller ^
    --hidden-import license_controller.license_controller ^
    --hidden-import license_controller.license_state ^
    --hidden-import license_controller.storage_manager ^
    --hidden-import license_controller.validation_flow ^
    --hidden-import license_controller.migration_manager ^
    --hidden-import win32api ^
    --hidden-import win32con ^
    --exclude-module asyncio.windows_events ^
    --exclude-module asyncio.windows_utils ^
    --add-data "..\license_integration.py;." ^
    --add-data "..\license_controller;license_controller" ^
    --add-data "..\hook-limits.py;." ^
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
    --add-data "..\enhanced-error-handler.js;." ^
    --add-data "..\enhanced-ux-manager.js;." ^
    --add-data "..\notification-manager.js;." ^
    --add-data "..\customer-segmentation.js;." ^
    --add-data "..\advanced-notification-intelligence.js;." ^
    --add-data "..\licensing-dashboard.js;." ^
    --add-data "..\enhanced-ux-components.css;." ^
    --add-data "..\static;static" ^
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
        --collect-data limits ^
        --hidden-import dotenv ^
        --hidden-import python-dotenv ^
        --hidden-import cryptography ^
        --hidden-import cryptography.fernet ^
        --hidden-import cryptography.hazmat ^
        --hidden-import cryptography.hazmat.primitives ^
        --hidden-import cryptography.hazmat.primitives.kdf ^
        --hidden-import cryptography.hazmat.primitives.kdf.pbkdf2 ^
        --hidden-import cryptography.hazmat.backends ^
        --hidden-import limits.storage.memory ^
        --hidden-import limits.strategies ^
        --hidden-import license_integration ^
        --hidden-import license_controller ^
        --hidden-import license_controller.license_controller ^
        --hidden-import license_controller.license_state ^
        --hidden-import license_controller.storage_manager ^
        --hidden-import license_controller.validation_flow ^
        --hidden-import license_controller.migration_manager ^
        --hidden-import win32api ^
        --hidden-import win32con ^
        --exclude-module asyncio.windows_events ^
        --exclude-module asyncio.windows_utils ^
        --add-data "..\license_integration.py;." ^
        --add-data "..\license_controller;license_controller" ^
        --add-data "..\hook-limits.py;." ^
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
        --add-data "..\enhanced-error-handler.js;." ^
        --add-data "..\enhanced-ux-manager.js;." ^
        --add-data "..\notification-manager.js;." ^
        --add-data "..\customer-segmentation.js;." ^
        --add-data "..\advanced-notification-intelligence.js;." ^
        --add-data "..\licensing-dashboard.js;." ^
        --add-data "..\enhanced-ux-components.css;." ^
        --add-data "..\static;static" ^
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

rem Create empty menu for customer configuration
echo [SETUP] Creating empty menu (customers will configure their own items)
echo {} > "%RELEASE_DIR%\data\menu.json"

rem Create fresh 30-day trial for customer with valid signature
echo [SETUP] Generating fresh 30-day trial period (with valid signature)
python ..\generate_trial.py "%RELEASE_DIR%\data\trial.json"
if %errorlevel% neq 0 (
    echo [ERROR] Failed to generate trial.json
    echo [ERROR] Working directory: %CD%
    echo [ERROR] Target file: %RELEASE_DIR%\data\trial.json
    pause
    exit /b 1
)

rem Create essential data files (clean slate for customer)
if not exist "%RELEASE_DIR%\data\current_order.json" (
    echo [SETUP] Creating current_order.json
    echo {"items": [], "total": 0} > "%RELEASE_DIR%\data\current_order.json"
)
if not exist "%RELEASE_DIR%\data\device_sessions.json" (
    echo [SETUP] Creating device_sessions.json
    echo {"sessions": []} > "%RELEASE_DIR%\data\device_sessions.json"
)
if not exist "%RELEASE_DIR%\data\order_counter.json" (
    echo [SETUP] Creating order_counter.json
    echo {"counter": 1} > "%RELEASE_DIR%\data\order_counter.json"
)
if not exist "%RELEASE_DIR%\data\order_line_counter.json" (
    echo [SETUP] Creating order_line_counter.json
    echo {"counter": 1} > "%RELEASE_DIR%\data\order_line_counter.json"
)
if not exist "%RELEASE_DIR%\data\tables_config.json" (
    echo [SETUP] Creating tables_config.json
    echo {"tables": {}, "settings": {"auto_clear_paid_tables": true, "default_table_timeout": 3600}} > "%RELEASE_DIR%\data\tables_config.json"
)
if not exist "%RELEASE_DIR%\data\usage_analytics.json" (
    echo [SETUP] Creating usage_analytics.json
    echo {"total_orders": 0, "total_revenue": 0, "first_order_date": "", "last_order_date": "", "orders_by_day": {}, "revenue_by_day": {}} > "%RELEASE_DIR%\data\usage_analytics.json"
)
if not exist "%RELEASE_DIR%\data\table_sessions.json" (
    echo [SETUP] Creating table_sessions.json
    echo {} > "%RELEASE_DIR%\data\table_sessions.json"
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

REM Remove existing release folder in root if it exists
if exist "..\%RELEASE_DIR%" (
    echo [CLEANUP] Removing existing release folder...
    REM First, remove any problematic files that might be locked
    if exist "..\%RELEASE_DIR%\nul" del /f /q "..\%RELEASE_DIR%\nul" 2>nul
    if exist "..\%RELEASE_DIR%\data\nul" del /f /q "..\%RELEASE_DIR%\data\nul" 2>nul

    REM Now remove the directory
    rd /s /q "..\%RELEASE_DIR%" 2>nul

    REM If it still exists, try with PowerShell for stubborn files
    if exist "..\%RELEASE_DIR%" (
        echo [CLEANUP] Using PowerShell for stubborn files...
        powershell -Command "Remove-Item -Path '..\%RELEASE_DIR%' -Recurse -Force -ErrorAction SilentlyContinue" 2>nul
    )

    REM Final check - if still exists, abort with helpful message
    if exist "..\%RELEASE_DIR%" (
        echo [ERROR] Could not remove existing release folder. It may be in use.
        echo [ERROR] Possible causes:
        echo [ERROR]   - POSPal.exe is currently running
        echo [ERROR]   - File Explorer is open in that folder
        echo [ERROR]   - Files are locked by another process
        echo.
        echo [FIX] Try this:
        echo   1. Close POSPal.exe if running
        echo   2. Close all File Explorer windows
        echo   3. Run: rmdir /s /q POSPal_v%VERSION%
        echo   4. Run build.bat again
        pause
        popd
        exit /b 1
    )
)

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
    if exist "..\%RELEASE_DIR_ONEDIR%" (
        echo [CLEANUP] Removing existing ONEDIR folder...
        rd /s /q "..\%RELEASE_DIR_ONEDIR%"
    )
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
echo  Your deployment-ready application is located in the folder:
echo  %RELEASE_DIR%
if defined BUILD_ONEDIR echo  An alternative ONEDIR build is also available: %RELEASE_DIR_ONEDIR%
echo.
echo  The build includes:
echo  - All essential HTML and JavaScript files
echo  - License system fully integrated (no "Integration system not available")
echo  - Empty menu (ready for customer configuration)
echo  - Fresh 30-day trial period (with valid signature - fixes printing!)
echo  - Clean data files (no test data)
echo  - Default configuration file
echo.
echo  TESTING INSTRUCTIONS:
echo  1. Run POSPal.exe from %RELEASE_DIR%\
echo  2. Manually add a few test menu items (simulates customer experience)
echo  3. Test all features (ordering, printing, license validation)
echo  4. If everything works, this exact build is ready for customers
echo ============================================================================
echo.
pause
