CURRENT_VERSION = "1.0.6"  # Update this with each release

from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timedelta
import csv
import os
import win32print  # type: ignore
import time
import json
import requests
import threading
import uuid
import hashlib
import logging
import sys
from collections import Counter, defaultdict

# --- NEW: Import for Windows Registry access ---
if sys.platform == 'win32':
    import winreg

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s')

# --- CORRECTED File Paths ---
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    
DATA_DIR = os.path.join(BASE_DIR, 'data')

TRIAL_INFO_FILE = os.path.join(DATA_DIR, 'trial.json')
LICENSE_FILE = os.path.join(BASE_DIR, 'license.key')
APP_SECRET_KEY = 762378  # Use a strong secret key

# --- NEW: Registry constants for trial anchoring ---
REGISTRY_PATH = r"SOFTWARE\POSPal"
REGISTRY_VALUE_NAME = "InstallDate"

MENU_FILE = os.path.join(DATA_DIR, 'menu.json')
ORDER_COUNTER_FILE = os.path.join(DATA_DIR, 'order_counter.json')
ORDER_COUNTER_LOCK_FILE = os.path.join(DATA_DIR, 'order_counter.lock')
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')

# --- ESC/POS Commands ---
ESC = b'\x1B'
GS = b'\x1D'
InitializePrinter = ESC + b'@'
BoldOn = ESC + b'E\x01'
BoldOff = b'E\x00'
DoubleHeightWidth = GS + b'!\x11'
DoubleHeight = GS + b'!\x01'
DoubleWidth = GS + b'!\x10'
NormalText = GS + b'!\x00'
AlignLeft = ESC + b'a\x00'
AlignCenter = ESC + b'a\x01'
AlignRight = ESC + b'a\x02'
SelectFontA = ESC + b'M\x00'
SelectFontB = ESC + b'M\x01'
FullCut = GS + b'V\x00'
PartialCut = GS + b'V\x01'

os.makedirs(DATA_DIR, exist_ok=True)

def load_config():
    os.makedirs(DATA_DIR, exist_ok=True)
    defaults = {
        "printer_name": "80mm Series Printer",
        "auto_update": True,
        "port": 5000,
        "management_password": "9999"
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                config_from_file = json.load(f)
                defaults.update(config_from_file)
        except json.JSONDecodeError:
            app.logger.error(f"Error decoding {CONFIG_FILE}. Using default values.")
    return defaults

config = load_config()
PRINTER_NAME = config["printer_name"]
MANAGEMENT_PASSWORD = str(config["management_password"])

app.config['DEBUG'] = False

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)

def to_bytes(s, encoding='cp437'):
    if isinstance(s, bytes):
        return s
    return s.encode(encoding, errors='replace')

# --- NEW: Helper functions to interact with the Windows Registry ---
def get_registry_first_run_date():
    """Reads the install date from the Windows Registry."""
    if sys.platform != 'win32':
        return None
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, REGISTRY_PATH, 0, winreg.KEY_READ)
        value, _ = winreg.QueryValueEx(key, REGISTRY_VALUE_NAME)
        winreg.CloseKey(key)
        return value
    except FileNotFoundError:
        app.logger.info("Registry key not found. This is likely a true first run.")
        return None
    except Exception as e:
        app.logger.error(f"Error reading from registry: {e}")
        return None

def set_registry_first_run_date(date_str):
    """Writes the install date to the Windows Registry."""
    if sys.platform != 'win32':
        return False
    try:
        # CreateKey will open the key if it exists or create it if it doesn't
        key = winreg.CreateKey(winreg.HKEY_LOCAL_MACHINE, REGISTRY_PATH)
        winreg.SetValueEx(key, REGISTRY_VALUE_NAME, 0, winreg.REG_SZ, date_str)
        winreg.CloseKey(key)
        app.logger.info(f"Successfully wrote install date '{date_str}' to registry.")
        return True
    except PermissionError:
        app.logger.critical("CRITICAL: Permission denied to write to HKEY_LOCAL_MACHINE. Trial system will not be secure.")
        # In a real app, you might want to alert the user they need to run as admin once.
        return False
    except Exception as e:
        app.logger.error(f"Error writing to registry: {e}")
        return False

# --- MODIFIED: Trial initialization now uses the registry as an anchor ---
def initialize_trial():
    """
    Initializes the trial period, using the Windows Registry as the source of truth
    to prevent tampering by deleting the trial.json file.
    """
    authoritative_first_run_date = get_registry_first_run_date()

    if authoritative_first_run_date is None:
        # This is a true first run.
        app.logger.info("No registry entry found. Performing first-time trial initialization.")
        authoritative_first_run_date = datetime.now().strftime("%Y-%m-%d")
        
        # Attempt to write to registry. If it fails, the trial won't be secure, but the app can still run.
        set_registry_first_run_date(authoritative_first_run_date)
    else:
        # Registry entry exists. This is the authoritative date.
        app.logger.info(f"Found authoritative install date in registry: {authoritative_first_run_date}. Verifying trial file.")

    # At this point, we have the authoritative date. Ensure trial.json exists and matches.
    signature_data = f"{authoritative_first_run_date}{APP_SECRET_KEY}".encode()
    signature = hashlib.sha256(signature_data).hexdigest()
    
    trial_data_to_write = {
        "first_run_date": authoritative_first_run_date,
        "signature": signature
    }

    # Check if trial.json is missing or tampered with. If so, recreate it.
    recreate_file = True
    if os.path.exists(TRIAL_INFO_FILE):
        try:
            with open(TRIAL_INFO_FILE, 'r') as f:
                current_trial_data = json.load(f)
            if current_trial_data == trial_data_to_write:
                recreate_file = False
        except (json.JSONDecodeError, KeyError):
            # File is corrupt or malformed, so we'll recreate it.
            app.logger.warning("Trial file is corrupt. Recreating from authoritative source.")
            recreate_file = True

    if recreate_file:
        try:
            with open(TRIAL_INFO_FILE, 'w') as f:
                json.dump(trial_data_to_write, f)
            app.logger.info("Wrote/recreated trial.json based on authoritative date.")
        except Exception as e:
            app.logger.error(f"Error creating trial file: {e}")


