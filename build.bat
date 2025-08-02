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
    --add-data "..\UISelect.html;." ^
    --add-data "..\POSPal.html;." ^
    --add-data "..\POSPalDesktop.html;." ^
    --add-data "..\index.html;." ^
    --add-data "..\POSPal_Demo.html;." ^
    --add-data "..\demo_generator.html;." ^
    --add-data "..\managementComponent.html;." ^
    --add-data "..\managementComponent.js;." ^
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

REM --- 4. Create Final Release Package ---
echo.
echo [PACKAGE] Assembling final application folder...
mkdir "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\data"
mkdir "%RELEASE_DIR%\logs"

rem Copy the executable from the temporary dist folder to the final release folder
copy "dist\POSPal.exe" "%RELEASE_DIR%\"

rem Copy essential config and data files from the parent (root) directory
if exist "..\config.json" (
    copy "..\config.json" "%RELEASE_DIR%\"
) else (
    echo [SETUP] No config.json found. Creating default config.
    (
        echo {
        echo     "printer_name": "POSPalPDFTest",
        echo     "auto_update": false,
        echo     "port": 5000,
        echo     "management_password": "9999"
        echo }
    ) > "%RELEASE_DIR%\config.json"
)
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

REM --- 5. Generate Dummy Data for Management Modal ---
echo.
echo [SETUP] Generating dummy data for management modal functionality...
call venv\Scripts\python.exe -c "
import csv
import json
import random
from datetime import datetime, timedelta
import os

# Create data directory if it doesn't exist
data_dir = '%RELEASE_DIR%\\data'
os.makedirs(data_dir, exist_ok=True)

# Generate today's date
today = datetime.now()
today_str = today.strftime('%Y-%m-%d')

# Sample menu items for generating orders
menu_items = [
    {'name': 'Garlic Bread with Cheese', 'price': 4.50},
    {'name': 'Bruschetta', 'price': 5.00},
    {'name': 'Chicken Alfredo', 'price': 13.50},
    {'name': 'Fish and Chips', 'price': 14.00},
    {'name': 'Ribeye Steak (250g)', 'price': 22.50},
    {'name': 'Coca-Cola', 'price': 2.50},
    {'name': 'Sprite', 'price': 2.50},
    {'name': 'House Red Wine', 'price': 7.00},
    {'name': 'Craft Beer', 'price': 6.50},
    {'name': 'Caesar Salad', 'price': 8.50},
    {'name': 'Tiramisu', 'price': 6.00},
    {'name': 'Chocolate Cake', 'price': 5.50}
]

# Generate orders for today
orders_file = os.path.join(data_dir, f'orders_{today_str}.csv')
fieldnames = ['order_number', 'table_number', 'timestamp', 'items_summary', 
              'universal_comment', 'order_total', 'payment_method', 'printed_status', 'items_json']

