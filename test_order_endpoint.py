# Test endpoint to bypass trial and test table integration
import requests
import json

def add_test_endpoint_to_app():
    """Add a test endpoint to app.py that bypasses trial checking"""

    test_endpoint_code = '''
@app.route('/api/test/orders', methods=['POST'])
def handle_test_order():
    """TEST ENDPOINT: Submit order without trial checking for table integration testing"""
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

    # Skip printing and CSV logging for test - focus on table integration
    print_status_summary = "Test Mode - No Printing"
    csv_log_succeeded = True  # Assume success for test

    # Track table session if table management is enabled and order has valid table number
    # NOTE: Table session tracking is independent of CSV logging to ensure restaurant operations continue
    if is_table_management_enabled():
        table_number = order_data_internal.get('tableNumber', '').strip()
        if table_number and table_number != 'N/A':
            try:
                # Calculate order total for table tracking
                order_total = sum(
                    float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) * int(item.get('quantity', 0))
                    for item in order_data_internal.get('items', [])
                )

                # Update table session
                if update_table_session(table_number, authoritative_order_number, order_total):
                    app.logger.info(f"TEST: Order #{authoritative_order_number} tracked for table {table_number} (€{order_total:.2f})")

                    # Broadcast table update via SSE to all devices
                    _sse_broadcast('table_order_added', {
                        "table_id": table_number,
                        "order_number": authoritative_order_number,
                        "order_total": order_total,
                        "new_table_total": get_table_total(table_number),
                        "timestamp": datetime.now().isoformat()
                    })
                else:
                    app.logger.warning(f"Failed to update table session for table {table_number}")
            except Exception as e:
                app.logger.warning(f"Failed to track table session for order #{authoritative_order_number}: {e}")

    return jsonify({
        "status": "success",
        "order_number": authoritative_order_number,
        "printed": print_status_summary,
        "logged": csv_log_succeeded,
        "message": f"TEST: Order #{authoritative_order_number} processed for table integration testing"
    }), 200
'''

    return test_endpoint_code

def test_table_integration():
    """Test the table integration using test endpoint"""
    BASE_URL = 'http://localhost:5000'

    print("🧪 Testing Table Integration with Bypass")
    print("=========================================")

    # Test order data
    order_data = {
        "tableNumber": "1",
        "items": [
            {
                "name": "Test Coffee",
                "quantity": 2,
                "itemPriceWithModifiers": 3.50,
                "basePrice": 3.50
            },
            {
                "name": "Test Sandwich",
                "quantity": 1,
                "itemPriceWithModifiers": 8.50,
                "basePrice": 8.50
            }
        ],
        "universalComment": "Test order for table integration",
        "paymentMethod": "Cash"
    }

    try:
        # Submit test order
        print("📤 Submitting test order...")
        response = requests.post(f"{BASE_URL}/api/test/orders", json=order_data)
        result = response.json()
        print(f"Response: {json.dumps(result, indent=2)}")

        if result.get("status") == "success":
            order_number = result.get("order_number")
            print(f"✅ Test order submitted: #{order_number}")

            # Check table session
            print("🔍 Checking table session...")
            session_response = requests.get(f"{BASE_URL}/api/tables/1/session")
            session_data = session_response.json()
            print(f"Table session: {json.dumps(session_data, indent=2)}")

            if session_data.get("session", {}).get("orders", []):
                print("✅ SUCCESS: Orders found in table session!")
            else:
                print("❌ FAILURE: No orders in table session")

        else:
            print(f"❌ Test order failed: {result.get('message')}")

    except Exception as e:
        print(f"❌ Test failed: {e}")

if __name__ == "__main__":
    print("Test endpoint code generated. You need to manually add this to app.py")
    print("\nTest endpoint code:")
    print("=" * 50)
    print(add_test_endpoint_to_app())
    print("=" * 50)