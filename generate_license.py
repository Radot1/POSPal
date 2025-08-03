import json
import hashlib
import uuid
import subprocess
import platform

APP_SECRET_KEY = 0x8F3A2B1C9D4E5F6A  # Must match server

def get_enhanced_hardware_id():
    """Get enhanced hardware fingerprint using multiple identifiers"""
    # Get MAC address (current method)
    mac = ':'.join(f'{(uuid.getnode() >> i) & 0xff:02x}' 
                   for i in range(0, 8*6, 8))
    
    # Get CPU info
    try:
        cpu_info = platform.processor()
        if not cpu_info:
            cpu_info = platform.machine()
    except:
        cpu_info = "UNKNOWN"
    
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
    
    # Combine all identifiers and hash
    combined = f"{mac}|{cpu_info}|{disk_serial}|{win_id}"
    enhanced_id = hashlib.sha256(combined.encode()).hexdigest()[:16]
    
    return enhanced_id

def generate_license(customer_name, hardware_id):
    data = f"{hardware_id}{APP_SECRET_KEY}".encode()
    signature = hashlib.sha256(data).hexdigest()
    
    return {
        "customer": customer_name,
        "hardware_id": hardware_id,
        "signature": signature
    }

if __name__ == "__main__":
    customer = input("Customer name: ")
    hw_id = input("Hardware ID (press Enter for current machine): ").strip()
    
    if not hw_id:
        print("Generating enhanced hardware ID for current machine...")
        hw_id = get_enhanced_hardware_id()
        print(f"Enhanced Hardware ID: {hw_id}")
    
    license = generate_license(customer, hw_id)
    with open("license.key", "w") as f:
        json.dump(license, f)
    
    print(f"License generated for {customer} ({hw_id})")
    print("License file saved as 'license.key'")