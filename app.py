CURRENT_VERSION = "1.0.5"  # Update this with each release

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
import sys  # Added for auto-update functionality
from collections import Counter, defaultdict # Added for analytics


app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s')

# --- CORRECTED File Paths ---
# This block correctly determines the base directory whether running as a script or a frozen .exe
if getattr(sys, 'frozen', False):
    # If the application is run as a bundle/executable
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # If run as a normal python script
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    
DATA_DIR = os.path.join(BASE_DIR, 'data')

TRIAL_INFO_FILE = os.path.join(DATA_DIR, 'trial.json')
LICENSE_FILE = os.path.join(BASE_DIR, 'license.key')
APP_SECRET_KEY = 0x8F3A2B1C9D4E5F6A  # Use a strong secret key

MENU_FILE = os.path.join(DATA_DIR, 'menu.json')
ORDER_COUNTER_FILE = os.path.join(DATA_DIR, 'order_counter.json')
ORDER_COUNTER_LOCK_FILE = os.path.join(DATA_DIR, 'order_counter.lock') # Lock file for order counter
CONFIG_FILE_OLD = os.path.join(BASE_DIR, 'config.json')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')

# --- NEW: Centralized State Management Files ---
CURRENT_ORDER_FILE = os.path.join(DATA_DIR, 'current_order.json')
ORDER_LINE_COUNTER_FILE = os.path.join(DATA_DIR, 'order_line_counter.json')
UNIVERSAL_COMMENT_FILE = os.path.join(DATA_DIR, 'universal_comment.json')
SELECTED_TABLE_FILE = os.path.join(DATA_DIR, 'selected_table.json')
DEVICE_SESSIONS_FILE = os.path.join(DATA_DIR, 'device_sessions.json')

# --- ESC/POS Commands ---
ESC = b'\x1B'
GS = b'\x1D'
InitializePrinter = ESC + b'@'
BoldOn = ESC + b'E\x01'
BoldOff = b'E\x00'
DoubleHeightWidth = GS + b'!\x11'  # Double Height and Double Width
DoubleHeight = GS + b'!\x01'       # Double Height only
DoubleWidth = GS + b'!\x10'        # Double Width only
NormalText = GS + b'!\x00'
AlignLeft = ESC + b'a\x00'
AlignCenter = ESC + b'a\x01'
AlignRight = ESC + b'a\x02'
SelectFontA = ESC + b'M\x00' # Standard Font A
SelectFontB = ESC + b'M\x01' # Smaller Font B (often used for details)
FullCut = GS + b'V\x00'
PartialCut = GS + b'V\x01' # Or m=66 for some printers

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

"""
PDF fallback has been removed. Printing must succeed to submit an order.
"""

# --- NEW: Centralized State Management Functions ---
def load_centralized_state():
    """Load all centralized state from files"""
    state = {
        'current_order': [],
        'order_line_counter': 0,
        'universal_comment': "",
        'selected_table': "",
        'device_sessions': {}
    }
    
    # Load current order
    if os.path.exists(CURRENT_ORDER_FILE):
        try:
            with open(CURRENT_ORDER_FILE, 'r', encoding='utf-8') as f:
                state['current_order'] = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            state['current_order'] = []
    
    # Load order line counter
    if os.path.exists(ORDER_LINE_COUNTER_FILE):
        try:
            with open(ORDER_LINE_COUNTER_FILE, 'r', encoding='utf-8') as f:
                state['order_line_counter'] = int(f.read().strip())
        except (ValueError, FileNotFoundError):
            state['order_line_counter'] = 0
    
    # Load universal comment
    if os.path.exists(UNIVERSAL_COMMENT_FILE):
        try:
            with open(UNIVERSAL_COMMENT_FILE, 'r', encoding='utf-8') as f:
                state['universal_comment'] = f.read().strip()
        except FileNotFoundError:
            state['universal_comment'] = ""
    
    # Load selected table
    if os.path.exists(SELECTED_TABLE_FILE):
        try:
            with open(SELECTED_TABLE_FILE, 'r', encoding='utf-8') as f:
                state['selected_table'] = f.read().strip()
        except FileNotFoundError:
            state['selected_table'] = ""
    
    # Load device sessions
    if os.path.exists(DEVICE_SESSIONS_FILE):
        try:
            with open(DEVICE_SESSIONS_FILE, 'r', encoding='utf-8') as f:
                state['device_sessions'] = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            state['device_sessions'] = {}
    
    return state

def save_centralized_state(state_key, value):
    """Save a specific state value to file"""
    try:
        if state_key == 'current_order':
            with open(CURRENT_ORDER_FILE, 'w', encoding='utf-8') as f:
                json.dump(value, f, indent=2)
        elif state_key == 'order_line_counter':
            with open(ORDER_LINE_COUNTER_FILE, 'w', encoding='utf-8') as f:
                f.write(str(value))
        elif state_key == 'universal_comment':
            with open(UNIVERSAL_COMMENT_FILE, 'w', encoding='utf-8') as f:
                f.write(str(value))
        elif state_key == 'selected_table':
            with open(SELECTED_TABLE_FILE, 'w', encoding='utf-8') as f:
                f.write(str(value))
        elif state_key == 'device_sessions':
            with open(DEVICE_SESSIONS_FILE, 'w', encoding='utf-8') as f:
                json.dump(value, f, indent=2)
        return True
    except Exception as e:
        app.logger.error(f"Error saving {state_key}: {str(e)}")
        return False

def register_device_session(device_id, device_info):
    """Register a device session for tracking"""
    state = load_centralized_state()
    state['device_sessions'][device_id] = {
        'info': device_info,
        'last_seen': datetime.now().isoformat(),
        'active': True
    }
    return save_centralized_state('device_sessions', state['device_sessions'])

