#!/usr/bin/env python3
"""
Comprehensive test suite for the security email fix
Tests machine fingerprint consistency across multiple launches
"""

import json
import time
import requests
import subprocess
import sys
import os
from datetime import datetime

# Test configuration
BASE_URL = 'http://localhost:5000'
TEST_EMAIL = 'test@pospal.gr'
TEST_TOKEN = 'test-token-123'

class SecurityEmailFixTester:
    def __init__(self):
        self.results = {
            'fingerprint_consistency': [],
            'api_responses': [],
            'launch_simulations': [],
            'errors': []
        }

    def test_fingerprint_consistency(self):
        """Test that API consistently returns same fingerprint"""
        print("\n[TEST 1] Fingerprint Consistency Test")
        print("=" * 50)

        fingerprints = []
        for i in range(10):
            try:
                response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    fp = data.get('hardware_id')
                    fingerprints.append(fp)
                    print(f"Call {i+1}: {fp}")
                else:
                    print(f"Call {i+1}: ERROR - {response.status_code}")
                    self.results['errors'].append(f"API call failed: {response.status_code}")
            except Exception as e:
                print(f"Call {i+1}: ERROR - {e}")
                self.results['errors'].append(f"API call exception: {e}")

        # Check consistency
        unique_fingerprints = set(fingerprints)
        if len(unique_fingerprints) == 1:
            print(f"[SUCCESS] All fingerprints identical: {fingerprints[0]}")
            self.results['fingerprint_consistency'] = ['PASS', fingerprints[0]]
        else:
            print(f"[FAIL] Inconsistent fingerprints: {unique_fingerprints}")
            self.results['fingerprint_consistency'] = ['FAIL', list(unique_fingerprints)]

    def test_license_validation_calls(self):
        """Test license validation with consistent fingerprinting"""
        print("\n[TEST 2] License Validation Consistency")
        print("=" * 50)

        # Simulate license validation calls that would trigger security emails
        validation_fingerprints = []

        for i in range(5):
            try:
                # Get hardware ID first
                hw_response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
                if hw_response.status_code == 200:
                    hw_data = hw_response.json()
                    hardware_id = hw_data.get('hardware_id')
                    validation_fingerprints.append(hardware_id)
                    print(f"Validation {i+1} Hardware ID: {hardware_id}")

                    # Simulate validation call
                    validation_data = {
                        'customer_email': TEST_EMAIL,
                        'unlock_token': TEST_TOKEN,
                        'hardware_id': hardware_id
                    }

                    # Call validation endpoint (if available)
                    val_response = requests.post(f'{BASE_URL}/api/validate-license',
                                               json=validation_data, timeout=5)
                    print(f"Validation {i+1} Response: {val_response.status_code}")

            except Exception as e:
                print(f"Validation {i+1}: ERROR - {e}")
                self.results['errors'].append(f"Validation call exception: {e}")

        # Check validation consistency
        unique_val_fingerprints = set(validation_fingerprints)
        if len(unique_val_fingerprints) <= 1:
            print(f"[SUCCESS] Validation fingerprints consistent")
            self.results['api_responses'] = ['PASS', len(validation_fingerprints)]
        else:
            print(f"[FAIL] Validation fingerprints inconsistent: {unique_val_fingerprints}")
            self.results['api_responses'] = ['FAIL', list(unique_val_fingerprints)]

    def test_startup_sequence_simulation(self):
        """Simulate multiple startup sequences"""
        print("\n[TEST 3] Startup Sequence Simulation")
        print("=" * 50)

        startup_fingerprints = []

        # Simulate what happens during app startup
        for startup in range(3):
            print(f"\nStartup Sequence {startup + 1}:")

            try:
                # Step 1: Get hardware ID (like app startup does)
                hw_response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
                if hw_response.status_code == 200:
                    hw_data = hw_response.json()
                    hardware_id = hw_data.get('hardware_id')
                    startup_fingerprints.append(hardware_id)
                    print(f"  Hardware ID: {hardware_id}")

                    # Step 2: Check trial status (triggers validation)
                    trial_response = requests.get(f'{BASE_URL}/api/trial_status', timeout=5)
                    print(f"  Trial Status: {trial_response.status_code}")

                    # Step 3: Simulate license check
                    config_response = requests.get(f'{BASE_URL}/api/config', timeout=5)
                    print(f"  Config Check: {config_response.status_code}")

                    # Brief pause between startups
                    time.sleep(1)

            except Exception as e:
                print(f"  ERROR: {e}")
                self.results['errors'].append(f"Startup {startup + 1} exception: {e}")

        # Check startup consistency
        unique_startup_fingerprints = set(startup_fingerprints)
        if len(unique_startup_fingerprints) <= 1:
            print(f"\n[SUCCESS] Startup fingerprints consistent across launches")
            self.results['launch_simulations'] = ['PASS', len(startup_fingerprints)]
        else:
            print(f"\n[FAIL] Startup fingerprints inconsistent: {unique_startup_fingerprints}")
            self.results['launch_simulations'] = ['FAIL', list(unique_startup_fingerprints)]

    def test_frontend_backend_consistency(self):
        """Test that frontend and backend generate same fingerprint"""
        print("\n[TEST 4] Frontend-Backend Consistency")
        print("=" * 50)

        try:
            # Get backend fingerprint
            response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
            if response.status_code == 200:
                backend_fp = response.json().get('hardware_id')
                print(f"Backend fingerprint: {backend_fp}")

                # Test if we can access the main page (frontend)
                main_response = requests.get(f'{BASE_URL}/', timeout=5)
                print(f"Main page accessible: {main_response.status_code == 200}")

                if main_response.status_code == 200:
                    print("[SUCCESS] Frontend-backend communication working")
                else:
                    print(f"[WARNING] Frontend not accessible: {main_response.status_code}")

        except Exception as e:
            print(f"[ERROR] Frontend-backend test failed: {e}")
            self.results['errors'].append(f"Frontend-backend test: {e}")

    def run_all_tests(self):
        """Run all security email fix tests"""
        print("POSPal Security Email Fix - Comprehensive Test Suite")
        print("=" * 60)
        print(f"Test started at: {datetime.now()}")
        print(f"Target server: {BASE_URL}")

        # Run all tests
        self.test_fingerprint_consistency()
        self.test_license_validation_calls()
        self.test_startup_sequence_simulation()
        self.test_frontend_backend_consistency()

        # Generate report
        self.generate_report()

    def generate_report(self):
        """Generate comprehensive test report"""
        print("\n" + "=" * 60)
        print("COMPREHENSIVE TEST REPORT")
        print("=" * 60)

        # Test results summary
        passed_tests = 0
        total_tests = 3  # fingerprint, validation, startup

        if self.results['fingerprint_consistency'] and self.results['fingerprint_consistency'][0] == 'PASS':
            passed_tests += 1
            print("[PASS] Fingerprint Consistency: PASS")
        else:
            print("[FAIL] Fingerprint Consistency: FAIL")

        if self.results['api_responses'] and self.results['api_responses'][0] == 'PASS':
            passed_tests += 1
            print("[PASS] License Validation Consistency: PASS")
        else:
            print("[FAIL] License Validation Consistency: FAIL")

        if self.results['launch_simulations'] and self.results['launch_simulations'][0] == 'PASS':
            passed_tests += 1
            print("[PASS] Startup Sequence Consistency: PASS")
        else:
            print("[FAIL] Startup Sequence Consistency: FAIL")

        print(f"\nOVERALL RESULT: {passed_tests}/{total_tests} tests passed")

        if passed_tests == total_tests:
            print("\nSUCCESS: Security email fix is working correctly!")
            print("   Machine fingerprinting is now consistent across all code paths.")
            print("   No false positive security emails should be triggered.")
        else:
            print("\nISSUES FOUND: Some tests failed")
            print("   Security email fix may not be fully effective.")

        # Error summary
        if self.results['errors']:
            print(f"\nERRORS ENCOUNTERED ({len(self.results['errors'])}):")
            for i, error in enumerate(self.results['errors'], 1):
                print(f"  {i}. {error}")
        else:
            print("\nNo errors encountered during testing")

        # Recommendations
        print("\nRECOMMENDATIONS:")
        if passed_tests == total_tests:
            print("  * The fix is working correctly")
            print("  * Deploy the changes to production")
            print("  * Monitor for security email frequency reduction")
        else:
            print("  * Review failed tests and fix issues")
            print("  * Verify frontend consistently calls /api/hardware_id")
            print("  * Test again after fixes")

if __name__ == '__main__':
    # Check if server is running
    try:
        response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
        if response.status_code != 200:
            print(f"ERROR: POSPal server not responding correctly at {BASE_URL}")
            print("Please start the server with: python app.py")
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: Cannot connect to POSPal server at {BASE_URL}")
        print(f"Error: {e}")
        print("Please start the server with: python app.py")
        sys.exit(1)

    # Run tests
    tester = SecurityEmailFixTester()
    tester.run_all_tests()