with open(orders_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    
    # Generate 15-25 orders for today
    num_orders = random.randint(15, 25)
    
    for order_num in range(1, num_orders + 1):
        # Generate random time between 11:00 AM and 10:00 PM
        hour = random.randint(11, 22)
        minute = random.randint(0, 59)
        order_time = today.replace(hour=hour, minute=minute, second=random.randint(0, 59))
        
        # Generate 1-4 items per order
        num_items = random.randint(1, 4)
        order_items = []
        items_summary_parts = []
        order_total = 0
        
        for _ in range(num_items):
            item = random.choice(menu_items)
            quantity = random.randint(1, 3)
            item_total = item['price'] * quantity
            
            order_items.append({
                'name': item['name'],
                'quantity': quantity,
                'basePrice': item['price'],
                'itemPriceWithModifiers': item['price'],
                'comment': '',
                'generalSelectedOptions': []
            })
            
            items_summary_parts.append(f'{quantity}x {item["name"]} [Unit EUR {item["price"]:.2f}]')
            order_total += item_total
        
        # Add some orders with options (for steak)
        if any('Steak' in item['name'] for item in order_items):
            steak_items = [item for item in order_items if 'Steak' in item['name']]
            for steak_item in steak_items:
                if random.random() < 0.7:  # 70% chance of adding sauce
                    sauce = random.choice(['Peppercorn Sauce', 'Mushroom Sauce'])
                    sauce_price = 1.50
                    steak_item['generalSelectedOptions'].append({
                        'name': sauce,
                        'priceChange': sauce_price
                    })
                    steak_item['itemPriceWithModifiers'] += sauce_price
                    order_total += sauce_price
                    items_summary_parts.append(f'  - {sauce} (+EUR {sauce_price:.2f})')
        
        # Random payment method
        payment_method = random.choice(['Cash', 'Card'])
        
        # Random table number
        table_number = str(random.randint(1, 12))
        
        # Random universal comment (20% chance)
        universal_comment = ''
        if random.random() < 0.2:
            comments = ['Extra napkins please', 'No onions', 'Allergic to nuts', 'Birthday celebration', 'Anniversary']
            universal_comment = random.choice(comments)
        
        writer.writerow({
            'order_number': str(order_num),
            'table_number': table_number,
            'timestamp': order_time.strftime('%Y-%m-%d %H:%M:%S'),
            'items_summary': ' | '.join(items_summary_parts),
            'universal_comment': universal_comment,
            'order_total': f'{order_total:.2f}',
            'payment_method': payment_method,
            'printed_status': 'Printed',
            'items_json': json.dumps(order_items)
        })

# Generate orders for yesterday (for week/month analytics)
yesterday = today - timedelta(days=1)
yesterday_str = yesterday.strftime('%Y-%m-%d')
yesterday_orders_file = os.path.join(data_dir, f'orders_{yesterday_str}.csv')

with open(yesterday_orders_file, 'w', newline='', encoding='utf-8') as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    
    # Generate 10-20 orders for yesterday
    num_orders = random.randint(10, 20)
    
    for order_num in range(1, num_orders + 1):
        hour = random.randint(11, 22)
        minute = random.randint(0, 59)
        order_time = yesterday.replace(hour=hour, minute=minute, second=random.randint(0, 59))
        
        num_items = random.randint(1, 3)
        order_items = []
        items_summary_parts = []
        order_total = 0
        
        for _ in range(num_items):
            item = random.choice(menu_items)
            quantity = random.randint(1, 2)
            item_total = item['price'] * quantity
            
            order_items.append({
                'name': item['name'],
                'quantity': quantity,
                'basePrice': item['price'],
                'itemPriceWithModifiers': item['price'],
                'comment': '',
                'generalSelectedOptions': []
            })
            
            items_summary_parts.append(f'{quantity}x {item["name"]} [Unit EUR {item["price"]:.2f}]')
            order_total += item_total
        
        payment_method = random.choice(['Cash', 'Card'])
        table_number = str(random.randint(1, 12))
        
        writer.writerow({
            'order_number': str(order_num),
            'table_number': table_number,
            'timestamp': order_time.strftime('%Y-%m-%d %H:%M:%S'),
            'items_summary': ' | '.join(items_summary_parts),
            'universal_comment': '',
            'order_total': f'{order_total:.2f}',
            'payment_method': payment_method,
            'printed_status': 'Printed',
            'items_json': json.dumps(order_items)
        })

# Generate orders for last week (for month analytics)
for days_ago in range(2, 8):
    past_date = today - timedelta(days=days_ago)
    past_date_str = past_date.strftime('%Y-%m-%d')
    past_orders_file = os.path.join(data_dir, f'orders_{past_date_str}.csv')
    
    with open(past_orders_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        # Generate 5-15 orders for each past day
        num_orders = random.randint(5, 15)
        
        for order_num in range(1, num_orders + 1):
            hour = random.randint(11, 22)
            minute = random.randint(0, 59)
            order_time = past_date.replace(hour=hour, minute=minute, second=random.randint(0, 59))
            
            num_items = random.randint(1, 3)
            order_items = []
            items_summary_parts = []
            order_total = 0
            
            for _ in range(num_items):
                item = random.choice(menu_items)
                quantity = random.randint(1, 2)
                item_total = item['price'] * quantity
                
                order_items.append({
                    'name': item['name'],
                    'quantity': quantity,
                    'basePrice': item['price'],
                    'itemPriceWithModifiers': item['price'],
                    'comment': '',
                    'generalSelectedOptions': []
                })
                
                items_summary_parts.append(f'{quantity}x {item["name"]} [Unit EUR {item["price"]:.2f}]')
                order_total += item_total
            
            payment_method = random.choice(['Cash', 'Card'])
            table_number = str(random.randint(1, 12))
            
            writer.writerow({
                'order_number': str(order_num),
                'table_number': table_number,
                'timestamp': order_time.strftime('%Y-%m-%d %H:%M:%S'),
                'items_summary': ' | '.join(items_summary_parts),
                'universal_comment': '',
                'order_total': f'{order_total:.2f}',
                'payment_method': payment_method,
                'printed_status': 'Printed',
                'items_json': json.dumps(order_items)
            })

print(f'Generated dummy data for management modal functionality:')
print(f'- Today: {num_orders} orders')
print(f'- Yesterday: {num_orders} orders') 
print(f'- Past week: 6 additional days with orders')
print(f'- All data saved to {data_dir}')
"

echo [SUCCESS] Dummy data generated successfully.

REM --- 6. Final Cleanup (within the build directory) ---
echo.
echo [CLEANUP] Removing temporary build files...
if exist "build" rd /s /q build
if exist "dist" rd /s /q dist
if exist "POSPal.spec" del "POSPal.spec"

REM Return to the original directory
popd

echo.
echo ============================================================================
echo  Build Complete!
echo  Your final, runnable application is located in the folder:
echo  %BUILD_DIR%\%RELEASE_DIR%
echo.
echo  The application now includes dummy data for:
echo  - Order history and reprinting functionality
echo  - Analytics dashboard with sample sales data
echo  - Management modal with functional tabs
echo  - Sample menu items and categories
echo ============================================================================
echo.
pause
