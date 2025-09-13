CURRENT_VERSION = "1.2.1"  # Update this with each release - Fixed customer issues: license validation, menu structure, analytics, mobile connection

from flask import Flask, request, jsonify, send_from_directory
from datetime import datetime, timedelta
import csv
import os
from config import Config
import win32print  # type: ignore
import time
import json
import requests
import threading
import uuid
import hashlib
import logging
import sys  # Added for auto-update functionality
from collections import Counter, defaultdict # Added for analytics
from queue import Queue, Empty
import atexit
import socket
import subprocess
import webbrowser
import signal
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


app = Flask(__name__)

# --- Signal handlers for graceful shutdown ---
def signal_handler(signum, frame):
    """Handle shutdown signals (SIGTERM, SIGINT) gracefully"""
    signal_names = {signal.SIGTERM: 'SIGTERM', signal.SIGINT: 'SIGINT'}
    signal_name = signal_names.get(signum, f'Signal {signum}')
    app.logger.info(f"Received {signal_name}, initiating graceful shutdown...")
    shutdown_server()

# Register signal handlers (will be set up after shutdown_server is defined)
def setup_signal_handlers():
    """Set up signal handlers for graceful shutdown"""
    try:
        signal.signal(signal.SIGTERM, signal_handler)
        signal.signal(signal.SIGINT, signal_handler)  # Handle Ctrl+C
        app.logger.info("Signal handlers registered for graceful shutdown")
    except Exception as e:
        app.logger.warning(f"Could not set up signal handlers: {e}")
# --- Lightweight in-process pub-sub for server-sent events (SSE) ---
_sse_subscribers: list[Queue] = []

def _sse_broadcast(event_name: str, payload: dict):
    try:
        data = json.dumps(payload, ensure_ascii=False)
    except Exception:
        data = '{}'
    for q in list(_sse_subscribers):
        try:
            q.put((event_name, data))
        except Exception:
            pass

# --- Cleanup handler for proper shutdown ---
def _cleanup_on_exit():
    """Cleanup function called when the process exits normally or abnormally"""
    try:
        _sse_subscribers.clear()
        app.logger.info("Application cleanup completed")
    except Exception:
        pass  # Don't raise exceptions during cleanup

# Register cleanup handler
atexit.register(_cleanup_on_exit)

# --- Cloudflare configuration (now using environment variables) ---
# Note: CF_FORCE_HARDCODED_KEY is deprecated - using Config.CLOUDFLARE_API_TOKEN instead


# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s')

# --- CORRECTED File Paths ---
# This block correctly determines the base directory whether running as a script or a frozen .exe
if getattr(sys, 'frozen', False):
    # If the application is run as a bundle/executable
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # If run as a normal python script
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    
# Enhanced path resolution: try multiple locations for data directory
def find_data_directory():
    """Find the data directory by trying multiple possible locations"""
    possible_paths = [
        # Customer's installation path
        r'C:\POSPal\data',
        # Primary: relative to executable/script
        os.path.join(BASE_DIR, 'data'),
        # Fallback: current working directory + data
        os.path.join(os.getcwd(), 'data'),
        # Fallback: executable directory + data (for cases where cwd is different)
        os.path.join(os.path.dirname(os.path.abspath(sys.executable if getattr(sys, 'frozen', False) else __file__)), 'data'),
        # Fallback: script directory + data (for development)
        os.path.dirname(os.path.abspath(__file__)) + '\\data' if not getattr(sys, 'frozen', False) else None
    ]
    
    # Filter out None values and check which paths exist
    valid_paths = [path for path in possible_paths if path and os.path.exists(path)]
    
    if valid_paths:
        # Prefer the path that contains menu.json
        for path in valid_paths:
            if os.path.exists(os.path.join(path, 'menu.json')):
                app.logger.info(f"Found data directory with menu.json: {path}")
                return path
        # If no path has menu.json, use the first valid path
        app.logger.info(f"Using data directory: {valid_paths[0]}")
        return valid_paths[0]
    else:
        # If no existing data directory found, create one relative to executable
        default_path = os.path.join(BASE_DIR, 'data')
        app.logger.warning(f"No existing data directory found. Creating default: {default_path}")
        os.makedirs(default_path, exist_ok=True)
        return default_path

DATA_DIR = find_data_directory()

def find_license_file():
    """Find license.key in the same directory as the executable"""
    # The license should always be next to the .exe file
    exe_dir = os.path.dirname(sys.executable)
    license_path = os.path.join(exe_dir, 'license.key')
    
    if os.path.exists(license_path):
        print(f"Found license file at: {license_path}")
        return license_path
    
    print(f"License file not found at: {license_path}")
    return license_path  # Return the path anyway for error reporting

TRIAL_INFO_FILE = os.path.join(DATA_DIR, 'trial.json')
LICENSE_FILE = find_license_file()
# Additional hardening: also store a copy of the trial info under ProgramData
PROGRAM_DATA_DIR = os.path.join(os.environ.get('PROGRAMDATA', r'C:\\ProgramData'), 'POSPal')
PROGRAM_TRIAL_FILE = os.path.join(PROGRAM_DATA_DIR, 'trial.json')
# Persistent publish marker bound to this machine (survives app folder deletion)
PERSIST_DIR = PROGRAM_DATA_DIR
PUBLISH_MARKER_FILE = os.path.join(PERSIST_DIR, 'published_site.json')

APP_SECRET_KEY = 0x8F3A2B1C9D4E5F6A  # Use a strong secret key

# License cache constants for hybrid cloud-first validation
LICENSE_CACHE_FILE = os.path.join(DATA_DIR, 'license_cache.enc')
LICENSE_CACHE_BACKUP = os.path.join(PROGRAM_DATA_DIR, 'license_cache.enc')
GRACE_PERIOD_DAYS = 10  # Days allowed offline after last successful validation
CLOUD_VALIDATION_TIMEOUT = 3  # Seconds to wait for cloud validation response

MENU_FILE = os.path.join(DATA_DIR, 'menu.json')
ORDER_COUNTER_FILE = os.path.join(DATA_DIR, 'order_counter.json')
ORDER_COUNTER_LOCK_FILE = os.path.join(DATA_DIR, 'order_counter.lock') # Lock file for order counter
CONFIG_FILE_OLD = os.path.join(BASE_DIR, 'config.json')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')

# --- NEW: Centralized State Management Files ---
CURRENT_ORDER_FILE = os.path.join(DATA_DIR, 'current_order.json')
ORDER_LINE_COUNTER_FILE = os.path.join(DATA_DIR, 'order_line_counter.json')
UNIVERSAL_COMMENT_FILE = os.path.join(DATA_DIR, 'universal_comment.json')
SELECTED_TABLE_FILE = os.path.join(DATA_DIR, 'selected_table.json')
DEVICE_SESSIONS_FILE = os.path.join(DATA_DIR, 'device_sessions.json')
USAGE_ANALYTICS_FILE = os.path.join(DATA_DIR, 'usage_analytics.json')

# --- Cloudflare Worker API Integration ---
CLOUDFLARE_WORKER_URL = "https://pospal-licensing-v2-development.bzoumboulis.workers.dev"

# Global session for connection pooling
_api_session = None
_api_session_lock = threading.Lock()

def get_api_session():
    """Get or create a shared HTTP session with connection pooling"""
    global _api_session
    with _api_session_lock:
        if _api_session is None:
            _api_session = requests.Session()
            # Configure connection pooling
            adapter = requests.adapters.HTTPAdapter(
                pool_connections=2,
                pool_maxsize=5,
                max_retries=0  # We handle retries manually
            )
            _api_session.mount('https://', adapter)
            _api_session.headers.update({
                'Content-Type': 'application/json',
                'User-Agent': f'POSPal/{CURRENT_VERSION}',
                'Accept': 'application/json'
            })
        return _api_session

def call_cloudflare_api(endpoint, data, timeout=15, max_retries=3):
    """Call Cloudflare Worker API with comprehensive error handling and retry logic"""
    import time
    
    # Input validation
    if not endpoint or not isinstance(endpoint, str):
        app.logger.error("Invalid endpoint provided to call_cloudflare_api")
        return None
    
    if not isinstance(data, dict):
        app.logger.error("Invalid data format provided to call_cloudflare_api")
        return None
    
    # Sanitize data size (prevent DoS)
    try:
        if len(json.dumps(data)) > 10240:  # 10KB limit
            app.logger.error("Request data too large for Cloudflare API call")
            return None
    except (TypeError, ValueError):
        app.logger.error("Unable to serialize data for Cloudflare API call")
        return None
    
    url = f"{CLOUDFLARE_WORKER_URL}{endpoint}"
    session = get_api_session()
    
    for attempt in range(max_retries + 1):
        try:
            app.logger.info(f"Calling Cloudflare API: {url} (attempt {attempt + 1}/{max_retries + 1})")
            
            response = session.post(
                url,
                json=data,
                timeout=timeout
            )
            
            # Check for successful response
            if response.status_code == 200:
                try:
                    result = response.json()
                    app.logger.info(f"Cloudflare API success: {endpoint}")
                    return result
                except json.JSONDecodeError:
                    app.logger.error(f"Cloudflare API returned invalid JSON for {endpoint}")
                    return None
            
            # Handle specific error codes
            elif response.status_code == 429:  # Rate limited
                app.logger.warning(f"Cloudflare API rate limited for {endpoint}")
                if attempt < max_retries:
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                return None
            
            elif response.status_code in [500, 502, 503, 504]:  # Server errors - retry
                app.logger.warning(f"Cloudflare API server error {response.status_code} for {endpoint}")
                if attempt < max_retries:
                    time.sleep(2 ** attempt)  # Exponential backoff
                    continue
                return None
            
            elif response.status_code in [400, 401, 403, 404]:  # Client errors - don't retry
                app.logger.error(f"Cloudflare API client error {response.status_code} for {endpoint}: {response.text[:500]}")
                return None
            
            else:
                app.logger.error(f"Cloudflare API unexpected status {response.status_code} for {endpoint}: {response.text[:500]}")
                return None
                
        except requests.exceptions.Timeout:
            app.logger.warning(f"Cloudflare API timeout for {endpoint} (attempt {attempt + 1})")
            if attempt < max_retries:
                time.sleep(1 + attempt)  # Linear backoff for timeouts
                continue
            return None
            
        except requests.exceptions.ConnectionError:
            app.logger.warning(f"Cloudflare API connection error for {endpoint} (attempt {attempt + 1})")
            if attempt < max_retries:
                time.sleep(2 ** attempt)  # Exponential backoff
                continue
            return None
            
        except requests.exceptions.HTTPError as e:
            app.logger.error(f"Cloudflare API HTTP error for {endpoint}: {e}")
            return None
            
        except Exception as e:
            app.logger.error(f"Cloudflare API unexpected error for {endpoint}: {e}")
            return None
    
    app.logger.error(f"Cloudflare API failed after {max_retries + 1} attempts for {endpoint}")
    return None

# License data cache to avoid frequent file reads
_license_data_cache = None
_license_cache_time = 0
_license_cache_lock = threading.Lock()
LICENSE_CACHE_TTL = 60  # Cache for 60 seconds

def get_license_data(force_reload=False):
    """Get license data from local file with security, caching, and proper parsing"""
    global _license_data_cache, _license_cache_time
    
    # Check cache first
    if not force_reload:
        with _license_cache_lock:
            if _license_data_cache is not None and time.time() - _license_cache_time < LICENSE_CACHE_TTL:
                return _license_data_cache
    
    try:
        license_file = find_license_file()
        if not license_file or not os.path.exists(license_file):
            app.logger.warning("License file not found")
            return None
        
        # Verify file permissions and size
        try:
            stat_info = os.stat(license_file)
            # Prevent reading huge files (security)
            if stat_info.st_size > 16384:  # 16KB limit
                app.logger.error(f"License file too large: {stat_info.st_size} bytes")
                return None
                
            # On Windows, check if file is accessible
            if not os.access(license_file, os.R_OK):
                app.logger.error("License file not readable")
                return None
                
        except (OSError, IOError) as e:
            app.logger.error(f"Cannot access license file: {e}")
            return None
        
        # Read file with proper encoding and error handling
        try:
            with open(license_file, 'r', encoding='utf-8', errors='strict') as f:
                content = f.read(16384)  # Limit read size
                
            if not content.strip():
                app.logger.warning("License file is empty")
                return None
                
        except UnicodeDecodeError:
            app.logger.error("License file contains invalid UTF-8")
            return None
        except (IOError, OSError) as e:
            app.logger.error(f"Error reading license file: {e}")
            return None
        
        # Parse license data with validation
        license_data = None
        content = content.strip()
        
        # Try JSON parsing first
        try:
            license_data = json.loads(content)
            if not isinstance(license_data, dict):
                app.logger.error("License JSON must be an object")
                return None
        except json.JSONDecodeError:
            # Fallback to key-value parsing with validation
            license_data = {}
            lines_processed = 0
            
            for line in content.split('\n'):
                lines_processed += 1
                if lines_processed > 50:  # Prevent DoS with huge files
                    app.logger.error("License file has too many lines")
                    return None
                    
                line = line.strip()
                if not line or line.startswith('#'):  # Skip empty lines and comments
                    continue
                    
                if '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Validate key format
                    if not key or not key.replace('_', '').replace('-', '').isalnum():
                        app.logger.warning(f"Invalid license key format: {key}")
                        continue
                        
                    # Limit value length
                    if len(value) > 1024:  # 1KB per value max
                        app.logger.warning(f"License value too long for key: {key}")
                        continue
                        
                    license_data[key] = value
            
            if not license_data:
                app.logger.warning("No valid license data found")
                return None
        
        # Validate required fields for license data
        if isinstance(license_data, dict):
            # Remove any potentially dangerous keys
            dangerous_keys = ['__class__', '__module__', '__dict__', '__weakref__']
            for dangerous_key in dangerous_keys:
                license_data.pop(dangerous_key, None)
            
            # Limit total number of keys
            if len(license_data) > 20:
                app.logger.warning("License file has too many keys, truncating")
                license_data = dict(list(license_data.items())[:20])
        
        # Cache the result
        with _license_cache_lock:
            _license_data_cache = license_data
            _license_cache_time = time.time()
            
        app.logger.info("License data loaded successfully")
        return license_data
        
    except Exception as e:
        app.logger.error(f"Unexpected error reading license data: {e}")
        return None

# --- Rate Limiting Infrastructure ---
_rate_limit_data = {}
_rate_limit_lock = threading.Lock()

def check_rate_limit(client_ip, endpoint, max_requests=10, window_seconds=60):
    """Simple rate limiting per client IP and endpoint"""
    import time
    
    current_time = time.time()
    key = f"{client_ip}:{endpoint}"
    
    with _rate_limit_lock:
        if key not in _rate_limit_data:
            _rate_limit_data[key] = []
        
        # Clean old requests outside the window
        _rate_limit_data[key] = [req_time for req_time in _rate_limit_data[key] 
                                if current_time - req_time < window_seconds]
        
        # Check if limit exceeded
        if len(_rate_limit_data[key]) >= max_requests:
            return False
        
        # Add current request
        _rate_limit_data[key].append(current_time)
        return True

def validate_email(email):
    """Basic email validation"""
    import re
    if not email or not isinstance(email, str):
        return False
    if len(email) > 254:  # RFC 5321 limit
        return False
    
    # Simple regex for basic validation
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_hardware_id(hardware_id):
    """Validate hardware ID format"""
    if not hardware_id or not isinstance(hardware_id, str):
        return False
    if len(hardware_id) < 10 or len(hardware_id) > 128:
        return False
    # Allow alphanumeric, dashes, and underscores
    return all(c.isalnum() or c in '-_' for c in hardware_id)

def sanitize_string_input(value, max_length=255):
    """Sanitize string input"""
    if not isinstance(value, str):
        return None
    # Strip whitespace and limit length
    sanitized = value.strip()[:max_length]
    # Remove null bytes and control characters
    sanitized = ''.join(c for c in sanitized if ord(c) >= 32 or c in '\t\n\r')
    return sanitized if sanitized else None

# --- Single-instance guard (Windows mutex with lock-file fallback) ---
SINGLE_INSTANCE_MUTEX_NAME = r"Global\\POSPalServerSingleton"
APP_INSTANCE_LOCK_FILE = os.path.join(DATA_DIR, 'app_instance.lock')
_instance_mutex_handle = None
_lock_file_fd = None

