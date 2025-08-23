@echo off
REM ============================================================================
REM Build script for POSPal
REM Description: This script creates a new 'build_output' directory and performs
REM              the entire build process within it, keeping the root
REM              directory clean.
REM Version: 1.1.2 (Containerized Build Process)
REM ============================================================================
setlocal

set VERSION=1.1.2
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
    --add-data "..\UISelect.html;." ^
    --add-data "..\POSPal.html;." ^
    --add-data "..\POSPalDesktop.html;." ^
    --add-data "..\index.html;." ^
    --add-data "..\POSPal_Demo.html;." ^
    --add-data "..\demo_generator.html;." ^
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
        --add-data "..\UISelect.html;." ^
        --add-data "..\POSPal.html;." ^
        --add-data "..\POSPalDesktop.html;." ^
        --add-data "..\index.html;." ^
        --add-data "..\POSPal_Demo.html;." ^
        --add-data "..\demo_generator.html;." ^
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

rem Copy existing data files if they exist
if exist "..\data\menu.json" (
    copy "..\data\menu.json" "%RELEASE_DIR%\data\"
    echo [COPY] Copied existing menu.json
) else (
    echo [SETUP] No existing menu.json found. Creating a default menu.
    (
        echo {
        echo   "Appetizers": [
        echo     { "id": 1, "name": "Garlic Bread with Cheese", "price": 4.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 2, "name": "Bruschetta", "price": 5.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 3, "name": "Calamari Fritti", "price": 7.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 4, "name": "Spring Rolls", "price": 6.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 5, "name": "Onion Rings", "price": 4.00, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ],
        echo   "Soups ^& Salads": [
        echo     { "id": 10, "name": "Tomato Soup", "price": 4.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 11, "name": "Caesar Salad", "price": 8.00, "hasGeneralOptions": true, "generalOptions": [ { "name": "Add Chicken", "priceChange": 2.50 }, { "name": "Add Shrimp", "priceChange": 3.50 } ] },
        echo     { "id": 12, "name": "Greek Salad", "price": 7.50, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ],
        echo   "Main Courses": [
        echo     { "id": 20, "name": "Spaghetti Carbonara", "price": 12.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 21, "name": "Chicken Alfredo", "price": 13.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 22, "name": "Fish and Chips", "price": 14.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 23, "name": "Vegetable Lasagna", "price": 11.00, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ],
        echo   "From The Grill": [
        echo     { "id": 30, "name": "Ribeye Steak (250g)", "price": 22.50, "hasGeneralOptions": true, "generalOptions": [ { "name": "Peppercorn Sauce", "priceChange": 1.50 }, { "name": "Mushroom Sauce", "priceChange": 1.50 }, { "name": "Blue Cheese Sauce", "priceChange": 2.00 } ] },
        echo     { "id": 31, "name": "Filet Mignon (200g)", "price": 28.00, "hasGeneralOptions": true, "generalOptions": [ { "name": "Peppercorn Sauce", "priceChange": 1.50 }, { "name": "Mushroom Sauce", "priceChange": 1.50 }, { "name": "Blue Cheese Sauce", "priceChange": 2.00 } ] },
        echo     { "id": 32, "name": "Grilled Salmon", "price": 18.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 33, "name": "BBQ Ribs", "price": 17.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 34, "name": "Cheeseburger", "price": 10.50, "hasGeneralOptions": true, "generalOptions": [ { "name": "Add Bacon", "priceChange": 1.00 }, { "name": "Extra Cheese", "priceChange": 0.50 } ] }
        echo   ],
        echo   "Sides": [
        echo     { "id": 40, "name": "French Fries", "price": 3.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 41, "name": "Mashed Potatoes", "price": 3.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 42, "name": "Steamed Vegetables", "price": 4.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 43, "name": "Side Salad", "price": 3.50, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ],
        echo   "Desserts": [
        echo     { "id": 50, "name": "Chocolate Lava Cake", "price": 6.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 51, "name": "Cheesecake", "price": 5.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 52, "name": "Ice Cream", "price": 3.00, "hasGeneralOptions": true, "generalOptions": [ { "name": "Chocolate Syrup", "priceChange": 0.50 }, { "name": "Sprinkles", "priceChange": 0.25 } ] }
        echo   ],
        echo   "Beverages": [
        echo     { "id": 60, "name": "Coca-Cola", "price": 2.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 61, "name": "Sprite", "price": 2.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 62, "name": "Still Water", "price": 2.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 63, "name": "Sparkling Water", "price": 2.50, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 64, "name": "Orange Juice", "price": 3.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 65, "name": "Beer", "price": 4.00, "hasGeneralOptions": false, "generalOptions": [] },
        echo     { "id": 66, "name": "Glass of Wine", "price": 5.00, "hasGeneralOptions": false, "generalOptions": [] }
        echo   ]
        echo }
    ) > "%RELEASE_DIR%\data\menu.json"
)

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
