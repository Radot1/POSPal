import flask
from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime
import csv
import os
import win32print # type: ignore
import time
import json
import logging

app = Flask(__name__)

PRINTER_NAME = "80mm Series Printer"

CSV_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
MENU_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data/menu.json')
ORDER_COUNTER_FILE = os.path.join(CSV_DIR, 'order_counter.json')
ORDER_COUNTER_LOCK_FILE = os.path.join(CSV_DIR, 'order_counter.lock')

ESC = b'\x1B'
GS = b'\x1D'
InitializePrinter = ESC + b'@'
BoldOn = ESC + b'E\x01'
BoldOff = ESC + b'E\x00'
DoubleHeightWidth = GS + b'!\x11'
DoubleHeight = GS + b'!\x01'
NormalText = GS + b'!\x00'
SelectFontA = ESC + b'M\x00'
FullCut = GS + b'V\x00'

def to_bytes(s, encoding='cp437'):
    if isinstance(s, bytes):
        return s
    return s.encode(encoding, errors='replace')

def word_wrap_text(text, max_width):
    lines = []
    if not text: return lines
    current_line = []
    current_length = 0
    for word in text.split(' '):
        if not word: continue
        if not current_line and len(word) > max_width:
            start = 0
            while start < len(word):
                lines.append(word[start:start+max_width])
                start += max_width
            continue
        if current_length + len(word) + (1 if current_line else 0) <= max_width:
            current_line.append(word)
            current_length += len(word) + (1 if len(current_line) > 1 else 0)
        else:
            if current_line: lines.append(" ".join(current_line))
            if len(word) > max_width:
                start = 0
                while start < len(word):
                    lines.append(word[start:start+max_width])
                    start += max_width
                current_line = []
                current_length = 0
            else:
                current_line = [word]
                current_length = len(word)
    if current_line: lines.append(" ".join(current_line))
    return lines if lines else [""]

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
        os.makedirs(CSV_DIR, exist_ok=True)
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
        os.makedirs(os.path.dirname(MENU_FILE), exist_ok=True)
        temp_menu_file = MENU_FILE + ".tmp"
        with open(temp_menu_file, 'w', encoding='utf-8') as f:
            json.dump(new_menu_data, f, indent=2)
        os.replace(temp_menu_file, MENU_FILE)
        return jsonify({"status": "success"})
    except Exception as e:
        app.logger.error(f"Error saving menu: {e}")
        return jsonify({"status": "error", "message": f"Failed to save menu: {str(e)}"}), 500