def word_wrap_text(text, max_width, initial_indent="", subsequent_indent=""):
    lines = []
    if not text: return lines
    
    paragraphs = text.split('\n')
    
    for i, paragraph_text in enumerate(paragraphs):
        if not paragraph_text.strip() and i < len(paragraphs) -1 : 
            lines.append(initial_indent if not lines else subsequent_indent) 
            continue

        current_line = []
        current_length = 0
        words = paragraph_text.split(' ')
        
        current_indent = initial_indent if not lines and not any(lines) else subsequent_indent
        
        for word_idx, word in enumerate(words):
            if not word: 
                if current_line: current_line.append("") 
                continue

            available_width_for_word = max_width - len(current_indent) - current_length - (1 if current_line else 0)
            if len(word) > available_width_for_word and not current_line : 
                part_fits = word[:available_width_for_word]
                remaining_part = word[available_width_for_word:]
                lines.append(current_indent + part_fits)
                
                while remaining_part:
                    available_width_for_remaining = max_width - len(subsequent_indent)
                    part_fits = remaining_part[:available_width_for_remaining]
                    remaining_part = remaining_part[available_width_for_remaining:]
                    lines.append(subsequent_indent + part_fits)
                current_line = []
                current_length = 0
                current_indent = subsequent_indent 
                continue

            if current_length + len(word) + (1 if current_line else 0) <= (max_width - len(current_indent)):
                current_line.append(word)
                current_length += len(word) + (1 if len(current_line) > 1 else 0) 
            else:
                if current_line: 
                    lines.append(current_indent + " ".join(current_line))
                
                current_line = [word]
                current_length = len(word)
                current_indent = subsequent_indent 
        
        if current_line: 
            lines.append(current_indent + " ".join(current_line))
            
    return lines if lines else [initial_indent]


