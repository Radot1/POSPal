CURRENT_VERSION = "1.2.1"  # Update this with each release - Fixed customer issues: license validation, menu structure, analytics, mobile connection

from flask import Flask, request, jsonify, send_from_directory, Response
from werkzeug.http import http_date
from datetime import datetime, timedelta, date
import csv
import os
from decimal import Decimal, ROUND_HALF_UP
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
import copy
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

# Global subprocess configuration: Run all subprocesses silently (no CMD windows)
# This ensures a professional appearance on Windows
if os.name == 'nt':  # Windows only
    # Set default creation flags for ALL subprocess calls
    subprocess._USE_VFORK = False  # Prevent fork behavior
    _original_Popen = subprocess.Popen

    def _silent_Popen(*args, **kwargs):
        """Wrapper to ensure all subprocess calls run without showing CMD windows"""
        if 'creationflags' not in kwargs:
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        else:
            # Ensure CREATE_NO_WINDOW is always included
            kwargs['creationflags'] |= subprocess.CREATE_NO_WINDOW
        return _original_Popen(*args, **kwargs)

    subprocess.Popen = _silent_Popen

app = Flask(__name__)

@app.after_request
def enforce_utf8_charset(response):
    content_type = response.headers.get('Content-Type', '')
    if content_type.startswith('text/') and 'charset=' not in content_type.lower():
        base_type = content_type.split(';', 1)[0]
        response.headers['Content-Type'] = f'{base_type}; charset=utf-8'
    return response

# --- Prevent browser caching of JavaScript/HTML files ---
@app.after_request
def add_no_cache_headers(response):
    """
    Prevent browser caching of dynamic files (JS, HTML, CSS).
    This ensures users always get the latest version after rebuilds.
    Critical for table management real-time updates to work correctly.
    """
    if request.path.endswith(('.js', '.html', '.css')):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

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

# --- Global hardware ID cache (calculated once at startup to prevent blocking) ---
_cached_hardware_id: str | None = None
_business_identity_cache = None

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


def _broadcast_license_status(payload: dict, source: str = "unknown"):
    """Broadcast license status updates to SSE subscribers."""
    if not isinstance(payload, dict):
        return
    enriched_payload = copy.deepcopy(payload)
    enriched_payload.setdefault("_emitted_at", datetime.now().isoformat())
    enriched_payload.setdefault("_broadcast_source", source)
    try:
        _sse_broadcast('license_status_update', enriched_payload)
    except Exception as exc:
        app.logger.warning(f"Failed to broadcast license status update: {exc}")


def load_business_profile_data():
    profile = {}
    if os.path.exists(BUSINESS_PROFILE_FILE):
        try:
            with open(BUSINESS_PROFILE_FILE, 'r', encoding='utf-8') as profile_file:
                data = json.load(profile_file)
            if isinstance(data, dict):
                for key in BUSINESS_PROFILE_FIELDS:
                    value = data.get(key, '')
                    if isinstance(value, str):
                        profile[key] = value
                if data.get('updated_at'):
                    profile['updated_at'] = data.get('updated_at')
        except Exception as exc:
            app.logger.warning(f"Failed to load business profile from {BUSINESS_PROFILE_FILE}: {exc}")
    return profile


def save_business_profile_data(update_data):
    existing = load_business_profile_data()
    base_profile = {key: existing.get(key, '') for key in BUSINESS_PROFILE_FIELDS}
    for key in BUSINESS_PROFILE_FIELDS:
        if key in update_data:
            value = update_data.get(key)
            if value is None:
                base_profile[key] = ''
            else:
                base_profile[key] = str(value).strip()

    os.makedirs(DATA_DIR, exist_ok=True)
    profile_to_store = dict(base_profile)
    profile_to_store['updated_at'] = datetime.now().isoformat()

    with open(BUSINESS_PROFILE_FILE, 'w', encoding='utf-8') as profile_file:
        json.dump(profile_to_store, profile_file, indent=2, ensure_ascii=False)

    global _business_identity_cache
    _business_identity_cache = None
    return profile_to_store


def get_business_identity():
    """Load business identity details for receipts from cache, JSON profile, or environment variables."""
    global _business_identity_cache
    if _business_identity_cache is not None:
        return dict(_business_identity_cache)

    identity: dict[str, str] = {}

    profile_data = load_business_profile_data()
    if profile_data:
        for key in BUSINESS_PROFILE_FIELDS:
            value = profile_data.get(key)
            if isinstance(value, str) and value.strip():
                identity[key] = value.strip()

    for key, env_keys in BUSINESS_PROFILE_ENV_MAP.items():
        if key in identity:
            continue
        for env_key in env_keys:
            value = os.environ.get(env_key)
            if value and value.strip():
                identity[key] = value.strip()
                break

    _business_identity_cache = dict(identity)
    return dict(identity)
# --- Cleanup handler for proper shutdown ---
def _cleanup_on_exit():
    """Cleanup function called when the process exits normally or abnormally"""
    try:
        _sse_subscribers.clear()
        # Ensure lock is released during cleanup
        release_single_instance_lock()
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

# Add file-based logging for built executables (no console available)
# This allows debugging of PyInstaller builds by reading data/pospal_debug.log
try:
    log_file = os.path.join(DATA_DIR, 'pospal_debug.log')
    file_handler = logging.FileHandler(log_file, mode='a', encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s'))
    logging.getLogger().addHandler(file_handler)
    logging.info(f"File-based logging enabled: {log_file}")
except Exception as e:
    logging.warning(f"Could not set up file logging: {e}")

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

# --- License Integration System ---
# Initialize unified license controller integration
try:
    from license_integration import initialize_license_integration, get_license_status_integrated, validate_license_integrated
    # Global flag to track integration status
    UNIFIED_LICENSES_ENABLED = True
    app.logger.info("License integration system available")
except ImportError as e:
    app.logger.critical(f"Unified license system not available: {e}")
    UNIFIED_LICENSES_ENABLED = False

    def get_license_status_integrated(force_refresh=False):
        raise RuntimeError("Unified license system not available")

    def validate_license_integrated(customer_email, unlock_token, hardware_id=None):
        return {
            "licensed": False,
            "active": False,
            "message": "Unified license system not available",
            "_unified_system": False,
            "cloud_validation": False,
        }

# License cache constants for hybrid cloud-first validation
LICENSE_CACHE_FILE = os.path.join(DATA_DIR, 'license_cache.enc')
LICENSE_CACHE_BACKUP = os.path.join(PROGRAM_DATA_DIR, 'license_cache.enc')
GRACE_PERIOD_DAYS = 10  # Days allowed offline after last successful validation
CLOUD_VALIDATION_TIMEOUT = 3  # Seconds to wait for cloud validation response
CLOUD_FAILURE_BACKOFF_SECONDS = 60  # How long to skip cloud validation after a failure
CLOUD_VALIDATION_CACHE_SECONDS = 30  # Minimum seconds between cloud calls when local cache is still fresh
LICENSE_STATUS_CACHE_TTL_SECONDS = 30  # TTL for cached /api/license/status responses

# Track recent cloud validation failures to avoid repeated blocking calls when offline
_last_cloud_failure = {"timestamp": None, "error": None}

# Ensure we never run more than one outbound cloud validation at a time
_cloud_validation_lock = threading.Lock()


class LicenseStatusCoordinator:
    """Coordinate cached server license status responses and background refreshes."""

    def __init__(self, compute_callable, ttl_seconds=LICENSE_STATUS_CACHE_TTL_SECONDS):
        self._compute_callable = compute_callable
        self._ttl_seconds = ttl_seconds
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._cached_payload: dict | None = None
        self._cached_timestamp: datetime | None = None
        self._refresh_in_progress = False

    def _age_seconds(self) -> float | None:
        if not self._cached_timestamp:
            return None
        return (datetime.now() - self._cached_timestamp).total_seconds()

    def _is_fresh(self) -> bool:
        age = self._age_seconds()
        return age is not None and age < self._ttl_seconds

    def invalidate(self):
        with self._condition:
            self._cached_payload = None
            self._cached_timestamp = None
            self._condition.notify_all()

    def _update_cache(self, payload: dict | None):
        with self._condition:
            if payload is not None:
                self._cached_payload = copy.deepcopy(payload)
                self._cached_timestamp = datetime.now()
            else:
                self._cached_payload = None
                self._cached_timestamp = None
            self._condition.notify_all()

    def _background_refresh(self):
        try:
            payload = self._compute_callable(force_refresh=True)
            if payload is not None:
                _broadcast_license_status(payload, source="background_refresh")
                self._update_cache(payload)
        except Exception as exc:
            app.logger.error(f"Background license status refresh failed: {exc}")
        finally:
            with self._condition:
                self._refresh_in_progress = False
                self._condition.notify_all()

    def get_status(self, force_refresh: bool = False) -> tuple[dict | None, bool]:
        """
        Return (payload, served_from_cache).
        If force_refresh is False and cache is warm, returns cached immediately and triggers async refresh when stale.
        """
        with self._condition:
            if not force_refresh and self._cached_payload and self._is_fresh():
                return copy.deepcopy(self._cached_payload), True

            if not force_refresh and self._cached_payload and not self._refresh_in_progress:
                # Cache is present but stale; return it immediately and refresh asynchronously.
                self._refresh_in_progress = True
                threading.Thread(target=self._background_refresh, daemon=True).start()
                return copy.deepcopy(self._cached_payload), True

            # At this point we either have no cache, or a refresh is requested.
            while self._refresh_in_progress:
                self._condition.wait(timeout=5)
                if not force_refresh and self._cached_payload and self._is_fresh():
                    return copy.deepcopy(self._cached_payload), True

            self._refresh_in_progress = True

        try:
            payload = self._compute_callable(force_refresh=True)
            if payload is not None:
                _broadcast_license_status(payload, source="direct_refresh")
            self._update_cache(payload)
            return copy.deepcopy(payload) if payload is not None else None, False
        except Exception as exc:
            app.logger.error(f"Unable to compute license status payload: {exc}")
            with self._condition:
                self._refresh_in_progress = False
                self._condition.notify_all()
            return (copy.deepcopy(self._cached_payload) if self._cached_payload else None), True
        finally:
            with self._condition:
                self._refresh_in_progress = False
                self._condition.notify_all()


def _record_cloud_failure(error_message: str | None = None) -> None:
    """Remember the most recent cloud validation failure."""
    _last_cloud_failure["timestamp"] = datetime.now()
    _last_cloud_failure["error"] = error_message or "Cloud validation failed"


def _clear_cloud_failure() -> None:
    """Clear the cached cloud failure state after a successful validation."""
    _last_cloud_failure["timestamp"] = None
    _last_cloud_failure["error"] = None


def _should_skip_cloud_validation() -> bool:
    """Return True when recent cloud validation failed and we should back off temporarily."""
    last_failure = _last_cloud_failure.get("timestamp")
    if not last_failure:
        return False

    elapsed = (datetime.now() - last_failure).total_seconds()
    return elapsed < CLOUD_FAILURE_BACKOFF_SECONDS

# Server-side license storage (NEW: Multi-device support)
SERVER_LICENSE_FILE = os.path.join(DATA_DIR, 'server_license.enc')
SERVER_LICENSE_BACKUP = os.path.join(PROGRAM_DATA_DIR, 'server_license.enc')

# --- Migration Controller for Backend Systems ---
# Environment variable to control migration rollout
ENABLE_BACKEND_MIGRATION = os.environ.get('POSPAL_ENABLE_BACKEND_MIGRATION', 'true').lower() == 'true'

def _unified_inactive_status(context: str, message: str, error: Exception | str | None = None) -> dict:
    """Return a standardized inactive payload when unified licensing is unavailable."""
    payload = {
        'licensed': False,
        'active': False,
        'expired': True,
        'source': 'unified_inactive',
        'message': message,
        '_migration_path': 'unified_only',
        '_context': context,
    }
    if error:
        payload['_error'] = str(error)
    return payload

def get_license_status_safe(force_refresh=False, context="general"):
    """
    Safe license status getter with migration support
    
    This function provides a seamless transition from legacy check_trial_status()
    to the unified license controller system with automatic fallback protection.
    
    Args:
        force_refresh: Force refresh of license data
        context: Context for logging/debugging purposes
        
    Returns:
        Dict containing license status in legacy-compatible format
    """
    try:
        # Log context for migration tracking
        if context != "general":
            app.logger.debug(f"License check from context: {context}")

        if not UNIFIED_LICENSES_ENABLED:
            app.logger.error(f"Unified license system disabled for context '{context}'")
            return _unified_inactive_status(context, "Unified license system disabled")

        if not ENABLE_BACKEND_MIGRATION:
            app.logger.info("Backend migration flag disabled - proceeding with unified system only")

        unified_status = get_license_status_integrated(force_refresh)

        if isinstance(unified_status, dict):
            unified_status['_migration_path'] = 'unified_only'
            unified_status['_context'] = context

        return unified_status

    except Exception as e:
        app.logger.error(f"Critical license system error in context '{context}': {e}")
        return _unified_inactive_status(context, 'License system critical error', e)

# --- Unified License Status Function ---
def get_license_status_unified(force_refresh=False, use_legacy=None):
    """
    Get license status using unified system with fallback to legacy
    
    Args:
        force_refresh: Force refresh of license data
        use_legacy: Override system selection (None = auto-detect, True = legacy, False = unified)
        
    Returns:
        Dict containing license status in legacy format
    """
    if not UNIFIED_LICENSES_ENABLED:
        app.logger.error("Unified license system disabled - returning inactive status")
        return _unified_inactive_status('get_license_status_unified', "Unified license system disabled")

    if use_legacy:
        app.logger.warning("Legacy license path requested but is no longer supported - returning inactive status")
        return _unified_inactive_status('get_license_status_unified', "Legacy licensing is not supported")

    try:
        status = get_license_status_integrated(force_refresh)
        if isinstance(status, dict):
            status['_migration_path'] = 'unified_only'
            status['_context'] = 'get_license_status_unified'
        return status
    except Exception as e:
        app.logger.error(f"Unified license system error: {e}")
        return _unified_inactive_status('get_license_status_unified', 'Unified license system error', e)

MENU_FILE = os.path.join(DATA_DIR, 'menu.json')
ORDER_COUNTER_FILE = os.path.join(DATA_DIR, 'order_counter.json')
ORDER_COUNTER_LOCK_FILE = os.path.join(DATA_DIR, 'order_counter.lock') # Lock file for order counter
CONFIG_FILE_OLD = os.path.join(BASE_DIR, 'config.json')
CONFIG_FILE = os.path.join(DATA_DIR, 'config.json')
BUSINESS_PROFILE_FILE = os.path.join(DATA_DIR, 'business_profile.json')
BUSINESS_PROFILE_FIELDS = ('name', 'address', 'phone', 'email', 'website', 'tax_id', 'footer')
BUSINESS_PROFILE_ENV_MAP = {
    'name': ['POSPAL_BUSINESS_NAME', 'BUSINESS_NAME'],
    'address': ['POSPAL_BUSINESS_ADDRESS', 'BUSINESS_ADDRESS'],
    'phone': ['POSPAL_BUSINESS_PHONE', 'BUSINESS_PHONE'],
    'email': ['POSPAL_BUSINESS_EMAIL', 'BUSINESS_EMAIL'],
    'website': ['POSPAL_BUSINESS_WEBSITE', 'BUSINESS_WEBSITE'],
    'tax_id': ['POSPAL_BUSINESS_TAX_ID', 'BUSINESS_TAX_ID', 'ABN', 'VAT_NUMBER'],
    'footer': ['POSPAL_BUSINESS_FOOTER', 'BUSINESS_FOOTER']
}

# --- NEW: Centralized State Management Files ---
CURRENT_ORDER_FILE = os.path.join(DATA_DIR, 'current_order.json')
ORDER_LINE_COUNTER_FILE = os.path.join(DATA_DIR, 'order_line_counter.json')
UNIVERSAL_COMMENT_FILE = os.path.join(DATA_DIR, 'universal_comment.json')
SELECTED_TABLE_FILE = os.path.join(DATA_DIR, 'selected_table.json')
DEVICE_SESSIONS_FILE = os.path.join(DATA_DIR, 'device_sessions.json')
USAGE_ANALYTICS_FILE = os.path.join(DATA_DIR, 'usage_analytics.json')

# --- Cloudflare Worker API Integration ---
CLOUDFLARE_WORKER_URL = "https://pospal-licensing-v2-production.bzoumboulis.workers.dev"

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

# --- Enhanced Table Management Validation & Error Handling ---

def validate_table_id(table_id):
    """Validate table ID format"""
    if not table_id:
        return False, "Table ID is required"

    table_id_str = str(table_id).strip()
    if not table_id_str:
        return False, "Table ID cannot be empty"

    if len(table_id_str) > 50:
        return False, "Table ID must be 50 characters or less"

    # Allow alphanumeric, underscores, hyphens, and spaces
    if not all(c.isalnum() or c in '_- ' for c in table_id_str):
        return False, "Table ID can only contain letters, numbers, spaces, underscores, and hyphens"

    return True, table_id_str

def validate_table_name(name, existing_tables=None, exclude_table_id=None):
    """Validate table name"""
    if not name:
        return False, "Table name is required"

    name_str = str(name).strip()
    if not name_str:
        return False, "Table name cannot be empty"

    if len(name_str) > 100:
        return False, "Table name must be 100 characters or less"

    # Sanitize the name
    sanitized_name = sanitize_string_input(name_str, 100)
    if not sanitized_name:
        return False, "Table name contains invalid characters"

    # Check for uniqueness if existing tables provided
    if existing_tables:
        for table_id, table_info in existing_tables.items():
            if exclude_table_id and table_id == exclude_table_id:
                continue
            if table_info.get("name", "").lower() == sanitized_name.lower():
                return False, f"Table name '{sanitized_name}' already exists"

    return True, sanitized_name

def validate_party_size(party_size):
    """Validate party size parameter"""
    if party_size is None:
        return False, "Party size is required"

    try:
        size = int(party_size)
        if size < 1:
            return False, "Party size must be at least 1"
        if size > 50:
            return False, "Party size cannot exceed 50"
        return True, size
    except (ValueError, TypeError):
        return False, "Party size must be a valid number"

def validate_table_seats(seats):
    """Validate table seat count"""
    if seats is None:
        return False, "Seat count is required"

    try:
        seat_count = int(seats)
        if seat_count < 1:
            return False, "Seat count must be at least 1"
        if seat_count > 100:
            return False, "Seat count cannot exceed 100"
        return True, seat_count
    except (ValueError, TypeError):
        return False, "Seat count must be a valid number"

def validate_payment_amount(amount):
    """Validate payment amount"""
    if amount is None:
        return False, "Payment amount is required"

    try:
        payment = float(amount)
        if payment < 0:
            return False, "Payment amount cannot be negative"
        if payment > 999999.99:
            return False, "Payment amount too large (max $999,999.99)"
        return True, round(payment, 2)
    except (ValueError, TypeError):
        return False, "Payment amount must be a valid number"

def validate_table_status(status):
    """Validate table status"""
    valid_statuses = ["available", "occupied", "reserved", "out_of_order"]

    if not status:
        return False, "Table status is required"

    status_str = str(status).strip().lower()
    if status_str not in valid_statuses:
        return False, f"Invalid status. Must be one of: {', '.join(valid_statuses)}"

    return True, status_str

def sanitize_table_notes(notes):
    """Sanitize table notes/comments"""
    if not notes:
        return ""

    notes_str = str(notes).strip()
    # Limit notes to reasonable length
    sanitized = sanitize_string_input(notes_str, 500)

    # Remove potential script injection
    if sanitized:
        # Remove HTML/script tags
        import re
        sanitized = re.sub(r'<[^>]*>', '', sanitized)
        # Remove potential SQL injection patterns
        sanitized = re.sub(r'[;\'"\\]', '', sanitized)

    return sanitized or ""

def validate_json_structure(data, required_fields=None, optional_fields=None):
    """Validate JSON structure for table operations"""
    if not isinstance(data, dict):
        return False, "Request body must be a JSON object"

    if required_fields:
        for field in required_fields:
            if field not in data:
                return False, f"Required field '{field}' is missing"

    # Check for unexpected fields if both required and optional are specified
    if required_fields is not None and optional_fields is not None:
        allowed_fields = set(required_fields) | set(optional_fields)
        unexpected_fields = set(data.keys()) - allowed_fields
        if unexpected_fields:
            return False, f"Unexpected fields: {', '.join(unexpected_fields)}"

    return True, "Valid JSON structure"

def safe_file_operation(operation, *args, **kwargs):
    """Safely execute file operations with retry and error handling"""
    import time
    max_retries = 3
    retry_delay = 0.1

    for attempt in range(max_retries):
        try:
            return operation(*args, **kwargs)
        except (OSError, IOError) as e:
            if attempt == max_retries - 1:
                app.logger.error(f"File operation failed after {max_retries} attempts: {e}")
                raise
            app.logger.warning(f"File operation attempt {attempt + 1} failed, retrying: {e}")
            time.sleep(retry_delay * (attempt + 1))
        except Exception as e:
            app.logger.error(f"Unexpected error in file operation: {e}")
            raise

def validate_table_session_data(session_data):
    """Validate table session data integrity"""
    if not isinstance(session_data, dict):
        return False, "Session data must be a dictionary"

    required_fields = ["order_numbers", "total_amount", "amount_paid"]
    for field in required_fields:
        if field not in session_data:
            return False, f"Session missing required field: {field}"

    # Validate order numbers
    order_numbers = session_data.get("order_numbers", [])
    if not isinstance(order_numbers, list):
        return False, "Order numbers must be a list"

    # Validate amounts
    try:
        total_amount = float(session_data.get("total_amount", 0))
        amount_paid = float(session_data.get("amount_paid", 0))

        if total_amount < 0 or amount_paid < 0:
            return False, "Amounts cannot be negative"

        if amount_paid > total_amount + 0.01:  # Allow for small rounding differences
            return False, "Amount paid cannot exceed total amount"

    except (ValueError, TypeError):
        return False, "Invalid amount format in session data"

    return True, "Valid session data"

def check_data_file_integrity():
    """Check integrity of table management data files"""
    integrity_report = {
        "tables_config": {"status": "ok", "issues": []},
        "table_sessions": {"status": "ok", "issues": []},
        "table_history": {"status": "ok", "issues": []}
    }

    # Check tables configuration
    try:
        tables_config = load_tables_config()
        if not isinstance(tables_config, dict):
            integrity_report["tables_config"]["status"] = "corrupted"
            integrity_report["tables_config"]["issues"].append("Invalid JSON structure")
        elif "tables" in tables_config:
            tables = tables_config["tables"]
            if not isinstance(tables, dict):
                integrity_report["tables_config"]["status"] = "corrupted"
                integrity_report["tables_config"]["issues"].append("Tables section is not a dictionary")
            else:
                # Validate each table
                for table_id, table_data in tables.items():
                    if not isinstance(table_data, dict):
                        integrity_report["tables_config"]["issues"].append(f"Table {table_id} has invalid data structure")
                    elif "name" not in table_data or "seats" not in table_data:
                        integrity_report["tables_config"]["issues"].append(f"Table {table_id} missing required fields")
    except Exception as e:
        integrity_report["tables_config"]["status"] = "error"
        integrity_report["tables_config"]["issues"].append(str(e))

    # Check table sessions
    try:
        table_sessions = load_table_sessions()
        if not isinstance(table_sessions, dict):
            integrity_report["table_sessions"]["status"] = "corrupted"
            integrity_report["table_sessions"]["issues"].append("Invalid JSON structure")
        else:
            # Validate each session
            for table_id, session_data in table_sessions.items():
                is_valid, error_msg = validate_table_session_data(session_data)
                if not is_valid:
                    integrity_report["table_sessions"]["issues"].append(f"Table {table_id}: {error_msg}")
    except Exception as e:
        integrity_report["table_sessions"]["status"] = "error"
        integrity_report["table_sessions"]["issues"].append(str(e))

    # Update overall status
    for file_report in integrity_report.values():
        if file_report["issues"]:
            file_report["status"] = "issues_found"

    return integrity_report

# --- Security & Rate Limiting for Table Operations ---

_table_operation_counters = defaultdict(lambda: {"count": 0, "last_reset": time.time()})
_table_operation_lock = threading.Lock()

def check_rate_limit(client_identifier, operation_type, max_requests=60, window_seconds=60):
    """Check rate limit for table operations"""
    current_time = time.time()

    with _table_operation_lock:
        key = f"{client_identifier}:{operation_type}"
        counter_data = _table_operation_counters[key]

        # Reset counter if window has passed
        if current_time - counter_data["last_reset"] > window_seconds:
            counter_data["count"] = 0
            counter_data["last_reset"] = current_time

        # Check limit
        if counter_data["count"] >= max_requests:
            return False, f"Rate limit exceeded for {operation_type}. Max {max_requests} requests per {window_seconds} seconds."

        # Increment counter
        counter_data["count"] += 1
        return True, "OK"

def get_client_identifier(request):
    """Get client identifier for rate limiting"""
    # Use X-Forwarded-For if available (proxy), otherwise remote_addr
    return request.headers.get('X-Forwarded-For', request.remote_addr) or 'unknown'

def log_table_operation(operation, table_id, user_info=None, details=None):
    """Log table operations for audit trail"""
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "operation": operation,
        "table_id": table_id,
        "user_info": user_info or "system",
        "details": details or {}
    }

    app.logger.info(f"TABLE_AUDIT: {operation} - Table {table_id} - {log_entry}")

    # Optional: Save to audit log file for compliance
    try:
        audit_log_file = os.path.join(DATA_DIR, 'table_audit.json')
        audit_entries = []

        if os.path.exists(audit_log_file):
            try:
                with open(audit_log_file, 'r', encoding='utf-8') as f:
                    audit_entries = json.load(f)
            except:
                audit_entries = []

        audit_entries.append(log_entry)

        # Keep only last 1000 entries to prevent file growth
        if len(audit_entries) > 1000:
            audit_entries = audit_entries[-1000:]

        with open(audit_log_file, 'w', encoding='utf-8') as f:
            json.dump(audit_entries, f, indent=2, ensure_ascii=False)

    except Exception as e:
        app.logger.error(f"Failed to write audit log: {e}")

def enhanced_safe_file_operation(operation_name, file_operation, *args, **kwargs):
    """Enhanced file operation with integrity checks"""
    try:
        # Create backup before critical operations
        if operation_name in ['save_tables_config', 'save_table_sessions']:
            backup_file = None
            try:
                if operation_name == 'save_tables_config':
                    original_file = os.path.join(DATA_DIR, 'tables_config.json')
                    backup_file = os.path.join(DATA_DIR, 'tables_config.json.backup')
                elif operation_name == 'save_table_sessions':
                    original_file = os.path.join(DATA_DIR, 'table_sessions.json')
                    backup_file = os.path.join(DATA_DIR, 'table_sessions.json.backup')

                if os.path.exists(original_file) and backup_file:
                    import shutil
                    shutil.copy2(original_file, backup_file)

            except Exception as e:
                app.logger.warning(f"Failed to create backup for {operation_name}: {e}")

        # Execute the operation
        result = safe_file_operation(file_operation, *args, **kwargs)

        # Verify the operation succeeded for critical files
        if operation_name in ['save_tables_config', 'save_table_sessions'] and result:
            try:
                if operation_name == 'save_tables_config':
                    app.logger.info(f"[FILE_OP] Verifying {operation_name} by loading it back...")
                    load_tables_config()  # Verify we can load what we just saved
                    app.logger.info(f"[FILE_OP] Verification successful for {operation_name}")
                elif operation_name == 'save_table_sessions':
                    app.logger.info(f"[FILE_OP] Verifying {operation_name} by loading it back...")
                    loaded_data = load_table_sessions()  # Verify we can load what we just saved
                    app.logger.info(f"[FILE_OP] Verification successful - file loads correctly with {len(loaded_data)} table(s)")
            except Exception as e:
                import traceback
                app.logger.error(f"[FILE_OP] Verification FAILED for {operation_name}: {e}")
                app.logger.error(f"[FILE_OP] Verification traceback: {traceback.format_exc()}")
                # Attempt to restore from backup if verification fails
                if backup_file and os.path.exists(backup_file):
                    try:
                        import shutil
                        app.logger.warning(f"[FILE_OP] Attempting to restore {operation_name} from backup: {backup_file}")
                        shutil.copy2(backup_file, original_file)
                        app.logger.info(f"[FILE_OP] Successfully restored {operation_name} from backup")
                    except Exception as restore_error:
                        app.logger.error(f"[FILE_OP] Failed to restore from backup: {restore_error}")
                else:
                    app.logger.error(f"[FILE_OP] No backup file available to restore")
                return False

        return result

    except Exception as e:
        app.logger.error(f"Enhanced file operation {operation_name} failed: {e}")
        raise

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
        # Printer verification tracking (Phase 2: Multi-device printer redesign)
        "printer_verified_at": None,
        "printer_last_test_status": None,
        "printer_verification_device": None,
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

