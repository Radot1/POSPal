import json
import hashlib
import uuid

APP_SECRET_KEY = 762378  # Must match server

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
    hw_id = input("Hardware ID: ").strip() or str(uuid.getnode())
    
    license = generate_license(customer, hw_id)
    with open("license.key", "w") as f:
        json.dump(license, f)
    
    print(f"License generated for {customer} ({hw_id})")