def get_next_daily_order_number():
    lock_acquired = False
    for _ in range(10): 
        try:
            fd = os.open(ORDER_COUNTER_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.close(fd) 
            lock_acquired = True
            break
        except FileExistsError:
            time.sleep(0.1) 
        except Exception as e_lock_create:
            app.logger.error(f"Error creating lock file: {e_lock_create}")
            time.sleep(0.1)

    if not lock_acquired:
        app.logger.critical(f"CRITICAL LOCK FAILURE: {datetime.now()} - Could not acquire lock for order counter.")
        raise Exception("System busy. Could not acquire lock for order counter. Please try again shortly.")

    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        today_str = datetime.now().strftime("%Y-%m-%d")
        current_counter_val = 0

        if os.path.exists(ORDER_COUNTER_FILE):
            try:
                with open(ORDER_COUNTER_FILE, 'r') as f:
                    data_from_file = json.load(f)
                    if data_from_file.get('date') == today_str:
                        current_counter_val = data_from_file.get('counter', 0)
            except (json.JSONDecodeError, FileNotFoundError, IsADirectoryError) as e:
                app.logger.warning(f"Warning: Error reading or parsing {ORDER_COUNTER_FILE} ({e}). Resetting counter for the day.")
                current_counter_val = 0 
            except Exception as e: 
                 app.logger.error(f"Unexpected error reading {ORDER_COUNTER_FILE}: {e}. Resetting counter for the day.")
                 current_counter_val = 0

        next_counter_val = current_counter_val + 1
        counter_data_to_save = {"date": today_str, "counter": next_counter_val}
        
        temp_counter_file = ORDER_COUNTER_FILE + ".tmp"
        with open(temp_counter_file, 'w') as f:
            json.dump(counter_data_to_save, f)
        os.replace(temp_counter_file, ORDER_COUNTER_FILE) 

        return next_counter_val
    except Exception as e_update:
        app.logger.critical(f"CRITICAL COUNTER UPDATE FAILURE: {datetime.now()} - {e_update}")
        raise Exception(f"Failed to update order counter: {e_update}")
    finally:
        if lock_acquired and os.path.exists(ORDER_COUNTER_LOCK_FILE):
            try:
                os.remove(ORDER_COUNTER_LOCK_FILE)
            except Exception as e_rem:
                app.logger.warning(f"WARNING: Failed to remove lock file {ORDER_COUNTER_LOCK_FILE}: {e_rem}")


@app.route('/')
def serve_index():
    return send_from_directory('.', 'POSPal.html')

@app.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute")
def login():
    data = request.get_json()
    password_attempt = data.get('password')
    
    if not password_attempt:
        return jsonify({"success": False, "message": "Password is required."}), 400

    if str(password_attempt) == MANAGEMENT_PASSWORD:
        app.logger.info("Successful management login.")
        return jsonify({"success": True})
    else:
        app.logger.warning(f"Failed management login attempt from {get_remote_address()}.")
        return jsonify({"success": False, "message": "Invalid password."}), 401


@app.route('/api/version')
def get_version():
    return jsonify({"version": CURRENT_VERSION})


def shutdown_server():
    app.logger.info("Shutdown command received. Terminating server.")
    os._exit(0)

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    threading.Timer(1.0, shutdown_server).start()
    return jsonify({"status": "success", "message": "Server is shutting down."})


@app.route('/api/order_status', methods=['GET'])
def get_order_status():
    try:
        today_str = datetime.now().strftime("%Y-%m-%d")
        current_counter_val = 0
        if os.path.exists(ORDER_COUNTER_FILE):
            try:
                with open(ORDER_COUNTER_FILE, 'r') as f:
                    data = json.load(f)
                    if data.get('date') == today_str:
                        current_counter_val = data.get('counter', 0)
            except (json.JSONDecodeError, FileNotFoundError):
                pass
        
        return jsonify({"next_order_number": current_counter_val + 1})
    except Exception as e:
        app.logger.error(f"Error getting order status: {str(e)}")
        return jsonify({"status": "error", "message": "Could not retrieve order status"}), 500


@app.route('/api/menu', methods=['GET'])
def get_menu():
    try:
        if not os.path.exists(MENU_FILE):
            app.logger.warning(f"Menu file {MENU_FILE} not found during GET request. Returning empty menu.")
            return jsonify({}) 
        with open(MENU_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return jsonify(data)
    except FileNotFoundError: 
        app.logger.error(f"Menu file {MENU_FILE} was not found unexpectedly. Returning empty menu.")
        return jsonify({})
    except json.JSONDecodeError as e:
        app.logger.error(f"Error decoding JSON from {MENU_FILE}: {str(e)}")
        return jsonify({"status": "error", "message": f"Menu data is corrupted. Please check the menu file on the server. Details: {str(e)}"}), 500
    except PermissionError as e:
        app.logger.error(f"Permission denied when trying to read {MENU_FILE}: {str(e)}")
        return jsonify({"status": "error", "message": f"Server permission error: Cannot read menu data. Details: {str(e)}"}), 500
    except Exception as e:
        app.logger.error(f"An unexpected error occurred while fetching the menu: {str(e)}")
        return jsonify({"status": "error", "message": f"An unexpected server error occurred while trying to load the menu. Details: {str(e)}"}), 500


@app.route('/api/menu', methods=['POST'])
def save_menu():
    new_menu_data = request.json
    try:
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(os.path.dirname(MENU_FILE), exist_ok=True)
        temp_menu_file = MENU_FILE + ".tmp"
        with open(temp_menu_file, 'w', encoding='utf-8') as f:
            json.dump(new_menu_data, f, indent=2) 
        os.replace(temp_menu_file, MENU_FILE) 
        return jsonify({"status": "success"})
    except PermissionError as e:
        app.logger.error(f"Permission denied saving menu: {str(e)}")
        return jsonify({"status": "error", "message": f"Permission error: {str(e)}"}), 500
    except Exception as e:
        app.logger.error(f"Error saving menu: {type(e).__name__}: {str(e)}")
        return jsonify({"status": "error", "message": f"Failed to save menu: {str(e)}"}), 500


def print_kitchen_ticket(order_data, copy_info="", original_timestamp_str=None):
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        app.logger.warning("Printing blocked - trial expired")
        return {"success": False, "reason": "TRIAL_EXPIRED"}
    
    hprinter = None
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter
        NORMAL_FONT_LINE_WIDTH = 42 
        SMALL_FONT_LINE_WIDTH = 56

        ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
        restaurant_name = "POSPal" 
        ticket_content += to_bytes(restaurant_name + "\n")
        ticket_content += BoldOff 
        
        ticket_content += AlignCenter + SelectFontA + NormalText
        header_text = "Kitchen Order"
        ticket_content += to_bytes(header_text + "\n")
        
        ticket_content += AlignLeft 
        
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
        order_num_text = f"Order #: {order_data.get('number', 'N/A')}"
        ticket_content += to_bytes(order_num_text + "\n")
        
        table_number = order_data.get('tableNumber')
        if table_number and table_number.upper() != 'N/A':
            table_text = f"Table: {table_number}"
            ticket_content += to_bytes(table_text + "\n")
        ticket_content += BoldOff 
            
        ticket_content += SelectFontA + NormalText
        time_to_display = original_timestamp_str if original_timestamp_str else datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        ticket_content += to_bytes(f"Time: {time_to_display}\n")
        
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        
        grand_total = 0.0
        for item_idx, item in enumerate(order_data.get('items', [])):
            item_quantity = item.get('quantity', 0)
            item_name_orig = item.get('name', 'Unknown Item')
            item_price_unit = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) 
            line_total = item_quantity * item_price_unit
            grand_total += line_total

            left_side = f"{item_quantity}x {item_name_orig}"
            right_side = f"{line_total:.2f}"

            large_text_width = len(left_side) * 2
            normal_text_width = len(right_side)
            
            if large_text_width + normal_text_width < NORMAL_FONT_LINE_WIDTH:
                ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
                ticket_content += to_bytes(left_side)
                ticket_content += NormalText + BoldOff
                padding_size = NORMAL_FONT_LINE_WIDTH - large_text_width - normal_text_width
                padding = " " * padding_size
                ticket_content += to_bytes(padding)
                ticket_content += to_bytes(right_side + "\n")
            else:
                ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
                DOUBLE_WIDTH_LINE_CHARS = NORMAL_FONT_LINE_WIDTH // 2
                wrapped_name_lines = word_wrap_text(left_side, DOUBLE_WIDTH_LINE_CHARS)
                
                for line in wrapped_name_lines[:-1]:
                    ticket_content += to_bytes(line + "\n")
                
                last_line = wrapped_name_lines[-1]
                last_line_width = len(last_line) * 2
                
                available_space = NORMAL_FONT_LINE_WIDTH - last_line_width
                padding = " " * max(0, available_space - normal_text_width)
                
                ticket_content += to_bytes(last_line)
                ticket_content += NormalText + BoldOff + to_bytes(padding + right_side + "\n")
                ticket_content += AlignLeft

            ticket_content += NormalText + BoldOff 

            general_options = item.get('generalSelectedOptions', [])
            if general_options:
                for opt in general_options:
                    opt_name = opt.get('name', 'N/A')
                    opt_price_change = float(opt.get('priceChange', 0.0))
                    price_change_str = ""
                    if opt_price_change != 0:
                        price_change_str = f" ({'+' if opt_price_change > 0 else ''}{opt_price_change:.2f})"
                    
                    option_line = f"  + {opt_name}{price_change_str}"
                    wrapped_option_lines = word_wrap_text(option_line, NORMAL_FONT_LINE_WIDTH, initial_indent="  ", subsequent_indent="    ") 
                    for opt_line_part in wrapped_option_lines:
                        ticket_content += to_bytes(opt_line_part + "\n")

            item_comment = item.get('comment', '').strip()
            if item_comment:
                ticket_content += BoldOn
                wrapped_comments = word_wrap_text(f"Note: {item_comment}", NORMAL_FONT_LINE_WIDTH, initial_indent="    ", subsequent_indent="    ")
                for comment_line in wrapped_comments:
                     ticket_content += to_bytes(comment_line + "\n")
                ticket_content += BoldOff                  
            
            if item_idx < len(order_data.get('items', [])) - 1:
                ticket_content += to_bytes("." * NORMAL_FONT_LINE_WIDTH + "\n")


        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn + AlignRight
        total_string = f"TOTAL: EUR {grand_total:.2f}"
        ticket_content += to_bytes(total_string + "\n")
        ticket_content += BoldOff + AlignLeft
        
        ticket_content += SelectFontA + NormalText
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n") 
        
        universal_comment = order_data.get('universalComment', '').strip()
        if universal_comment:
            ticket_content += SelectFontA + NormalText + BoldOn 
            ticket_content += to_bytes("ORDER NOTES:\n") + BoldOff 
            ticket_content += SelectFontA + NormalText 
            wrapped_universal_comment_lines = word_wrap_text(universal_comment, NORMAL_FONT_LINE_WIDTH, initial_indent="", subsequent_indent="") 
            for line in wrapped_universal_comment_lines:
                ticket_content += to_bytes(line + "\n")
            ticket_content += to_bytes("\n")
        
        ticket_content += to_bytes("\n")
        ticket_content += AlignCenter + SelectFontB
        disclaimer_text = "This is not a legal receipt of payment and is for informational purposes only."
        wrapped_disclaimer_lines = word_wrap_text(disclaimer_text, SMALL_FONT_LINE_WIDTH)
        for line in wrapped_disclaimer_lines:
            ticket_content += to_bytes(line + "\n")

        ticket_content += SelectFontA + AlignLeft
            
        ticket_content += to_bytes("\n\n\n\n") 
        ticket_content += FullCut

        if not PRINTER_NAME or PRINTER_NAME == "Your_Printer_Name_Here":
            app.logger.error(f"CRITICAL: PRINTER_NAME is not configured. Cannot print order #{order_data.get('number', 'N/A')}.")
            return False

        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)
        
        printer_info = win32print.GetPrinter(hprinter, 2)
        current_status = printer_info['Status']
        app.logger.info(f"Printer '{PRINTER_NAME}' current status code: {hex(current_status)}")

        PRINTER_STATUS_OFFLINE = 0x00000080; PRINTER_STATUS_ERROR = 0x00000002
        PRINTER_STATUS_NOT_AVAILABLE = 0x00001000; PRINTER_STATUS_PAPER_OUT = 0x00000010
        PRINTER_STATUS_USER_INTERVENTION = 0x00000200; PRINTER_STATUS_PAPER_JAM = 0x00000008
        PRINTER_STATUS_DOOR_OPEN = 0x00000400; PRINTER_STATUS_NO_TONER = 0x00040000
        PRINTER_STATUS_PAUSED = 0x00000001

        problem_flags_map = {
            PRINTER_STATUS_OFFLINE: "Offline", PRINTER_STATUS_ERROR: "Error",
            PRINTER_STATUS_NOT_AVAILABLE: "Not Available/Disconnected", PRINTER_STATUS_PAPER_OUT: "Paper Out",
            PRINTER_STATUS_USER_INTERVENTION: "User Intervention Required", PRINTER_STATUS_PAPER_JAM: "Paper Jam",
            PRINTER_STATUS_DOOR_OPEN: "Door/Cover Open", PRINTER_STATUS_NO_TONER: "No Toner/Ink",
            PRINTER_STATUS_PAUSED: "Print Queue Paused"
        }
        active_problems = [desc for flag, desc in problem_flags_map.items() if current_status & flag]

        if active_problems:
            problems_string = ", ".join(active_problems)
            app.logger.error(f"Printer '{PRINTER_NAME}' reported problem(s): {problems_string} (Status Code: {hex(current_status)}). Order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''} will not be printed.")
            if hprinter: win32print.ClosePrinter(hprinter) 
            return False 

        app.logger.info(f"Printer '{PRINTER_NAME}' status appears operational. Proceeding with print for order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}.")
        
        doc_started = False
        try:
            doc_name = f"Order_{order_data.get('number', 'N/A')}_Ticket{f'_{copy_info}'.replace(' ','_') if copy_info else ''}_ESCPOST"
            win32print.StartDocPrinter(hprinter, 1, (doc_name, None, "RAW"))
            doc_started = True
            win32print.StartPagePrinter(hprinter)
            win32print.WritePrinter(hprinter, bytes(ticket_content))
            win32print.EndPagePrinter(hprinter)
            app.logger.info(f"Order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''} data sent to printer spooler for '{PRINTER_NAME}'.")
            return True
        except Exception as e_print_doc:
            app.logger.error(f"Error during document printing phase for order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''} on '{PRINTER_NAME}': {str(e_print_doc)}")
            return False
        finally:
            if doc_started:
                win32print.EndDocPrinter(hprinter)

    except win32print.error as e_win32: 
        error_code = e_win32.winerror
        error_msg = e_win32.strerror
        order_id_str = f"order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}"
        if error_code == 1801:
             app.logger.error(f"Printing failed for {order_id_str}: Invalid printer name '{PRINTER_NAME}'. Error {error_code}: {error_msg}")
        else:
             app.logger.error(f"A win32print error occurred for {order_id_str} with printer '{PRINTER_NAME}'. Error {error_code}: {error_msg}")
        return False
    except Exception as e:
        app.logger.error(f"General printing system error for order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''} with printer '{PRINTER_NAME}': {str(e)}")
        return False
    finally:
        if hprinter:
            try:
                win32print.ClosePrinter(hprinter)
            except Exception as e_close: 
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")


