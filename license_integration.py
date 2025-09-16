"""
License Integration Layer
Provides seamless integration between legacy license system and unified controller
"""

import os
import sys
import functools
from typing import Dict, Any, Optional

# Add license_controller to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, current_dir)

from license_controller import (
    LicenseController, 
    LicenseState, 
    ValidationSource,
    LicenseStatus,
    UnifiedStorageManager,
    ValidationFlow,
    LicenseMigrationManager
)


class LicenseIntegration:
    """
    Integration layer that manages the transition from legacy to unified system
    
    Features:
    - Gradual migration support
    - Backward compatibility
    - Fallback to legacy system
    - Migration status tracking
    """
    
    def __init__(self, app, app_logger, data_dir: str, program_data_dir: str, 
                 exe_dir: str, app_secret_key: str, cloudflare_api_caller):
        self.app = app
        self.logger = app_logger
        
        # Initialize unified controller
        try:
            self.license_controller = LicenseController(
                app_logger, data_dir, program_data_dir, exe_dir, 
                app_secret_key, cloudflare_api_caller
            )
            
            self.migration_manager = LicenseMigrationManager(
                self.license_controller.storage, app_logger
            )
            
            self._unified_available = True
            self.logger.info("Unified license controller initialized successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to initialize unified controller: {e}")
            self._unified_available = False
            self.license_controller = None
            self.migration_manager = None
        
        # Integration settings
        self._enable_unified = os.environ.get('POSPAL_ENABLE_UNIFIED_LICENSES', 'true').lower() == 'true'
        self._migration_completed = False
        self._legacy_fallback_enabled = True
        
        # Auto-migration on startup if enabled
        if self._unified_available and self._enable_unified:
            self._attempt_auto_migration()
    
    def _attempt_auto_migration(self):
        """Attempt automatic migration on startup"""
        try:
            assessment = self.migration_manager.assess_migration_needs()
            
            if assessment.get("needs_migration") and not assessment.get("migration_completed"):
                self.logger.info("Attempting automatic license migration...")
                
                # Run migration
                result = self.migration_manager.execute_migration(dry_run=False)
                
                if result.success:
                    self.logger.info("Automatic migration completed successfully")
                    self._migration_completed = True
                    self.license_controller.mark_migration_completed()
                else:
                    self.logger.warning(f"Automatic migration failed: {result.message}")
                    # Continue with legacy system
            
            elif assessment.get("migration_completed"):
                self._migration_completed = True
                self.license_controller.mark_migration_completed()
                self.logger.info("Migration already completed")
                
        except Exception as e:
            self.logger.error(f"Auto-migration error: {e}")
            # Continue with legacy system
    
    def get_license_status(self, force_refresh: bool = False, use_unified: bool = None) -> Dict[str, Any]:
        """
        Get license status with intelligent system selection
        
        Args:
            force_refresh: Force refresh of license data
            use_unified: Override system selection (None = auto-detect)
            
        Returns:
            Dict containing license status in legacy format
        """
        # Determine which system to use
        should_use_unified = self._should_use_unified_system(use_unified)
        
        if should_use_unified:
            return self._get_unified_license_status(force_refresh)
        else:
            return self._get_legacy_license_status(force_refresh)
    
    def _should_use_unified_system(self, override: Optional[bool]) -> bool:
        """Determine if unified system should be used"""
        if override is not None:
            return override and self._unified_available
        
        return (
            self._unified_available and 
            self._enable_unified and 
            self._migration_completed
        )
    
    def _get_unified_license_status(self, force_refresh: bool) -> Dict[str, Any]:
        """Get license status from unified controller"""
        try:
            state = self.license_controller.get_license_status(force_refresh)
            
            # Convert to legacy format for backward compatibility
            legacy_format = self._convert_state_to_legacy_format(state)
            
            # Add integration metadata
            legacy_format['_unified_system'] = True
            legacy_format['_migration_completed'] = self._migration_completed
            
            return legacy_format
            
        except Exception as e:
            self.logger.error(f"Unified license status error: {e}")
            
            # Fallback to legacy system
            if self._legacy_fallback_enabled:
                self.logger.info("Falling back to legacy license system")
                return self._get_legacy_license_status(force_refresh)
            else:
                # Return safe fallback
                return {
                    'licensed': False,
                    'active': False,
                    'expired': True,
                    'source': 'unified_system_error',
                    'message': f'License system error: {str(e)}',
                    '_unified_system': True,
                    '_error': str(e)
                }
    
    def _get_legacy_license_status(self, force_refresh: bool) -> Dict[str, Any]:
        """Get license status from legacy system"""
        try:
            # Import legacy function directly to avoid recursion
            from app import check_trial_status_legacy

            legacy_status = check_trial_status_legacy()

            # Add integration metadata
            legacy_status['_unified_system'] = False
            legacy_status['_legacy_fallback'] = True

            return legacy_status
            
        except Exception as e:
            self.logger.error(f"Legacy license status error: {e}")
            
            # Return safe fallback
            return {
                'licensed': False,
                'active': False,
                'expired': True,
                'source': 'legacy_system_error',
                'message': f'Legacy license system error: {str(e)}',
                '_unified_system': False,
                '_error': str(e)
            }
    
    def _convert_state_to_legacy_format(self, state: LicenseState) -> Dict[str, Any]:
        """Convert unified LicenseState to legacy format"""
        legacy = {
            'licensed': state.licensed,
            'active': state.active,
            'subscription': state.subscription,
            'customer': state.customer,
            'customer_email': state.customer_email,
            'hardware_id': state.hardware_id,
            'source': state.source.value,
            'message': state.get_user_message()
        }
        
        # Add subscription details if present
        if state.subscription and state.valid_until:
            legacy.update({
                'valid_until': state.valid_until,
                'subscription_id': state.subscription_id,
                'subscription_status': state.subscription_status
            })
        
        # Add grace period information
        if state.grace_period_active:
            legacy.update({
                'days_offline': state.days_offline,
                'grace_period_active': state.grace_period_active,
                'grace_period_warning_level': state.grace_period_warning_level
            })
        
        # Add trial information
        if state.status == LicenseStatus.TRIAL:
            legacy.update({
                'days_left': state.trial_days_left,
                'expired': state.trial_expired
            })
        elif state.status == LicenseStatus.EXPIRED:
            legacy['expired'] = True
        
        # Add cloud validation information
        if state.cloud_validation_attempted:
            legacy.update({
                'cloud_validation_attempted': state.cloud_validation_attempted,
                'cloud_validation': state.cloud_validation_successful
            })
        
        return legacy
    
    def validate_license_with_cloud(self, customer_email: str, unlock_token: str,
                                   hardware_id: Optional[str] = None) -> Dict[str, Any]:
        """Validate license with cloud service"""
        if self._unified_available and self._enable_unified:
            try:
                return self.license_controller.validate_license_with_cloud(
                    customer_email, unlock_token, hardware_id
                )
            except Exception as e:
                self.logger.error(f"Unified cloud validation error: {e}")
                
                # Fallback to legacy system
                if self._legacy_fallback_enabled:
                    return self._fallback_to_legacy_cloud_validation(
                        customer_email, unlock_token, hardware_id
                    )
        
        # Use legacy system
        return self._fallback_to_legacy_cloud_validation(
            customer_email, unlock_token, hardware_id
        )
    
    def _fallback_to_legacy_cloud_validation(self, customer_email: str, 
                                           unlock_token: str, hardware_id: Optional[str]) -> Dict[str, Any]:
        """Fallback to legacy cloud validation"""
        try:
            # Import legacy functions dynamically
            from app import call_cloudflare_api, get_hardware_fingerprint
            
            if hardware_id is None:
                hardware_id = get_hardware_fingerprint()
            
            validation_data = {
                'customer_email': customer_email,
                'unlock_token': unlock_token,
                'hardware_id': hardware_id
            }
            
            response = call_cloudflare_api('/validate', validation_data, timeout=3, max_retries=1)
            
            if response and response.get('success'):
                return {
                    "licensed": True,
                    "active": True,
                    "subscription": bool(response.get('subscription')),
                    "cloud_validation": True,
                    "validation_method": "legacy_cloud",
                    "message": "License validation successful (legacy)",
                    "_unified_system": False
                }
            else:
                error_msg = response.get('error', 'Cloud validation failed') if response else 'No response'
                return {
                    "licensed": False,
                    "active": False,
                    "cloud_validation": True,
                    "validation_method": "legacy_cloud",
                    "message": error_msg,
                    "_unified_system": False
                }
                
        except Exception as e:
            self.logger.error(f"Legacy cloud validation fallback error: {e}")
            return {
                "licensed": False,
                "active": False,
                "cloud_validation": False,
                "validation_method": "legacy_cloud_error",
                "message": f"Validation error: {str(e)}",
                "_unified_system": False
            }
    
    def get_system_info(self) -> Dict[str, Any]:
        """Get comprehensive system information"""
        info = {
            "integration": {
                "unified_available": self._unified_available,
                "unified_enabled": self._enable_unified,
                "migration_completed": self._migration_completed,
                "legacy_fallback_enabled": self._legacy_fallback_enabled,
                "current_system": "unified" if self._should_use_unified_system(None) else "legacy"
            }
        }
        
        # Add unified system info if available
        if self._unified_available:
            try:
                unified_info = self.license_controller.get_system_info()
                info["unified"] = unified_info
            except Exception as e:
                info["unified"] = {"error": str(e)}
        
        # Add migration info
        if self.migration_manager:
            try:
                assessment = self.migration_manager.assess_migration_needs()
                info["migration"] = assessment
                info["migration_history"] = self.migration_manager.get_migration_history()
            except Exception as e:
                info["migration"] = {"error": str(e)}
        
        return info
    
    def force_migration(self, dry_run: bool = False) -> Dict[str, Any]:
        """Force migration to unified system"""
        if not self._unified_available:
            return {
                "success": False,
                "message": "Unified system not available"
            }
        
        if not self.migration_manager:
            return {
                "success": False,
                "message": "Migration manager not available"
            }
        
        try:
            result = self.migration_manager.execute_migration(dry_run)
            
            if result.success and not dry_run:
                self._migration_completed = True
                self.license_controller.mark_migration_completed()
            
            return {
                "success": result.success,
                "message": result.message,
                "details": result.details,
                "dry_run": dry_run
            }
            
        except Exception as e:
            self.logger.error(f"Force migration error: {e}")
            return {
                "success": False,
                "message": f"Migration failed: {str(e)}",
                "error": str(e)
            }
    
    def enable_unified_system(self) -> bool:
        """Enable unified system"""
        if self._unified_available:
            self._enable_unified = True
            self.logger.info("Unified system enabled")
            return True
        return False
    
    def disable_unified_system(self) -> bool:
        """Disable unified system (fallback to legacy)"""
        self._enable_unified = False
        self.logger.info("Unified system disabled - using legacy")
        return True
    
    def clear_license_cache(self) -> bool:
        """Clear license cache from current system"""
        if self._should_use_unified_system(None) and self.license_controller:
            return self.license_controller.clear_license_cache()
        else:
            # Clear legacy cache
            try:
                from app import _clear_license_cache
                _clear_license_cache()
                return True
            except Exception as e:
                self.logger.error(f"Failed to clear legacy cache: {e}")
                return False


