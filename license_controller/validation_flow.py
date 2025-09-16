"""
Validation Flow Manager
Implements the clear priority chain for license validation
"""

import os
import time
from datetime import datetime
from typing import Optional, Dict, Any, Tuple
from .license_state import LicenseState, ValidationSource, LicenseStatus
from .storage_manager import UnifiedStorageManager


class ValidationFlow:
    """
    Manages the license validation flow with clear priority chain:
    1. Cloud validation (when online)
    2. Local cache validation (during grace period) 
    3. Legacy license.key support (backward compatibility)
    4. Trial system (fallback)
    """
    
    def __init__(self, storage_manager: UnifiedStorageManager, 
                 cloudflare_api_caller, app_logger):
        self.storage = storage_manager
        self.call_cloudflare_api = cloudflare_api_caller
        self.logger = app_logger
        
        # Validation constants
        self.CLOUD_VALIDATION_TIMEOUT = 3
        self.MAX_RETRIES = 1
    
    def validate_license(self) -> LicenseState:
        """
        Execute the complete validation flow
        Returns unified LicenseState object
        """
        self.logger.info("Starting unified license validation flow")
        
        # Step 1: Check for legacy license.key file (backward compatibility)
        legacy_state = self._validate_legacy_license()
        if legacy_state and legacy_state.is_valid():
            self.logger.info("Legacy license validation successful")
            return legacy_state
        
        # Step 2: Try to load encrypted license cache  
        cache_data = self.storage.load_encrypted_cache()
        cloud_validation_attempted = False
        
        # Step 3: If we have cache data, attempt cloud validation first (cloud-first approach)
        if cache_data:
            cloud_state = self._attempt_cloud_validation(cache_data)
            cloud_validation_attempted = True
            
            if cloud_state and cloud_state.is_valid():
                self.logger.info("Cloud validation successful")
                # Update cache with fresh validation
                self._update_cache_from_state(cloud_state)
                return cloud_state
        
        # Step 4: Cloud validation failed or not attempted - check cached data with grace period
        if cache_data:
            cache_state = self._validate_cached_data(cache_data, cloud_validation_attempted)
            if cache_state:
                self.logger.info(f"Cache validation result: {cache_state.status}")
                return cache_state
        
        # Step 5: No valid cache or license - fall back to trial system
        trial_state = self._validate_trial_system()
        self.logger.info(f"Trial system result: {trial_state.status}")
        return trial_state
    
    def _validate_legacy_license(self) -> Optional[LicenseState]:
        """Validate legacy license.key file"""
        try:
            return self.storage.load_legacy_license()
        except Exception as e:
            self.logger.error(f"Legacy license validation error: {e}")
            return None
    
    def _attempt_cloud_validation(self, cache_data: Dict[str, Any]) -> Optional[LicenseState]:
        """Attempt cloud validation using cached credentials"""
        try:
            license_data = cache_data.get('license_data', {})
            customer_email = license_data.get('customer_email')
            unlock_token = license_data.get('unlock_token')
            hardware_id = license_data.get('hardware_id')
            
            if not all([customer_email, unlock_token, hardware_id]):
                self.logger.info("Missing cloud validation credentials in cache")
                return None
            
            self.logger.info("Found cached credentials - attempting cloud validation")
            
            # Call cloud validation with timeout
            success, cloud_license_data, error_msg = self._validate_with_cloud(
                customer_email, unlock_token, hardware_id
            )
            
            if success and cloud_license_data:
                # Create state from cloud response
                state = LicenseState()
                state.licensed = True
                state.active = True
                state.source = ValidationSource.CLOUD_VALIDATION
                state.cloud_validation_attempted = True
                state.cloud_validation_successful = True
                state.last_validation = datetime.now()
                
                # Populate from cloud data
                state.customer = cloud_license_data.get('customer')
                state.customer_email = cloud_license_data.get('customer_email')
                state.unlock_token = cloud_license_data.get('unlock_token')
                state.hardware_id = cloud_license_data.get('hardware_id')
                
                # Check subscription details
                valid_until = cloud_license_data.get('valid_until')
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
                        state.subscription_id = cloud_license_data.get('subscription_id')
                        state.subscription_status = cloud_license_data.get('subscription_status')
                        state.status = LicenseStatus.ACTIVE
                        
                    except Exception as e:
                        self.logger.error(f"Error parsing cloud validation date: {e}")
                        return None
                else:
                    # Permanent license
                    state.subscription = False
                    state.status = LicenseStatus.ACTIVE
                
                return state
            else:
                self.logger.warning(f"Cloud validation failed: {error_msg}")
                return None
                
        except Exception as e:
            self.logger.error(f"Cloud validation error: {e}")
            return None
    
    def _validate_with_cloud(self, customer_email: str, unlock_token: str, 
                           hardware_id: str) -> Tuple[bool, Optional[Dict], Optional[str]]:
        """
        Validate license with Cloudflare Worker using unified endpoint
        Returns: (success, license_data, error_message)
        """
        try:
            self.logger.info(f"Attempting unified cloud validation for {customer_email[:5]}*** with {self.CLOUD_VALIDATION_TIMEOUT}s timeout")
            
            # Prepare unified validation request
            validation_data = {
                'operation': 'validate',
                'credentials': {
                    'email': customer_email,
                    'token': unlock_token
                },
                'device': {
                    'machineFingerprint': hardware_id,
                    'deviceInfo': {
                        'hostname': 'POSPal-Desktop',
                        'platform': 'desktop'
                    }
                },
                'options': {
                    'skipMachineUpdate': False,
                    'performanceMode': 'standard'
                }
            }
            
            response = self.call_cloudflare_api(
                '/validate-unified', 
                validation_data, 
                timeout=self.CLOUD_VALIDATION_TIMEOUT, 
                max_retries=self.MAX_RETRIES
            )
            
            if not response:
                return False, None, "No response from cloud validation service"
            
            if response.get('success'):
                # Extract data from unified response format
                validation_info = response.get('validation', {})
                subscription_info = response.get('subscription', {})
                performance_info = response.get('performance', {})
                caching_info = response.get('caching', {})
                
                license_data = {
                    'customer': validation_info.get('customer', {}).get('name'),
                    'customer_email': customer_email,
                    'unlock_token': unlock_token,
                    'hardware_id': hardware_id,
                }
                
                # Add subscription info from unified response
                if subscription_info:
                    license_data['valid_until'] = subscription_info.get('currentPeriodEnd')
                    license_data['subscription_id'] = subscription_info.get('id')
                    license_data['subscription_status'] = subscription_info.get('status')
                
                # Add performance and caching metadata
                license_data['response_time'] = performance_info.get('responseTime', 0)
                license_data['cache_strategy'] = caching_info.get('strategy', 'none')
                license_data['cache_valid_until'] = caching_info.get('validUntil')
                license_data['validation_type'] = validation_info.get('validationType', 'standard')
                
                self.logger.info(f"Unified cloud validation successful for {customer_email[:5]}*** in {performance_info.get('responseTime', 0)}ms")
                return True, license_data, None
            else:
                error_info = response.get('error', {})
                error_msg = error_info.get('message', 'Unknown cloud validation error')
                error_code = error_info.get('code', 'UNKNOWN_ERROR')
                
                # Enhanced error logging for troubleshooting
                self.logger.warning(f"Unified cloud validation failed for {customer_email[:5]}***: {error_code} - {error_msg}")
                
                # Check if error is retryable
                is_retryable = error_info.get('retryable', False)
                if is_retryable and error_info.get('category') == 'system':
                    error_msg = f"Temporary service issue: {error_msg}"
                
                return False, None, error_msg
                
        except Exception as e:
            error_msg = f"Unified cloud validation exception: {str(e)}"
            self.logger.error(error_msg)
            return False, None, error_msg
    
    def _validate_cached_data(self, cache_data: Dict[str, Any], 
                            cloud_validation_attempted: bool) -> Optional[LicenseState]:
        """Validate cached license data with grace period"""
        try:
            self.logger.info("Using cached license data with grace period validation")
            
            last_validation = cache_data.get('last_validation')
            license_data = cache_data.get('license_data', {})
            
            if not last_validation:
                self.logger.warning("No last validation timestamp in cache")
                return None
            
            # Calculate grace period status
            days_offline, is_expired, warning_level = self.storage.calculate_grace_period_status(last_validation)
            
            # Create base state
            state = LicenseState()
            state.source = ValidationSource.ENCRYPTED_CACHE
            state.cloud_validation_attempted = cloud_validation_attempted
            state.cloud_validation_successful = False
            state.last_validation = datetime.fromisoformat(last_validation)
            state.days_offline = days_offline
            state.grace_period_active = not is_expired
            state.grace_period_expired = is_expired
            state.grace_period_warning_level = warning_level
            
            # Populate license data
            state.customer = license_data.get('customer')
            state.customer_email = license_data.get('customer_email')
            state.unlock_token = license_data.get('unlock_token')
            state.hardware_id = license_data.get('hardware_id')
            
            if is_expired:
                # Grace period expired
                self.storage.clear_encrypted_cache()
                state.licensed = False
                state.active = False
                state.status = LicenseStatus.EXPIRED
                state.error_message = f"License validation expired after {self.storage.GRACE_PERIOD_DAYS} days offline"
                return state
            
            # Check cached license validity
            valid_until = license_data.get('valid_until')
            if valid_until:
                try:
                    expiry_date = datetime.fromisoformat(valid_until.replace('Z', '+00:00'))
                    if expiry_date < datetime.now():
                        self.storage.clear_encrypted_cache()
                        state.licensed = False
                        state.active = False
                        state.status = LicenseStatus.EXPIRED
                        state.error_message = "Subscription expired"
                        return state
                    
                    state.subscription = True
                    state.valid_until = valid_until
                    state.subscription_id = license_data.get('subscription_id')
                    state.subscription_status = license_data.get('subscription_status')
                    
                except Exception as e:
                    self.logger.error(f"Error parsing cached license date: {e}")
                    return None
            else:
                state.subscription = False
            
            # Valid cached license in grace period
            state.licensed = True
            state.active = True
            
            if days_offline > 0:
                state.status = LicenseStatus.GRACE_PERIOD
            else:
                state.status = LicenseStatus.ACTIVE
            
            return state
            
        except Exception as e:
            self.logger.error(f"Cached data validation error: {e}")
            return None
    
    def _validate_trial_system(self) -> LicenseState:
        """Fall back to trial system validation"""
        try:
            import json
            from datetime import datetime, timedelta
            
            trial_file = os.path.join(self.storage.data_dir, 'trial.json')
            
            state = LicenseState()
            state.source = ValidationSource.TRIAL_SYSTEM
            state.licensed = False
            state.active = False
            
            try:
                if os.path.exists(trial_file):
                    with open(trial_file, 'r') as f:
                        trial_info = json.load(f)
                    
                    first_run_date_str = trial_info.get('first_run_date')
                    if first_run_date_str:
                        start_date = datetime.strptime(first_run_date_str, "%Y-%m-%d")
                        current_date = datetime.now()
                        days_elapsed = (current_date - start_date).days
                        days_left = max(0, 30 - days_elapsed)
                        
                        state.trial_days_left = days_left
                        state.trial_expired = days_left <= 0
                        
                        if days_left > 0:
                            state.active = True
                            state.status = LicenseStatus.TRIAL
                            return state
                        else:
                            state.status = LicenseStatus.EXPIRED
                            state.error_message = "Trial period expired"
                            return state
                
                # No trial file exists - create new trial
                start_date = datetime.now()
                first_run_date = start_date.strftime("%Y-%m-%d")
                import hashlib
                signature = hashlib.sha256(f"{first_run_date}your_app_secret_key".encode()).hexdigest()
                trial_info = {
                    'first_run_date': first_run_date,
                    'signature': signature
                }
                
                os.makedirs(os.path.dirname(trial_file), exist_ok=True)
                with open(trial_file, 'w') as f:
                    json.dump(trial_info, f, indent=2)
                
                state.trial_days_left = 30
                state.trial_expired = False
                state.active = True
                state.status = LicenseStatus.TRIAL
                
                self.logger.info("Created new 30-day trial")
                return state
                
            except Exception as e:
                self.logger.error(f"Trial system error: {e}")
                state.status = LicenseStatus.INVALID
                state.error_message = f"Trial system error: {str(e)}"
                return state
                
        except Exception as e:
            self.logger.error(f"Trial system validation error: {e}")
            state = LicenseState()
            state.source = ValidationSource.TRIAL_SYSTEM
            state.licensed = False
            state.active = False
            state.status = LicenseStatus.INVALID
            state.error_message = f"Trial validation failed: {str(e)}"
            return state
    
    def _update_cache_from_state(self, state: LicenseState) -> bool:
        """Update encrypted cache from successful validation state"""
        try:
            license_data = {
                'customer': state.customer,
                'customer_email': state.customer_email,
                'unlock_token': state.unlock_token,
                'hardware_id': state.hardware_id,
            }
            
            if state.subscription and state.valid_until:
                license_data['valid_until'] = state.valid_until
                license_data['subscription_id'] = state.subscription_id
                license_data['subscription_status'] = state.subscription_status
            
            return self.storage.save_encrypted_cache(
                license_data, 
                state.last_validation.isoformat() if state.last_validation else None
            )
            
        except Exception as e:
            self.logger.error(f"Failed to update cache from state: {e}")
            return False