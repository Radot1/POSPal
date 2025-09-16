"""
Unified Storage Manager
Centralizes all license data storage operations with proper error handling
"""

import os
import json
import threading
import hashlib
import time
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import base64

from .license_state import LicenseState, ValidationSource, LicenseStatus


class UnifiedStorageManager:
    """
    Unified storage manager for all license data operations
    Handles legacy files, encrypted cache, and secure persistence
    """
    
    def __init__(self, app_logger, data_dir: str, program_data_dir: str, 
                 exe_dir: str, app_secret_key: str):
        self.logger = app_logger
        self.data_dir = data_dir
        self.program_data_dir = program_data_dir
        self.exe_dir = exe_dir
        self.app_secret_key = app_secret_key
        
        # File paths
        self.legacy_license_file = os.path.join(exe_dir, 'license.key')
        self.encrypted_cache_file = os.path.join(data_dir, 'license_cache.enc')
        self.encrypted_cache_backup = os.path.join(program_data_dir, 'license_cache.enc')
        
        # Cache management
        self._license_data_cache = None
        self._license_cache_time = 0
        self._cache_ttl = 30  # 30 seconds cache TTL
        self._storage_lock = threading.Lock()
        
        # Constants
        self.GRACE_PERIOD_DAYS = 10
        
    def get_hardware_id(self) -> str:
        """Get enhanced hardware fingerprint - EXACT match to license generator"""
        try:
            import platform
            import subprocess
            
            # Get MAC address (primary identifier)
            import uuid
            mac = ':'.join(['{:02x}'.format((uuid.getnode() >> i) & 0xff) for i in range(0, 8*6, 8)][::-1])
            
            # Get CPU info (EXACT match to license generator)
            try:
                cpu_info = platform.processor()
                if not cpu_info:
                    result = subprocess.run(['wmic', 'cpu', 'get', 'name'], 
                                          capture_output=True, text=True, timeout=5)
                    cpu_info = result.stdout.split('\n')[1].strip() if result.stdout else 'Unknown'
            except:
                cpu_info = 'Unknown'
            
            # Get disk serial (EXACT match to license generator)  
            disk_serial = 'Unknown'
            try:
                result = subprocess.run(['wmic', 'diskdrive', 'get', 'serialnumber'], 
                                      capture_output=True, text=True, timeout=5)
                if result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line and line != 'SerialNumber':
                            disk_serial = line
                            break
            except:
                pass
                
            # Get Windows ID (EXACT match to license generator)
            windows_id = 'Unknown'
            try:
                result = subprocess.run(['wmic', 'csproduct', 'get', 'uuid'], 
                                      capture_output=True, text=True, timeout=5)
                if result.stdout:
                    lines = result.stdout.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line and line != 'UUID':
                            windows_id = line
                            break
            except:
                pass
            
            # Combine all identifiers and hash (EXACT same as license generator)
            combined = f"{mac}|{cpu_info}|{disk_serial}|{windows_id}"
            hardware_id = hashlib.sha256(combined.encode()).hexdigest()
            
            return hardware_id
            
        except Exception as e:
            self.logger.error(f"Error generating hardware ID: {e}")
            return "hardware_id_generation_failed"
    
    def _get_encryption_key(self) -> Optional[Fernet]:
        """Generate encryption key for license cache"""
        try:
            # Use hardware ID and app secret for key derivation
            password = f"{self.get_hardware_id()}{self.app_secret_key}".encode()
            
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=b'pospal_license_salt_v1',  # Fixed salt for consistency
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(password))
            return Fernet(key)
            
        except Exception as e:
            self.logger.error(f"Failed to generate encryption key: {e}")
            return None
    
    def _encrypt_data(self, data: Dict[str, Any]) -> Optional[bytes]:
        """Encrypt data for secure storage"""
        try:
            fernet = self._get_encryption_key()
            if not fernet:
                return None
                
            json_data = json.dumps(data).encode()
            return fernet.encrypt(json_data)
            
        except Exception as e:
            self.logger.error(f"Failed to encrypt data: {e}")
            return None
    
    def _decrypt_data(self, encrypted_data: bytes) -> Optional[Dict[str, Any]]:
        """Decrypt data from secure storage"""
        try:
            fernet = self._get_encryption_key()
            if not fernet:
                return None
                
            decrypted_data = fernet.decrypt(encrypted_data)
            return json.loads(decrypted_data.decode())
            
        except Exception as e:
            self.logger.error(f"Failed to decrypt data: {e}")
            return None
    
    def load_legacy_license(self) -> Optional[LicenseState]:
        """Load and validate legacy license.key file"""
        try:
            if not os.path.exists(self.legacy_license_file):
                return None
                
            self.logger.info("Found legacy license.key file - checking validity")
            
            with open(self.legacy_license_file, 'r', encoding='utf-8') as f:
                content = f.read().strip()
                
            if not content:
                return None
                
            # Try JSON format first
            try:
                license_data = json.loads(content)
            except:
                # Fall back to key-value format
                license_data = {}
                for line in content.split('\n'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        license_data[key.strip()] = value.strip()
            
            if not license_data:
                return None
            
            # Validate signature
            hardware_id = license_data.get('hardware_id', '')
            signature = license_data.get('signature', '')
            
            data = f"{hardware_id}{self.app_secret_key}".encode()
            expected_signature = hashlib.sha256(data).hexdigest()
            
            if expected_signature != signature:
                self.logger.warning("Legacy license signature validation failed")
                return None
            
            # Validate hardware ID
            current_hw_id = self.get_hardware_id()
            mac_hex = current_hw_id.replace(':', '')
            
            hardware_match = (
                current_hw_id == hardware_id or 
                mac_hex == hardware_id or 
                current_hw_id.replace(':', '') == hardware_id
            )
            
            if not hardware_match:
                self.logger.warning("Legacy license hardware validation failed")
                return None
            
            # Create license state
            state = LicenseState()
            state.licensed = True
            state.active = True
            state.source = ValidationSource.LEGACY_LICENSE_KEY
            state.customer = license_data.get('customer', 'Unknown')
            state.hardware_id = hardware_id
            
            # Check if subscription license
            valid_until = license_data.get('valid_until')
            if valid_until:
                try:
                    expiry_date = datetime.fromisoformat(valid_until.replace('Z', '+00:00'))
                    if expiry_date < datetime.now():
                        state.licensed = False
                        state.active = False
                        state.status = LicenseStatus.EXPIRED
                        return state
                    
                    state.subscription = True
                    state.valid_until = valid_until
                    state.subscription_id = license_data.get('subscription_id')
                    state.status = LicenseStatus.ACTIVE
                    
                except Exception as e:
                    self.logger.error(f"Error parsing legacy license date: {e}")
                    return None
            else:
                # Permanent license
                state.subscription = False
                state.status = LicenseStatus.ACTIVE
            
            self.logger.info(f"Legacy license validated for customer: {state.customer}")
            return state
            
        except Exception as e:
            self.logger.error(f"Error loading legacy license: {e}")
            return None
    
    def load_encrypted_cache(self) -> Optional[Dict[str, Any]]:
        """Load encrypted license cache"""
        try:
            cache_file = None
            
            # Try primary cache first, then backup
            for path in [self.encrypted_cache_file, self.encrypted_cache_backup]:
                if os.path.exists(path):
                    cache_file = path
                    break
            
            if not cache_file:
                return None
            
            with open(cache_file, 'rb') as f:
                encrypted_data = f.read()
            
            cache_data = self._decrypt_data(encrypted_data)
            if not cache_data:
                return None
            
            # Validate required fields
            required_fields = ['license_data', 'last_validation', 'hardware_id']
            if not all(field in cache_data for field in required_fields):
                self.logger.warning("Invalid cache data structure")
                return None
            
            # Validate hardware ID
            if cache_data['hardware_id'] != self.get_hardware_id():
                self.logger.warning("Cache hardware ID mismatch")
                return None
            
            return cache_data
            
        except Exception as e:
            self.logger.error(f"Error loading encrypted cache: {e}")
            return None
    
    def save_encrypted_cache(self, license_data: Dict[str, Any], 
                           last_validation_timestamp: Optional[str] = None) -> bool:
        """Save license data to encrypted cache"""
        try:
            if last_validation_timestamp is None:
                last_validation_timestamp = datetime.now().isoformat()
            
            cache_data = {
                'license_data': license_data,
                'last_validation': last_validation_timestamp,
                'hardware_id': self.get_hardware_id(),
                'cache_version': '1.0'
            }
            
            encrypted_data = self._encrypt_data(cache_data)
            if not encrypted_data:
                return False
            
            # Ensure directories exist
            os.makedirs(os.path.dirname(self.encrypted_cache_file), exist_ok=True)
            os.makedirs(os.path.dirname(self.encrypted_cache_backup), exist_ok=True)
            
            # Write to both primary and backup locations
            for path in [self.encrypted_cache_file, self.encrypted_cache_backup]:
                try:
                    with open(path, 'wb') as f:
                        f.write(encrypted_data)
                except Exception as e:
                    self.logger.warning(f"Failed to write cache to {path}: {e}")
            
            self.logger.info("License cache saved successfully")
            return True
            
        except Exception as e:
            self.logger.error(f"Failed to save encrypted cache: {e}")
            return False
    
    def clear_encrypted_cache(self) -> bool:
        """Clear encrypted license cache"""
        try:
            cleared = False
            for path in [self.encrypted_cache_file, self.encrypted_cache_backup]:
                try:
                    if os.path.exists(path):
                        os.remove(path)
                        cleared = True
                except Exception as e:
                    self.logger.warning(f"Failed to clear cache at {path}: {e}")
            
            if cleared:
                self.logger.info("License cache cleared")
            
            return cleared
            
        except Exception as e:
            self.logger.error(f"Failed to clear cache: {e}")
            return False
    
    def calculate_grace_period_status(self, last_validation_timestamp: str) -> Tuple[int, bool, int]:
        """
        Calculate grace period status
        Returns: (days_offline, is_expired, warning_level)
        """
        try:
            last_validation = datetime.fromisoformat(last_validation_timestamp)
            current_time = datetime.now()
            days_offline = (current_time - last_validation).days
            
            is_expired = days_offline > self.GRACE_PERIOD_DAYS
            
            # Warning levels: 0=good, 1=caution, 2=warning, 3=urgent
            if days_offline <= 5:
                warning_level = 0
            elif days_offline <= 7:
                warning_level = 1
            elif days_offline <= 9:
                warning_level = 2
            else:
                warning_level = 3
            
            return days_offline, is_expired, warning_level
            
        except Exception as e:
            self.logger.error(f"Error calculating grace period: {e}")
            return 999, True, 3
    
    def get_legacy_license_data(self, force_reload: bool = False) -> Optional[Dict[str, Any]]:
        """Get cached legacy license data (for backward compatibility)"""
        with self._storage_lock:
            if (self._license_data_cache is not None and 
                time.time() - self._license_cache_time < self._cache_ttl and 
                not force_reload):
                return self._license_data_cache
            
            try:
                if not os.path.exists(self.legacy_license_file):
                    return None
                
                with open(self.legacy_license_file, 'r', encoding='utf-8') as f:
                    content = f.read().strip()
                
                if not content:
                    return None
                
                # Try JSON format first
                try:
                    license_data = json.loads(content)
                except:
                    # Fall back to key-value format
                    license_data = {}
                    for line in content.split('\n'):
                        if '=' in line and len(line) < 500:  # Security limit
                            key, value = line.split('=', 1)
                            key = key.strip()
                            value = value.strip()
                            
                            if len(key) < 100 and len(value) < 500:  # Security limits
                                license_data[key] = value
                
                # Cache the result
                self._license_data_cache = license_data
                self._license_cache_time = time.time()
                
                return license_data
                
            except Exception as e:
                self.logger.error(f"Error loading legacy license data: {e}")
                return None