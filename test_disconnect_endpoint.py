"""
Test script for /api/disconnect-license endpoint

This script provides manual testing utilities for the license disconnect endpoint.
Run this while the Flask server is running on localhost:5000.

Usage:
    python test_disconnect_endpoint.py
"""

import requests
import json
import time

BASE_URL = "http://localhost:5000"
ENDPOINT = f"{BASE_URL}/api/disconnect-license"

# Test configurations
TEST_EMAIL = "test@example.com"
TEST_TOKEN = "POSPAL-TEST-TEST-TEST"
TEST_PASSWORD = "9999"

def print_response(response, test_name):
    """Pretty print response"""
    print(f"\n{'='*60}")
    print(f"Test: {test_name}")
    print(f"{'='*60}")
    print(f"Status Code: {response.status_code}")
    print(f"Response:")
    try:
        print(json.dumps(response.json(), indent=2))
    except:
        print(response.text)
    print(f"{'='*60}\n")

def test_happy_path():
    """Test 1: Happy path - valid disconnect"""
    data = {
        "email": TEST_EMAIL,
        "unlock_token": TEST_TOKEN,
        "confirm_password": TEST_PASSWORD
    }

    response = requests.post(ENDPOINT, json=data)
    print_response(response, "Happy Path - Valid Disconnect")

    return response.status_code == 200

def test_invalid_password():
    """Test 2: Invalid management password"""
    data = {
        "email": TEST_EMAIL,
        "unlock_token": TEST_TOKEN,
        "confirm_password": "wrong_password"
    }

    response = requests.post(ENDPOINT, json=data)
    print_response(response, "Invalid Management Password")

    return response.status_code == 401

def test_missing_fields():
    """Test 3: Missing required fields"""
    data = {
        "email": TEST_EMAIL
        # Missing unlock_token and confirm_password
    }

    response = requests.post(ENDPOINT, json=data)
    print_response(response, "Missing Required Fields")

    return response.status_code == 400

def test_invalid_email():
    """Test 4: Invalid email format"""
    data = {
        "email": "not-an-email",
        "unlock_token": TEST_TOKEN,
        "confirm_password": TEST_PASSWORD
    }

    response = requests.post(ENDPOINT, json=data)
    print_response(response, "Invalid Email Format")

    return response.status_code == 400

def test_invalid_json():
    """Test 5: Invalid JSON request"""
    response = requests.post(ENDPOINT,
                            data="not json",
                            headers={"Content-Type": "application/json"})
    print_response(response, "Invalid JSON")

    return response.status_code == 400

def test_rate_limiting():
    """Test 6: Rate limiting (3 per 5 min per email)"""
    data = {
        "email": "rate-limit-test@example.com",
        "unlock_token": TEST_TOKEN,
        "confirm_password": TEST_PASSWORD
    }

    results = []
    for i in range(4):
        print(f"\nAttempt {i+1}/4...")
        response = requests.post(ENDPOINT, json=data)
        results.append(response.status_code)
        print(f"Status: {response.status_code}")
        if response.status_code == 429:
            print("Rate limit hit!")
            print(json.dumps(response.json(), indent=2))
        time.sleep(0.5)

    print(f"\nResults: {results}")
    print(f"Expected: First 3 should pass (200/207), 4th should be 429")

    return results[3] == 429

def test_system_status():
    """Test helper: Check system status endpoint"""
    response = requests.get(f"{BASE_URL}/api/system_status")
    print_response(response, "System Status (Helper)")

    return response.status_code == 200

def run_all_tests():
    """Run all tests"""
    print(f"\n{'#'*60}")
    print("# License Disconnect Endpoint Test Suite")
    print(f"# Testing: {ENDPOINT}")
    print(f"{'#'*60}\n")

    tests = [
        ("System Status Check", test_system_status),
        ("Happy Path", test_happy_path),
        ("Invalid Password", test_invalid_password),
        ("Missing Fields", test_missing_fields),
        ("Invalid Email", test_invalid_email),
        ("Invalid JSON", test_invalid_json),
        ("Rate Limiting", test_rate_limiting),
    ]

    results = []
    for test_name, test_func in tests:
        try:
            passed = test_func()
            results.append((test_name, "PASS" if passed else "FAIL"))
        except Exception as e:
            print(f"\nError in {test_name}: {e}")
            results.append((test_name, "ERROR"))

        # Small delay between tests
        time.sleep(1)

    # Print summary
    print(f"\n{'#'*60}")
    print("# Test Summary")
    print(f"{'#'*60}\n")

    for test_name, result in results:
        status_symbol = "✓" if result == "PASS" else "✗"
        print(f"{status_symbol} {test_name}: {result}")

    passed = sum(1 for _, r in results if r == "PASS")
    total = len(results)
    print(f"\nTotal: {passed}/{total} tests passed")

def interactive_test():
    """Interactive testing mode"""
    print(f"\n{'#'*60}")
    print("# Interactive Disconnect Test")
    print(f"{'#'*60}\n")

    email = input(f"Email [{TEST_EMAIL}]: ").strip() or TEST_EMAIL
    token = input(f"Unlock Token [{TEST_TOKEN}]: ").strip() or TEST_TOKEN
    password = input(f"Management Password [{TEST_PASSWORD}]: ").strip() or TEST_PASSWORD

    data = {
        "email": email,
        "unlock_token": token,
        "confirm_password": password
    }

    print(f"\nSending request to: {ENDPOINT}")
    print(f"Data: {json.dumps(data, indent=2)}")

    confirm = input("\nProceed? [y/N]: ").strip().lower()
    if confirm != 'y':
        print("Cancelled.")
        return

    response = requests.post(ENDPOINT, json=data)
    print_response(response, "Interactive Disconnect")

if __name__ == "__main__":
    import sys

    print("\n" + "="*60)
    print("License Disconnect Endpoint Test Suite")
    print("="*60)
    print("\nOptions:")
    print("1. Run all automated tests")
    print("2. Interactive test (custom input)")
    print("3. Test specific scenario")
    print("0. Exit")

    choice = input("\nSelect option [1]: ").strip() or "1"

    if choice == "1":
        run_all_tests()
    elif choice == "2":
        interactive_test()
    elif choice == "3":
        print("\nAvailable tests:")
        print("1. Happy Path")
        print("2. Invalid Password")
        print("3. Missing Fields")
        print("4. Invalid Email")
        print("5. Invalid JSON")
        print("6. Rate Limiting")
        print("7. System Status")

        test_choice = input("\nSelect test [1]: ").strip() or "1"
        tests = [
            test_happy_path,
            test_invalid_password,
            test_missing_fields,
            test_invalid_email,
            test_invalid_json,
            test_rate_limiting,
            test_system_status
        ]

        try:
            idx = int(test_choice) - 1
            if 0 <= idx < len(tests):
                tests[idx]()
            else:
                print("Invalid test number")
        except ValueError:
            print("Invalid input")
    elif choice == "0":
        print("Goodbye!")
    else:
        print("Invalid option")