# PyInstaller Fix: Mock limits.aio to prevent asyncio import issues
# This prevents flask-limiter from trying to import async components that cause
# circular imports when frozen by PyInstaller. The synchronous rate limiting
# still works perfectly for our use case.
import sys
if getattr(sys, 'frozen', False) or sys.version_info >= (3, 13):
    # We're running in a PyInstaller bundle or Python 3.13+ (which has asyncio issues)
    from types import ModuleType

    # Create mock aio module
    mock_aio = ModuleType('limits.aio')
    mock_aio.__path__ = []

    # Create mock aio.storage module
    mock_aio_storage = ModuleType('limits.aio.storage')
    mock_aio_storage.__path__ = []

    # Inject mocks into sys.modules before importing flask_limiter
    sys.modules['limits.aio'] = mock_aio
    sys.modules['limits.aio.storage'] = mock_aio_storage

# Add rate limiting
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Disable global defaults so frequent desktop polling endpoints are not rate limited.
# Sensitive routes add explicit limits via decorators instead.
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=[]
)


def to_bytes(s, encoding='cp858'): 
    """Convert string to bytes with Greek character transliteration for thermal printers and Euro support"""
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


def to_decimal(value) -> Decimal:
    """Safely convert values to Decimal for currency math."""
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal('0')


def format_currency(value) -> str:
    """Format numeric values as Euro currency strings."""
    amount = to_decimal(value).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return f"\u20AC{format(amount, '0.00')}"

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
        # Load existing config from file
        existing = {}
        if os.path.exists(CONFIG_FILE):
            with open(CONFIG_FILE, 'r') as f:
                try:
                    existing = json.load(f) or {}
                except json.JSONDecodeError:
                    existing = {}

        # Merge: Start with defaults, overlay existing, then overlay updates
        # This ensures updated_values always wins
        defaults = load_config()
        merged = {}
        merged.update(defaults)
        merged.update(existing)
        merged.update(updated_values)  # Updated values must be last to take priority

        # Write atomically
        tmp = CONFIG_FILE + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(merged, f, indent=4)
        os.replace(tmp, CONFIG_FILE)

        # Refresh globals
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
    
# Registry functions removed - consolidated to 2 storage locations (file + ProgramData)

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

    # Registry storage removed - consolidated to 2 locations only

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

        # Registry removed - using 2 storage locations only

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
    """
    Provide configuration data to frontend (non-sensitive only)
    
    Updated to include unified license state for comprehensive frontend integration
    """
    try:
        # Get license status using unified system
        license_status = get_license_status_safe(force_refresh=False, context="api_config")
        
        config = {
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
            },
            'license': {
                'active': license_status.get('active', False),
                'licensed': license_status.get('licensed', False),
                'subscription': license_status.get('subscription', False),
                'source': license_status.get('source', 'unknown'),
                'migration_status': {
                    'backend_migration_enabled': ENABLE_BACKEND_MIGRATION,
                    'unified_system_available': UNIFIED_LICENSES_ENABLED,
                    'migration_path': license_status.get('_migration_path', 'unknown')
                }
            }
        }
        
        # Add subscription details if available (non-sensitive only)
        if license_status.get('subscription') and license_status.get('valid_until'):
            config['license']['subscription_active'] = True
            config['license']['subscription_status'] = license_status.get('subscription_status', 'unknown')
        
        # Add grace period info if relevant
        if license_status.get('grace_period_active'):
            config['license']['grace_period_active'] = True
            config['license']['grace_period_warning'] = license_status.get('grace_period_warning_level', 'none')

        # Add table management setting
        app_config = load_config()
        config['table_management_enabled'] = app_config.get('table_management_enabled', False)

        return jsonify(config)
        
    except Exception as e:
        app.logger.error(f"Config endpoint error: {e}")
        
        # Return safe fallback config
        return jsonify({
            'stripe': {'publishable_key': Config.STRIPE_PUBLISHABLE_KEY},
            'app': {'base_url': Config.APP_BASE_URL, 'version': CURRENT_VERSION},
            'features': {
                'test_mode': Config.ENABLE_TEST_MODE,
                'new_checkout': Config.ENABLE_NEW_CHECKOUT,
                'subscription_management': Config.ENABLE_SUBSCRIPTION_MANAGEMENT,
                'refund_processing': Config.ENABLE_REFUND_PROCESSING,
                'email_notifications': Config.ENABLE_EMAIL_NOTIFICATIONS
            },
            'license': {
                'active': False,
                'licensed': False,
                'subscription': False,
                'source': 'config_error',
                'migration_status': {'error': str(e)}
            },
            'error': 'Configuration partially available'
        }), 200  # Return 200 to avoid breaking frontend


@app.route('/api/config', methods=['POST'])
def update_config():
    """Update application configuration"""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400

        # Handle table management toggle
        if 'table_management_enabled' in data:
            table_enabled = bool(data['table_management_enabled'])

            # Update config
            if save_config({"table_management_enabled": table_enabled}):
                # Broadcast configuration change via SSE
                _sse_broadcast('config_updated', {
                    'table_management_enabled': table_enabled
                })

                app.logger.info(f"Table management {'enabled' if table_enabled else 'disabled'}")

                return jsonify({
                    "status": "success",
                    "message": f"Table management {'enabled' if table_enabled else 'disabled'} successfully",
                    "table_management_enabled": table_enabled
                })
            else:
                return jsonify({"status": "error", "message": "Failed to save configuration"}), 500

        return jsonify({"status": "error", "message": "No valid configuration provided"}), 400

    except Exception as e:
        app.logger.error(f"Failed to update config: {e}")
        return jsonify({"status": "error", "message": f"Failed to update configuration: {str(e)}"}), 500


@app.route('/')
def serve_index():
    return send_from_directory('.', 'UISelect.html')

@app.route('/UISelect.html')
def serve_uiselect():
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

# Explicit JavaScript file routes with comprehensive debugging
# Added extensive logging to diagnose why these routes return 404 while pospalCore.js works


SUPPORT_ASSETS = {
    "js": {
        "files": [
            "enhanced-error-handler.js",
            "enhanced-ux-manager.js",
            "notification-manager.js",
            "customer-segmentation.js",
            "advanced-notification-intelligence.js",
            "licensing-dashboard.js",
        ],
        "mimetype": "application/javascript",
    },
    "css": {
        "files": [
            "enhanced-ux-components.css",
        ],
        "mimetype": "text/css",
    },
}



def _resolve_support_paths(files):
    search_roots = []
    frozen_root = getattr(sys, '_MEIPASS', None)
    if frozen_root and frozen_root not in search_roots:
        search_roots.append(frozen_root)
    for candidate in (BASE_DIR, os.getcwd(), DATA_DIR, os.path.dirname(DATA_DIR)):
        if candidate and candidate not in search_roots:
            search_roots.append(candidate)

    resolved_paths = []
    missing = []
    for name in files:
        found_path = None
        for root in search_roots:
            candidate = os.path.join(root, name)
            if os.path.exists(candidate):
                found_path = candidate
                break
        if found_path:
            resolved_paths.append(found_path)
        else:
            missing.append(name)
            resolved_paths.append(None)

    if missing:
        app.logger.error(
            "Support assets missing: %s (searched: %s)",
            ", ".join(missing),
            ", ".join(search_roots)
        )
        return None

    return resolved_paths


_support_asset_cache = {
    "js": {"content": None, "etag": None, "last_modified": None, "signature": None},
    "css": {"content": None, "etag": None, "last_modified": None, "signature": None},
}


def _build_support_asset(kind):
    config = SUPPORT_ASSETS[kind]
    files = config["files"]
    file_paths = _resolve_support_paths(files)
    if not file_paths:
        return None

    try:
        mtimes = tuple(os.path.getmtime(path) for path in file_paths)
    except FileNotFoundError as exc:
        app.logger.error(f"Support asset missing during mtime check: {exc}")
        return None

    cache = _support_asset_cache[kind]
    if cache["content"] is not None and cache["signature"] == mtimes:
        return cache

    parts = []
    for filename, path in zip(files, file_paths):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                parts.append('\n/* ===== {} ===== */\n'.format(filename))
                parts.append(handle.read())
        except FileNotFoundError as exc:
            app.logger.error(f"Support asset not found during bundle build: {exc}")
            return None

    bundle_text = "".join(parts)
    etag = hashlib.sha256(bundle_text.encode("utf-8")).hexdigest()
    last_modified = datetime.fromtimestamp(max(mtimes)) if mtimes else datetime.utcnow()

    cache.update(
        {
            "content": bundle_text,
            "etag": etag,
            "last_modified": last_modified,
            "signature": mtimes,
        }
    )
    return cache


def _serve_support_asset(kind):
    cache = _build_support_asset(kind)
    if not cache or not cache.get("content"):
        return jsonify({"error": "Support assets unavailable"}), 500

    etag = cache["etag"]
    last_modified = cache["last_modified"]
    content = cache["content"]
    mimetype = SUPPORT_ASSETS[kind]["mimetype"]

    if etag and request.headers.get("If-None-Match") == etag:
        return Response(status=304)

    if last_modified:
        last_modified_header = http_date(last_modified.timestamp())
        if request.headers.get("If-Modified-Since") == last_modified_header:
            return Response(status=304)

    response = Response(content, mimetype=mimetype)
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    if etag:
        response.headers["ETag"] = etag
    if last_modified:
        response.headers["Last-Modified"] = http_date(last_modified.timestamp())
    return response


@app.route('/assets/desktop-support.js')
def serve_desktop_support_js():
    return _serve_support_asset("js")


@app.route('/assets/desktop-support.css')
def serve_desktop_support_css():
    return _serve_support_asset("css")

@app.route('/locales/<path:filename>')
def serve_locales(filename):
    return send_from_directory('locales', filename)

