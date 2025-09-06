"""
POSPal v2.0 - Optimized Authentication System
Replaces the old license file system with efficient API-based authentication

CRITICAL: This reduces API calls from 2000+/day to 288/day maximum
This keeps us well within Cloudflare's free tier limits
"""

import json
import time
import threading
import requests
import os
import logging
from datetime import datetime, timedelta

# Configuration
LICENSE_SERVER = "https://pospal-licensing-v2.YOURUSERNAME.workers.dev"  # Update after deployment
AUTH_CACHE_DURATION = 300  # 5 minutes cache
OFFLINE_GRACE_HOURS = 24 * 7  # 7 days offline operation for paying customers
TRIAL_OFFLINE_GRACE_HOURS = 24  # 1 day for trial users

# Global cache
_auth_cache = None
_last_auth_check = 0
_jwt_token = None
_auth_lock = threading.Lock()
_background_refresh_started = False

# File paths
def get_auth_cache_file():
    """Get path to auth cache file"""
    data_dir = os.path.join(os.path.dirname(__file__), 'data')
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, 'auth_cache.json')

def get_jwt_token_file():
    """Get path to JWT token file"""
    data_dir = os.path.join(os.path.dirname(__file__), 'data')
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, 'jwt_token.txt')

def load_jwt_token():
    """Load stored JWT token"""
    global _jwt_token
    try:
        token_file = get_jwt_token_file()
        if os.path.exists(token_file):
            with open(token_file, 'r') as f:
                _jwt_token = f.read().strip()
                return _jwt_token
    except Exception as e:
        logging.error(f"Failed to load JWT token: {e}")
    return None

def save_jwt_token(token):
    """Save JWT token to file"""
    global _jwt_token
    try:
        _jwt_token = token
        token_file = get_jwt_token_file()
        with open(token_file, 'w') as f:
            f.write(token)
        logging.info("JWT token saved successfully")
    except Exception as e:
        logging.error(f"Failed to save JWT token: {e}")

def load_auth_cache():
    """Load cached authentication data"""
    try:
        cache_file = get_auth_cache_file()
        if os.path.exists(cache_file):
            with open(cache_file, 'r') as f:
                return json.load(f)
    except Exception as e:
        logging.error(f"Failed to load auth cache: {e}")
    return None

def save_auth_cache(auth_data):
    """Save authentication data to cache"""
    try:
        auth_data['cached_at'] = time.time()
        cache_file = get_auth_cache_file()
        with open(cache_file, 'w') as f:
            json.dump(auth_data, f, indent=2)
        logging.debug("Auth cache saved successfully")
    except Exception as e:
        logging.error(f"Failed to save auth cache: {e}")

def is_auth_cache_valid():
    """Check if cached auth data is still valid"""
    global _auth_cache, _last_auth_check
    
    if not _auth_cache:
        # Try loading from file
        _auth_cache = load_auth_cache()
        if _auth_cache:
            _last_auth_check = _auth_cache.get('cached_at', 0)
    
    if not _auth_cache or not _last_auth_check:
        return False
    
    # Check if cache is expired
    cache_age = time.time() - _last_auth_check
    return cache_age < AUTH_CACHE_DURATION