def record_order_in_csv(order_data, print_status_message):
    try:
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR, exist_ok=True)
        printed_status_for_csv = print_status_message
        os.makedirs(DATA_DIR, exist_ok=True) 
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.abspath(os.path.join(DATA_DIR, f"orders_{date_str}.csv"))
        fieldnames = ['order_number', 'table_number', 'timestamp', 'items_summary', 
                      'universal_comment', 'order_total', 'payment_method', 'printed_status', 'items_json']

        file_exists = os.path.exists(filename)
        
        with open(filename, 'a', newline='', encoding='utf-8') as f_write:
            writer = csv.DictWriter(f_write, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()

            new_order_total = sum(
                float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) * int(item.get('quantity', 0))
                for item in order_data.get('items', [])
            )
            
            items_summary_parts = []
            for item in order_data.get('items', []):
                part = f"{item.get('quantity', 0)}x {item.get('name', 'N/A')}"
                
                general_options = item.get('generalSelectedOptions', [])
                if general_options:
                    opt_details = []
                    for opt in general_options:
                        opt_name = opt.get('name', 'N/A')
                        opt_price_change = float(opt.get('priceChange', 0.0))
                        price_str = ""
                        if opt_price_change != 0:
                            price_str = f" ({'+' if opt_price_change > 0 else ''}EUR {opt_price_change:.2f})"
                        opt_details.append(f"{opt_name}{price_str}")
                    if opt_details:
                        part += f" (Options: {', '.join(opt_details)})"
                
                comment = item.get('comment','').strip()
                if comment:
                    part += f" (Note: {comment})"
                
                unit_price_final = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                part += f" [Unit EUR {unit_price_final:.2f}]"
                items_summary_parts.append(part)

            new_row_data = {
                'order_number': order_data.get('number', 'N/A'),
                'table_number': order_data.get('tableNumber', ''),
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'items_summary': " | ".join(items_summary_parts), 
                'universal_comment': order_data.get('universalComment', '').strip(),
                'order_total': f"{new_order_total:.2f}",
                'payment_method': order_data.get('paymentMethod', 'Cash'),
                'printed_status': printed_status_for_csv,
                'items_json': json.dumps(order_data.get('items', [])) 
            }
            writer.writerow(new_row_data)
            
        app.logger.info(f"Order #{order_data.get('number', 'N/A')} logged to CSV. Payment: {order_data.get('paymentMethod', 'Cash')}, Printed: {printed_status_for_csv}.")
        return True
    except Exception as e:
        app.logger.error(f"CSV logging error for order #{order_data.get('number', 'N/A')}: {str(e)}")
        return False


