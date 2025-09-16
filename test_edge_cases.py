#!/usr/bin/env python3
"""
Test edge cases for the security email fix
Including network issues, startup sequences, and error conditions
"""

import json
import requests
import time
import threading
import subprocess
import sys
from datetime import datetime

# Test configuration
BASE_URL = 'http://localhost:5000'
WORKER_URL = 'http://127.0.0.1:8787'
TEST_EMAIL = 'test@pospal.gr'
TEST_TOKEN = 'test-token-123'

class EdgeCaseTester:
    def __init__(self):
        self.results = {}
        self.errors = []

    def test_network_timeout_handling(self):
        """Test how fingerprinting handles network timeouts"""
        print("\n[TEST 1] Network Timeout Handling")
        print("=" * 50)

        # Test with very short timeout
        fingerprints = []
        for i in range(3):
            try:
                response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=0.001)  # Very short timeout
                if response.status_code == 200:
                    data = response.json()
                    fp = data.get('hardware_id')
                    fingerprints.append(fp)
                    print(f"  Call {i+1}: {fp}")
            except requests.exceptions.Timeout:
                print(f"  Call {i+1}: TIMEOUT (expected)")
                fingerprints.append('TIMEOUT')
            except Exception as e:
                print(f"  Call {i+1}: ERROR - {e}")
                fingerprints.append('ERROR')

        # Test with normal timeout after short timeouts
        try:
            response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
            if response.status_code == 200:
                data = response.json()
                recovery_fp = data.get('hardware_id')
                print(f"  Recovery call: {recovery_fp}")

                # Check if recovery fingerprint is consistent
                valid_fps = [fp for fp in fingerprints if fp not in ['TIMEOUT', 'ERROR']]
                if valid_fps and all(fp == recovery_fp for fp in valid_fps):
                    self.results['timeout_handling'] = 'CONSISTENT'
                    print("  [SUCCESS] Fingerprint consistent after timeouts")
                elif not valid_fps:
                    self.results['timeout_handling'] = 'NO_VALID_CALLS'
                    print("  [INFO] All calls timed out, but recovery successful")
                else:
                    self.results['timeout_handling'] = 'INCONSISTENT'
                    print("  [FAIL] Fingerprint inconsistent after timeouts")
        except Exception as e:
            self.results['timeout_handling'] = 'RECOVERY_FAILED'
            print(f"  [ERROR] Recovery call failed: {e}")

    def test_concurrent_load(self):
        """Test fingerprint consistency under concurrent load"""
        print("\n[TEST 2] Concurrent Load Testing")
        print("=" * 50)

        concurrent_fingerprints = []
        errors = []

        def make_concurrent_call(call_id):
            try:
                response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    fp = data.get('hardware_id')
                    concurrent_fingerprints.append(fp)
                    print(f"  Thread {call_id}: {fp}")
                else:
                    errors.append(f"Thread {call_id}: HTTP {response.status_code}")
            except Exception as e:
                errors.append(f"Thread {call_id}: {e}")

        # Start 10 concurrent threads
        threads = []
        for i in range(10):
            t = threading.Thread(target=make_concurrent_call, args=(i+1,))
            threads.append(t)
            t.start()

        # Wait for all threads to complete
        for t in threads:
            t.join(timeout=15)

        # Analyze results
        unique_fps = set(concurrent_fingerprints)
        if len(unique_fps) <= 1:
            self.results['concurrent_load'] = 'CONSISTENT'
            print(f"  [SUCCESS] All {len(concurrent_fingerprints)} concurrent calls consistent")
        else:
            self.results['concurrent_load'] = 'INCONSISTENT'
            print(f"  [FAIL] {len(unique_fps)} different fingerprints: {unique_fps}")

        if errors:
            print(f"  [WARNING] {len(errors)} errors occurred:")
            for error in errors[:5]:  # Show first 5 errors
                print(f"    {error}")

    def test_rapid_sequential_calls(self):
        """Test very rapid sequential calls"""
        print("\n[TEST 3] Rapid Sequential Calls")
        print("=" * 50)

        fingerprints = []
        start_time = time.time()

        # Make 20 rapid calls
        for i in range(20):
            try:
                response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=2)
                if response.status_code == 200:
                    data = response.json()
                    fp = data.get('hardware_id')
                    fingerprints.append(fp)
                    if i % 5 == 0:  # Show every 5th result
                        print(f"  Call {i+1}: {fp}")
            except Exception as e:
                fingerprints.append('ERROR')
                print(f"  Call {i+1}: ERROR - {e}")

        end_time = time.time()
        duration = end_time - start_time

        # Analyze results
        valid_fps = [fp for fp in fingerprints if fp != 'ERROR']
        unique_fps = set(valid_fps)

        print(f"  Total time: {duration:.2f} seconds")
        print(f"  Successful calls: {len(valid_fps)}/20")

        if len(unique_fps) <= 1:
            self.results['rapid_calls'] = 'CONSISTENT'
            print(f"  [SUCCESS] All rapid calls consistent")
        else:
            self.results['rapid_calls'] = 'INCONSISTENT'
            print(f"  [FAIL] {len(unique_fps)} different fingerprints")

    def test_server_restart_simulation(self):
        """Test behavior during server restart scenario"""
        print("\n[TEST 4] Server Restart Simulation")
        print("=" * 50)

        # Get initial fingerprint
        try:
            response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
            if response.status_code == 200:
                data = response.json()
                initial_fp = data.get('hardware_id')
                print(f"  Initial fingerprint: {initial_fp}")

                # Simulate rapid calls that might occur during restart
                restart_fps = []
                for i in range(5):
                    try:
                        response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=1)
                        if response.status_code == 200:
                            data = response.json()
                            fp = data.get('hardware_id')
                            restart_fps.append(fp)
                            print(f"  Restart test {i+1}: {fp}")
                        time.sleep(0.1)  # Brief pause
                    except Exception as e:
                        restart_fps.append('ERROR')
                        print(f"  Restart test {i+1}: ERROR - {e}")

                # Check consistency
                valid_restart_fps = [fp for fp in restart_fps if fp != 'ERROR']
                if all(fp == initial_fp for fp in valid_restart_fps):
                    self.results['server_restart'] = 'CONSISTENT'
                    print("  [SUCCESS] Fingerprint consistent during restart simulation")
                else:
                    self.results['server_restart'] = 'INCONSISTENT'
                    print("  [FAIL] Fingerprint inconsistent during restart simulation")

        except Exception as e:
            self.results['server_restart'] = 'FAILED'
            print(f"  [ERROR] Server restart test failed: {e}")

    def test_malformed_requests(self):
        """Test how endpoints handle malformed requests"""
        print("\n[TEST 5] Malformed Request Handling")
        print("=" * 50)

        malformed_tests = [
            {'name': 'Empty POST', 'data': {}},
            {'name': 'Invalid JSON', 'data': 'invalid-json'},
            {'name': 'Missing fields', 'data': {'invalid': 'data'}},
            {'name': 'Oversized data', 'data': {'hardware_id': 'x' * 10000}}
        ]

        malformed_results = {}

        for test in malformed_tests:
            try:
                if isinstance(test['data'], dict):
                    response = requests.post(f'{BASE_URL}/api/validate-license',
                                           json=test['data'], timeout=5)
                else:
                    response = requests.post(f'{BASE_URL}/api/validate-license',
                                           data=test['data'], timeout=5)

                malformed_results[test['name']] = response.status_code
                print(f"  {test['name']}: HTTP {response.status_code}")

                # Server should still be responsive after malformed request
                check_response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
                if check_response.status_code == 200:
                    print(f"    Server responsive after malformed request: YES")
                else:
                    print(f"    Server responsive after malformed request: NO")

            except Exception as e:
                malformed_results[test['name']] = 'EXCEPTION'
                print(f"  {test['name']}: EXCEPTION - {e}")

        self.results['malformed_requests'] = malformed_results

    def test_session_persistence(self):
        """Test fingerprint consistency across session boundaries"""
        print("\n[TEST 6] Session Persistence")
        print("=" * 50)

        session_fps = []

        # Test with different session objects
        for i in range(3):
            session = requests.Session()
            try:
                response = session.get(f'{BASE_URL}/api/hardware_id', timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    fp = data.get('hardware_id')
                    session_fps.append(fp)
                    print(f"  Session {i+1}: {fp}")
            except Exception as e:
                session_fps.append('ERROR')
                print(f"  Session {i+1}: ERROR - {e}")
            finally:
                session.close()

        # Check consistency across sessions
        unique_session_fps = set(fp for fp in session_fps if fp != 'ERROR')
        if len(unique_session_fps) <= 1:
            self.results['session_persistence'] = 'CONSISTENT'
            print("  [SUCCESS] Fingerprint consistent across sessions")
        else:
            self.results['session_persistence'] = 'INCONSISTENT'
            print(f"  [FAIL] {len(unique_session_fps)} different session fingerprints")

    def run_all_tests(self):
        """Run all edge case tests"""
        print("POSPal Security Email Fix - Edge Case Test Suite")
        print("=" * 60)
        print(f"Test started at: {datetime.now()}")

        # Check server availability
        try:
            response = requests.get(f'{BASE_URL}/api/hardware_id', timeout=5)
            if response.status_code != 200:
                print("ERROR: Server not responding correctly")
                return
            else:
                data = response.json()
                reference_fp = data.get('hardware_id')
                print(f"Reference fingerprint: {reference_fp}")
        except Exception as e:
            print(f"ERROR: Cannot connect to server: {e}")
            return

        # Run all tests
        self.test_network_timeout_handling()
        self.test_concurrent_load()
        self.test_rapid_sequential_calls()
        self.test_server_restart_simulation()
        self.test_malformed_requests()
        self.test_session_persistence()

        # Generate report
        self.generate_report()

    def generate_report(self):
        """Generate edge case test report"""
        print("\n" + "=" * 60)
        print("EDGE CASE TEST REPORT")
        print("=" * 60)

        test_results = [
            ('Timeout Handling', self.results.get('timeout_handling', 'NOT_RUN')),
            ('Concurrent Load', self.results.get('concurrent_load', 'NOT_RUN')),
            ('Rapid Calls', self.results.get('rapid_calls', 'NOT_RUN')),
            ('Server Restart', self.results.get('server_restart', 'NOT_RUN')),
            ('Session Persistence', self.results.get('session_persistence', 'NOT_RUN'))
        ]

        passed_tests = 0
        total_tests = len(test_results)

        print("\nTest Results:")
        for test_name, result in test_results:
            if result == 'CONSISTENT':
                print(f"  {test_name}: PASS")
                passed_tests += 1
            elif result == 'INCONSISTENT':
                print(f"  {test_name}: FAIL - Fingerprint inconsistent")
            elif result in ['FAILED', 'NOT_RUN']:
                print(f"  {test_name}: {result}")
            else:
                print(f"  {test_name}: {result}")

        # Malformed request handling
        malformed = self.results.get('malformed_requests', {})
        if malformed:
            print(f"\nMalformed Request Handling:")
            for test_name, status in malformed.items():
                if isinstance(status, int) and 400 <= status < 500:
                    print(f"  {test_name}: HTTP {status} (Good - rejected properly)")
                elif status == 'EXCEPTION':
                    print(f"  {test_name}: EXCEPTION (May indicate issue)")
                else:
                    print(f"  {test_name}: {status}")

        print(f"\nOVERALL EDGE CASE ASSESSMENT:")
        if passed_tests >= total_tests * 0.8:  # 80% pass rate
            print("SUCCESS: System handles edge cases well")
            print("  * Fingerprinting remains consistent under stress")
            print("  * Security email fix should be robust")
        else:
            print(f"CONCERN: Only {passed_tests}/{total_tests} edge case tests passed")
            print("  * System may have reliability issues")
            print("  * Security email fix may not be fully robust")

        # Recommendations
        print("\nRECOMMENDATIONS:")
        if passed_tests >= total_tests * 0.8:
            print("  * Edge case handling is satisfactory")
            print("  * Monitor production for similar conditions")
        else:
            print("  * Review failed edge cases")
            print("  * Consider additional error handling")
            print("  * Test under production-like conditions")

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
        sys.exit(1)

    # Run tests
    tester = EdgeCaseTester()
    tester.run_all_tests()