@app.route('/api/events')
def sse_stream():
    try:
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
        headers = {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
        return Response(gen(), headers=headers)
    except Exception as e:
        app.logger.error(f"SSE endpoint error: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500

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


def classify_printer_type(printer_name):
    """
    Classify printer as thermal, PDF/virtual, or unknown for better UX
    Returns: dict with type, is_thermal, is_supported, display_hint
    """
    name_lower = printer_name.lower()

    # Thermal printer indicators (common POS thermal printer keywords)
    thermal_keywords = [
        'pos', '80mm', '58mm', 'thermal', 'receipt',
        'tm-t', 'tm-m', 'tm-p', 'tm-h', 'tm-u',  # Epson TM series
        'tsp', 'tup', 'tsp100', 'tsp143', 'tsp650', 'tsp700',  # Star TSP series
        'rp', 'citizen', 'ct-s',  # Citizen
        'kitchen', 'ticket', 'escpos', 'star',
        'bixolon', 'srp', 'custom', 'vkp'
    ]

    # PDF and virtual printer indicators (should be filtered out)
    virtual_keywords = [
        'pdf', 'xps', 'onenote', 'one note', 'fax',
        'send to', 'microsoft print', 'foxit', 'adobe',
        'cutepdf', 'primopdf', 'bullzip', 'dopdf',
        'virtual', 'document writer'
    ]

    # Check for virtual/PDF printers first (these are NOT supported)
    for keyword in virtual_keywords:
        if keyword in name_lower:
            return {
                'type': 'pdf_virtual',
                'is_thermal': False,
                'is_supported': False,
                'display_hint': '📄 PDF/Virtual (Not supported)',
                'explanation': 'PDF and virtual printers cannot print thermal receipts'
            }

    # Check for thermal printer indicators
    thermal_score = sum(1 for keyword in thermal_keywords if keyword in name_lower)

    if thermal_score >= 1:
        return {
            'type': 'thermal',
            'is_thermal': True,
            'is_supported': True,
            'display_hint': '🖨️ Thermal Printer',
            'recommended': True
        }

    # Check for "Generic / Text Only" which often works for ESC/POS
    if 'generic' in name_lower and 'text' in name_lower:
        return {
            'type': 'generic_text',
            'is_thermal': False,
            'is_supported': True,
            'display_hint': '📝 Text Printer (May work)',
            'recommended': False
        }

    # Unknown printer type
    return {
        'type': 'unknown',
        'is_thermal': False,
        'is_supported': True,  # Allow, but don't recommend
        'display_hint': '❓ Unknown Type',
        'recommended': False
    }

@app.route('/api/printers', methods=['GET'])
def get_printers():
    """
    Enhanced printer list endpoint with type classification
    Returns printers with metadata about thermal/PDF type for better UX
    """
    printer_names = list_installed_printers()

    # Classify each printer
    printers_with_metadata = []
    for name in printer_names:
        classification = classify_printer_type(name)
        printers_with_metadata.append({
            'name': name,
            **classification
        })

    # Sort: thermal first, then generic, then unknown, then unsupported last
    sort_order = {'thermal': 0, 'generic_text': 1, 'unknown': 2, 'pdf_virtual': 3}
    printers_with_metadata.sort(key=lambda p: sort_order.get(p['type'], 999))

    return jsonify({
        "printers": printers_with_metadata,
        "printer_names": printer_names,  # Legacy support
        "selected": PRINTER_NAME
    })


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


@app.route('/api/printer/health', methods=['GET'])
def printer_health():
    """
    Comprehensive printer health check (passive - no printing)
    Returns printer configuration, accessibility, and verification status
    Phase 2: Multi-device printer redesign
    """
    try:
        # Check if printer is configured
        printer_configured = PRINTER_NAME and PRINTER_NAME != "Your_Printer_Name_Here" and PRINTER_NAME != "Microsoft Print to PDF"

        if not printer_configured:
            return jsonify({
                "printer_configured": False,
                "printer_name": None,
                "printer_online": False,
                "printer_verified": False,
                "needs_verification": True,
                "status_message": "No printer configured"
            })

        # Check if printer is accessible (online)
        printer_online = False
        status_code = None
        try:
            h = win32print.OpenPrinter(PRINTER_NAME)
            try:
                info = win32print.GetPrinter(h, 2)
                status_code = info.get('Status', 0)
                printer_online = True
            finally:
                win32print.ClosePrinter(h)
        except Exception as e:
            app.logger.warning(f"Printer '{PRINTER_NAME}' not accessible: {e}")
            printer_online = False

        # Get verification info from config
        verified_at = config.get('printer_verified_at')
        verified_by = config.get('printer_verification_device')
        last_test_status = config.get('printer_last_test_status')

        printer_verified = last_test_status == 'success' and verified_at is not None

        # Determine if verification is needed
        needs_verification = not printer_verified or not printer_online

        return jsonify({
            "printer_configured": True,
            "printer_name": PRINTER_NAME,
            "printer_online": printer_online,
            "printer_verified": printer_verified,
            "verified_at": verified_at,
            "verified_by": verified_by,
            "last_test_status": last_test_status,
            "status_code": status_code,
            "needs_verification": needs_verification,
            "status_message": "Printer ready" if (printer_online and printer_verified) else
                             "Printer offline" if not printer_online else
                             "Printer not verified"
        })
    except Exception as e:
        app.logger.error(f"Error in printer_health: {e}")
        return jsonify({
            "printer_configured": False,
            "error": str(e),
            "status_message": "Error checking printer health"
        }), 500


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
    """
    Test print endpoint with verification tracking
    Phase 2: Multi-device printer redesign
    Accepts device_name parameter and updates config with verification status
    """
    try:
        # Get device name from request (optional)
        data = request.get_json() or {}
        device_name = data.get('device_name', 'Unknown Device')

        # Check license status - allow both active subscriptions and active trials
        license_status = check_trial_status()

        # DEBUG: Log the actual license status for troubleshooting
        app.logger.info(f"[TEST_PRINT] License status: {license_status}")
        app.logger.info(f"[TEST_PRINT] active={license_status.get('active', False)}, licensed={license_status.get('licensed', False)}, subscription={license_status.get('subscription')}, subscription_status={license_status.get('subscription_status')}")

        # Allow printing if license is active OR if subscription is active
        has_active_license = (
            license_status.get('active', False) or
            license_status.get('licensed', False) or
            (license_status.get('subscription') and license_status.get('subscription_status') == 'active')
        )

        app.logger.info(f"[TEST_PRINT] has_active_license={has_active_license}")

        if not has_active_license:
            # Update config with failed verification
            save_config({
                'printer_last_test_status': 'failed',
                'printer_verified_at': datetime.now().isoformat(),
                'printer_verification_device': device_name
            })
            return jsonify({
                "success": False,
                "message": "License inactive. Printing disabled.",
                "debug_license_status": license_status  # Add debug info
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
        # Check if selected printer is PDF/virtual BEFORE attempting print
        printer_classification = classify_printer_type(PRINTER_NAME)
        if not printer_classification.get('is_supported', True):
            # Update config with failed verification
            save_config({
                'printer_last_test_status': 'failed',
                'printer_verified_at': datetime.now().isoformat(),
                'printer_verification_device': device_name
            })
            return jsonify({
                "success": False,
                "message": f"❌ Cannot use this printer for thermal receipts. {printer_classification.get('explanation', 'Please select a thermal receipt printer.')}"
            }), 200

        ok = print_kitchen_ticket(test_order, copy_info="")
        if ok:
            # Update config with successful verification
            save_config({
                'printer_last_test_status': 'success',
                'printer_verified_at': datetime.now().isoformat(),
                'printer_verification_device': device_name
            })
            app.logger.info(f"[TEST_PRINT] Printer verified successfully by device: {device_name}")
            return jsonify({"success": True, "message": "✓ Test print sent successfully!"})

        # If failed and looks like a PDF-type printer, clarify unsupported
        name_lower = str(PRINTER_NAME).lower()
        error_message = "Test print failed. Check printer connection and try again."
        if 'pdf' in name_lower or 'xps' in name_lower or 'onenote' in name_lower:
            error_message = "❌ PDF/Virtual printer detected. Please select your thermal receipt printer from the dropdown."

        # Update config with failed verification
        save_config({
            'printer_last_test_status': 'failed',
            'printer_verified_at': datetime.now().isoformat(),
            'printer_verification_device': device_name
        })

        return jsonify({"success": False, "message": error_message}), 200
    except Exception as e:
        # Update config with failed verification
        try:
            data = request.get_json() or {}
            device_name = data.get('device_name', 'Unknown Device')
            save_config({
                'printer_last_test_status': 'failed',
                'printer_verified_at': datetime.now().isoformat(),
                'printer_verification_device': device_name
            })
        except:
            pass
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


@app.route('/api/business-profile', methods=['GET', 'POST'])
def business_profile_settings():
    if request.method == 'GET':
        profile = load_business_profile_data()
        source = 'stored' if profile else 'env'
        if not profile:
            env_profile = {}
            for key, env_keys in BUSINESS_PROFILE_ENV_MAP.items():
                for env_key in env_keys:
                    value = os.environ.get(env_key)
                    if value and value.strip():
                        env_profile[key] = value.strip()
                        break
            profile = env_profile
            if not profile:
                source = 'default'
        return jsonify({"success": True, "profile": profile, "source": source})

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({"success": False, "message": "Invalid payload."}), 400

    update_data = {}
    for key in BUSINESS_PROFILE_FIELDS:
        if key in data:
            value = data.get(key)
            if value is None:
                update_data[key] = ''
            else:
                update_data[key] = str(value).strip()

    if not update_data.get('name'):
        return jsonify({"success": False, "message": "Business name is required."}), 400

    saved_profile = save_business_profile_data(update_data)
    return jsonify({"success": True, "profile": saved_profile})


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


# === Table Management API Endpoints ===

@app.route('/api/tables', methods=['GET'])
@limiter.limit("30 per minute")  # Allow 30 requests per minute (one every 2 seconds average)
def get_tables():
    """Get all tables and their status"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        tables_config = load_tables_config()
        app.logger.info(f"[DEBUG] load_tables_config returned: {tables_config}")
        app.logger.info(f"[DEBUG] tables_config['tables'] type: {type(tables_config.get('tables'))}, keys: {list(tables_config.get('tables', {}).keys())}")

        table_sessions = load_table_sessions()
        app.logger.info(f"[DEBUG] load_table_sessions returned keys: {list(table_sessions.keys())}")

        # Merge table configuration with current session status
        for table_id, table_info in tables_config.get("tables", {}).items():
            if table_id in table_sessions:
                session = table_sessions[table_id]
                session_status = session.get("status", "available")
                table_info["session"] = {
                    "status": session_status,
                    "orders": session.get("orders", []),
                    "total_amount": session.get("total_amount", 0.0),
                    "opened_at": session.get("opened_at"),
                    "last_order_at": session.get("last_order_at"),
                    "payment_status": session.get("payment_status", "unpaid")
                }
                # Update table status to match session status for consistency
                table_info["status"] = session_status
            else:
                table_info["session"] = {
                    "status": "available",
                    "orders": [],
                    "total_amount": 0.0,
                    "payment_status": "unpaid"
                }
                # Ensure table status is available when no session exists
                table_info["status"] = "available"

        return jsonify({
            "status": "success",
            "tables": tables_config.get("tables", {}),
            "settings": tables_config.get("settings", {})
        })
    except Exception as e:
        app.logger.error(f"Failed to get tables: {e}")
        return jsonify({"status": "error", "message": f"Failed to get tables: {str(e)}"}), 500

@app.route('/api/tables/configure', methods=['POST'])
def configure_tables():
    """Update table configuration"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        config_data = request.get_json()
        if not config_data:
            return jsonify({"status": "error", "message": "No configuration data provided"}), 400

        if save_tables_config(config_data):
            # Broadcast table configuration update via SSE
            _sse_broadcast('tables_config', config_data)
            return jsonify({"status": "success", "message": "Table configuration updated"})
        else:
            return jsonify({"status": "error", "message": "Failed to save table configuration"}), 500
    except Exception as e:
        app.logger.error(f"Failed to configure tables: {e}")
        return jsonify({"status": "error", "message": f"Failed to configure tables: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/status', methods=['GET'])
def get_table_status(table_id):
    """Get specific table status"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        tables_config = load_tables_config()
        table_sessions = load_table_sessions()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        table_info = tables_config["tables"][table_id].copy()

        if table_id in table_sessions:
            session = table_sessions[table_id]
            session_status = session.get("status", "available")
            table_info["session"] = {
                "status": session_status,
                "orders": session.get("orders", []),
                "total_amount": session.get("total_amount", 0.0),
                "opened_at": session.get("opened_at"),
                "last_order_at": session.get("last_order_at"),
                "payment_status": session.get("payment_status", "unpaid")
            }
            # Update table status to match session status for consistency
            table_info["status"] = session_status
        else:
            table_info["session"] = {
                "status": "available",
                "orders": [],
                "total_amount": 0.0,
                "payment_status": "unpaid"
            }
            # Ensure table status is available when no session exists
            table_info["status"] = "available"

        return jsonify({
            "status": "success",
            "table": table_info
        })
    except Exception as e:
        app.logger.error(f"Failed to get table status for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to get table status: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/status', methods=['POST'])
def update_table_status(table_id):
    """Update table status"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400

        tables_config = load_tables_config()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        # Update table status in configuration if provided
        if "status" in data:
            tables_config["tables"][table_id]["status"] = data["status"]
            save_tables_config(tables_config)

        # Broadcast table status update via SSE
        _sse_broadcast('table_status', {
            "table_id": table_id,
            "status": data.get("status")
        })

        return jsonify({"status": "success", "message": "Table status updated"})
    except Exception as e:
        app.logger.error(f"Failed to update table status for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to update table status: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/session', methods=['GET'])
def get_table_session(table_id):
    """Get table session (orders, total)"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        tables_config = load_tables_config()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        table_sessions = load_table_sessions()

        if table_id in table_sessions:
            session = table_sessions[table_id]

            # Fetch full order details from CSV files
            order_numbers = session.get("orders", [])
            full_orders = []

            if order_numbers:
                # Get orders from CSV files
                csv_orders = get_orders_for_table(table_id)

                # Match orders by order number and transform to frontend format
                for order_num in order_numbers:
                    csv_order = next((o for o in csv_orders if o.get('order_number') == order_num), None)

                    if csv_order:
                        # Transform to frontend expected format
                        full_orders.append({
                            "id": csv_order.get('order_number'),
                            "created_at": csv_order.get('timestamp', ''),
                            "total": csv_order.get('order_total', 0.0),
                            "items": csv_order.get('items', [])
                        })
                    else:
                        # Fallback: create basic order from order_details if CSV not found
                        order_detail = next(
                            (od for od in session.get("order_details", [])
                             if od.get('order_number') == order_num),
                            None
                        )
                        if order_detail:
                            full_orders.append({
                                "id": order_detail.get('order_number'),
                                "created_at": order_detail.get('timestamp', ''),
                                "total": order_detail.get('order_total', 0.0),
                                "items": [{"name": "Order items", "quantity": 1, "price": order_detail.get('order_total', 0.0)}]
                            })

            return jsonify({
                "status": "success",
                "session": {
                    "status": session.get("status", "available"),
                    "orders": full_orders,  # Now returning full order objects instead of just numbers
                    "total_amount": session.get("total_amount", 0.0),
                    "opened_at": session.get("opened_at"),
                    "last_order_at": session.get("last_order_at"),
                    "payment_status": session.get("payment_status", "unpaid"),
                    "amount_paid": session.get("amount_paid", 0.0),
                    "amount_remaining": session.get("amount_remaining", session.get("total_amount", 0.0)),
                    "payments": session.get("payments", [])
                }
            })
        else:
            return jsonify({
                "status": "success",
                "session": {
                    "status": "available",
                    "orders": [],
                    "total_amount": 0.0,
                    "payment_status": "unpaid",
                    "amount_paid": 0.0,
                    "amount_remaining": 0.0,
                    "payments": []
                }
            })
    except Exception as e:
        app.logger.error(f"Failed to get table session for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to get table session: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/open', methods=['POST'])
def open_table(table_id):
    """Open/assign table"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        tables_config = load_tables_config()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        sessions = load_table_sessions()
        current_time = datetime.now().isoformat()

        # Create or update session
        sessions[table_id] = {
            "status": "occupied",
            "orders": [],
            "total_amount": 0.0,
            "opened_at": current_time,
            "last_order_at": current_time,
            "payment_status": "unpaid"
        }

        if save_table_sessions(sessions):
            # Broadcast table opened via SSE
            _sse_broadcast('table_opened', {
                "table_id": table_id,
                "opened_at": current_time
            })
            return jsonify({"status": "success", "message": "Table opened"})
        else:
            return jsonify({"status": "error", "message": "Failed to open table"}), 500
    except Exception as e:
        app.logger.error(f"Failed to open table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to open table: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/close', methods=['POST'])
def close_table(table_id):
    """Close table (mark as paid)"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        tables_config = load_tables_config()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        if close_table_session(table_id):
            # Broadcast table closed via SSE
            _sse_broadcast('table_closed', {
                "table_id": table_id,
                "closed_at": datetime.now().isoformat()
            })
            return jsonify({"status": "success", "message": "Table closed and marked as paid"})
        else:
            return jsonify({"status": "error", "message": "Failed to close table"}), 500
    except Exception as e:
        app.logger.error(f"Failed to close table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to close table: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/clear', methods=['POST'])
def clear_table(table_id):
    """Clear table for next customers"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        # Use silent=True to avoid 400 error when body is empty
        data = request.get_json(silent=True) or {}
        force_clear = data.get('force_clear', False)

        tables_config = load_tables_config()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        # Check payment status before clearing (unless forced)
        if not force_clear:
            sessions = load_table_sessions()
            if table_id in sessions:
                session = sessions[table_id]
                payment_status = session.get("payment_status", "unpaid")
                total_amount = session.get("total_amount", 0.0)
                amount_paid = session.get("amount_paid", 0.0)
                amount_remaining = max(0, total_amount - amount_paid)

                if payment_status != "paid" and amount_remaining > 0.01:
                    return jsonify({
                        "status": "error",
                        "message": f"Cannot clear table with outstanding balance of €{amount_remaining:.2f}. Payment required or use force_clear.",
                        "payment_status": payment_status,
                        "total_amount": total_amount,
                        "amount_paid": amount_paid,
                        "amount_remaining": amount_remaining,
                        "requires_force": True
                    }), 400

        app.logger.info(f"[CLEAR_ENDPOINT] Attempting to clear table {table_id}")
        clear_result = clear_table_session(table_id)

        if clear_result:
            app.logger.info(f"[CLEAR_ENDPOINT] Table {table_id} cleared successfully, broadcasting SSE")
            # Broadcast table cleared via SSE
            try:
                _sse_broadcast('table_cleared', {
                    "table_id": table_id,
                    "cleared_at": datetime.now().isoformat()
                })
            except Exception as sse_error:
                app.logger.warning(f"[CLEAR_ENDPOINT] Failed to broadcast SSE event: {sse_error}")
                # Don't fail the request just because SSE failed

            return jsonify({"status": "success", "message": "Table cleared and made available"})
        else:
            app.logger.error(f"[CLEAR_ENDPOINT] clear_table_session returned False for table {table_id}")
            return jsonify({
                "status": "error",
                "message": "Failed to clear table. Check server logs for details.",
                "detail": "Table session could not be saved. This may be due to file permission issues or file locking."
            }), 500
    except Exception as e:
        import traceback
        app.logger.error(f"[CLEAR_ENDPOINT] Exception while clearing table {table_id}: {e}")
        app.logger.error(f"[CLEAR_ENDPOINT] Traceback: {traceback.format_exc()}")
        return jsonify({
            "status": "error",
            "message": f"Failed to clear table: {str(e)}",
            "detail": "An unexpected error occurred. Check server logs for details."
        }), 500

@app.route('/api/tables/<table_id>/bill', methods=['GET'])
def get_table_bill(table_id):
    """Generate complete bill for a table showing all orders"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        # Generate bill data
        bill_data = get_table_bill_data(table_id)

        if bill_data is None:
            return jsonify({"status": "error", "message": "Table not found"}), 404

        return jsonify(bill_data)

    except Exception as e:
        app.logger.error(f"Failed to generate bill for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to generate bill: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/print-bill', methods=['POST'])
def print_table_bill(table_id):
    """Print complete table bill using POSPal's printing system"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        # Get bill data
        bill_data = get_table_bill_data(table_id)
        if bill_data is None:
            return jsonify({"status": "error", "message": "Table not found"}), 404

        if not bill_data.get('orders'):
            return jsonify({"status": "error", "message": "No orders found for this table"}), 400

        # Print bill using existing printing infrastructure
        print_success = print_table_bill_ticket(bill_data)

        if print_success:
            app.logger.info(f"Table {table_id} bill printed successfully")
            # Broadcast SSE event for real-time updates
            _sse_broadcast("table_bill_printed", {
                "table_id": table_id,
                "timestamp": datetime.now().isoformat(),
                "total": bill_data.get('total', 0.0)
            })

            return jsonify({
                "status": "success",
                "message": "Bill printed successfully",
                "table_id": table_id,
                "print_jobs": COPIES_PER_ORDER,
                "timestamp": datetime.now().isoformat()
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to print bill. Check printer status."
            }), 500

    except Exception as e:
        app.logger.error(f"Failed to print bill for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to print bill: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/add-payment', methods=['POST'])
def add_table_payment(table_id):
    """Record a payment for a table"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        data = request.get_json() or {}

        # Validate required fields
        amount = data.get('amount')
        payment_method = data.get('method', 'Cash')

        if amount is None:
            return jsonify({"status": "error", "message": "Payment amount is required"}), 400

        try:
            amount = float(amount)
            if amount <= 0:
                return jsonify({"status": "error", "message": "Payment amount must be positive"}), 400
        except (ValueError, TypeError):
            return jsonify({"status": "error", "message": "Invalid payment amount"}), 400

        # Get current session
        sessions = load_table_sessions()
        if table_id not in sessions:
            return jsonify({"status": "error", "message": "Table not found or not in use"}), 404

        session = sessions[table_id]
        current_total = session.get("total_amount", 0.0)
        current_paid = session.get("amount_paid", 0.0)
        current_remaining = max(0, current_total - current_paid)

        # Validate payment amount doesn't exceed remaining balance
        if amount > current_remaining + 0.01:  # Small tolerance for rounding
            return jsonify({
                "status": "error",
                "message": f"Payment amount (€{amount:.2f}) exceeds remaining balance (€{current_remaining:.2f})"
            }), 400

        # Create payment record
        payment_id = str(uuid.uuid4())
        payment_record = {
            "payment_id": payment_id,
            "amount": round(amount, 2),
            "method": payment_method,
            "timestamp": datetime.now().isoformat(),
            "note": data.get('note', ''),
            "items": data.get('items', [])  # For split by items functionality
        }

        # Ensure payment arrays exist
        if "payments" not in session:
            session["payments"] = []
        if "amount_paid" not in session:
            session["amount_paid"] = 0.0

        # Add payment to session
        session["payments"].append(payment_record)
        session["amount_paid"] = round(session["amount_paid"] + amount, 2)
        session["amount_remaining"] = round(max(0, current_total - session["amount_paid"]), 2)

        # Update payment status
        if session["amount_remaining"] <= 0.01:  # Tolerance for rounding
            session["payment_status"] = "paid"
        elif session["amount_paid"] > 0:
            session["payment_status"] = "partial"
        else:
            session["payment_status"] = "unpaid"

        # Save updated session
        if not save_table_sessions(sessions):
            return jsonify({"status": "error", "message": "Failed to save payment"}), 500

        app.logger.info(f"Payment recorded for table {table_id}: €{amount:.2f} via {payment_method}")

        # Broadcast SSE event for real-time updates
        _sse_broadcast("payment_updated", {
            "table_id": table_id,
            "payment_id": payment_id,
            "amount": amount,
            "method": payment_method,
            "payment_status": session["payment_status"],
            "amount_paid": session["amount_paid"],
            "amount_remaining": session["amount_remaining"],
            "timestamp": payment_record["timestamp"]
        })

        return jsonify({
            "status": "success",
            "payment_id": payment_id,
            "amount_paid": session["amount_paid"],
            "payment_status": session["payment_status"],
            "amount_remaining": session["amount_remaining"]
        })

    except Exception as e:
        app.logger.error(f"Failed to add payment for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to record payment: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/payments', methods=['GET'])
def get_table_payments(table_id):
    """Get payment history for a table"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        sessions = load_table_sessions()
        if table_id not in sessions:
            return jsonify({"status": "error", "message": "Table not found"}), 404

        session = sessions[table_id]
        payments = session.get("payments", [])

        return jsonify({
            "status": "success",
            "table_id": table_id,
            "payments": payments,
            "amount_paid": session.get("amount_paid", 0.0),
            "amount_remaining": session.get("amount_remaining", 0.0),
            "payment_status": session.get("payment_status", "unpaid"),
            "total_amount": session.get("total_amount", 0.0)
        })

    except Exception as e:
        app.logger.error(f"Failed to get payments for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to get payments: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/split-bill', methods=['POST'])
def split_table_bill(table_id):
    """Generate split bill options for a table"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        data = request.get_json() or {}
        split_type = data.get('split_type', 'amount')  # 'amount', 'items', or 'equal'

        # Get table bill data
        bill_data = get_table_bill_data(table_id)
        if bill_data is None:
            return jsonify({"status": "error", "message": "Table not found"}), 404

        if not bill_data.get('orders'):
            return jsonify({"status": "error", "message": "No orders found for this table"}), 400

        total_amount = bill_data['grand_total']
        already_paid = bill_data.get('amount_paid', 0.0)
        remaining_amount = max(0, total_amount - already_paid)

        if remaining_amount <= 0:
            return jsonify({"status": "error", "message": "Bill is already fully paid"}), 400

        split_options = {}

        if split_type == 'equal':
            # Split equally among specified number of people
            people_count = data.get('people_count', 2)
            if people_count < 2:
                return jsonify({"status": "error", "message": "People count must be at least 2"}), 400

            per_person = round(remaining_amount / people_count, 2)
            # Handle rounding by adjusting the last person's amount
            last_person_amount = round(remaining_amount - (per_person * (people_count - 1)), 2)

            split_options['equal'] = {
                "type": "equal",
                "people_count": people_count,
                "per_person": per_person,
                "splits": [
                    {"person": i + 1, "amount": per_person if i < people_count - 1 else last_person_amount}
                    for i in range(people_count)
                ],
                "total": remaining_amount
            }

        elif split_type == 'amount':
            # Custom split by specified amounts
            custom_amounts = data.get('amounts', [])
            if not custom_amounts:
                return jsonify({"status": "error", "message": "Custom amounts required for amount split"}), 400

            try:
                amounts = [float(amount) for amount in custom_amounts]
                if any(amount <= 0 for amount in amounts):
                    return jsonify({"status": "error", "message": "All amounts must be positive"}), 400

                total_splits = sum(amounts)
                if abs(total_splits - remaining_amount) > 0.01:
                    return jsonify({
                        "status": "error",
                        "message": f"Split amounts total (€{total_splits:.2f}) must equal remaining amount (€{remaining_amount:.2f})"
                    }), 400

                split_options['amount'] = {
                    "type": "amount",
                    "splits": [
                        {"person": i + 1, "amount": round(amount, 2)}
                        for i, amount in enumerate(amounts)
                    ],
                    "total": remaining_amount
                }

            except (ValueError, TypeError):
                return jsonify({"status": "error", "message": "Invalid amount values"}), 400

        elif split_type == 'items':
            # Split by individual items (new format) or by orders (legacy format)
            item_assignments = data.get('item_assignments', {})
            person_orders = data.get('person_orders', {})

            if not item_assignments and not person_orders:
                return jsonify({"status": "error", "message": "Either 'item_assignments' or 'person_orders' required for item split"}), 400

            orders = bill_data['orders']

            # NEW: Individual item-level splitting
            if item_assignments:
                # Build a lookup dictionary of all items by order_id and item_index
                all_items = {}
                total_items_count = 0
                for order in orders:
                    order_id = order.get('order_number')
                    for item_idx, item in enumerate(order.get('items', [])):
                        item_key = f"{order_id}_{item_idx}"
                        all_items[item_key] = {
                            'order_id': order_id,
                            'item_index': item_idx,
                            'name': item.get('name', ''),
                            'quantity': item.get('quantity', 1),
                            'base_price': float(item.get('basePrice', 0.0)),
                            'final_price': float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                        }
                        total_items_count += 1

                # Calculate each person's total based on assigned items
                person_totals = {}
                person_item_details = {}
                assigned_items = set()

                for person, assigned_items_list in item_assignments.items():
                    person_total = 0.0
                    person_items = []

                    for assigned_item in assigned_items_list:
                        order_id = assigned_item.get('order_id')
                        item_index = assigned_item.get('item_index')
                        item_key = f"{order_id}_{item_index}"

                        if item_key in all_items:
                            # Check if item already assigned to someone else
                            if item_key in assigned_items:
                                return jsonify({
                                    "status": "error",
                                    "message": f"Item '{assigned_item.get('item_name', 'Unknown')}' from order {order_id} is assigned to multiple people"
                                }), 400

                            item_data = all_items[item_key]
                            item_total = item_data['final_price'] * item_data['quantity']
                            person_total += item_total
                            assigned_items.add(item_key)

                            person_items.append({
                                'name': item_data['name'],
                                'quantity': item_data['quantity'],
                                'price': item_total
                            })
                        else:
                            return jsonify({
                                "status": "error",
                                "message": f"Item not found: order {order_id}, item index {item_index}"
                            }), 400

                    person_totals[person] = round(person_total, 2)
                    person_item_details[person] = person_items

                # Check if all items are assigned
                if len(assigned_items) < total_items_count:
                    unassigned_count = total_items_count - len(assigned_items)
                    return jsonify({
                        "status": "error",
                        "message": f"{unassigned_count} item(s) not assigned. All items must be assigned."
                    }), 400

                # Calculate expected total from all items (use same data source as assigned items)
                expected_total = 0.0
                for item_key, item_data in all_items.items():
                    item_total = item_data['final_price'] * item_data['quantity']
                    expected_total += item_total
                expected_total = round(expected_total, 2)

                # Verify assigned total matches items total (both from CSV data)
                assigned_total = sum(person_totals.values())
                if abs(assigned_total - expected_total) > 0.02:
                    return jsonify({
                        "status": "error",
                        "message": f"Assigned total (€{assigned_total:.2f}) doesn't match items total (€{expected_total:.2f})"
                    }), 400

                # Log warning if session total differs from calculated items total
                if abs(expected_total - remaining_amount) > 0.02:
                    app.logger.warning(
                        f"Table {table_id}: Session total (€{remaining_amount:.2f}) differs from "
                        f"calculated items total (€{expected_total:.2f}). Using items total for validation."
                    )

                split_options['items'] = {
                    "type": "items",
                    "splits": [
                        {
                            "person": person,
                            "amount": amount,
                            "items": person_item_details[person],
                            "item_count": len(person_item_details[person])
                        }
                        for person, amount in person_totals.items()
                    ],
                    "total": remaining_amount
                }

            # LEGACY: Split by entire orders (backward compatibility)
            else:
                order_totals = {}

                # Calculate total for each order
                for order in orders:
                    order_number = order.get('order_number')
                    order_total = 0.0
                    for item in order.get('items', []):
                        item_quantity = item.get('quantity', 1)
                        item_price = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                        order_total += item_quantity * item_price
                    order_totals[str(order_number)] = round(order_total, 2)

                # Calculate each person's total based on assigned orders
                person_totals = {}
                assigned_orders = set()

                for person, order_numbers in person_orders.items():
                    person_total = 0.0
                    for order_num in order_numbers:
                        order_key = str(order_num)
                        if order_key in order_totals:
                            if order_key in assigned_orders:
                                return jsonify({
                                    "status": "error",
                                    "message": f"Order {order_num} is assigned to multiple people"
                                }), 400
                            person_total += order_totals[order_key]
                            assigned_orders.add(order_key)
                        else:
                            return jsonify({
                                "status": "error",
                                "message": f"Order {order_num} not found"
                            }), 400
                    person_totals[person] = round(person_total, 2)

                # Check if all orders are assigned
                unassigned_orders = set(order_totals.keys()) - assigned_orders
                if unassigned_orders:
                    unassigned_total = sum(order_totals[order] for order in unassigned_orders)
                    return jsonify({
                        "status": "error",
                        "message": f"Orders {list(unassigned_orders)} are unassigned (total: €{unassigned_total:.2f})"
                    }), 400

                split_options['items'] = {
                    "type": "items",
                    "splits": [
                        {"person": person, "amount": amount, "orders": person_orders[person]}
                        for person, amount in person_totals.items()
                    ],
                    "order_totals": order_totals,
                    "total": remaining_amount
                }

        else:
            return jsonify({"status": "error", "message": "Invalid split_type. Use 'equal', 'amount', or 'items'"}), 400

        return jsonify({
            "status": "success",
            "table_id": table_id,
            "total_amount": total_amount,
            "already_paid": already_paid,
            "remaining_amount": remaining_amount,
            "split_options": split_options
        })

    except Exception as e:
        app.logger.error(f"Failed to generate split bill for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to generate split bill: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/print-customer-receipt', methods=['POST'])
def print_customer_receipt(table_id):
    """Print customer receipt for specific payment"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        data = request.get_json() or {}
        payment_id = data.get('payment_id')

        if not payment_id:
            return jsonify({"status": "error", "message": "Payment ID is required"}), 400

        # Get table session and payment details
        sessions = load_table_sessions()
        if table_id not in sessions:
            return jsonify({"status": "error", "message": "Table not found"}), 404

        session = sessions[table_id]
        payments = session.get("payments", [])

        # Find the specific payment
        payment = None
        for p in payments:
            if p.get("payment_id") == payment_id:
                payment = p
                break

        if not payment:
            return jsonify({"status": "error", "message": "Payment not found"}), 404

        # Get table bill data for context
        bill_data = get_table_bill_data(table_id)
        if bill_data is None:
            return jsonify({"status": "error", "message": "Table data not found"}), 404

        # Prepare customer receipt data
        receipt_data = {
            "table_id": table_id,
            "table_name": bill_data.get("table_name", f"Table {table_id}"),
            "payment": payment,
            "total_payments": len(payments),
            "bill_total": bill_data.get("grand_total", 0.0),
            "amount_paid_total": session.get("amount_paid", 0.0),
            "amount_remaining": bill_data.get("amount_remaining", session.get("amount_remaining", 0.0)),
            "payment_status": bill_data.get("payment_status", session.get("payment_status", "unpaid")),
            "payments": payments,
            "orders": bill_data.get("orders", []),
            "seats": bill_data.get("seats"),
            "bill_date": bill_data.get("bill_date"),
            "bill_time": bill_data.get("bill_time"),
            "timestamp": datetime.now().isoformat()
        }

        # Print customer receipt
        print_success = print_customer_receipt_ticket(receipt_data)

        if print_success:
            app.logger.info(f"Customer receipt printed for table {table_id}, payment {payment_id}")

            # Broadcast SSE event
            _sse_broadcast("customer_receipt_printed", {
                "table_id": table_id,
                "payment_id": payment_id,
                "amount": payment.get("amount", 0.0),
                "timestamp": receipt_data["timestamp"]
            })

            return jsonify({
                "status": "success",
                "message": "Customer receipt printed successfully",
                "table_id": table_id,
                "payment_id": payment_id,
                "print_jobs": COPIES_PER_ORDER,
                "timestamp": receipt_data["timestamp"]
            })
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to print customer receipt. Check printer status."
            }), 500

    except Exception as e:
        app.logger.error(f"Failed to print customer receipt for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to print customer receipt: {str(e)}"}), 500

@app.route('/api/tables/history/<date>', methods=['GET'])
def get_table_history(date):
    """Get table history for a specific date"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        # Validate date format
        try:
            datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            return jsonify({"status": "error", "message": "Invalid date format. Use YYYY-MM-DD"}), 400

        # Load history
        history = load_table_history(date)

        return jsonify({
            "status": "success",
            "date": date,
            "history": history
        })

    except Exception as e:
        app.logger.error(f"Failed to get table history for {date}: {e}")
        return jsonify({"status": "error", "message": f"Failed to get table history: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/recalculate', methods=['POST'])
def recalculate_table_total_endpoint(table_id):
    """Recalculate table total from actual order data"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management feature not enabled"}), 404

    try:
        # Check if table exists
        tables_config = load_tables_config()
        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": "Table not found"}), 404

        # Check if table has an active session
        sessions = load_table_sessions()
        if table_id not in sessions:
            return jsonify({"status": "error", "message": "No active session for this table"}), 400

        # Recalculate total
        new_total = recalculate_table_total(table_id)

        return jsonify({
            "status": "success",
            "table_id": table_id,
            "new_total": round(new_total, 2),
            "message": "Table total recalculated from order data"
        })

    except Exception as e:
        app.logger.error(f"Failed to recalculate total for table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to recalculate total: {str(e)}"}), 500


# --- PHASE 5: Table Management Optimizations ---

# Table status cache for performance optimization
_table_status_cache = {}
_table_config_cache = {}
_table_cache_time = 0
_table_cache_lock = threading.Lock()
TABLE_CACHE_TTL = 30  # Cache for 30 seconds

def get_cached_table_status():
    """Get cached table status with TTL"""
    global _table_status_cache, _table_cache_time

    with _table_cache_lock:
        if _table_status_cache and time.time() - _table_cache_time < TABLE_CACHE_TTL:
            return _table_status_cache.copy()
    return None

def update_table_status_cache(table_data):
    """Update table status cache"""
    global _table_status_cache, _table_cache_time

    with _table_cache_lock:
        _table_status_cache = table_data.copy()
        _table_cache_time = time.time()

def invalidate_table_cache():
    """Invalidate table cache"""
    global _table_status_cache, _table_cache_time

    with _table_cache_lock:
        _table_status_cache = {}
        _table_cache_time = 0

@app.route('/api/tables/suggest', methods=['GET'])
def suggest_tables():
    """Suggest best available tables based on party size"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        # Validate party size parameter
        party_size = request.args.get('party_size', type=int)
        if not party_size or party_size < 1 or party_size > 20:
            return jsonify({
                "status": "error",
                "message": "Valid party_size parameter required (1-20)"
            }), 400

        # Load table configuration and sessions
        tables_config = load_tables_config()
        table_sessions = load_table_sessions()

        if not tables_config or not tables_config.get("tables"):
            return jsonify({
                "status": "error",
                "message": "No tables configured"
            }), 400

        suggestions = []
        available_tables = []

        # Analyze each table
        for table_id, table_info in tables_config.get("tables", {}).items():
            table_seats = table_info.get("seats", 4)
            table_name = table_info.get("name", f"Table {table_id}")
            table_status = table_info.get("status", "available")

            # Check if table has active session
            has_active_session = table_id in table_sessions

            # Only consider available tables without active sessions
            if table_status == "available" and not has_active_session:
                available_tables.append({
                    "table_id": table_id,
                    "table_name": table_name,
                    "seats": table_seats,
                    "status": "available"
                })

        if not available_tables:
            return jsonify({
                "status": "success",
                "party_size": party_size,
                "suggestions": [],
                "message": "No available tables found"
            })

        # Generate suggestions with match quality scoring
        for table in available_tables:
            seats = table["seats"]

            if seats == party_size:
                # Perfect match
                suggestions.append({
                    **table,
                    "match_quality": "perfect",
                    "reason": "Exact capacity match",
                    "score": 100
                })
            elif seats == party_size + 1 or seats == party_size + 2:
                # Good match (1-2 extra seats)
                extra_seats = seats - party_size
                suggestions.append({
                    **table,
                    "match_quality": "good",
                    "reason": f"{extra_seats} extra seat{'s' if extra_seats > 1 else ''}",
                    "score": 90 - (extra_seats * 5)
                })
            elif seats > party_size and seats <= party_size + 4:
                # Acceptable match
                extra_seats = seats - party_size
                suggestions.append({
                    **table,
                    "match_quality": "acceptable",
                    "reason": f"{extra_seats} extra seats",
                    "score": 70 - (extra_seats * 5)
                })
            elif seats > party_size:
                # Poor match but available
                extra_seats = seats - party_size
                suggestions.append({
                    **table,
                    "match_quality": "poor",
                    "reason": f"Much larger table ({extra_seats} extra seats)",
                    "score": 50 - min(extra_seats, 10) * 2
                })

        # Sort suggestions by score (best first)
        suggestions.sort(key=lambda x: x["score"], reverse=True)

        # Remove score from response (internal use only)
        for suggestion in suggestions:
            suggestion.pop("score", None)

        # Limit to top 5 suggestions
        suggestions = suggestions[:5]

        app.logger.info(f"Generated {len(suggestions)} table suggestions for party size {party_size}")

        return jsonify({
            "status": "success",
            "party_size": party_size,
            "suggestions": suggestions
        })

    except Exception as e:
        app.logger.error(f"Failed to generate table suggestions: {e}")
        return jsonify({"status": "error", "message": f"Failed to generate suggestions: {str(e)}"}), 500

@app.route('/api/tables/health', methods=['GET'])
def table_health_check():
    """Check table management system health"""
    if not is_table_management_enabled():
        return jsonify({
            "status": "disabled",
            "table_management_enabled": False,
            "message": "Table management is not enabled"
        })

    try:
        health_status = {
            "status": "healthy",
            "table_management_enabled": True,
            "total_tables": 0,
            "active_sessions": 0,
            "printer_status": "unknown",
            "data_files": {}
        }

        # Check table configuration file
        tables_config_file = os.path.join(DATA_DIR, 'tables_config.json')
        if os.path.exists(tables_config_file) and os.access(tables_config_file, os.R_OK):
            health_status["data_files"]["tables_config"] = "ok"
            try:
                tables_config = load_tables_config()
                health_status["total_tables"] = len(tables_config.get("tables", {}))
            except:
                health_status["data_files"]["tables_config"] = "corrupted"
                health_status["status"] = "degraded"
        else:
            health_status["data_files"]["tables_config"] = "missing"
            health_status["status"] = "degraded"

        # Check table sessions file
        table_sessions_file = os.path.join(DATA_DIR, 'table_sessions.json')
        if os.path.exists(table_sessions_file) and os.access(table_sessions_file, os.R_OK):
            health_status["data_files"]["table_sessions"] = "ok"
            try:
                table_sessions = load_table_sessions()
                health_status["active_sessions"] = len(table_sessions)
            except:
                health_status["data_files"]["table_sessions"] = "corrupted"
                health_status["status"] = "degraded"
        else:
            health_status["data_files"]["table_sessions"] = "ok"  # Empty sessions file is normal

        # Check table history file
        table_history_file = os.path.join(DATA_DIR, 'table_history.json')
        if os.path.exists(table_history_file) and os.access(table_history_file, os.R_OK):
            health_status["data_files"]["table_history"] = "ok"
        else:
            health_status["data_files"]["table_history"] = "ok"  # Missing history is normal for new installations

        # Check printer status
        try:
            printers = [printer[2] for printer in win32print.EnumPrinters(2)]
            if printers:
                health_status["printer_status"] = "available"
                health_status["available_printers"] = len(printers)
            else:
                health_status["printer_status"] = "none_found"
        except Exception as e:
            health_status["printer_status"] = "error"
            health_status["printer_error"] = str(e)

        # Overall health assessment
        if health_status["data_files"]["tables_config"] != "ok":
            health_status["status"] = "unhealthy"
        elif any(status == "corrupted" for status in health_status["data_files"].values()):
            health_status["status"] = "degraded"

        return jsonify(health_status)

    except Exception as e:
        app.logger.error(f"Failed to check table health: {e}")
        return jsonify({
            "status": "error",
            "table_management_enabled": True,
            "message": f"Health check failed: {str(e)}"
        }), 500

@app.route('/api/tables/add', methods=['POST'])
def add_table():
    """Add new table to configuration"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400

        # Validate required fields
        table_id = str(data.get("table_id", "")).strip()
        table_name = str(data.get("name", "")).strip()
        seats = data.get("seats")

        if not table_id:
            return jsonify({"status": "error", "message": "table_id is required"}), 400

        if not table_name:
            return jsonify({"status": "error", "message": "name is required"}), 400

        if not isinstance(seats, int) or seats < 1 or seats > 50:
            return jsonify({"status": "error", "message": "seats must be a number between 1 and 50"}), 400

        # Load current configuration
        tables_config = load_tables_config()

        # Check if table ID already exists
        if table_id in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": f"Table ID '{table_id}' already exists"}), 409

        # Check if table name already exists
        for existing_id, existing_table in tables_config.get("tables", {}).items():
            if existing_table.get("name", "").lower() == table_name.lower():
                return jsonify({"status": "error", "message": f"Table name '{table_name}' already exists"}), 409

        # Add new table
        new_table = {
            "name": table_name,
            "seats": seats,
            "status": "available"
        }

        if "tables" not in tables_config:
            tables_config["tables"] = {}

        tables_config["tables"][table_id] = new_table

        # Save configuration
        if save_tables_config(tables_config):
            # Invalidate cache
            invalidate_table_cache()

            # Broadcast table configuration update via SSE
            _sse_broadcast('table_added', {
                "table_id": table_id,
                "table": new_table
            })

            app.logger.info(f"Added new table: {table_id} - {table_name} ({seats} seats)")

            return jsonify({
                "status": "success",
                "message": "Table added successfully",
                "table": {
                    "table_id": table_id,
                    **new_table
                }
            })
        else:
            return jsonify({"status": "error", "message": "Failed to save table configuration"}), 500

    except Exception as e:
        app.logger.error(f"Failed to add table: {e}")
        return jsonify({"status": "error", "message": f"Failed to add table: {str(e)}"}), 500

@app.route('/api/tables/<table_id>/configure', methods=['PUT'])
def update_table_config(table_id):
    """Update table properties"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        data = request.get_json()
        if not data:
            return jsonify({"status": "error", "message": "No data provided"}), 400

        # Load current configuration
        tables_config = load_tables_config()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": f"Table '{table_id}' not found"}), 404

        current_table = tables_config["tables"][table_id]

        # Validate and update fields
        if "name" in data:
            new_name = str(data["name"]).strip()
            if not new_name:
                return jsonify({"status": "error", "message": "name cannot be empty"}), 400

            # Check if name conflicts with other tables
            for existing_id, existing_table in tables_config.get("tables", {}).items():
                if existing_id != table_id and existing_table.get("name", "").lower() == new_name.lower():
                    return jsonify({"status": "error", "message": f"Table name '{new_name}' already exists"}), 409

            current_table["name"] = new_name

        if "seats" in data:
            seats = data["seats"]
            if not isinstance(seats, int) or seats < 1 or seats > 50:
                return jsonify({"status": "error", "message": "seats must be a number between 1 and 50"}), 400

            current_table["seats"] = seats

        if "status" in data:
            status = str(data["status"]).strip()
            if status not in ["available", "occupied", "reserved", "out_of_order"]:
                return jsonify({"status": "error", "message": "Invalid status. Must be: available, occupied, reserved, or out_of_order"}), 400

            current_table["status"] = status

        # Save configuration
        if save_tables_config(tables_config):
            # Invalidate cache
            invalidate_table_cache()

            # Broadcast table configuration update via SSE
            _sse_broadcast('table_updated', {
                "table_id": table_id,
                "table": current_table
            })

            app.logger.info(f"Updated table configuration: {table_id}")

            return jsonify({
                "status": "success",
                "message": "Table updated successfully",
                "table": {
                    "table_id": table_id,
                    **current_table
                }
            })
        else:
            return jsonify({"status": "error", "message": "Failed to save table configuration"}), 500

    except Exception as e:
        app.logger.error(f"Failed to update table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to update table: {str(e)}"}), 500

@app.route('/api/tables/<table_id>', methods=['DELETE'])
def delete_table(table_id):
    """Remove table from configuration (only if no active session)"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        # Load current configuration and sessions
        tables_config = load_tables_config()
        table_sessions = load_table_sessions()

        if table_id not in tables_config.get("tables", {}):
            return jsonify({"status": "error", "message": f"Table '{table_id}' not found"}), 404

        # Check if table has active session
        if table_id in table_sessions:
            return jsonify({
                "status": "error",
                "message": f"Cannot delete table '{table_id}' - has active session. Close session first."
            }), 409

        # Remove table from configuration
        table_name = tables_config["tables"][table_id].get("name", table_id)
        del tables_config["tables"][table_id]

        # Save configuration
        if save_tables_config(tables_config):
            # Invalidate cache
            invalidate_table_cache()

            # Broadcast table deletion via SSE
            _sse_broadcast('table_deleted', {
                "table_id": table_id,
                "table_name": table_name
            })

            app.logger.info(f"Deleted table: {table_id} - {table_name}")

            return jsonify({
                "status": "success",
                "message": f"Table '{table_name}' deleted successfully"
            })
        else:
            return jsonify({"status": "error", "message": "Failed to save table configuration"}), 500

    except Exception as e:
        app.logger.error(f"Failed to delete table {table_id}: {e}")
        return jsonify({"status": "error", "message": f"Failed to delete table: {str(e)}"}), 500

@app.route('/api/tables/bulk-clear', methods=['POST'])
def bulk_clear_tables():
    """Clear multiple paid tables at once"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        data = request.get_json()
        if not data or "table_ids" not in data:
            return jsonify({"status": "error", "message": "table_ids array is required"}), 400

        table_ids = data.get("table_ids", [])
        if not isinstance(table_ids, list) or not table_ids:
            return jsonify({"status": "error", "message": "table_ids must be a non-empty array"}), 400

        # Load current configuration and sessions
        tables_config = load_tables_config()
        table_sessions = load_table_sessions()

        results = {
            "cleared": [],
            "failed": [],
            "skipped": []
        }

        for table_id in table_ids:
            table_id = str(table_id)

            # Validate table exists
            if table_id not in tables_config.get("tables", {}):
                results["failed"].append({
                    "table_id": table_id,
                    "reason": "Table not found"
                })
                continue

            # Check if table has session
            if table_id not in table_sessions:
                results["skipped"].append({
                    "table_id": table_id,
                    "reason": "No active session"
                })
                continue

            session = table_sessions[table_id]

            # Check if table is fully paid
            total_amount = session.get("total_amount", 0)
            amount_paid = session.get("amount_paid", 0)

            if amount_paid < total_amount:
                results["skipped"].append({
                    "table_id": table_id,
                    "reason": f"Not fully paid (${amount_paid:.2f} of ${total_amount:.2f})"
                })
                continue

            # Clear the table
            try:
                if clear_table_session(table_id):
                    results["cleared"].append({
                        "table_id": table_id,
                        "table_name": tables_config["tables"][table_id].get("name", table_id)
                    })
                else:
                    results["failed"].append({
                        "table_id": table_id,
                        "reason": "Failed to clear session"
                    })
            except Exception as e:
                results["failed"].append({
                    "table_id": table_id,
                    "reason": str(e)
                })

        # Invalidate cache after bulk operations
        if results["cleared"]:
            invalidate_table_cache()

        app.logger.info(f"Bulk clear operation: {len(results['cleared'])} cleared, {len(results['failed'])} failed, {len(results['skipped'])} skipped")

        return jsonify({
            "status": "success",
            "message": f"Bulk clear completed: {len(results['cleared'])} tables cleared",
            "results": results
        })

    except Exception as e:
        app.logger.error(f"Failed to bulk clear tables: {e}")
        return jsonify({"status": "error", "message": f"Failed to bulk clear tables: {str(e)}"}), 500

@app.route('/api/tables/summary', methods=['GET'])
def get_table_summary():
    """Get complete table system summary"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        # Load configuration and sessions
        tables_config = load_tables_config()
        table_sessions = load_table_sessions()

        summary = {
            "total_tables": len(tables_config.get("tables", {})),
            "active_sessions": len(table_sessions),
            "table_statuses": {
                "available": 0,
                "occupied": 0,
                "reserved": 0,
                "out_of_order": 0
            },
            "revenue_summary": {
                "total_unpaid": 0.0,
                "total_paid": 0.0,
                "pending_payment": 0.0
            },
            "session_summary": {
                "fully_paid": 0,
                "partially_paid": 0,
                "unpaid": 0
            }
        }

        # Analyze table statuses
        for table_id, table_info in tables_config.get("tables", {}).items():
            status = table_info.get("status", "available")

            # Adjust status based on active sessions
            if table_id in table_sessions:
                if status == "available":
                    status = "occupied"

            summary["table_statuses"][status] = summary["table_statuses"].get(status, 0) + 1

        # Analyze session financials
        for table_id, session in table_sessions.items():
            total_amount = session.get("total_amount", 0)
            amount_paid = session.get("amount_paid", 0)

            summary["revenue_summary"]["total_unpaid"] += total_amount
            summary["revenue_summary"]["total_paid"] += amount_paid
            summary["revenue_summary"]["pending_payment"] += (total_amount - amount_paid)

            # Categorize payment status
            if amount_paid >= total_amount:
                summary["session_summary"]["fully_paid"] += 1
            elif amount_paid > 0:
                summary["session_summary"]["partially_paid"] += 1
            else:
                summary["session_summary"]["unpaid"] += 1

        # Round financial values
        for key in summary["revenue_summary"]:
            summary["revenue_summary"][key] = round(summary["revenue_summary"][key], 2)

        return jsonify({
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "summary": summary
        })

    except Exception as e:
        app.logger.error(f"Failed to get table summary: {e}")
        return jsonify({"status": "error", "message": f"Failed to get table summary: {str(e)}"}), 500

@app.route('/api/tables/integrity-check', methods=['GET'])
def check_table_integrity():
    """Check data integrity of table management system"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        # Rate limiting for integrity checks
        client_id = get_client_identifier(request)
        rate_ok, rate_msg = check_rate_limit(client_id, "integrity_check", max_requests=10, window_seconds=300)
        if not rate_ok:
            return jsonify({"status": "error", "message": rate_msg}), 429

        integrity_report = check_data_file_integrity()

        # Additional cross-validation checks
        try:
            tables_config = load_tables_config()
            table_sessions = load_table_sessions()

            # Check for orphaned sessions (sessions for non-existent tables)
            orphaned_sessions = []
            for table_id in table_sessions.keys():
                if table_id not in tables_config.get("tables", {}):
                    orphaned_sessions.append(table_id)

            if orphaned_sessions:
                integrity_report["cross_validation"] = {
                    "status": "issues_found",
                    "issues": [f"Orphaned sessions found for tables: {', '.join(orphaned_sessions)}"]
                }
            else:
                integrity_report["cross_validation"] = {
                    "status": "ok",
                    "issues": []
                }

        except Exception as e:
            integrity_report["cross_validation"] = {
                "status": "error",
                "issues": [f"Cross-validation failed: {str(e)}"]
            }

        # Determine overall status
        overall_status = "healthy"
        total_issues = 0

        for section, report in integrity_report.items():
            if report["status"] in ["corrupted", "error"]:
                overall_status = "unhealthy"
            elif report["status"] == "issues_found":
                overall_status = "needs_attention"
            total_issues += len(report.get("issues", []))

        log_table_operation("integrity_check", "system", client_id, {
            "overall_status": overall_status,
            "total_issues": total_issues
        })

        return jsonify({
            "status": "success",
            "overall_status": overall_status,
            "total_issues": total_issues,
            "timestamp": datetime.now().isoformat(),
            "details": integrity_report
        })

    except Exception as e:
        app.logger.error(f"Failed to check table integrity: {e}")
        return jsonify({"status": "error", "message": f"Integrity check failed: {str(e)}"}), 500

@app.route('/api/tables/cleanup', methods=['POST'])
def cleanup_table_system():
    """Cleanup old table data and optimize system"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        # Rate limiting for cleanup operations
        client_id = get_client_identifier(request)
        rate_ok, rate_msg = check_rate_limit(client_id, "cleanup", max_requests=5, window_seconds=600)
        if not rate_ok:
            return jsonify({"status": "error", "message": rate_msg}), 429

        cleanup_results = {
            "sessions_cleaned": 0,
            "backups_cleaned": 0,
            "cache_cleared": False,
            "errors": []
        }

        # Cleanup old sessions
        try:
            original_sessions = load_table_sessions()
            original_count = len(original_sessions)
            cleanup_old_table_sessions()
            new_sessions = load_table_sessions()
            cleanup_results["sessions_cleaned"] = original_count - len(new_sessions)
        except Exception as e:
            cleanup_results["errors"].append(f"Session cleanup failed: {str(e)}")

        # Cleanup old backup files
        try:
            backup_files = [
                'tables_config.json.backup',
                'table_sessions.json.backup'
            ]
            cleaned_backups = 0
            for backup_file in backup_files:
                backup_path = os.path.join(DATA_DIR, backup_file)
                if os.path.exists(backup_path):
                    try:
                        # Keep only recent backups (last 7 days)
                        file_age = time.time() - os.path.getmtime(backup_path)
                        if file_age > 7 * 24 * 3600:  # 7 days in seconds
                            os.remove(backup_path)
                            cleaned_backups += 1
                    except Exception as e:
                        cleanup_results["errors"].append(f"Failed to clean backup {backup_file}: {str(e)}")
            cleanup_results["backups_cleaned"] = cleaned_backups
        except Exception as e:
            cleanup_results["errors"].append(f"Backup cleanup failed: {str(e)}")

        # Clear table cache
        try:
            invalidate_table_cache()
            cleanup_results["cache_cleared"] = True
        except Exception as e:
            cleanup_results["errors"].append(f"Cache clear failed: {str(e)}")

        # Log cleanup operation
        log_table_operation("cleanup", "system", client_id, cleanup_results)

        # Broadcast system maintenance event
        broadcast_table_event("system_maintenance", {
            "type": "cleanup",
            "results": cleanup_results
        })

        return jsonify({
            "status": "success",
            "message": "Table system cleanup completed",
            "results": cleanup_results
        })

    except Exception as e:
        app.logger.error(f"Failed to cleanup table system: {e}")
        return jsonify({"status": "error", "message": f"Cleanup failed: {str(e)}"}), 500

# --- Performance Monitoring for Table Operations ---

@app.route('/api/tables/performance', methods=['GET'])
def get_table_performance_metrics():
    """Get performance metrics for table management system"""
    if not is_table_management_enabled():
        return jsonify({"status": "error", "message": "Table management is not enabled"}), 400

    try:
        # Rate limiting
        client_id = get_client_identifier(request)
        rate_ok, rate_msg = check_rate_limit(client_id, "performance_metrics", max_requests=30, window_seconds=60)
        if not rate_ok:
            return jsonify({"status": "error", "message": rate_msg}), 429

        # Gather performance metrics
        metrics = {
            "cache_status": {
                "enabled": True,
                "ttl_seconds": TABLE_CACHE_TTL,
                "cached": bool(_table_status_cache),
                "cache_age": time.time() - _table_cache_time if _table_cache_time > 0 else None
            },
            "file_sizes": {},
            "operation_counts": {},
            "response_times": {
                "avg_load_config": 0,
                "avg_load_sessions": 0,
                "avg_save_operations": 0
            }
        }

        # File size metrics
        data_files = [
            'tables_config.json',
            'table_sessions.json',
            'table_history.json',
            'table_audit.json'
        ]

        for filename in data_files:
            filepath = os.path.join(DATA_DIR, filename)
            if os.path.exists(filepath):
                metrics["file_sizes"][filename] = os.path.getsize(filepath)
            else:
                metrics["file_sizes"][filename] = 0

        # Operation counts from rate limiter
        current_time = time.time()
        with _table_operation_lock:
            for key, data in _table_operation_counters.items():
                if current_time - data["last_reset"] < 3600:  # Last hour
                    operation_type = key.split(':')[-1]
                    if operation_type not in metrics["operation_counts"]:
                        metrics["operation_counts"][operation_type] = 0
                    metrics["operation_counts"][operation_type] += data["count"]

        return jsonify({
            "status": "success",
            "timestamp": datetime.now().isoformat(),
            "metrics": metrics
        })

    except Exception as e:
        app.logger.error(f"Failed to get performance metrics: {e}")
        return jsonify({"status": "error", "message": f"Failed to get metrics: {str(e)}"}), 500


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
            import threading
            current_thread = threading.current_thread()
            threads_to_join = []

            for thread in threading.enumerate():
                if thread != current_thread and thread.is_alive() and not thread.daemon:
                    app.logger.info(f"Found active non-daemon thread: {thread.name}")
                    threads_to_join.append(thread)

            # Give threads a chance to finish gracefully
            for thread in threads_to_join:
                try:
                    thread.join(timeout=2.0)  # Wait up to 2 seconds per thread
                    if thread.is_alive():
                        app.logger.warning(f"Thread {thread.name} did not terminate gracefully")
                except Exception as e:
                    app.logger.warning(f"Error joining thread {thread.name}: {e}")

            app.logger.info("Background thread cleanup completed")
        except Exception as e:
            app.logger.error(f"Error during background thread cleanup: {e}")
        
        # Step 6: Give time for cleanup to complete
        app.logger.info("Waiting for cleanup to complete...")
        time.sleep(1.0)

        # Step 6.5: Gracefully shutdown Waitress server
        if _server_instance:
            try:
                app.logger.info("Shutting down Waitress server...")
                _server_instance.close()
                app.logger.info("Waitress server shutdown completed")
                time.sleep(1.0)  # Allow server to fully close
            except Exception as e:
                app.logger.error(f"Error shutting down Waitress server: {e}")

        # Step 7: Attempt graceful shutdown using multiple methods
        app.logger.info("Initiating process termination...")
        
        # For Windows, try multiple termination methods for reliability
        if os.name == 'nt':  # Windows
            try:
                # Method 1: Kill the specific process and its children
                app.logger.info("Terminating POSPal process tree...")
                subprocess.run([
                    'taskkill', '/F', '/T', '/PID', str(os.getpid())
                ], capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS)

                # If we reach here, taskkill didn't work immediately
                app.logger.info("Primary termination method completed")
                time.sleep(1.0)

            except subprocess.TimeoutExpired:
                app.logger.warning("Process termination timeout, using fallback")
            except Exception as e:
                app.logger.error(f"Process termination failed: {e}")
        
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


def print_table_bill_ticket(bill_data):
    """
    Print a formatted table bill using POSPal's existing printing infrastructure.
    Follows the same patterns as print_kitchen_ticket for Windows compatibility.
    """
    # Pre-flight checks (same as print_kitchen_ticket)
    global last_print_used_fallback
    last_print_used_fallback = False
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        app.logger.warning("Printing blocked - trial expired")
        return False

    if not PRINTER_NAME or PRINTER_NAME == "Your_Printer_Name_Here":
        app.logger.error(f"CRITICAL: PRINTER_NAME is not configured. Cannot print table bill.")
        return False

    # PDF printers are not supported
    if 'pdf' in str(PRINTER_NAME).lower():
        app.logger.error(f"Selected printer '{PRINTER_NAME}' appears to be a PDF device, which is not supported for bill printing.")
        return False

    # Build the bill ticket content
    try:
        ticket_content = bytearray()
        ticket_content += InitializePrinter

        NORMAL_FONT_LINE_WIDTH = 42

        # Header - Restaurant name and title
        ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
        restaurant_name = "POSPal"
        ticket_content += to_bytes(restaurant_name + "\n")
        ticket_content += BoldOff

        # Bill title with table info
        ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
        table_name = bill_data.get('table_name', f"Table {bill_data.get('table_id', 'Unknown')}")
        seats = bill_data.get('seats', '')
        seats_text = f" ({seats} seats)" if seats else ""
        bill_title = f"TABLE BILL - {table_name}{seats_text}"
        ticket_content += to_bytes(bill_title + "\n")
        ticket_content += BoldOff

        # Date and time
        ticket_content += AlignLeft + SelectFontA + NormalText
        current_time = datetime.now()
        ticket_content += to_bytes(f"Date: {current_time.strftime('%d/%m/%Y')}  Time: {current_time.strftime('%H:%M')}\n")

        # Separator
        ticket_content += to_bytes("=" * NORMAL_FONT_LINE_WIDTH + "\n")

        # Orders section
        grand_total = 0.0
        order_count = 0

        for order in bill_data.get('orders', []):
            order_count += 1
            order_number = order.get('order_number', 'N/A')
            order_time = order.get('time', 'N/A')

            # Order header
            ticket_content += SelectFontA + BoldOn
            ticket_content += to_bytes(f"ORDER #{order_number} - {order_time}\n")
            ticket_content += BoldOff

            # Order items
            for item in order.get('items', []):
                item_name = item.get('name', 'Unknown Item')
                item_quantity = item.get('quantity', 1)
                item_price = float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0)))
                line_total = item_quantity * item_price
                grand_total += line_total

                # Format item line: "- Item Name          €Price"
                left_side = f"- {item_quantity}x {item_name}"
                right_side = f"€{line_total:.2f}"

                # Calculate padding to right-align price
                available_space = NORMAL_FONT_LINE_WIDTH - len(left_side) - len(right_side)
                padding = " " * max(1, available_space)

                ticket_content += to_bytes(f"{left_side}{padding}{right_side}\n")

                # Add item options/modifiers if any
                general_options = item.get('generalSelectedOptions', [])
                if general_options:
                    for opt in general_options:
                        opt_name = opt.get('name', 'N/A')
                        opt_price_change = float(opt.get('priceChange', 0.0))
                        price_change_str = f" ({'+' if opt_price_change > 0 else ''}{opt_price_change:.2f})" if opt_price_change != 0 else ""
                        option_line = f"    + {opt_name}{price_change_str}"
                        ticket_content += to_bytes(option_line + "\n")

                # Add item comments if any
                item_comments = item.get('comments', '').strip()
                if item_comments:
                    for comment_line in item_comments.split('\n'):
                        if comment_line.strip():
                            ticket_content += to_bytes(f"    Note: {comment_line.strip()}\n")

            ticket_content += to_bytes("\n")  # Space between orders

        # Summary section
        ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
        ticket_content += SelectFontA + BoldOn
        ticket_content += to_bytes(f"Total Orders: {order_count}\n")

        # Grand total
        total_left = "TOTAL:"
        total_right = f"€{grand_total:.2f}"
        total_padding = " " * (NORMAL_FONT_LINE_WIDTH - len(total_left) - len(total_right))
        ticket_content += to_bytes(f"{total_left}{total_padding}{total_right}\n")
        ticket_content += BoldOff

        # Payment status
        ticket_content += to_bytes("\n")
        payment_status = bill_data.get('payment_status', 'unpaid').upper()
        if payment_status == 'UNPAID':
            status_display = "[  PENDING  ]"
        elif payment_status == 'PARTIAL':
            amount_paid = bill_data.get('amount_paid', 0.0)
            amount_remaining = bill_data.get('amount_remaining', grand_total)
            status_display = f"[PARTIAL: €{amount_paid:.2f} paid, €{amount_remaining:.2f} remaining]"
        else:  # PAID
            status_display = "[  PAID  ]"

        ticket_content += AlignCenter
        ticket_content += to_bytes(f"Payment: {status_display}\n")
        ticket_content += AlignLeft

        # Footer
        ticket_content += to_bytes("=" * NORMAL_FONT_LINE_WIDTH + "\n")

        # Cut paper if configured
        if CUT_AFTER_PRINT:
            ticket_content += PartialCut

    except Exception as e:
        app.logger.error(f"Failed to build table bill content: {e}")
        return False

    # Print the bill (same pattern as print_kitchen_ticket)
    print_attempts = 0
    max_attempts = COPIES_PER_ORDER
    printed_any = False

    for attempt in range(max_attempts):
        print_attempts += 1
        copy_info = f"Copy {print_attempts}" if max_attempts > 1 else ""

        if print_table_bill_raw(ticket_content, bill_data, copy_info):
            printed_any = True
        else:
            app.logger.warning(f"Table bill print attempt {print_attempts} failed")

    return printed_any


def print_table_bill_raw(ticket_content, bill_data, copy_info=""):
    """
    Raw printing function for table bills, following print_kitchen_ticket patterns.
    """
    hprinter = None
    doc_started = False
    try:
        table_id = bill_data.get('table_id', 'Unknown')
        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for table {table_id} bill{f' ({copy_info})' if copy_info else ''}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)

        # Check printer status (same as print_kitchen_ticket)
        printer_info = win32print.GetPrinter(hprinter, 2)
        current_status = printer_info['Status']
        app.logger.info(f"Printer '{PRINTER_NAME}' current status code: {hex(current_status)}")

        PRINTER_STATUS_OFFLINE = 0x00000080; PRINTER_STATUS_ERROR = 0x00000002
        PRINTER_STATUS_NOT_AVAILABLE = 0x00001000; PRINTER_STATUS_PAPER_OUT = 0x00000010
        PRINTER_STATUS_USER_INTERVENTION = 0x00000200; PRINTER_STATUS_PAPER_JAM = 0x00000008

        problematic_statuses = [
            PRINTER_STATUS_OFFLINE, PRINTER_STATUS_ERROR, PRINTER_STATUS_NOT_AVAILABLE,
            PRINTER_STATUS_PAPER_OUT, PRINTER_STATUS_USER_INTERVENTION, PRINTER_STATUS_PAPER_JAM
        ]

        if any(current_status & status for status in problematic_statuses):
            status_messages = []
            if current_status & PRINTER_STATUS_OFFLINE: status_messages.append("OFFLINE")
            if current_status & PRINTER_STATUS_ERROR: status_messages.append("ERROR")
            if current_status & PRINTER_STATUS_NOT_AVAILABLE: status_messages.append("NOT_AVAILABLE")
            if current_status & PRINTER_STATUS_PAPER_OUT: status_messages.append("PAPER_OUT")
            if current_status & PRINTER_STATUS_USER_INTERVENTION: status_messages.append("USER_INTERVENTION")
            if current_status & PRINTER_STATUS_PAPER_JAM: status_messages.append("PAPER_JAM")

            app.logger.warning(f"Printer '{PRINTER_NAME}' has problematic status: {', '.join(status_messages)}")
            return False

        app.logger.info(f"Printer '{PRINTER_NAME}' status appears operational. Proceeding with table bill print.")

        # Print the document
        doc_name = f"POSPal Table {table_id} Bill"
        win32print.StartDocPrinter(hprinter, 1, (doc_name, None, "RAW"))
        doc_started = True

        win32print.StartPagePrinter(hprinter)
        win32print.WritePrinter(hprinter, bytes(ticket_content))
        win32print.EndPagePrinter(hprinter)

        app.logger.info(f"Table {table_id} bill data sent to printer spooler for '{PRINTER_NAME}'.")
        return True

    except (win32print.error, Exception) as e:
        table_id = bill_data.get('table_id', 'Unknown')
        app.logger.error(f"A printing error occurred for table {table_id} bill{f' ({copy_info})' if copy_info else ''} with printer '{PRINTER_NAME}'. Error: {str(e)}")
        return False

    finally:
        # Clean up printer resources
        if doc_started and hprinter:
            try:
                win32print.EndDocPrinter(hprinter)
            except Exception as e_doc:
                app.logger.error(f"Error ending document on printer '{PRINTER_NAME}': {str(e_doc)}")
        if hprinter:
            try:
                win32print.ClosePrinter(hprinter)
            except Exception as e_close:
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")