@app.route('/api/orders', methods=['POST'])
def handle_order():
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        return jsonify({
            "status": "error_trial_expired",
            "message": "Trial period has ended. Printing disabled."
        }), 403
    
    order_data_from_client = request.json
    if not order_data_from_client or 'items' not in order_data_from_client or not order_data_from_client['items']:
        return jsonify({"status": "error_validation", "message": "Invalid order data: Items are required."}), 400

    authoritative_order_number = -1
    try:
        authoritative_order_number = get_next_daily_order_number()
    except Exception as e:
        app.logger.critical(f"Could not generate order number: {str(e)}")
        return jsonify({
            "status": "error_internal_server",
            "message": f"System error: Could not assign order number. {str(e)}"
        }), 500

    order_data_internal = {
        'number': authoritative_order_number,
        'tableNumber': order_data_from_client.get('tableNumber', '').strip() or 'N/A',
        'items': order_data_from_client.get('items', []), 
        'universalComment': order_data_from_client.get('universalComment', ''),
        'paymentMethod': order_data_from_client.get('paymentMethod', 'Cash')
    }

    print_status_summary = "Not Printed"
    printed_copy1 = False
    printed_copy2 = False

    app.logger.info(f"Attempting to print Copy 1 for order #{authoritative_order_number}")
    try:
        printed_copy1 = print_kitchen_ticket(order_data_internal, copy_info="Kitchen")
    except Exception as e_print1:
        app.logger.critical(f"CRITICAL PRINT EXCEPTION for order #{authoritative_order_number} (Copy 1): {str(e_print1)}")
        printed_copy1 = False

    if not printed_copy1:
        app.logger.warning(f"Order #{authoritative_order_number} - COPY 1 FAILED to print. Order will NOT be saved or further processed.")
        return jsonify({
            "status": "error_print_failed_copy1",
            "order_number": authoritative_order_number,
            "printed": "Copy 1 Failed",
            "logged": False,
            "message": f"Order #{authoritative_order_number} - COPY 1 (Kitchen) FAILED TO PRINT. Order NOT saved. Check printer!"
        }), 200

    app.logger.info(f"Order #{authoritative_order_number} - Copy 1 printed successfully.")

    app.logger.info(f"Attempting to print Copy 2 for order #{authoritative_order_number}")
    time.sleep(0.5)
    try:
        printed_copy2 = print_kitchen_ticket(order_data_internal, copy_info="Copy 2")
    except Exception as e_print2:
        app.logger.critical(f"CRITICAL PRINT EXCEPTION for order #{authoritative_order_number} (Copy 2): {str(e_print2)}")
        printed_copy2 = False

    if printed_copy1 and printed_copy2:
        print_status_summary = "All Copies Printed"
        app.logger.info(f"Order #{authoritative_order_number} - Both copies printed successfully.")
    elif printed_copy1 and not printed_copy2:
        print_status_summary = "Copy 1 Printed, Copy 2 Failed"
        app.logger.warning(f"Order #{authoritative_order_number} - Copy 1 was PRINTED, but Copy 2 FAILED to print.")
    
    csv_log_succeeded = False
    try:
        csv_log_succeeded = record_order_in_csv(order_data_internal, print_status_summary)
    except Exception as e_csv_call:
        app.logger.critical(f"CRITICAL CSV LOGGING EXCEPTION for order #{authoritative_order_number} (Print status: {print_status_summary}): {str(e_csv_call)}")
        csv_log_succeeded = False

    if not csv_log_succeeded:
        app.logger.error(f"Order #{authoritative_order_number} (Print status: {print_status_summary}) FAILED to log to CSV. This is a critical error.")
        return jsonify({
            "status": "error_log_failed_after_print",
            "order_number": authoritative_order_number,
            "printed": print_status_summary,
            "logged": False,
            "message": f"Order #{authoritative_order_number} - PRINT STATUS: {print_status_summary}. FAILED TO SAVE TO RECORDS. NOTIFY STAFF IMMEDIATELY."
        }), 200

    final_status_code = "error_unknown"
    message = "An unexpected issue occurred."

    if printed_copy1 and printed_copy2 and csv_log_succeeded:
        message = f"Order #{authoritative_order_number} processed: 2 copies printed, and logged successfully!"
        final_status_code = "success"
    elif printed_copy1 and not printed_copy2 and csv_log_succeeded:
        message = f"Order #{authoritative_order_number} processed: Copy 1 PRINTED & LOGGED. Copy 2 FAILED to print. Please check printer for Copy 2."
        final_status_code = "warning_print_copy2_failed" 

    app.logger.info(f"Order #{authoritative_order_number} processing complete. Final Status: {final_status_code}, Printed: {print_status_summary}, Logged: {csv_log_succeeded}")
    return jsonify({
        "status": final_status_code,
        "order_number": authoritative_order_number,
        "printed": print_status_summary, 
        "logged": csv_log_succeeded,
        "message": message
    }), 200
    