def acquire_single_instance_lock():
    """Ensure only one backend instance runs on this machine.

    Strategy:
    - First try a Windows named mutex (works best on Windows; requires pywin32).
    - If that fails, fall back to a simple lock file created with O_EXCL.
    - Includes retry mechanism for transient startup issues.
    """
    global _instance_mutex_handle, _lock_file_fd

    # Try Windows named mutex first
    try:
        import win32event  # type: ignore
        import win32api    # type: ignore
        import winerror    # type: ignore

        _instance_mutex_handle = win32event.CreateMutex(None, False, SINGLE_INSTANCE_MUTEX_NAME)
        last_error = win32api.GetLastError()
        if last_error == winerror.ERROR_ALREADY_EXISTS:
            logging.error("Another POSPal instance is already running (mutex). Exiting.")
            return False
        logging.info("Acquired single-instance mutex: %s", SINGLE_INSTANCE_MUTEX_NAME)
        return True
    except Exception as e:
        logging.warning("Mutex guard unavailable (%s). Falling back to lock file.", str(e))

    # Fallback: lock file with retry mechanism
    max_retries = 3
    for attempt in range(max_retries):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            
            # Check if there's a stale lock file from a crashed process
            if os.path.exists(APP_INSTANCE_LOCK_FILE):
                try:
                    with open(APP_INSTANCE_LOCK_FILE, 'r') as f:
                        pid_str = f.read().strip()
                        if pid_str.isdigit():
                            old_pid = int(pid_str)
                            # Check if the process is still running
                            if not _is_process_running(old_pid):
                                logging.warning(f"Removing stale lock file from PID {old_pid}")
                                os.remove(APP_INSTANCE_LOCK_FILE)
                except (ValueError, OSError) as e:
                    logging.warning(f"Error checking stale lock file: {e}")
                    # If we can't read/check the file, try to remove it anyway
                    try:
                        os.remove(APP_INSTANCE_LOCK_FILE)
                    except OSError:
                        pass

            _lock_file_fd = os.open(APP_INSTANCE_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.write(_lock_file_fd, str(os.getpid()).encode())
            logging.info("Acquired single-instance lock file: %s", APP_INSTANCE_LOCK_FILE)
            return True
        except FileExistsError:
            if attempt == max_retries - 1:
                logging.error("Another POSPal instance is already running (lock file). Exiting.")
                return False
            else:
                logging.warning(f"Lock file exists, retrying in 1 second... (attempt {attempt + 1}/{max_retries})")
                time.sleep(1)
        except Exception as e:
            if attempt == max_retries - 1:
                logging.error("Failed to acquire single-instance lock: %s", str(e))
                return False
            else:
                logging.warning(f"Lock acquisition failed, retrying... (attempt {attempt + 1}/{max_retries}): {e}")
                time.sleep(1)

    return False

def _is_process_running(pid):
    """Check if a process with the given PID is still running."""
    try:
        import psutil
        return psutil.pid_exists(pid)
    except ImportError:
        # Fallback for Windows without psutil
        try:
            import subprocess
            result = subprocess.run(['tasklist', '/FI', f'PID eq {pid}'], 
                                  capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
            return str(pid) in result.stdout
        except Exception:
            # If we can't check, assume the process might be running
            return True

def _is_running_as_admin():
    """Check if the current process is running with administrator privileges."""
    if os.name != 'nt':
        return True  # Non-Windows systems don't need admin for port binding
    
    try:
        import ctypes
        return ctypes.windll.shell32.IsUserAnAdmin() != 0
    except Exception:
        return False

def _setup_windows_firewall_rules_for_ports(ports_to_configure):
    """Setup Windows Firewall rules for multiple ports."""
    if os.name != 'nt':
        return True, "Not Windows - no firewall rules needed"
    
    import socket
    configured_ports = []
    failed_ports = []
    
    for port in ports_to_configure:
        try:
            port = int(port)
            # Test if port is available
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    s.bind(('0.0.0.0', port))
            except OSError as e:
                app.logger.warning(f"Port {port} is not available: {e}")
                failed_ports.append(f"Port {port} unavailable")
                continue
            
            rule_name = f"POSPal {port}"
            
            # Check if rule already exists
            check_cmd = ['netsh', 'advfirewall', 'firewall', 'show', 'rule', f'name={rule_name}']
            try:
                check_result = subprocess.run(check_cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
                if check_result.returncode == 0 and rule_name in check_result.stdout:
                    app.logger.info(f"Firewall rule '{rule_name}' already exists")
                    configured_ports.append(port)
                    continue
            except Exception:
                pass
            
            # Create the firewall rule
            add_cmd = [
                'netsh', 'advfirewall', 'firewall', 'add', 'rule',
                f'name={rule_name}', 'dir=in', 'action=allow', 'protocol=TCP', f'localport={port}'
            ]
            
            result = subprocess.run(add_cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
            
            if result.returncode == 0:
                app.logger.info(f"Created firewall rule for port {port}")
                configured_ports.append(port)
            else:
                error_msg = (result.stderr or result.stdout or "Unknown error").strip()
                app.logger.warning(f"Failed to create firewall rule for port {port}: {error_msg}")
                failed_ports.append(f"Port {port}: {error_msg}")
                
        except Exception as e:
            app.logger.warning(f"Error setting up firewall rule for port {port}: {e}")
            failed_ports.append(f"Port {port}: {e}")
    
    if configured_ports:
        success_msg = f"Configured firewall rules for ports: {configured_ports}"
        if failed_ports:
            success_msg += f" (Failed: {failed_ports})"
        return True, success_msg
    else:
        return False, f"Failed to configure any firewall rules: {failed_ports}"

def _setup_windows_firewall_rule():
    """Automatically create Windows Firewall rule for POSPal during startup."""
    if os.name != 'nt':
        return True, "Not Windows - no firewall rule needed"
    
    # Check if multi-port mode is enabled
    if config.get('enable_multi_port', False):
        # Configure firewall for primary port + fallback ports
        primary_port = int(config.get('port', 5000))
        fallback_ports = config.get('fallback_ports', [8080, 3000, 8000, 9000])
        all_ports = [primary_port] + [p for p in fallback_ports if p != primary_port]
        return _setup_windows_firewall_rules_for_ports(all_ports)
    
    # Original single-port behavior (backwards compatible)
    import socket
    port = int(config.get('port', 5000))
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('0.0.0.0', port))
            app.logger.info(f"Port {port} is available for binding")
    except OSError as e:
        app.logger.error(f"Port {port} is not available: {e}")
        return False, f"Port {port} is not available: {e}"
    
    try:
        port = int(config.get('port', 5000))
        rule_name = f"POSPal {port}"
        
        # First check if rule already exists
        check_cmd = [
            'netsh', 'advfirewall', 'firewall', 'show', 'rule', f'name={rule_name}'
        ]
        
        try:
            check_result = subprocess.run(check_cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
            if check_result.returncode == 0 and rule_name in check_result.stdout:
                app.logger.info(f"Firewall rule '{rule_name}' already exists")
                return True, f"Firewall rule '{rule_name}' already exists"
        except Exception:
            pass
        
        # Check if this is first run and no firewall rule exists
        first_run_marker = os.path.join(DATA_DIR, 'firewall_setup_attempted.json')
        is_first_run = not os.path.exists(first_run_marker)
        
        # Try to create the rule
        add_cmd = [
            'netsh', 'advfirewall', 'firewall', 'add', 'rule',
            f'name={rule_name}', 'dir=in', 'action=allow', 'protocol=TCP', f'localport={port}'
        ]
        
        result = subprocess.run(add_cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        
        # Mark that we've attempted firewall setup
        try:
            with open(first_run_marker, 'w') as f:
                json.dump({
                    "attempted": True,
                    "timestamp": datetime.now().isoformat(),
                    "success": result.returncode == 0
                }, f)
        except Exception:
            pass
        
        if result.returncode == 0:
            app.logger.info(f"Successfully created Windows Firewall rule for port {port}")
            return True, f"Created firewall rule for port {port}"
        else:
            error_msg = (result.stderr or result.stdout or "Unknown error").strip()
            if 'requires elevation' in error_msg.lower() or 'access denied' in error_msg.lower():
                # If this is first run, offer to restart with admin privileges
                if is_first_run and getattr(sys, 'frozen', False):
                    app.logger.warning(f"First run detected - firewall setup requires admin privileges")
                    return False, f"First run - admin privileges needed for network access"
                else:
                    app.logger.warning(f"Cannot create firewall rule - requires admin privileges: {error_msg}")
                    return False, f"Admin privileges required to create firewall rule: {error_msg}"
            else:
                app.logger.warning(f"Failed to create firewall rule: {error_msg}")
                return False, f"Failed to create firewall rule: {error_msg}"
                
    except Exception as e:
        app.logger.warning(f"Error setting up firewall rule: {e}")
        return False, f"Error setting up firewall rule: {e}"

def _offer_admin_restart():
    """Offer to restart POSPal with admin privileges for firewall setup."""
    if not getattr(sys, 'frozen', False):
        return False  # Only works for compiled exe
    
    try:
        import ctypes
        
        # Check if we're already running as admin
        if ctypes.windll.shell32.IsUserAnAdmin():
            return False  # Already admin
        
        # Create restart script that will run POSPal as admin
        restart_script = os.path.join(DATA_DIR, 'restart_as_admin.bat')
        exe_path = sys.executable
        
        with open(restart_script, 'w') as f:
            f.write(f'@echo off\n')
            f.write(f'echo Restarting POSPal with administrator privileges for firewall setup...\n')
            f.write(f'timeout /t 2 /nobreak >nul\n')
            f.write(f'powershell -Command "Start-Process \\"{exe_path}\\" -Verb runAs"\n')
            f.write(f'del "%~f0"\n')  # Delete the script after use
        
        app.logger.info(f"Created admin restart script: {restart_script}")
        return restart_script
        
    except Exception as e:
        app.logger.warning(f"Could not create admin restart option: {e}")
        return False

def release_single_instance_lock():
    """Release resources for the single-instance guard."""
    global _instance_mutex_handle, _lock_file_fd
    try:
        if _instance_mutex_handle is not None:
            try:
                import win32api  # type: ignore
                win32api.CloseHandle(_instance_mutex_handle)
            except Exception:
                pass
            _instance_mutex_handle = None
    except Exception:
        pass

    try:
        if _lock_file_fd is not None:
            try:
                os.close(_lock_file_fd)
            except Exception:
                pass
            _lock_file_fd = None
        if os.path.exists(APP_INSTANCE_LOCK_FILE):
            try:
                os.remove(APP_INSTANCE_LOCK_FILE)
            except Exception:
                pass
    except Exception:
        pass

atexit.register(release_single_instance_lock)

# --- ESC/POS Commands ---
ESC = b'\x1B'
GS = b'\x1D'
InitializePrinter = ESC + b'@'
BoldOn = ESC + b'E\x01'
BoldOff = ESC + b'E\x00'
DoubleHeightWidth = GS + b'!\x11'  # Double Height and Double Width
DoubleHeight = GS + b'!\x01'       # Double Height only
DoubleWidth = GS + b'!\x10'        # Double Width only
NormalText = GS + b'!\x00'
AlignLeft = ESC + b'a\x00'
AlignCenter = ESC + b'a\x01'
AlignRight = ESC + b'a\x02'
SelectFontA = ESC + b'M\x00' # Standard Font A
SelectFontB = ESC + b'M\x01' # Smaller Font B (often used for details)
FullCut = GS + b'V\x00'
PartialCut = GS + b'V\x01' # Or m=66 for some printers


# Disable legacy PDF fallback (not supported). Define flags and stub to avoid lints.
PDF_FALLBACK_ENABLED = False
def generate_pdf_ticket(order_data, copy_info, original_timestamp_str=None):
    return False

# Ensure data directory exists
os.makedirs(DATA_DIR, exist_ok=True)

"""
PDF fallback has been removed. Printing must succeed to submit an order.
"""

# --- NEW: Centralized State Management Functions ---
def load_centralized_state():
    """Load all centralized state from files"""
    state = {
        'current_order': [],
        'order_line_counter': 0,
        'universal_comment': "",
        'selected_table': "",
        'device_sessions': {}
    }
    
    # Load current order
    if os.path.exists(CURRENT_ORDER_FILE):
        try:
            with open(CURRENT_ORDER_FILE, 'r', encoding='utf-8') as f:
                state['current_order'] = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            state['current_order'] = []
    
    # Load order line counter
    if os.path.exists(ORDER_LINE_COUNTER_FILE):
        try:
            with open(ORDER_LINE_COUNTER_FILE, 'r', encoding='utf-8') as f:
                state['order_line_counter'] = int(f.read().strip())
        except (ValueError, FileNotFoundError):
            state['order_line_counter'] = 0
    
    # Load universal comment
    if os.path.exists(UNIVERSAL_COMMENT_FILE):
        try:
            with open(UNIVERSAL_COMMENT_FILE, 'r', encoding='utf-8') as f:
                state['universal_comment'] = f.read().strip()
        except FileNotFoundError:
            state['universal_comment'] = ""
    
    # Load selected table
    if os.path.exists(SELECTED_TABLE_FILE):
        try:
            with open(SELECTED_TABLE_FILE, 'r', encoding='utf-8') as f:
                state['selected_table'] = f.read().strip()
        except FileNotFoundError:
            state['selected_table'] = ""
    
    # Load device sessions (tolerate legacy formats and migrate)
    if os.path.exists(DEVICE_SESSIONS_FILE):
        try:
            with open(DEVICE_SESSIONS_FILE, 'r', encoding='utf-8') as f:
                raw_sessions = json.load(f)

            migrated = {}
            if isinstance(raw_sessions, dict):
                # Legacy shape: {"sessions": [...]} or correct dict mapping
                if 'sessions' in raw_sessions and isinstance(raw_sessions['sessions'], list):
                    for entry in raw_sessions['sessions']:
                        if isinstance(entry, dict):
                            device_id = entry.get('device_id') or entry.get('id') or entry.get('device')
                            if device_id:
                                migrated[device_id] = {k: v for k, v in entry.items() if k not in ('device_id','id','device')}
                    # Persist migrated structure
                    if save_centralized_state('device_sessions', migrated):
                        state['device_sessions'] = migrated
                    else:
                        state['device_sessions'] = migrated
                else:
                    state['device_sessions'] = raw_sessions
            elif isinstance(raw_sessions, list):
                for entry in raw_sessions:
                    if isinstance(entry, dict):
                        device_id = entry.get('device_id') or entry.get('id') or entry.get('device')
                        if device_id:
                            migrated[device_id] = {k: v for k, v in entry.items() if k not in ('device_id','id','device')}
                if save_centralized_state('device_sessions', migrated):
                    state['device_sessions'] = migrated
                else:
                    state['device_sessions'] = migrated
            else:
                state['device_sessions'] = {}
        except (json.JSONDecodeError, FileNotFoundError):
            state['device_sessions'] = {}
        except Exception as e:
            app.logger.warning(f"Device sessions file in unexpected format: {e}")
            state['device_sessions'] = {}
    
    return state

def save_centralized_state(state_key, value):
    """Save a specific state value to file"""
    try:
        if state_key == 'current_order':
            with open(CURRENT_ORDER_FILE, 'w', encoding='utf-8') as f:
                json.dump(value, f, indent=2)
        elif state_key == 'order_line_counter':
            with open(ORDER_LINE_COUNTER_FILE, 'w', encoding='utf-8') as f:
                f.write(str(value))
        elif state_key == 'universal_comment':
            with open(UNIVERSAL_COMMENT_FILE, 'w', encoding='utf-8') as f:
                f.write(str(value))
        elif state_key == 'selected_table':
            with open(SELECTED_TABLE_FILE, 'w', encoding='utf-8') as f:
                f.write(str(value))
        elif state_key == 'device_sessions':
            with open(DEVICE_SESSIONS_FILE, 'w', encoding='utf-8') as f:
                json.dump(value, f, indent=2)
        return True
    except Exception as e:
        app.logger.error(f"Error saving {state_key}: {str(e)}")
        return False

def register_device_session(device_id, device_info):
    """Register a device session for tracking"""
    state = load_centralized_state()
    state['device_sessions'][device_id] = {
        'info': device_info,
        'last_seen': datetime.now().isoformat(),
        'active': True
    }
    return save_centralized_state('device_sessions', state['device_sessions'])

def update_device_session(device_id):
    """Update device session timestamp"""
    state = load_centralized_state()
    if device_id in state['device_sessions']:
        state['device_sessions'][device_id]['last_seen'] = datetime.now().isoformat()
        return save_centralized_state('device_sessions', state['device_sessions'])
    return False

def cleanup_inactive_sessions():
    """Remove sessions older than 30 minutes"""
    state = load_centralized_state()
    cutoff_time = datetime.now() - timedelta(minutes=30)
    active_sessions = {}
    
    for device_id, session in state['device_sessions'].items():
        try:
            last_seen = datetime.fromisoformat(session['last_seen'])
            if last_seen > cutoff_time:
                active_sessions[device_id] = session
        except ValueError:
            # Invalid timestamp, remove session
            continue
    
    if len(active_sessions) != len(state['device_sessions']):
        save_centralized_state('device_sessions', active_sessions)
        app.logger.info(f"Cleaned up {len(state['device_sessions']) - len(active_sessions)} inactive sessions")
    
    return active_sessions


def is_version_newer(latest_version, current_version):
    """
    Return True if latest_version is strictly newer than current_version.
    Compares dot-separated numeric versions, ignoring a leading 'v'.
    """
    def parse_version(version_string):
        parts = version_string.lstrip('v').split('.')
        numbers = []
        for part in parts:
            try:
                numbers.append(int(part))
            except ValueError:
                numbers.append(0)
        return numbers

    latest_numbers = parse_version(latest_version)
    current_numbers = parse_version(current_version)

    max_len = max(len(latest_numbers), len(current_numbers))
    latest_numbers += [0] * (max_len - len(latest_numbers))
    current_numbers += [0] * (max_len - len(current_numbers))
    return latest_numbers > current_numbers

def load_config():
    # Ensure data directory exists BEFORE loading config
    os.makedirs(DATA_DIR, exist_ok=True)
    
    defaults = {
        "printer_name": "Microsoft Print to PDF",
        "port": 5000,
        "management_password": "9999", # Default password
        "cut_after_print": True,
        "copies_per_order": 2,
        # UI language for in-app interface (receipts remain English-only)
        "language": "en",
        # Network connectivity settings for problematic routers/firewalls
        "enable_multi_port": False,
        "fallback_ports": [8080, 3000, 8000, 9000],
        # Cloudflare Online Menu publishing defaults
        "cloudflare_api_base": "https://menus-api.bzoumboulis.workers.dev/",
        "cloudflare_api_key": "",
        "cloudflare_api_key_enc": "",
        "cloudflare_store_slug": "",
        "cloudflare_store_slug_locked": False,
        # Public viewer base, e.g., https://menus.example.com
        "cloudflare_public_base": "https://menus-5ar.pages.dev/"
    }
    # Migrate legacy config.json (root) to data/config.json if needed
    try:
        if not os.path.exists(CONFIG_FILE) and os.path.exists(CONFIG_FILE_OLD):
            try:
                os.replace(CONFIG_FILE_OLD, CONFIG_FILE)
            except Exception:
                # Fallback to copy if replace fails (e.g., cross-device)
                with open(CONFIG_FILE_OLD, 'r') as _src, open(CONFIG_FILE, 'w') as _dst:
                    _dst.write(_src.read())
    except Exception as e:
        app.logger.warning(f"Config migration warning: {e}")

    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                config_from_file = json.load(f)
                defaults.update(config_from_file)
        except json.JSONDecodeError:
            app.logger.error(f"Error decoding {CONFIG_FILE}. Using default values.")
    return defaults

config = load_config()
PRINTER_NAME = config["printer_name"]
MANAGEMENT_PASSWORD = str(config["management_password"]) # Ensure password is a string
CUT_AFTER_PRINT = bool(config.get("cut_after_print", True))
COPIES_PER_ORDER = int(config.get("copies_per_order", 2))

# Disable debug mode
app.config['DEBUG'] = False

# Add rate limiting
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)


def to_bytes(s, encoding='cp437'): 
    """Convert string to bytes with Greek character transliteration for thermal printers"""
    if isinstance(s, bytes):
        return s
    
    # Check if string contains Greek characters
    has_greek = any('\u0370' <= char <= '\u03FF' or '\u1F00' <= char <= '\u1FFF' for char in s)
    
    if has_greek:
        # Always transliterate Greek characters to readable Latin
        transliterated = transliterate_greek_enhanced(s)
        return transliterated.encode('cp437', errors='replace')
    else:
        # English/Latin text - use standard encoding
        return s.encode(encoding, errors='replace')

def transliterate_greek_enhanced(text):
    """
    Enhanced Greek transliteration with better readability for receipts.
    Uses context-aware mapping and common Greek food/business terms.
    """
    
    # First handle common Greek food/business terms that customers will recognize
    common_terms = {
        'καφές': 'KAFES',           # Coffee
        'καφέ': 'KAFE',
        'τσάι': 'TSAI',             # Tea  
        'νερό': 'NERO',             # Water
        'τυρόπιτα': 'TYROPITA',     # Cheese pie
        'σπανακόπιτα': 'SPANAKOPITA', # Spinach pie
        'μουσακάς': 'MOUSAKAS',     # Moussaka
        'σαλάτα': 'SALATA',         # Salad
        'κρέας': 'KREAS',           # Meat
        'ψάρι': 'PSARI',            # Fish
        'πατάτες': 'PATATES',       # Potatoes
        'κρεμμύδι': 'KREMMYDI',     # Onion
        'ντομάτα': 'DOMATA',        # Tomato
        'τυρί': 'TYRI',             # Cheese
        'ψωμί': 'PSOMI',            # Bread
        'κρασί': 'KRASI',           # Wine
        'μπίρα': 'BIRA',            # Beer
        'γάλα': 'GALA',             # Milk
        'ζάχαρη': 'ZAHARI',         # Sugar
        'αλάτι': 'ALATI',           # Salt
        'πιπέρι': 'PIPERI',         # Pepper
        'ελιές': 'ELIES',           # Olives
        'φέτα': 'FETA',             # Feta cheese
        'γιαούρτι': 'GIAOYRTI',     # Yogurt
        'μέλι': 'MELI',             # Honey
        'σοκολάτα': 'SOKOLATA',     # Chocolate
        'παγωτό': 'PAGOTO',         # Ice cream
    }
    
    # Check for whole word matches first (case insensitive)
    text_lower = text.lower()
    for greek_word, latin_word in common_terms.items():
        if greek_word in text_lower:
            text = text.replace(greek_word, latin_word)
            text = text.replace(greek_word.upper(), latin_word)
            text = text.replace(greek_word.capitalize(), latin_word)
    
    # Enhanced character-by-character mapping
    enhanced_greek_to_latin = {
        # Basic Greek alphabet with better phonetic mapping
        'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th',
        'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'n', 'ξ': 'ks', 'ο': 'o', 'π': 'p',
        'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f', 'χ': 'h', 'ψ': 'ps', 'ω': 'o',
        
        # Capital letters
        'Α': 'A', 'Β': 'V', 'Γ': 'G', 'Δ': 'D', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'I', 'Θ': 'TH',
        'Ι': 'I', 'Κ': 'K', 'Λ': 'L', 'Μ': 'M', 'Ν': 'N', 'Ξ': 'KS', 'Ο': 'O', 'Π': 'P',
        'Ρ': 'R', 'Σ': 'S', 'Τ': 'T', 'Υ': 'Y', 'Φ': 'F', 'Χ': 'H', 'Ψ': 'PS', 'Ω': 'O',
        
        # Accented characters (maintain vowel sounds)
        'ά': 'a', 'έ': 'e', 'ή': 'i', 'ί': 'i', 'ό': 'o', 'ύ': 'y', 'ώ': 'o',
        'ΐ': 'i', 'ΰ': 'y', 'ϊ': 'i', 'ϋ': 'y',
        
        # Common digraph patterns in Greek
        'ου': 'ou', 'ΟΥ': 'OU', 'Ου': 'Ou',
        'αι': 'ai', 'ΑΙ': 'AI', 'Αι': 'Ai',
        'ει': 'ei', 'ΕΙ': 'EI', 'Ει': 'Ei',
        'οι': 'oi', 'ΟΙ': 'OI', 'Οι': 'Oi',
        'υι': 'yi', 'ΥΙ': 'YI', 'Υι': 'Yi',
        'αυ': 'af', 'ΑΥ': 'AF', 'Αυ': 'Af',
        'ευ': 'ef', 'ΕΥ': 'EF', 'Ευ': 'Ef',
        
        # Common prefixes and suffixes
        'μπ': 'b', 'ΜΠ': 'B', 'Μπ': 'B',      # μπ -> b sound
        'ντ': 'd', 'ΝΤ': 'D', 'Ντ': 'D',      # ντ -> d sound  
        'γκ': 'g', 'ΓΚ': 'G', 'Γκ': 'G',      # γκ -> g sound
        'τζ': 'tz', 'ΤΖ': 'TZ', 'Τζ': 'Tz',   # τζ -> tz sound
        'τσ': 'ts', 'ΤΣ': 'TS', 'Τς': 'Ts',   # τσ -> ts sound
    }
    
    # Apply character mapping
    result = ''
    i = 0
    while i < len(text):
        # Try two-character patterns first
        if i < len(text) - 1:
            two_char = text[i:i+2]
            if two_char in enhanced_greek_to_latin:
                result += enhanced_greek_to_latin[two_char]
                i += 2
                continue
        
        # Single character mapping
        char = text[i]
        result += enhanced_greek_to_latin.get(char, char)
        i += 1
    
    return result
    
def save_config(updated_values: dict):
    """Merge-update CONFIG_FILE atomically and refresh globals."""
    global config, PRINTER_NAME, MANAGEMENT_PASSWORD, CUT_AFTER_PRINT, COPIES_PER_ORDER
    try:
        existing = {}
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                try:
                    existing = json.load(f) or {}
                except json.JSONDecodeError:
                    existing = {}
        merged = {**load_config(), **existing, **updated_values}
        tmp = CONFIG_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(merged, f, indent=4)
        os.replace(tmp, CONFIG_FILE)
        # refresh globals
        config = merged
        PRINTER_NAME = config.get("printer_name", PRINTER_NAME)
        MANAGEMENT_PASSWORD = str(config.get("management_password", MANAGEMENT_PASSWORD))
        CUT_AFTER_PRINT = bool(config.get("cut_after_print", CUT_AFTER_PRINT))
        try:
            COPIES_PER_ORDER = int(config.get("copies_per_order", COPIES_PER_ORDER))
        except Exception:
            COPIES_PER_ORDER = 2
        # No globals for Cloudflare; read from config directly where needed
        return True
    except Exception as e:
        app.logger.error(f"Failed to save config: {e}")
        return False

# --- Cloudflare Online Menu Settings ---
@app.route('/api/settings/cloudflare', methods=['GET', 'POST'])
def cloudflare_settings():
    if request.method == 'GET':
        # Do not expose api key in GET
        payload = {
            "cloudflare_api_base": str(config.get('cloudflare_api_base', '')),
            "cloudflare_store_slug": str(config.get('cloudflare_store_slug', '')),
            "cloudflare_public_base": str(config.get('cloudflare_public_base', '')),
            "cloudflare_store_slug_locked": bool(config.get('cloudflare_store_slug_locked', False))
        }
        # If app folder was deleted but this is the same machine, surface persisted publish marker
        try:
            if os.path.exists(PUBLISH_MARKER_FILE):
                with open(PUBLISH_MARKER_FILE, 'r', encoding='utf-8') as f:
                    marker = json.load(f)
                payload['persisted_public_url'] = marker.get('public_url')
                payload['persisted_slug'] = marker.get('slug')
        except Exception:
            pass
        return jsonify(payload)
    data = request.get_json(silent=True) or {}
    # Allow updating any of these
    allowed_keys = [
        'cloudflare_api_base',
        'cloudflare_store_slug',
        'cloudflare_public_base'
    ]
    updates = {k: str(v) for k, v in data.items() if k in allowed_keys}
    # Enforce slug lock: once set and locked, it cannot change
    if 'cloudflare_store_slug' in updates:
        current_slug = str(config.get('cloudflare_store_slug', ''))
        locked = bool(config.get('cloudflare_store_slug_locked', False))
        new_slug = updates['cloudflare_store_slug'].strip()
        if locked and current_slug and new_slug and new_slug != current_slug:
            return jsonify({"success": False, "message": "Store slug is locked and cannot be changed."}), 400
        # Normalize slug to lowercase kebab
        updates['cloudflare_store_slug'] = new_slug.lower()
    if not updates:
        return jsonify({"success": False, "message": "No settings provided."}), 400
    if save_config(updates):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to save settings."}), 500

# --- Publish current menu to Cloudflare Worker API ---
@app.route('/api/publish/cloudflare', methods=['POST'])
def publish_menu_cloudflare():
    try:
        # CRITICAL: Check if slug is locked - prevent multiple website creation
        if bool(config.get('cloudflare_store_slug_locked', False)):
            # Allow updates to existing website, but do not allow slug changes
            existing_slug = str(config.get('cloudflare_store_slug', '')).strip()
            if not existing_slug:
                return jsonify({"success": False, "message": "Website is locked but no slug found. Contact support."}), 400
            # Force use of existing slug
            store_slug = existing_slug
        else:
            # First time publish - read slug from config
            store_slug = str(config.get('cloudflare_store_slug', '')).strip()
        
        # Load current menu
        if not os.path.exists(MENU_FILE):
            return jsonify({"success": False, "message": "menu.json not found"}), 400
        with open(MENU_FILE, 'r', encoding='utf-8') as f:
            menu_data = json.load(f)

        # Read config
        api_base = str(config.get('cloudflare_api_base', '')).rstrip('/')
        api_key = Config.CLOUDFLARE_API_TOKEN or str(config.get('cloudflare_api_key', ''))
        public_base = str(config.get('cloudflare_public_base', '')).rstrip('/')

        if not api_base or not api_key or not store_slug:
            return jsonify({"success": False, "message": "Cloudflare settings incomplete."}), 400

        # Compose endpoint: expecting a Worker route like /v1/stores/{slug}/menu
        url = f"{api_base}/v1/stores/{store_slug}/menu"
        payload = {
            "store": store_slug,
            "version": int(time.time()),
            "menu": menu_data
        }
        headers = {
            'Authorization': f"Bearer {api_key}",
            'Content-Type': 'application/json'
        }
        resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=15)
        ok = (200 <= resp.status_code < 300)
        if not ok:
            try:
                err = resp.json()
            except Exception:
                err = {"status": resp.status_code, "text": resp.text[:500]}
            return jsonify({"success": False, "message": "Cloudflare publish failed", "details": err}), 502

        # Lock slug after first successful publish
        if not bool(config.get('cloudflare_store_slug_locked', False)):
            save_config({"cloudflare_store_slug_locked": True})

        # Persist marker to ProgramData to survive app folder deletion
        try:
            os.makedirs(PERSIST_DIR, exist_ok=True)
            with open(PUBLISH_MARKER_FILE, 'w', encoding='utf-8') as f:
                json.dump({
                    "slug": store_slug,
                    "public_url": f"{public_base}/s/{store_slug}",
                    "first_published_at": datetime.now().isoformat()
                }, f, indent=2)
        except Exception as e:
            app.logger.warning(f"Failed to write publish marker: {e}")

        target_url = f"{public_base}/s/{store_slug}" if public_base else None
        return jsonify({"success": True, "url": target_url})
    except Exception as e:
        app.logger.error(f"Publish to Cloudflare error: {type(e).__name__}: {e}")
        return jsonify({"success": False, "message": str(e)}), 500
    
def store_trial_in_registry(first_run_date, signature):
    """Store trial data in Windows Registry"""
    try:
        import winreg
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, r"Software\POSPal\Trial")
        winreg.SetValueEx(key, "FirstRunDate", 0, winreg.REG_SZ, first_run_date)
        winreg.SetValueEx(key, "Signature", 0, winreg.REG_SZ, signature)
        winreg.CloseKey(key)
        return True
    except Exception as e:
        app.logger.warning(f"Could not store trial in registry: {e}")
        return False

def get_trial_from_registry():
    """Get trial data from Windows Registry"""
    try:
        import winreg
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\POSPal\Trial")
        first_run_date = winreg.QueryValueEx(key, "FirstRunDate")[0]
        signature = winreg.QueryValueEx(key, "Signature")[0]
        winreg.CloseKey(key)
        return {"first_run_date": first_run_date, "signature": signature}
    except:
        return None

def store_trial_in_programdata(first_run_date: str, signature: str) -> bool:
    """Store trial data under ProgramData for additional persistence."""
    try:
        os.makedirs(PROGRAM_DATA_DIR, exist_ok=True)
        temp_path = PROGRAM_TRIAL_FILE + '.tmp'
        with open(temp_path, 'w') as f:
            json.dump({"first_run_date": first_run_date, "signature": signature}, f)
        os.replace(temp_path, PROGRAM_TRIAL_FILE)
        return True
    except Exception as e:
        app.logger.warning(f"Could not store trial in ProgramData: {e}")
        return False

def get_trial_from_programdata():
    """Get trial data from ProgramData if present."""
    try:
        if os.path.exists(PROGRAM_TRIAL_FILE):
            with open(PROGRAM_TRIAL_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        app.logger.warning(f"Could not read ProgramData trial file: {e}")
    return None

def _validate_and_parse_trial(trial_dict):
    """Validate signature and parse date. Returns dict with 'first_run_date','signature','date_obj' or None."""
    try:
        if not trial_dict:
            return None
        first_run_date = trial_dict.get('first_run_date')
        signature = trial_dict.get('signature')
        if not first_run_date or not signature:
            return None
        expected = hashlib.sha256(f"{first_run_date}{APP_SECRET_KEY}".encode()).hexdigest()
        if signature != expected:
            return None
        date_obj = datetime.strptime(first_run_date, "%Y-%m-%d")
        return {"first_run_date": first_run_date, "signature": signature, "date_obj": date_obj}
    except Exception:
        return None

def _persist_trial_everywhere(earliest_first_run_date: str, signature: str):
    """Write the given trial to file, registry, and ProgramData, but never move dates forward."""
    # Primary file
    try:
        current_file = None
        if os.path.exists(TRIAL_INFO_FILE):
            try:
                with open(TRIAL_INFO_FILE, 'r') as f:
                    current_file = json.load(f)
            except Exception:
                current_file = None
        current_file_valid = _validate_and_parse_trial(current_file)
        should_write_file = (not current_file_valid) or (current_file_valid and current_file_valid['date_obj'] > datetime.strptime(earliest_first_run_date, "%Y-%m-%d"))
        if should_write_file:
            with open(TRIAL_INFO_FILE, 'w') as f:
                json.dump({"first_run_date": earliest_first_run_date, "signature": signature}, f)
    except Exception as e:
        app.logger.warning(f"Failed persisting trial to primary file: {e}")

    # Registry
    try:
        reg = _validate_and_parse_trial(get_trial_from_registry())
        if (not reg) or (reg['date_obj'] > datetime.strptime(earliest_first_run_date, "%Y-%m-%d")):
            store_trial_in_registry(earliest_first_run_date, signature)
    except Exception as e:
        app.logger.warning(f"Failed persisting trial to registry: {e}")

    # ProgramData file
    try:
        prog = _validate_and_parse_trial(get_trial_from_programdata())
        if (not prog) or (prog['date_obj'] > datetime.strptime(earliest_first_run_date, "%Y-%m-%d")):
            store_trial_in_programdata(earliest_first_run_date, signature)
    except Exception as e:
        app.logger.warning(f"Failed persisting trial to ProgramData: {e}")

def initialize_trial():
    """Initialize trial without allowing resets via reinstall.

    Strategy:
    - Gather valid trial records from file, registry, and ProgramData.
    - Use the earliest valid first_run_date found.
    - If none exist, create a new record with today.
    - Persist the chosen record everywhere, but never move dates forward.
    """
    try:
        candidates = []
        # Primary file
        try:
            if os.path.exists(TRIAL_INFO_FILE):
                with open(TRIAL_INFO_FILE, 'r') as f:
                    candidates.append(_validate_and_parse_trial(json.load(f)))
        except Exception:
            candidates.append(None)

        # Registry
        candidates.append(_validate_and_parse_trial(get_trial_from_registry()))

        # ProgramData
        candidates.append(_validate_and_parse_trial(get_trial_from_programdata()))

        valid_candidates = [c for c in candidates if c]

        if valid_candidates:
            earliest = min(valid_candidates, key=lambda c: c['date_obj'])
            first_run_date = earliest['first_run_date']
            signature = earliest['signature']
        else:
            first_run_date = datetime.now().strftime("%Y-%m-%d")
            signature = hashlib.sha256(f"{first_run_date}{APP_SECRET_KEY}".encode()).hexdigest()

        _persist_trial_everywhere(first_run_date, signature)
        app.logger.info("Trial initialized/synchronized across stores (no forward reset).")
    except Exception as e:
        app.logger.error(f"Error during trial initialization/sync: {e}")

def word_wrap_text(text, max_width, initial_indent="", subsequent_indent=""):
    lines = []
    if not text: return lines
    
    paragraphs = text.split('\n')
    
    for i, paragraph_text in enumerate(paragraphs):
        if not paragraph_text.strip() and i < len(paragraphs) -1 : 
            lines.append(initial_indent if not lines else subsequent_indent) 
            continue

        current_line = []
        current_length = 0
        words = paragraph_text.split(' ')
        
        current_indent = initial_indent if not lines and not any(lines) else subsequent_indent
        
        for word_idx, word in enumerate(words):
            if not word: 
                if current_line: current_line.append("") 
                continue

            available_width_for_word = max_width - len(current_indent) - current_length - (1 if current_line else 0)
            if len(word) > available_width_for_word and not current_line : 
                part_fits = word[:available_width_for_word]
                remaining_part = word[available_width_for_word:]
                lines.append(current_indent + part_fits)
                
                while remaining_part:
                    available_width_for_remaining = max_width - len(subsequent_indent)
                    part_fits = remaining_part[:available_width_for_remaining]
                    remaining_part = remaining_part[available_width_for_remaining:]
                    lines.append(subsequent_indent + part_fits)
                current_line = []
                current_length = 0
                current_indent = subsequent_indent 
                continue

            if current_length + len(word) + (1 if current_line else 0) <= (max_width - len(current_indent)):
                current_line.append(word)
                current_length += len(word) + (1 if len(current_line) > 1 else 0) 
            else:
                if current_line: 
                    lines.append(current_indent + " ".join(current_line))
                
                current_line = [word]
                current_length = len(word)
                current_indent = subsequent_indent 
        
        if current_line: 
            lines.append(current_indent + " ".join(current_line))
            
    return lines if lines else [initial_indent]


def get_next_daily_order_number():
    lock_acquired = False
    for _ in range(10): 
        try:
            # Attempt to create and exclusively open the lock file
            fd = os.open(ORDER_COUNTER_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_RDWR)
            os.close(fd) # Close the file handle immediately, we just needed to create the file
            lock_acquired = True
            break
        except FileExistsError:
            time.sleep(0.1) 
        except Exception as e_lock_create:
            app.logger.error(f"Error creating lock file: {e_lock_create}")
            time.sleep(0.1)

    if not lock_acquired:
        app.logger.critical(f"CRITICAL LOCK FAILURE: {datetime.now()} - Could not acquire lock for order counter.")
        raise Exception("System busy. Could not acquire lock for order counter. Please try again shortly.")

    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        today_str = datetime.now().strftime("%Y-%m-%d")
        current_counter_val = 0

        if os.path.exists(ORDER_COUNTER_FILE):
            try:
                with open(ORDER_COUNTER_FILE, 'r') as f:
                    data_from_file = json.load(f)
                    if data_from_file.get('date') == today_str:
                        current_counter_val = data_from_file.get('counter', 0)
            except (json.JSONDecodeError, FileNotFoundError, IsADirectoryError) as e:
                app.logger.warning(f"Warning: Error reading or parsing {ORDER_COUNTER_FILE} ({e}). Resetting counter for the day.")
                current_counter_val = 0 
            except Exception as e: 
                 app.logger.error(f"Unexpected error reading {ORDER_COUNTER_FILE}: {e}. Resetting counter for the day.")
                 current_counter_val = 0

        next_counter_val = current_counter_val + 1
        counter_data_to_save = {"date": today_str, "counter": next_counter_val}
        
        # Atomic write using a temporary file
        temp_counter_file = ORDER_COUNTER_FILE + ".tmp"
        with open(temp_counter_file, 'w') as f:
            json.dump(counter_data_to_save, f)
        os.replace(temp_counter_file, ORDER_COUNTER_FILE) 

        return next_counter_val
    except Exception as e_update:
        app.logger.critical(f"CRITICAL COUNTER UPDATE FAILURE: {datetime.now()} - {e_update}")
        raise Exception(f"Failed to update order counter: {e_update}")
    finally:
        # Release the lock by deleting the lock file
        if lock_acquired and os.path.exists(ORDER_COUNTER_LOCK_FILE):
            try:
                os.remove(ORDER_COUNTER_LOCK_FILE)
            except Exception as e_rem:
                app.logger.warning(f"WARNING: Failed to remove lock file {ORDER_COUNTER_LOCK_FILE}: {e_rem}")


@app.route('/api/config')
def get_frontend_config():
    """Provide configuration data to frontend (non-sensitive only)"""
    try:
        return jsonify({
            'stripe': {
                'publishable_key': Config.STRIPE_PUBLISHABLE_KEY
            },
            'app': {
                'base_url': Config.APP_BASE_URL,
                'version': CURRENT_VERSION
            },
            'features': {
                'test_mode': Config.ENABLE_TEST_MODE,
                'new_checkout': Config.ENABLE_NEW_CHECKOUT,
                'subscription_management': Config.ENABLE_SUBSCRIPTION_MANAGEMENT,
                'refund_processing': Config.ENABLE_REFUND_PROCESSING,
                'email_notifications': Config.ENABLE_EMAIL_NOTIFICATIONS
            }
        })
    except Exception as e:
        app.logger.error(f"Config endpoint error: {e}")
        return jsonify({'error': 'Configuration not available'}), 500


@app.route('/')
def serve_index():
    return send_from_directory('.', 'UISelect.html')

@app.route('/POSPal.html')
def serve_pospal():
    return send_from_directory('.', 'POSPal.html')

@app.route('/POSPalDesktop.html')
def serve_pospal_desktop():
    return send_from_directory('.', 'POSPalDesktop.html')


@app.route('/customer-portal.html')
def serve_customer_portal():
    return send_from_directory('.', 'customer-portal.html')


@app.route('/success.html')
def serve_success():
    return send_from_directory('.', 'success.html')

@app.route('/payment-failed.html')
def serve_payment_failed():
    return send_from_directory('.', 'payment-failed.html')

@app.route('/account.html')
def serve_account():
    return send_from_directory('.', 'account.html')

@app.route('/pospalCore.js')
def serve_pospal_core():
    return send_from_directory('.', 'pospalCore.js')

# Serve i18n helper and locales
@app.route('/i18n.js')
def serve_i18n_js():
    return send_from_directory('.', 'i18n.js')

@app.route('/locales/<path:filename>')
def serve_locales(filename):
    return send_from_directory('locales', filename)

@app.route('/api/events')
def sse_stream():
    def gen():
        q: Queue = Queue(maxsize=10)
        _sse_subscribers.append(q)
        try:
            # Send initial state
            init = json.dumps({"language": str(config.get('language', 'en'))})
            yield f"event: settings\n"
            yield f"data: {init}\n\n"
            while True:
                try:
                    event_name, data = q.get(timeout=30)
                    yield f"event: {event_name}\n"
                    yield f"data: {data}\n\n"
                except Empty:
                    # keep-alive
                    yield ": keep-alive\n\n"
        finally:
            try:
                _sse_subscribers.remove(q)
            except ValueError:
                pass
    from flask import Response
    headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    }
    return Response(gen(), headers=headers)

@app.route('/test_centralized.html')
def serve_test_centralized():
    return send_from_directory('.', 'test_centralized.html')

# --- Health check & network info ---
@app.route('/health')
def health():
    return jsonify({"status": "ok"})


def _get_best_lan_ip() -> str:
    """Attempt to determine the primary LAN IPv4 address with improved detection."""
    # Method 1: Try connecting to external address (most reliable)
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            # Doesn't need to be reachable; no packets are sent
            s.connect(('8.8.8.8', 80))
            ip = s.getsockname()[0]
            # Validate it's not localhost
            if ip != '127.0.0.1':
                return ip
    except Exception:
        pass
    
    # Method 2: Try multiple external IPs
    external_ips = ['1.1.1.1', '8.8.4.4', '208.67.222.222']
    for ext_ip in external_ips:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect((ext_ip, 80))
                ip = s.getsockname()[0]
                if ip != '127.0.0.1':
                    return ip
        except Exception:
            continue
    
    # Method 3: Get all interfaces and find best LAN IP
    try:
        hostname = socket.gethostname()
        ip_candidates = []
        
        # Get all addresses for hostname
        infos = socket.getaddrinfo(hostname, None, family=socket.AF_INET)
        for info in infos:
            ip = info[4][0]
            if ip and ip != '127.0.0.1':
                ip_candidates.append(ip)
        
        # Prefer private network ranges
        private_ranges = [
            ('192.168.', 1),    # Most common home/office
            ('10.', 2),         # Corporate networks
            ('172.', 3)         # Less common but valid
        ]
        
        for prefix, priority in private_ranges:
            for ip in ip_candidates:
                if ip.startswith(prefix):
                    return ip
        
        # If no private IPs, return the first non-localhost
        if ip_candidates:
            return ip_candidates[0]
            
    except Exception:
        pass
    
    # Method 4: Final fallback - gethostbyname
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip != '127.0.0.1':
            return ip
    except Exception:
        pass
    
    return '127.0.0.1'


def _get_all_ipv4_addresses(best_ip: str) -> list:
    results = set()
    if best_ip:
        results.add(best_ip)
    try:
        infos = socket.getaddrinfo(socket.gethostname(), None, family=socket.AF_INET)
        for info in infos:
            ip = info[4][0]
            if ip:
                results.add(ip)
    except Exception:
        pass
    # Include localhost for completeness
    results.add('127.0.0.1')
    return sorted(results)


@app.route('/api/network_info')
def network_info():
    try:
        port = int(config.get('port', 5000))
        lan_ip = _get_best_lan_ip()
        ips = _get_all_ipv4_addresses(lan_ip)
        
        # Check if firewall rule exists
        firewall_status = "unknown"
        if os.name == 'nt':
            try:
                rule_name = f"POSPal {port}"
                check_cmd = ['netsh', 'advfirewall', 'firewall', 'show', 'rule', f'name={rule_name}']
                result = subprocess.run(check_cmd, capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.returncode == 0 and rule_name in result.stdout:
                    firewall_status = "rule_exists"
                else:
                    firewall_status = "no_rule"
            except Exception:
                firewall_status = "check_failed"
        else:
            firewall_status = "not_windows"
        
        return jsonify({
            "port": port,
            "lan_ip": lan_ip,
            "ips": ips,
            "firewall_status": firewall_status,
            "server_binding": "0.0.0.0",  # Confirm we're binding to all interfaces
            "connectivity_tips": {
                "same_network": f"Users should connect to: http://{lan_ip}:{port}",
                "firewall_needed": firewall_status == "no_rule",
                "admin_required": firewall_status == "no_rule"
            }
        })
    except Exception as e:
        app.logger.error(f"Error building network info: {str(e)}")
        return jsonify({
            "port": int(config.get('port', 5000)),
            "lan_ip": '127.0.0.1',
            "ips": ['127.0.0.1'],
            "firewall_status": "error",
            "error": str(e)
        }), 200


@app.route('/api/windows_firewall/open_port', methods=['POST'])
def open_windows_firewall_port():
    """Attempt to open the configured port in Windows Defender Firewall.

    Security:
    - Only accepts requests from localhost.
    - Only allows adding an allow rule for the app's configured TCP port.
    """
    try:
        # Allow only local machine to trigger this
        client_ip = get_remote_address()
        if client_ip not in ('127.0.0.1', '::1'):
            return jsonify({"success": False, "message": "Forbidden"}), 403

        if os.name != 'nt':
            return jsonify({"success": False, "message": "Windows-only operation"}), 400

        body = request.get_json(silent=True) or {}
        port = int(body.get('port', config.get('port', 5000)))
        rule_name = f"POSPal {port}"

        cmd = [
            'netsh', 'advfirewall', 'firewall', 'add', 'rule',
            f'name={rule_name}', 'dir=in', 'action=allow', 'protocol=TCP', f'localport={port}'
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        except Exception as e:
            return jsonify({"success": False, "message": f"Failed to start command: {str(e)}"}), 200

        stdout = (result.stdout or '').strip()
        stderr = (result.stderr or '').strip()
        if result.returncode == 0:
            return jsonify({"success": True, "message": stdout or "Firewall rule added."})

        # Common failure: requires elevation
        msg = stderr or stdout or "Command failed. Administrator privileges may be required."
        if 'requires elevation' in msg.lower() or 'access is denied' in msg.lower():
            return jsonify({
                "success": False,
                "message": "Access denied. Please run POSPal as Administrator or copy and run the command in an elevated prompt.",
                "details": msg
            })
        return jsonify({"success": False, "message": msg})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 200

# --- NEW ENDPOINT for Login ---
@app.route('/api/login', methods=['POST'])
@limiter.limit("10 per minute") # Rate limit login attempts
def login():
    data = request.get_json()
    password_attempt = data.get('password')
    
    if not password_attempt:
        return jsonify({"success": False, "message": "Password is required."}), 400

    if str(password_attempt) == MANAGEMENT_PASSWORD:
        app.logger.info("Successful management login.")
        return jsonify({"success": True})
    else:
        app.logger.warning(f"Failed management login attempt from {get_remote_address()}.")
        return jsonify({"success": False, "message": "Invalid password."}), 401


@app.route('/api/printers', methods=['GET'])
def get_printers():
    return jsonify({"printers": list_installed_printers(), "selected": PRINTER_NAME})


@app.route('/api/printer/status', methods=['GET'])
def printer_status():
    name = request.args.get('name', PRINTER_NAME)
    try:
        h = win32print.OpenPrinter(name)
        try:
            info = win32print.GetPrinter(h, 2)
        finally:
            win32print.ClosePrinter(h)
        status_code = info.get('Status', 0)
        return jsonify({"name": name, "status_code": status_code})
    except Exception as e:
        return jsonify({"name": name, "error": str(e)}), 200


@app.route('/api/printer/select', methods=['POST'])
def select_printer():
    data = request.get_json() or {}
    name = data.get('printer_name')
    if not name:
        return jsonify({"success": False, "message": "printer_name is required"}), 400
    if save_config({"printer_name": name}):
        return jsonify({"success": True, "printer_name": PRINTER_NAME})
    return jsonify({"success": False, "message": "Failed to save."}), 500


@app.route('/api/printer/test', methods=['POST'])
def test_print():
    try:
        # Provide clearer error messages for common failures
        trial = check_trial_status()
        if not trial.get('active', False):
            return jsonify({
                "success": False,
                "message": "Trial expired or inactive. Printing disabled."
            }), 200

        test_order = {
            'number': 'TEST',
            'tableNumber': 'N/A',
            'items': [
                {"name": "POSPal Test", "quantity": 1, "itemPriceWithModifiers": 0.00}
            ],
            'universalComment': ''
        }
        # Reset fallback flag and attempt
        global last_print_used_fallback
        last_print_used_fallback = False
        ok = print_kitchen_ticket(test_order, copy_info="")
        if ok:
            return jsonify({"success": True})
        # If failed and looks like a PDF-type printer, clarify unsupported
        name_lower = str(PRINTER_NAME).lower()
        if 'pdf' in name_lower:
            return jsonify({"success": False, "message": "Selected printer is a PDF device and is not supported for ticket printing."}), 200
        return jsonify({"success": False, "message": "Test print failed. See server log for details."}), 200
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 200



@app.route('/api/settings/printing', methods=['GET', 'POST'])
def printing_settings():
    if request.method == 'GET':
        return jsonify({
            "printer_name": PRINTER_NAME,
            "cut_after_print": CUT_AFTER_PRINT,
            "copies_per_order": COPIES_PER_ORDER
        })
    data = request.get_json() or {}
    values = {}
    for key in ["printer_name", "cut_after_print", "copies_per_order"]:
        if key in data:
            values[key] = data[key]
    if not values:
        return jsonify({"success": False, "message": "No settings provided."}), 400
    if save_config(values):
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to save settings."}), 500


# --- General (non-printing) settings: UI language, etc. ---
@app.route('/api/settings/general', methods=['GET', 'POST'])
def general_settings():
    if request.method == 'GET':
        # Only expose non-sensitive general settings
        return jsonify({
            "language": str(config.get('language', 'en')),
            "port": int(config.get('port', 5000))
        })
    # POST
    data = request.get_json(silent=True) or {}
    payload = {}
    if 'language' in data:
        lang = str(data.get('language', 'en')).lower()
        if lang not in ('en', 'el'):
            return jsonify({"success": False, "message": "Unsupported language."}), 400
        payload['language'] = lang
    if 'port' in data:
        try:
            port = int(data['port'])
            if port < 1024 or port > 65535:
                return jsonify({"success": False, "message": "Port must be between 1024-65535."}), 400
            payload['port'] = port
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid port number."}), 400
    if not payload:
        return jsonify({"success": False, "message": "No valid settings provided."}), 400
    if save_config(payload):
        # Broadcast to all connected clients that settings changed
        try:
            _sse_broadcast('settings', {"language": str(config.get('language', 'en'))})
        except Exception:
            pass
        return jsonify({"success": True})
    return jsonify({"success": False, "message": "Failed to save settings."}), 500


@app.route('/api/settings/network', methods=['GET', 'POST'])
def network_settings():
    if request.method == 'GET':
        return jsonify({
            "port": int(config.get('port', 5000)),
            "enable_multi_port": bool(config.get('enable_multi_port', False)),
            "fallback_ports": config.get('fallback_ports', [8080, 3000, 8000, 9000]),
            "is_admin": _is_running_as_admin(),
            "predefined_port_sets": [
                {"name": "Default", "ports": [8080, 3000, 8000, 9000]},
                {"name": "High Ports", "ports": [8080, 8888, 9090, 9999]},
                {"name": "Alternative", "ports": [3000, 4000, 5001, 6000]},
                {"name": "Corporate Friendly", "ports": [8080, 8443, 9080, 9443]}
            ]
        })
    
    # POST - Update network settings
    data = request.get_json() or {}
    updates = {}
    
    if 'enable_multi_port' in data:
        # Check admin privileges for multi-port mode
        if data['enable_multi_port'] and not _is_running_as_admin():
            return jsonify({
                "success": False, 
                "message": "Administrator privileges required for multi-port mode. Please restart POSPal as Administrator."
            }), 403
        
        updates['enable_multi_port'] = bool(data['enable_multi_port'])
    
    if 'fallback_ports' in data:
        # Validate fallback ports
        try:
            ports = data['fallback_ports']
            if isinstance(ports, list):
                # Convert to integers and filter valid port range
                valid_ports = [int(p) for p in ports if 1024 <= int(p) <= 65535]
                updates['fallback_ports'] = valid_ports[:10]  # Limit to 10 ports max
            else:
                return jsonify({"success": False, "message": "fallback_ports must be a list"}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid port numbers"}), 400
    
    if not updates:
        return jsonify({"success": False, "message": "No valid settings provided"}), 400
    
    if save_config(updates):
        # If multi-port was enabled, try to configure firewall rules
        if updates.get('enable_multi_port', False):
            try:
                primary_port = int(config.get('port', 5000))
                fallback_ports = config.get('fallback_ports', [8080, 3000, 8000, 9000])
                all_ports = [primary_port] + [p for p in fallback_ports if p != primary_port]
                success, msg = _setup_windows_firewall_rules_for_ports(all_ports)
                return jsonify({
                    "success": True, 
                    "firewall_setup": success,
                    "firewall_message": msg
                })
            except Exception as e:
                app.logger.warning(f"Network settings saved but firewall setup failed: {e}")
                return jsonify({
                    "success": True,
                    "firewall_setup": False,
                    "firewall_message": f"Settings saved but firewall setup failed: {e}"
                })
        
        return jsonify({"success": True})
    
    return jsonify({"success": False, "message": "Failed to save network settings"}), 500


@app.route('/api/settings/password', methods=['POST'])
def change_password():
    data = request.get_json() or {}
    current_pw = str(data.get('current_password', ''))
    new_pw = str(data.get('new_password', ''))
    if current_pw != MANAGEMENT_PASSWORD:
        return jsonify({"success": False, "message": "Current password is incorrect."}), 200
    if new_pw is None or new_pw == "":
        return jsonify({"success": False, "message": "New password cannot be empty."}), 200
    if save_config({"management_password": new_pw}):
        return jsonify({"success": True, "message": "Password updated."})
    return jsonify({"success": False, "message": "Failed to update password."}), 500


## PDF folder opening removed with PDF fallback deprecation
# --- NEW ENDPOINT to get app version ---
@app.route('/api/version')
def get_version():
    return jsonify({"version": CURRENT_VERSION})


# --- Global shutdown flag for graceful termination ---
_shutdown_requested = False
_server_instance = None  # Store reference to Waitress server for graceful shutdown

# --- NEW ENDPOINT FOR SHUTDOWN ---
def shutdown_server():
    global _shutdown_requested, _api_session, _lock_file_fd, _instance_mutex_handle, _server_instance
    
    # Prevent multiple shutdown calls
    if _shutdown_requested:
        app.logger.info("Shutdown already in progress, ignoring duplicate request")
        return
        
    app.logger.info("Shutdown command received. Starting comprehensive cleanup...")
    _shutdown_requested = True
    
    try:
        # Step 1: Clean up SSE subscribers with timeout
        app.logger.info("Cleaning up SSE subscribers...")
        try:
            # Notify all SSE clients that server is shutting down
            for q in list(_sse_subscribers):
                try:
                    q.put(('shutdown', '{"message": "Server shutting down"}'))
                except:
                    pass
            # Clear subscriber list
            _sse_subscribers.clear()
            app.logger.info("SSE subscribers cleaned up successfully")
        except Exception as e:
            app.logger.error(f"Error cleaning SSE subscribers: {e}")
        
        # Step 2: Clean up HTTP session
        app.logger.info("Cleaning up HTTP session...")
        try:
            if _api_session:
                _api_session.close()
                _api_session = None
                app.logger.info("HTTP session closed successfully")
        except Exception as e:
            app.logger.error(f"Error closing HTTP session: {e}")
        
        # Step 3: Release single instance locks and file handles
        app.logger.info("Releasing single instance locks...")
        try:
            release_single_instance_lock()
            app.logger.info("Single instance locks released successfully")
        except Exception as e:
            app.logger.error(f"Error releasing single instance locks: {e}")
        
        # Step 4: Clean up any remaining lock files
        app.logger.info("Cleaning up remaining lock files...")
        lock_files_to_clean = [ORDER_COUNTER_LOCK_FILE, APP_INSTANCE_LOCK_FILE]
        for lock_file in lock_files_to_clean:
            try:
                if os.path.exists(lock_file):
                    os.remove(lock_file)
                    app.logger.info(f"Removed lock file: {lock_file}")
            except Exception as e:
                app.logger.warning(f"Could not remove lock file {lock_file}: {e}")
        
        # Step 5: Cancel/stop all active timers and background threads
        app.logger.info("Stopping background threads and timers...")
        try:
            # Kill all non-daemon threads
            import threading
            current_thread = threading.current_thread()
            for thread in threading.enumerate():
                if thread != current_thread and thread.is_alive() and not thread.daemon:
                    try:
                        app.logger.info(f"Found active non-daemon thread: {thread.name}")
                        # For most threads we can only log them, but some specific ones we can interrupt
                    except Exception as e:
                        app.logger.warning(f"Error checking thread {thread}: {e}")
            app.logger.info("Background thread cleanup completed")
        except Exception as e:
            app.logger.error(f"Error during background thread cleanup: {e}")
        
        # Step 6: Give time for cleanup to complete
        app.logger.info("Waiting for cleanup to complete...")
        time.sleep(1.0)
        
        # Step 7: Attempt graceful shutdown using multiple methods
        app.logger.info("Initiating process termination...")
        
        # For Windows, try multiple termination methods for reliability
        if os.name == 'nt':  # Windows
            try:
                # Method 1: Use taskkill to forcefully terminate the process tree
                # This ensures all child processes are also terminated
                app.logger.info("Using taskkill to terminate process tree...")
                result = subprocess.run(['taskkill', '/F', '/T', '/PID', str(os.getpid())], 
                                      capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
                app.logger.info(f"Taskkill result: {result.returncode}")
                if result.returncode == 0:
                    return  # Successful termination
            except subprocess.TimeoutExpired:
                app.logger.warning("Taskkill timeout, proceeding with alternative methods")
            except Exception as e:
                app.logger.error(f"Taskkill failed: {e}")
        
        # Method 2: Try SIGTERM for graceful shutdown
        try:
            import signal
            app.logger.info("Sending SIGTERM to process...")
            os.kill(os.getpid(), signal.SIGTERM)
            time.sleep(2)  # Give time for SIGTERM to work
        except Exception as e:
            app.logger.error(f"SIGTERM failed: {e}")
        
        # Method 3: Try SIGKILL for forceful shutdown (Unix-like systems)
        if os.name != 'nt':
            try:
                import signal
                app.logger.info("Sending SIGKILL to process...")
                os.kill(os.getpid(), signal.SIGKILL)
            except Exception as e:
                app.logger.error(f"SIGKILL failed: {e}")
        
        # Method 4: Force exit as last resort
        app.logger.info("Using os._exit() as final termination method")
        os._exit(0)  # Use exit code 0 for normal shutdown
            
    except Exception as e:
        app.logger.error(f"Critical error during shutdown: {e}")
        # Force exit even if cleanup fails
        try:
            app.logger.error("Emergency shutdown using os._exit()")
            os._exit(1)
        except:
            # If even os._exit fails, try the nuclear option
            import sys
            sys.exit(1)

# Setup signal handlers now that shutdown_server is defined
setup_signal_handlers()

@app.route('/api/shutdown', methods=['POST'])
def shutdown():
    try:
        app.logger.info("Shutdown request received from client")
        app.logger.info("Returning success response to client before initiating shutdown...")
        
        # Return response first
        response = jsonify({"status": "success", "message": "Server is shutting down."})
        
        # Schedule shutdown for 2 seconds from now to allow response to be sent
        # Increased delay to ensure the response reaches the client
        shutdown_timer = threading.Timer(2.0, shutdown_server)
        shutdown_timer.daemon = True  # Make it a daemon thread
        shutdown_timer.start()
        app.logger.info("Shutdown timer started, server will terminate in 2 seconds")
        
        return response, 200
    except Exception as e:
        app.logger.error(f"Error initiating shutdown: {e}")
        return jsonify({"status": "error", "message": "Failed to initiate shutdown."}), 500


# --- NEW ENDPOINT to get the next order number ---
@app.route('/api/order_status', methods=['GET'])
def get_order_status():
    try:
        today_str = datetime.now().strftime("%Y-%m-%d")
        current_counter_val = 0
        if os.path.exists(ORDER_COUNTER_FILE):
            try:
                with open(ORDER_COUNTER_FILE, 'r') as f:
                    data = json.load(f)
                    if data.get('date') == today_str:
                        current_counter_val = data.get('counter', 0)
            except (json.JSONDecodeError, FileNotFoundError):
                # File is corrupt or gone, will reset to 0
                pass
        
        return jsonify({"next_order_number": current_counter_val + 1})
    except Exception as e:
        app.logger.error(f"Error getting order status: {str(e)}")
        return jsonify({"status": "error", "message": "Could not retrieve order status"}), 500


@app.route('/api/menu', methods=['GET'])
def get_menu():
    global MENU_FILE
    try:
        # Enhanced logging for debugging path issues
        app.logger.info(f"Menu request received. Checking file: {MENU_FILE}")
        app.logger.info(f"Current working directory: {os.getcwd()}")
        app.logger.info(f"BASE_DIR: {BASE_DIR}")
        app.logger.info(f"DATA_DIR: {DATA_DIR}")
        app.logger.info(f"File exists check: {os.path.exists(MENU_FILE)}")
        
        if not os.path.exists(MENU_FILE):
            app.logger.warning(f"Menu file {MENU_FILE} not found during GET request.")
            # Try to find the file in installation directory (C:\POSPal\data\menu.json)
            alt_paths = [
                r'C:\POSPal\data\menu.json',  # Customer's installation path
                os.path.join(os.getcwd(), 'data', 'menu.json'),
                os.path.join(os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else __file__), 'data', 'menu.json'),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'menu.json')
            ]
            for alt_path in alt_paths:
                if os.path.exists(alt_path):
                    app.logger.info(f"Found menu.json in alternative location: {alt_path}")
                    try:
                        with open(alt_path, 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            app.logger.info(f"Successfully loaded menu from alternative path with {len(data)} categories")
                            # Update the global MENU_FILE path for future use
                            MENU_FILE = alt_path
                            return jsonify(data)
                    except Exception as e:
                        app.logger.warning(f"Failed to load from alternative path {alt_path}: {e}")
            
            app.logger.error("Could not find menu.json in any expected location")
            return jsonify({"error": "Menu file not found", "message": "Please ensure menu.json exists in the data directory"}), 404 
        
        with open(MENU_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            
            # Auto-fix menu structure inconsistencies
            fixed_items = 0
            for category, items in data.items():
                if isinstance(items, list):
                    for item in items:
                        if 'hasGeneralOptions' not in item:
                            # Determine hasGeneralOptions based on options property
                            if 'options' in item and item['options']:
                                item['hasGeneralOptions'] = True
                                item['generalOptions'] = item['options']
                            else:
                                item['hasGeneralOptions'] = False
                                item['generalOptions'] = []
                            fixed_items += 1
                        
                        # Ensure generalOptions exists even if hasGeneralOptions is false
                        if 'generalOptions' not in item:
                            item['generalOptions'] = item.get('options', [])
                            fixed_items += 1
            
            if fixed_items > 0:
                app.logger.info(f"Auto-fixed {fixed_items} menu structure inconsistencies")
                # Save the corrected menu back to file
                try:
                    with open(MENU_FILE, 'w', encoding='utf-8') as write_f:
                        json.dump(data, write_f, indent=2, ensure_ascii=False)
                    app.logger.info(f"Menu structure corrections saved to {MENU_FILE}")
                except Exception as save_e:
                    app.logger.warning(f"Could not save menu corrections: {save_e}")
            
            app.logger.info(f"Successfully loaded menu from {MENU_FILE} with {len(data)} categories")
            return jsonify(data)
    except FileNotFoundError: 
        app.logger.error(f"Menu file {MENU_FILE} was not found unexpectedly. Returning empty menu.")
        return jsonify({})
    except json.JSONDecodeError as e:
        app.logger.error(f"Error decoding JSON from {MENU_FILE}: {str(e)}")
        return jsonify({"status": "error", "message": f"Menu data is corrupted. Please check the menu file on the server. Details: {str(e)}"}), 500
    except PermissionError as e:
        app.logger.error(f"Permission denied when trying to read {MENU_FILE}: {str(e)}")
        return jsonify({"status": "error", "message": f"Server permission error: Cannot read menu data. Details: {str(e)}"}), 500
    except Exception as e:
        app.logger.error(f"An unexpected error occurred while fetching the menu: {str(e)}")
        return jsonify({"status": "error", "message": f"An unexpected server error occurred while trying to load the menu. Details: {str(e)}"}), 500


@app.route('/api/menu', methods=['POST'])
def save_menu():
    new_menu_data = request.json
    try:
        # Ensure data directory exists
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(os.path.dirname(MENU_FILE), exist_ok=True)
        temp_menu_file = MENU_FILE + ".tmp"
        with open(temp_menu_file, 'w', encoding='utf-8') as f:
            json.dump(new_menu_data, f, indent=2) 
        os.replace(temp_menu_file, MENU_FILE) 
        return jsonify({"status": "success"})
    except PermissionError as e:
        app.logger.error(f"Permission denied saving menu: {str(e)}")
        return jsonify({"status": "error", "message": f"Permission error: {str(e)}"}), 500
    except Exception as e:
        app.logger.error(f"Error saving menu: {type(e).__name__}: {str(e)}")
        return jsonify({"status": "error", "message": f"Failed to save menu: {str(e)}"}), 500


# --- REFACTORED to prevent resource leaks and improve clarity ---
def print_kitchen_ticket(order_data, copy_info="", original_timestamp_str=None):
    """
    Builds and prints a kitchen ticket. This function is refactored to ensure
    all printer resources are properly closed in all scenarios.
    """
    # 1. Pre-flight checks (no resources opened yet)
    global last_print_used_fallback
    last_print_used_fallback = False
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        app.logger.warning("Printing blocked - trial expired")
        return False

    if not PRINTER_NAME or PRINTER_NAME == "Your_Printer_Name_Here":
        app.logger.error(f"CRITICAL: PRINTER_NAME is not configured. Cannot print order #{order_data.get('number', 'N/A')}.")
        return False

    # PDF printers are not supported for ticket printing anymore
    if 'pdf' in str(PRINTER_NAME).lower():
        app.logger.error(f"Selected printer '{PRINTER_NAME}' appears to be a PDF device, which is not supported for ticket printing.")
        return False

    # 2. Build the ticket content (can fail without opening resources)
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter
        
        # Initialize printer with standard settings only
        
        NORMAL_FONT_LINE_WIDTH = 42 
        SMALL_FONT_LINE_WIDTH = 56

        # ... (rest of ticket content generation logic) ...
        ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
        restaurant_name = "POSPal" 
        ticket_content += to_bytes(restaurant_name + "\n")
        ticket_content += BoldOff 
        
        ticket_content += AlignCenter + SelectFontA + NormalText
        
        ticket_content += AlignLeft 
        
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
        order_num_text = f"Order #: {order_data.get('number', 'N/A')}"
        ticket_content += to_bytes(order_num_text + "\n")
        
        table_number = order_data.get('tableNumber')
        if table_number and table_number.upper() != 'N/A':
            table_text = f"Table: {table_number}"
            ticket_content += to_bytes(table_text + "\n")
        ticket_content += BoldOff 
            
        ticket_content += SelectFontA + NormalText
        time_to_display = original_timestamp_str if original_timestamp_str else datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        ticket_content += to_bytes(f"Time: {time_to_display}\n")
        
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        
        grand_total = 0.0
        for item_idx, item in enumerate(order_data.get('items', [])):
            item_quantity = item.get('quantity', 0)
            item_name_orig = item.get('name', 'Unknown Item')
            item_price_unit = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) 
            line_total = item_quantity * item_price_unit
            grand_total += line_total

            left_side = f"{item_quantity}x {item_name_orig}"
            right_side = f"{line_total:.2f}"
            large_text_width = len(left_side) * 2
            normal_text_width = len(right_side)
            
            if large_text_width + normal_text_width < NORMAL_FONT_LINE_WIDTH:
                ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
                ticket_content += to_bytes(left_side)
                ticket_content += NormalText + BoldOff
                padding_size = NORMAL_FONT_LINE_WIDTH - large_text_width - normal_text_width
                padding = " " * padding_size
                ticket_content += to_bytes(padding + right_side + "\n")
            else:
                ticket_content += SelectFontA + DoubleHeightWidth + BoldOn
                DOUBLE_WIDTH_LINE_CHARS = NORMAL_FONT_LINE_WIDTH // 2
                wrapped_name_lines = word_wrap_text(left_side, DOUBLE_WIDTH_LINE_CHARS)
                for line in wrapped_name_lines[:-1]:
                    ticket_content += to_bytes(line + "\n")
                last_line = wrapped_name_lines[-1]
                last_line_width = len(last_line) * 2
                available_space = NORMAL_FONT_LINE_WIDTH - last_line_width
                padding = " " * max(0, available_space - normal_text_width)
                ticket_content += to_bytes(last_line)
                ticket_content += NormalText + BoldOff + to_bytes(padding + right_side + "\n")
                ticket_content += AlignLeft
            ticket_content += NormalText + BoldOff 

            general_options = item.get('generalSelectedOptions', [])
            if general_options:
                for opt in general_options:
                    opt_name = opt.get('name', 'N/A')
                    opt_price_change = float(opt.get('priceChange', 0.0))
                    price_change_str = f" ({'+' if opt_price_change > 0 else ''}{opt_price_change:.2f})" if opt_price_change != 0 else ""
                    option_line = f"  + {opt_name}{price_change_str}"
                    for opt_line_part in word_wrap_text(option_line, NORMAL_FONT_LINE_WIDTH, initial_indent="  ", subsequent_indent="    "):
                        ticket_content += to_bytes(opt_line_part + "\n")

            item_comment = item.get('comment', '').strip()
            if item_comment:
                ticket_content += BoldOn
                for comment_line in word_wrap_text(f"Note: {item_comment}", NORMAL_FONT_LINE_WIDTH, initial_indent="    ", subsequent_indent="    "):
                     ticket_content += to_bytes(comment_line + "\n")
                ticket_content += BoldOff                  
            
            if item_idx < len(order_data.get('items', [])) - 1:
                ticket_content += to_bytes("." * NORMAL_FONT_LINE_WIDTH + "\n")

        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        ticket_content += SelectFontA + DoubleHeightWidth + BoldOn + AlignRight
        total_string = f"TOTAL: EUR {grand_total:.2f}"
        ticket_content += to_bytes(total_string + "\n")
        ticket_content += BoldOff + AlignLeft
        # Payment method directly under total
        try:
            payment_method = str(order_data.get('paymentMethod', 'Cash')).strip().capitalize() or 'Cash'
        except Exception:
            payment_method = 'Cash'
        # Emphasize payment method only (no label): double width and bold
        ticket_content += SelectFontA + DoubleWidth
        ticket_content += BoldOn + to_bytes(payment_method.upper()) + BoldOff + to_bytes("\n")
        ticket_content += NormalText
        
        ticket_content += SelectFontA + NormalText
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n") 
        
        universal_comment = order_data.get('universalComment', '').strip()
        if universal_comment:
            ticket_content += SelectFontA + NormalText + BoldOn 
            ticket_content += to_bytes("ORDER NOTES:\n") + BoldOff 
            ticket_content += SelectFontA + NormalText 
            for line in word_wrap_text(universal_comment, NORMAL_FONT_LINE_WIDTH, initial_indent="", subsequent_indent=""):
                ticket_content += to_bytes(line + "\n")
            ticket_content += to_bytes("\n")
        
        ticket_content += to_bytes("\n")
        ticket_content += AlignCenter + SelectFontB
        disclaimer_text = "This is not a legal receipt of payment and is for informational purposes only."
        for line in word_wrap_text(disclaimer_text, SMALL_FONT_LINE_WIDTH):
            ticket_content += to_bytes(line + "\n")

        ticket_content += SelectFontA + AlignLeft
        ticket_content += to_bytes("\n\n\n\n") 
        if CUT_AFTER_PRINT:
            ticket_content += FullCut

    except Exception as e_build:
        app.logger.error(f"Error building ticket content for order #{order_data.get('number', 'N/A')}: {str(e_build)}")
        return False

    # 3. Handle the printing with a guaranteed resource cleanup
    hprinter = None
    doc_started = False
    try:
        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)

        # Check printer status
        printer_info = win32print.GetPrinter(hprinter, 2)
        current_status = printer_info['Status']
        app.logger.info(f"Printer '{PRINTER_NAME}' current status code: {hex(current_status)}")

        PRINTER_STATUS_OFFLINE = 0x00000080; PRINTER_STATUS_ERROR = 0x00000002
        PRINTER_STATUS_NOT_AVAILABLE = 0x00001000; PRINTER_STATUS_PAPER_OUT = 0x00000010
        PRINTER_STATUS_USER_INTERVENTION = 0x00000200; PRINTER_STATUS_PAPER_JAM = 0x00000008
        PRINTER_STATUS_DOOR_OPEN = 0x00000400; PRINTER_STATUS_NO_TONER = 0x00040000
        PRINTER_STATUS_PAUSED = 0x00000001
        problem_flags_map = {
            PRINTER_STATUS_OFFLINE: "Offline", PRINTER_STATUS_ERROR: "Error",
            PRINTER_STATUS_NOT_AVAILABLE: "Not Available/Disconnected", PRINTER_STATUS_PAPER_OUT: "Paper Out",
            PRINTER_STATUS_USER_INTERVENTION: "User Intervention Required", PRINTER_STATUS_PAPER_JAM: "Paper Jam",
            PRINTER_STATUS_DOOR_OPEN: "Door/Cover Open", PRINTER_STATUS_NO_TONER: "No Toner/Ink",
            PRINTER_STATUS_PAUSED: "Print Queue Paused"
        }
        active_problems = [desc for flag, desc in problem_flags_map.items() if current_status & flag]

        if active_problems:
            problems_string = ", ".join(active_problems)
            app.logger.error(f"Printer '{PRINTER_NAME}' reported problem(s): {problems_string}. Order will not be printed.")
            # Attempt PDF fallback if enabled
            if PDF_FALLBACK_ENABLED:
                if generate_pdf_ticket(order_data, copy_info, original_timestamp_str):
                    app.logger.info("PDF fallback used due to printer status problems.")
                    last_print_used_fallback = True
                    return True
            return False # Finally will close the handle

        app.logger.info(f"Printer '{PRINTER_NAME}' status appears operational. Proceeding with print.")
        
        # Perform the print job
        doc_name = f"Order_{order_data.get('number', 'N/A')}_Ticket{f'_{copy_info}'.replace(' ','_') if copy_info else ''}_ESCPOST"
        win32print.StartDocPrinter(hprinter, 1, (doc_name, None, "RAW"))
        doc_started = True
        
        win32print.StartPagePrinter(hprinter)
        win32print.WritePrinter(hprinter, bytes(ticket_content))
        win32print.EndPagePrinter(hprinter)
        
        app.logger.info(f"Order #{order_data.get('number', 'N/A')} data sent to printer spooler for '{PRINTER_NAME}'.")
        return True # Success

    except (win32print.error, Exception) as e:
        order_id_str = f"order #{order_data.get('number', 'N/A')}{f' ({copy_info})' if copy_info else ''}"
        app.logger.error(f"A printing error occurred for {order_id_str} with printer '{PRINTER_NAME}'. Error: {str(e)}")
        # Attempt PDF fallback if enabled
        if PDF_FALLBACK_ENABLED:
            if generate_pdf_ticket(order_data, copy_info, original_timestamp_str):
                app.logger.info("PDF fallback used due to printing exception.")
                last_print_used_fallback = True
                return True
        return False
        
    finally:
        # This block ensures all opened resources are closed, in the correct order.
        if doc_started:
            try:
                win32print.EndDocPrinter(hprinter)
            except Exception as e_doc:
                 app.logger.error(f"Error ending document on printer '{PRINTER_NAME}': {str(e_doc)}")
        if hprinter:
            try:
                win32print.ClosePrinter(hprinter)
            except Exception as e_close: 
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")


def record_order_in_csv(order_data, print_status_message):
    try:
        # Ensure data directory exists
        if not os.path.exists(DATA_DIR):
            os.makedirs(DATA_DIR, exist_ok=True)
        printed_status_for_csv = print_status_message
        os.makedirs(DATA_DIR, exist_ok=True) 
        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.abspath(os.path.join(DATA_DIR, f"orders_{date_str}.csv"))
        fieldnames = ['order_number', 'table_number', 'timestamp', 'items_summary', 
                      'universal_comment', 'order_total', 'payment_method', 'printed_status', 'items_json']

        file_exists = os.path.exists(filename)
        
        with open(filename, 'a', newline='', encoding='utf-8') as f_write:
            writer = csv.DictWriter(f_write, fieldnames=fieldnames)
            if not file_exists:
                writer.writeheader()

            new_order_total = sum(
                float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) * int(item.get('quantity', 0))
                for item in order_data.get('items', [])
            )
            
            items_summary_parts = []
            for item in order_data.get('items', []):
                part = f"{item.get('quantity', 0)}x {item.get('name', 'N/A')}"
                
                general_options = item.get('generalSelectedOptions', [])
                if general_options:
                    opt_details = []
                    for opt in general_options:
                        opt_name = opt.get('name', 'N/A')
                        opt_price_change = float(opt.get('priceChange', 0.0))
                        price_str = ""
                        if opt_price_change != 0:
                            price_str = f" ({'+' if opt_price_change > 0 else ''}EUR {opt_price_change:.2f})"
                        opt_details.append(f"{opt_name}{price_str}")
                    if opt_details:
                        part += f" (Options: {', '.join(opt_details)})"
                
                comment = item.get('comment','').strip()
                if comment:
                    part += f" (Note: {comment})"
                
                unit_price_final = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                part += f" [Unit EUR {unit_price_final:.2f}]"
                items_summary_parts.append(part)

            new_row_data = {
                'order_number': order_data.get('number', 'N/A'),
                'table_number': order_data.get('tableNumber', ''),
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                'items_summary': " | ".join(items_summary_parts), 
                'universal_comment': order_data.get('universalComment', '').strip(),
                'order_total': f"{new_order_total:.2f}",
                'payment_method': order_data.get('paymentMethod', 'Cash'),
                'printed_status': printed_status_for_csv,
                'items_json': json.dumps(order_data.get('items', [])) 
            }
            writer.writerow(new_row_data)
            
        app.logger.info(f"Order #{order_data.get('number', 'N/A')} logged to CSV. Payment: {order_data.get('paymentMethod', 'Cash')}, Printed: {printed_status_for_csv}.")
        return True
    except Exception as e:
        app.logger.error(f"CSV logging error for order #{order_data.get('number', 'N/A')}: {str(e)}")
        return False


## PDF ticket generation removed


def list_installed_printers():
    try:
        flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
        printers = win32print.EnumPrinters(flags)
        names = []
        for p in printers:
            name = p[2] if len(p) > 2 else None
            if name:
                names.append(name)
        return names
    except Exception as e:
        app.logger.error(f"Failed to enumerate printers: {e}")
        return []
@app.route('/api/orders', methods=['POST'])
def handle_order():
    # Check trial status
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        return jsonify({
            "status": "error_trial_expired",
            "message": "Trial period has ended. Printing disabled."
        }), 403
    
    order_data_from_client = request.json
    if not order_data_from_client or 'items' not in order_data_from_client or not order_data_from_client['items']:
        return jsonify({"status": "error_validation", "message": "Invalid order data: Items are required."}), 400

    authoritative_order_number = -1
    try:
        authoritative_order_number = get_next_daily_order_number()
    except Exception as e:
        app.logger.critical(f"Could not generate order number: {str(e)}")
        return jsonify({
            "status": "error_internal_server",
            "message": f"System error: Could not assign order number. {str(e)}"
        }), 500

    order_data_internal = {
        'number': authoritative_order_number,
        'tableNumber': order_data_from_client.get('tableNumber', '').strip() or 'N/A',
        'items': order_data_from_client.get('items', []), 
        'universalComment': order_data_from_client.get('universalComment', ''),
        'paymentMethod': order_data_from_client.get('paymentMethod', 'Cash')
    }

    print_status_summary = "Not Printed"
    printed_all = True
    printed_any = False
    copies_to_print = max(1, int(config.get('copies_per_order', COPIES_PER_ORDER)))
    
    # Calculate dynamic delay based on order complexity
    total_items = sum(int(item.get('quantity', 1)) for item in order_data_internal.get('items', []))
    base_delay_between_copies = 0.5
    item_based_delay = min(total_items * 0.3, 10.0)  # 0.3s per item, max 10s
    dynamic_delay = base_delay_between_copies + item_based_delay
    
    # Calculate retry delay based on order complexity
    base_retry_delay = 1.0
    retry_delay = base_retry_delay + item_based_delay
    
    app.logger.info(f"Order #{authoritative_order_number} has {total_items} items. Using {dynamic_delay:.1f}s delay between copies and {retry_delay:.1f}s retry delay.")

    for i in range(1, copies_to_print + 1):
        if i > 1:
            app.logger.info(f"Waiting {dynamic_delay:.1f}s before printing copy {i} (order complexity: {total_items} items)")
            time.sleep(dynamic_delay)
        app.logger.info(f"Attempting to print copy {i} for order #{authoritative_order_number}")
        try:
            ok = print_kitchen_ticket(order_data_internal, copy_info="")
            if not ok:
                app.logger.warning(f"Print failed, waiting {retry_delay:.1f}s before retry for copy {i} (order #{authoritative_order_number})")
                time.sleep(retry_delay)
                app.logger.warning(f"Retrying print for copy {i} (order #{authoritative_order_number})")
                ok = print_kitchen_ticket(order_data_internal, copy_info="")
        except Exception as e_print:
            app.logger.critical(f"CRITICAL PRINT EXCEPTION for order #{authoritative_order_number} (copy {i}): {str(e_print)}")
            ok = False
        printed_any = printed_any or ok
        if not ok and i == 1:
            app.logger.warning(f"Order #{authoritative_order_number} - FIRST COPY FAILED to print. Order will NOT be saved or further processed.")
            return jsonify({
                "status": "error_print_failed_copy1",
                "order_number": authoritative_order_number,
                "printed": "Copy 1 Failed",
                "logged": False,
                "message": f"Order #{authoritative_order_number} - FIRST COPY FAILED. Order NOT saved. Check printer!"
            }), 200
        if not ok:
            printed_all = False

    if printed_any and printed_all:
        print_status_summary = "All Copies Printed"
        app.logger.info(f"Order #{authoritative_order_number} - All copies printed successfully ({copies_to_print}).")
    elif printed_any and not printed_all:
        print_status_summary = "Some Copies Printed, Some Failed"
        app.logger.warning(f"Order #{authoritative_order_number} - Some copies printed, some failed (requested {copies_to_print}).")
    
    csv_log_succeeded = False
    try:
        csv_log_succeeded = record_order_in_csv(order_data_internal, print_status_summary)
    except Exception as e_csv_call:
        app.logger.critical(f"CRITICAL CSV LOGGING EXCEPTION for order #{authoritative_order_number} (Print status: {print_status_summary}): {str(e_csv_call)}")
        csv_log_succeeded = False

    if not csv_log_succeeded:
        app.logger.error(f"Order #{authoritative_order_number} (Print status: {print_status_summary}) FAILED to log to CSV. This is a critical error.")
        return jsonify({
            "status": "error_log_failed_after_print",
            "order_number": authoritative_order_number,
            "printed": print_status_summary,
            "logged": False,
            "message": f"Order #{authoritative_order_number} - PRINT STATUS: {print_status_summary}. FAILED TO SAVE TO RECORDS. NOTIFY STAFF IMMEDIATELY."
        }), 200

    final_status_code = "error_unknown"
    message = "An unexpected issue occurred."

    if printed_any and printed_all and csv_log_succeeded:
        message = f"Order #{authoritative_order_number} processed: all copies printed ({copies_to_print}), and logged successfully!"
        final_status_code = "success"
    elif printed_any and not printed_all and csv_log_succeeded:
        message = f"Order #{authoritative_order_number} processed: Some copies PRINTED & LOGGED. Some FAILED. Please check printer."
        final_status_code = "warning_print_partial_failed" 

    # Track order analytics (regardless of print/log status)
    try:
        track_order_analytics(order_data_internal)
    except Exception as e:
        app.logger.warning(f"Failed to track order analytics: {e}")
    
    app.logger.info(f"Order #{authoritative_order_number} processing complete. Final Status: {final_status_code}, Printed: {print_status_summary}, Logged: {csv_log_succeeded}")
    return jsonify({
        "status": final_status_code,
        "order_number": authoritative_order_number,
        "printed": print_status_summary, 
        "logged": csv_log_succeeded,
        "message": message
    }), 200

def diagnose_license_failure(license_file_path):
    """Comprehensive license diagnosis for troubleshooting"""
    app.logger.info("=== LICENSE DIAGNOSIS START ===")
    
    # Check file existence and permissions
    app.logger.info(f"License file path: {license_file_path}")
    app.logger.info(f"File exists: {os.path.exists(license_file_path)}")
    
    if not os.path.exists(license_file_path):
        app.logger.error("LICENSE DIAGNOSIS: File does not exist!")
        return False
    
    # Check file readability
    try:
        with open(license_file_path, 'r') as f:
            content = f.read()
        app.logger.info(f"File readable: Yes, {len(content)} characters")
    except Exception as e:
        app.logger.error(f"LICENSE DIAGNOSIS: Cannot read file - {e}")
        return False
    
    # Check JSON parsing
    try:
        license_data = json.loads(content)
        app.logger.info(f"JSON valid: Yes")
        app.logger.info(f"License customer: {license_data.get('customer', 'MISSING')}")
        app.logger.info(f"License hardware_id: {license_data.get('hardware_id', 'MISSING')}")
        app.logger.info(f"License signature: {license_data.get('signature', 'MISSING')[:16]}...")
    except Exception as e:
        app.logger.error(f"LICENSE DIAGNOSIS: Invalid JSON - {e}")
        return False
    
    # Check hardware ID matching
    current_hw_id = get_enhanced_hardware_id()
    mac_node = uuid.getnode()
    mac_hex = f'{mac_node:012x}'
    
    app.logger.info(f"Current enhanced HW ID: {current_hw_id}")
    app.logger.info(f"Current MAC hex: {mac_hex}")
    app.logger.info(f"Current MAC node: {mac_node}")
    
    # Check all possible matches
    license_hw_id = license_data.get('hardware_id', '')
    matches = {
        'enhanced_match': current_hw_id == license_hw_id,
        'mac_hex_match': mac_hex == license_hw_id,
        'mac_no_colon_match': current_hw_id.replace(':', '') == license_hw_id
    }
    
    app.logger.info(f"Hardware ID matches: {matches}")
    
    # Check signature validation
    try:
        data = f"{license_hw_id}{APP_SECRET_KEY}".encode()
        expected_signature = hashlib.sha256(data).hexdigest()
        signature_match = expected_signature == license_data.get('signature', '')
        app.logger.info(f"Signature valid: {signature_match}")
        if not signature_match:
            app.logger.info(f"Expected signature: {expected_signature}")
            app.logger.info(f"License signature:  {license_data.get('signature', '')}")
    except Exception as e:
        app.logger.error(f"LICENSE DIAGNOSIS: Signature validation error - {e}")
    
    app.logger.info("=== LICENSE DIAGNOSIS END ===")
    return True
    
def check_trial_status():
    """
    Hybrid cloud-first license validation with encrypted local cache and grace period
    Priority: Cloud validation -> Encrypted cache (with grace period) -> Legacy license.key -> Trial
    """
    
    # Step 1: Check for legacy license.key file (backward compatibility)
    if os.path.exists(LICENSE_FILE):
        app.logger.info("Found legacy license.key file - checking validity")
        # Add comprehensive diagnosis
        diagnose_license_failure(LICENSE_FILE)
        
        try:
            with open(LICENSE_FILE) as f:
                license = json.load(f)
            
            # Validate signature
            data = f"{license['hardware_id']}{APP_SECRET_KEY}".encode()
            if hashlib.sha256(data).hexdigest() == license['signature']:
                # Validate hardware using enhanced fingerprint with backward compatibility
                current_hw_id = get_enhanced_hardware_id()
                mac_node = uuid.getnode()
                mac_hex = f'{mac_node:012x}'
                
                if (current_hw_id == license['hardware_id'] or 
                    mac_hex == license['hardware_id'] or 
                    current_hw_id.replace(':', '') == license['hardware_id']):
                    
                    # Check if license is time-limited (subscription)
                    valid_until = license.get('valid_until')
                    if valid_until:
                        # Parse expiration date
                        try:
                            expiration_date = datetime.strptime(valid_until, '%Y-%m-%d')
                            current_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                            
                            if current_date <= expiration_date:
                                app.logger.info(f"LEGACY LICENSE SUCCESS: Valid until {valid_until} for customer: {license.get('customer', 'unknown')}")
                                return {
                                    "licensed": True, 
                                    "active": True,
                                    "subscription": True,
                                    "valid_until": valid_until,
                                    "subscription_id": license.get('subscription_id'),
                                    "days_left": (expiration_date - current_date).days,
                                    "source": "legacy_license_key"
                                }
                            else:
                                app.logger.error(f"LEGACY LICENSE EXPIRED: Expired on {valid_until}")
                        except ValueError as e:
                            app.logger.error(f"LEGACY LICENSE FAILED: Invalid date format in valid_until: {e}")
                    else:
                        # Permanent license (backward compatibility)
                        app.logger.info(f"LEGACY PERMANENT LICENSE SUCCESS: Validated for customer: {license.get('customer', 'unknown')}")
                        return {"licensed": True, "active": True, "subscription": False, "source": "legacy_license_key"}
                        
                else:
                    app.logger.error(f"LEGACY LICENSE FAILED: Hardware ID mismatch")
            else:
                app.logger.error("LEGACY LICENSE FAILED: Invalid signature")
                
        except json.JSONDecodeError as e:
            app.logger.error(f"LEGACY LICENSE FAILED: Invalid JSON format - {e}")
        except KeyError as e:
            app.logger.error(f"LEGACY LICENSE FAILED: Missing required field - {e}")
        except Exception as e:
            app.logger.error(f"LEGACY LICENSE FAILED: Unexpected error - {e}")
            
    # Step 2: Try to load encrypted license cache
    cache_data = _load_license_cache()
    cloud_validation_attempted = False
    
    # Step 3: If we have cache data, attempt cloud validation first (cloud-first approach)
    if cache_data:
        license_data = cache_data.get('license_data', {})
        customer_email = license_data.get('customer_email')
        unlock_token = license_data.get('unlock_token')
        hardware_id = license_data.get('hardware_id')
        
        if customer_email and unlock_token and hardware_id:
            app.logger.info("Found cached credentials - attempting cloud validation")
            cloud_validation_attempted = True
            
            # Attempt cloud validation with timeout
            success, cloud_license_data, error_msg = _validate_license_with_cloud(
                customer_email, unlock_token, hardware_id, CLOUD_VALIDATION_TIMEOUT
            )
            
            if success and cloud_license_data:
                app.logger.info("CLOUD VALIDATION SUCCESS - updating cache")
                
                # Update cache with fresh validation
                _save_license_cache(cloud_license_data)
                
                # Process cloud validation result
                valid_until = cloud_license_data.get('valid_until')
                if valid_until:
                    try:
                        expiration_date = datetime.strptime(valid_until, '%Y-%m-%d')
                        current_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                        
                        if current_date <= expiration_date:
                            return {
                                "licensed": True,
                                "active": True,
                                "subscription": True,
                                "valid_until": valid_until,
                                "subscription_id": cloud_license_data.get('subscription_id'),
                                "days_left": (expiration_date - current_date).days,
                                "source": "cloud_validation"
                            }
                        else:
                            app.logger.error(f"CLOUD LICENSE EXPIRED: Expired on {valid_until}")
                            _clear_license_cache()  # Clear invalid cache
                            return {
                                "licensed": False,
                                "active": False,
                                "expired": True,
                                "subscription_expired": True,
                                "expired_date": valid_until,
                                "source": "cloud_validation"
                            }
                    except ValueError:
                        app.logger.error("CLOUD LICENSE: Invalid date format")
                else:
                    # Permanent license
                    return {"licensed": True, "active": True, "subscription": False, "source": "cloud_validation"}
            else:
                app.logger.warning(f"Cloud validation failed: {error_msg}")
    
    # Step 4: Cloud validation failed or not attempted - check cached data with grace period
    if cache_data:
        app.logger.info("Using cached license data with grace period validation")
        
        last_validation = cache_data.get('last_validation')
        license_data = cache_data.get('license_data', {})
        
        if last_validation:
            days_offline, is_expired, warning_level = _calculate_grace_period_status(last_validation)
            days_left = GRACE_PERIOD_DAYS - days_offline
            
            if is_expired:
                app.logger.error(f"GRACE PERIOD EXPIRED: {days_offline} days offline (limit: {GRACE_PERIOD_DAYS})")
                _clear_license_cache()  # Clear expired cache
                return {
                    "licensed": False,
                    "active": False,
                    "expired": True,
                    "grace_period_expired": True,
                    "days_offline": days_offline,
                    "source": "grace_period_expired"
                }
            else:
                # Still within grace period
                app.logger.info(f"GRACE PERIOD ACTIVE: {days_offline} days offline, {days_left} days remaining")
                
                # Generate warning message if needed
                warning_message = _get_grace_period_warning_message(warning_level, days_offline, days_left)
                
                # Check cached license validity
                valid_until = license_data.get('valid_until')
                result = {
                    "licensed": True,
                    "active": True,
                    "grace_period": True,
                    "days_offline": days_offline,
                    "grace_days_left": days_left,
                    "source": "cached_grace_period",
                    "cloud_validation_attempted": cloud_validation_attempted
                }
                
                if warning_message:
                    result["warning"] = warning_message
                    result["warning_level"] = warning_level
                
                if valid_until:
                    try:
                        expiration_date = datetime.strptime(valid_until, '%Y-%m-%d')
                        current_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                        
                        result.update({
                            "subscription": True,
                            "valid_until": valid_until,
                            "subscription_id": license_data.get('subscription_id'),
                            "days_left": (expiration_date - current_date).days
                        })
                        
                        # Check if subscription itself is expired
                        if current_date > expiration_date:
                            app.logger.error(f"CACHED SUBSCRIPTION EXPIRED: Expired on {valid_until}")
                            _clear_license_cache()
                            return {
                                "licensed": False,
                                "active": False,
                                "expired": True,
                                "subscription_expired": True,
                                "expired_date": valid_until,
                                "source": "cached_subscription_expired"
                            }
                    except ValueError:
                        app.logger.error("CACHED LICENSE: Invalid date format")
                else:
                    result["subscription"] = False
                
                return result
    
    # Step 5: No valid cache or license - fall back to trial system
    app.logger.info("No valid license found - checking trial status")
    
    try:
        candidates = []
        # File
        try:
            if os.path.exists(TRIAL_INFO_FILE):
                with open(TRIAL_INFO_FILE) as f:
                    candidates.append(_validate_and_parse_trial(json.load(f)))
        except Exception:
            candidates.append(None)

        # Registry
        candidates.append(_validate_and_parse_trial(get_trial_from_registry()))

        # ProgramData
        candidates.append(_validate_and_parse_trial(get_trial_from_programdata()))

        valid_candidates = [c for c in candidates if c]
        if not valid_candidates:
            return {"licensed": False, "active": False, "expired": True, "source": "no_trial"}

        earliest = min(valid_candidates, key=lambda c: c['date_obj'])
        first_run = earliest['date_obj']
        first_run_date = earliest['first_run_date']
        signature = earliest['signature']

        # Sync back everywhere (will never move date forward)
        _persist_trial_everywhere(first_run_date, signature)

        days_elapsed = (datetime.now() - first_run).days
        days_left = 30 - days_elapsed

        return {
            "licensed": False,
            "active": days_left > 0,
            "days_left": max(0, days_left),
            "expired": days_left <= 0,
            "source": "trial"
        }
    except Exception as e:
        app.logger.error(f"Trial check failed: {e}")
        return {"licensed": False, "active": False, "expired": True, "source": "trial_error"}

# --- Usage Analytics Functions ---
def track_order_analytics(order_data):
    """Track order for usage analytics"""
    try:
        # Calculate order total
        total = 0
        for item in order_data.get('items', []):
            quantity = int(item.get('quantity', 1))
            price = float(item.get('price', 0))
            total += quantity * price
        
        # Load current analytics
        analytics = get_usage_analytics()
        
        # Update totals
        analytics['total_orders'] += 1
        analytics['total_revenue'] += total
        
        # Update dates
        today = datetime.now().strftime('%Y-%m-%d')
        if not analytics['first_order_date']:
            analytics['first_order_date'] = today
        analytics['last_order_date'] = today
        
        # Update daily stats
        if today not in analytics['orders_by_day']:
            analytics['orders_by_day'][today] = 0
            analytics['revenue_by_day'][today] = 0
        
        analytics['orders_by_day'][today] += 1
        analytics['revenue_by_day'][today] += total
        
        # Save analytics
        with open(USAGE_ANALYTICS_FILE, 'w', encoding='utf-8') as f:
            json.dump(analytics, f, indent=2, ensure_ascii=False)
            
        app.logger.info(f"Analytics updated: Order #{order_data.get('number')} worth €{total:.2f}")
        
    except Exception as e:
        app.logger.warning(f"Failed to update analytics: {e}")

def get_usage_analytics():
    """Get current usage analytics"""
    try:
        if os.path.exists(USAGE_ANALYTICS_FILE):
            with open(USAGE_ANALYTICS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        app.logger.warning(f"Failed to load analytics: {e}")
    
    # Return default analytics if file doesn't exist or can't be read
    return {
        "total_orders": 0,
        "total_revenue": 0,
        "first_order_date": None,
        "last_order_date": None,
        "orders_by_day": {},
        "revenue_by_day": {}
    }

def get_trial_usage_summary():
    """Get formatted usage summary for trial lock screen"""
    analytics = get_usage_analytics()
    trial_info = check_trial_status()
    
    # Calculate days used
    days_used = 30
    if not trial_info.get('active', False) and not trial_info.get('licensed', False):
        # Trial expired, calculate actual days used
        try:
            if os.path.exists(TRIAL_INFO_FILE):
                with open(TRIAL_INFO_FILE, 'r') as f:
                    trial_data = json.load(f)
                    first_run_date = datetime.strptime(trial_data['first_run_date'], '%Y-%m-%d')
                    days_used = (datetime.now() - first_run_date).days
        except Exception:
            pass
    else:
        # Active trial, calculate days since first run
        days_used = 30 - trial_info.get('days_left', 0)
    
    return {
        "total_orders": analytics['total_orders'],
        "total_revenue": analytics['total_revenue'],
        "days_used": max(days_used, 1),  # At least 1 day
        "avg_orders_per_day": analytics['total_orders'] / max(days_used, 1),
        "avg_revenue_per_day": analytics['total_revenue'] / max(days_used, 1)
    }

# Add API endpoint
@app.route('/api/trial_status')
def get_trial_status():
    return jsonify(check_trial_status())

@app.route('/api/usage_analytics')
def get_usage_analytics_endpoint():
    """Get usage analytics for lock screen display"""
    return jsonify(get_trial_usage_summary())

@app.route('/api/create-portal-session', methods=['POST'])
def create_customer_portal_session():
    """Create Stripe customer portal session for subscription management"""
    try:
        # Rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
        if not check_rate_limit(client_ip, 'create-portal-session', max_requests=5, window_seconds=300):
            app.logger.warning(f"Rate limit exceeded for create-portal-session from {client_ip}")
            return jsonify({"error": "Too many requests. Please try again later."}), 429
        
        # Check if user has an active subscription
        trial_status = check_trial_status()
        if not trial_status.get('licensed') or not trial_status.get('subscription'):
            return jsonify({
                "error": "No active subscription found",
                "code": "SUBSCRIPTION_REQUIRED"
            }), 400
        
        # Get customer email from request or license file with validation
        try:
            data = request.get_json() or {}
            if not isinstance(data, dict):
                return jsonify({"error": "Invalid request format", "code": "INVALID_REQUEST"}), 400
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({"error": "Invalid JSON in request", "code": "INVALID_JSON"}), 400
        
        customer_email = data.get('customerEmail')
        
        # Sanitize email input
        if customer_email:
            customer_email = sanitize_string_input(customer_email, 254)
            if not validate_email(customer_email):
                return jsonify({
                    "error": "Invalid email format", 
                    "code": "INVALID_EMAIL"
                }), 400
        
        if not customer_email:
            # Try to get from license file
            license_data = get_license_data()
            if license_data:
                customer_email = license_data.get('customer_email')
                if customer_email:
                    customer_email = sanitize_string_input(customer_email, 254)
                    if not validate_email(customer_email):
                        customer_email = None
            
        if not customer_email:
            return jsonify({
                "error": "Customer email not found or invalid", 
                "code": "EMAIL_REQUIRED"
            }), 400
        
        # Call Cloudflare Worker to create portal session
        app.logger.info(f"Creating portal session for email: {customer_email[:5]}***")
        response = call_cloudflare_api('/create-portal-session', {
            'email': customer_email
        })
        
        if response and response.get('success'):
            portal_url = response.get('portal_url')
            if portal_url and isinstance(portal_url, str) and portal_url.startswith('https://'):
                return jsonify({
                    "url": portal_url,
                    "message": "Portal session created successfully",
                    "code": "SUCCESS"
                })
            else:
                app.logger.error("Invalid portal URL returned from Cloudflare API")
                return jsonify({
                    "error": "Invalid portal URL received",
                    "code": "INVALID_RESPONSE"
                }), 500
        else:
            error_msg = response.get('error') if response else 'Unknown error'
            app.logger.warning(f"Cloudflare portal session creation failed: {error_msg}")
            # Fallback to placeholder
            return jsonify({
                "url": "https://billing.stripe.com/session/portal_session_placeholder",
                "message": "Portal temporarily unavailable - contact support for subscription changes",
                "code": "FALLBACK_MODE"
            })
        
    except Exception as e:
        app.logger.error(f"Failed to create portal session: {e}")
        return jsonify({
            "error": "Internal server error", 
            "code": "SERVER_ERROR"
        }), 500

@app.route('/api/create-subscription-session', methods=['POST'])
def create_subscription_session():
    """Create Stripe checkout session for subscription"""
    try:
        # Rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
        if not check_rate_limit(client_ip, 'create-subscription-session', max_requests=3, window_seconds=300):
            app.logger.warning(f"Rate limit exceeded for create-subscription-session from {client_ip}")
            return jsonify({"error": "Too many requests. Please try again later.", "code": "RATE_LIMIT"}), 429
        
        # Parse and validate JSON request
        try:
            data = request.get_json()
            if not data or not isinstance(data, dict):
                return jsonify({"error": "Invalid request format", "code": "INVALID_REQUEST"}), 400
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({"error": "Invalid JSON in request", "code": "INVALID_JSON"}), 400
        
        # Validate required fields with proper sanitization
        required_fields = ['customerName', 'customerEmail', 'hardwareId']
        validated_data = {}
        
        for field in required_fields:
            value = data.get(field)
            if not value:
                return jsonify({
                    "error": f"Missing required field: {field}",
                    "code": "MISSING_FIELD"
                }), 400
            
            if field == 'customerEmail':
                email = sanitize_string_input(value, 254)
                if not validate_email(email):
                    return jsonify({
                        "error": "Invalid email format",
                        "code": "INVALID_EMAIL"
                    }), 400
                validated_data['email'] = email
                
            elif field == 'customerName':
                name = sanitize_string_input(value, 100)
                if not name or len(name) < 2:
                    return jsonify({
                        "error": "Invalid customer name",
                        "code": "INVALID_NAME"
                    }), 400
                validated_data['name'] = name
                
            elif field == 'hardwareId':
                hw_id = sanitize_string_input(value, 128)
                if not validate_hardware_id(hw_id):
                    return jsonify({
                        "error": "Invalid hardware ID format",
                        "code": "INVALID_HARDWARE_ID"
                    }), 400
                validated_data['machineFingerprint'] = hw_id
        
        # Optional restaurant name with validation
        restaurant_name = data.get('restaurantName')
        if restaurant_name:
            restaurant_name = sanitize_string_input(restaurant_name, 100)
            validated_data['restaurantName'] = restaurant_name if restaurant_name else validated_data['name']
        else:
            validated_data['restaurantName'] = validated_data['name']
        
        # Call Cloudflare Worker to create Stripe checkout session
        app.logger.info(f"Creating subscription session for: {validated_data['email'][:5]}*** / {validated_data['name']}")
        response = call_cloudflare_api('/create-checkout-session', validated_data)
        
        if response and response.get('success'):
            session_id = response.get('sessionId')
            checkout_url = response.get('checkoutUrl')
            
            # Validate response data
            if not session_id or not isinstance(session_id, str):
                app.logger.error("Invalid session ID from Cloudflare API")
                return jsonify({
                    "error": "Invalid session ID received",
                    "code": "INVALID_RESPONSE"
                }), 500
            
            if not checkout_url or not isinstance(checkout_url, str) or not checkout_url.startswith('https://'):
                app.logger.error("Invalid checkout URL from Cloudflare API")
                return jsonify({
                    "error": "Invalid checkout URL received", 
                    "code": "INVALID_RESPONSE"
                }), 500
            
            return jsonify({
                "id": session_id,
                "url": checkout_url,
                "message": "Checkout session created successfully",
                "code": "SUCCESS"
            })
        else:
            error_msg = response.get('error') if response else 'Unknown error'
            app.logger.warning(f"Cloudflare subscription session creation failed: {error_msg}")
            # Fallback to placeholder
            return jsonify({
                "id": "cs_subscription_placeholder",
                "url": "https://checkout.stripe.com/subscription_placeholder",
                "message": "Payment system temporarily unavailable - please try again later",
                "code": "FALLBACK_MODE"
            })
        
    except Exception as e:
        app.logger.error(f"Failed to create subscription session: {e}")
        return jsonify({
            "error": "Internal server error",
            "code": "SERVER_ERROR"
        }), 500

@app.route('/api/validate-license', methods=['POST'])
def validate_license_api():
    """Validate license with Cloudflare Worker (real-time check)"""
    try:
        # Rate limiting - more lenient for license validation
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
        if not check_rate_limit(client_ip, 'validate-license', max_requests=20, window_seconds=300):
            app.logger.warning(f"Rate limit exceeded for validate-license from {client_ip}")
            return jsonify({"error": "Too many requests. Please try again later.", "code": "RATE_LIMIT"}), 429
        
        # Parse and validate request
        try:
            data = request.get_json() or {}
            if not isinstance(data, dict):
                data = {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            app.logger.warning("Invalid JSON in license validation request, using empty data")
            data = {}
        
        # Get hardware ID (use provided or generate)
        hardware_id = data.get('hardwareId')
        if hardware_id:
            hardware_id = sanitize_string_input(hardware_id, 128)
            if not validate_hardware_id(hardware_id):
                hardware_id = None
                
        if not hardware_id:
            try:
                hardware_id = get_enhanced_hardware_id()
            except Exception as e:
                app.logger.error(f"Failed to generate hardware ID: {e}")
                return jsonify({
                    "error": "Unable to generate hardware ID",
                    "code": "HARDWARE_ID_ERROR"
                }), 500
        
        # Get customer email and unlock token with validation
        customer_email = data.get('customerEmail')
        unlock_token = data.get('unlockToken')
        
        # Sanitize inputs
        if customer_email:
            customer_email = sanitize_string_input(customer_email, 254)
            if not validate_email(customer_email):
                customer_email = None
                
        if unlock_token:
            unlock_token = sanitize_string_input(unlock_token, 512)  # Tokens can be longer
            if not unlock_token:
                unlock_token = None
        
        if not customer_email or not unlock_token:
            # Try to get from license file
            try:
                license_data = get_license_data()
                if license_data:
                    if not customer_email:
                        file_email = license_data.get('customer_email')
                        if file_email:
                            file_email = sanitize_string_input(file_email, 254)
                            if validate_email(file_email):
                                customer_email = file_email
                    
                    if not unlock_token:
                        file_token = license_data.get('unlock_token')
                        if file_token:
                            file_token = sanitize_string_input(file_token, 512)
                            if file_token:
                                unlock_token = file_token
            except Exception as e:
                app.logger.warning(f"Error reading license data for validation: {e}")
        
        if not customer_email or not unlock_token:
            # Fall back to file-based validation
            app.logger.info("No valid cloud credentials found, using file-based validation")
            try:
                trial_status = check_trial_status()
                trial_status['cloud_validation'] = False
                trial_status['validation_method'] = 'file_based'
                return jsonify(trial_status)
            except Exception as e:
                app.logger.error(f"File-based validation failed: {e}")
                return jsonify({
                    "licensed": False,
                    "subscription": False,
                    "status": "error",
                    "message": "License validation failed",
                    "cloud_validation": False,
                    "code": "VALIDATION_ERROR"
                }), 500
        
        # Call Cloudflare Worker for validation
        app.logger.info(f"Validating license for: {customer_email[:5]}*** via cloud")
        response = call_cloudflare_api('/validate', {
            'email': customer_email,
            'unlockToken': unlock_token,
            'machineFingerprint': hardware_id
        })
        
        if response and response.get('success'):
            # Save successful validation to encrypted cache
            license_data = response.get('licenseData', {})
            if license_data:
                # Add the credentials to cache for future use
                license_data.update({
                    'customer_email': customer_email,
                    'unlock_token': unlock_token,
                    'hardware_id': hardware_id
                })
                _save_license_cache(license_data)
                app.logger.info("License validation successful - saved to cache")
            
            return jsonify({
                "licensed": True,
                "subscription": True,
                "status": "active",
                "message": "License validated successfully",
                "cloud_validation": True,
                "validation_method": "cloud",
                "code": "SUCCESS"
            })
            
        elif response and response.get('error'):
            error_msg = sanitize_string_input(str(response.get('error')), 200)
            return jsonify({
                "licensed": False,
                "subscription": False, 
                "status": "invalid",
                "message": error_msg or "License validation failed",
                "cloud_validation": True,
                "validation_method": "cloud",
                "code": "INVALID_LICENSE"
            })
            
        else:
            # Fallback to file-based validation
            app.logger.warning("Cloud validation returned no clear response, falling back to file-based")
            try:
                trial_status = check_trial_status()
                trial_status['cloud_validation'] = False
                trial_status['validation_method'] = 'file_based_fallback'
                return jsonify(trial_status)
            except Exception as e:
                app.logger.error(f"File-based fallback validation failed: {e}")
                return jsonify({
                    "licensed": False,
                    "subscription": False,
                    "status": "error",
                    "message": "All validation methods failed",
                    "cloud_validation": False,
                    "code": "FALLBACK_ERROR"
                }), 500
        
    except Exception as e:
        app.logger.error(f"License validation error: {e}")
        # Always fallback to file-based validation on error
        try:
            trial_status = check_trial_status()
            trial_status['cloud_validation'] = False
            trial_status['validation_method'] = 'file_based_error_fallback'
            return jsonify(trial_status)
        except Exception as fallback_error:
            app.logger.error(f"Emergency fallback validation failed: {fallback_error}")
            return jsonify({
                "licensed": False,
                "subscription": False,
                "status": "error", 
                "message": "License validation system error",
                "cloud_validation": False,
                "code": "SYSTEM_ERROR"
            }), 500

@app.route('/api/system_status')
def get_system_status():
    """System diagnostic endpoint for troubleshooting customer issues"""
    import socket
    status = {
        "version": CURRENT_VERSION,
        "license": check_trial_status(),
        "network": {},
        "files": {},
        "analytics": {}
    }
    
    try:
        # Network info
        hostname = socket.gethostname()
        try:
            temp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            temp_socket.connect(("8.8.8.8", 80))
            primary_ip = temp_socket.getsockname()[0]
            temp_socket.close()
        except:
            primary_ip = socket.gethostbyname(hostname)
        
        port = config.get('port', 5000)
        status["network"] = {
            "hostname": hostname,
            "primary_ip": primary_ip,
            "port": port,
            "mobile_url": f"http://{primary_ip}:{port}"
        }
        
        # File status
        status["files"] = {
            "menu_exists": os.path.exists(MENU_FILE),
            "menu_path": MENU_FILE,
            "license_exists": os.path.exists(LICENSE_FILE),
            "license_path": LICENSE_FILE,
            "data_dir": DATA_DIR
        }
        
        # Analytics data
        csv_files = [f for f in os.listdir(DATA_DIR) if f.startswith('orders_') and f.endswith('.csv')] if os.path.exists(DATA_DIR) else []
        status["analytics"] = {
            "csv_files_count": len(csv_files),
            "csv_files": csv_files[:5],  # Show first 5
            "has_recent_data": len(csv_files) > 0
        }
        
    except Exception as e:
        status["error"] = str(e)
    
    return jsonify(status)

def get_enhanced_hardware_id():
    """Get enhanced hardware fingerprint using multiple identifiers - EXACT MATCH to license generator"""
    import subprocess
    import platform
    
    # Get MAC address (FIXED - correct bit shifting)
    mac_node = uuid.getnode()
    mac = ':'.join(f'{(mac_node >> (8 * (5-i))) & 0xff:02x}' for i in range(6))
    
    # Get CPU info (EXACT match to license generator)
    try:
        cpu_info = platform.processor()
        if not cpu_info:
            cpu_info = platform.machine()
    except:
        cpu_info = "UNKNOWN"
    
    # Get disk serial (EXACT match to license generator)
    disk_serial = "UNKNOWN"
    try:
        result = subprocess.run(['wmic', 'diskdrive', 'where', 'index=0', 'get', 'serialnumber'], 
                              capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                disk_serial = lines[1].strip()
    except Exception as e:
        pass
    
    # Get Windows ID (EXACT match to license generator)
    win_id = "UNKNOWN"
    try:
        result = subprocess.run(['wmic', 'csproduct', 'get', 'uuid'], 
                              capture_output=True, text=True, timeout=10, creationflags=subprocess.CREATE_NO_WINDOW)
        if result.returncode == 0:
            lines = result.stdout.strip().split('\n')
            if len(lines) > 1:
                win_id = lines[1].strip()
    except Exception as e:
        pass
    
    # Combine all identifiers and hash (EXACT same as license generator)
    combined = f"{mac}|{cpu_info}|{disk_serial}|{win_id}"
    enhanced_id = hashlib.sha256(combined.encode()).hexdigest()[:16]
    
    return enhanced_id

# --- License Cache Encryption Utilities ---
def _get_license_encryption_key():
    """Generate encryption key based on hardware ID and app secret"""
    try:
        hardware_id = get_enhanced_hardware_id()
        # Combine hardware ID with app secret for key derivation
        key_material = f"{hardware_id}{APP_SECRET_KEY}".encode()
        
        # Use PBKDF2 to derive a proper encryption key
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'pospal_license_salt_v1',  # Fixed salt for consistency
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(key_material))
        return Fernet(key)
    except Exception as e:
        app.logger.error(f"Failed to generate license encryption key: {e}")
        return None

def _encrypt_license_data(data):
    """Encrypt license data for secure local storage"""
    try:
        fernet = _get_license_encryption_key()
        if not fernet:
            return None
            
        json_data = json.dumps(data, separators=(',', ':'))
        encrypted_data = fernet.encrypt(json_data.encode())
        return base64.urlsafe_b64encode(encrypted_data).decode()
    except Exception as e:
        app.logger.error(f"Failed to encrypt license data: {e}")
        return None

def _decrypt_license_data(encrypted_data):
    """Decrypt license data from secure local storage"""
    try:
        fernet = _get_license_encryption_key()
        if not fernet:
            return None
            
        encrypted_bytes = base64.urlsafe_b64decode(encrypted_data.encode())
        decrypted_data = fernet.decrypt(encrypted_bytes)
        return json.loads(decrypted_data.decode())
    except Exception as e:
        app.logger.error(f"Failed to decrypt license data: {e}")
        return None

def _validate_license_with_cloud(customer_email, unlock_token, hardware_id, timeout=CLOUD_VALIDATION_TIMEOUT):
    """
    Validate license with Cloudflare Worker with timeout and error handling
    Returns: (success: bool, license_data: dict, error_message: str)
    """
    try:
        app.logger.info(f"Attempting cloud license validation for {customer_email[:5]}*** with {timeout}s timeout")
        
        # Prepare validation data
        validation_data = {
            'email': customer_email,
            'unlockToken': unlock_token,
            'hardwareId': hardware_id
        }
        
        # Call cloud validation with timeout
        response = call_cloudflare_api('/validate', validation_data, timeout=timeout, max_retries=1)
        
        if not response:
            return False, None, "No response from cloud validation service"
            
        if response.get('success'):
            license_data = response.get('licenseData', {})
            if license_data:
                app.logger.info(f"Cloud validation successful for {customer_email[:5]}***")
                return True, license_data, None
            else:
                return False, None, "Cloud validation succeeded but no license data returned"
        else:
            error_msg = response.get('error', 'Unknown cloud validation error')
            app.logger.warning(f"Cloud validation failed: {error_msg}")
            return False, None, error_msg
            
    except Exception as e:
        error_msg = f"Cloud validation exception: {str(e)}"
        app.logger.error(error_msg)
        return False, None, error_msg

def _save_license_cache(license_data, last_validation_timestamp=None):
    """Save validated license data to encrypted local cache"""
    try:
        if last_validation_timestamp is None:
            last_validation_timestamp = datetime.now().isoformat()
            
        cache_data = {
            'license_data': license_data,
            'last_validation': last_validation_timestamp,
            'cache_version': '1.0',
            'hardware_id': get_enhanced_hardware_id()
        }
        
        encrypted_data = _encrypt_license_data(cache_data)
        if not encrypted_data:
            app.logger.error("Failed to encrypt license cache data")
            return False
            
        # Ensure directories exist
        os.makedirs(os.path.dirname(LICENSE_CACHE_FILE), exist_ok=True)
        os.makedirs(os.path.dirname(LICENSE_CACHE_BACKUP), exist_ok=True)
        
        # Save to primary location
        with open(LICENSE_CACHE_FILE, 'w') as f:
            f.write(encrypted_data)
            
        # Save backup copy
        with open(LICENSE_CACHE_BACKUP, 'w') as f:
            f.write(encrypted_data)
            
        app.logger.info("License cache saved successfully")
        return True
        
    except Exception as e:
        app.logger.error(f"Failed to save license cache: {e}")
        return False

def _load_license_cache():
    """Load and decrypt license data from local cache"""
    try:
        cache_file = None
        
        # Try primary cache first, then backup
        for cache_path in [LICENSE_CACHE_FILE, LICENSE_CACHE_BACKUP]:
            if os.path.exists(cache_path):
                cache_file = cache_path
                break
                
        if not cache_file:
            app.logger.info("No license cache file found")
            return None
            
        with open(cache_file, 'r') as f:
            encrypted_data = f.read().strip()
            
        if not encrypted_data:
            app.logger.warning("License cache file is empty")
            return None
            
        cache_data = _decrypt_license_data(encrypted_data)
        if not cache_data:
            app.logger.warning("Failed to decrypt license cache")
            return None
            
        # Validate cache data structure
        required_fields = ['license_data', 'last_validation', 'hardware_id']
        if not all(field in cache_data for field in required_fields):
            app.logger.warning("License cache missing required fields")
            return None
            
        # Verify hardware ID matches (cache is machine-specific)
        current_hw_id = get_enhanced_hardware_id()
        if cache_data['hardware_id'] != current_hw_id:
            app.logger.warning("License cache hardware ID mismatch - cache invalid")
            return None
            
        app.logger.info("License cache loaded successfully")
        return cache_data
        
    except Exception as e:
        app.logger.error(f"Failed to load license cache: {e}")
        return None

def _clear_license_cache():
    """Clear the license cache (on validation failure)"""
    try:
        for cache_path in [LICENSE_CACHE_FILE, LICENSE_CACHE_BACKUP]:
            if os.path.exists(cache_path):
                os.remove(cache_path)
        app.logger.info("License cache cleared")
    except Exception as e:
        app.logger.error(f"Failed to clear license cache: {e}")

def _calculate_grace_period_status(last_validation_timestamp):
    """
    Calculate grace period status and warnings
    Returns: (days_offline: int, is_expired: bool, warning_level: int)
    warning_level: 0=none, 1=day 8, 2=day 9, 3=day 10, 4=expired
    """
    try:
        last_validation = datetime.fromisoformat(last_validation_timestamp)
        current_time = datetime.now()
        days_offline = (current_time - last_validation).days
        
        is_expired = days_offline >= GRACE_PERIOD_DAYS
        
        # Determine warning level
        warning_level = 0
        if days_offline >= 8 and days_offline < 9:
            warning_level = 1  # Day 8 warning
        elif days_offline >= 9 and days_offline < 10:
            warning_level = 2  # Day 9 warning  
        elif days_offline >= 10 and days_offline < GRACE_PERIOD_DAYS:
            warning_level = 3  # Day 10 warning
        elif is_expired:
            warning_level = 4  # Expired
            
        return days_offline, is_expired, warning_level
        
    except Exception as e:
        app.logger.error(f"Failed to calculate grace period status: {e}")
        # Assume expired on error
        return GRACE_PERIOD_DAYS, True, 4

def _get_grace_period_warning_message(warning_level, days_offline, days_left):
    """Generate appropriate warning message based on warning level"""
    if warning_level == 1:
        return f"License validation offline for {days_offline} days. Please connect to internet soon. ({days_left} days remaining)"
    elif warning_level == 2:
        return f"License validation offline for {days_offline} days. Please connect to internet. ({days_left} days remaining)"
    elif warning_level == 3:
        return f"URGENT: License validation offline for {days_offline} days. Must connect to internet today! ({days_left} days remaining)"
    elif warning_level == 4:
        return f"License validation expired after {GRACE_PERIOD_DAYS} days offline. Please connect to internet to restore access."
    else:
        return None

@app.route('/api/hardware_id')
def get_hardware_id():
    """Get machine's hardware ID"""
    # Return enhanced hardware ID
    hw_id = get_enhanced_hardware_id()
    return jsonify({"hardware_id": hw_id})
    

# --- NEW ENDPOINTS FOR REPRINT ---
@app.route('/api/todays_orders_for_reprint', methods=['GET'])
def get_todays_orders_for_reprint():
    try:
        today_date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{today_date_str}.csv")
        
        if not os.path.exists(filename):
            return jsonify([])

        orders_for_reprint = []
        with open(filename, 'r', newline='', encoding='utf-8') as f_read:
            reader = csv.DictReader(f_read)
            for row in reader:
                if row.get('order_number') and row.get('items_json'): 
                    orders_for_reprint.append({
                        'order_number': row.get('order_number'),
                        'table_number': row.get('table_number'),
                        'timestamp': row.get('timestamp')
                    })
        orders_for_reprint.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        return jsonify(orders_for_reprint)

    except Exception as e:
        app.logger.error(f"Error fetching today's orders for reprint: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not fetch today's orders: {str(e)}"}), 500


@app.route('/api/reprint_order', methods=['POST'])
def reprint_order_endpoint():
    data = request.json
    order_number_to_reprint = data.get('order_number')

    if not order_number_to_reprint:
        return jsonify({"status": "error", "message": "Order number is required for reprint."}), 400

    try:
        today_date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{today_date_str}.csv")

        if not os.path.exists(filename):
            return jsonify({"status": "error", "message": f"No orders found for today to reprint order #{order_number_to_reprint}."}), 404

        found_order_row = None
        with open(filename, 'r', newline='', encoding='utf-8') as f_read:
            reader = csv.DictReader(f_read)
            for row in reader:
                if row.get('order_number') == str(order_number_to_reprint) and row.get('items_json'):
                    found_order_row = row
                    break
        
        if not found_order_row:
            return jsonify({"status": "error", "message": f"Order #{order_number_to_reprint} not found in today's records or is missing item data."}), 404

        items_list_str = found_order_row.get('items_json', '[]')
        try:
            items_list = json.loads(items_list_str)
            if not isinstance(items_list, list):
                 app.logger.error(f"Decoded items_json for order #{order_number_to_reprint} is not a list: {items_list_str}")
                 raise json.JSONDecodeError("Items data is not a list", items_list_str, 0)
        except json.JSONDecodeError as je:
            app.logger.error(f"Error decoding items_json for order #{order_number_to_reprint} during reprint: {str(je)}. Data: '{items_list_str}'")
            return jsonify({"status": "error", "message": f"Corrupted item data for order #{order_number_to_reprint}. Cannot reprint."}), 500


        if not items_list:
            app.logger.warning(f"Order #{order_number_to_reprint} has no item details for reprint (items_list is empty).")

        reprint_order_data = {
            'number': found_order_row.get('order_number'),
            'tableNumber': found_order_row.get('table_number', 'N/A'),
            'items': items_list,
            'universalComment': found_order_row.get('universal_comment', '')
        }
        original_timestamp = found_order_row.get('timestamp')

        app.logger.info(f"Attempting to reprint order #{order_number_to_reprint} (Original Timestamp: {original_timestamp})")

        reprint_copy1_success = print_kitchen_ticket(reprint_order_data, 
                                                     copy_info="", 
                                                     original_timestamp_str=original_timestamp)
        
        if not reprint_copy1_success:
            app.logger.warning(f"Reprint (Kitchen Copy) FAILED for order #{order_number_to_reprint}.")
            return jsonify({
                "status": "error_reprint_failed", 
                "message": f"Failed to reprint Kitchen Copy for order #{order_number_to_reprint}. Check printer."
            }), 200 

        app.logger.info(f"Reprint (Kitchen Copy) successful for order #{order_number_to_reprint}.")
        
        return jsonify({
            "status": "success", 
            "message": f"Order #{order_number_to_reprint} REPRINTED successfully."
        }), 200

    except json.JSONDecodeError:
        app.logger.error(f"Error decoding items_json for order #{order_number_to_reprint} during reprint (outer catch).")
        return jsonify({"status": "error", "message": f"Corrupted item data for order #{order_number_to_reprint}. Cannot reprint."}), 500
    except Exception as e:
        app.logger.error(f"Error reprinting order #{order_number_to_reprint}: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not reprint order #{order_number_to_reprint}: {str(e)}"}), 500

@app.route('/api/daily_summary', methods=['GET'])
def get_daily_summary():
    try:
        today_date_str = datetime.now().strftime("%Y-%m-%d")
        filename = os.path.join(DATA_DIR, f"orders_{today_date_str}.csv")

        if not os.path.exists(filename):
            return jsonify({
                "total_orders": 0,
                "grand_total": 0.0,
                "cash_total": 0.0,
                "card_total": 0.0
            })

        total_orders = 0
        grand_total = 0.0
        cash_total = 0.0
        card_total = 0.0

        with open(filename, 'r', newline='', encoding='utf-8') as f_read:
            reader = csv.DictReader(f_read)
            for row in reader:
                try:
                    order_total = float(row.get('order_total', 0.0))
                    payment_method = row.get('payment_method', 'Cash').strip().capitalize()

                    total_orders += 1
                    grand_total += order_total

                    if payment_method == 'Card':
                        card_total += order_total
                    else:
                        cash_total += order_total
                except (ValueError, TypeError) as e:
                    app.logger.warning(f"Could not parse row in daily summary: {row}. Error: {e}")


        return jsonify({
            "status": "success",
            "total_orders": total_orders,
            "grand_total": grand_total,
            "cash_total": cash_total,
            "card_total": card_total
        })

    except Exception as e:
        app.logger.error(f"Error generating daily summary: {str(e)}")
        return jsonify({"status": "error", "message": f"Could not generate daily summary: {str(e)}"}), 500


# --- Orders by date and order details (for order history UI) ---
@app.route('/api/orders_by_date', methods=['GET'])
def api_orders_by_date():
    try:
        date_str = request.args.get('date') or datetime.now().strftime('%Y-%m-%d')
        time_range = (request.args.get('range') or 'all').lower()
        start_hhmm = request.args.get('start')  # HH:MM
        end_hhmm = request.args.get('end')      # HH:MM

        filename = os.path.join(DATA_DIR, f"orders_{date_str}.csv")
        if not os.path.exists(filename):
            return jsonify([])

        def _within_range(ts_str: str) -> bool:
            try:
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
            except Exception:
                return True

            if time_range == 'this_hour':
                now = datetime.now()
                return ts.date() == now.date() and ts.hour == now.hour
            elif time_range == 'last2h':
                now = datetime.now()
                return now - timedelta(hours=2) <= ts <= now
            elif start_hhmm and end_hhmm:
                try:
                    start_dt = datetime.strptime(f"{date_str} {start_hhmm}:00", '%Y-%m-%d %H:%M:%S')
                    end_dt = datetime.strptime(f"{date_str} {end_hhmm}:00", '%Y-%m-%d %H:%M:%S')
                    return start_dt <= ts <= end_dt
                except Exception:
                    return True
            return True

        orders_list = []
        with open(filename, 'r', newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                ts = row.get('timestamp') or ''
                if not _within_range(ts):
                    continue
                orders_list.append({
                    'order_number': row.get('order_number'),
                    'table_number': row.get('table_number'),
                    'timestamp': ts,
                    'payment_method': row.get('payment_method', 'Cash'),
                    'order_total': row.get('order_total', ''),
                    'printed_status': row.get('printed_status', '')
                })

        try:
            orders_list.sort(key=lambda r: r.get('timestamp') or '', reverse=True)
        except Exception:
            pass
        return jsonify(orders_list)
    except Exception as e:
        app.logger.error(f"Error in /api/orders_by_date: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/order_details', methods=['GET'])
def api_order_details():
    try:
        date_str = request.args.get('date') or datetime.now().strftime('%Y-%m-%d')
        order_number = request.args.get('order_number')
        if not order_number:
            return jsonify({"status": "error", "message": "order_number is required"}), 400

        filename = os.path.join(DATA_DIR, f"orders_{date_str}.csv")
        if not os.path.exists(filename):
            return jsonify({"status": "error", "message": "No orders file found for date."}), 404

        with open(filename, 'r', newline='', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row.get('order_number') == str(order_number):
                    items_json_str = row.get('items_json', '[]')
                    try:
                        items_list = json.loads(items_json_str)
                        if not isinstance(items_list, list):
                            items_list = []
                    except Exception:
                        items_list = []
                    return jsonify({
                        'order_number': row.get('order_number'),
                        'table_number': row.get('table_number'),
                        'timestamp': row.get('timestamp'),
                        'items': items_list,
                        'universal_comment': row.get('universal_comment', ''),
                        'order_total': row.get('order_total', ''),
                        'payment_method': row.get('payment_method', 'Cash'),
                        'printed_status': row.get('printed_status', '')
                    })
        return jsonify({"status": "error", "message": "Order not found for date."}), 404
    except Exception as e:
        app.logger.error(f"Error in /api/order_details: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500



# --- ANALYTICS ENDPOINT (CORRECTED & ENHANCED) ---
@app.route('/api/analytics', methods=['GET'])
def get_analytics():
    try:
        range_type = request.args.get('range', 'today')
        start_date = request.args.get('start_date')
        end_date = request.args.get('end_date')
        
        if range_type == 'custom' and start_date and end_date:
            # Custom date range
            start = datetime.strptime(start_date, '%Y-%m-%d')
            end = datetime.strptime(end_date, '%Y-%m-%d') + timedelta(days=1)
            target_date = start
        elif range_type == 'week':
            # This week (Monday to Sunday)
            today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            start = today - timedelta(days=today.weekday())  # Monday
            end = start + timedelta(days=7)  # Next Monday
            target_date = start
        elif range_type == 'month':
            # This month
            today = datetime.now()
            start = today.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            # Next month's first day
            if start.month == 12:
                end = start.replace(year=start.year + 1, month=1)
            else:
                end = start.replace(month=start.month + 1)
            target_date = start
        else:
            # Today's analytics
            start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
            target_date = start
        
        # Read orders from CSV file
        # Check for today's CSV file, then try alternative locations and dates
        today_path = os.path.join(DATA_DIR, f"orders_{datetime.now().strftime('%Y-%m-%d')}.csv")
        orders_csv = today_path
        
        # If today's file doesn't exist, try looking for recent CSV files
        if not os.path.exists(orders_csv):
            app.logger.info(f"Today's CSV file not found: {orders_csv}")
            
            # Check alternative installation path
            alt_today_path = os.path.join(r'C:\POSPal\data', f"orders_{datetime.now().strftime('%Y-%m-%d')}.csv")
            if os.path.exists(alt_today_path):
                orders_csv = alt_today_path
                app.logger.info(f"Found CSV in alternative location: {alt_today_path}")
            else:
                # Look for any recent CSV files in both locations
                csv_files = []
                for data_dir in [DATA_DIR, r'C:\POSPal\data']:
                    if os.path.exists(data_dir):
                        try:
                            for file in os.listdir(data_dir):
                                if file.startswith('orders_') and file.endswith('.csv'):
                                    csv_path = os.path.join(data_dir, file)
                                    csv_files.append((csv_path, os.path.getmtime(csv_path)))
                        except Exception as e:
                            app.logger.warning(f"Error scanning directory {data_dir}: {e}")
                
                if csv_files:
                    # For custom date range, try to find exact date first, then most recent
                    if range_type == 'custom' and start_date:
                        date_specific_files = [f for f in csv_files if start_date in f[0]]
                        if date_specific_files:
                            orders_csv = date_specific_files[0][0]
                            app.logger.info(f"Using date-specific CSV file: {orders_csv}")
                        else:
                            csv_files.sort(key=lambda x: x[1], reverse=True)
                            orders_csv = csv_files[0][0]
                            app.logger.info(f"Date-specific file not found, using most recent: {orders_csv}")
                    else:
                        # Use the most recent CSV file
                        csv_files.sort(key=lambda x: x[1], reverse=True)
                        orders_csv = csv_files[0][0]
                        app.logger.info(f"Using most recent CSV file: {orders_csv}")
                else:
                    app.logger.warning("No CSV files found in any location")
        
        # Prepare list of CSV files for the date range
        csv_files_in_range = []
        if range_type in ['custom', 'week', 'month'] or (range_type == 'today' and not os.path.exists(today_path)):
            # For date ranges or when today's file doesn't exist, collect all CSV files in the range
            current_date = start
            while current_date < end:
                date_csv_path = os.path.join(DATA_DIR, f"orders_{current_date.strftime('%Y-%m-%d')}.csv")
                if os.path.exists(date_csv_path):
                    csv_files_in_range.append(date_csv_path)
                # Also check alternative path
                alt_date_csv_path = os.path.join(r'C:\POSPal\data', f"orders_{current_date.strftime('%Y-%m-%d')}.csv")
                if os.path.exists(alt_date_csv_path) and alt_date_csv_path not in csv_files_in_range:
                    csv_files_in_range.append(alt_date_csv_path)
                current_date += timedelta(days=1)
        else:
            # For today's analytics when file exists, use the single file we found
            if 'orders_csv' in locals() and os.path.exists(orders_csv):
                csv_files_in_range = [orders_csv]
        
        if not csv_files_in_range:
            return jsonify({
                "grossRevenue": 0.0,
                "totalOrders": 0,
                "atv": 0.0,
                "paymentMethods": {"cash": 0.0, "card": 0.0},
                "paymentCounts": {"cash": 0, "card": 0},
                "salesByHour": [],
                "salesByCategory": [],
                "topRevenueItems": [],
                "bestSellers": [],
                "worstSellers": [],
                "topAddons": [],
                "totalItems": 0
            })
        
        total_sales = 0.0
        total_orders = 0
        sales_by_hour = defaultdict(float)
        item_qty = Counter()
        item_rev = defaultdict(float)
        payment_methods = Counter()
        daypart_totals = defaultdict(float)
        addon_rev = defaultdict(float)
        addon_order_set = defaultdict(set)  # addon_name -> set(order_number)

        # Build item name -> category map from menu if available
        name_to_category = {}
        try:
            if os.path.exists(MENU_FILE):
                with open(MENU_FILE, 'r', encoding='utf-8') as mf:
                    menu_json = json.load(mf)
                    if isinstance(menu_json, dict):
                        for cat_name, items in menu_json.items():
                            for it in items or []:
                                nm = it.get('name')
                                if nm:
                                    name_to_category[nm] = cat_name
        except Exception:
            pass
        
        # Process all CSV files in the date range
        for orders_csv in csv_files_in_range:
            app.logger.info(f"Processing CSV file: {orders_csv}")
            try:
                with open(orders_csv, 'r', newline='', encoding='utf-8') as csvfile:
                    reader = csv.DictReader(csvfile)
                    for row in reader:
                        try:
                            order_date = datetime.strptime(row.get('timestamp') or row.get('Date'), '%Y-%m-%d %H:%M:%S')
                            if start <= order_date < end:
                                order_total = float(row.get('order_total') or row.get('Total') or 0.0)
                                total_sales += order_total
                                total_orders += 1
                        
                                # Sales by hour
                                hour = order_date.hour
                                sales_by_hour[hour] += order_total

                                # Daypart removed per requirements
                                
                                # Payment methods
                                payment_method = row.get('payment_method') or row.get('Payment Method', 'Cash')
                                payment_methods[payment_method] += 1
                                
                                # Top items (parse items JSON)
                                try:
                                    items = json.loads(row.get('items_json') or row.get('Items') or '[]')
                                    order_no = row.get('order_number') or row.get('OrderNumber') or str(uuid.uuid4())
                                    for item in items:
                                        item_name = item.get('name', 'Unknown')
                                        quantity = int(item.get('quantity', 1))
                                        unit_price = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                                        item_qty[item_name] += quantity
                                        item_rev[item_name] += unit_price * quantity

                                        # Add-ons/options revenue and attach rate
                                        try:
                                            opts = item.get('generalSelectedOptions') or []
                                            if isinstance(opts, list):
                                                seen_addons_in_order = set()
                                                for opt in opts:
                                                    opt_name = opt.get('name')
                                                    if not opt_name:
                                                        continue
                                                    price_change = float(opt.get('priceChange', 0.0))
                                                    if price_change > 0:
                                                        addon_rev[opt_name] += price_change * quantity
                                                    seen_addons_in_order.add(opt_name)
                                                for opt_name in seen_addons_in_order:
                                                    addon_order_set[opt_name].add(order_no)
                                        except Exception:
                                            pass
                                except (json.JSONDecodeError, KeyError):
                                    pass
                            
                        except (ValueError, KeyError) as e:
                            app.logger.warning(f"Error parsing order row: {e}")
                            continue
            except Exception as e:
                app.logger.warning(f"Error processing CSV file {orders_csv}: {e}")
                continue
        
        average_order_value = total_sales / total_orders if total_orders > 0 else 0
        # Build best and worst sellers by quantity
        best_sellers = [{"name": name, "quantity": qty} for name, qty in item_qty.most_common(10)]
        # For worst, pick bottom 10 among those sold at least once
        worst_candidates = sorted([(name, qty) for name, qty in item_qty.items() if qty > 0], key=lambda x: x[1])[:10]
        worst_sellers = [{"name": n, "quantity": q} for n, q in worst_candidates]

        # Top items by revenue
        top_revenue_items = sorted([{ "name": n, "revenue": r } for n, r in item_rev.items()], key=lambda x: x['revenue'], reverse=True)[:10]

        # Sales by category (revenue)
        def guess_category(item_name: str) -> str:
            n = (item_name or '').lower()
            if any(k in n for k in ['cappuccino','latte','espresso']):
                return 'Coffee'
            if 'tea' in n:
                return 'Tea'
            if any(k in n for k in ['croissant','muffin','pastry']):
                return 'Bakery'
            if any(k in n for k in ['sandwich','toastie','wrap','panini']):
                return 'Food'
            return 'Uncategorized'
        category_rev = defaultdict(float)
        for name, rev in item_rev.items():
            cat = name_to_category.get(name) or guess_category(name)
            category_rev[cat] += rev
        sales_by_category_list = [{"category": c, "total": round(t,2)} for c, t in sorted(category_rev.items(), key=lambda x: x[1], reverse=True)]

        # Dayparts removed

        # Top addons with attach rate
        top_addons = []
        for name, rev in sorted(addon_rev.items(), key=lambda x: x[1], reverse=True)[:10]:
            attach_rate = (len(addon_order_set.get(name, set())) / total_orders) if total_orders > 0 else 0.0
            top_addons.append({"name": name, "revenue": round(rev,2), "attachRate": attach_rate})
        
        # Build frontend-compatible structure
        sales_by_hour_list = [ {"hour": h, "total": round(v,2)} for h,v in sorted(sales_by_hour.items()) ]
        payment_amounts = { 'cash': 0.0, 'card': 0.0 }
        # Re-scan to sum payment amounts for fees/net revenue
        try:
            with open(orders_csv, 'r', newline='', encoding='utf-8') as csvfile2:
                reader2 = csv.DictReader(csvfile2)
                for row in reader2:
                    try:
                        order_date = datetime.strptime(row.get('timestamp') or row.get('Date'), '%Y-%m-%d %H:%M:%S')
                        if start <= order_date < end:
                            amt = float(row.get('order_total') or row.get('Total') or 0.0)
                            pm = (row.get('payment_method') or row.get('Payment Method') or 'Cash').capitalize()
                            if pm == 'Card':
                                payment_amounts['card'] += amt
                            else:
                                payment_amounts['cash'] += amt
                    except Exception:
                        pass
        except Exception:
            pass

        resp = {
            "grossRevenue": round(total_sales, 2),
            "totalOrders": total_orders,
            "atv": round(average_order_value, 2),
            "paymentMethods": {
                "cash": round(payment_amounts['cash'], 2),
                "card": round(payment_amounts['card'], 2)
            },
            "paymentCounts": { key: payment_methods.get(key.capitalize(), 0) for key in ['cash','card'] },
            "salesByHour": sales_by_hour_list,
            
            "salesByCategory": sales_by_category_list,
            "topRevenueItems": top_revenue_items,
            "bestSellers": best_sellers,
            "worstSellers": worst_sellers,
            "topAddons": top_addons
        }
        # total items for items/order
        try:
            total_items = sum(item_qty.values())
        except Exception:
            total_items = 0
        resp["totalItems"] = int(total_items)
        return jsonify(resp)
        
    except Exception as e:
        app.logger.error(f"Error generating analytics: {str(e)}")
        return jsonify({"status": "error", "message": f"Error generating analytics: {str(e)}"}), 500

# --- NEW: Centralized State Management API Endpoints ---

@app.route('/api/state', methods=['GET'])
def get_state():
    """Get current centralized state"""
    try:
        # Clean up inactive sessions first
        cleanup_inactive_sessions()
        
        # Get device ID from request
        device_id = request.args.get('device_id', 'unknown')
        device_info = {
            'user_agent': request.headers.get('User-Agent', 'Unknown'),
            'ip': get_remote_address(),
            'timestamp': datetime.now().isoformat()
        }
        
        # Register/update device session
        if device_id != 'unknown':
            register_device_session(device_id, device_info)
        
        state = load_centralized_state()
        return jsonify({
            "success": True,
            "state": {
                "current_order": state['current_order'],
                "order_line_counter": state['order_line_counter'],
                "universal_comment": state['universal_comment'],
                "selected_table": state['selected_table'],
                "active_devices": len(state['device_sessions'])
            }
        })
    except Exception as e:
        app.logger.error(f"Error getting state: {str(e)}")
        return jsonify({"success": False, "message": f"Error getting state: {str(e)}"}), 500

@app.route('/api/state/current_order', methods=['GET', 'POST'])
def handle_current_order():
    """Get or update current order"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "current_order": state['current_order']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_order = data.get('current_order', [])
            if save_centralized_state('current_order', new_order):
                return jsonify({"success": True, "message": "Current order updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save current order"}), 500
    except Exception as e:
        app.logger.error(f"Error handling current order: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/order_line_counter', methods=['GET', 'POST'])
def handle_order_line_counter():
    """Get or update order line counter"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "order_line_counter": state['order_line_counter']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_counter = data.get('order_line_counter', 0)
            if save_centralized_state('order_line_counter', new_counter):
                return jsonify({"success": True, "message": "Order line counter updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save order line counter"}), 500
    except Exception as e:
        app.logger.error(f"Error handling order line counter: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/universal_comment', methods=['GET', 'POST'])
def handle_universal_comment():
    """Get or update universal comment"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "universal_comment": state['universal_comment']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_comment = data.get('universal_comment', "")
            if save_centralized_state('universal_comment', new_comment):
                return jsonify({"success": True, "message": "Universal comment updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save universal comment"}), 500
    except Exception as e:
        app.logger.error(f"Error handling universal comment: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/selected_table', methods=['GET', 'POST'])
def handle_selected_table():
    """Get or update selected table"""
    try:
        if request.method == 'GET':
            state = load_centralized_state()
            return jsonify({
                "success": True,
                "selected_table": state['selected_table']
            })
        else:  # POST
            data = request.get_json()
            if data is None:
                return jsonify({"success": False, "message": "Invalid JSON data"}), 400
            
            new_table = data.get('selected_table', "")
            if save_centralized_state('selected_table', new_table):
                return jsonify({"success": True, "message": "Selected table updated"})
            else:
                return jsonify({"success": False, "message": "Failed to save selected table"}), 500
    except Exception as e:
        app.logger.error(f"Error handling selected table: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/state/clear_order', methods=['POST'])
def clear_current_order():
    """Clear current order and reset counter"""
    try:
        if save_centralized_state('current_order', []) and save_centralized_state('order_line_counter', 0):
            return jsonify({"success": True, "message": "Current order cleared"})
        else:
            return jsonify({"success": False, "message": "Failed to clear current order"}), 500
    except Exception as e:
        app.logger.error(f"Error clearing current order: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500

@app.route('/api/devices', methods=['GET'])
def get_active_devices():
    """Get list of active devices"""
    try:
        cleanup_inactive_sessions()
        state = load_centralized_state()
        return jsonify({
            "success": True,
            "active_devices": state['device_sessions']
        })
    except Exception as e:
        app.logger.error(f"Error getting active devices: {str(e)}")
        return jsonify({"success": False, "message": f"Error: {str(e)}"}), 500


def check_for_updates():
    """
    Checks for a new release on a public GitHub repository, downloads it,
    and creates a batch script to perform the update.
    Now includes rate limiting to prevent excessive update checks.
    """
    try:
        # Check if we've already checked for updates recently (within 24 hours)
        update_check_file = os.path.join(DATA_DIR, 'last_update_check.json')
        current_time = time.time()
        
        # Read last update check time
        if os.path.exists(update_check_file):
            try:
                with open(update_check_file, 'r') as f:
                    update_data = json.load(f)
                last_check = update_data.get('last_check', 0)
                last_version_checked = update_data.get('last_version_checked', '')
                
                # If we checked within the last 24 hours and it was the same version, skip
                if current_time - last_check < 86400:  # 24 hours in seconds
                    if last_version_checked == CURRENT_VERSION:
                        app.logger.info(f"Update check skipped - already checked within 24 hours for version {CURRENT_VERSION}")
                        return
                        
            except (json.JSONDecodeError, KeyError):
                # If file is corrupted, continue with update check
                pass
        
        app.logger.info("Checking for application updates from public GitHub repository...")

        # This URL points to the latest release of a public repository.
        # No Personal Access Token (PAT) is needed for public repos.
        repo_url = "https://api.github.com/repos/Radot1/POSPal/releases/latest"

        # It's good practice to set a User-Agent header when making API requests.
        headers = {
            "User-Agent": "POSPal-App-Updater/1.0",
            "Accept": "application/vnd.github.v3+json"
        }

        # Make the request to the GitHub API. Added headers and a timeout.
        response = requests.get(repo_url, headers=headers, timeout=15)

        if response.status_code != 200:
            app.logger.error(f"Update check failed: GitHub API returned HTTP {response.status_code}. Response: {response.text}")
            # Still record the check attempt to prevent immediate retries
            _record_update_check(current_time, CURRENT_VERSION)
            return

        latest_release_data = response.json()
        latest_ver = latest_release_data.get('tag_name')

        if not latest_ver:
            app.logger.error("Update check failed: Could not find 'tag_name' in the API response.")
            # Still record the check attempt
            _record_update_check(current_time, CURRENT_VERSION)
            return

        # Record this successful update check
        _record_update_check(current_time, CURRENT_VERSION, latest_ver)

        app.logger.info(f"Current version: {CURRENT_VERSION}, Latest version from GitHub: {latest_ver}")

        # Update only if GitHub version is strictly newer; never downgrade or lateral update.
        if is_version_newer(latest_ver, CURRENT_VERSION):
            app.logger.info(f"New version {latest_ver} found. Starting update process.")

            # Find the correct asset to download from the release.
            assets = latest_release_data.get('assets', [])
            download_url = ""
            # The asset should be the main executable file.
            expected_asset_name = os.path.basename(sys.executable) # e.g., "POSPal.exe"
            
            for asset in assets:
                if asset.get('name') == expected_asset_name:
                    download_url = asset.get('browser_download_url')
                    break

            if not download_url:
                app.logger.error(f"Could not find '{expected_asset_name}' in the latest release assets.")
                return

            app.logger.info(f"Downloading new executable from: {download_url}")
            # Use a longer timeout for the download itself.
            new_exe_response = requests.get(download_url, timeout=300)
            new_exe_response.raise_for_status()  # Raise an exception for 4xx/5xx responses

            # HARDENED: save to updates dir, compute hash, write robust update.bat
            updates_dir = os.path.join(os.environ.get('LOCALAPPDATA', BASE_DIR), 'POSPal', 'updates')
            try:
                os.makedirs(updates_dir, exist_ok=True)
            except Exception:
                updates_dir = BASE_DIR
                app.logger.warning(f"Falling back to BASE_DIR for updates. Using: {updates_dir}")

            new_exe_path = os.path.join(updates_dir, os.path.basename(sys.executable))
            with open(new_exe_path, "wb") as f:
                f.write(new_exe_response.content)
            sha256_hex = hashlib.sha256(new_exe_response.content).hexdigest()
            app.logger.info(f"New executable saved to {new_exe_path} (SHA256={sha256_hex})")

            update_script_path = os.path.join(BASE_DIR, "update.bat")
            with open(update_script_path, "w") as bat:
                bat.write(fr"""@echo off
setlocal
cd /d "%~dp0"
echo Updating POSPal... Please wait.

set "ORIGINAL_DIR=%~dp0"
set "NEW_EXE={new_exe_path}"
set "TARGET_EXE=%ORIGINAL_DIR%{expected_asset_name}"
set "BACKUP_EXE=%ORIGINAL_DIR%{expected_asset_name}.backup"

if not exist "%NEW_EXE%" (
    echo ERROR: New executable not found at %NEW_EXE%
    pause
    exit /b 1
)

echo Unblocking downloaded file...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Try {{ Unblock-File -LiteralPath '%NEW_EXE%' }} Catch {{}}" >nul 2>&1

echo Stopping POSPal processes...
taskkill /f /im "{expected_asset_name}" >nul 2>&1
taskkill /f /im "python.exe" /fi "WINDOWTITLE eq POSPal*" >nul 2>&1

echo Waiting for processes to terminate...
timeout /t 5 /nobreak >nul

rem Try multiple times to ensure process is really dead
for /L %%i in (1,1,3) do (
    tasklist /fi "IMAGENAME eq {expected_asset_name}" 2>nul | find /i "{expected_asset_name}" >nul
    if not errorlevel 1 (
        echo Process still running, force killing attempt %%i...
        taskkill /f /im "{expected_asset_name}" >nul 2>&1
        timeout /t 2 /nobreak >nul
    )
)

echo Backing up current version...
if exist "%TARGET_EXE%" (
    copy /y "%TARGET_EXE%" "%BACKUP_EXE%"
    if %errorlevel% neq 0 (
        echo WARNING: Failed to create backup
    )
)

echo Installing new version...
rem Try to delete the old file first
if exist "%TARGET_EXE%" (
    del "%TARGET_EXE%" >nul 2>&1
)

rem Copy new version
copy /y "%NEW_EXE%" "%TARGET_EXE%"
if %errorlevel% neq 0 (
    echo ERROR: Failed to copy new executable
    echo Source: %NEW_EXE%
    echo Target: %TARGET_EXE%
    echo Attempting to restore backup...
    if exist "%BACKUP_EXE%" (
        copy /y "%BACKUP_EXE%" "%TARGET_EXE%" >nul 2>&1
        if %errorlevel% neq 0 (
            echo CRITICAL: Failed to restore backup!
        ) else (
            echo Backup restored successfully
        )
    )
    pause
    exit /b 1
)

echo Verifying installation...
if not exist "%TARGET_EXE%" (
    echo ERROR: New executable not found after copy!
    if exist "%BACKUP_EXE%" (
        echo Restoring backup...
        copy /y "%BACKUP_EXE%" "%TARGET_EXE%" >nul 2>&1
    )
    pause
    exit /b 1
)

echo Cleaning up backup...
if exist "%BACKUP_EXE%" del "%BACKUP_EXE%" >nul 2>&1

echo Starting updated POSPal...
cd /d "%ORIGINAL_DIR%"
start "" "%TARGET_EXE%"

echo Update completed successfully!
timeout /t 2 /nobreak >nul

(goto) 2>nul & del "%~f0" & exit
""")

            app.logger.info(f"Update script created at {update_script_path}")

            # Execute the update script in a new, detached process.
            os.system(f'start /B "" "{update_script_path}"')
            app.logger.info("Update script launched. The application will now exit to allow the update.")

            # Exit the current application.
            os._exit(0)
        else:
            app.logger.info("POSPal is up to date.")
            
    except requests.exceptions.RequestException as e:
        app.logger.error(f"Update check failed due to a network error: {str(e)}")
    except Exception as e:
        app.logger.error(f"An unexpected error occurred during the update check: {str(e)}")


def _record_update_check(timestamp, current_version, latest_version=None):
    """Record when we last checked for updates to prevent excessive checking."""
    try:
        update_check_file = os.path.join(DATA_DIR, 'last_update_check.json')
        os.makedirs(DATA_DIR, exist_ok=True)
        
        update_data = {
            'last_check': timestamp,
            'last_version_checked': current_version,
            'check_timestamp': datetime.fromtimestamp(timestamp).isoformat()
        }
        
        if latest_version:
            update_data['latest_version_found'] = latest_version
            
        with open(update_check_file, 'w') as f:
            json.dump(update_data, f, indent=2)
            
    except Exception as e:
        app.logger.warning(f"Could not record update check: {e}")


# Open default browser to the local UI once the server is reachable
def _open_browser_when_ready():
    try:
        port = int(config.get('port', 5000))
        url = f"http://127.0.0.1:{port}/"
        deadline = time.time() + 20
        while time.time() < deadline:
            try:
                # Probe the server; it may not be ready immediately
                requests.get(url, timeout=0.5)
                break
            except Exception:
                time.sleep(0.3)
        try:
            webbrowser.open(url, new=1)
        except Exception:
            pass
    except Exception as e:
        try:
            app.logger.warning(f"Failed to auto-open browser: {e}")
        except Exception:
            pass

# Add to startup logic (always check for updates when running as packaged executable)
if getattr(sys, 'frozen', False):
    # Check for updates once, 5 seconds after startup
    update_timer = threading.Timer(5, check_for_updates)
    update_timer.daemon = True  # Make it a daemon thread so it won't prevent shutdown
    update_timer.start()

if __name__ == '__main__':
    # Ensure single instance with retry mechanism
    startup_success = False
    max_startup_attempts = 2
    
    for startup_attempt in range(max_startup_attempts):
        try:
            # Ensure single instance
            if not acquire_single_instance_lock():
                if startup_attempt < max_startup_attempts - 1:
                    logging.warning(f"Startup attempt {startup_attempt + 1} failed, retrying in 2 seconds...")
                    time.sleep(2)
                    continue
                else:
                    logging.error("Failed to acquire single instance lock after all attempts. Another instance may be running.")
                    sys.exit(1)

            initialize_trial()
            # Log the data directory that was found
            app.logger.info(f"POSPal startup: Using data directory: {DATA_DIR}")
            app.logger.info(f"POSPal startup: Menu file path: {MENU_FILE}")
            app.logger.info(f"POSPal startup: Menu file exists: {os.path.exists(MENU_FILE)}")
            
            # Verify we can write to DATA_DIR
            try:
                test_file = os.path.join(DATA_DIR, 'permission_test.tmp')
                with open(test_file, 'w') as f:
                    f.write('test')
                os.remove(test_file)
            except Exception as e:
                app.logger.critical(f"CRITICAL: Cannot write to data directory: {DATA_DIR}. Error: {str(e)}")
                # In a real GUI app, you'd show a message box here.
                # For now, we exit with an error code.
                sys.exit(f"Error: Insufficient permissions to write to the data directory: {DATA_DIR}")
            
            # Setup Windows Firewall rule for network access
            firewall_success, firewall_msg = _setup_windows_firewall_rule()
            if firewall_success:
                app.logger.info(f"Firewall setup: {firewall_msg}")
            else:
                app.logger.warning(f"Firewall setup failed: {firewall_msg}")
                app.logger.warning("Users on other devices may not be able to connect. Run as Administrator or manually create firewall rule.")
            
            startup_success = True
            break
            
        except Exception as e:
            logging.error(f"Startup attempt {startup_attempt + 1} failed with error: {e}")
            if startup_attempt < max_startup_attempts - 1:
                logging.warning("Retrying startup in 2 seconds...")
                time.sleep(2)
            else:
                logging.error("All startup attempts failed.")
                sys.exit(1)
    
    if not startup_success:
        logging.error("Application failed to start properly.")
        sys.exit(1)
        
    from waitress import serve
    port = config.get('port', 5000)
    app.logger.info(f"Starting POSPal Server v{CURRENT_VERSION} on http://0.0.0.0:{port}")
    
    # Enhanced network information for mobile connection troubleshooting
    try:
        import socket
        hostname = socket.gethostname()
        
        # Get all possible IP addresses
        try:
            # Try to get the actual network IP by connecting to external address
            temp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            temp_socket.connect(("8.8.8.8", 80))
            primary_ip = temp_socket.getsockname()[0]
            temp_socket.close()
        except:
            primary_ip = socket.gethostbyname(hostname)
        
        app.logger.info(f"=== MOBILE CONNECTION INFO ===")
        app.logger.info(f"Primary IP: {primary_ip}")
        app.logger.info(f"Hostname: {hostname}")
        app.logger.info(f"Port: {port}")
        app.logger.info(f"")
        app.logger.info(f"🔗 MOBILE DEVICES CONNECT TO:")
        app.logger.info(f"   http://{primary_ip}:{port}")
        app.logger.info(f"")
        app.logger.info(f"📱 TROUBLESHOOTING STEPS:")
        app.logger.info(f"   1. Ensure mobile device is on same WiFi network")
        app.logger.info(f"   2. Check Windows Firewall allows port {port}")
        app.logger.info(f"   3. Try running POSPal as Administrator")
        app.logger.info(f"   4. Alternative IPs to try:")
        
        # List alternative IP addresses
        try:
            import subprocess
            result = subprocess.run(['ipconfig'], capture_output=True, text=True, shell=True, creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode == 0:
                lines = result.stdout.split('\n')
                for i, line in enumerate(lines):
                    if 'IPv4 Address' in line and '192.168.' in line or '10.' in line or '172.' in line:
                        ip = line.split(':')[-1].strip()
                        if ip != primary_ip:
                            app.logger.info(f"      http://{ip}:{port}")
        except:
            pass
        
        # Test if port is actually bindable
        test_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        test_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            test_socket.bind(('0.0.0.0', port))
            test_socket.close()
            app.logger.info(f"✅ Port {port} is available for binding")
        except Exception as e:
            app.logger.error(f"❌ Port {port} binding test failed: {e}")
            app.logger.error(f"   This will prevent mobile connections!")
        
        app.logger.info(f"==============================")
    except Exception as e:
        app.logger.warning(f"Network diagnostics failed: {e}")
    # For end-users: auto-open the local UI in the default browser when packaged
    if getattr(sys, 'frozen', False):
        threading.Thread(target=_open_browser_when_ready, daemon=True).start()
    
    # Start Waitress server with graceful shutdown capability
    try:
        app.logger.info("Starting Waitress server with graceful shutdown support...")
        serve(app, host='0.0.0.0', port=config.get('port', 5000))
    except KeyboardInterrupt:
        app.logger.info("KeyboardInterrupt received, shutting down gracefully...")
        shutdown_server()
    except Exception as e:
        app.logger.error(f"Server error: {e}")
        shutdown_server()
