<p align="center">
<img src="https://placehold.co/600x300/111827/FFFFFF?text=POSPal" alt="POSPal Banner">
</p>

<h1 align="center">POSPal - Point of Sale System</h1>

<p align="center">
A lightweight, web-based Point of Sale (POS) system designed for small restaurants and cafes. POSPal runs locally on a Windows machine and provides a fast, touch-friendly interface for taking orders and printing kitchen tickets.
<br><br>
<img src="https://img.shields.io/badge/version-1.0.5-blue" alt="Version">
<img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Platform">
</p>

✨ Features
Intuitive Interface: A clean, fast, and touch-friendly web interface for placing orders.

Menu Management: Easily add, edit, delete, and categorize items. Reorder items and categories with simple controls.

Order Customization: Add item-specific notes and universal order notes.

Dual Ticket Printing: Automatically prints two copies of each order to an ESC/POS thermal printer: one for the kitchen, one for records.

Order History & Reprinting: View today's orders and reprint any ticket on demand.

Daily Logging: All orders are automatically saved to a daily .csv file for record-keeping.

Performance Analytics: An in-depth analytics dashboard to track gross revenue, total orders, average order value, sales by category, sales by hour, and best/worst selling items.

Secure Management: Password-protected management area to access settings, analytics, and menu configuration.

Safe Shutdown: A dedicated shutdown button in the UI to safely close the server application.

Auto-Update: The application can automatically check for new releases on GitHub and update itself.

📸 Screenshot
Replace this with a screenshot of your POSPal interface in action!

📋 Requirements
OS: Windows 10 or 11

Printer: 80mm thermal receipt printer (ESC/POS compatible)

Browser: A modern web browser (like Chrome, Firefox, or Safari) on a device on the same local network (e.g., a tablet, laptop, or phone).

🚀 Installation & Usage
Download: Go to the Releases page and download the latest POSPal release.

Unzip: Unzip the downloaded file to a permanent folder on your computer (e.g., C:\POSPal).

Run: Open the new folder and double-click POSPal.exe. The application will start silently in the background. No window will appear, which is normal.

Connect: On your tablet or any other device connected to the same Wi-Fi, open a web browser and go to http://<your-server-ip>:5000.

To find your server's IP address, open Command Prompt on the Windows machine, type ipconfig, and look for the "IPv4 Address".

⚙️ Configuration
Before the first use, you must configure your printer and password.

After running POSPal.exe for the first time, a config.json file is created in the same folder.

Open this file with a text editor (like Notepad).

Change the printer_name value to the exact name of your printer as it appears in Windows' "Printers & scanners" settings.

It is highly recommended to change the default management_password to something secure.

{
    "printer_name": "Your Printer Name Here",
    "port": 5000,
    "management_password": "YourSecurePassword"
}

Save the file and restart POSPal.exe for the changes to take effect.

🛑 How to Stop the Application
You can stop the application safely from the management interface.

On the main ordering screen, click the cog icon (<i class="fas fa-cog"></i>).

Enter your management password (the default is 9999).

Inside the management panel, click the red Shutdown button in the bottom-right corner.

Alternatively, you can close it using the Windows Task Manager:

Press Ctrl + Shift + Esc to open Task Manager.

Go to the "Details" tab.

Find POSPal.exe in the list, select it, and click "End task".

📄 License
This software is proprietary and licensed, not sold. Use is governed by the End User License Agreement (EULA). See EULA.md.