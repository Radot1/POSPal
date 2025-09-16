#!/usr/bin/env python3
"""
Test all API endpoints for consistent machine fingerprinting
This ensures no endpoint uses different fingerprinting logic
"""

import json
import requests
import time
from datetime import datetime

# Test configuration
FLASK_URL = 'http://localhost:5000'
WORKER_URL = 'http://127.0.0.1:8787'
TEST_EMAIL = 'test@pospal.gr'
TEST_TOKEN = 'test-token-123'

class EndpointFingerprintTester:
    def __init__(self):
        self.results = {}
        self.errors = []

    def get_backend_fingerprint(self):
        """Get the reference fingerprint from backend"""
        try:
            response = requests.get(f'{FLASK_URL}/api/hardware_id', timeout=5)
            if response.status_code == 200:
                data = response.json()
                return data.get('hardware_id')
        except Exception as e:
            self.errors.append(f"Failed to get backend fingerprint: {e}")
        return None

    def test_flask_endpoints(self, reference_fp):
        """Test all Flask endpoints that use fingerprinting"""
        print("\n[TESTING] Flask Backend Endpoints")
        print("=" * 50)

        endpoints = [
            '/api/hardware_id',
            '/api/trial_status',
            '/api/validate-license',
            '/api/config'
        ]

        flask_results = {}

        for endpoint in endpoints:
            try:
                if endpoint == '/api/validate-license':
                    # POST request with data
                    data = {
                        'customer_email': TEST_EMAIL,
                        'unlock_token': TEST_TOKEN,
                        'hardware_id': reference_fp
                    }
                    response = requests.post(f'{FLASK_URL}{endpoint}', json=data, timeout=5)
                else:
                    # GET request
                    response = requests.get(f'{FLASK_URL}{endpoint}', timeout=5)

                print(f"  {endpoint}: {response.status_code}")

                if response.status_code == 200:
                    try:
                        data = response.json()
                        # Check if response contains hardware_id
                        if 'hardware_id' in data:
                            hw_id = data['hardware_id']
                            flask_results[endpoint] = hw_id
                            if hw_id == reference_fp:
                                print(f"    Hardware ID: {hw_id} (CONSISTENT)")
                            else:
                                print(f"    Hardware ID: {hw_id} (INCONSISTENT!)")
                        else:
                            flask_results[endpoint] = 'NO_HARDWARE_ID'
                            print(f"    No hardware_id in response")
                    except json.JSONDecodeError:
                        flask_results[endpoint] = 'JSON_ERROR'
                        print(f"    Invalid JSON response")
                else:
                    flask_results[endpoint] = f'ERROR_{response.status_code}'
                    print(f"    Error: {response.status_code}")

            except Exception as e:
                flask_results[endpoint] = f'EXCEPTION'
                print(f"  {endpoint}: EXCEPTION - {e}")
                self.errors.append(f"Flask {endpoint}: {e}")

        self.results['flask'] = flask_results

    def test_worker_endpoints(self, reference_fp):
        """Test Cloudflare Worker endpoints"""
        print("\n[TESTING] Cloudflare Worker Endpoints")
        print("=" * 50)

        worker_results = {}

        # Test validation endpoint
        try:
            validation_data = {
                'credentials': {
                    'email': TEST_EMAIL,
                    'token': TEST_TOKEN
                },
                'device': {
                    'machineFingerprint': reference_fp,
                    'deviceInfo': {
                        'hostname': 'TEST_MACHINE',
                        'platform': 'test'
                    }
                }
            }

            response = requests.post(f'{WORKER_URL}/validate',
                                   json=validation_data,
                                   timeout=10)

            print(f"  /validate: {response.status_code}")

            if response.status_code in [200, 400, 404]:  # Expected responses
                try:
                    data = response.json()
                    worker_results['/validate'] = response.status_code
                    print(f"    Response received (expected for test data)")
                except json.JSONDecodeError:
                    worker_results['/validate'] = 'JSON_ERROR'
                    print(f"    Invalid JSON response")
            else:
                worker_results['/validate'] = f'ERROR_{response.status_code}'
                print(f"    Unexpected error: {response.status_code}")

        except Exception as e:
            worker_results['/validate'] = 'EXCEPTION'
            print(f"  /validate: EXCEPTION - {e}")
            self.errors.append(f"Worker /validate: {e}")

        # Test session endpoint
        try:
            session_data = {
                'credentials': {
                    'email': TEST_EMAIL,
                    'token': TEST_TOKEN
                },
                'device': {
                    'machineFingerprint': reference_fp,
                    'sessionId': f'test_session_{int(time.time())}',
                    'deviceInfo': {
                        'hostname': 'TEST_MACHINE',
                        'platform': 'test'
                    }
                }
            }

            response = requests.post(f'{WORKER_URL}/session',
                                   json=session_data,
                                   timeout=10)

            print(f"  /session: {response.status_code}")
            worker_results['/session'] = response.status_code

        except Exception as e:
            worker_results['/session'] = 'EXCEPTION'
            print(f"  /session: EXCEPTION - {e}")
            self.errors.append(f"Worker /session: {e}")

        self.results['worker'] = worker_results

    def test_frontend_consistency(self, reference_fp):
        """Test that frontend pages can access consistent fingerprinting"""
        print("\n[TESTING] Frontend Consistency")
        print("=" * 50)

        frontend_results = {}
        pages = ['/', '/POSPal.html', '/POSPalDesktop.html']

        for page in pages:
            try:
                response = requests.get(f'{FLASK_URL}{page}', timeout=5)
                print(f"  {page}: {response.status_code}")

                if response.status_code == 200:
                    # Check if the page contains the correct API call
                    content = response.text.lower()
                    if '/api/hardware_id' in content:
                        frontend_results[page] = 'HAS_API_CALL'
                        print(f"    Contains /api/hardware_id call: YES")
                    else:
                        frontend_results[page] = 'NO_API_CALL'
                        print(f"    Contains /api/hardware_id call: NO")
                else:
                    frontend_results[page] = f'ERROR_{response.status_code}'

            except Exception as e:
                frontend_results[page] = 'EXCEPTION'
                print(f"  {page}: EXCEPTION - {e}")
                self.errors.append(f"Frontend {page}: {e}")

        self.results['frontend'] = frontend_results

    def test_edge_cases(self, reference_fp):
        """Test edge cases that might cause fingerprint inconsistencies"""
        print("\n[TESTING] Edge Cases")
        print("=" * 50)

        edge_results = {}

        # Test rapid successive calls
        print("  Testing rapid successive calls...")
        fingerprints = []
        for i in range(5):
            try:
                response = requests.get(f'{FLASK_URL}/api/hardware_id', timeout=2)
                if response.status_code == 200:
                    data = response.json()
                    fp = data.get('hardware_id')
                    fingerprints.append(fp)
            except Exception as e:
                fingerprints.append('ERROR')
                self.errors.append(f"Rapid call {i+1}: {e}")

        unique_fps = set(fp for fp in fingerprints if fp != 'ERROR')
        if len(unique_fps) <= 1:
            edge_results['rapid_calls'] = 'CONSISTENT'
            print(f"    Rapid calls consistent: YES")
        else:
            edge_results['rapid_calls'] = 'INCONSISTENT'
            print(f"    Rapid calls consistent: NO - {unique_fps}")

        # Test concurrent calls (simulated)
        print("  Testing simulated concurrent behavior...")
        import threading

        concurrent_fps = []
        def make_call():
            try:
                response = requests.get(f'{FLASK_URL}/api/hardware_id', timeout=5)
                if response.status_code == 200:
                    data = response.json()
                    concurrent_fps.append(data.get('hardware_id'))
            except:
                concurrent_fps.append('ERROR')

        threads = []
        for _ in range(3):
            t = threading.Thread(target=make_call)
            threads.append(t)
            t.start()

        for t in threads:
            t.join(timeout=10)

        unique_concurrent = set(fp for fp in concurrent_fps if fp != 'ERROR')
        if len(unique_concurrent) <= 1:
            edge_results['concurrent_calls'] = 'CONSISTENT'
            print(f"    Concurrent calls consistent: YES")
        else:
            edge_results['concurrent_calls'] = 'INCONSISTENT'
            print(f"    Concurrent calls consistent: NO - {unique_concurrent}")

        self.results['edge_cases'] = edge_results

    def run_all_tests(self):
        """Run all endpoint fingerprint tests"""
        print("POSPal Endpoint Fingerprinting Test Suite")
        print("=" * 60)
        print(f"Test started at: {datetime.now()}")

        # Get reference fingerprint
        reference_fp = self.get_backend_fingerprint()
        if not reference_fp:
            print("FATAL ERROR: Cannot get reference fingerprint from backend")
            return

        print(f"Reference fingerprint: {reference_fp}")

        # Run all tests
        self.test_flask_endpoints(reference_fp)
        self.test_worker_endpoints(reference_fp)
        self.test_frontend_consistency(reference_fp)
        self.test_edge_cases(reference_fp)

        # Generate report
        self.generate_report(reference_fp)

    def generate_report(self, reference_fp):
        """Generate comprehensive test report"""
        print("\n" + "=" * 60)
        print("ENDPOINT FINGERPRINTING REPORT")
        print("=" * 60)

        total_issues = 0

        # Flask endpoints
        print("\nFlask Backend Results:")
        flask_results = self.results.get('flask', {})
        for endpoint, result in flask_results.items():
            if isinstance(result, str) and result not in [reference_fp, 'NO_HARDWARE_ID']:
                if 'ERROR' in result or 'EXCEPTION' in result:
                    print(f"  {endpoint}: {result} (ISSUE)")
                    total_issues += 1
                else:
                    print(f"  {endpoint}: {result} (INCONSISTENT)")
                    total_issues += 1
            elif result == reference_fp:
                print(f"  {endpoint}: CONSISTENT")
            else:
                print(f"  {endpoint}: {result}")

        # Worker endpoints
        print("\nCloudflare Worker Results:")
        worker_results = self.results.get('worker', {})
        for endpoint, result in worker_results.items():
            if isinstance(result, str) and 'EXCEPTION' in result:
                print(f"  {endpoint}: {result} (ISSUE)")
                total_issues += 1
            elif isinstance(result, int) and result in [200, 400, 404]:
                print(f"  {endpoint}: HTTP {result} (OK)")
            else:
                print(f"  {endpoint}: {result}")

        # Frontend consistency
        print("\nFrontend Consistency:")
        frontend_results = self.results.get('frontend', {})
        for page, result in frontend_results.items():
            if result == 'HAS_API_CALL':
                print(f"  {page}: Uses consistent API (GOOD)")
            elif result == 'NO_API_CALL':
                print(f"  {page}: May use browser fingerprinting (WARNING)")
                total_issues += 1
            else:
                print(f"  {page}: {result}")

        # Edge cases
        print("\nEdge Case Results:")
        edge_results = self.results.get('edge_cases', {})
        for test, result in edge_results.items():
            if result == 'CONSISTENT':
                print(f"  {test}: PASS")
            else:
                print(f"  {test}: {result} (ISSUE)")
                total_issues += 1

        # Summary
        print(f"\nOVERALL ASSESSMENT:")
        if total_issues == 0:
            print("SUCCESS: All endpoints use consistent fingerprinting")
            print("  * Security email fix is properly implemented")
            print("  * No false positives should occur")
        else:
            print(f"ISSUES FOUND: {total_issues} potential problems detected")
            print("  * Review failed endpoints")
            print("  * Security email fix may not be fully effective")

        # Error summary
        if self.errors:
            print(f"\nERRORS ENCOUNTERED ({len(self.errors)}):")
            for i, error in enumerate(self.errors, 1):
                print(f"  {i}. {error}")

if __name__ == '__main__':
    # Check if servers are running
    try:
        flask_response = requests.get(f'{FLASK_URL}/api/hardware_id', timeout=5)
        if flask_response.status_code != 200:
            print(f"ERROR: Flask server not responding at {FLASK_URL}")
            exit(1)
    except Exception as e:
        print(f"ERROR: Cannot connect to Flask server: {e}")
        exit(1)

    try:
        worker_response = requests.get(f'{WORKER_URL}/', timeout=5)
        # Worker should respond with something (even 404 is OK)
        print(f"Worker accessible at {WORKER_URL}")
    except Exception as e:
        print(f"WARNING: Worker may not be accessible at {WORKER_URL}: {e}")
        print("Some tests may fail, but will continue...")

    # Run tests
    tester = EndpointFingerprintTester()
    tester.run_all_tests()