def authenticate_with_server():
    """Authenticate with the licensing server"""
    global _jwt_token
    
    if not _jwt_token:
        _jwt_token = load_jwt_token()
    
    if not _jwt_token:
        logging.error("No JWT token found - user needs to login")
        return {
            'active': False,
            'licensed': False,
            'error': 'not_logged_in',
            'message': 'Please login to your POSPal account'
        }
    
    try:
        # Send heartbeat to server
        response = requests.post(
            f"{LICENSE_SERVER}/session/heartbeat",
            headers={
                'Authorization': f'Bearer {_jwt_token}',
                'Content-Type': 'application/json'
            },
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                auth_result = {
                    'active': True,
                    'licensed': True,
                    'subscription': data.get('subscription', {}),
                    'last_server_check': time.time(),
                    'server_response': data
                }
                save_auth_cache(auth_result)
                return auth_result
            else:
                return handle_server_rejection(data)
        
        elif response.status_code == 401:
            # Token expired or invalid
            return {
                'active': False,
                'licensed': False,
                'error': 'token_expired',
                'message': 'Please login again'
            }
        
        else:
            # Server error - fall back to grace period
            return handle_server_error(f"Server returned {response.status_code}")
    
    except requests.exceptions.RequestException as e:
        # Network error - fall back to grace period
        logging.warning(f"Network error during auth check: {e}")
        return handle_network_failure()

def handle_server_rejection(data):
    """Handle when server actively rejects authentication"""
    subscription = data.get('subscription', {})
    
    if subscription.get('type') == 'grace_period':
        # Still in grace period
        grace_result = {
            'active': True,
            'licensed': True,
            'grace_period': True,
            'expires_at': subscription.get('expiresAt'),
            'warning': subscription.get('warning'),
            'last_server_check': time.time()
        }
        save_auth_cache(grace_result)
        return grace_result
    
    else:
        # Subscription actually expired
        return {
            'active': False,
            'licensed': False,
            'expired': True,
            'subscription_status': subscription,
            'message': 'Your subscription has expired. Please renew to continue using POSPal.'
        }

def handle_network_failure():
    """Handle network failure - use offline grace period"""
    cached_auth = load_auth_cache()
    
    if cached_auth and cached_auth.get('licensed'):
        # Check offline grace period
        last_server_check = cached_auth.get('last_server_check', 0)
        offline_duration_hours = (time.time() - last_server_check) / 3600
        
        # Different grace periods for different user types
        is_trial = cached_auth.get('subscription', {}).get('type') == 'trial'
        max_offline_hours = TRIAL_OFFLINE_GRACE_HOURS if is_trial else OFFLINE_GRACE_HOURS
        
        if offline_duration_hours < max_offline_hours:
            # Still within offline grace period
            remaining_hours = max_offline_hours - offline_duration_hours
            return {
                'active': True,
                'licensed': True,
                'offline_mode': True,
                'offline_duration_hours': offline_duration_hours,
                'offline_grace_remaining_hours': remaining_hours,
                'warning': f'Working offline. Network connection recommended within {remaining_hours:.1f} hours.'
            }
    
    # No valid cache or grace period expired
    return {
        'active': False,
        'licensed': False,
        'offline_expired': True,
        'message': 'Network connection required to verify subscription.'
    }

def handle_server_error(error_msg):
    """Handle server errors - similar to network failure"""
    logging.error(f"Server error: {error_msg}")
    return handle_network_failure()

def get_auth_status():
    """Main function to get authentication status (replaces check_trial_status)"""
    global _auth_cache, _last_auth_check
    
    with _auth_lock:
        # Use cache if valid
        if is_auth_cache_valid():
            logging.debug("Using cached auth status")
            return _auth_cache
        
        # Refresh from server
        logging.debug("Refreshing auth status from server")
        _auth_cache = authenticate_with_server()
        _last_auth_check = time.time()
        
        # Start background refresh if not already started
        start_background_refresh()
        
        return _auth_cache

def start_background_refresh():
    """Start background thread for auth refresh"""
    global _background_refresh_started
    
    if _background_refresh_started:
        return
    
    def background_refresh_worker():
        """Background thread that refreshes auth every 5 minutes"""
        while True:
            try:
                time.sleep(AUTH_CACHE_DURATION)  # Wait 5 minutes
                
                # Only refresh if we have a token
                if _jwt_token:
                    with _auth_lock:
                        logging.debug("Background auth refresh")
                        _auth_cache = authenticate_with_server()
                        _last_auth_check = time.time()
                        
            except Exception as e:
                logging.error(f"Background auth refresh error: {e}")
                # Continue running even if refresh fails
    
    # Start background thread
    thread = threading.Thread(target=background_refresh_worker, daemon=True)
    thread.start()
    _background_refresh_started = True
    logging.info("Background auth refresh started")

def login_user(email, password):
    """Login user and store JWT token"""
    try:
        response = requests.post(
            f"{LICENSE_SERVER}/auth/login",
            json={
                'email': email,
                'password': password,
                'deviceInfo': {
                    'os': 'Windows',
                    'appVersion': '2.0.0',
                    'deviceType': 'desktop'
                }
            },
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                # Save JWT token
                save_jwt_token(data['accessToken'])
                
                # Save initial auth cache
                auth_data = {
                    'active': True,
                    'licensed': True,
                    'customer': data['customer'],
                    'subscription': data['subscription'],
                    'last_server_check': time.time()
                }
                save_auth_cache(auth_data)
                
                # Start background refresh
                start_background_refresh()
                
                return {
                    'success': True,
                    'customer': data['customer'],
                    'subscription': data['subscription']
                }
            else:
                return {'success': False, 'error': data.get('error', 'Login failed')}
        
        elif response.status_code == 409:
            # Another session active - handle takeover
            data = response.json()
            return {
                'success': False, 
                'conflict': True,
                'error': data.get('error'),
                'conflictInfo': data.get('conflictInfo')
            }
        
        else:
            return {'success': False, 'error': f'Login failed: HTTP {response.status_code}'}
            
    except requests.exceptions.RequestException as e:
        return {'success': False, 'error': f'Network error: {str(e)}'}

def takeover_session(email, password):
    """Force takeover of existing session"""
    try:
        response = requests.post(
            f"{LICENSE_SERVER}/session/takeover",
            json={
                'email': email,
                'password': password,
                'deviceInfo': {
                    'os': 'Windows',
                    'appVersion': '2.0.0', 
                    'deviceType': 'desktop'
                }
            },
            timeout=15
        )
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                save_jwt_token(data['accessToken'])
                return {'success': True, 'message': 'Session taken over successfully'}
        
        return {'success': False, 'error': 'Failed to takeover session'}
        
    except requests.exceptions.RequestException as e:
        return {'success': False, 'error': f'Network error: {str(e)}'}

def logout_user():
    """Logout user and clear stored data"""
    global _jwt_token, _auth_cache, _last_auth_check
    
    try:
        # Call server logout if we have a token
        if _jwt_token:
            requests.post(
                f"{LICENSE_SERVER}/auth/logout",
                headers={'Authorization': f'Bearer {_jwt_token}'},
                timeout=5
            )
    except:
        pass  # Don't fail logout due to network issues
    
    # Clear local data
    _jwt_token = None
    _auth_cache = None
    _last_auth_check = 0
    
    # Remove files
    try:
        token_file = get_jwt_token_file()
        if os.path.exists(token_file):
            os.remove(token_file)
            
        cache_file = get_auth_cache_file()
        if os.path.exists(cache_file):
            os.remove(cache_file)
    except Exception as e:
        logging.error(f"Failed to clear auth files: {e}")

# Initialize on import
load_jwt_token()

# Backward compatibility function for existing POSPal code
def check_trial_status():
    """
    Backward compatibility function - replaces the old check_trial_status()
    Returns the same format as the old function but uses optimized authentication
    """
    auth_status = get_auth_status()
    
    # Convert new format to old format for compatibility
    return {
        'active': auth_status.get('active', False),
        'licensed': auth_status.get('licensed', False),
        'subscription': auth_status.get('subscription', {}),
        'offline_mode': auth_status.get('offline_mode', False),
        'grace_period': auth_status.get('grace_period', False),
        'warning': auth_status.get('warning'),
        'message': auth_status.get('message')
    }