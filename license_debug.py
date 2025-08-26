#!/usr/bin/env python3
"""
License Debug Tool - Run this to see exactly why license validation is failing
"""
import os
import sys
import json
import uuid
import hashlib
import subprocess
import platform

# Same secret key as in app.py
APP_SECRET_KEY = 0x8F3A2B1C9D4E5F6A

def get_enhanced_hardware_id():
    """EXACT COPY of the fixed hardware ID generation from app.py"""
    # Get MAC address (FIXED - correct bit shifting)
    mac_node = uuid.getnode()
    mac = ':'.join(f'{(mac_node >> (8 * (5-i))) & 0xff:02x}' for i in range(6))
    
    # Get CPU info
    try:
        cpu_info = platform.processor()
        if not cpu_info:
            cpu_info = platform.machine()
    except:
        cpu_info = "UNKNOWN"
    
    # Get disk serial  
    disk_serial = "UNKNOWN"
    try:
        result = subprocess.run(['wmic', 'diskdrive', 'where', 'index=0', 'get', 'serialnumber'], 
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                disk_serial = lines[1].strip()
    except Exception as e:
        print(f"Could not get disk serial: {e}")
    
    # Get Windows ID
    win_id = "UNKNOWN"
    try:
        result = subprocess.run(['wmic', 'csproduct', 'get', 'uuid'], 
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                win_id = lines[1].strip()
    except Exception as e:
        print(f"Could not get Windows UUID: {e}")
    
    # Combine and hash
    combined = f"{mac}|{cpu_info}|{disk_serial}|{win_id}"
    enhanced_id = hashlib.sha256(combined.encode()).hexdigest()[:16]
    
    return enhanced_id, mac, cpu_info, disk_serial, win_id

def main():
    print("=" * 60)
    print("POSPal License Debug Tool")
    print("=" * 60)
    
    # Find license file (same logic as app.py)
    exe_dir = os.path.dirname(sys.executable)
    license_path = os.path.join(exe_dir, 'license.key')
    
    print(f"Looking for license at: {license_path}")
    print(f"License file exists: {os.path.exists(license_path)}")
    
    if not os.path.exists(license_path):
        print("❌ LICENSE FILE NOT FOUND!")
        print("Make sure license.key is in the same folder as the .exe file")
        return
    
    # Read license file
    try:
        with open(license_path, 'r') as f:
            license_data = json.load(f)
        print("✅ License file is valid JSON")
    except Exception as e:
        print(f"❌ Cannot read license file: {e}")
        return
    
    print(f"License customer: {license_data.get('customer', 'MISSING')}")
    print(f"License hardware_id: {license_data.get('hardware_id', 'MISSING')}")
    print(f"License signature: {license_data.get('signature', 'MISSING')}")
    
    # Get current hardware ID
    print("\n" + "=" * 40)
    print("HARDWARE ID ANALYSIS")
    print("=" * 40)
    
    current_hw_id, mac, cpu_info, disk_serial, win_id = get_enhanced_hardware_id()
    mac_node = uuid.getnode()
    mac_hex = f'{mac_node:012x}'
    
    print(f"MAC Address: {mac}")
    print(f"CPU Info: {cpu_info}")
    print(f"Disk Serial: {disk_serial}")
    print(f"Windows ID: {win_id}")
    print(f"Enhanced Hardware ID: {current_hw_id}")
    print(f"MAC Hex (legacy): {mac_hex}")
    
    # Check hardware ID matches
    print("\n" + "=" * 40)
    print("HARDWARE ID MATCHING")
    print("=" * 40)
    
    license_hw_id = license_data.get('hardware_id', '')
    matches = {
        'Enhanced ID Match': current_hw_id == license_hw_id,
        'MAC Hex Match': mac_hex == license_hw_id,
        'MAC No Colons Match': current_hw_id.replace(':', '') == license_hw_id
    }
    
    print(f"License expects: {license_hw_id}")
    print(f"Current enhanced: {current_hw_id}")
    print(f"Current MAC hex: {mac_hex}")
    
    for match_type, result in matches.items():
        status = "✅ MATCH" if result else "❌ NO MATCH"
        print(f"{match_type}: {status}")
    
    # Check signature validation
    print("\n" + "=" * 40)
    print("SIGNATURE VALIDATION")
    print("=" * 40)
    
    try:
        data = f"{license_hw_id}{APP_SECRET_KEY}".encode()
        expected_signature = hashlib.sha256(data).hexdigest()
        actual_signature = license_data.get('signature', '')
        signature_valid = expected_signature == actual_signature
        
        print(f"Expected signature: {expected_signature}")
        print(f"License signature:  {actual_signature}")
        print(f"Signature valid: {'✅ YES' if signature_valid else '❌ NO'}")
        
    except Exception as e:
        print(f"❌ Signature validation error: {e}")
    
    # Final verdict
    print("\n" + "=" * 40)
    print("FINAL VERDICT")
    print("=" * 40)
    
    if any(matches.values()) and signature_valid:
        print("✅ LICENSE SHOULD BE VALID!")
        print("If the app still shows trial, there may be another issue.")
    else:
        print("❌ LICENSE VALIDATION FAILED")
        if not any(matches.values()):
            print("   Reason: Hardware ID mismatch")
            print("   Solution: Generate new license with current hardware ID")
        if not signature_valid:
            print("   Reason: Invalid signature")
            print("   Solution: Check license generation process")

if __name__ == "__main__":
    main()
    input("\nPress Enter to close...")