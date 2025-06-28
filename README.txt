# POSPal: Your Friendly Restaurant Point of Sale System

POSPal is a user-friendly restaurant Point of Sale (POS) system featuring a Python (Flask) backend and a web-based frontend. It streamlines order taking, offers integrated menu management, and ensures reliable kitchen ticket printing with active printer status checks. Designed for efficient daily operations with local JSON/CSV data storage.

**Important:** This application is designed to run on **Windows** due to its use of the `win32print` library for direct printer communication.

## Prerequisites

Before you begin, ensure you have the following installed:

* **Python:** Version 3.7 or higher.
* **pip:** Python package installer (usually comes with Python).
* **Windows Operating System:** Required for `pywin32` and `win32print` functionality.
* **ESC/POS Compatible Printer:** An 80mm (or similar) thermal receipt printer compatible with ESC/POS commands, installed and configured in your Windows system.

## Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone <your-repository-url>
    cd POSPal # Or your repository's directory name
    ```

2.  **Create and Activate a Virtual Environment (Recommended):**
    ```bash
    python -m venv venv
    # On Windows
    .\venv\Scripts\activate
    # On macOS/Linux (though app is Windows-specific for printing)
    # source venv/bin/activate
    ```

3.  **Install Dependencies:**
    Install the required Python packages using pip:
    ```bash
    pip install Flask pywin32
    ```

4.  **Configure the Printer Name:**
    * Open the `app.py` file in a text editor.
    * Locate the line `PRINTER_NAME = "80mm Series Printer"`.
    * Change `"80mm Series Printer"` to the exact name of your POS printer as it appears in your Windows printer settings. This step is crucial for printing to work.

    Example:
    If your printer is named "My POS Printer" in Windows, change the line to:
    ```python
    PRINTER_NAME = "My POS Printer"
    ```

5.  **Data Directory:**
    The application will automatically create a `data/` directory in its root folder when it first runs if it doesn't exist. This directory will store:
    * `menu.json`: Stores your restaurant's menu and categories.
    * `order_counter.json`: Keeps track of the daily order number.
    * `orders_YYYY-MM-DD.csv`: Daily logs of completed orders.

## Running the Application

1.  **Ensure your virtual environment is activated** (if you created one).
2.  **Navigate to the application's root directory** in your terminal.
3.  **Run the Flask backend server:**
    ```bash
    python app.py
    ```
    You should see output indicating the server is running, typically on `http://0.0.0.0:5000/` or `http://127.0.0.1:5000/`.

4.  **Access the Frontend:**
    Open your web browser and go to `http://localhost:5000`.

5.  **Initial Menu Setup:**
    * On first run, the `menu.json` file will be empty (or created as empty if it didn't exist).
    * Use the "Settings" (cog icon) in the application to access the Management interface.
    * Add your categories and menu items. This data will be saved to `data/menu.json`.

## Using POSPal

* **Categories & Items:** Select categories from the dropdown and click on items to add them to the order.
* **Item Options:** If an item has options, a modal will appear for selection.
* **Quantity:** Adjust quantities using the `+`/`-` buttons or click the quantity number to use a numpad.
* **Notes:** Add notes to individual items or a universal note for the entire order.
* **Table Number:** Enter the table number at the top right. This is required to send an order.
* **Send Order:** Once the order is complete and a table number is set, click "Send Order". This will attempt to print a kitchen ticket and log the order to a CSV file.
* **New Order:** Clears the current order details from the screen.
* **Management (Settings Icon):**
    * **Manage Items:** Add new items (name, price, category, options) or edit/delete existing ones.
    * **Manage Categories:** Add or delete categories.

## File Structure Overview