def build_customer_receipt_content(receipt_data):
    """Generate ESC/POS byte content for a customer receipt."""
    app.logger.info(
        f"[RECEIPT] Building enhanced customer receipt for table {receipt_data.get('table_id')} "
        f"payment {receipt_data.get('payment', {}).get('payment_id')}"
    )
    ticket_content = bytearray()
    ticket_content += InitializePrinter
    ticket_content += ESC + b't\x13'

    NORMAL_FONT_LINE_WIDTH = 42
    SMALL_FONT_LINE_WIDTH = 56

    business_profile = receipt_data.get('business_profile') or get_business_identity()
    restaurant_name = business_profile.get('name') or "POSPal"

    ticket_content += AlignCenter + SelectFontA + DoubleHeightWidth + BoldOn
    ticket_content += to_bytes(restaurant_name + "\n")
    ticket_content += BoldOff

    contact_lines = []
    for key in ('address', 'phone', 'email', 'website'):
        value = business_profile.get(key)
        if isinstance(value, str) and value.strip():
            contact_lines.append(value.strip())
    tax_id = business_profile.get('tax_id')
    if isinstance(tax_id, str) and tax_id.strip():
        contact_lines.append(f"Tax ID: {tax_id.strip()}")

    if contact_lines:
        ticket_content += AlignCenter + SelectFontB + NormalText
        for line in contact_lines:
            for wrapped_line in word_wrap_text(line, SMALL_FONT_LINE_WIDTH):
                ticket_content += to_bytes(wrapped_line + "\n")
        ticket_content += AlignLeft + SelectFontA + NormalText
    else:
        ticket_content += AlignCenter + SelectFontB + NormalText
        ticket_content += to_bytes("Add business info via Settings > Business Profile\n")
        ticket_content += AlignLeft + SelectFontA + NormalText

    ticket_content += AlignCenter + SelectFontA + DoubleWidth + BoldOn
    ticket_content += to_bytes("Customer Receipt\n")
    ticket_content += BoldOff
    ticket_content += AlignLeft + SelectFontA + NormalText
    ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")

    def append_wrapped(text: str, indent: int = 0, width: int = NORMAL_FONT_LINE_WIDTH):
        if not text:
            return
        indent_str = " " * indent
        wrap_width = max(1, width - indent)
        for line in word_wrap_text(text, wrap_width, initial_indent=indent_str, subsequent_indent=indent_str):
            ticket_content += to_bytes(line + "\n")

    def append_amount_line(label: str, amount, indent: int = 0):
        amount_str = format_currency(amount)
        indent_str = " " * indent
        label_text = f"{indent_str}{label.strip()}"
        available = NORMAL_FONT_LINE_WIDTH - len(amount_str)
        if available <= len(indent_str):
            append_wrapped(label_text.strip(), indent=indent)
            ticket_content += to_bytes(indent_str + amount_str + "\n")
            return
        if len(label_text) <= available:
            padding = available - len(label_text)
            ticket_content += to_bytes(f"{label_text}{' ' * padding}{amount_str}\n")
            return
        label_lines = word_wrap_text(label_text.strip(), available, initial_indent=indent_str, subsequent_indent=indent_str)
        if not label_lines:
            append_wrapped(label_text.strip(), indent=indent)
            ticket_content += to_bytes(indent_str + amount_str + "\n")
            return
        first_line = label_lines[0]
        padding = available - len(first_line)
        if padding < 1:
            ticket_content += to_bytes(first_line + "\n")
            for extra_line in label_lines[1:]:
                ticket_content += to_bytes(extra_line + "\n")
            ticket_content += to_bytes(indent_str + amount_str + "\n")
        else:
            ticket_content += to_bytes(f"{first_line}{' ' * padding}{amount_str}\n")
            for extra_line in label_lines[1:]:
                ticket_content += to_bytes(extra_line + "\n")

    def append_label_value(label: str, value):
        if value is None or value == "":
            return
        append_wrapped(f"{label}: {value}")

    timestamp_iso = receipt_data.get("timestamp")
    printed_at = datetime.now()
    if isinstance(timestamp_iso, str):
        try:
            printed_at = datetime.fromisoformat(timestamp_iso)
        except ValueError:
            try:
                printed_at = datetime.fromisoformat(timestamp_iso.replace('Z', '+00:00'))
            except Exception:
                printed_at = datetime.now()

    date_display = printed_at.strftime('%d/%m/%Y')
    time_display = printed_at.strftime('%H:%M')

    table_name = receipt_data.get('table_name', f"Table {receipt_data.get('table_id', 'Unknown')}")
    seats = receipt_data.get('seats')
    payment = receipt_data.get('payment', {}) or {}
    payment_id = payment.get('payment_id', '')
    payment_method = (payment.get('method') or 'Unknown').replace('_', ' ').title()
    payment_note = payment.get('note', '').strip()
    payments_history = receipt_data.get('payments') or []
    orders = receipt_data.get('orders') or []
    total_payments = receipt_data.get('total_payments', len(payments_history) or 1)
    payment_index = None
    if payment_id:
        for idx, entry in enumerate(payments_history, start=1):
            if entry.get('payment_id') == payment_id:
                payment_index = idx
                break

    append_wrapped(f"Date: {date_display}    Time: {time_display}")
    if seats:
        append_wrapped(f"Table: {table_name}    Covers: {seats}")
    else:
        append_wrapped(f"Table: {table_name}")
    if payment_index and total_payments:
        append_wrapped(f"Payment {payment_index} of {total_payments}")
    elif total_payments > 1:
        append_wrapped(f"Payment count: {total_payments}")
    if payment_id:
        append_wrapped(f"Receipt ID: {payment_id[:8].upper()}")

    ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")

    ticket_content += SelectFontA + BoldOn
    ticket_content += to_bytes("Items\n")
    ticket_content += BoldOff

    items_subtotal = Decimal('0')
    item_lines_printed = False
    multiple_orders = len(orders) > 1

    for order in orders:
        order_number = order.get('order_number') or order.get('orderNumber') or order.get('number')
        order_timestamp = order.get('timestamp') or order.get('time')
        order_time_display = ""
        if isinstance(order_timestamp, str):
            try:
                order_time_display = datetime.fromisoformat(order_timestamp).strftime('%H:%M')
            except ValueError:
                try:
                    order_time_display = datetime.fromisoformat(order_timestamp.replace('Z', '+00:00')).strftime('%H:%M')
                except Exception:
                    order_time_display = order_timestamp
        if multiple_orders:
            order_header = f"Order {order_number}" if order_number else "Order"
            if order_time_display:
                order_header += f" - {order_time_display}"
            ticket_content += SelectFontA + BoldOn
            ticket_content += to_bytes(order_header + "\n")
            ticket_content += BoldOff
        for item in order.get('items', []):
            name = item.get('name', 'Item')
            quantity = item.get('quantity', 1)
            quantity_display = f"{quantity} x " if quantity and quantity != 1 else ""
            price = item.get('price')
            if price is None:
                price = item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))
            line_total = to_decimal(price) * to_decimal(quantity or 1)
            items_subtotal += line_total
            append_amount_line(f"{quantity_display}{name}", line_total)
            options = item.get('generalSelectedOptions') or []
            for option in options:
                option_name = ""
                option_delta = Decimal('0')
                if isinstance(option, dict):
                    option_name = option.get('name') or option.get('value') or ''
                    option_delta = to_decimal(option.get('priceChange', 0))
                else:
                    option_name = str(option)
                if option_delta != Decimal('0'):
                    prefix = "+" if option_delta > 0 else "-"
                    append_amount_line(f"{prefix} {option_name}", option_delta, indent=2)
                else:
                    append_wrapped(f"+ {option_name}", indent=4)
            item_comment = (item.get('comment') or item.get('comments') or '').strip()
            if item_comment:
                append_wrapped(f"Note: {item_comment}", indent=4)
            item_lines_printed = True
        if multiple_orders:
            ticket_content += to_bytes("\n")

    if not item_lines_printed:
        append_wrapped("No item details available for this receipt.")

    ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")

    ticket_content += SelectFontA + BoldOn
    ticket_content += to_bytes("Summary\n")
    ticket_content += BoldOff

    bill_total = to_decimal(receipt_data.get('bill_total', 0.0))
    total_paid = to_decimal(receipt_data.get('amount_paid_total', 0.0))
    payment_amount = to_decimal(payment.get('amount', 0.0))
    previous_paid = sum(
        (to_decimal(entry.get('amount', 0.0)) for entry in payments_history if entry.get('payment_id') != payment_id),
        Decimal('0')
    )
    balance_after = bill_total - total_paid
    change_due = Decimal('0')
    if balance_after < Decimal('0'):
        change_due = -balance_after
        balance_after = Decimal('0')

    if item_lines_printed and abs(items_subtotal - bill_total) > Decimal('0.01'):
        append_amount_line("Items subtotal", items_subtotal)
    append_amount_line("Bill total", bill_total)
    if previous_paid > Decimal('0'):
        append_amount_line("Paid before today", previous_paid)
    append_amount_line("Payment received", payment_amount)
    append_amount_line("Total paid", total_paid)

    if change_due > Decimal('0'):
        append_amount_line("Change due", change_due)
    else:
        append_amount_line("Balance due", balance_after)

    payment_status = (receipt_data.get('payment_status') or 'unpaid').replace('_', ' ').title()
    append_label_value("Payment status", payment_status)

    ticket_content += to_bytes("\n")
    ticket_content += SelectFontA + BoldOn
    ticket_content += to_bytes("Payment Details\n")
    ticket_content += BoldOff
    append_label_value("Method", payment_method)
    payment_timestamp = payment.get('timestamp')
    if isinstance(payment_timestamp, str):
        payment_time = None
        try:
            payment_time = datetime.fromisoformat(payment_timestamp)
        except ValueError:
            try:
                payment_time = datetime.fromisoformat(payment_timestamp.replace('Z', '+00:00'))
            except Exception:
                payment_time = None
        if payment_time:
            append_label_value("Processed", payment_time.strftime('%d/%m/%Y %H:%M'))
    if payment_note:
        append_wrapped(f"Note: {payment_note}", indent=2)

    if len(payments_history) > 1:
        ticket_content += to_bytes("\n")
        ticket_content += SelectFontA + BoldOn
        ticket_content += to_bytes("Payment History\n")
        ticket_content += BoldOff
        for entry in payments_history:
            entry_time = entry.get('timestamp')
            entry_dt = None
            if isinstance(entry_time, str):
                try:
                    entry_dt = datetime.fromisoformat(entry_time)
                except ValueError:
                    try:
                        entry_dt = datetime.fromisoformat(entry_time.replace('Z', '+00:00'))
                    except Exception:
                        entry_dt = None
            entry_label_time = entry_dt.strftime('%d/%m %H:%M') if entry_dt else ''
            entry_method = (entry.get('method') or 'Unknown').replace('_', ' ').title()
            history_label = f"{entry_label_time} {entry_method}".strip()
            append_amount_line(history_label or "Payment", entry.get('amount', 0.0))

    ticket_content += to_bytes("\n")
    ticket_content += AlignCenter + SelectFontB
    ticket_content += to_bytes("Thank you for your visit!\n")
    website = business_profile.get('website')
    if isinstance(website, str) and website.strip():
        ticket_content += to_bytes(website.strip() + "\n")
    ticket_content += AlignLeft + SelectFontA + NormalText
    ticket_content += to_bytes("-" * NORMAL_FONT_LINE_WIDTH + "\n")
    ticket_content += to_bytes("\n\n")
    if CUT_AFTER_PRINT:
        ticket_content += PartialCut

    return ticket_content


