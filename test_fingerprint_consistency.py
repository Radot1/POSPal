#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script to validate machine fingerprint consistency
This should demonstrate that the fix resolves the security email issue
"""

import sys
import os
import time

# Add current directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

try:
    from app import get_enhanced_hardware_id
    print("[SUCCESS] Successfully imported get_enhanced_hardware_id")
except ImportError as e:
    print(f"[FAILED] Failed to import: {e}")
    sys.exit(1)

def test_hardware_id_consistency():
    """Test that hardware ID generation is consistent across multiple calls"""
    print("\n[TEST] Testing Hardware ID Consistency")
    print("=" * 50)

    # Generate multiple hardware IDs
    ids = []
    for i in range(5):
        hw_id = get_enhanced_hardware_id()
        ids.append(hw_id)
        print(f"Call {i+1}: {hw_id}")
        time.sleep(0.1)  # Small delay

    # Check consistency
    unique_ids = set(ids)
    if len(unique_ids) == 1:
        print(f"[SUCCESS] All hardware IDs are identical: {ids[0]}")
        return True
    else:
        print(f"[FAILED] Hardware IDs are inconsistent: {unique_ids}")
        return False

def simulate_machine_fingerprint_calls():
    """Simulate the frontend calls to /api/hardware_id"""
    print("\n[TEST] Simulating Frontend API Calls")
    print("=" * 50)

    try:
        # Import Flask app components if available
        from app import app

        with app.test_client() as client:
            # Simulate multiple API calls (like frontend would make)
            responses = []
            for i in range(3):
                response = client.get('/api/hardware_id')
                if response.status_code == 200:
                    data = response.get_json()
                    hw_id = data.get('hardware_id')
                    responses.append(hw_id)
                    print(f"API Call {i+1}: {hw_id}")
                else:
                    print(f"API Call {i+1}: Failed with status {response.status_code}")

            # Check consistency
            if responses and len(set(responses)) == 1:
                print(f"[SUCCESS] API responses are consistent: {responses[0]}")
                return True
            else:
                print(f"[FAILED] API responses are inconsistent: {set(responses)}")
                return False

    except Exception as e:
        print(f"[FAILED] Could not test API calls: {e}")
        return False

def main():
    print("POSPal Machine Fingerprint Consistency Test")
    print("=" * 60)
    print("This test validates the fix for the security email issue")
    print("by ensuring machine fingerprints are consistent.\n")

    # Run tests
    results = []
    results.append(test_hardware_id_consistency())
    results.append(simulate_machine_fingerprint_calls())

    # Summary
    print("\n[SUMMARY] TEST RESULTS")
    print("=" * 30)

    if all(results):
        print("[SUCCESS] ALL TESTS PASSED")
        print("The fix should resolve the security email issue!")
        print("\nKey Changes Made:")
        print("   - Standardized all fingerprinting to use backend hardware ID")
        print("   - Removed inconsistent browser-based fingerprinting")
        print("   - Fixed async/await calls in pospalCore.js")
    else:
        print("[FAILED] SOME TESTS FAILED")
        print("The security email issue may persist")

        failed_tests = [i for i, result in enumerate(results) if not result]
        print(f"Failed tests: {failed_tests}")

if __name__ == "__main__":
    main()