def update_device_session(device_id):
    """Update device session timestamp"""
    state = load_centralized_state()
    if device_id in state['device_sessions']:
        state['device_sessions'][device_id]['last_seen'] = datetime.now().isoformat()
        return save_centralized_state('device_sessions', state['device_sessions'])
    return False

def cleanup_inactive_sessions():
    """Remove sessions older than 30 minutes"""
    state = load_centralized_state()
    cutoff_time = datetime.now() - timedelta(minutes=30)
    active_sessions = {}
    
    for device_id, session in state['device_sessions'].items():
        try:
            last_seen = datetime.fromisoformat(session['last_seen'])
            if last_seen > cutoff_time:
                active_sessions[device_id] = session
        except ValueError:
            # Invalid timestamp, remove session
            continue
    
    if len(active_sessions) != len(state['device_sessions']):
        save_centralized_state('device_sessions', active_sessions)
        app.logger.info(f"Cleaned up {len(state['device_sessions']) - len(active_sessions)} inactive sessions")
    
    return active_sessions


def is_version_newer(latest_version, current_version):
    """
    Return True if latest_version is strictly newer than current_version.
    Compares dot-separated numeric versions, ignoring a leading 'v'.
    """
    def parse_version(version_string):
        parts = version_string.lstrip('v').split('.')
        numbers = []
        for part in parts:
            try:
                numbers.append(int(part))
            except ValueError:
                numbers.append(0)
        return numbers

    latest_numbers = parse_version(latest_version)
    current_numbers = parse_version(current_version)

    max_len = max(len(latest_numbers), len(current_numbers))
    latest_numbers += [0] * (max_len - len(latest_numbers))
    current_numbers += [0] * (max_len - len(current_numbers))
    return latest_numbers > current_numbers

def load_config():
    # Ensure data directory exists BEFORE loading config
    os.makedirs(DATA_DIR, exist_ok=True)
    
    defaults = {
        "printer_name": "Microsoft Print to PDF",
        "port": 5000,
        "management_password": "9999", # Default password
        "cut_after_print": True
    }
    # Migrate legacy config.json (root) to data/config.json if needed
    try:
        if not os.path.exists(CONFIG_FILE) and os.path.exists(CONFIG_FILE_OLD):
            try:
                os.replace(CONFIG_FILE_OLD, CONFIG_FILE)
            except Exception:
                # Fallback to copy if replace fails (e.g., cross-device)
                with open(CONFIG_FILE_OLD, 'r') as _src, open(CONFIG_FILE, 'w') as _dst:
                    _dst.write(_src.read())
    except Exception as e:
        app.logger.warning(f"Config migration warning: {e}")

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
MANAGEMENT_PASSWORD = str(config["management_password"]) # Ensure password is a string
CUT_AFTER_PRINT = bool(config.get("cut_after_print", True))

# Disable debug mode
app.config['DEBUG'] = False

# Add rate limiting
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)


def to_bytes(s, encoding='cp437'): # cp437 is a common encoding for ESC/POS
    if isinstance(s, bytes):
        return s
    return s.encode(encoding, errors='replace') # 'replace' will put a ? for unmappable chars
    
def save_config(updated_values: dict):
    """Merge-update CONFIG_FILE atomically and refresh globals."""
    global config, PRINTER_NAME, MANAGEMENT_PASSWORD, CUT_AFTER_PRINT
    try:
        existing = {}
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                try:
                    existing = json.load(f) or {}
                except json.JSONDecodeError:
                    existing = {}
        merged = {**load_config(), **existing, **updated_values}
        tmp = CONFIG_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(merged, f, indent=4)
        os.replace(tmp, CONFIG_FILE)
        # refresh globals
        config = merged
        PRINTER_NAME = config.get("printer_name", PRINTER_NAME)
        MANAGEMENT_PASSWORD = str(config.get("management_password", MANAGEMENT_PASSWORD))
        CUT_AFTER_PRINT = bool(config.get("cut_after_print", CUT_AFTER_PRINT))
        return True
    except Exception as e:
        app.logger.error(f"Failed to save config: {e}")
        return False
    
def store_trial_in_registry(first_run_date, signature):
    """Store trial data in Windows Registry"""
    try:
        import winreg
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\POSPal\Trial")
        winreg.SetValueEx(key, "FirstRunDate", 0, winreg.REG_SZ, first_run_date)
        winreg.SetValueEx(key, "Signature", 0, winreg.REG_SZ, signature)
        winreg.CloseKey(key)
        return True
    except Exception as e:
        app.logger.warning(f"Could not store trial in registry: {e}")
        return False

def get_trial_from_registry():
    """Get trial data from Windows Registry"""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\POSPal\Trial")
        first_run_date = winreg.QueryValueEx(key, "FirstRunDate")[0]
        signature = winreg.QueryValueEx(key, "Signature")[0]
        winreg.CloseKey(key)
        return {"first_run_date": first_run_date, "signature": signature}
    except:
        return None

