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
    
    # Split text into paragraphs (respect existing newlines)
    paragraphs = text.split('\n')
    
    for i, paragraph_text in enumerate(paragraphs):
        if not paragraph_text.strip() and i < len(paragraphs) -1 : # if it's an empty line not at the end
            lines.append(initial_indent if not lines else subsequent_indent) # add an empty line with indent
            continue

        current_line = []
        current_length = 0
        words = paragraph_text.split(' ')
        
        # Determine current indent based on whether it's the first line of the paragraph
        # and if it's the very first line of the whole text.
        current_indent = initial_indent if not lines else subsequent_indent
        
        for word_idx, word in enumerate(words):
            if not word: # Handle multiple spaces by adding a space if not first word
                if current_line: current_line.append("") 
                continue

            # Check if the word itself is longer than the available width
            available_width_for_word = max_width - len(current_indent) - current_length - (1 if current_line else 0)
            if len(word) > available_width_for_word and not current_line : # Word is too long and it's the first on the line
                # Split the long word
                part_fits = word[:available_width_for_word]
                remaining_part = word[available_width_for_word:]
                lines.append(current_indent + part_fits)
                
                # Handle the rest of the long word, applying subsequent indent
                while remaining_part:
                    available_width_for_remaining = max_width - len(subsequent_indent)
                    part_fits = remaining_part[:available_width_for_remaining]
                    remaining_part = remaining_part[available_width_for_remaining:]
                    lines.append(subsequent_indent + part_fits)
                current_line = []
                current_length = 0
                current_indent = subsequent_indent # Next line will use subsequent_indent
                continue


            if current_length + len(word) + (1 if current_line else 0) <= (max_width - len(current_indent)):
                current_line.append(word)
                current_length += len(word) + (1 if len(current_line) > 1 else 0) # Add 1 for space if not the first word on line
            else:
                if current_line: # Finish current line
                    lines.append(current_indent + " ".join(current_line))
                
                # Start new line with the current word
                current_line = [word]
                current_length = len(word)
                current_indent = subsequent_indent # Subsequent lines use subsequent_indent
        
        if current_line: # Add any remaining part of the line
            lines.append(current_indent + " ".join(current_line))
            
    return lines if lines else [initial_indent]