def print_customer_receipt_ticket(receipt_data):
    """
    Print a customer receipt for a specific payment.
    """
    global last_print_used_fallback
    last_print_used_fallback = False
    trial_status = check_trial_status()
    if not trial_status.get("active", False):
        app.logger.warning("Printing blocked - trial expired")
        return False

    if not PRINTER_NAME or PRINTER_NAME == "Your_Printer_Name_Here":
        app.logger.error(f"CRITICAL: PRINTER_NAME is not configured. Cannot print customer receipt.")
        return False

    if 'pdf' in str(PRINTER_NAME).lower():
        app.logger.error(f"Selected printer '{PRINTER_NAME}' appears to be a PDF device, which is not supported for receipt printing.")
        return False

    try:
        ticket_content = build_customer_receipt_content(receipt_data)
    except Exception as e:
        app.logger.error(f"Failed to build customer receipt content: {e}")
        return False

    print_attempts = 0
    max_attempts = COPIES_PER_ORDER
    printed_any = False

    for attempt in range(max_attempts):
        print_attempts += 1
        copy_info = f"Copy {print_attempts}" if max_attempts > 1 else ""

        if print_customer_receipt_raw(ticket_content, receipt_data, copy_info):
            printed_any = True
        else:
            app.logger.warning(f"Customer receipt print attempt {print_attempts} failed")

    return printed_any


def print_customer_receipt_raw(ticket_content, receipt_data, copy_info=""):
    """
    Raw printing function for customer receipts.
    """
    hprinter = None
    doc_started = False
    try:
        table_id = receipt_data.get('table_id', 'Unknown')
        payment_id = receipt_data.get('payment', {}).get('payment_id', 'Unknown')
        app.logger.info(f"Attempting to open printer: '{PRINTER_NAME}' for table {table_id} customer receipt{f' ({copy_info})' if copy_info else ''}")
        hprinter = win32print.OpenPrinter(PRINTER_NAME)

        # Check printer status (same as other print functions)
        printer_info = win32print.GetPrinter(hprinter, 2)
        current_status = printer_info['Status']
        app.logger.info(f"Printer '{PRINTER_NAME}' current status code: {hex(current_status)}")

        PRINTER_STATUS_OFFLINE = 0x00000080; PRINTER_STATUS_ERROR = 0x00000002
        PRINTER_STATUS_NOT_AVAILABLE = 0x00001000; PRINTER_STATUS_PAPER_OUT = 0x00000010
        PRINTER_STATUS_USER_INTERVENTION = 0x00000200; PRINTER_STATUS_PAPER_JAM = 0x00000008

        problematic_statuses = [
            PRINTER_STATUS_OFFLINE, PRINTER_STATUS_ERROR, PRINTER_STATUS_NOT_AVAILABLE,
            PRINTER_STATUS_PAPER_OUT, PRINTER_STATUS_USER_INTERVENTION, PRINTER_STATUS_PAPER_JAM
        ]

        if any(current_status & status for status in problematic_statuses):
            status_messages = []
            if current_status & PRINTER_STATUS_OFFLINE: status_messages.append("OFFLINE")
            if current_status & PRINTER_STATUS_ERROR: status_messages.append("ERROR")
            if current_status & PRINTER_STATUS_NOT_AVAILABLE: status_messages.append("NOT_AVAILABLE")
            if current_status & PRINTER_STATUS_PAPER_OUT: status_messages.append("PAPER_OUT")
            if current_status & PRINTER_STATUS_USER_INTERVENTION: status_messages.append("USER_INTERVENTION")
            if current_status & PRINTER_STATUS_PAPER_JAM: status_messages.append("PAPER_JAM")

            app.logger.warning(f"Printer '{PRINTER_NAME}' has problematic status: {', '.join(status_messages)}")
            return False

        app.logger.info(f"Printer '{PRINTER_NAME}' status appears operational. Proceeding with customer receipt print.")

        # Print the document
        doc_name = f"POSPal Table {table_id} Customer Receipt"
        win32print.StartDocPrinter(hprinter, 1, (doc_name, None, "RAW"))
        doc_started = True

        win32print.StartPagePrinter(hprinter)
        win32print.WritePrinter(hprinter, bytes(ticket_content))
        win32print.EndPagePrinter(hprinter)

        app.logger.info(f"Table {table_id} customer receipt data sent to printer spooler for '{PRINTER_NAME}'.")
        return True

    except (win32print.error, Exception) as e:
        table_id = receipt_data.get('table_id', 'Unknown')
        app.logger.error(f"A printing error occurred for table {table_id} customer receipt{f' ({copy_info})' if copy_info else ''} with printer '{PRINTER_NAME}'. Error: {str(e)}")
        return False

    finally:
        # Clean up printer resources
        if doc_started and hprinter:
            try:
                win32print.EndDocPrinter(hprinter)
            except Exception as e_doc:
                app.logger.error(f"Error ending document on printer '{PRINTER_NAME}': {str(e_doc)}")
        if hprinter:
            try:
                win32print.ClosePrinter(hprinter)
            except Exception as e_close:
                app.logger.error(f"Error closing printer handle for '{PRINTER_NAME}': {str(e_close)}")


def build_simple_customer_receipt_payload(order_data_internal, order_total):
    """Construct receipt payload for simple-mode orders."""
    now = datetime.now()
    table_label = (order_data_internal.get('tableNumber') or '').strip() or 'Takeaway'
    payment_method = order_data_internal.get('paymentMethod', 'Cash')
    payment_entry = {
        "payment_id": str(uuid.uuid4()),
        "amount": round(float(order_total), 2),
        "method": payment_method,
        "timestamp": now.isoformat(),
        "note": order_data_internal.get('universalComment', '')
    }

    order_entry = {
        "order_number": order_data_internal.get('number'),
        "timestamp": now.isoformat(),
        "items": copy.deepcopy(order_data_internal.get('items', [])),
        "universal_comment": order_data_internal.get('universalComment', '')
    }

    return {
        "table_id": table_label,
        "table_name": table_label,
        "payment": payment_entry,
        "total_payments": 1,
        "bill_total": round(float(order_total), 2),
        "amount_paid_total": round(float(order_total), 2),
        "amount_remaining": 0.0,
        "payment_status": "paid",
        "payments": [payment_entry],
        "orders": [order_entry],
        "timestamp": now.isoformat(),
        "bill_date": now.strftime("%Y-%m-%d"),
        "bill_time": now.strftime("%H:%M"),
        "seats": None
    }


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

    # DIAGNOSTIC LOG 1: Log received table number from client
    app.logger.info(f"[DIAGNOSTIC] Order received from client - Table Number: '{order_data_from_client.get('tableNumber', 'NOT PROVIDED')}'")

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
        'tableNumber': (order_data_from_client.get('tableNumber') or '').strip() or 'N/A',
        'items': order_data_from_client.get('items', []),
        'universalComment': order_data_from_client.get('universalComment', ''),
        'paymentMethod': order_data_from_client.get('paymentMethod', 'Cash')
    }

    order_total = 0.0
    for item in order_data_internal.get('items', []):
        try:
            quantity = int(item.get('quantity', 0) or 0)
        except (ValueError, TypeError):
            quantity = 0
        price_source = item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))
        try:
            price = float(price_source or 0.0)
        except (ValueError, TypeError):
            price = 0.0
        order_total += price * quantity

    table_mgmt_enabled = is_table_management_enabled()



    # Phase 6: Check device print behavior
    device_print_behavior = order_data_from_client.get('devicePrintBehavior', 'auto')
    device_name = order_data_from_client.get('deviceName', 'Unknown Device')
    app.logger.info(f"Order #{authoritative_order_number} from device '{device_name}' with print behavior: {device_print_behavior}")

    print_status_summary = "Not Printed"
    printed_all = True
    printed_any = False

    # Phase 6: Skip printing if device behavior is 'disabled'
    if device_print_behavior == 'disabled':
        app.logger.info(f"Order #{authoritative_order_number} - Device '{device_name}' has printing disabled. Order will be saved without printing.")
        print_status_summary = "Print Disabled by Device"
    else:
        # Proceed with normal printing
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

            # Phase 6: REMOVED hard rejection on first print failure
            # Orders are now ALWAYS saved, even if printing fails
            # This prevents data loss due to printer issues
            if not ok:
                printed_all = False
                app.logger.warning(f"Order #{authoritative_order_number} - Copy {i} FAILED to print, but order will still be saved.")

    # Phase 6: Update print status summary
    if device_print_behavior != 'disabled':
        if printed_any and printed_all:
            print_status_summary = "All Copies Printed"
            app.logger.info(f"Order #{authoritative_order_number} - All copies printed successfully.")
        elif printed_any and not printed_all:
            print_status_summary = "Some Copies Printed, Some Failed"
            app.logger.warning(f"Order #{authoritative_order_number} - Some copies printed, some failed.")
        elif not printed_any:
            print_status_summary = "All Print Attempts Failed"
            app.logger.error(f"Order #{authoritative_order_number} - All print attempts failed, but order will be saved.")

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

    # Phase 6: Enhanced final status determination
    final_status_code = "error_unknown"
    message = "An unexpected issue occurred."

    if device_print_behavior == 'disabled' and csv_log_succeeded:
        # Device has printing disabled - order saved successfully without printing
        message = f"Order #{authoritative_order_number} saved successfully (printing disabled on this device)"
        final_status_code = "success"
    elif printed_any and printed_all and csv_log_succeeded:
        # Normal success - all printed and saved
        message = f"Order #{authoritative_order_number} processed: all copies printed and logged successfully!"
        final_status_code = "success"
    elif printed_any and not printed_all and csv_log_succeeded:
        # Partial print success
        message = f"Order #{authoritative_order_number} saved! Some copies printed, some failed. Check printer."
        final_status_code = "warning_print_partial_failed"
    elif not printed_any and csv_log_succeeded:
        # Phase 6: NEW - No prints succeeded but order was saved (previously would have been rejected)
        message = f"Order #{authoritative_order_number} saved but printing FAILED. Order is safe - reprint from management panel."
        final_status_code = "success_order_saved_print_failed" 

    customer_receipt_printed = False
    should_print_customer_receipt = (
        bool(order_data_from_client.get('printCustomerReceipt')) and
        not table_mgmt_enabled and
        device_print_behavior != 'disabled'
    )

    if should_print_customer_receipt:
        try:
            receipt_payload = build_simple_customer_receipt_payload(order_data_internal, order_total)
            customer_receipt_printed = print_customer_receipt_ticket(receipt_payload)
            if not customer_receipt_printed:
                app.logger.warning(f"Customer receipt print failed for order #{authoritative_order_number}")
        except Exception as receipt_error:
            customer_receipt_printed = False
            app.logger.error(f"Unable to print customer receipt for order #{authoritative_order_number}: {receipt_error}")

    # Track order analytics (regardless of print/log status)
    try:
        track_order_analytics(order_data_internal)
    except Exception as e:
        app.logger.warning(f"Failed to track order analytics: {e}")

    # Track table session if table management is enabled and order has valid table number
    # NOTE: Table session tracking is independent of CSV logging to ensure restaurant operations continue

    app.logger.info(f"[DIAGNOSTIC] Table management enabled: {table_mgmt_enabled}")

    if table_mgmt_enabled:
        table_number = (order_data_internal.get('tableNumber') or '').strip()
        app.logger.info(f"[DIAGNOSTIC] Extracted table number: '{table_number}' (valid: {table_number and table_number != 'N/A'})")

        if table_number and table_number != 'N/A':
            try:
                # Update table session
                app.logger.info(f"[DIAGNOSTIC] Calling update_table_session() - Table: '{table_number}', Order: #{authoritative_order_number}, Total: €{order_total:.2f}")

                if update_table_session(table_number, authoritative_order_number, order_total):
                    app.logger.info(f"[DIAGNOSTIC] SUCCESS: update_table_session() returned True")
                    app.logger.info(f"Order #{authoritative_order_number} tracked for table {table_number} (€{order_total:.2f})")

                    # Broadcast table update via SSE to all devices
                    _sse_broadcast('table_order_added', {
                        "table_id": table_number,
                        "order_number": authoritative_order_number,
                        "order_total": order_total,
                        "new_table_total": get_table_total(table_number),
                        "timestamp": datetime.now().isoformat()
                    })
                else:
                    app.logger.warning(f"[DIAGNOSTIC] FAILURE: update_table_session() returned False")
                    app.logger.warning(f"Failed to update table session for table {table_number}")
            except Exception as e:
                app.logger.warning(f"[DIAGNOSTIC] EXCEPTION in table session tracking: {e}")
                app.logger.warning(f"Failed to track table session for order #{authoritative_order_number}: {e}")

    app.logger.info(f"Order #{authoritative_order_number} processing complete. Final Status: {final_status_code}, Printed: {print_status_summary}, Logged: {csv_log_succeeded}")
    return jsonify({
        "status": final_status_code,
        "order_number": authoritative_order_number,
        "printed": print_status_summary, 
        "logged": csv_log_succeeded,
        "message": message,
        "customer_receipt_printed": customer_receipt_printed
    }), 200

