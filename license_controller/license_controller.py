"""
Master License Controller
Single source of truth for all license validation operations
"""

import os
import threading
import time
from datetime import datetime
from typing import Optional, Dict, Any, Callable

from .license_state import LicenseState, ValidationSource, LicenseStatus
from .storage_manager import UnifiedStorageManager
from .validation_flow import ValidationFlow


class LicenseController:
    """
    Master License Controller - Single source of truth for license validation
    
    Eliminates license validation chaos by providing:
    - Unified validation logic
    - Consistent state management
    - Thread-safe operations
    - Centralized error handling
    - Migration support
    """
    
    def __init__(self, app_logger, data_dir: str, program_data_dir: str, 
                 exe_dir: str, app_secret_key: str, cloudflare_api_caller: Callable):
        self.logger = app_logger
        self._controller_lock = threading.Lock()
        
        # Initialize core components
        self.storage = UnifiedStorageManager(
            app_logger, data_dir, program_data_dir, exe_dir, app_secret_key
        )
        
        self.validation_flow = ValidationFlow(
            self.storage, cloudflare_api_caller, app_logger
        )
        
        # State management
        self._current_state: Optional[LicenseState] = None
        self._last_validation_time = 0
        self._validation_cache_ttl = 30  # 30 seconds
        
        # Migration tracking
        self._migration_completed = False
        self._legacy_mode = False
        
        self.logger.info("License Controller initialized")
    
    def get_license_status(self, force_refresh: bool = False) -> LicenseState:
        """
        Get current license status
        
        Args:
            force_refresh: Force new validation instead of using cache
            
        Returns:
            LicenseState: Current license state
        """
        with self._controller_lock:
            current_time = time.time()
            
            # Return cached state if valid and not forcing refresh
            if (not force_refresh and 
                self._current_state is not None and 
                current_time - self._last_validation_time < self._validation_cache_ttl):
                return self._current_state
            
            try:
                # Execute validation flow
                self.logger.info("Executing license validation flow")
                state = self.validation_flow.validate_license()
                
                # Update cached state
                self._current_state = state
                self._last_validation_time = current_time
                
                # Log result
                self.logger.info(f"License validation completed: {state.status.value} ({state.source.value})")
                
                return state
                
            except Exception as e:
                self.logger.error(f"License validation error: {e}")
                
                # Return safe fallback state
                fallback_state = LicenseState()
                fallback_state.licensed = False
                fallback_state.active = False
                fallback_state.status = LicenseStatus.INVALID
                fallback_state.source = ValidationSource.TRIAL_SYSTEM
                fallback_state.error_message = f"Validation system error: {str(e)}"
                
                return fallback_state
    
    def validate_license_with_cloud(self, customer_email: str, unlock_token: str,
                                   hardware_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Validate license with unified cloud service (for API endpoints)
        
        Args:
            customer_email: Customer email
            unlock_token: Unlock token
            hardware_id: Hardware ID (auto-detected if None)
            
        Returns:
            Dict containing validation result
        """
        try:
            if hardware_id is None:
                hardware_id = self.storage.get_hardware_id()
            
            # Attempt unified cloud validation
            success, license_data, error_msg = self.validation_flow._validate_with_cloud(
                customer_email, unlock_token, hardware_id
            )
            
            if success and license_data:
                # Save successful validation to cache
                self.storage.save_encrypted_cache(license_data)
                
                # Update current state cache
                with self._controller_lock:
                    self._current_state = None  # Force refresh on next call
                
                # Return enhanced success response with unified data
                result = {
                    "licensed": True,
                    "active": True,
                    "subscription": bool(license_data.get('valid_until')),
                    "customer": license_data.get('customer'),
                    "cloud_validation": True,
                    "validation_method": "unified_cloud",
                    "message": "Unified license validation successful"
                }
                
                # Add subscription details if present
                if license_data.get('valid_until'):
                    result.update({
                        "valid_until": license_data.get('valid_until'),
                        "subscription_id": license_data.get('subscription_id'),
                        "subscription_status": license_data.get('subscription_status')
                    })
                
                # Add performance and caching info from unified response
                result.update({
                    "response_time": license_data.get('response_time', 0),
                    "cache_strategy": license_data.get('cache_strategy', 'none'),
                    "cache_valid_until": license_data.get('cache_valid_until'),
                    "validation_type": license_data.get('validation_type', 'standard'),
                    "unified_endpoint": True
                })
                
                return result
                
            else:
                # Unified cloud validation failed - try fallback
                fallback_state = self._try_fallback_validation()
                
                result = fallback_state.to_dict()
                result.update({
                    "cloud_validation": True,
                    "validation_method": "unified_cloud_failed_fallback",
                    "message": error_msg or "Unified cloud validation failed",
                    "unified_endpoint": True
                })
                
                return result
                
        except Exception as e:
            self.logger.error(f"Unified cloud validation error: {e}")
            
            # Emergency fallback
            fallback_state = self._try_fallback_validation()
            
            result = fallback_state.to_dict()
            result.update({
                "cloud_validation": False,
                "validation_method": "error_fallback",
                "message": f"Unified validation system error: {str(e)}",
                "unified_endpoint": True
            })
            
            return result
    
    def _try_fallback_validation(self) -> LicenseState:
        """Try fallback validation methods"""
        try:
            # Try current cached state first
            if self._current_state and self._current_state.is_valid():
                return self._current_state
            
            # Force new validation
            return self.get_license_status(force_refresh=True)
            
        except Exception as e:
            self.logger.error(f"Fallback validation error: {e}")
            
            # Return safe state
            state = LicenseState()
            state.licensed = False
            state.active = False
            state.status = LicenseStatus.INVALID
            state.source = ValidationSource.TRIAL_SYSTEM
            state.error_message = f"All validation methods failed: {str(e)}"
            
            return state
    
    def get_system_info(self) -> Dict[str, Any]:
        """Get system information for debugging"""
        try:
            state = self.get_license_status()
            
            return {
                "license": state.to_dict(),
                "system_info": {
                    "hardware_id": self.storage.get_hardware_id(),
                    "license_file_exists": os.path.exists(self.storage.legacy_license_file),
                    "license_file_path": self.storage.legacy_license_file,
                    "cache_file_exists": os.path.exists(self.storage.encrypted_cache_file),
                    "cache_backup_exists": os.path.exists(self.storage.encrypted_cache_backup),
                    "migration_completed": self._migration_completed,
                    "legacy_mode": self._legacy_mode
                }
            }
            
        except Exception as e:
            self.logger.error(f"Error getting system info: {e}")
            return {
                "error": f"System info error: {str(e)}",
                "system_info": {
                    "hardware_id": self.storage.get_hardware_id(),
                    "error": str(e)
                }
            }
    
    def clear_license_cache(self) -> bool:
        """Clear license cache and force re-validation"""
        try:
            with self._controller_lock:
                # Clear encrypted cache
                cache_cleared = self.storage.clear_encrypted_cache()
                
                # Clear in-memory cache
                self._current_state = None
                self._last_validation_time = 0
                
                self.logger.info("License cache cleared")
                return cache_cleared
                
        except Exception as e:
            self.logger.error(f"Error clearing license cache: {e}")
            return False
    
    def diagnose_license_issues(self) -> Dict[str, Any]:
        """Comprehensive license diagnosis for troubleshooting"""
        try:
            diagnosis = {
                "timestamp": datetime.now().isoformat(),
                "hardware_id": self.storage.get_hardware_id(),
                "files": {},
                "cache": {},
                "validation": {},
                "recommendations": []
            }
            
            # Check file existence
            diagnosis["files"] = {
                "legacy_license_exists": os.path.exists(self.storage.legacy_license_file),
                "legacy_license_path": self.storage.legacy_license_file,
                "cache_exists": os.path.exists(self.storage.encrypted_cache_file),
                "cache_backup_exists": os.path.exists(self.storage.encrypted_cache_backup)
            }
            
            # Test legacy license
            if diagnosis["files"]["legacy_license_exists"]:
                try:
                    legacy_state = self.storage.load_legacy_license()
                    diagnosis["validation"]["legacy_license"] = {
                        "valid": legacy_state is not None and legacy_state.is_valid(),
                        "details": legacy_state.to_dict() if legacy_state else None
                    }
                except Exception as e:
                    diagnosis["validation"]["legacy_license"] = {
                        "valid": False,
                        "error": str(e)
                    }
            
            # Test encrypted cache
            try:
                cache_data = self.storage.load_encrypted_cache()
                diagnosis["cache"]["loaded"] = cache_data is not None
                if cache_data:
                    diagnosis["cache"]["last_validation"] = cache_data.get('last_validation')
                    diagnosis["cache"]["has_license_data"] = bool(cache_data.get('license_data'))
            except Exception as e:
                diagnosis["cache"]["error"] = str(e)
            
            # Current validation state
            try:
                current_state = self.get_license_status(force_refresh=True)
                diagnosis["validation"]["current"] = current_state.to_dict()
            except Exception as e:
                diagnosis["validation"]["current_error"] = str(e)
            
            # Generate recommendations
            if not diagnosis["files"]["legacy_license_exists"] and not diagnosis["cache"]["loaded"]:
                diagnosis["recommendations"].append("No valid license found - consider purchasing a license")
            
            if diagnosis["validation"].get("current", {}).get("status") == "grace_period":
                diagnosis["recommendations"].append("Connect to internet to refresh license validation")
            
            return diagnosis
            
        except Exception as e:
            self.logger.error(f"License diagnosis error: {e}")
            return {
                "error": f"Diagnosis failed: {str(e)}",
                "timestamp": datetime.now().isoformat()
            }
    
    def enable_legacy_mode(self) -> None:
        """Enable legacy mode for backward compatibility during migration"""
        self._legacy_mode = True
        self.logger.info("Legacy mode enabled")
    
    def disable_legacy_mode(self) -> None:
        """Disable legacy mode after successful migration"""
        self._legacy_mode = False
        self.logger.info("Legacy mode disabled")
    
    def mark_migration_completed(self) -> None:
        """Mark migration as completed"""
        self._migration_completed = True
        self.logger.info("License migration marked as completed")
    
    def get_legacy_license_data(self, force_reload: bool = False) -> Optional[Dict[str, Any]]:
        """Get legacy license data (for backward compatibility)"""
        return self.storage.get_legacy_license_data(force_reload)
    
    def is_legacy_mode(self) -> bool:
        """Check if running in legacy mode"""
        return self._legacy_mode
    
    def is_migration_completed(self) -> bool:
        """Check if migration is completed"""
        return self._migration_completed