def get_next_daily_order_number():
    lock_acquired = False
    for _ in range(10): # Retry acquiring lock
        try:
            # Attempt to create the lock file exclusively
            fd = os.open(ORDER_COUNTER_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.close(fd) # Close immediately, file presence is the lock
            lock_acquired = True
            break
        except FileExistsError:
            time.sleep(0.1) # Wait and retry
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
                current_counter_val = 0 # Reset if file is corrupt or missing
            except Exception as e: # Catch any other unexpected errors
                 app.logger.error(f"Unexpected error reading {ORDER_COUNTER_FILE}: {e}. Resetting counter for the day.")
                 current_counter_val = 0

        next_counter_val = current_counter_val + 1
        counter_data_to_save = {"date": today_str, "counter": next_counter_val}
        
        # Atomic write using a temporary file
        temp_counter_file = ORDER_COUNTER_FILE + ".tmp"
        with open(temp_counter_file, 'w') as f:
            json.dump(counter_data_to_save, f)
        os.replace(temp_counter_file, ORDER_COUNTER_FILE) # Atomic rename

        return next_counter_val
    except Exception as e_update:
        app.logger.critical(f"CRITICAL COUNTER UPDATE FAILURE: {datetime.now()} - {e_update}")
        # Do not remove lock here if the update itself failed, as the state might be inconsistent.
        # However, if the lock was acquired, it should ideally be released in a finally block.
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
            return jsonify({}) # Return empty object if menu file doesn't exist
        with open(MENU_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return jsonify(data)
    except FileNotFoundError: # Should be caught by the os.path.exists check, but good for robustness
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
            json.dump(new_menu_data, f, indent=2) # Save with indentation for readability
        os.replace(temp_menu_file, MENU_FILE) # Atomic rename
        return jsonify({"status": "success"})
    except Exception as e:
        app.logger.error(f"Error saving menu: {e}")
        return jsonify({"status": "error", "message": f"Failed to save menu: {str(e)}"}), 500


def print_kitchen_ticket(order_data):
    hprinter = None
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter
        NORMAL_FONT_LINE_WIDTH = 42  # For Font A (standard)
        EFFECTIVE_LARGE_FONT_LINE_WIDTH = NORMAL_FONT_LINE_WIDTH // 2 # For DoubleHeightWidth

        # Restaurant Name - Centered, Large, Bold
        ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
        restaurant_name = "Kyr Stefanos" 
        ticket_content += to_bytes(restaurant_name + "\n")
        
        # "Kitchen Order" - Centered, Normal Font, Not Bold
        ticket_content += AlignCenter + SelectFontA + NormalText + BoldOff 
        header_text = "Kitchen Order" 
        ticket_content += to_bytes(header_text + "\n")
        
        ticket_content += AlignLeft # Reset alignment for subsequent lines
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        
        # Order Number - Large, Bold
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
        order_num_text = f"Order #: {order_data.get('number', 'N/A')}"
        ticket_content += to_bytes(order_num_text + "\n")
        
        # Table Number - Large, Bold (if exists)
        table_number = order_data.get('tableNumber')
        if table_number and table_number.upper() != 'N/A':
            table_text = f"Table: {table_number}"
            ticket_content += to_bytes(table_text + "\n")
            
        # Time - Normal Font
        ticket_content += SelectFontA + NormalText + BoldOff
        ticket_content += to_bytes(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        
        ticket_content += BoldOn + to_bytes("ITEMS:\n") + BoldOff
        
        grand_total = 0.0
        for item in order_data.get('items', []):
            item_quantity = item.get('quantity', 0)
            item_name_orig = item.get('name', 'Unknown Item')
            # Use itemPriceWithModifiers for accurate pricing, fallback to basePrice
            item_price_unit = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
            line_total = item_quantity * item_price_unit
            grand_total += line_total

            # Item Quantity and Name - Large, Bold
            ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
            qty_prefix_str = f"{item_quantity}x "
            
            # Word wrap for item name if it's too long
            wrapped_name_lines = word_wrap_text(item_name_orig, EFFECTIVE_LARGE_FONT_LINE_WIDTH, initial_indent=qty_prefix_str, subsequent_indent=" " * len(qty_prefix_str))
            for line_part in wrapped_name_lines:
                 ticket_content += to_bytes(line_part + "\n")

            ticket_content += BoldOff # Turn off bold for options/notes

            # Steak Cooking Preference
            steak_pref = item.get('steakPreference')
            if steak_pref:
                ticket_content += SelectFontA + DoubleHeight + BoldOn # Make steak pref stand out
                pref_text = f"  Cook: {steak_pref}"
                ticket_content += to_bytes(pref_text + "\n")
                ticket_content += BoldOff

            # General Selected Options with Price Change
            general_options = item.get('generalSelectedOptions', [])
            if general_options:
                ticket_content += SelectFontA + DoubleHeight # Still large, but not bold for general options
                for opt in general_options:
                    opt_name = opt.get('name', 'N/A')
                    opt_price_change = float(opt.get('priceChange', 0.0))
                    price_change_str = ""
                    if opt_price_change != 0:
                        price_change_str = f" ({'+' if opt_price_change > 0 else ''}EUR {opt_price_change:.2f})"
                    
                    option_line = f"  + {opt_name}{price_change_str}"
                    # Word wrap for long option lines
                    wrapped_option_lines = word_wrap_text(option_line, EFFECTIVE_LARGE_FONT_LINE_WIDTH, initial_indent="", subsequent_indent="    ") # Subsequent indent for wrapped option lines
                    for opt_line_part in wrapped_option_lines:
                        ticket_content += to_bytes(opt_line_part + "\n")

            # Item Comment
            item_comment = item.get('comment', '').strip()
            if item_comment:
                ticket_content += SelectFontA + NormalText + BoldOn                 
                wrapped_comments = word_wrap_text(f"Note: {item_comment}", NORMAL_FONT_LINE_WIDTH, initial_indent="    ", subsequent_indent="    ")
                for comment_line in wrapped_comments:
                     ticket_content += to_bytes(comment_line + "\n")
                ticket_content += BoldOff                  

            # Item Pricing (per unit and line total) - Normal Font, Right Aligned
            ticket_content += SelectFontA + NormalText + AlignRight
            pricing_text_line1 = f"{item_quantity} x EUR {item_price_unit:.2f}"
            ticket_content += to_bytes(pricing_text_line1 + "\n")
            pricing_text_line2 = f"= EUR {line_total:.2f}"
            ticket_content += to_bytes(pricing_text_line2 + "\n")
            ticket_content += AlignLeft # Reset alignment
            ticket_content += to_bytes("\n") # Extra space after each item
        
        # Separator and Grand Total
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn + AlignRight
        total_string = f"TOTAL: EUR {grand_total:.2f}"
        ticket_content += to_bytes(total_string + "\n")
        ticket_content += BoldOff + AlignLeft
        
        ticket_content += SelectFontA + NormalText
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n\n")
        
        # Universal Order Comment
        universal_comment = order_data.get('universalComment', '').strip()
        if universal_comment:
            ticket_content += SelectFontA + NormalText + BoldOn
            ticket_content += to_bytes("ORDER NOTES:\n") + BoldOff
            ticket_content += SelectFontA + DoubleHeight # Make universal comment large
            wrapped_universal_comment_lines = word_wrap_text(universal_comment, EFFECTIVE_LARGE_FONT_LINE_WIDTH, initial_indent="", subsequent_indent="") 
            for line in wrapped_universal_comment_lines:
                ticket_content += to_bytes(line + "\n")
            ticket_content += SelectFontA + NormalText # Reset font
            ticket_content += to_bytes("\n")
            
        ticket_content += to_bytes("\n" * 3) # Feed paper
        ticket_content += FullCut

        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for order #{order_data.get('number', 'N/A')}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)
        
        # Check printer status before printing
        printer_info = win32print.GetPrinter(hprinter, 2)
        current_status = printer_info['Status']
        app.logger.info(f"Printer '{PRINTER_NAME}' current status code: {hex(current_status)}")

        PRINTER_STATUS_OFFLINE = 0x00000080
        PRINTER_STATUS_ERROR = 0x00000002
        PRINTER_STATUS_NOT_AVAILABLE = 0x00001000 # Often means powered off or disconnected
        PRINTER_STATUS_PAPER_OUT = 0x00000010
        PRINTER_STATUS_USER_INTERVENTION = 0x00000200
        PRINTER_STATUS_PAPER_JAM = 0x00000008
        PRINTER_STATUS_DOOR_OPEN = 0x00000400 # Cover open
        PRINTER_STATUS_NO_TONER = 0x00040000 # Unlikely for thermal, but good to have
        PRINTER_STATUS_PAUSED = 0x00000001
        # PRINTER_STATUS_PRINTING = 0x00000004 # If printer is busy with another job

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
            app.logger.error(f"Printer '{PRINTER_NAME}' reported problem(s): {problems_string} (Status Code: {hex(current_status)}). Order #{order_data.get('number', 'N/A')} will not be printed.")
            if hprinter: win32print.ClosePrinter(hprinter) 
            return False # Indicate print failure

        app.logger.info(f"Printer '{PRINTER_NAME}' status appears operational. Proceeding with print for order #{order_data.get('number', 'N/A')}.")
        
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
            return False # Indicate print failure
        finally:
            if doc_started:
                win32print.EndDocPrinter(hprinter)

    except win32print.error as e_win32: 
        error_code = e_win32.winerror
        error_msg = e_win32.strerror
        if error_code == 1801: # ERROR_INVALID_PRINTER_NAME
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
            except Exception as e_close: # Catch error during close if any
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")


def record_order_in_csv(order_data, was_printed_successfully):
    try:
        printed_status_for_csv = 'Yes' if was_printed_successfully else 'No'
        os.makedirs(DATA_DIR, exist_ok=True) # Ensure DATA_DIR exists
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{date_str}.csv")
        # Added base_price_per_unit and final_price_per_unit for clarity
        fieldnames = ['order_number', 'table_number', 'timestamp', 'items_summary', 'universal_comment', 'order_total', 'printed_status']

        existing_rows = []
        if os.path.exists(filename):
            with open(filename, 'r', newline='', encoding='utf-8') as f_read:
                reader = csv.DictReader(f_read)
                for row in reader:
                    if row.get('order_number', '').lower() != 'total_for_day': # Ensure we don't re-add summary rows
                        existing_rows.append(row)
        
        # Calculate total for the new order based on itemPriceWithModifiers
        new_order_total = sum(
            float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) * int(item.get('quantity', 0))
            for item in order_data.get('items', [])
        )

        # Calculate running total from existing CSV data
        current_running_total_from_csv = 0.0
        for r in existing_rows:
            try:
                total_val_str = r.get('order_total')
                if total_val_str:
                    # Remove currency symbols and whitespace before parsing
                    cleaned_total_str = total_val_str.replace('€', '').replace('EUR', '').strip()
                    if cleaned_total_str: # Ensure not empty after cleaning
                         current_running_total_from_csv += float(cleaned_total_str)
            except ValueError:
                app.logger.warning(f"Could not parse total '{r.get('order_total')}' from CSV for order {r.get('order_number')}.")
            except AttributeError: # Handles if 'total' key is missing
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
            
            # Add final unit price to the summary for this item
            unit_price_final = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
            part += f" [Unit EUR {unit_price_final:.2f}]"
            items_summary_parts.append(part)

        new_row_data = {
            'order_number': order_data.get('number', 'N/A'),
            'table_number': order_data.get('tableNumber', ''),
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'items_summary': " | ".join(items_summary_parts), # More detailed item summary
            'universal_comment': order_data.get('universalComment', '').strip(),
            'order_total': f"EUR {new_order_total:.2f}",
            'printed_status': printed_status_for_csv
        }
        existing_rows.append(new_row_data) # Add new order

        # Write all rows back, including the new one, then the summary
        with open(filename, 'w', newline='', encoding='utf-8') as f_write:
            writer = csv.DictWriter(f_write, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(existing_rows) # Write all individual orders
            # Add the summary row
            writer.writerow({
                'order_number': 'Total_For_Day', # Clearer identifier for summary
                'table_number': '',
                'timestamp': 'Summary as of ' + datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'items_summary': f"{len(existing_rows)} orders processed",
                'universal_comment': '',
                'order_total': f"EUR {final_running_total:.2f}",
                'printed_status': '' # Not applicable for summary
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

    # Prepare order_data for internal use, ensuring all fields are present
    # Client sends basePrice, itemPriceWithModifiers, steakPreference, generalSelectedOptions
    order_data_internal = {
        'number': authoritative_order_number,
        'tableNumber': order_data_from_client.get('tableNumber', '').strip() or 'N/A',
        'items': order_data_from_client.get('items', []), 
        'universalComment': order_data_from_client.get('universalComment', '')
    }


    print_succeeded = False
    try:
        print_succeeded = print_kitchen_ticket(order_data_internal)
    except Exception as e_print:
        app.logger.critical(f"CRITICAL PRINT EXCEPTION during call for order #{authoritative_order_number}: {str(e_print)}")
        print_succeeded = False # Ensure it's false on any exception

    if not print_succeeded:
        app.logger.warning(f"Order #{authoritative_order_number} failed to print. Not logging to CSV.")
        return jsonify({
            "status": "error_print_failed",
            "order_number": authoritative_order_number,
            "printed": False,
            "logged": False,
            "message": f"Order #{authoritative_order_number} FAILED TO PRINT. Order was NOT saved. Please check printer and try again."
        }), 200 # 200 OK but with error status in body, as frontend expects this

    csv_log_succeeded = False
    try:
        csv_log_succeeded = record_order_in_csv(order_data_internal, True) # True because print_succeeded was true to reach here
    except Exception as e_csv_call:
        app.logger.critical(f"CRITICAL CSV LOGGING EXCEPTION during call for order #{authoritative_order_number} (after successful print): {str(e_csv_call)}")
        csv_log_succeeded = False

    if not csv_log_succeeded:
        app.logger.error(f"Order #{authoritative_order_number} was PRINTED but FAILED to log to CSV.")
        return jsonify({
            "status": "error_log_failed_after_print",
            "order_number": authoritative_order_number,
            "printed": True, # Print was successful
            "logged": False,
            "message": f"Order #{authoritative_order_number} WAS PRINTED, but failed to save to records. PLEASE NOTIFY STAFF IMMEDIATELY to manually record this order."
        }), 200 # 200 OK but with error status

    app.logger.info(f"Order #{authoritative_order_number} processed successfully (printed and logged).")
    return jsonify({
        "status": "success",
        "order_number": authoritative_order_number,
        "printed": True,
        "logged": True,
        "message": f"Order #{authoritative_order_number} processed, printed, and logged successfully!"
    })

if __name__ == '__main__':
    # Logging is configured at the top now
    app.logger.info("Application starting up...") 

    try:
        import win32print
        # Test printer access on startup
        if PRINTER_NAME:
            app.logger.info(f"Attempting to access printer: '{PRINTER_NAME}' on startup.")
            try:
                hprinter_test = win32print.OpenPrinter(PRINTER_NAME)
                win32print.ClosePrinter(hprinter_test)
                app.logger.info(f"Printer '{PRINTER_NAME}' seems accessible.")
            except Exception as e:
                app.logger.warning(f"Could not open printer '{PRINTER_NAME}' on startup. It might be offline, misconfigured, or the name is incorrect. Printing will likely fail. Error: {e}")
        else:
            app.logger.warning("PRINTER_NAME is not set in app.py. Printing will fail.")
    except ImportError:
        app.logger.error("CRITICAL: pywin32 library not found. Printing will not work. Please install it (e.g., pip install pywin32).")
        # Consider exiting if printing is absolutely critical: exit(1)

    os.makedirs(DATA_DIR, exist_ok=True) # Ensure data directory exists
    app.logger.info(f"Data files (CSV, order counter, menu) will be used from/saved to: {DATA_DIR}")

    app.logger.info(f"Menu file location: {MENU_FILE}")
    if not os.path.exists(MENU_FILE):
        app.logger.warning(f"Menu file {MENU_FILE} does not exist. Creating an empty one.")
        try:
            with open(MENU_FILE, 'w', encoding='utf-8') as mf:
                json.dump({}, mf) # Create an empty JSON object for the menu
            app.logger.info(f"Empty menu file created at {MENU_FILE}.")
        except Exception as e:
            app.logger.error(f"Could not create empty menu file at {MENU_FILE}. Error: {e}")
    
    app.logger.info("Starting Flask development server...")
    app.run(host='0.0.0.0', port=5000, debug=True)