@app.route('/api/test/orders', methods=['POST'])
def handle_test_order():
    """TEST ENDPOINT: Submit order without trial checking for table integration testing"""
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

    # Skip printing and CSV logging for test - focus on table integration
    print_status_summary = "Test Mode - No Printing"
    csv_log_succeeded = True  # Assume success for test

    # Track table session if table management is enabled and order has valid table number
    # NOTE: Table session tracking is independent of CSV logging to ensure restaurant operations continue
    if is_table_management_enabled():
        table_number = (order_data_internal.get('tableNumber') or '').strip()
        if table_number and table_number != 'N/A':
            try:
                # Calculate order total for table tracking
                order_total = sum(
                    float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))) * int(item.get('quantity', 0))
                    for item in order_data_internal.get('items', [])
                )

                # Update table session
                if update_table_session(table_number, authoritative_order_number, order_total):
                    app.logger.info(f"TEST: Order #{authoritative_order_number} tracked for table {table_number} (€{order_total:.2f})")

                    # Broadcast table update via SSE to all devices
                    _sse_broadcast('table_order_added', {
                        "table_id": table_number,
                        "order_number": authoritative_order_number,
                        "order_total": order_total,
                        "new_table_total": get_table_total(table_number),
                        "timestamp": datetime.now().isoformat()
                    })
                else:
                    app.logger.warning(f"Failed to update table session for table {table_number}")
            except Exception as e:
                app.logger.warning(f"Failed to track table session for order #{authoritative_order_number}: {e}")

    return jsonify({
        "status": "success",
        "order_number": authoritative_order_number,
        "printed": print_status_summary,
        "logged": csv_log_succeeded,
        "message": f"TEST: Order #{authoritative_order_number} processed for table integration testing"
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
    
def check_trial_status_legacy():
    """
    LEGACY: Hybrid cloud-first license validation with encrypted local cache and grace period
    Priority: Cloud validation -> Encrypted cache (with grace period) -> Legacy license.key -> Trial
    
    NOTE: This function is being phased out in favor of the unified license controller.
    New code should use get_license_status_safe() or get_license_status_unified() instead.
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
            success, cloud_license_data, error_msg, from_cache, cloud_reachable = _validate_license_with_cloud(
                customer_email,
                unlock_token,
                hardware_id,
                CLOUD_VALIDATION_TIMEOUT,
                cache_data=cache_data
            )
            
            if success and cloud_license_data and not from_cache:
                app.logger.info("Cloud validation success - updating cache with fresh data")

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
            elif cloud_license_data:
                if from_cache:
                    app.logger.info("Using cached license data without contacting cloud (fresh cache)")
                else:
                    app.logger.info("Cloud validation skipped/backoff - using cached payload")
                return cloud_license_data
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

        # Registry removed - using 2 storage locations only

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

# --- Migration Wrapper Functions ---
def check_trial_status():
    """
    Migration wrapper for check_trial_status() function
    
    This function provides backward compatibility during the migration from legacy
    license system to unified license controller. It automatically routes calls
    to the appropriate system based on migration settings.
    
    Returns:
        Dict containing license status in legacy-compatible format
    """
    return get_license_status_safe(force_refresh=False, context="check_trial_status")

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

# === Table Management Helper Functions ===

def load_tables_config():
    """Load table configuration from tables_config.json"""
    tables_config_file = os.path.join(DATA_DIR, 'tables_config.json')

    default_config = {
        "tables": {
            "1": {"name": "Table 1", "seats": 4, "status": "available"},
            "2": {"name": "Table 2", "seats": 2, "status": "available"},
            "3": {"name": "VIP Booth", "seats": 6, "status": "available"}
        },
        "settings": {
            "auto_clear_paid_tables": True,
            "default_table_timeout": 3600
        }
    }

    try:
        if os.path.exists(tables_config_file):
            with open(tables_config_file, 'r', encoding='utf-8') as f:
                loaded_config = json.load(f)

            # VALIDATION: Fix corrupted data structure (list instead of dict)
            if isinstance(loaded_config.get("tables"), list):
                app.logger.warning("tables_config.json has 'tables' as list, auto-correcting to dict in memory only")
                loaded_config["tables"] = {}

            # Ensure required keys exist with correct types
            if "tables" not in loaded_config or not isinstance(loaded_config.get("tables"), dict):
                loaded_config["tables"] = {}
            if "settings" not in loaded_config:
                loaded_config["settings"] = default_config["settings"]

            return loaded_config
        else:
            # Create default file if it doesn't exist
            with open(tables_config_file, 'w', encoding='utf-8') as f:
                json.dump(default_config, f, indent=2)
            return default_config
    except Exception as e:
        app.logger.error(f"Failed to load tables config: {e}")
        return default_config

def save_tables_config(config_data):
    """Save table configuration to tables_config.json with enhanced safety"""
    def _save_operation():
        tables_config_file = os.path.join(DATA_DIR, 'tables_config.json')
        with open(tables_config_file, 'w', encoding='utf-8') as f:
            json.dump(config_data, f, indent=2, ensure_ascii=False)
        return True

    try:
        return enhanced_safe_file_operation('save_tables_config', _save_operation)
    except Exception as e:
        app.logger.error(f"Failed to save tables config: {e}")
        return False

def load_table_sessions():
    """Load table sessions from table_sessions.json"""
    table_sessions_file = os.path.join(DATA_DIR, 'table_sessions.json')

    try:
        if os.path.exists(table_sessions_file):
            with open(table_sessions_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        else:
            # Create empty sessions file if it doesn't exist
            with open(table_sessions_file, 'w', encoding='utf-8') as f:
                json.dump({}, f, indent=2)
            return {}
    except Exception as e:
        app.logger.error(f"Failed to load table sessions: {e}")
        return {}

def save_table_sessions(sessions_data):
    """Save table sessions to table_sessions.json with enhanced safety"""
    def _save_operation():
        table_sessions_file = os.path.join(DATA_DIR, 'table_sessions.json')
        app.logger.info(f"[SAVE_SESSIONS] Writing to file: {table_sessions_file}")
        app.logger.info(f"[SAVE_SESSIONS] DATA_DIR is: {DATA_DIR}")
        app.logger.info(f"[SAVE_SESSIONS] Sessions data has {len(sessions_data)} table(s)")

        try:
            with open(table_sessions_file, 'w', encoding='utf-8') as f:
                json.dump(sessions_data, f, indent=2, ensure_ascii=False)
            app.logger.info(f"[SAVE_SESSIONS] File write completed successfully")
            return True
        except Exception as write_error:
            app.logger.error(f"[SAVE_SESSIONS] Failed to write file: {write_error}")
            raise

    try:
        result = enhanced_safe_file_operation('save_table_sessions', _save_operation)
        if not result:
            app.logger.error(f"[SAVE_SESSIONS] enhanced_safe_file_operation returned False (verification likely failed)")

            # FALLBACK: Try a simpler direct write without verification
            app.logger.warning(f"[SAVE_SESSIONS] Attempting fallback: direct write without verification")
            try:
                table_sessions_file = os.path.join(DATA_DIR, 'table_sessions.json')

                # Create a manual backup first
                if os.path.exists(table_sessions_file):
                    import shutil
                    backup_file = os.path.join(DATA_DIR, 'table_sessions.json.backup_fallback')
                    shutil.copy2(table_sessions_file, backup_file)
                    app.logger.info(f"[SAVE_SESSIONS] Created fallback backup: {backup_file}")

                # Direct write
                with open(table_sessions_file, 'w', encoding='utf-8') as f:
                    json.dump(sessions_data, f, indent=2, ensure_ascii=False)

                app.logger.info(f"[SAVE_SESSIONS] Fallback write succeeded")
                return True
            except Exception as fallback_error:
                app.logger.error(f"[SAVE_SESSIONS] Fallback write also failed: {fallback_error}")
                return False

        return result
    except Exception as e:
        import traceback
        app.logger.error(f"[SAVE_SESSIONS] Exception in save_table_sessions: {e}")
        app.logger.error(f"[SAVE_SESSIONS] Traceback: {traceback.format_exc()}")

        # LAST RESORT FALLBACK: Try direct write even after exception
        app.logger.warning(f"[SAVE_SESSIONS] Attempting last-resort fallback after exception")
        try:
            table_sessions_file = os.path.join(DATA_DIR, 'table_sessions.json')
            with open(table_sessions_file, 'w', encoding='utf-8') as f:
                json.dump(sessions_data, f, indent=2, ensure_ascii=False)
            app.logger.info(f"[SAVE_SESSIONS] Last-resort fallback succeeded")
            return True
        except Exception as last_resort_error:
            app.logger.error(f"[SAVE_SESSIONS] Last-resort fallback failed: {last_resort_error}")
            return False

# --- Enhanced SSE Events for Table Management ---

def broadcast_table_event(event_type, table_data, additional_data=None):
    """Enhanced SSE broadcast for table events"""
    try:
        event_payload = {
            "timestamp": datetime.now().isoformat(),
            "table_id": table_data.get("table_id") if isinstance(table_data, dict) else None,
            "event_type": event_type,
            "data": table_data
        }

        if additional_data:
            event_payload.update(additional_data)

        _sse_broadcast(f'table_{event_type}', event_payload)

        # Also broadcast a general table_updated event for clients listening to all changes
        _sse_broadcast('table_system_updated', {
            "timestamp": event_payload["timestamp"],
            "last_event": event_type,
            "affected_table": event_payload.get("table_id")
        })

    except Exception as e:
        app.logger.error(f"Failed to broadcast table event {event_type}: {e}")

def get_order_data_for_table(table_id, order_numbers):
    """Enhanced CSV integration to get order data for a table"""
    order_data = []
    total_calculated = 0.0

    try:
        orders_csv_file = os.path.join(DATA_DIR, 'orders.csv')
        if not os.path.exists(orders_csv_file):
            return order_data, total_calculated

        with open(orders_csv_file, 'r', encoding='utf-8', newline='') as csvfile:
            reader = csv.DictReader(csvfile)
            for row in reader:
                try:
                    # Match by order number and table number
                    row_order_number = row.get('order_number', '').strip()
                    row_table_number = row.get('table_number', '').strip()

                    if (row_order_number in order_numbers or
                        (row_table_number == str(table_id) and row_order_number)):

                        # Parse order data
                        order_entry = {
                            "order_number": row_order_number,
                            "timestamp": row.get('timestamp', ''),
                            "items": [],
                            "subtotal": 0.0,
                            "tax": 0.0,
                            "total": 0.0
                        }

                        # Parse items (stored as JSON string in CSV)
                        items_str = row.get('items', '[]')
                        try:
                            items = json.loads(items_str)
                            order_entry["items"] = items
                        except:
                            app.logger.warning(f"Failed to parse items for order {row_order_number}")

                        # Parse financial data
                        try:
                            order_entry["subtotal"] = float(row.get('subtotal', '0'))
                            order_entry["tax"] = float(row.get('tax', '0'))
                            order_entry["total"] = float(row.get('total', '0'))
                            total_calculated += order_entry["total"]
                        except (ValueError, TypeError):
                            app.logger.warning(f"Failed to parse amounts for order {row_order_number}")

                        order_data.append(order_entry)

                except Exception as e:
                    app.logger.warning(f"Error processing CSV row for table {table_id}: {e}")
                    continue

    except Exception as e:
        app.logger.error(f"Failed to read orders CSV for table {table_id}: {e}")

    return order_data, round(total_calculated, 2)

def cleanup_old_table_sessions():
    """Cleanup old table sessions and history"""
    try:
        current_time = datetime.now()
        cleanup_threshold = current_time - timedelta(days=30)  # 30 days old

        sessions = load_table_sessions()
        cleaned_sessions = {}
        cleaned_count = 0

        for table_id, session in sessions.items():
            try:
                # Check if session has recent activity
                session_time_str = session.get("created_at", "")
                if session_time_str:
                    session_time = datetime.fromisoformat(session_time_str.replace('Z', '+00:00'))
                    if session_time > cleanup_threshold:
                        cleaned_sessions[table_id] = session
                    else:
                        cleaned_count += 1
                        app.logger.info(f"Cleaned up old session for table {table_id}")
                else:
                    # Keep sessions without timestamps (safer)
                    cleaned_sessions[table_id] = session
            except Exception as e:
                app.logger.warning(f"Error checking session age for table {table_id}: {e}")
                cleaned_sessions[table_id] = session  # Keep on error

        if cleaned_count > 0:
            save_table_sessions(cleaned_sessions)
            app.logger.info(f"Cleaned up {cleaned_count} old table sessions")

    except Exception as e:
        app.logger.error(f"Failed to cleanup old table sessions: {e}")

def update_table_session(table_id, order_number, order_total):
    """Update table session with new order"""
    try:
        app.logger.info(f"[DIAGNOSTIC] Inside update_table_session() - Table ID: '{table_id}'")
        sessions = load_table_sessions()
        app.logger.info(f"[DIAGNOSTIC] Loaded sessions: {len(sessions)} table(s) currently in sessions")
        current_time = datetime.now().isoformat()

        if table_id not in sessions:
            # Create new session
            sessions[table_id] = {
                "status": "occupied",
                "orders": [],
                "order_details": [],
                "total_amount": 0.0,
                "opened_at": current_time,
                "last_order_at": current_time,
                "payment_status": "unpaid",
                "payments": [],
                "amount_paid": 0.0,
                "amount_remaining": 0.0
            }

        # Ensure order_details exists for backward compatibility
        if "order_details" not in sessions[table_id]:
            sessions[table_id]["order_details"] = []

        # Ensure payment tracking fields exist for backward compatibility
        if "payments" not in sessions[table_id]:
            sessions[table_id]["payments"] = []
        if "amount_paid" not in sessions[table_id]:
            sessions[table_id]["amount_paid"] = 0.0
        if "amount_remaining" not in sessions[table_id]:
            sessions[table_id]["amount_remaining"] = 0.0

        # Update session
        sessions[table_id]["orders"].append(order_number)
        sessions[table_id]["order_details"].append({
            "order_number": order_number,
            "order_total": float(order_total),
            "timestamp": current_time
        })
        sessions[table_id]["total_amount"] += float(order_total)
        sessions[table_id]["last_order_at"] = current_time
        sessions[table_id]["status"] = "occupied"

        # Update amount_remaining when new order is added
        sessions[table_id]["amount_remaining"] = sessions[table_id]["total_amount"] - sessions[table_id]["amount_paid"]

        # Update payment status based on amounts
        if sessions[table_id]["amount_paid"] <= 0:
            sessions[table_id]["payment_status"] = "unpaid"
        elif sessions[table_id]["amount_remaining"] <= 0.01:  # Small tolerance for rounding
            sessions[table_id]["payment_status"] = "paid"
        else:
            sessions[table_id]["payment_status"] = "partial"

        app.logger.info(f"[DIAGNOSTIC] About to save sessions - Table '{table_id}' now has {len(sessions[table_id]['orders'])} order(s), Total: €{sessions[table_id]['total_amount']:.2f}")

        result = save_table_sessions(sessions)
        app.logger.info(f"[DIAGNOSTIC] save_table_sessions() returned: {result}")
        return result
    except Exception as e:
        app.logger.error(f"Failed to update table session for table {table_id}: {e}")
        return False

def get_table_orders(table_id):
    """Get all orders for a specific table"""
    try:
        sessions = load_table_sessions()
        if table_id in sessions:
            return sessions[table_id].get("orders", [])
        return []
    except Exception as e:
        app.logger.error(f"Failed to get table orders for table {table_id}: {e}")
        return []

def get_table_total(table_id):
    """Get total amount for a specific table"""
    try:
        sessions = load_table_sessions()
        if table_id in sessions:
            return sessions[table_id].get("total_amount", 0.0)
        return 0.0
    except Exception as e:
        app.logger.error(f"Failed to get table total for table {table_id}: {e}")
        return 0.0

def recalculate_table_total(table_id):
    """Recalculate table total from actual order data for accuracy"""
    try:
        sessions = load_table_sessions()
        if table_id not in sessions:
            return 0.0

        # Get all orders for this table from CSV data
        orders = get_orders_for_table(table_id)
        calculated_total = calculate_table_total(orders)

        # Update session with recalculated total
        sessions[table_id]["total_amount"] = calculated_total

        # Save updated session
        if save_table_sessions(sessions):
            app.logger.info(f"Recalculated total for table {table_id}: €{calculated_total:.2f}")
            return calculated_total
        else:
            app.logger.error(f"Failed to save recalculated total for table {table_id}")
            return sessions[table_id].get("total_amount", 0.0)

    except Exception as e:
        app.logger.error(f"Failed to recalculate table total for table {table_id}: {e}")
        return 0.0

def update_csv_payment_methods_for_table(order_numbers, payments, total_amount):
    """
    Update CSV rows for table orders with actual payment methods used.
    This is called when a table is cleared to ensure analytics reflect actual payment methods.

    Args:
        order_numbers: List of order numbers from the table session
        payments: List of payment records with 'method' and 'amount' fields
        total_amount: Total amount for the table

    Returns:
        bool: True if successful, False otherwise
    """
    try:
        if not order_numbers or not payments:
            app.logger.info("[CSV_UPDATE] No orders or payments to update")
            return True  # Nothing to update is not an error

        # Determine primary payment method
        payment_totals = {'Cash': 0.0, 'Card': 0.0}
        for payment in payments:
            method = str(payment.get('method', 'Cash')).capitalize()
            amount = float(payment.get('amount', 0.0))
            if method in payment_totals:
                payment_totals[method] += amount

        # Use the method with highest amount, or "Mixed" if split relatively evenly
        cash_total = payment_totals['Cash']
        card_total = payment_totals['Card']

        if cash_total > 0 and card_total > 0:
            # Split payment - determine if it's predominantly one method or truly mixed
            total_paid = cash_total + card_total
            cash_percent = (cash_total / total_paid) * 100 if total_paid > 0 else 0

            if cash_percent >= 80:
                primary_method = 'Cash'
            elif cash_percent <= 20:
                primary_method = 'Card'
            else:
                primary_method = 'Mixed'
        elif card_total > 0:
            primary_method = 'Card'
        else:
            primary_method = 'Cash'

        app.logger.info(f"[CSV_UPDATE] Determined primary payment method: {primary_method} (Cash: €{cash_total:.2f}, Card: €{card_total:.2f})")

        # Update CSV rows for each order
        updated_count = 0
        for order_number in order_numbers:
            try:
                # Find CSV files that might contain this order (check last 7 days)
                csv_files_to_check = []
                for days_ago in range(7):
                    date = datetime.now() - timedelta(days=days_ago)
                    csv_path = os.path.join(DATA_DIR, f"orders_{date.strftime('%Y-%m-%d')}.csv")
                    if os.path.exists(csv_path):
                        csv_files_to_check.append(csv_path)

                # Search for and update the order in CSV files
                for csv_path in csv_files_to_check:
                    try:
                        # Read the CSV file
                        rows = []
                        order_found = False

                        with open(csv_path, 'r', newline='', encoding='utf-8') as csvfile:
                            reader = csv.DictReader(csvfile)
                            fieldnames = reader.fieldnames

                            for row in reader:
                                if row.get('order_number') == str(order_number):
                                    # Update the payment method
                                    row['payment_method'] = primary_method
                                    order_found = True
                                    app.logger.info(f"[CSV_UPDATE] Updated order #{order_number} in {os.path.basename(csv_path)} to {primary_method}")
                                rows.append(row)

                        # Write back if order was found
                        if order_found:
                            with open(csv_path, 'w', newline='', encoding='utf-8') as csvfile:
                                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                                writer.writeheader()
                                writer.writerows(rows)

                            updated_count += 1
                            break  # Found and updated, no need to check other files

                    except Exception as e:
                        app.logger.warning(f"[CSV_UPDATE] Error processing {csv_path}: {e}")
                        continue

            except Exception as e:
                app.logger.warning(f"[CSV_UPDATE] Failed to update order #{order_number}: {e}")
                continue

        app.logger.info(f"[CSV_UPDATE] Successfully updated {updated_count}/{len(order_numbers)} orders with payment method: {primary_method}")
        return True

    except Exception as e:
        app.logger.error(f"[CSV_UPDATE] Failed to update CSV payment methods: {e}")
        return False

def close_table_session(table_id):
    """Close table session and mark as paid"""
    try:
        sessions = load_table_sessions()
        if table_id in sessions:
            sessions[table_id]["payment_status"] = "paid"
            sessions[table_id]["status"] = "occupied"  # Still occupied until cleared
            return save_table_sessions(sessions)
        return False
    except Exception as e:
        app.logger.error(f"Failed to close table session for table {table_id}: {e}")
        return False

def clear_table_session(table_id):
    """Clear table session and make table available"""
    try:
        sessions = load_table_sessions()
        if table_id in sessions:
            session = sessions[table_id]

            # Log session to history before clearing
            try:
                opened_at = session.get("opened_at", "")
                closed_at = datetime.now().isoformat()

                # Calculate duration
                duration_minutes = 0
                if opened_at:
                    try:
                        opened_time = datetime.fromisoformat(opened_at.replace('Z', '+00:00') if opened_at.endswith('Z') else opened_at)
                        closed_time = datetime.now()
                        duration_minutes = int((closed_time - opened_time).total_seconds() / 60)
                    except Exception as e:
                        app.logger.warning(f"Failed to calculate session duration: {e}")

                # Create session history record
                session_history = {
                    "table_id": table_id,
                    "opened_at": opened_at.split('T')[1][:8] if 'T' in opened_at else opened_at,
                    "closed_at": closed_at.split('T')[1][:8],
                    "orders": session.get("orders", []),
                    "total": round(session.get("total_amount", 0.0), 2),
                    "duration_minutes": duration_minutes,
                    "payment_status": session.get("payment_status", "unpaid"),
                    "amount_paid": round(session.get("amount_paid", 0.0), 2),
                    "amount_remaining": round(max(0, session.get("total_amount", 0.0) - session.get("amount_paid", 0.0)), 2),
                    "payments": session.get("payments", [])
                }

                # Log to history file
                if not log_table_session_history(table_id, session_history):
                    app.logger.warning(f"Failed to log session history for table {table_id}")

            except Exception as e:
                app.logger.error(f"Failed to process session history for table {table_id}: {e}")

            # Update CSV payment methods for all orders in this table session
            try:
                order_numbers = session.get("orders", [])
                payments = session.get("payments", [])
                total_amount = session.get("total_amount", 0.0)

                if order_numbers and payments:
                    app.logger.info(f"[CLEAR_TABLE] Updating CSV payment methods for {len(order_numbers)} orders from table {table_id}")
                    update_csv_payment_methods_for_table(order_numbers, payments, total_amount)
                else:
                    app.logger.info(f"[CLEAR_TABLE] No orders or payments to update for table {table_id}")
            except Exception as e:
                # Don't fail the entire clear operation if CSV update fails
                app.logger.error(f"[CLEAR_TABLE] Failed to update CSV payment methods for table {table_id}: {e}")

            # Clear the session
            app.logger.info(f"[CLEAR_TABLE] Deleting session for table {table_id} and saving")
            del sessions[table_id]

            # Save updated sessions
            save_result = save_table_sessions(sessions)
            if not save_result:
                app.logger.error(f"[CLEAR_TABLE] Failed to save table sessions after clearing table {table_id}")
                app.logger.error(f"[CLEAR_TABLE] Sessions data: {len(sessions)} remaining tables")
                return False

            app.logger.info(f"[CLEAR_TABLE] Successfully cleared table {table_id}")
            return True

        app.logger.info(f"[CLEAR_TABLE] Table {table_id} already clear (not in sessions)")
        return True  # Table already clear
    except Exception as e:
        import traceback
        app.logger.error(f"[CLEAR_TABLE] Exception while clearing table {table_id}: {e}")
        app.logger.error(f"[CLEAR_TABLE] Traceback: {traceback.format_exc()}")
        return False

def is_table_management_enabled():
    """Check if table management is enabled in config"""
    return config.get('table_management_enabled', False)

def get_orders_for_table(table_id, date_range=None):
    """Get all orders for a table from CSV files"""
    try:
        orders = []

        # Validate table_id
        if not table_id or str(table_id).strip() == '':
            app.logger.warning("Empty table_id provided to get_orders_for_table")
            return []

        # If no date range specified, search recent files (last 7 days)
        if date_range is None:
            end_date = datetime.now().date()
            start_date = end_date - timedelta(days=7)
            date_range = (start_date, end_date)
        elif isinstance(date_range, tuple) and len(date_range) == 2:
            start_date, end_date = date_range
            # Validate dates
            if not isinstance(start_date, (datetime, date)) or not isinstance(end_date, (datetime, date)):
                app.logger.error(f"Invalid date types in date_range: {type(start_date)}, {type(end_date)}")
                return []
        else:
            app.logger.error(f"Invalid date_range format: {date_range}")
            return []

        # Ensure DATA_DIR exists
        if not os.path.exists(DATA_DIR):
            app.logger.warning(f"Data directory does not exist: {DATA_DIR}")
            return []

        files_checked = 0
        files_found = 0

        # Search through CSV files in date range
        current_date = start_date
        while current_date <= end_date:
            filename = os.path.join(DATA_DIR, f"orders_{current_date.strftime('%Y-%m-%d')}.csv")
            files_checked += 1

            if os.path.exists(filename):
                files_found += 1
                try:
                    with open(filename, 'r', newline='', encoding='utf-8') as csvfile:
                        reader = csv.DictReader(csvfile)
                        row_count = 0

                        for row in reader:
                            row_count += 1
                            # Check if this order belongs to our table
                            table_number = row.get('table_number', '').strip()

                            if table_number == str(table_id).strip():
                                try:
                                    # Parse order data
                                    order_number = int(row.get('order_number', 0))
                                    if order_number <= 0:
                                        app.logger.warning(f"Invalid order number in file {filename}, row {row_count}")
                                        continue

                                    timestamp = row.get('timestamp', '')
                                    order_total = float(row.get('order_total', 0.0))
                                    items_json = row.get('items_json', '[]')

                                    # Parse items
                                    items = []
                                    try:
                                        items_list = json.loads(items_json)
                                        if isinstance(items_list, list):
                                            for item in items_list:
                                                if isinstance(item, dict):
                                                    items.append({
                                                        'name': str(item.get('name', '')),
                                                        'basePrice': float(item.get('basePrice', 0.0)),
                                                        'price': float(item.get('itemPriceWithModifiers', item.get('basePrice', 0.0))),
                                                        'quantity': int(item.get('quantity', 1)),
                                                        'generalSelectedOptions': item.get('generalSelectedOptions', []),
                                                        'comment': str(item.get('comment', ''))
                                                    })
                                        else:
                                            app.logger.warning(f"Items JSON is not a list for order {order_number}")
                                    except (json.JSONDecodeError, TypeError, ValueError) as e:
                                        app.logger.warning(f"Failed to parse items for order {order_number}: {e}")

                                    orders.append({
                                        'order_number': order_number,
                                        'timestamp': timestamp,
                                        'items': items,
                                        'order_total': order_total
                                    })

                                except (ValueError, TypeError) as e:
                                    app.logger.warning(f"Failed to parse order data from CSV {filename}, row {row_count}: {e}")
                                    continue

                except Exception as e:
                    app.logger.error(f"Failed to read orders file {filename}: {e}")

            current_date += timedelta(days=1)

        app.logger.debug(f"Searched {files_checked} files, found {files_found} files, retrieved {len(orders)} orders for table {table_id}")

        # Sort orders by timestamp
        orders.sort(key=lambda x: x.get('timestamp', ''))
        return orders

    except Exception as e:
        app.logger.error(f"Failed to get orders for table {table_id}: {e}")
        return []

def calculate_table_total(orders):
    """Calculate total amount from list of orders"""
    try:
        total = 0.0
        for order in orders:
            total += float(order.get('order_total', 0.0))
        return total
    except Exception as e:
        app.logger.error(f"Failed to calculate table total: {e}")
        return 0.0

def get_table_bill_data(table_id):
    """Generate complete bill data for a table"""
    try:
        # Get table configuration
        tables_config = load_tables_config()
        if not tables_config or table_id not in tables_config.get("tables", {}):
            app.logger.warning(f"Table {table_id} not found in configuration")
            return None

        table_info = tables_config["tables"][table_id]
        table_name = table_info.get("name", f"Table {table_id}")

        # Get payment status and payment information from session (primary data source)
        sessions = load_table_sessions()
        payment_status = "unpaid"
        session_total = 0.0
        amount_paid = 0.0
        amount_remaining = 0.0
        payments = []
        orders = []
        session_order_numbers = []

        if table_id in sessions:
            session = sessions[table_id]
            payment_status = session.get("payment_status", "unpaid")
            session_total = session.get("total_amount", 0.0)
            amount_paid = session.get("amount_paid", 0.0)
            amount_remaining = session.get("amount_remaining", 0.0)
            payments = session.get("payments", [])
            session_order_numbers = session.get("orders", [])

            # Use session total as authoritative source (table session is the source of truth)
            grand_total = session_total

            # Try to get order details from CSV files as secondary data for display
            orders = get_orders_for_table(table_id)

            # If CSV orders don't match session orders, create basic order entries from session data
            if len(orders) != len(session_order_numbers):
                app.logger.info(f"CSV orders ({len(orders)}) don't match session orders ({len(session_order_numbers)}) for table {table_id}")

                # Use session order details if available
                if "order_details" in session:
                    orders = []
                    for order_detail in session.get("order_details", []):
                        orders.append({
                            "order_number": order_detail.get("order_number", "Unknown"),
                            "timestamp": order_detail.get("timestamp", ""),
                            "total": order_detail.get("order_total", 0.0),
                            "items": [{"name": "Order items", "quantity": 1, "price": order_detail.get("order_total", 0.0)}],
                            "universal_comment": ""
                        })

            # Recalculate amount_remaining based on current total
            amount_remaining = max(0, grand_total - amount_paid)
        else:
            # No session data - fall back to CSV only
            orders = get_orders_for_table(table_id)
            grand_total = calculate_table_total(orders)

            # Handle case where no orders exist
            if not orders:
                app.logger.info(f"No orders found for table {table_id}")
                grand_total = 0.0

        # Get table config for additional info
        table_info = tables_config["tables"][table_id]
        seats = table_info.get("seats", "")

        # Format bill data
        bill_data = {
            "status": "success",
            "table_id": table_id,
            "table_name": table_name,
            "seats": seats,
            "bill_date": datetime.now().strftime("%Y-%m-%d"),
            "bill_time": datetime.now().strftime("%H:%M"),
            "orders": orders,
            "total_orders": len(orders),
            "grand_total": round(grand_total, 2),
            "total": round(grand_total, 2),  # Alias for printing function
            "payment_status": payment_status,
            "amount_paid": round(amount_paid, 2),
            "amount_remaining": round(amount_remaining, 2),
            "payments": payments
        }

        # Add debug info for troubleshooting
        csv_orders_count = len(get_orders_for_table(table_id)) if table_id in sessions else len(orders)
        if csv_orders_count != len(session_order_numbers):
            bill_data["_debug"] = {
                "session_orders": len(session_order_numbers),
                "csv_orders": csv_orders_count,
                "using_session_data": table_id in sessions,
                "session_total": round(session_total, 2) if table_id in sessions else "N/A"
            }

        return bill_data

    except Exception as e:
        app.logger.error(f"Failed to generate bill data for table {table_id}: {e}")
        return None

def log_table_session_history(table_id, session_data):
    """Save session to daily history file"""
    try:
        today = datetime.now().strftime("%Y-%m-%d")
        history_file = os.path.join(DATA_DIR, f"table_history_{today}.json")

        # Load existing history or create new
        history = {"date": today, "sessions": []}

        if os.path.exists(history_file):
            try:
                with open(history_file, 'r', encoding='utf-8') as f:
                    history = json.load(f)
                    if "sessions" not in history:
                        history["sessions"] = []
            except Exception as e:
                app.logger.warning(f"Failed to load existing history file, creating new: {e}")

        # Add session to history
        history["sessions"].append(session_data)

        # Save updated history
        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=2, ensure_ascii=False)

        return True

    except Exception as e:
        app.logger.error(f"Failed to log table session history: {e}")
        return False

def load_table_history(date):
    """Load daily history file"""
    try:
        if isinstance(date, str):
            date_str = date
        else:
            date_str = date.strftime("%Y-%m-%d")

        history_file = os.path.join(DATA_DIR, f"table_history_{date_str}.json")

        if os.path.exists(history_file):
            with open(history_file, 'r', encoding='utf-8') as f:
                return json.load(f)

        return {"date": date_str, "sessions": []}

    except Exception as e:
        app.logger.error(f"Failed to load table history for {date}: {e}")
        return {"date": date_str if 'date_str' in locals() else str(date), "sessions": []}

# Add API endpoint
@app.route('/api/trial_status')
def get_trial_status():
    """
    Get trial/license status for frontend
    
    This endpoint has been migrated to use the unified license controller
    while maintaining full backward compatibility with existing frontend code.
    """
    try:
        # Force refresh if requested
        force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
        
        # Get status using migration-safe wrapper
        status = get_license_status_safe(force_refresh=force_refresh, context="api_trial_status")
        
        # Add API metadata for debugging
        status['_api_endpoint'] = 'trial_status'
        status['_timestamp'] = datetime.now().isoformat()
        
        return jsonify(status)
        
    except Exception as e:
        app.logger.error(f"Trial status API error: {e}")
        
        # Return safe fallback response
        return jsonify({
            'licensed': False,
            'active': False,
            'expired': True,
            'source': 'api_error',
            'message': f'API error: {str(e)}',
            '_api_endpoint': 'trial_status',
            '_error': str(e),
            '_timestamp': datetime.now().isoformat()
        }), 500

@app.route('/api/license_status_unified')
def get_license_status_unified_endpoint():
    """Get license status using unified system"""
    force_refresh = request.args.get('force_refresh', 'false').lower() == 'true'
    return jsonify(get_license_status_unified(force_refresh))

@app.route('/api/license_system_info')
def get_license_system_info():
    """Get comprehensive license system information"""
    try:
        if UNIFIED_LICENSES_ENABLED:
            from license_integration import license_integration
            if license_integration:
                return jsonify(license_integration.get_system_info())
        
        # Fallback info
        return jsonify({
            "integration": {
                "unified_available": UNIFIED_LICENSES_ENABLED,
                "unified_enabled": UNIFIED_LICENSES_ENABLED,
                "current_system": "legacy",
                "migration_completed": False
            },
            "legacy": {"active": True},
            "message": "Using legacy license system"
        })
        
    except Exception as e:
        app.logger.error(f"License system info error: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/license_migration', methods=['POST'])
def trigger_license_migration():
    """Trigger license system migration"""
    try:
        if not UNIFIED_LICENSES_ENABLED:
            return jsonify({
                "success": False,
                "message": "Unified license system not available"
            }), 400
        
        from license_integration import license_integration
        if not license_integration:
            return jsonify({
                "success": False,
                "message": "License integration not initialized"
            }), 500
        
        data = request.get_json() or {}
        dry_run = data.get('dry_run', True)
        
        result = license_integration.force_migration(dry_run)
        
        if result["success"]:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        app.logger.error(f"License migration error: {e}")
        return jsonify({
            "success": False,
            "message": f"Migration failed: {str(e)}"
        }), 500

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
    """
    Validate license using unified controller system

    MIGRATED: This endpoint now uses the unified license controller for all validation,
    providing consistent behavior and improved reliability across all license operations.
    """
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

        # Try to get credentials from license file if not provided
        if not customer_email or not unlock_token:
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

        # Use unified license controller for validation
        app.logger.info("Using unified license controller for license validation")

        if customer_email and unlock_token:
            # Validate with cloud using unified controller
            app.logger.info(f"Validating license for: {customer_email[:5]}*** via unified controller")
            result = validate_license_integrated(customer_email, unlock_token, hardware_id)

            # FALLBACK: If unified system is unavailable, call cloud API directly
            if not result.get('licensed') and result.get('message') == 'Integration system not available':
                app.logger.warning("Unified system not available, falling back to direct cloud validation")
                try:
                    success, cloud_data, error_msg, from_cache, cloud_reachable = _validate_license_with_cloud(
                        customer_email, unlock_token, hardware_id, CLOUD_VALIDATION_TIMEOUT
                    )
                    if success and cloud_data and not from_cache:
                        app.logger.info("Direct cloud validation successful")
                        result = {
                            'licensed': True,
                            'active': True,
                            'cloud_validation': True,
                            'customer': cloud_data.get('customer'),
                            'subscription_status': cloud_data.get('subscription_status', 'active'),
                            'valid_until': cloud_data.get('valid_until'),
                            'subscription_id': cloud_data.get('subscription_id'),
                            '_unified_system': False,
                            '_fallback_method': 'direct_cloud_api'
                        }
                    elif cloud_data:
                        if from_cache:
                            app.logger.info("Direct validation reused cached license payload")
                        else:
                            app.logger.info("Direct cloud validation skipped/backoff - using cached payload")
                        result = cloud_data
                    else:
                        app.logger.error(f"Direct cloud validation failed: {error_msg}")
                        result = {
                            'licensed': False,
                            'active': False,
                            'cloud_validation': False,
                            'message': error_msg or 'Cloud validation failed',
                            '_unified_system': False,
                            '_fallback_method': 'direct_cloud_api_failed'
                        }
                except Exception as fallback_err:
                    app.logger.error(f"Fallback cloud validation error: {fallback_err}")

            # MIGRATION COMPATIBILITY: Also save to legacy cache if validation successful
            # This ensures legacy system can access license data during migration period
            if result.get('licensed') and result.get('active'):
                try:
                    legacy_license_data = {
                        'customer_email': customer_email,
                        'unlock_token': unlock_token,
                        'hardware_id': hardware_id or get_enhanced_hardware_id(),
                        'customer': result.get('customer'),
                        'subscription_status': result.get('subscription_status', 'active'),
                        'valid_until': result.get('valid_until'),
                        'subscription_id': result.get('subscription_id')
                    }
                    _save_license_cache(legacy_license_data)
                    app.logger.info("License saved to legacy cache for backward compatibility")
                except Exception as e:
                    app.logger.warning(f"Failed to save license to legacy cache: {e}")
                    # Don't fail the request if legacy cache save fails

            # Add API metadata
            result['_api_endpoint'] = 'validate_license'
            result['_unified_system'] = True
            result['_timestamp'] = datetime.now().isoformat()

            # Return appropriate HTTP status
            if result.get('licensed') and result.get('active'):
                return jsonify(result), 200
            elif 'error' in result:
                return jsonify(result), 400
            else:
                return jsonify(result), 200

        else:
            # No credentials available - use unified system for file-based validation
            app.logger.info("No cloud credentials found, using unified system for file-based validation")
            result = get_license_status_safe(force_refresh=True, context="api_validate_license_no_credentials")

            # Add API metadata
            result['cloud_validation'] = False
            result['validation_method'] = 'file_based_unified'
            result['_api_endpoint'] = 'validate_license'
            result['_unified_system'] = True
            result['_timestamp'] = datetime.now().isoformat()

            return jsonify(result), 200

    except Exception as e:
        app.logger.error(f"Unified license validation error: {e}")

        # Emergency fallback using unified system
        try:
            result = get_license_status_safe(force_refresh=True, context="api_validate_license_error")
            result['cloud_validation'] = False
            result['validation_method'] = 'unified_error_fallback'
            result['_api_endpoint'] = 'validate_license'
            result['_unified_system'] = True
            result['_error'] = str(e)
            result['_timestamp'] = datetime.now().isoformat()

            return jsonify(result), 500

        except Exception as fallback_error:
            app.logger.critical(f"Critical: Unified system emergency fallback failed: {fallback_error}")
            return jsonify({
                "licensed": False,
                "active": False,
                "subscription": False,
                "status": "error",
                "message": "License validation system unavailable",
                "cloud_validation": False,
                "validation_method": "critical_error",
                "_api_endpoint": "validate_license",
                "_unified_system": False,
                "_error": str(e),
                "_fallback_error": str(fallback_error),
                "_timestamp": datetime.now().isoformat(),
                "code": "CRITICAL_SYSTEM_ERROR"
            }), 500

# --- License Disconnect Endpoint and Helper Functions ---

# Global rate limiting for disconnect operations
_disconnect_rate_limit_data = {}
_disconnect_rate_limit_lock = threading.Lock()

def check_disconnect_rate_limit(email):
    """
    Rate limiting for license disconnect operations
    Max 3 attempts per 5 minutes per email

    Args:
        email: User email address

    Returns:
        tuple: (bool, str) - (allowed, error_message)
    """
    current_time = time.time()
    key = f"disconnect:{email}"

    with _disconnect_rate_limit_lock:
        if key not in _disconnect_rate_limit_data:
            _disconnect_rate_limit_data[key] = []

        # Clean old requests outside the 5-minute window
        _disconnect_rate_limit_data[key] = [req_time for req_time in _disconnect_rate_limit_data[key]
                                             if current_time - req_time < 300]  # 300 seconds = 5 minutes

        # Check if limit exceeded
        if len(_disconnect_rate_limit_data[key]) >= 3:
            return False, "Rate limit exceeded. Maximum 3 disconnect attempts per 5 minutes. Please try again later."

        # Add current request
        _disconnect_rate_limit_data[key].append(current_time)
        return True, ""

def get_current_device_session_id():
    """
    Get the current device's session ID from device_sessions.json

    Returns:
        str or None: Session ID if found, None otherwise
    """
    try:
        state = load_centralized_state()
        device_sessions = state.get('device_sessions', {})

        # Get the first active session (current device)
        # In practice, there should only be one session for the current device
        for session_id, session_data in device_sessions.items():
            if session_data.get('active'):
                app.logger.info(f"Found active device session: {session_id}")
                return session_id

        app.logger.warning("No active device session found")
        return None

    except Exception as e:
        app.logger.error(f"Error getting current device session ID: {e}")
        return None

def end_cloud_session(email, unlock_token, session_id):
    """
    Call Cloudflare /session/end endpoint to end cloud session

    Args:
        email: Customer email
        unlock_token: License unlock token
        session_id: Device session ID

    Returns:
        tuple: (bool, str) - (success, error_message)
    """
    try:
        if not session_id:
            app.logger.warning("No session ID provided for cloud session end")
            return False, "No session ID available"

        # Call existing Cloudflare /session/end endpoint
        payload = {
            "sessionId": session_id,
            "sendEmail": True  # Trigger email notification to customer
        }

        app.logger.info(f"Calling Cloudflare /session/end for session: {session_id}")
        response = call_cloudflare_api('/session/end', payload, timeout=10)

        if response and response.get('success'):
            app.logger.info(f"Cloud session ended successfully: {session_id}")
            return True, ""
        else:
            error_msg = response.get('error', 'Unknown error') if response else 'API call failed'
            app.logger.warning(f"Cloud session end failed: {error_msg}")
            return False, error_msg

    except Exception as e:
        app.logger.error(f"Error ending cloud session: {e}")
        return False, str(e)

def clear_local_device_sessions():
    """
    Clear device_sessions.json file

    Returns:
        tuple: (bool, str) - (success, error_message)
    """
    max_retries = 3
    retry_delay = 0.5

    for attempt in range(max_retries):
        try:
            # Clear device sessions by saving empty dict
            success = save_centralized_state('device_sessions', {})
            if success:
                app.logger.info("Device sessions cleared successfully")
                return True, ""
            else:
                app.logger.warning(f"Failed to clear device sessions (attempt {attempt + 1}/{max_retries})")

        except Exception as e:
            app.logger.error(f"Error clearing device sessions (attempt {attempt + 1}/{max_retries}): {e}")

        # Wait before retry
        if attempt < max_retries - 1:
            time.sleep(retry_delay)

    return False, "Failed to clear device sessions after multiple attempts"

def clear_license_cache_files():
    """
    Clear encrypted license cache files from both DATA_DIR and PROGRAM_DATA_DIR

    Returns:
        tuple: (bool, list) - (success, list of cleared files)
    """
    cache_files = [
        LICENSE_CACHE_FILE,  # data/license_cache.enc
        LICENSE_CACHE_BACKUP  # C:\ProgramData\POSPal\license_cache.enc
    ]

    cleared_files = []
    max_retries = 3
    retry_delay = 0.5

    for cache_file in cache_files:
        if not os.path.exists(cache_file):
            app.logger.debug(f"License cache file does not exist: {cache_file}")
            continue

        # Try to delete with retries
        for attempt in range(max_retries):
            try:
                os.remove(cache_file)
                cleared_files.append(cache_file)
                app.logger.info(f"Cleared license cache: {cache_file}")
                break

            except PermissionError:
                app.logger.warning(f"Permission denied clearing cache (attempt {attempt + 1}/{max_retries}): {cache_file}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)

            except Exception as e:
                app.logger.error(f"Error clearing license cache (attempt {attempt + 1}/{max_retries}): {cache_file} - {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)

    # Return success if at least one file was cleared or if no files existed
    success = len(cleared_files) > 0 or len(cache_files) == 0
    return success, cleared_files

def clear_trial_data():
    """
    Clear trial.json files from both DATA_DIR and PROGRAM_DATA_DIR

    Returns:
        tuple: (bool, list) - (success, list of cleared files)
    """
    trial_files = [
        TRIAL_INFO_FILE,  # data/trial.json
        PROGRAM_TRIAL_FILE  # C:\ProgramData\POSPal\trial.json
    ]

    cleared_files = []
    max_retries = 3
    retry_delay = 0.5

    for trial_file in trial_files:
        if not os.path.exists(trial_file):
            app.logger.debug(f"Trial file does not exist: {trial_file}")
            continue

        # Try to delete with retries
        for attempt in range(max_retries):
            try:
                os.remove(trial_file)
                cleared_files.append(trial_file)
                app.logger.info(f"Cleared trial data: {trial_file}")
                break

            except PermissionError:
                app.logger.warning(f"Permission denied clearing trial data (attempt {attempt + 1}/{max_retries}): {trial_file}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)

            except Exception as e:
                app.logger.error(f"Error clearing trial data (attempt {attempt + 1}/{max_retries}): {trial_file} - {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)

    # Return success if at least one file was cleared or if no files existed
    success = len(cleared_files) > 0 or len(trial_files) == 0
    return success, cleared_files

def log_disconnect_event(email, cleanup_summary):
    """
    Log disconnect event to file for auditing

    Args:
        email: Customer email
        cleanup_summary: Dict containing cleanup results
    """
    try:
        log_file = os.path.join(DATA_DIR, 'disconnect_log.json')

        # Load existing logs
        logs = []
        if os.path.exists(log_file):
            try:
                with open(log_file, 'r', encoding='utf-8') as f:
                    logs = json.load(f)
                    if not isinstance(logs, list):
                        logs = []
            except:
                logs = []

        # Add new log entry
        log_entry = {
            'timestamp': datetime.now().isoformat(),
            'email': email,
            'cleanup_summary': cleanup_summary
        }
        logs.append(log_entry)

        # Keep only last 100 entries
        logs = logs[-100:]

        # Save logs
        with open(log_file, 'w', encoding='utf-8') as f:
            json.dump(logs, f, indent=2)

        app.logger.info(f"Disconnect event logged for: {email}")

    except Exception as e:
        app.logger.error(f"Error logging disconnect event: {e}")

@app.route('/api/disconnect-license', methods=['POST'])
def disconnect_license():
    """
    Disconnect license from this device

    This endpoint coordinates local file cleanup with cloud session termination.
    It calls the existing Cloudflare /session/end endpoint and clears all local
    license-related files to allow the user to move the license to another device.

    Request JSON:
        {
            "email": "user@example.com",
            "unlock_token": "POSPAL-XXXX-XXXX-XXXX",
            "confirm_password": "9999"
        }

    Returns:
        JSON response with cleanup summary and unlock token
    """
    try:
        # Rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
        if not check_rate_limit(client_ip, 'disconnect-license', max_requests=5, window_seconds=300):
            app.logger.warning(f"Rate limit exceeded for disconnect-license from {client_ip}")
            return jsonify({
                "error": "Too many requests. Please try again later.",
                "code": "RATE_LIMIT"
            }), 429

        # Parse and validate request
        try:
            data = request.get_json()
            if not data or not isinstance(data, dict):
                return jsonify({
                    "error": "Invalid request format",
                    "code": "INVALID_REQUEST"
                }), 400
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({
                "error": "Invalid JSON in request",
                "code": "INVALID_JSON"
            }), 400

        # Validate required fields
        email = data.get('email')
        unlock_token = data.get('unlock_token')
        confirm_password = data.get('confirm_password')

        if not email or not unlock_token or not confirm_password:
            return jsonify({
                "error": "Missing required fields: email, unlock_token, confirm_password",
                "code": "MISSING_FIELDS"
            }), 400

        # Sanitize inputs
        email = sanitize_string_input(email, 254)
        unlock_token = sanitize_string_input(unlock_token, 512)
        confirm_password = sanitize_string_input(confirm_password, 100)

        # Validate email format
        if not validate_email(email):
            return jsonify({
                "error": "Invalid email format",
                "code": "INVALID_EMAIL"
            }), 400

        # Check disconnect-specific rate limiting (3 per 5 minutes per email)
        rate_ok, rate_msg = check_disconnect_rate_limit(email)
        if not rate_ok:
            app.logger.warning(f"Disconnect rate limit exceeded for email: {email}")
            return jsonify({
                "error": rate_msg,
                "code": "DISCONNECT_RATE_LIMIT"
            }), 429

        # Verify management password from config.json
        try:
            with open(os.path.join(DATA_DIR, 'config.json'), 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                stored_password = config_data.get('management_password', '9999')
        except Exception as e:
            app.logger.error(f"Error reading management password: {e}")
            stored_password = '9999'  # Default fallback

        if confirm_password != stored_password:
            app.logger.warning(f"Invalid management password for disconnect attempt: {email}")
            return jsonify({
                "error": "Invalid management password",
                "code": "INVALID_PASSWORD"
            }), 401

        app.logger.info(f"Starting license disconnect for: {email}")

        # Initialize cleanup summary
        cleanup_summary = {
            "local_files_cleared": False,
            "trial_data_cleared": False,
            "device_sessions_cleared": False,
            "cloud_session_ended": False,
            "license_cache_cleared": False
        }
        warnings = []

        # Step 1: Get current device session ID
        session_id = get_current_device_session_id()
        if not session_id:
            warnings.append("No active device session found to end")

        # Step 2: End cloud session (if online)
        if session_id:
            cloud_success, cloud_error = end_cloud_session(email, unlock_token, session_id)
            cleanup_summary["cloud_session_ended"] = cloud_success
            if not cloud_success:
                warnings.append(f"Cloud session end failed: {cloud_error}. Session will auto-expire in 2 minutes.")
        else:
            warnings.append("No session ID available for cloud cleanup")

        # Step 3: Clear local files (continue even if cloud failed)

        # Clear license cache files
        cache_success, cleared_cache_files = clear_license_cache_files()
        cleanup_summary["license_cache_cleared"] = cache_success
        if not cache_success and len(cleared_cache_files) == 0:
            warnings.append("Failed to clear license cache files")

        # Clear trial data
        trial_success, cleared_trial_files = clear_trial_data()
        cleanup_summary["trial_data_cleared"] = trial_success
        if not trial_success and len(cleared_trial_files) == 0:
            warnings.append("Failed to clear trial data")

        # Clear device sessions
        sessions_success, sessions_error = clear_local_device_sessions()
        cleanup_summary["device_sessions_cleared"] = sessions_success
        if not sessions_success:
            warnings.append(f"Failed to clear device sessions: {sessions_error}")

        # Overall local files status
        cleanup_summary["local_files_cleared"] = (
            cleanup_summary["license_cache_cleared"] and
            cleanup_summary["trial_data_cleared"] and
            cleanup_summary["device_sessions_cleared"]
        )

        # Step 4: Log disconnect event
        log_disconnect_event(email, cleanup_summary)

        # Determine overall success
        # Success if local files are cleared, even if cloud failed (offline mode)
        success = cleanup_summary["local_files_cleared"]

        # Prepare response
        response_data = {
            "success": success,
            "message": "License disconnected successfully" if success else "License disconnection completed with warnings",
            "disconnected_at": datetime.now().isoformat(),
            "cleanup_summary": cleanup_summary,
            "unlock_token": unlock_token,
            "warnings": warnings
        }

        if success:
            app.logger.info(f"License disconnected successfully for: {email}")
            return jsonify(response_data), 200
        else:
            app.logger.warning(f"License disconnection completed with issues for: {email}")
            return jsonify(response_data), 207  # Multi-Status (partial success)

    except Exception as e:
        app.logger.error(f"Unexpected error during license disconnect: {e}")
        return jsonify({
            "error": "Internal server error during disconnect",
            "code": "SERVER_ERROR",
            "details": str(e)
        }), 500

# ============================================================================
# SERVER-SIDE LICENSE ACTIVATION ENDPOINTS (NEW: Multi-Device Support)
# ============================================================================

@app.route('/api/license/activate', methods=['POST'])
def activate_server_license():
    """
    Activate license on the server (admin only)

    This endpoint allows administrators to activate a license centrally on the server.
    Once activated, all connected devices/browsers will inherit the server's license status
    without requiring individual activation.

    Request JSON:
        {
            "email": "customer@example.com",
            "unlock_token": "ABC123XYZ",
            "password": "9999"  # Management password for security
        }

    Returns:
        JSON response with validation status and license info
    """
    try:
        # Rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
        if not check_rate_limit(client_ip, 'license-activate', max_requests=5, window_seconds=300):
            app.logger.warning(f"Rate limit exceeded for license-activate from {client_ip}")
            return jsonify({
                "error": "Too many requests. Please try again later.",
                "code": "RATE_LIMIT"
            }), 429

        # SECURITY: Only allow license management from localhost (server device)
        # Prevents tablets/remote devices from modifying server licensing
        remote_addr = request.remote_addr
        if remote_addr not in ['127.0.0.1', '::1']:
            app.logger.warning(f"License activation blocked from non-localhost IP: {remote_addr}")
            return jsonify({
                "success": False,
                "error": "License management is only available on the server device. Please access via http://localhost:5000",
                "code": "LOCALHOST_ONLY"
            }), 403

        # Parse and validate request
        try:
            data = request.get_json()
            if not data or not isinstance(data, dict):
                return jsonify({
                    "error": "Invalid request format",
                    "code": "INVALID_REQUEST"
                }), 400
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({
                "error": "Invalid JSON in request",
                "code": "INVALID_JSON"
            }), 400

        # Validate required fields
        email = data.get('email')
        unlock_token = data.get('unlock_token')
        password = data.get('password')

        if not email or not unlock_token or not password:
            return jsonify({
                "error": "Missing required fields: email, unlock_token, password",
                "code": "MISSING_FIELDS"
            }), 400

        # Sanitize inputs
        email = sanitize_string_input(email, 254)
        unlock_token = sanitize_string_input(unlock_token, 512)
        password = sanitize_string_input(password, 100)

        # Validate email format
        if not validate_email(email):
            return jsonify({
                "error": "Invalid email format",
                "code": "INVALID_EMAIL"
            }), 400

        # Verify management password from config.json (admin only)
        try:
            with open(os.path.join(DATA_DIR, 'config.json'), 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                stored_password = config_data.get('management_password', '9999')
        except Exception as e:
            app.logger.error(f"Error reading management password: {e}")
            stored_password = '9999'  # Default fallback

        if password != stored_password:
            app.logger.warning(f"Invalid management password for license activation attempt: {email}")
            return jsonify({
                "error": "Invalid management password. Only administrators can activate server licenses.",
                "code": "INVALID_PASSWORD"
            }), 401

        app.logger.info(f"Starting server license activation for: {email[:5]}***")

        # Get hardware ID for validation
        hardware_id = get_enhanced_hardware_id()

        # Validate license with Cloudflare Workers
        app.logger.info("Validating license with Cloudflare Workers...")
        success, license_data, error_msg, from_cache, cloud_reachable = _validate_license_with_cloud(
            email,
            unlock_token,
            hardware_id,
            CLOUD_VALIDATION_TIMEOUT,
            force_refresh=True
        )

        if not success or not license_data:
            app.logger.error(f"Server license activation failed: {error_msg}")
            return jsonify({
                "success": False,
                "error": error_msg or "License validation failed",
                "code": "VALIDATION_FAILED"
            }), 400

        # Check if license is valid/active
        if not license_data.get('valid'):
            app.logger.error(f"Server license activation failed: License not valid")
            return jsonify({
                "success": False,
                "error": "License is not valid or subscription is inactive",
                "code": "LICENSE_INACTIVE",
                "subscription_status": license_data.get('subscriptionInfo', {}).get('status')
            }), 400

        # Save server license
        if not save_server_license(email, unlock_token):
            app.logger.error("Failed to save server license to disk")
            return jsonify({
                "success": False,
                "error": "Failed to save license to server",
                "code": "SAVE_FAILED"
            }), 500

        # Save license cache for offline grace period support
        _save_license_cache(license_data)

        app.logger.info(f"Server license activated successfully for: {email[:5]}***")

        # Return success with license info
        subscription_info = license_data.get('subscriptionInfo', {})
        return jsonify({
            "success": True,
            "message": "Server license activated successfully. All devices will now use this license.",
            "license": {
                "email": email,
                "customer_name": license_data.get('customerName'),
                "status": subscription_info.get('status'),
                "next_billing_date": subscription_info.get('nextBillingDate'),
                "activated_at": datetime.now().isoformat()
            }
        }), 200

    except Exception as e:
        app.logger.error(f"Unexpected error during server license activation: {e}")
        return jsonify({
            "error": "Internal server error during activation",
            "code": "SERVER_ERROR",
            "details": str(e)
        }), 500

@app.route('/api/health', methods=['GET', 'HEAD'])
def health_check():
    """
    Simple health check endpoint with no blocking operations.
    Returns immediately to confirm server is responsive.

    Used by enhanced-ux-manager.js to test server connectivity.
    """
    return jsonify({"status": "ok"}), 200

@app.route('/api/license/credentials', methods=['GET'])
def get_license_credentials():
    """
    Get license credentials for Customer Portal access (localhost only)

    SECURITY: This endpoint is localhost-only to prevent credentials from being
    exposed to tablets/remote devices. Only the server device can access portal.

    Returns:
        JSON with email and unlock_token for portal session creation
    """
    # SECURITY: Only allow from localhost
    remote_addr = request.remote_addr
    if remote_addr not in ['127.0.0.1', '::1']:
        app.logger.warning(f"License credentials access blocked from non-localhost IP: {remote_addr}")
        return jsonify({
            "error": "License credentials are only available on the server device",
            "code": "LOCALHOST_ONLY"
        }), 403

    try:
        # Load server license
        server_license = load_server_license()

        if not server_license:
            return jsonify({
                "error": "No server license found",
                "code": "NO_LICENSE"
            }), 404

        # Return credentials (localhost-only, so safe to expose)
        return jsonify({
            "email": server_license.get('customer_email'),
            "unlockToken": server_license.get('unlock_token')
        }), 200

    except Exception as e:
        app.logger.error(f"Error getting license credentials: {e}")
        return jsonify({
            "error": "Failed to retrieve license credentials",
            "code": "SERVER_ERROR"
        }), 500


def _get_cached_license_payload(email: str | None, source_hint: str = "server_license_cached"):
    """
    Build the cached license payload used when cloud validation is unavailable.

    Returns:
        dict payload if cache is valid, otherwise None.
    """
    cache_data = _load_license_cache()
    if not cache_data:
        return None

    last_validation = cache_data.get('last_validation')
    if not last_validation:
        return None

    days_offline, is_expired, warning_level = _calculate_grace_period_status(last_validation)
    if is_expired:
        return None

    days_left = GRACE_PERIOD_DAYS - days_offline
    cached_license = cache_data.get('license_data', {})
    subscription_info = cached_license.get('subscriptionInfo', {})
    customer_name = cached_license.get('customerName')
    subscription_status = subscription_info.get('status')
    next_billing_date = subscription_info.get('nextBillingDate')
    current_period_end = subscription_info.get('currentPeriodEnd')
    subscription_amount = subscription_info.get('amount') or subscription_info.get('plan', {}).get('amount')
    subscription_currency = (subscription_info.get('currency') or 'eur').upper() if subscription_info else None

    if subscription_amount and subscription_amount >= 100:
        subscription_price = subscription_amount / 100.0
    else:
        subscription_price = subscription_amount

    response_payload = {
        "licensed": True,
        "active": True,
        "grace_period": True,
        "days_offline": days_offline,
        "grace_days_left": days_left,
        "email": email,
        "customer_name": customer_name,
        "subscription_status": subscription_status,
        "next_billing_date": next_billing_date,
        "subscription_price": subscription_price,
        "subscription_currency": subscription_currency,
        "current_period_end": current_period_end,
        "warning": f"Server offline for {days_offline} days. {days_left} days remaining.",
        "source": source_hint,
        "offline": True,
        "connectivity_status": "offline_cached",
    }

    if warning_level is not None:
        response_payload["warning_level"] = warning_level

    return response_payload


def _build_cached_license_response(email: str, source_hint: str = "server_license_cached"):
    """
    Return a cached license response if grace period allows continued operation.

    Args:
        email: Customer email associated with the cached license.
        source_hint: String to identify the response source in logs/UI.

    Returns:
        (jsonify(result), status_code) when cache is valid, otherwise None.
    """
    payload = _get_cached_license_payload(email, source_hint)
    if not payload:
        return None
    return jsonify(payload), 200


def _derive_subscription_price(subscription_info: dict | None):
    """Return (price, currency_upper) derived from subscription info."""
    if not subscription_info:
        return None, None

    amount = subscription_info.get('amount')
    if amount is None:
        plan = subscription_info.get('plan') or {}
        amount = plan.get('amount')

    currency = (subscription_info.get('currency')
                or subscription_info.get('plan', {}).get('currency')
                or 'eur')
    currency = currency.upper() if isinstance(currency, str) else None

    if amount is None:
        return None, currency

    try:
        amount_value = float(amount)
    except (TypeError, ValueError):
        return None, currency

    if amount_value >= 100:
        amount_value = amount_value / 100.0
    return amount_value, currency


def _normalize_license_status_payload(email: str | None,
                                      payload: dict,
                                      server_license: dict | None,
                                      source: str) -> dict:
    """Normalize various payload shapes to a consistent license status response."""
    result: dict[str, object] = {}
    email_value = payload.get('email') or email
    subscription_info = payload.get('subscription_info') or {}
    subscription_price = payload.get('subscription_price')
    subscription_currency = payload.get('subscription_currency')
    if subscription_price is None:
        price, currency = _derive_subscription_price(subscription_info)
        subscription_price = price
        subscription_currency = subscription_currency or currency

    result.update({
        "licensed": payload.get('licensed', payload.get('valid', True)),
        "active": payload.get('active', payload.get('valid', False)),
        "email": email_value,
        "customer_name": payload.get('customer_name') or payload.get('customerName'),
        "subscription_status": payload.get('subscription_status') or subscription_info.get('status'),
        "subscription_price": subscription_price,
        "subscription_currency": subscription_currency,
        "next_billing_date": payload.get('next_billing_date') or subscription_info.get('nextBillingDate'),
        "current_period_end": payload.get('current_period_end') or subscription_info.get('currentPeriodEnd'),
        "grace_period": payload.get('grace_period', False),
        "grace_days_left": payload.get('grace_days_left'),
        "days_offline": payload.get('days_offline'),
        "source": payload.get('source', source),
        "validated_at": payload.get('validated_at'),
        "connectivity_status": payload.get('connectivity_status', 'unknown'),
        "timestamp": datetime.now().isoformat(),
    })

    if server_license:
        result.setdefault("activated_at", server_license.get('activated_at'))

    return result


def _compute_server_license_status(force_refresh: bool = False) -> dict | None:
    """Generate the canonical license status payload for /api/license/status."""
    server_license = load_server_license()
    if not server_license:
        return {
            "licensed": False,
            "active": False,
            "message": "No server license activated",
            "trial_available": True,
            "source": "server_license_missing",
            "timestamp": datetime.now().isoformat()
        }

    email = server_license.get('customer_email')
    unlock_token = server_license.get('unlock_token')

    if not email or not unlock_token:
        return {
            "licensed": False,
            "active": False,
            "error": "Server license credentials incomplete",
            "source": "server_license_incomplete",
            "timestamp": datetime.now().isoformat()
        }

    hardware_id = get_enhanced_hardware_id()

    success, license_data, error_msg, from_cache, cloud_reachable = _validate_license_with_cloud(
        email,
        unlock_token,
        hardware_id,
        CLOUD_VALIDATION_TIMEOUT,
        force_refresh=force_refresh
    )

    if success and license_data:
        if not from_cache:
            _save_license_cache(license_data)
        payload = _normalize_license_status_payload(
            email,
            license_data,
            server_license,
            source="server_license_cache" if from_cache else "server_license_cloud"
        )
        payload["active"] = license_data.get('valid', True)
        if not payload.get("validated_at"):
            payload["validated_at"] = license_data.get('validated_at') or datetime.now().isoformat()
        payload["_cache_hit"] = from_cache
        payload["connectivity_status"] = "online_cached" if from_cache else "online"
        payload["grace_period"] = False
        payload["offline"] = False
        return payload

    if license_data:
        normalized = _normalize_license_status_payload(
            email,
            license_data,
            server_license,
            source=license_data.get('source', 'server_license_cached_payload')
        )
        normalized["_cache_hit"] = True
        if not normalized.get("connectivity_status"):
            normalized["connectivity_status"] = "online_cached" if cloud_reachable else "offline_cached"
        if not cloud_reachable:
            normalized["offline"] = True
        return normalized

    cached_payload = _get_cached_license_payload(email, "server_license_cached_direct")
    if cached_payload:
        normalized = _normalize_license_status_payload(
            email,
            cached_payload,
            server_license,
            source=cached_payload.get('source', 'server_license_cached_direct')
        )
        normalized["_cache_hit"] = True
        if not normalized.get("connectivity_status"):
            normalized["connectivity_status"] = "offline_cached"
        normalized["offline"] = True
        return normalized

    return {
        "licensed": False,
        "active": False,
        "error": error_msg or "License validation failed",
        "email": email,
        "source": "server_license_failed",
        "timestamp": datetime.now().isoformat(),
        "connectivity_status": "online" if cloud_reachable else "offline"
    }


license_status_coordinator = LicenseStatusCoordinator(_compute_server_license_status)


@app.route('/api/license/status', methods=['GET'])
def get_server_license_status():
    """
    Get server license status (all users)

    This endpoint returns the current license status from the server.
    All connected devices use this to check if the server has an active license.

    Returns:
        JSON response with license status and details
    """
    try:
        force_refresh = request.args.get('refresh', '').lower() in {'1', 'true', 'yes', 'force'}
        payload, served_from_cache = license_status_coordinator.get_status(force_refresh=force_refresh)

        cache_state = "empty"
        if payload:
            cache_state = "cache_hit" if served_from_cache else "refreshed"
        else:
            payload = {
                "licensed": False,
                "active": False,
                "message": "No license data available",
                "source": "server_license_unavailable",
                "timestamp": datetime.now().isoformat()
            }

        response_payload = copy.deepcopy(payload)
        response_payload["_cache_state"] = cache_state
        response_payload["_requested_force_refresh"] = force_refresh

        return jsonify(response_payload), 200

    except Exception as e:
        app.logger.error(f"Unexpected error getting server license status: {e}")
        fallback = {
            "licensed": False,
            "active": False,
            "error": "Unable to verify license while offline",
            "source": "server_license_exception",
            "details": str(e),
            "timestamp": datetime.now().isoformat()
        }
        return jsonify(fallback), 200

@app.route('/api/license/deactivate', methods=['POST'])
def deactivate_server_license():
    """
    Deactivate server license (admin only)

    This endpoint removes the server license, requiring reactivation.
    All connected devices will lose access when the license is deactivated.

    Request JSON:
        {
            "password": "9999"  # Management password for security
        }

    Returns:
        JSON response confirming deactivation
    """
    try:
        # Rate limiting
        client_ip = request.environ.get('HTTP_X_FORWARDED_FOR', request.environ.get('REMOTE_ADDR', '127.0.0.1'))
        if not check_rate_limit(client_ip, 'license-deactivate', max_requests=5, window_seconds=300):
            app.logger.warning(f"Rate limit exceeded for license-deactivate from {client_ip}")
            return jsonify({
                "error": "Too many requests. Please try again later.",
                "code": "RATE_LIMIT"
            }), 429

        # SECURITY: Only allow license management from localhost (server device)
        # Prevents tablets/remote devices from modifying server licensing
        remote_addr = request.remote_addr
        if remote_addr not in ['127.0.0.1', '::1']:
            app.logger.warning(f"License deactivation blocked from non-localhost IP: {remote_addr}")
            return jsonify({
                "success": False,
                "error": "License management is only available on the server device. Please access via http://localhost:5000",
                "code": "LOCALHOST_ONLY"
            }), 403

        # Parse and validate request
        try:
            data = request.get_json()
            if not data or not isinstance(data, dict):
                return jsonify({
                    "error": "Invalid request format",
                    "code": "INVALID_REQUEST"
                }), 400
        except (json.JSONDecodeError, UnicodeDecodeError):
            return jsonify({
                "error": "Invalid JSON in request",
                "code": "INVALID_JSON"
            }), 400

        # Validate password
        password = data.get('password')
        if not password:
            return jsonify({
                "error": "Missing required field: password",
                "code": "MISSING_FIELDS"
            }), 400

        password = sanitize_string_input(password, 100)

        # Verify management password (admin only)
        try:
            with open(os.path.join(DATA_DIR, 'config.json'), 'r', encoding='utf-8') as f:
                config_data = json.load(f)
                stored_password = config_data.get('management_password', '9999')
        except Exception as e:
            app.logger.error(f"Error reading management password: {e}")
            stored_password = '9999'

        if password != stored_password:
            app.logger.warning("Invalid management password for license deactivation attempt")
            return jsonify({
                "error": "Invalid management password. Only administrators can deactivate server licenses.",
                "code": "INVALID_PASSWORD"
            }), 401

        app.logger.info("Deactivating server license...")

        # Delete server license files
        if delete_server_license():
            app.logger.info("Server license deactivated successfully")
            return jsonify({
                "success": True,
                "message": "Server license deactivated successfully. All devices will lose access."
            }), 200
        else:
            app.logger.warning("No server license found to deactivate")
            return jsonify({
                "success": False,
                "message": "No server license was found to deactivate"
            }), 404

    except Exception as e:
        app.logger.error(f"Unexpected error during server license deactivation: {e}")
        return jsonify({
            "error": "Internal server error during deactivation",
            "code": "SERVER_ERROR",
            "details": str(e)
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
    """
    Get enhanced hardware fingerprint using multiple identifiers - STANDARDIZED VERSION
    This function has been standardized to match the unified algorithm from license_controller
    to eliminate false "Computer Changed" emails after application rebuilds.

    Returns the full 64-character SHA256 hash (not truncated) for consistency.

    OPTIMIZED: Uses global cache and parallel WMIC execution to prevent blocking.
    """
    global _cached_hardware_id

    # Return cached value if available (hardware ID never changes)
    if _cached_hardware_id:
        return _cached_hardware_id

    import subprocess
    import platform
    from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

    try:
        # Get MAC address (unified algorithm - primary identifier)
        mac = ':'.join(['{:02x}'.format((uuid.getnode() >> i) & 0xff) for i in range(0, 8*6, 8)][::-1])

        # Get CPU info (EXACT match to unified algorithm)
        cpu_info = 'Unknown'
        try:
            cpu_info = platform.processor()
            if not cpu_info:
                # Fallback to WMIC
                pass
        except:
            pass

        # Run all 3 WMIC commands in parallel to reduce blocking time
        def get_cpu_wmic():
            try:
                result = subprocess.run(['wmic', 'cpu', 'get', 'name'],
                                      capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                return result.stdout.split('\n')[1].strip() if result.stdout else 'Unknown'
            except:
                return 'Unknown'

        def get_disk_serial():
            try:
                result = subprocess.run(['wmic', 'diskdrive', 'get', 'serialnumber'],
                                      capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line and line != 'SerialNumber':
                            return line
            except:
                pass
            return 'Unknown'

        def get_windows_id():
            try:
                result = subprocess.run(['wmic', 'csproduct', 'get', 'uuid'],
                                      capture_output=True, text=True, timeout=5, creationflags=subprocess.CREATE_NO_WINDOW)
                if result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line and line != 'UUID':
                            return line
            except:
                pass
            return 'Unknown'

        # Execute all WMIC calls in parallel (reduces ~15s to ~5s)
        with ThreadPoolExecutor(max_workers=3) as executor:
            # Only run WMIC for CPU if platform.processor() failed
            if cpu_info == 'Unknown':
                future_cpu = executor.submit(get_cpu_wmic)
            else:
                future_cpu = None

            future_disk = executor.submit(get_disk_serial)
            future_windows = executor.submit(get_windows_id)

            # Wait for results with timeout
            try:
                if future_cpu:
                    cpu_info = future_cpu.result(timeout=5)
                disk_serial = future_disk.result(timeout=5)
                windows_id = future_windows.result(timeout=5)
            except FuturesTimeoutError:
                app.logger.warning("WMIC command timeout - using partial hardware ID")
                disk_serial = disk_serial if 'disk_serial' in locals() else 'Unknown'
                windows_id = windows_id if 'windows_id' in locals() else 'Unknown'

        # Combine all identifiers and hash (EXACT same as unified algorithm)
        combined = f"{mac}|{cpu_info}|{disk_serial}|{windows_id}"
        hardware_id = hashlib.sha256(combined.encode()).hexdigest()  # Full 64-char hash, not truncated

        # Cache the result globally
        _cached_hardware_id = hardware_id

        return hardware_id

    except Exception as e:
        app.logger.error(f"Error generating hardware ID: {e}")
        return "hardware_id_generation_failed"

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

def _validate_license_with_cloud(
    customer_email,
    unlock_token,
    hardware_id,
    timeout=CLOUD_VALIDATION_TIMEOUT,
    cache_data=None,
    force_refresh=False
):
    """
    Validate license with Cloudflare Worker with timeout and error handling.
    Returns: (success, license_data, error_message, from_cache, cloud_reachable)
    """
    if _should_skip_cloud_validation():
        backoff_remaining = CLOUD_FAILURE_BACKOFF_SECONDS - (
            (datetime.now() - _last_cloud_failure["timestamp"]).total_seconds()
            if _last_cloud_failure.get("timestamp") else 0
        )
        app.logger.warning(
            "Skipping cloud validation due to recent failure. "
            f"Backoff remaining: {max(int(backoff_remaining), 0)}s"
        )
        cached_payload = _get_cached_license_payload(customer_email, "server_license_cached_backoff")
        return False, cached_payload, _last_cloud_failure.get("error") or "Cloud validation backoff active", bool(cached_payload), False

    def _cache_age_seconds(cache_info):
        if not cache_info:
            return None
        last_validation = cache_info.get('last_validation')
        if not last_validation:
            return None
        try:
            return (datetime.now() - datetime.fromisoformat(last_validation)).total_seconds()
        except ValueError:
            return None

    cache_info = cache_data or _load_license_cache()
    if not force_refresh:
        age_seconds = _cache_age_seconds(cache_info)
        if age_seconds is not None and age_seconds < CLOUD_VALIDATION_CACHE_SECONDS:
            license_data = cache_info.get('license_data')
            if license_data:
                app.logger.info(
                    "Skipping cloud validation - cached license confirmation "
                    f"{age_seconds:.1f}s old (threshold {CLOUD_VALIDATION_CACHE_SECONDS}s)"
                )
                return True, dict(license_data), None, True, True

    lock_acquired = _cloud_validation_lock.acquire(blocking=False)
    if not lock_acquired:
        if not force_refresh and cache_info and cache_info.get('license_data'):
            app.logger.info("Cloud validation already in progress - returning cached license data")
            return True, dict(cache_info['license_data']), None, True, True
        # Wait for the in-flight validation to finish before re-checking freshness
        _cloud_validation_lock.acquire()
        lock_acquired = True
        cache_info = _load_license_cache()

    try:
        if not force_refresh:
            age_seconds = _cache_age_seconds(cache_info)
            if age_seconds is not None and age_seconds < CLOUD_VALIDATION_CACHE_SECONDS:
                license_data = cache_info.get('license_data')
                if license_data:
                    app.logger.info(
                        "Skipping cloud validation after lock acquisition - cached license confirmation "
                        f"{age_seconds:.1f}s old"
                    )
                    return True, dict(license_data), None, True, True

        app.logger.info(f"Attempting cloud license validation for {customer_email[:5]}*** with {timeout}s timeout")
        
        # Prepare validation data
        validation_data = {
            'email': customer_email,
            'token': unlock_token,
            'machineFingerprint': hardware_id
        }
        
        # Call cloud validation with timeout
        response = call_cloudflare_api('/validate', validation_data, timeout=timeout, max_retries=1)
        
        if not response:
            _record_cloud_failure("No response from cloud validation service")
            return False, None, "No response from cloud validation service", False, False
            
        if response.get('valid'):
            # The worker returns the license data directly in the response
            license_data = {
                'valid': response.get('valid'),  # Include 'valid' field from API response
                'customer_email': customer_email,
                'unlock_token': unlock_token,
                'hardware_id': hardware_id,
                'customer_name': response.get('customerName', ''),
                'customer_id': response.get('customerId', ''),
                'subscription_info': response.get('subscriptionInfo', {}),
                'validated_at': response.get('validatedAt', '')
            }
            
            # Extract subscription details if available
            subscription_info = response.get('subscriptionInfo', {})
            if subscription_info:
                license_data['valid_until'] = subscription_info.get('validUntil')
                license_data['subscription_id'] = subscription_info.get('subscriptionId')
                license_data['subscription_status'] = subscription_info.get('status')
                
            _clear_cloud_failure()
            app.logger.info(f"Cloud validation successful for {customer_email[:5]}***")
            return True, license_data, None, False, True
        else:
            error_msg = response.get('error', 'Unknown cloud validation error')
            app.logger.warning(f"Cloud validation failed: {error_msg}")
            _record_cloud_failure(error_msg)
            return False, None, error_msg, False, True
            
    except Exception as e:
        error_msg = f"Cloud validation exception: {str(e)}"
        app.logger.error(error_msg)
        _record_cloud_failure(error_msg)
        return False, None, error_msg, False, False
    finally:
        if lock_acquired:
            _cloud_validation_lock.release()

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
        cached_hw_id = cache_data['hardware_id']

        if cached_hw_id != current_hw_id:
            # Enhanced logging for fingerprint mismatch debugging
            app.logger.warning(f"License cache hardware ID mismatch - cache invalid")
            app.logger.warning(f"Cached hardware ID: {cached_hw_id}")
            app.logger.warning(f"Current hardware ID: {current_hw_id}")
            app.logger.warning(f"Cached ID length: {len(cached_hw_id)}, Current ID length: {len(current_hw_id)}")

            # Check if this might be a legacy vs unified algorithm mismatch
            if len(cached_hw_id) == 16 and len(current_hw_id) == 64:
                app.logger.warning("Detected legacy (16-char) vs unified (64-char) hardware ID mismatch")
                app.logger.warning("This indicates the cache was created with the old algorithm")
            elif len(cached_hw_id) == 64 and len(current_hw_id) == 16:
                app.logger.warning("Detected unified (64-char) vs legacy (16-char) hardware ID mismatch")
                app.logger.warning("This should not happen with the standardized implementation")

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
        license_status_coordinator.invalidate()
    except Exception as e:
        app.logger.error(f"Failed to clear license cache: {e}")

# ============================================================================
# SERVER-SIDE LICENSE MANAGEMENT (NEW: Multi-Device Support)
# ============================================================================
# These functions manage centralized license credentials on the server,
# allowing all connected devices to inherit the server's license status
# without requiring per-device activation.
# ============================================================================

def save_server_license(customer_email, unlock_token):
    """
    Save license credentials to server storage (encrypted)

    This stores the email and unlock_token centrally on the server,
    allowing all connected devices to use the same license without
    requiring individual activation on each browser/device.

    Args:
        customer_email: Customer email address
        unlock_token: License unlock token

    Returns:
        bool: True if saved successfully, False otherwise
    """
    try:
        # Validate inputs
        if not customer_email or not unlock_token:
            app.logger.error("Cannot save server license: missing email or token")
            return False

        # Get hardware ID for machine binding
        hardware_id = get_enhanced_hardware_id()

        # Create license data structure
        license_data = {
            'customer_email': customer_email,
            'unlock_token': unlock_token,
            'hardware_id': hardware_id,
            'activated_at': datetime.now().isoformat(),
            'version': '1.0'
        }

        # Encrypt the data
        encrypted_data = _encrypt_license_data(license_data)
        if not encrypted_data:
            app.logger.error("Failed to encrypt server license data")
            return False

        # Ensure directories exist
        os.makedirs(os.path.dirname(SERVER_LICENSE_FILE), exist_ok=True)
        os.makedirs(os.path.dirname(SERVER_LICENSE_BACKUP), exist_ok=True)

        # Save to primary location
        with open(SERVER_LICENSE_FILE, 'w') as f:
            f.write(encrypted_data)

        # Save backup copy
        with open(SERVER_LICENSE_BACKUP, 'w') as f:
            f.write(encrypted_data)

        app.logger.info(f"Server license saved successfully for {customer_email[:5]}***")
        license_status_coordinator.invalidate()
        return True

    except Exception as e:
        app.logger.error(f"Failed to save server license: {e}")
        return False

def load_server_license():
    """
    Load license credentials from server storage (decrypted)

    Returns:
        dict: License data containing email and unlock_token, or None if not found
        Example: {
            'customer_email': 'user@example.com',
            'unlock_token': 'ABC123XYZ',
            'hardware_id': '...',
            'activated_at': '2025-10-27T...',
            'version': '1.0'
        }
    """
    try:
        license_file = None

        # Try primary file first, then backup
        for file_path in [SERVER_LICENSE_FILE, SERVER_LICENSE_BACKUP]:
            if os.path.exists(file_path):
                license_file = file_path
                break

        if not license_file:
            app.logger.debug("No server license file found")
            return None

        # Read encrypted data
        with open(license_file, 'r') as f:
            encrypted_data = f.read().strip()

        if not encrypted_data:
            app.logger.warning("Server license file is empty")
            return None

        # Decrypt the data
        license_data = _decrypt_license_data(encrypted_data)
        if not license_data:
            app.logger.warning("Failed to decrypt server license")
            return None

        # Validate data structure
        required_fields = ['customer_email', 'unlock_token', 'hardware_id']
        if not all(field in license_data for field in required_fields):
            app.logger.warning("Server license missing required fields")
            return None

        # Verify hardware ID matches (license is machine-specific for security)
        current_hw_id = get_enhanced_hardware_id()
        if license_data['hardware_id'] != current_hw_id:
            app.logger.warning("Server license hardware ID mismatch - license invalid")
            app.logger.debug(f"Stored HW: {license_data['hardware_id'][:20]}...")
            app.logger.debug(f"Current HW: {current_hw_id[:20]}...")
            return None

        app.logger.info(f"Server license loaded successfully for {license_data['customer_email'][:5]}***")
        return license_data

    except Exception as e:
        app.logger.error(f"Failed to load server license: {e}")
        return None

def delete_server_license():
    """
    Delete server license files (deactivate server license)

    Returns:
        bool: True if deleted successfully, False otherwise
    """
    try:
        deleted_any = False

        for file_path in [SERVER_LICENSE_FILE, SERVER_LICENSE_BACKUP]:
            if os.path.exists(file_path):
                os.remove(file_path)
                app.logger.info(f"Deleted server license file: {file_path}")
                deleted_any = True

        if deleted_any:
            app.logger.info("Server license deactivated successfully")
            # Also clear the license cache when deactivating
            _clear_license_cache()
            license_status_coordinator.invalidate()
            return True
        else:
            app.logger.warning("No server license files found to delete")
            return False

    except Exception as e:
        app.logger.error(f"Failed to delete server license: {e}")
        return False

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

# Alias for backward compatibility
get_hardware_fingerprint = get_enhanced_hardware_id
    

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
                                
                                # Payment methods (skip 'Pending' for table orders not yet cleared)
                                payment_method = row.get('payment_method') or row.get('Payment Method', 'Cash')
                                if payment_method != 'Pending':
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
                            # Skip 'Pending' orders (table orders not yet cleared)
                            if pm == 'Pending':
                                continue
                            elif pm == 'Card':
                                payment_amounts['card'] += amt
                            elif pm == 'Mixed':
                                # For mixed payments, split 50/50 between cash and card for analytics
                                payment_amounts['cash'] += amt / 2
                                payment_amounts['card'] += amt / 2
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
            "paymentCounts": {
                'cash': payment_methods.get('Cash', 0) + payment_methods.get('Mixed', 0),
                'card': payment_methods.get('Card', 0) + payment_methods.get('Mixed', 0)
            },
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
            
            # Initialize license integration system
            if UNIFIED_LICENSES_ENABLED:
                try:
                    license_init_success = initialize_license_integration(
                        app, app.logger, DATA_DIR, PROGRAM_DATA_DIR,
                        BASE_DIR, str(APP_SECRET_KEY), call_cloudflare_api
                    )
                    if license_init_success:
                        app.logger.info("License integration system initialized successfully")
                    else:
                        app.logger.warning("License integration system failed to initialize")
                except Exception as e:
                    app.logger.error(f"License integration initialization error: {e}")
                    UNIFIED_LICENSES_ENABLED = False

            # Check for server license on startup (NEW: Multi-device support)
            try:
                server_license = load_server_license()
                if server_license:
                    email = server_license.get('customer_email', 'unknown')
                    app.logger.info(f"Server license found for: {email[:5]}***")
                    app.logger.info("All connected devices will use this server license")

                    # Validate server license in background to update cache
                    try:
                        unlock_token = server_license.get('unlock_token')
                        hardware_id = get_enhanced_hardware_id()
                        success, license_data, error_msg, from_cache, cloud_reachable = _validate_license_with_cloud(
                            email, unlock_token, hardware_id, timeout=5
                        )
                        if success and license_data:
                            if from_cache:
                                app.logger.info("Server license cache already fresh on startup - skipping cloud call")
                            else:
                                _save_license_cache(license_data)
                                app.logger.info("Server license validated successfully on startup")
                        elif license_data:
                            app.logger.info("Server license validation skipped/backoff on startup - using cached payload")
                        else:
                            app.logger.warning(f"Server license validation failed on startup: {error_msg}")
                            app.logger.warning("Will use cached license data with grace period")
                    except Exception as validation_error:
                        app.logger.warning(f"Server license validation error on startup: {validation_error}")
                else:
                    app.logger.info("No server license found - devices will need individual activation or can use trial")
            except Exception as e:
                app.logger.error(f"Error checking server license on startup: {e}")

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

    # Pre-calculate hardware ID at startup to prevent blocking on first request
    app.logger.info("Initializing hardware fingerprint (one-time calculation)...")
    try:
        hw_id = get_enhanced_hardware_id()
        if hw_id and hw_id != "hardware_id_generation_failed":
            app.logger.info(f"Hardware ID cached successfully: {hw_id[:16]}...")
        else:
            app.logger.warning("Hardware ID generation failed - will retry on demand")
    except Exception as e:
        app.logger.warning(f"Hardware ID initialization failed: {e} - will calculate on demand")

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
    
    # Start Waitress server with proper instance management
    try:
        from waitress.server import create_server

        waitress_threads = max(int(config.get('waitress_threads', 12)), 4)
        app.logger.info(f"Starting Waitress server with graceful shutdown support (threads={waitress_threads})...")
        _server_instance = create_server(
            app,
            host='0.0.0.0',
            port=config.get('port', 5000),
            threads=waitress_threads
        )
        app.logger.info(f"Server created on port {config.get('port', 5000)} (threads={waitress_threads})")
        _server_instance.run()  # This blocks until shutdown
    except KeyboardInterrupt:
        app.logger.info("KeyboardInterrupt received, shutting down gracefully...")
        shutdown_server()
    except Exception as e:
        app.logger.error(f"Server error: {e}")
        shutdown_server()
# Track recent cloud validation failures to avoid repeated blocking calls when offline
_last_cloud_failure = {"timestamp": None, "error": None}


def _record_cloud_failure(error_message: str | None = None) -> None:
    """Remember the most recent cloud validation failure."""
    _last_cloud_failure["timestamp"] = datetime.now()
    _last_cloud_failure["error"] = error_message or "Cloud validation failed"


def _clear_cloud_failure() -> None:
    """Clear the cached cloud failure state after a successful validation."""
    _last_cloud_failure["timestamp"] = None
    _last_cloud_failure["error"] = None


def _should_skip_cloud_validation() -> bool:
    """Return True when recent cloud validation failed and we should back off temporarily."""
    last_failure = _last_cloud_failure.get("timestamp")
    if not last_failure:
        return False

    elapsed = (datetime.now() - last_failure).total_seconds()
    return elapsed < CLOUD_FAILURE_BACKOFF_SECONDS