# Global integration instance (will be initialized by app.py)
license_integration: Optional[LicenseIntegration] = None


def initialize_license_integration(app, app_logger, data_dir: str, program_data_dir: str,
                                 exe_dir: str, app_secret_key: str, cloudflare_api_caller):
    """Initialize global license integration"""
    global license_integration
    
    try:
        license_integration = LicenseIntegration(
            app, app_logger, data_dir, program_data_dir, 
            exe_dir, app_secret_key, cloudflare_api_caller
        )
        app_logger.info("License integration initialized successfully")
        return True
        
    except Exception as e:
        app_logger.error(f"Failed to initialize license integration: {e}")
        license_integration = None
        return False


def get_license_status_integrated(force_refresh: bool = False) -> Dict[str, Any]:
    """Get license status using integrated system"""
    global license_integration
    
    if license_integration:
        return license_integration.get_license_status(force_refresh)
    else:
        # Fallback to legacy system
        try:
            from app import check_trial_status_legacy
            return check_trial_status_legacy()
        except Exception as e:
            return {
                'licensed': False,
                'active': False,
                'expired': True,
                'source': 'integration_error',
                'message': f'Integration system error: {str(e)}'
            }


def validate_license_integrated(customer_email: str, unlock_token: str,
                              hardware_id: Optional[str] = None) -> Dict[str, Any]:
    """Validate license using integrated system"""
    global license_integration
    
    if license_integration:
        return license_integration.validate_license_with_cloud(
            customer_email, unlock_token, hardware_id
        )
    else:
        # Fallback to legacy system
        return {
            "licensed": False,
            "active": False,
            "cloud_validation": False,
            "message": "Integration system not available",
            "_unified_system": False
        }