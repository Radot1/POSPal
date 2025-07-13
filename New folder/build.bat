@echo off
REM ============================================================================
REM Build script for POSPal
REM Description: This script creates a clean virtual environment, installs all
REM              necessary dependencies, and packages the application into a
REM              final, runnable folder.
REM Version: 1.7.0
REM ============================================================================
setlocal

set VERSION=1.0.4
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
