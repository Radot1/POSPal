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

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s')


# IMPORTANT: Replace "Your_Printer_Name_Here" with your actual printer name
PRINTER_NAME = "80mm Series Printer" # Replace with your actual printer name

# --- File Paths ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')
MENU_FILE = os.path.join(DATA_DIR, 'menu.json')
ORDER_COUNTER_FILE = os.path.join(DATA_DIR, 'order_counter.json')
ORDER_COUNTER_LOCK_FILE = os.path.join(DATA_DIR, 'order_counter.lock') # Lock file for order counter

# --- ESC/POS Commands ---
ESC = b'\x1B'
GS = b'\x1D'
InitializePrinter = ESC + b'@'
BoldOn = ESC + b'E\x01'
BoldOff = ESC + b'E\x00'
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

def to_bytes(s, encoding='cp437'): # cp437 is a common encoding for ESC/POS
    if isinstance(s, bytes):
        return s
    return s.encode(encoding, errors='replace') # 'replace' will put a ? for unmappable chars

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


def print_kitchen_ticket(order_data, copy_info="", original_timestamp_str=None):
    hprinter = None
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter
        NORMAL_FONT_LINE_WIDTH = 42 
        SMALL_FONT_LINE_WIDTH = 56 # Approximate for Font B

        ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
        restaurant_name = "Kyr Stefanos" 
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

            # MODIFICATION: Smartly print large item name and normal price
            left_side = f"{item_quantity}x {item_name_orig}"
            right_side = f"{line_total:.2f}"

            # Calculate space requirements
            large_text_width = len(left_side) * 2
            normal_text_width = len(right_side)
            
            if large_text_width + normal_text_width < NORMAL_FONT_LINE_WIDTH:
                # --- It fits on one line ---
                ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
                ticket_content += to_bytes(left_side)
                
                # Switch to normal font for the price
                ticket_content += NormalText + BoldOff
                
                # Calculate padding to push price to the right
                padding_size = NORMAL_FONT_LINE_WIDTH - large_text_width - normal_text_width
                padding = " " * padding_size
                ticket_content += to_bytes(padding)
                
                # Print the normal-sized price
                ticket_content += to_bytes(right_side + "\n")
            else:
                # --- New handling for multi-line items ---
                ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
                DOUBLE_WIDTH_LINE_CHARS = NORMAL_FONT_LINE_WIDTH // 2
                wrapped_name_lines = word_wrap_text(left_side, DOUBLE_WIDTH_LINE_CHARS)
                
                # Print all lines except last normally
                for line in wrapped_name_lines[:-1]:
                    ticket_content += to_bytes(line + "\n")
                
                # Handle last line with price
                last_line = wrapped_name_lines[-1]
                last_line_width = len(last_line) * 2
                
                # Calculate available space for price
                available_space = NORMAL_FONT_LINE_WIDTH - last_line_width
                padding = " " * max(0, available_space - normal_text_width)
                
                # Print last line (item name) without newline
                ticket_content += to_bytes(last_line)
                
                # Switch to normal font and add price
                ticket_content += NormalText + BoldOff + to_bytes(padding + right_side + "\n")
                ticket_content += AlignLeft  # Reset alignment
            # Ensure font is reset for modifiers
            ticket_content += NormalText + BoldOff 

            # Print modifiers and comments (indented) in normal font
            steak_pref = item.get('steakPreference')
            if steak_pref:
                ticket_content += BoldOn 
                pref_text = f"  Cook: {steak_pref}"
                wrapped_pref_lines = word_wrap_text(pref_text, NORMAL_FONT_LINE_WIDTH, initial_indent="  ", subsequent_indent="    ")
                for pref_line_part in wrapped_pref_lines:
                    ticket_content += to_bytes(pref_line_part + "\n")
                ticket_content += BoldOff

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
        printed_status_for_csv = print_status_message
        os.makedirs(DATA_DIR, exist_ok=True) 
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{date_str}.csv")
        fieldnames = ['order_number', 'table_number', 'timestamp', 'items_summary', 
                      'universal_comment', 'order_total', 'printed_status', 'items_json']

        existing_rows = []
        if os.path.exists(filename):
            with open(filename, 'r', newline='', encoding='utf-8') as f_read:
                reader = csv.DictReader(f_read)
                for row in reader:
                    if row.get('order_number', '').lower() != 'total_for_day': 
                        existing_rows.append(row)
        
        new_order_total = sum(
            float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) * int(item.get('quantity', 0))
            for item in order_data.get('items', [])
        )

        current_running_total_from_csv = 0.0
        for r in existing_rows:
            try:
                total_val_str = r.get('order_total')
                if total_val_str:
                    cleaned_total_str = total_val_str.replace('€', '').replace('EUR', '').strip()
                    if cleaned_total_str: 
                         current_running_total_from_csv += float(cleaned_total_str)
            except ValueError:
                app.logger.warning(f"Could not parse total '{r.get('order_total')}' from CSV for order {r.get('order_number')}.")
            except AttributeError: 
                app.logger.warning(f"Missing total for order {r.get('order_number')} in CSV.")

        final_running_total = current_running_total_from_csv + new_order_total
        
        items_summary_parts = []
        for item in order_data.get('items', []):
            part = f"{item.get('quantity', 0)}x {item.get('name', 'N/A')}"
            
            steak_pref = item.get('steakPreference')
            if steak_pref:
                part += f" (Cook: {steak_pref})"

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
            'order_total': f"EUR {new_order_total:.2f}",
            'printed_status': printed_status_for_csv,
            'items_json': json.dumps(order_data.get('items', [])) 
        }
        existing_rows.append(new_row_data) 

        with open(filename, 'w', newline='', encoding='utf-8') as f_write:
            writer = csv.DictWriter(f_write, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(existing_rows) 
            writer.writerow({
                'order_number': 'Total_For_Day', 
                'table_number': '',
                'timestamp': 'Summary as of ' + datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'items_summary': f"{len(existing_rows)} orders processed",
                'universal_comment': '',
                'order_total': f"EUR {final_running_total:.2f}",
                'printed_status': '',
                'items_json': '' 
            })
        app.logger.info(f"Order #{order_data.get('number', 'N/A')} logged to CSV. Printed: {printed_status_for_csv}. New daily total: EUR {final_running_total:.2f}")
        return True
    except Exception as e:
        app.logger.error(f"CSV logging error for order #{order_data.get('number', 'N/A')}: {str(e)}")
        return False


@app.route('/api/orders', methods=['POST'])
def handle_order():
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
        'universalComment': order_data_from_client.get('universalComment', '')
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
                if row.get('order_number', '').lower() != 'total_for_day' and row.get('items_json'): 
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


if __name__ == '__main__':
    app.logger.info("Application starting up...") 

    if not PRINTER_NAME or PRINTER_NAME == "Your_Printer_Name_Here":
        app.logger.warning("PRINTER_NAME is not set or is set to the placeholder in app.py. Printing will fail. Please configure it.")
    else:
        try:
            import win32print
            app.logger.info(f"Attempting to access printer: '{PRINTER_NAME}' on startup.")
            try:
                hprinter_test = win32print.OpenPrinter(PRINTER_NAME)
                win32print.ClosePrinter(hprinter_test)
                app.logger.info(f"Printer '{PRINTER_NAME}' seems accessible.")
            except Exception as e:
                app.logger.warning(f"Could not open printer '{PRINTER_NAME}' on startup. It might be offline, misconfigured, or the name is incorrect. Printing will likely fail. Error: {e}")
        except ImportError:
            app.logger.error("CRITICAL: pywin32 library not found. Printing will not work. Please install it (e.g., pip install pywin32).")
        except Exception as e_main_printer_check:
            app.logger.error(f"An unexpected error occurred during printer check for '{PRINTER_NAME}': {e_main_printer_check}")


    os.makedirs(DATA_DIR, exist_ok=True) 
    app.logger.info(f"Data files (CSV, order counter, menu) will be used from/saved to: {DATA_DIR}")

    app.logger.info(f"Menu file location: {MENU_FILE}")
    if not os.path.exists(MENU_FILE):
        app.logger.warning(f"Menu file {MENU_FILE} does not exist. Creating an empty one.")
        try:
            with open(MENU_FILE, 'w', encoding='utf-8') as mf:
                json.dump({}, mf) 
            app.logger.info(f"Empty menu file created at {MENU_FILE}.")
        except Exception as e:
            app.logger.error(f"Could not create empty menu file at {MENU_FILE}. Error: {e}")
    
    app.logger.info("Starting Flask development server...")
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=False)