# --- MODIFIED: check_trial_status now relies on the sanitized trial.json ---
def check_trial_status():
    """
    Checks trial status. Relies on initialize_trial() having already sanitized
    the trial.json file against the registry.
    """
    # License check (highest priority)
    if os.path.exists(LICENSE_FILE):
        try:
            with open(LICENSE_FILE) as f:
                license_data = json.load(f)
            data = f"{license_data['hardware_id']}{APP_SECRET_KEY}".encode()
            if hashlib.sha256(data).hexdigest() == license_data['signature']:
                current_hw_id = ':'.join(f'{(uuid.getnode() >> i) & 0xff:02x}' for i in range(0, 8*6, 8))
                if current_hw_id == license_data['hardware_id']:
                    return {"licensed": True, "active": True}
        except Exception as e:
            app.logger.warning(f"Invalid license file: {e}")
    
    # Trial check
    if not os.path.exists(TRIAL_INFO_FILE):
        # This case should theoretically not be hit often if initialize_trial runs first,
        # but is a good fallback.
        app.logger.warning("Trial info file not found during check. Forcing expiration.")
        return {"licensed": False, "active": False, "expired": True}
    
    try:
        with open(TRIAL_INFO_FILE) as f:
            trial = json.load(f)
        
        # Verify signature
        data = f"{trial['first_run_date']}{APP_SECRET_KEY}".encode()
        if hashlib.sha256(data).hexdigest() != trial['signature']:
            app.logger.error("TRIAL TAMPERING DETECTED: Signature mismatch. Forcing expiration.")
            return {"licensed": False, "active": False, "expired": True}
        
        # Check dates
        first_run = datetime.strptime(trial['first_run_date'], "%Y-%m-%d")
        days_elapsed = (datetime.now() - first_run).days
        days_left = 30 - days_elapsed
        
        return {
            "licensed": False,
            "active": days_left > 0,
            "days_left": max(0, days_left),
            "expired": days_left <= 0
        }
    except Exception as e:
        app.logger.error(f"Error processing trial file during check: {e}. Forcing expiration.")
        return {"licensed": False, "active": False, "expired": True}


@app.route('/api/trial_status')
def get_trial_status():
    return jsonify(check_trial_status())

@app.route('/api/hardware_id')
def get_hardware_id():
    hw_id = ':'.join(f'{(uuid.getnode() >> i) & 0xff:02x}' for i in range(0, 8*6, 8))
    return jsonify({"hardware_id": hw_id})
    

@app.route('/api/todays_orders_for_reprint', methods=['GET'])
def get_todays_orders_for_reprint():
    try:
        today_date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{today_date_str}.csv")
        
        if not os.path.exists(filename):
            return jsonify([])

        orders_for_reprint = []
        with open(filename, 'r', newline='', encoding='utf-8') as f_read:
            reader = csv.DictReader(f_read)
            for row in reader:
                if row.get('order_number') and row.get('items_json'): 
                    orders_for_reprint.append({
                        'order_number': row.get('order_number'),
                        'table_number': row.get('table_number'),
                        'timestamp': row.get('timestamp')
                    })
        orders_for_reprint.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return jsonify(orders_for_reprint)

    except Exception as e:
        app.logger.error(f"Error fetching today's orders for reprint: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not fetch today's orders: {str(e)}"}), 500