def initialize_trial():
    """Create trial file on first run with signature"""
    if not os.path.exists(TRIAL_INFO_FILE):
        try:
            first_run_date = datetime.now().strftime("%Y-%m-%d")
            signature_data = f"{first_run_date}{APP_SECRET_KEY}".encode()
            signature = hashlib.sha256(signature_data).hexdigest()
            
            # Store in file (primary)
            with open(TRIAL_INFO_FILE, 'w') as f:
                json.dump({
                    "first_run_date": first_run_date,
                    "signature": signature
                }, f)
            
            # Store in registry (backup)
            store_trial_in_registry(first_run_date, signature)
            
            app.logger.info("Initialized 30-day trial period")
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
            # Attempt to create and exclusively open the lock file
            fd = os.open(ORDER_COUNTER_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.close(fd) # Close the file handle immediately, we just needed to create the file
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
        
        # Atomic write using a temporary file
        temp_counter_file = ORDER_COUNTER_FILE + ".tmp"
        with open(temp_counter_file, 'w') as f:
            json.dump(counter_data_to_save, f)
        os.replace(temp_counter_file, ORDER_COUNTER_FILE) 

        return next_counter_val
    except Exception as e_update:
        app.logger.critical(f"CRITICAL COUNTER UPDATE FAILURE: {datetime.now()} - {e_update}")
        raise Exception(f"Failed to update order counter: {e_update}")
    finally:
        # Release the lock by deleting the lock file
        if lock_acquired and os.path.exists(ORDER_COUNTER_LOCK_FILE):
            try:
                os.remove(ORDER_COUNTER_LOCK_FILE)
            except Exception as e_rem:
                app.logger.warning(f"WARNING: Failed to remove lock file {ORDER_COUNTER_LOCK_FILE}: {e_rem}")


@app.route('/')
def serve_index():
    return send_from_directory('.', 'UISelect.html')

@app.route('/POSPal.html')
def serve_pospal():
    return send_from_directory('.', 'POSPal.html')

@app.route('/POSPalDesktop.html')
def serve_pospal_desktop():
    return send_from_directory('.', 'POSPalDesktop.html')

@app.route('/pospalCore.js')
def serve_pospal_core():
    return send_from_directory('.', 'pospalCore.js')

@app.route('/test_centralized.html')
def serve_test_centralized():
    return send_from_directory('.', 'test_centralized.html')

# --- NEW ENDPOINT for Login ---
@app.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute") # Rate limit login attempts
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


@app.route('/api/printers', methods=['GET'])
def get_printers():
    return jsonify({"printers": list_installed_printers(), "selected": PRINTER_NAME})


@app.route('/api/printer/status', methods=['GET'])
def printer_status():
    name = request.args.get('name', PRINTER_NAME)
    try:
        h = win32print.OpenPrinter(name)
        try:
            info = win32print.GetPrinter(h, 2)
        finally:
            win32print.ClosePrinter(h)
        status_code = info.get('Status', 0)
        return jsonify({"name": name, "status_code": status_code})
    except Exception as e:
        return jsonify({"name": name, "error": str(e)}), 200


@app.route('/api/printer/select', methods=['POST'])
def select_printer():
    data = request.get_json() or {}
    name = data.get('printer_name')
    if not name:
        return jsonify({"success": False, "message": "printer_name is required"}), 400
    if save_config({"printer_name": name}):
        return jsonify({"success": True, "printer_name": PRINTER_NAME})
    return jsonify({"success": False, "message": "Failed to save."}), 500


@app.route('/api/printer/test', methods=['POST'])
def test_print():
    try:
        # Provide clearer error messages for common failures
        trial = check_trial_status()
        if not trial.get('active', False):
            return jsonify({
                "success": False,
                "message": "Trial expired or inactive. Printing disabled."
            }), 200

        test_order = {
            'number': 'TEST',
            'tableNumber': 'N/A',
            'items': [
                {"name": "POSPal Test", "quantity": 1, "itemPriceWithModifiers": 0.00}
            ],
            'universalComment': ''
        }
        # Reset fallback flag and attempt
        global last_print_used_fallback
        last_print_used_fallback = False
        ok = print_kitchen_ticket(test_order, copy_info="Test Print")
        if ok:
            return jsonify({"success": True})
        # If failed and looks like a PDF-type printer, clarify unsupported
        name_lower = str(PRINTER_NAME).lower()
        if 'pdf' in name_lower:
            return jsonify({"success": False, "message": "Selected printer is a PDF device and is not supported for ticket printing."}), 200
        return jsonify({"success": False, "message": "Test print failed. See server log for details."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 200


@app.route('/api/settings/printing', methods=['GET', 'POST'])
def printing_settings():
    if request.method == 'GET':
        return jsonify({
            "printer_name": PRINTER_NAME,
            "cut_after_print": CUT_AFTER_PRINT
        })
    data = request.get_json() or {}
    values = {}
    for key in ["printer_name", "cut_after_print"]:
        if key in data:
            values[key] = data[key]
    if not values:
        return jsonify({"success": False, "message": "No settings provided."}), 400
    if save_config(values):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to save settings."}), 500


@app.route('/api/settings/password', methods=['POST'])
def change_password():
    data = request.get_json() or {}
    current_pw = str(data.get('current_password', ''))
    new_pw = str(data.get('new_password', ''))
    if current_pw != MANAGEMENT_PASSWORD:
        return jsonify({"success": False, "message": "Current password is incorrect."}), 200
    if new_pw is None or new_pw == "":
        return jsonify({"success": False, "message": "New password cannot be empty."}), 200
    if save_config({"management_password": new_pw}):
        return jsonify({"success": True, "message": "Password updated."})
    return jsonify({"success": False, "message": "Failed to update password."}), 500


## PDF folder opening removed with PDF fallback deprecation
# --- NEW ENDPOINT to get app version ---
@app.route('/api/version')
def get_version():
    return jsonify({"version": CURRENT_VERSION})


# --- NEW ENDPOINT FOR SHUTDOWN ---
def shutdown_server():
    app.logger.info("Shutdown command received. Terminating server.")
    os._exit(0)

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    # Schedule shutdown for 1 second from now
    threading.Timer(1.0, shutdown_server).start()
    # Immediately return a response
    return jsonify({"status": "success", "message": "Server is shutting down."})


# --- NEW ENDPOINT to get the next order number ---
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
                # File is corrupt or gone, will reset to 0
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
        # Ensure data directory exists
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


# --- REFACTORED to prevent resource leaks and improve clarity ---
def print_kitchen_ticket(order_data, copy_info="", original_timestamp_str=None):
    """
    Builds and prints a kitchen ticket. This function is refactored to ensure
    all printer resources are properly closed in all scenarios.
    """
    # 1. Pre-flight checks (no resources opened yet)
    global last_print_used_fallback
    last_print_used_fallback = False
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        app.logger.warning("Printing blocked - trial expired")
        return False

    if not PRINTER_NAME or PRINTER_NAME == "Your_Printer_Name_Here":
        app.logger.error(f"CRITICAL: PRINTER_NAME is not configured. Cannot print order #{order_data.get('number', 'N/A')}.")
        return False

    # PDF printers are not supported for ticket printing anymore
    if 'pdf' in str(PRINTER_NAME).lower():
        app.logger.error(f"Selected printer '{PRINTER_NAME}' appears to be a PDF device, which is not supported for ticket printing.")
        return False

    # 2. Build the ticket content (can fail without opening resources)
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter
        NORMAL_FONT_LINE_WIDTH = 42 
        SMALL_FONT_LINE_WIDTH = 56

        # ... (rest of ticket content generation logic) ...
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
                ticket_content += to_bytes(padding + right_side + "\n")
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
                    price_change_str = f" ({'+' if opt_price_change > 0 else ''}{opt_price_change:.2f})" if opt_price_change != 0 else ""
                    option_line = f"  + {opt_name}{price_change_str}"
                    for opt_line_part in word_wrap_text(option_line, NORMAL_FONT_LINE_WIDTH, initial_indent="  ", subsequent_indent="    "):
                        ticket_content += to_bytes(opt_line_part + "\n")

            item_comment = item.get('comment', '').strip()
            if item_comment:
                ticket_content += BoldOn
                for comment_line in word_wrap_text(f"Note: {item_comment}", NORMAL_FONT_LINE_WIDTH, initial_indent="    ", subsequent_indent="    "):
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
            for line in word_wrap_text(universal_comment, NORMAL_FONT_LINE_WIDTH, initial_indent="", subsequent_indent=""):
                ticket_content += to_bytes(line + "\n")
            ticket_content += to_bytes("\n")
        
        ticket_content += to_bytes("\n")
        ticket_content += AlignCenter + SelectFontB
        disclaimer_text = "This is not a legal receipt of payment and is for informational purposes only."
        for line in word_wrap_text(disclaimer_text, SMALL_FONT_LINE_WIDTH):
            ticket_content += to_bytes(line + "\n")

        ticket_content += SelectFontA + AlignLeft
        ticket_content += to_bytes("\n\n\n\n") 
        if CUT_AFTER_PRINT:
            ticket_content += FullCut

    except Exception as e_build:
        app.logger.error(f"Error building ticket content for order #{order_data.get('number', 'N/A')}: {str(e_build)}")
        return False

    # 3. Handle the printing with a guaranteed resource cleanup
    hprinter = None
    doc_started = False
    try:
        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)

        # Check printer status
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
            app.logger.error(f"Printer '{PRINTER_NAME}' reported problem(s): {problems_string}. Order will not be printed.")
            # Attempt PDF fallback if enabled
            if PDF_FALLBACK_ENABLED:
                if generate_pdf_ticket(order_data, copy_info, original_timestamp_str):
                    app.logger.info("PDF fallback used due to printer status problems.")
                    last_print_used_fallback = True
                    return True
            return False # Finally will close the handle

        app.logger.info(f"Printer '{PRINTER_NAME}' status appears operational. Proceeding with print.")
        
        # Perform the print job
        doc_name = f"Order_{order_data.get('number', 'N/A')}_Ticket{f'_{copy_info}'.replace(' ','_') if copy_info else ''}_ESCPOST"
        win32print.StartDocPrinter(hprinter, 1, (doc_name, None, "RAW"))
        doc_started = True
        
        win32print.StartPagePrinter(hprinter)
        win32print.WritePrinter(hprinter, bytes(ticket_content))
        win32print.EndPagePrinter(hprinter)
        
        app.logger.info(f"Order #{order_data.get('number', 'N/A')} data sent to printer spooler for '{PRINTER_NAME}'.")
        return True # Success

    except (win32print.error, Exception) as e:
        order_id_str = f"order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}"
        app.logger.error(f"A printing error occurred for {order_id_str} with printer '{PRINTER_NAME}'. Error: {str(e)}")
        # Attempt PDF fallback if enabled
        if PDF_FALLBACK_ENABLED:
            if generate_pdf_ticket(order_data, copy_info, original_timestamp_str):
                app.logger.info("PDF fallback used due to printing exception.")
                last_print_used_fallback = True
                return True
        return False
        
    finally:
        # This block ensures all opened resources are closed, in the correct order.
        if doc_started:
            try:
                win32print.EndDocPrinter(hprinter)
            except Exception as e_doc:
                 app.logger.error(f"Error ending document on printer '{PRINTER_NAME}': {str(e_doc)}")
        if hprinter:
            try:
                win32print.ClosePrinter(hprinter)
            except Exception as e_close: 
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")


def record_order_in_csv(order_data, print_status_message):
    try:
        # Ensure data directory exists
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


## PDF ticket generation removed


def list_installed_printers():
    try:
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        printers = win32print.EnumPrinters(flags)
        names = []
        for p in printers:
            name = p[2] if len(p) > 2 else None
            if name:
                names.append(name)
        return names
    except Exception as e:
        app.logger.error(f"Failed to enumerate printers: {e}")
        return []
@app.route('/api/orders', methods=['POST'])
def handle_order():
    # Check trial status
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
    
def check_trial_status():
    """Check trial status with tamper protection"""
    # License check (highest priority)
    if os.path.exists(LICENSE_FILE):
        try:
            with open(LICENSE_FILE) as f:
                license = json.load(f)
            # Validate signature
            data = f"{license['hardware_id']}{APP_SECRET_KEY}".encode()
            if hashlib.sha256(data).hexdigest() == license['signature']:
                                # Validate hardware using enhanced fingerprint
                current_hw_id = get_enhanced_hardware_id()
                if current_hw_id == license['hardware_id']:
                    return {"licensed": True, "active": True}
        except:
            app.logger.warning("Invalid license file")
    
    # Trial check - try multiple storage locations
    trial_data = None
    
    # Try file first
    if os.path.exists(TRIAL_INFO_FILE):
        try:
            with open(TRIAL_INFO_FILE) as f:
                trial_data = json.load(f)
        except:
            pass
    
    # If file failed, try registry
    if not trial_data:
        trial_data = get_trial_from_registry()
    
    # If no trial data found anywhere
    if not trial_data:
        return {"licensed": False, "active": False, "expired": True}
    
    try:
        # Verify signature
        data = f"{trial_data['first_run_date']}{APP_SECRET_KEY}".encode()
        if hashlib.sha256(data).hexdigest() != trial_data['signature']:
            return {"licensed": False, "active": False, "expired": True}
        
        # Check dates
        first_run = datetime.strptime(trial_data['first_run_date'], "%Y-%m-%d")
        days_elapsed = (datetime.now() - first_run).days
        days_left = 30 - days_elapsed
        
        return {
            "licensed": False,
            "active": days_left > 0,
            "days_left": max(0, days_left),
            "expired": days_left <= 0
        }
    except:
        return {"licensed": False, "active": False, "expired": True}

# Add API endpoint
@app.route('/api/trial_status')
def get_trial_status():
    return jsonify(check_trial_status())

def get_enhanced_hardware_id():
    """Get enhanced hardware fingerprint using multiple identifiers"""
    import subprocess
    import platform
    
    # Get MAC address (current method)
    mac = ':'.join(f'{(uuid.getnode() >> i) & 0xff:02x}' 
                   for i in range(0, 8*6, 8))
    
    # Get CPU info
    try:
        cpu_info = platform.processor()
        if not cpu_info:
            cpu_info = platform.machine()
    except:
        cpu_info = "UNKNOWN"
    
    # Get disk serial (Windows specific)
    disk_serial = "UNKNOWN"
    try:
        result = subprocess.run(['wmic', 'diskdrive', 'get', 'serialnumber'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                disk_serial = lines[1].strip()
    except:
        pass
    
    # Get Windows installation ID
    win_id = "UNKNOWN"
    try:
        result = subprocess.run(['wmic', 'os', 'get', 'SerialNumber'], 
                              capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                win_id = lines[1].strip()
    except:
        pass
    
    # Combine all identifiers and hash
    combined = f"{mac}|{cpu_info}|{disk_serial}|{win_id}"
    enhanced_id = hashlib.sha256(combined.encode()).hexdigest()[:16]
    
    return enhanced_id

@app.route('/api/hardware_id')
def get_hardware_id():
    """Get machine's hardware ID"""
    # Return enhanced hardware ID
    hw_id = get_enhanced_hardware_id()
    return jsonify({"hardware_id": hw_id})
    

# --- NEW ENDPOINTS FOR REPRINT ---
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


# --- ANALYTICS ENDPOINT (CORRECTED & ENHANCED) ---
@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    try:
        range_type = request.args.get('range', 'today')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if range_type == 'custom' and start_date and end_date:
            # Custom date range
            start = datetime.strptime(start_date, '%Y-%m-%d')
            end = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)
        else:
            # Today's analytics
            start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
        
        # Read orders from CSV file
        # Use today's CSV snapshot; if not exists generate dummy data for testing
        today_path = os.path.join(DATA_DIR, f"orders_{datetime.now().strftime('%Y-%m-%d')}.csv")
        orders_csv = today_path
        if not os.path.exists(orders_csv):
            # Generate dummy data for the day to allow testing analytics
            os.makedirs(DATA_DIR, exist_ok=True)
            fieldnames = ['order_number','table_number','timestamp','items_summary','universal_comment','order_total','payment_method','printed_status','items_json']
            start_time = datetime.now().replace(hour=7, minute=0, second=0, microsecond=0)
            demo_rows = []
            # Create ~36 orders across the day with varying items, options, and payments
            import random
            products = [
                {"name":"Cappuccino","price":3.2},
                {"name":"Latte","price":3.5},
                {"name":"Espresso","price":2.5},
                {"name":"Croissant","price":2.2},
                {"name":"Toastie","price":4.2},
                {"name":"Sandwich","price":5.8},
                {"name":"Tea","price":2.0}
            ]
            addons_catalog = [
                {"name":"Extra Shot","priceChange":0.5},
                {"name":"Syrup","priceChange":0.3},
                {"name":"Almond Milk","priceChange":0.4}
            ]
            total_orders_to_create = 36
            for i in range(1, total_orders_to_create + 1):
                ts = start_time + timedelta(minutes=random.randint(0, 14) + (i-1)*20)
                num_items = random.randint(1, 4)
                items = []
                total = 0.0
                for _ in range(num_items):
                    prod = random.choice(products)
                    qty = random.randint(1, 2)
                    # Randomly add paid options
                    selected_options = []
                    if random.random() < 0.5:
                        # up to 2 addons
                        for opt in random.sample(addons_catalog, k=random.randint(1, min(2, len(addons_catalog)))):
                            selected_options.append({"name": opt["name"], "priceChange": opt["priceChange"]})
                    unit_price = prod["price"] + sum(opt["priceChange"] for opt in selected_options)
                    items.append({
                        "name": prod["name"],
                        "quantity": qty,
                        "itemPriceWithModifiers": unit_price,
                        "generalSelectedOptions": selected_options
                    })
                    total += unit_price * qty
                payment_method = 'Card' if random.random() < 0.6 else 'Cash'
                demo_rows.append({
                    'order_number': i,
                    'table_number': str(random.randint(1, 15)),
                    'timestamp': ts.strftime('%Y-%m-%d %H:%M:%S'),
                    'items_summary': '',
                    'universal_comment': '',
                    'order_total': f"{total:.2f}",
                    'payment_method': payment_method,
                    'printed_status': 'All Copies Printed',
                    'items_json': json.dumps(items)
                })
            with open(orders_csv, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                for row in demo_rows:
                    writer.writerow(row)

            # Create a default menu.json if none exists so category analytics work
            if not os.path.exists(MENU_FILE):
                default_menu = {
                    "Coffee": [
                        {"id": 1, "name": "Cappuccino", "price": 3.2},
                        {"id": 2, "name": "Latte", "price": 3.5},
                        {"id": 3, "name": "Espresso", "price": 2.5}
                    ],
                    "Tea": [
                        {"id": 4, "name": "Tea", "price": 2.0}
                    ],
                    "Bakery": [
                        {"id": 5, "name": "Croissant", "price": 2.2}
                    ],
                    "Food": [
                        {"id": 6, "name": "Toastie", "price": 4.2},
                        {"id": 7, "name": "Sandwich", "price": 5.8}
                    ]
                }
                os.makedirs(DATA_DIR, exist_ok=True)
                with open(MENU_FILE, 'w', encoding='utf-8') as mf:
                    json.dump(default_menu, mf, indent=2)
        
        total_sales = 0.0
        total_orders = 0
        sales_by_hour = defaultdict(float)
        item_qty = Counter()
        item_rev = defaultdict(float)
        payment_methods = Counter()
        daypart_totals = defaultdict(float)
        addon_rev = defaultdict(float)
        addon_order_set = defaultdict(set)  # addon_name -> set(order_number)

        # Build item name -> category map from menu if available
        name_to_category = {}
        try:
            if os.path.exists(MENU_FILE):
                with open(MENU_FILE, 'r', encoding='utf-8') as mf:
                    menu_json = json.load(mf)
                    if isinstance(menu_json, dict):
                        for cat_name, items in menu_json.items():
                            for it in items or []:
                                nm = it.get('name')
                                if nm:
                                    name_to_category[nm] = cat_name
        except Exception:
            pass
        
        with open(orders_csv, 'r', newline='', encoding='utf-8') as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                try:
                    order_date = datetime.strptime(row.get('timestamp') or row.get('Date'), '%Y-%m-%d %H:%M:%S')
                    if start <= order_date < end:
                        order_total = float(row.get('order_total') or row.get('Total') or 0.0)
                        total_sales += order_total
                        total_orders += 1
                        
                        # Sales by hour
                        hour = order_date.hour
                        sales_by_hour[hour] += order_total

                        # Daypart removed per requirements
                        
                        # Payment methods
                        payment_method = row.get('payment_method') or row.get('Payment Method', 'Cash')
                        payment_methods[payment_method] += 1
                        
                        # Top items (parse items JSON)
                        try:
                            items = json.loads(row.get('items_json') or row.get('Items') or '[]')
                            order_no = row.get('order_number') or row.get('OrderNumber') or str(uuid.uuid4())
                            for item in items:
                                item_name = item.get('name', 'Unknown')
                                quantity = int(item.get('quantity', 1))
                                unit_price = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                                item_qty[item_name] += quantity
                                item_rev[item_name] += unit_price * quantity

                                # Add-ons/options revenue and attach rate
                                try:
                                    opts = item.get('generalSelectedOptions') or []
                                    if isinstance(opts, list):
                                        seen_addons_in_order = set()
                                        for opt in opts:
                                            opt_name = opt.get('name')
                                            if not opt_name:
                                                continue
                                            price_change = float(opt.get('priceChange', 0.0))
                                            if price_change > 0:
                                                addon_rev[opt_name] += price_change * quantity
                                            seen_addons_in_order.add(opt_name)
                                        for opt_name in seen_addons_in_order:
                                            addon_order_set[opt_name].add(order_no)
                                except Exception:
                                    pass
                        except (json.JSONDecodeError, KeyError):
                            pass
                            
                except (ValueError, KeyError) as e:
                    app.logger.warning(f"Error parsing order row: {e}")
                    continue
        
        average_order_value = total_sales / total_orders if total_orders > 0 else 0
        # Build best and worst sellers by quantity
        best_sellers = [{"name": name, "quantity": qty} for name, qty in item_qty.most_common(10)]
        # For worst, pick bottom 10 among those sold at least once
        worst_candidates = sorted([(name, qty) for name, qty in item_qty.items() if qty > 0], key=lambda x: x[1])[:10]
        worst_sellers = [{"name": n, "quantity": q} for n, q in worst_candidates]

        # Top items by revenue
        top_revenue_items = sorted([{ "name": n, "revenue": r } for n, r in item_rev.items()], key=lambda x: x['revenue'], reverse=True)[:10]

        # Sales by category (revenue)
        def guess_category(item_name: str) -> str:
            n = (item_name or '').lower()
            if any(k in n for k in ['cappuccino','latte','espresso']):
                return 'Coffee'
            if 'tea' in n:
                return 'Tea'
            if any(k in n for k in ['croissant','muffin','pastry']):
                return 'Bakery'
            if any(k in n for k in ['sandwich','toastie','wrap','panini']):
                return 'Food'
            return 'Uncategorized'
        category_rev = defaultdict(float)
        for name, rev in item_rev.items():
            cat = name_to_category.get(name) or guess_category(name)
            category_rev[cat] += rev
        sales_by_category_list = [{"category": c, "total": round(t,2)} for c, t in sorted(category_rev.items(), key=lambda x: x[1], reverse=True)]

        # Dayparts removed

        # Top addons with attach rate
        top_addons = []
        for name, rev in sorted(addon_rev.items(), key=lambda x: x[1], reverse=True)[:10]:
            attach_rate = (len(addon_order_set.get(name, set())) / total_orders) if total_orders > 0 else 0.0
            top_addons.append({"name": name, "revenue": round(rev,2), "attachRate": attach_rate})
        
        # Build frontend-compatible structure
        sales_by_hour_list = [ {"hour": h, "total": round(v,2)} for h,v in sorted(sales_by_hour.items()) ]
        payment_amounts = { 'cash': 0.0, 'card': 0.0 }
        # Re-scan to sum payment amounts for fees/net revenue
        try:
            with open(orders_csv, 'r', newline='', encoding='utf-8') as csvfile2:
                reader2 = csv.DictReader(csvfile2)
                for row in reader2:
                    try:
                        order_date = datetime.strptime(row.get('timestamp') or row.get('Date'), '%Y-%m-%d %H:%M:%S')
                        if start <= order_date < end:
                            amt = float(row.get('order_total') or row.get('Total') or 0.0)
                            pm = (row.get('payment_method') or row.get('Payment Method') or 'Cash').capitalize()
                            if pm == 'Card':
                                payment_amounts['card'] += amt
                            else:
                                payment_amounts['cash'] += amt
                    except Exception:
                        pass
        except Exception:
            pass

        resp = {
            "grossRevenue": round(total_sales, 2),
            "totalOrders": total_orders,
            "atv": round(average_order_value, 2),
            "paymentMethods": {
                "cash": round(payment_amounts['cash'], 2),
                "card": round(payment_amounts['card'], 2)
            },
            "paymentCounts": { key: payment_methods.get(key.capitalize(), 0) for key in ['cash','card'] },
            "salesByHour": sales_by_hour_list,
            
            "salesByCategory": sales_by_category_list,
            "topRevenueItems": top_revenue_items,
            "bestSellers": best_sellers,
            "worstSellers": worst_sellers,
            "topAddons": top_addons
        }
        # total items for items/order
        try:
            total_items = sum(item_qty.values())
        except Exception:
            total_items = 0
        resp["totalItems"] = int(total_items)
        return jsonify(resp)
        
    except Exception as e:
        app.logger.error(f"Error generating analytics: {str(e)}")
        return jsonify({"status": "error", "message": f"Error generating analytics: {str(e)}"}), 500

# --- NEW: Centralized State Management API Endpoints ---

@app.route('/api/state', methods=['GET'])
def get_state():
    """Get current centralized state"""
    try:
        # Clean up inactive sessions first
        cleanup_inactive_sessions()
        
        # Get device ID from request
        device_id = request.args.get('device_id', 'unknown')
        device_info = {
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'ip': get_remote_address(),
            'timestamp': datetime.now().isoformat()
        }
        
        # Register/update device session
        if device_id != 'unknown':
            register_device_session(device_id, device_info)
        
        state = load_centralized_state()
        return jsonify({
            "success": True,
            "state": {
                "current_order": state['current_order'],
                "order_line_counter": state['order_line_counter'],
                "universal_comment": state['universal_comment'],
                "selected_table": state['selected_table'],
                "active_devices": len(state['device_sessions'])
            }
        })
    except Exception as e:
        app.logger.error(f"Error getting state: {str(e)}")
        return jsonify({"success": False, "message": f"Error getting state: {str(e)}"}), 500

@app.route('/api/state/current_order', methods=['GET', 'POST'])
def handle_current_order():
    """Get or update current order"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "current_order": state['current_order']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_order = data.get('current_order', [])
            if save_centralized_state('current_order', new_order):
                return jsonify({"success": True, "message": "Current order updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save current order"}), 500
    except Exception as e:
        app.logger.error(f"Error handling current order: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/order_line_counter', methods=['GET', 'POST'])
def handle_order_line_counter():
    """Get or update order line counter"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "order_line_counter": state['order_line_counter']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_counter = data.get('order_line_counter', 0)
            if save_centralized_state('order_line_counter', new_counter):
                return jsonify({"success": True, "message": "Order line counter updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save order line counter"}), 500
    except Exception as e:
        app.logger.error(f"Error handling order line counter: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/universal_comment', methods=['GET', 'POST'])
def handle_universal_comment():
    """Get or update universal comment"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "universal_comment": state['universal_comment']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_comment = data.get('universal_comment', "")
            if save_centralized_state('universal_comment', new_comment):
                return jsonify({"success": True, "message": "Universal comment updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save universal comment"}), 500
    except Exception as e:
        app.logger.error(f"Error handling universal comment: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/selected_table', methods=['GET', 'POST'])
def handle_selected_table():
    """Get or update selected table"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "selected_table": state['selected_table']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_table = data.get('selected_table', "")
            if save_centralized_state('selected_table', new_table):
                return jsonify({"success": True, "message": "Selected table updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save selected table"}), 500
    except Exception as e:
        app.logger.error(f"Error handling selected table: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/clear_order', methods=['POST'])
def clear_current_order():
    """Clear current order and reset counter"""
    try:
        if save_centralized_state('current_order', []) and save_centralized_state('order_line_counter', 0):
            return jsonify({"success": True, "message": "Current order cleared"})
        else:
            return jsonify({"success": False, "message": "Failed to clear current order"}), 500
    except Exception as e:
        app.logger.error(f"Error clearing current order: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/devices', methods=['GET'])
def get_active_devices():
    """Get list of active devices"""
    try:
        cleanup_inactive_sessions()
        state = load_centralized_state()
        return jsonify({
            "success": True,
            "active_devices": state['device_sessions']
        })
    except Exception as e:
        app.logger.error(f"Error getting active devices: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


def check_for_updates():
    """
    Checks for a new release on a public GitHub repository, downloads it,
    and creates a batch script to perform the update.
    """
    try:
        app.logger.info("Checking for application updates from public GitHub repository...")

        # This URL points to the latest release of a public repository.
        # No Personal Access Token (PAT) is needed for public repos.
        repo_url = "https://api.github.com/repos/Radot1/POSPal/releases/latest"

        # It's good practice to set a User-Agent header when making API requests.
        headers = {
            "User-Agent": "POSPal-App-Updater/1.0",
            "Accept": "application/vnd.github.v3+json"
        }

        # Make the request to the GitHub API. Added headers and a timeout.
        response = requests.get(repo_url, headers=headers, timeout=15)

        if response.status_code != 200:
            app.logger.error(f"Update check failed: GitHub API returned HTTP {response.status_code}. Response: {response.text}")
            return

        latest_release_data = response.json()
        latest_ver = latest_release_data.get('tag_name')

        if not latest_ver:
            app.logger.error("Update check failed: Could not find 'tag_name' in the API response.")
            return

        app.logger.info(f"Current version: {CURRENT_VERSION}, Latest version from GitHub: {latest_ver}")

        # Update only if GitHub version is strictly newer; never downgrade or lateral update.
        if is_version_newer(latest_ver, CURRENT_VERSION):
            app.logger.info(f"New version {latest_ver} found. Starting update process.")

            # Find the correct asset to download from the release.
            assets = latest_release_data.get('assets', [])
            download_url = ""
            # The asset should be the main executable file.
            expected_asset_name = os.path.basename(sys.executable) # e.g., "POSPal.exe"
            
            for asset in assets:
                if asset.get('name') == expected_asset_name:
                    download_url = asset.get('browser_download_url')
                    break

            if not download_url:
                app.logger.error(f"Could not find '{expected_asset_name}' in the latest release assets.")
                return

            app.logger.info(f"Downloading new executable from: {download_url}")
            # Use a longer timeout for the download itself.
            new_exe_response = requests.get(download_url, timeout=300)
            new_exe_response.raise_for_status()  # Raise an exception for 4xx/5xx responses

            # Save the new executable to a temporary file.
            new_exe_path = os.path.join(BASE_DIR, "POSPal_new.exe")
            with open(new_exe_path, "wb") as f:
                f.write(new_exe_response.content)
            app.logger.info(f"New executable saved to {new_exe_path}")

            # Create a batch script to perform the update.
            update_script_path = os.path.join(BASE_DIR, "update.bat")
            with open(update_script_path, "w") as bat:
                bat.write(f"""@echo off
echo Updating POSPal... Please wait.

:: Give the main application a moment to close
timeout /t 3 /nobreak > nul

:: Forcefully terminate the old process if it's still running
taskkill /f /im "{expected_asset_name}" > nul 2>&1

:: Replace the old executable with the new one
move /y "{new_exe_path}" "{expected_asset_name}"

:: Relaunch the new version
echo Relaunching POSPal...
start "" "{expected_asset_name}"

:: Self-delete the batch file and exit
(goto) 2>nul & del "%~f0" & exit
""")

            app.logger.info(f"Update script created at {update_script_path}")

            # Execute the update script in a new, detached process.
            os.system(f'start /B "" "{update_script_path}"')
            app.logger.info("Update script launched. The application will now exit to allow the update.")

            # Exit the current application.
            os._exit(0)
        else:
            app.logger.info("POSPal is up to date.")
            
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Update check failed due to a network error: {str(e)}")
    except Exception as e:
        app.logger.error(f"An unexpected error occurred during the update check: {str(e)}")


# Add to startup logic (always check for updates when running as packaged executable)
if getattr(sys, 'frozen', False):
    # Check for updates once, 5 seconds after startup
    threading.Timer(5, check_for_updates).start()

if __name__ == '__main__':
    initialize_trial()
    # Verify we can write to DATA_DIR
    try:
        test_file = os.path.join(DATA_DIR, 'permission_test.tmp')
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
    except Exception as e:
        app.logger.critical(f"CRITICAL: Cannot write to data directory: {DATA_DIR}. Error: {str(e)}")
        # In a real GUI app, you'd show a message box here.
        # For now, we exit with an error code.
        sys.exit(f"Error: Insufficient permissions to write to the data directory: {DATA_DIR}")
        
    from waitress import serve
    app.logger.info(f"Starting POSPal Server v{CURRENT_VERSION} on http://0.0.0.0:{config.get('port', 5000)}")
    serve(app, host='0.0.0.0', port=config.get('port', 5000))