def print_kitchen_ticket(order_data):
    hprinter = None
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter
        NORMAL_FONT_LINE_WIDTH = 42
        EFFECTIVE_LARGE_FONT_LINE_WIDTH = NORMAL_FONT_LINE_WIDTH // 2
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
        restaurant_name = "To Sushaki"
        padding_restaurant = " " * ((EFFECTIVE_LARGE_FONT_LINE_WIDTH - len(restaurant_name)) // 2)
        if padding_restaurant < " " * 0: padding_restaurant = ""
        ticket_content += to_bytes(padding_restaurant + restaurant_name + "\n")
        ticket_content += SelectFontA + NormalText + BoldOff
        header_text = "Kitchen Order"
        padding_header = " " * ((NORMAL_FONT_LINE_WIDTH - len(header_text)) // 2)
        ticket_content += to_bytes(padding_header + header_text + "\n")
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
        order_num_text = f"Order #: {order_data.get('number', 'N/A')}"
        ticket_content += to_bytes(order_num_text + "\n")
        table_number = order_data.get('tableNumber')
        if table_number and table_number.upper() != 'N/A':
            table_text = f"Table: {table_number}"
            padding_table = " " * ((EFFECTIVE_LARGE_FONT_LINE_WIDTH - len(table_text)) // 2)
            if padding_table < " " * 0: padding_table = ""
            ticket_content += to_bytes(padding_table + table_text + "\n")
        ticket_content += SelectFontA + NormalText + BoldOff
        ticket_content += to_bytes(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        ticket_content += BoldOn + to_bytes("ITEMS:\n") + BoldOff
        grand_total = 0.0
        for item in order_data.get('items', []):
            item_quantity = item.get('quantity', 0)
            item_name_orig = item.get('name', 'Unknown Item')
            item_price_unit = item.get('price', 0.0)
            line_total = item_quantity * item_price_unit
            grand_total += line_total
            ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
            qty_prefix_str = f"{item_quantity}x "
            width_for_name_on_first_line = EFFECTIVE_LARGE_FONT_LINE_WIDTH - len(qty_prefix_str)
            first_line_name_part = item_name_orig
            remaining_name_for_wrap = ""
            if len(item_name_orig) > width_for_name_on_first_line:
                temp_first_part = item_name_orig[:width_for_name_on_first_line + 1]
                wrap_at = temp_first_part.rfind(' ')
                if wrap_at != -1 and wrap_at > 0 :
                    first_line_name_part = item_name_orig[:wrap_at]
                    remaining_name_for_wrap = item_name_orig[wrap_at+1:]
                else:
                    first_line_name_part = item_name_orig[:width_for_name_on_first_line]
                    remaining_name_for_wrap = item_name_orig[width_for_name_on_first_line:]
            ticket_content += to_bytes(qty_prefix_str + first_line_name_part.strip() + "\n")
            if remaining_name_for_wrap.strip():
                indent_str = " " * len(qty_prefix_str)
                sub_lines_max_width = EFFECTIVE_LARGE_FONT_LINE_WIDTH - len(indent_str)
                wrapped_name_lines = word_wrap_text(remaining_name_for_wrap.strip(), sub_lines_max_width)
                for line_part in wrapped_name_lines:
                    ticket_content += to_bytes(indent_str + line_part.strip() + "\n")
            selected_option = item.get('selectedOption', '').strip()
            if selected_option:
                ticket_content += SelectFontA + DoubleHeight + BoldOff
                ticket_content += to_bytes(f"  Option: {selected_option}\n")
            ticket_content += SelectFontA + NormalText + BoldOff
            item_comment = item.get('comment', '').strip()
            if item_comment:
                ticket_content += BoldOn
                comment_indent = "    "
                wrapped_comments = word_wrap_text(f"Note: {item_comment}", NORMAL_FONT_LINE_WIDTH - len(comment_indent))
                for comment_line in wrapped_comments:
                     ticket_content += to_bytes(comment_indent + comment_line + "\n")
                ticket_content += BoldOff
            ticket_content += to_bytes("\n")
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
        total_string = f"TOTAL: EUR {grand_total:.2f}"
        padding_total = " " * (EFFECTIVE_LARGE_FONT_LINE_WIDTH - len(total_string))
        if padding_total < " " * 0: padding_total = ""
        ticket_content += to_bytes(padding_total + total_string + "\n")
        ticket_content += BoldOff
        ticket_content += SelectFontA + NormalText
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n\n")
        universal_comment = order_data.get('universalComment', '').strip()
        if universal_comment:
            ticket_content += SelectFontA + NormalText + BoldOn
            ticket_content += to_bytes("ORDER NOTES:\n") + BoldOff
            ticket_content += SelectFontA + DoubleHeight
            wrapped_universal_comment_lines = word_wrap_text(universal_comment, EFFECTIVE_LARGE_FONT_LINE_WIDTH)
            for line in wrapped_universal_comment_lines:
                ticket_content += to_bytes(line + "\n")
            ticket_content += SelectFontA + NormalText
            ticket_content += to_bytes("\n")
        ticket_content += to_bytes("\n" * 3)
        ticket_content += FullCut

        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for order #{order_data.get('number', 'N/A')}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)
        printer_info = win32print.GetPrinter(hprinter, 2)
        current_status = printer_info['Status']

        PRINTER_STATUS_OFFLINE = 0x00000080
        PRINTER_STATUS_ERROR = 0x00000002
        PRINTER_STATUS_NOT_AVAILABLE = 0x00001000
        PRINTER_STATUS_PAPER_OUT = 0x00000010
        PRINTER_STATUS_USER_INTERVENTION = 0x00000200
        PRINTER_STATUS_PAPER_JAM = 0x00000008
        PRINTER_STATUS_DOOR_OPEN = 0x00000400
        PRINTER_STATUS_NO_TONER = 0x00040000
        PRINTER_STATUS_PAUSED = 0x00000001

        problem_flags_map = {
            PRINTER_STATUS_OFFLINE: "Offline",
            PRINTER_STATUS_ERROR: "Error",
            PRINTER_STATUS_NOT_AVAILABLE: "Not Available",
            PRINTER_STATUS_PAPER_OUT: "Paper Out",
            PRINTER_STATUS_USER_INTERVENTION: "User Intervention Required",
            PRINTER_STATUS_PAPER_JAM: "Paper Jam",
            PRINTER_STATUS_DOOR_OPEN: "Door Open",
            PRINTER_STATUS_NO_TONER: "No Toner/Ink",
            PRINTER_STATUS_PAUSED: "Print Queue Paused"
        }

        active_problems = []
        for flag_value, description in problem_flags_map.items():
            if current_status & flag_value:
                active_problems.append(description)

        if active_problems:
            problems_string = ", ".join(active_problems)
            app.logger.error(f"Printer '{PRINTER_NAME}' reported problem(s): {problems_string} (Status Code: {hex(current_status)}). Order #{order_data.get('number', 'N/A')} will not be printed.")
            return False

        app.logger.info(f"Printer '{PRINTER_NAME}' status: {hex(current_status)} (appears operational). Proceeding with print for order #{order_data.get('number', 'N/A')}.")
        
        doc_started = False
        try:
            win32print.StartDocPrinter(hprinter, 1, (f"Order_{order_data.get('number', 'N/A')}_Ticket_ESCPOST", None, "RAW"))
            doc_started = True
            win32print.StartPagePrinter(hprinter)
            win32print.WritePrinter(hprinter, bytes(ticket_content))
            win32print.EndPagePrinter(hprinter)
            app.logger.info(f"Order #{order_data.get('number', 'N/A')} data sent to printer spooler for '{PRINTER_NAME}'.")
            return True
        except Exception as e_print_doc:
            app.logger.error(f"Error during document printing phase for order #{order_data.get('number', 'N/A')} on '{PRINTER_NAME}': {str(e_print_doc)}")
            return False
        finally:
            if doc_started:
                win32print.EndDocPrinter(hprinter)

    except win32print.error as e_win32:
        error_code = e_win32.winerror
        error_msg = e_win32.strerror
        if error_code == 1801:
             app.logger.error(f"Printing failed for order #{order_data.get('number', 'N/A')}: Invalid printer name '{PRINTER_NAME}'. Error {error_code}: {error_msg}")
        else:
             app.logger.error(f"A win32print error occurred for order #{order_data.get('number', 'N/A')} with printer '{PRINTER_NAME}'. Error {error_code}: {error_msg}")
        return False
    except Exception as e:
        app.logger.error(f"General printing system error for order #{order_data.get('number', 'N/A')} with printer '{PRINTER_NAME}': {str(e)}")
        return False
    finally:
        if hprinter:
            try:
                win32print.ClosePrinter(hprinter)
            except Exception as e_close:
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")

def record_order_in_csv(order_data, was_printed_successfully):
    try:
        printed_status_for_csv = 'Yes' if was_printed_successfully else 'No'
        os.makedirs(CSV_DIR, exist_ok=True)
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(CSV_DIR, f"orders_{date_str}.csv")
        fieldnames = ['order_number', 'table_number', 'timestamp', 'items', 'universal_comment', 'total', 'printed']

        existing_rows = []
        if os.path.exists(filename):
            with open(filename, 'r', newline='', encoding='utf-8') as f_read:
                reader = csv.DictReader(f_read)
                for row in reader:
                    if row.get('order_number', '').lower() != 'total':
                        existing_rows.append(row)

        new_order_total = sum(item.get('price', 0) * item.get('quantity', 0) for item in order_data.get('items', []))
        current_running_total_from_csv = 0.0
        for r in existing_rows:
            try:
                total_val_str = r.get('total')
                if total_val_str:
                    total_val_str = total_val_str.replace('€', '').replace('EUR', '').strip()
                    if total_val_str:
                         current_running_total_from_csv += float(total_val_str)
            except ValueError:
                app.logger.warning(f"Could not parse total '{r.get('total')}' from CSV for order {r.get('order_number')}.")
            except AttributeError:
                app.logger.warning(f"Missing total for order {r.get('order_number')} in CSV.")

        final_running_total = current_running_total_from_csv + new_order_total
        new_row_data = {
            'order_number': order_data.get('number', 'N/A'),
            'table_number': order_data.get('tableNumber', ''),
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'items': " | ".join(
                f"{item.get('quantity', 0)}x {item.get('name', 'N/A')}" +
                (f" (Opt: {item.get('selectedOption','').strip()})" if item.get('selectedOption','').strip() else "") +
                (f" (Note: {item.get('comment','').strip()})" if item.get('comment','').strip() else "") +
                f" (EUR {item.get('price', 0):.2f})"
                for item in order_data.get('items', [])
            ),
            'universal_comment': order_data.get('universalComment', '').strip(),
            'total': f"EUR {new_order_total:.2f}",
            'printed': printed_status_for_csv
        }
        existing_rows.append(new_row_data)

        with open(filename, 'w', newline='', encoding='utf-8') as f_write:
            writer = csv.DictWriter(f_write, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(existing_rows)
            writer.writerow({
                'order_number': 'Total',
                'table_number': '',
                'timestamp': 'End of Day Summary',
                'items': f"{len(existing_rows)} orders",
                'universal_comment': '',
                'total': f"EUR {final_running_total:.2f}",
                'printed': ''
            })
        app.logger.info(f"Order #{order_data.get('number', 'N/A')} logged to CSV. Printed: {printed_status_for_csv}")
        return True
    except Exception as e:
        app.logger.error(f"CSV logging error for order #{order_data.get('number', 'N/A')}: {str(e)}")
        return False

@app.route('/api/orders', methods=['POST'])
def handle_order():
    order_data = request.json
    if not order_data or 'items' not in order_data or not order_data['items']:
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

    order_data['number'] = authoritative_order_number
    if 'tableNumber' not in order_data or not order_data.get('tableNumber', '').strip():
        order_data['tableNumber'] = 'N/A'

    print_succeeded = False
    try:
        print_succeeded = print_kitchen_ticket(order_data)
    except Exception as e_print:
        app.logger.critical(f"CRITICAL PRINT EXCEPTION during call for order #{authoritative_order_number}: {str(e_print)}")
        print_succeeded = False

    if not print_succeeded:
        app.logger.warning(f"Order #{authoritative_order_number} failed to print. Not logging to CSV.")
        return jsonify({
            "status": "error_print_failed",
            "order_number": authoritative_order_number,
            "printed": False,
            "logged": False,
            "message": f"Order #{authoritative_order_number} FAILED TO PRINT. Order was NOT saved. Please check printer and try again."
        }), 200

    csv_log_succeeded = False
    try:
        csv_log_succeeded = record_order_in_csv(order_data, True)
    except Exception as e_csv_call:
        app.logger.critical(f"CRITICAL CSV LOGGING EXCEPTION during call for order #{authoritative_order_number} (after successful print): {str(e_csv_call)}")
        csv_log_succeeded = False

    if not csv_log_succeeded:
        app.logger.error(f"Order #{authoritative_order_number} was PRINTED but FAILED to log to CSV.")
        return jsonify({
            "status": "error_log_failed_after_print",
            "order_number": authoritative_order_number,
            "printed": True,
            "logged": False,
            "message": f"Order #{authoritative_order_number} WAS PRINTED, but failed to save to records. PLEASE NOTIFY STAFF IMMEDIATELY to manually record this order."
        }), 200

    app.logger.info(f"Order #{authoritative_order_number} processed successfully (printed and logged).")
    return jsonify({
        "status": "success",
        "order_number": authoritative_order_number,
        "printed": True,
        "logged": True,
        "message": f"Order #{authoritative_order_number} processed, printed, and logged successfully!"
    })

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    app.logger.info("Application starting up...") # Use app.logger after basicConfig

    try:
        import win32print
    except ImportError:
        app.logger.error("CRITICAL: pywin32 library not found. Printing will not work. Please install it (e.g., pip install pywin32).")
        # Consider exiting if printing is absolutely critical: exit(1)

    os.makedirs(CSV_DIR, exist_ok=True)
    app.logger.info(f"Data files (CSV, order counter, menu) will be used from/saved to: {CSV_DIR}")

    if PRINTER_NAME:
        app.logger.info(f"Attempting to use printer: '{PRINTER_NAME}'")
        try:
            hprinter_test = win32print.OpenPrinter(PRINTER_NAME)
            win32print.ClosePrinter(hprinter_test)
            app.logger.info(f"Printer '{PRINTER_NAME}' seems accessible.")
        except Exception as e:
            app.logger.warning(f"Could not open printer '{PRINTER_NAME}'. It might be offline, misconfigured, or the name is incorrect. Printing will likely fail. Error: {e}")
    else:
        app.logger.warning("PRINTER_NAME is not set in app.py. Printing will fail.")

    app.logger.info(f"Menu file location: {MENU_FILE}")
    if not os.path.exists(MENU_FILE):
        app.logger.warning(f"Menu file {MENU_FILE} does not exist. Creating an empty one.")
        try:
            os.makedirs(os.path.dirname(MENU_FILE), exist_ok=True)
            with open(MENU_FILE, 'w', encoding='utf-8') as mf:
                json.dump({}, mf)
            app.logger.info(f"Empty menu file created at {MENU_FILE}.")
        except Exception as e:
            app.logger.error(f"Could not create empty menu file at {MENU_FILE}. Error: {e}")
    
    app.logger.info("Starting Flask development server...")
    app.run(host='0.0.0.0', port=5000, debug=True)