@app.route('/api/reprint_order', methods=['POST'])
def reprint_order_endpoint():
    data = request.json
    order_number_to_reprint = data.get('order_number')

    if not order_number_to_reprint:
        return jsonify({"status": "error", "message": "Order number is required for reprint."}), 400

    try:
        today_date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{today_date_str}.csv")

        if not os.path.exists(filename):
            return jsonify({"status": "error", "message": f"No orders found for today to reprint order #{order_number_to_reprint}."}), 404

        found_order_row = None
        with open(filename, 'r', newline='', encoding='utf-8') as f_read:
            reader = csv.DictReader(f_read)
            for row in reader:
                if row.get('order_number') == str(order_number_to_reprint) and row.get('items_json'):
                    found_order_row = row
                    break
        
        if not found_order_row:
            return jsonify({"status": "error", "message": f"Order #{order_number_to_reprint} not found in today's records or is missing item data."}), 404

        items_list_str = found_order_row.get('items_json', '[]')
        try:
            items_list = json.loads(items_list_str)
            if not isinstance(items_list, list):
                 app.logger.error(f"Decoded items_json for order #{order_number_to_reprint} is not a list: {items_list_str}")
                 raise json.JSONDecodeError("Items data is not a list", items_list_str, 0)
        except json.JSONDecodeError as je:
            app.logger.error(f"Error decoding items_json for order #{order_number_to_reprint} during reprint: {str(je)}. Data: '{items_list_str}'")
            return jsonify({"status": "error", "message": f"Corrupted item data for order #{order_number_to_reprint}. Cannot reprint."}), 500


        if not items_list:
            app.logger.warning(f"Order #{order_number_to_reprint} has no item details for reprint (items_list is empty).")

        reprint_order_data = {
            'number': found_order_row.get('order_number'),
            'tableNumber': found_order_row.get('table_number', 'N/A'),
            'items': items_list,
            'universalComment': found_order_row.get('universal_comment', '')
        }
        original_timestamp = found_order_row.get('timestamp')

        app.logger.info(f"Attempting to reprint order #{order_number_to_reprint} (Original Timestamp: {original_timestamp})")

        reprint_copy1_success = print_kitchen_ticket(reprint_order_data, 
                                                     copy_info="Reprint - Kitchen", 
                                                     original_timestamp_str=original_timestamp)
        
        if not reprint_copy1_success:
            app.logger.warning(f"Reprint (Kitchen Copy) FAILED for order #{order_number_to_reprint}.")
            return jsonify({
                "status": "error_reprint_failed", 
                "message": f"Failed to reprint Kitchen Copy for order #{order_number_to_reprint}. Check printer."
            }), 200 

        app.logger.info(f"Reprint (Kitchen Copy) successful for order #{order_number_to_reprint}.")
        
        time.sleep(0.5) 
        reprint_copy2_success = print_kitchen_ticket(reprint_order_data, 
                                                     copy_info="Reprint - Copy 2", 
                                                     original_timestamp_str=original_timestamp)

        if not reprint_copy2_success:
            app.logger.warning(f"Reprint (Copy 2) FAILED for order #{order_number_to_reprint}, but Kitchen Copy was reprinted.")
            return jsonify({
                "status": "warning_reprint_copy2_failed", 
                "message": f"Order #{order_number_to_reprint}: Kitchen Copy REPRINTED. Copy 2 REPRINT FAILED. Check printer."
            }), 200
        
        app.logger.info(f"Reprint (Copy 2) successful for order #{order_number_to_reprint}.")
        return jsonify({
            "status": "success", 
            "message": f"Order #{order_number_to_reprint} REPRINTED successfully (2 copies)."
        }), 200

    except json.JSONDecodeError:
        app.logger.error(f"Error decoding items_json for order #{order_number_to_reprint} during reprint (outer catch).")
        return jsonify({"status": "error", "message": f"Corrupted item data for order #{order_number_to_reprint}. Cannot reprint."}), 500
    except Exception as e:
        app.logger.error(f"Error reprinting order #{order_number_to_reprint}: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not reprint order #{order_number_to_reprint}: {str(e)}"}), 500

@app.route('/api/daily_summary', methods=['GET'])
def get_daily_summary():
    try:
        today_date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{today_date_str}.csv")

        if not os.path.exists(filename):
            return jsonify({
                "total_orders": 0,
                "grand_total": 0.0,
                "cash_total": 0.0,
                "card_total": 0.0
            })

        total_orders = 0
        grand_total = 0.0
        cash_total = 0.0
        card_total = 0.0

        with open(filename, 'r', newline='', encoding='utf-8') as f_read:
            reader = csv.DictReader(f_read)
            for row in reader:
                try:
                    order_total = float(row.get('order_total', 0.0))
                    payment_method = row.get('payment_method', 'Cash').strip().capitalize()

                    total_orders += 1
                    grand_total += order_total

                    if payment_method == 'Card':
                        card_total += order_total
                    else:
                        cash_total += order_total
                except (ValueError, TypeError) as e:
                    app.logger.warning(f"Could not parse row in daily summary: {row}. Error: {e}")


        return jsonify({
            "status": "success",
            "total_orders": total_orders,
            "grand_total": grand_total,
            "cash_total": cash_total,
            "card_total": card_total
        })

    except Exception as e:
        app.logger.error(f"Error generating daily summary: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not generate daily summary: {str(e)}"}), 500


@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    try:
        range_param = request.args.get('range', 'today')
        start_date_str = request.args.get('start')
        end_date_str = request.args.get('end')

        target_filenames = []
        now = datetime.now()

        if range_param == 'today':
            target_filenames.append(os.path.join(DATA_DIR, f"orders_{now.strftime('%Y-%m-%d')}.csv"))
        elif range_param == 'week':
            for i in range(now.weekday() + 1):
                d = now - timedelta(days=i)
                target_filenames.append(os.path.join(DATA_DIR, f"orders_{d.strftime('%Y-%m-%d')}.csv"))
        elif range_param == 'month':
            for i in range(now.day):
                d = now - timedelta(days=i)
                target_filenames.append(os.path.join(DATA_DIR, f"orders_{d.strftime('%Y-%m-%d')}.csv"))
        elif range_param == 'custom' and start_date_str and end_date_str:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
            delta = end_date - start_date
            for i in range(delta.days + 1):
                day = start_date + timedelta(days=i)
                target_filenames.append(os.path.join(DATA_DIR, f"orders_{day.strftime('%Y-%m-%d')}.csv"))
        else:
             target_filenames.append(os.path.join(DATA_DIR, f"orders_{now.strftime('%Y-%m-%d')}.csv"))

        item_to_category_map = {}
        if os.path.exists(MENU_FILE):
            with open(MENU_FILE, 'r', encoding='utf-8') as f:
                menu_data = json.load(f)
                for category, items in menu_data.items():
                    for item in items:
                        item_to_category_map[str(item.get('id'))] = category
        
        total_orders = 0
        gross_revenue = 0.0
        cash_total = 0.0
        card_total = 0.0
        sales_by_category = defaultdict(float)
        item_sales_counter = Counter()
        item_revenue_counter = defaultdict(float)
        sales_by_hour = defaultdict(float)

        for filename in target_filenames:
            if not os.path.exists(filename):
                continue

            with open(filename, 'r', newline='', encoding='utf-8') as f_read:
                reader = csv.DictReader(f_read)
                for row in reader:
                    try:
                        total_orders += 1
                        order_total = float(row.get('order_total', 0.0))
                        gross_revenue += order_total
                        
                        payment_method = row.get('payment_method', 'Cash').strip().capitalize()
                        if payment_method == 'Card':
                            card_total += order_total
                        else:
                            cash_total += order_total

                        timestamp_str = row.get('timestamp')
                        if timestamp_str:
                            hour = datetime.strptime(timestamp_str, '%Y-%m-%d %H:%M:%S').hour
                            sales_by_hour[hour] += order_total

                        items_json = row.get('items_json', '[]')
                        items_in_order = json.loads(items_json)
                        
                        for item in items_in_order:
                            item_id_str = str(item.get('id'))
                            item_name = item.get('name', 'Unknown Item')
                            quantity = int(item.get('quantity', 0))
                            item_total_price = float(item.get('itemPriceWithModifiers', 0.0)) * quantity
                            
                            item_sales_counter[item_name] += quantity
                            item_revenue_counter[item_name] += item_total_price
                            
                            category = item_to_category_map.get(item_id_str, "Uncategorized")
                            sales_by_category[category] += item_total_price

                    except (ValueError, TypeError, json.JSONDecodeError) as e:
                        app.logger.warning(f"Could not parse row in analytics processing from {os.path.basename(filename)}: {row}. Error: {e}")

        atv = (gross_revenue / total_orders) if total_orders > 0 else 0.0
        
        formatted_sales_by_cat = sorted(
            [{"category": cat, "total": total} for cat, total in sales_by_category.items()],
            key=lambda x: x['total'], reverse=True
        )

        sorted_items = item_sales_counter.most_common()
        best_sellers = [{"name": name, "quantity": qty} for name, qty in sorted_items[:10]]
        worst_sellers = [{"name": name, "quantity": qty} for name, qty in sorted_items[-10:] if qty > 0]
        worst_sellers.reverse()

        sorted_revenue_items = sorted(item_revenue_counter.items(), key=lambda item: item[1], reverse=True)
        top_revenue_items = [{"name": name, "revenue": rev} for name, rev in sorted_revenue_items[:10]]

        formatted_sales_by_hour = [
            {"hour": hour, "total": sales_by_hour.get(hour, 0.0)} for hour in range(24)
        ]

        analytics_data = {
            "grossRevenue": gross_revenue,
            "totalOrders": total_orders,
            "atv": atv,
            "paymentMethods": {"cash": cash_total, "card": card_total},
            "salesByCategory": formatted_sales_by_cat,
            "bestSellers": best_sellers,
            "worstSellers": worst_sellers,
            "topRevenueItems": top_revenue_items,
            "salesByHour": formatted_sales_by_hour
        }
        
        return jsonify(analytics_data)

    except Exception as e:
        app.logger.error(f"Error generating analytics data: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not generate analytics: {str(e)}"}), 500


