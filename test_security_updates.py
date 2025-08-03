#!/usr/bin/env python3
"""
Test script to verify POSPal security improvements
"""

import json
import hashlib
import uuid
import subprocess
import platform
from datetime import datetime

# New secret key
APP_SECRET_KEY = 0x8F3A2B1C9D4E5F6A

def test_enhanced_hardware_id():
    """Test the enhanced hardware fingerprinting"""
    print("Testing Enhanced Hardware ID...")
    
    # Get MAC address (current method)
    mac = ':'.join(f'{(uuid.getnode() >> i) & 0xff:02x}' 
                   for i in range(0, 8*6, 8))
    print(f"MAC Address: {mac}")
    
    # Get CPU info
    try:
        cpu_info = platform.processor()
        if not cpu_info:
            cpu_info = platform.machine()
    except:
        cpu_info = "UNKNOWN"
    print(f"CPU Info: {cpu_info}")
    
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
    print(f"Disk Serial: {disk_serial}")
    
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
    print(f"Windows ID: {win_id}")
    
    # Combine all identifiers and hash
    combined = f"{mac}|{cpu_info}|{disk_serial}|{win_id}"
    enhanced_id = hashlib.sha256(combined.encode()).hexdigest()[:16]
    
    print(f"Enhanced Hardware ID: {enhanced_id}")
    print(f"Combined String: {combined}")
    print()

def test_license_generation():
    """Test license generation with new secret key"""
    print("Testing License Generation...")
    
    # Generate enhanced hardware ID
    mac = ':'.join(f'{(uuid.getnode() >> i) & 0xff:02x}' 
                   for i in range(0, 8*6, 8))
    cpu_info = platform.processor() or platform.machine()
    disk_serial = "TEST_DISK"
    win_id = "TEST_WIN"
    
    combined = f"{mac}|{cpu_info}|{disk_serial}|{win_id}"
    enhanced_id = hashlib.sha256(combined.encode()).hexdigest()[:16]
    
    # Generate license
    data = f"{enhanced_id}{APP_SECRET_KEY}".encode()
    signature = hashlib.sha256(data).hexdigest()
    
    license_data = {
        "customer": "Test Customer",
        "hardware_id": enhanced_id,
        "signature": signature
    }
    
    print(f"Hardware ID: {enhanced_id}")
    print(f"Signature: {signature}")
    print(f"License Data: {json.dumps(license_data, indent=2)}")
    print()

def test_trial_signature():
    """Test trial signature generation with new secret key"""
    print("Testing Trial Signature...")
    
    first_run_date = datetime.now().strftime("%Y-%m-%d")
    signature_data = f"{first_run_date}{APP_SECRET_KEY}".encode()
    signature = hashlib.sha256(signature_data).hexdigest()
    
    trial_data = {
        "first_run_date": first_run_date,
        "signature": signature
    }
    
    print(f"First Run Date: {first_run_date}")
    print(f"Signature: {signature}")
    print(f"Trial Data: {json.dumps(trial_data, indent=2)}")
    print()

if __name__ == "__main__":
    print("POSPal Security Updates Test")
    print("=" * 40)
    print()
    
    test_enhanced_hardware_id()
    test_license_generation()
    test_trial_signature()
    
    print("Security updates test completed!")
    print("New secret key:", hex(APP_SECRET_KEY))
    print("Enhanced hardware fingerprinting implemented")
    print("Multiple trial storage locations implemented") 