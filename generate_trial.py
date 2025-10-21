#!/usr/bin/env python3
"""
Generate valid trial.json file for POSPal builds

This script creates a trial.json file with the correct format expected by app.py:
- first_run_date: Today's date in YYYY-MM-DD format
- signature: SHA256 hash of (first_run_date + APP_SECRET_KEY)

This ensures every build gets a fresh 30-day trial period.
"""

import hashlib
import json
import sys
from datetime import datetime

# Must match APP_SECRET_KEY in app.py
APP_SECRET_KEY = 0x8F3A2B1C9D4E5F6A

def generate_trial_json(output_path=None):
    """
    Generate a valid trial.json file with today's date and valid signature

    Args:
        output_path: Path where to write trial.json (optional, prints to stdout if None)

    Returns:
        dict: The generated trial data
    """
    # Get today's date in YYYY-MM-DD format
    today = datetime.now().strftime("%Y-%m-%d")

    # Generate signature (must match app.py's _validate_and_parse_trial function)
    signature_input = f"{today}{APP_SECRET_KEY}".encode()
    signature = hashlib.sha256(signature_input).hexdigest()

    # Create trial data
    trial_data = {
        "first_run_date": today,
        "signature": signature
    }

    # Write to file or print to stdout
    if output_path:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(trial_data, f)
        print(f"[SUCCESS] Generated valid trial.json at {output_path}", file=sys.stderr)
        print(f"[INFO] Trial start date: {today} (30 days from today)", file=sys.stderr)
    else:
        # Print JSON to stdout (for piping to file)
        print(json.dumps(trial_data))

    return trial_data

if __name__ == "__main__":
    # Check if output path provided as argument
    output_path = sys.argv[1] if len(sys.argv) > 1 else None

    try:
        generate_trial_json(output_path)
    except Exception as e:
        print(f"[ERROR] Failed to generate trial.json: {e}", file=sys.stderr)
        sys.exit(1)