def check_for_updates():
    # --- MODIFIED: Added PAT for private repo access ---
    # WARNING: Hardcoding tokens is a major security risk. This token can be
    # extracted from the compiled .exe file. For a real product, use a more
    # secure method to provide credentials.
    GITHUB_PAT = "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" 
    
    if not GITHUB_PAT or GITHUB_PAT == "YOUR_PAT_HERE":
        app.logger.warning("GitHub PAT is not configured. Auto-update will likely fail for private repos.")
        # We can let it proceed, it will fail gracefully below.
        
    headers = {
        "Authorization": f"token {GITHUB_PAT}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    try:
        app.logger.info("Checking for application updates...")
        response = requests.get("https://api.github.com/repos/Radot1/POSPal/releases/latest", headers=headers)
        
        if response.status_code != 200:
            app.logger.error(f"Update check failed: GitHub API returned HTTP {response.status_code}")
            app.logger.error(f"Response body: {response.text}")
            return
            
        latest_ver = response.json()['tag_name']
        app.logger.info(f"Current version: {CURRENT_VERSION}, Latest version from GitHub: {latest_ver}")
        
        if latest_ver.lstrip('v') != CURRENT_VERSION.lstrip('v'):
            app.logger.info(f"New version {latest_ver} found. Starting update process.")
            assets = response.json().get('assets', [])
            download_url = ""
            for asset in assets:
                if asset.get('name') == 'POSPal.exe':
                    download_url = asset.get('browser_download_url')
                    break
            
            if not download_url:
                app.logger.error("Could not find 'POSPal.exe' in the latest release assets.")
                return

            app.logger.info(f"Downloading new executable from: {download_url}")
            # The download URL for assets from a private repo also requires authentication
            new_exe_response = requests.get(download_url, headers=headers)
            new_exe_response.raise_for_status()

            new_exe_path = os.path.join(BASE_DIR, "POSPal_new.exe")
            with open(new_exe_path, "wb") as f:
                f.write(new_exe_response.content)
            app.logger.info(f"New executable saved to {new_exe_path}")
            
            update_script_path = os.path.join(BASE_DIR, "update.bat")
            with open(update_script_path, "w") as bat:
                bat.write(f"""@echo off
echo Updating POSPal... Please wait.

ping 127.0.0.1 -n 4 > nul
taskkill /f /im POSPal.exe > nul 2>&1
move /y "POSPal_new.exe" "POSPal.exe"
echo Relaunching POSPal...
start "" "POSPal.exe"
(goto) 2>nul & del "%~f0" & exit
""")
            
            app.logger.info(f"Update script created at {update_script_path}")
            os.system(f'start /B "" "{update_script_path}"')
            app.logger.info("Update script launched. The application will now exit.")
            os._exit(0)
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Update check failed due to a network error: {str(e)}")
    except Exception as e:
        app.logger.error(f"An unexpected error occurred during the update check: {str(e)}")

if config.get("auto_update", False) and getattr(sys, 'frozen', False):
    threading.Timer(5, check_for_updates).start()

if __name__ == '__main__':
    # --- MODIFIED: Ensure trial is initialized on startup ---
    initialize_trial()
    
    try:
        test_file = os.path.join(DATA_DIR, 'permission_test.tmp')
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
    except Exception as e:
        app.logger.critical(f"CRITICAL: Cannot write to data directory: {DATA_DIR}. Error: {str(e)}")
        sys.exit(f"Error: Insufficient permissions to write to the data directory: {DATA_DIR}")
        
    from waitress import serve
    app.logger.info(f"Starting POSPal Server v{CURRENT_VERSION} on http://0.0.0.0:{config.get('port', 5000)}")
    serve(app, host='0.0.0.0', port=config.get('port', 5000))
