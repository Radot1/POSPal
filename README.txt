# POSPal - Point of Sale System

A lightweight, web-based Point of Sale (POS) system designed for small restaurants and cafes. POSPal runs locally on a Windows machine and provides a fast, touch-friendly interface for taking orders and printing kitchen tickets.

---

## 📋 Requirements

* **OS:** Windows 10 or 11
* **Printer:** 80mm thermal receipt printer (ESC/POS compatible)
* **Browser:** A modern web browser (like Chrome or Firefox) on a device on the same local network.

---

## 🚀 How to Use

1.  **Download:** Go to the [Releases page](https://github.com/Radot1/POSPal/releases), and download the latest `POSPal_vX.X.X.zip` file.

2.  **Unzip:** Unzip the downloaded file to a permanent folder on your computer (e.g., `C:\POSPal`).

3.  **Run:** Open the new folder and double-click `POSPal.exe`. A black console window will appear, which means the server is running. Keep this window open while you are using the POS.

4.  **Connect:** On your tablet or any other device connected to the same Wi-Fi, open a web browser and go to `http://<your-server-ip>:5000`.
    * *To find your server's IP address, open Command Prompt on the Windows machine and type `ipconfig`.*

---

## ⚙️ Important: Printer Setup

Before you can print orders, you must configure the printer.

1.  When you first run the app, a `config.json` file is created in the same folder as `POSPal.exe`.
2.  Open this file with a text editor.
3.  Change the `printer_name` value to the **exact name** of your printer as it appears in Windows' "Printers & scanners" settings.

    ```json
    {
        "printer_name": "Your Printer Name Here",
        "auto_update": true,
        "port": 5000
    }
    ```
4.  Save the file and restart `POSPal.exe`.

