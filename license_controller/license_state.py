"""
License State Management
Consistent license state representation across all validation methods
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Dict, Any
from enum import Enum


class ValidationSource(Enum):
    """Sources of license validation"""
    CLOUD_VALIDATION = "cloud_validation"
    ENCRYPTED_CACHE = "encrypted_cache" 
    LEGACY_LICENSE_KEY = "legacy_license_key"
    TRIAL_SYSTEM = "trial_system"
    MIGRATION_FALLBACK = "migration_fallback"


class LicenseStatus(Enum):
    """License status states"""
    ACTIVE = "active"
    EXPIRED = "expired"
    GRACE_PERIOD = "grace_period"
    TRIAL = "trial"
    INVALID = "invalid"


@dataclass
class LicenseState:
    """
    Unified license state representation
    Single source of truth for all license information
    """
    
    # Core license status
    licensed: bool = False
    active: bool = False
    status: LicenseStatus = LicenseStatus.INVALID
    source: ValidationSource = ValidationSource.TRIAL_SYSTEM
    
    # Subscription information
    subscription: bool = False
    subscription_id: Optional[str] = None
    subscription_status: Optional[str] = None
    valid_until: Optional[str] = None
    
    # Customer information
    customer: Optional[str] = None
    customer_email: Optional[str] = None
    unlock_token: Optional[str] = None
    
    # Hardware binding
    hardware_id: Optional[str] = None
    
    # Validation metadata
    last_validation: Optional[datetime] = None
    cloud_validation_attempted: bool = False
    cloud_validation_successful: bool = False
    
    # Grace period information
    days_offline: int = 0
    grace_period_active: bool = False
    grace_period_expired: bool = False
    grace_period_warning_level: int = 0
    
    # Trial information
    trial_days_left: int = 0
    trial_expired: bool = False
    
    # Error information
    error_message: Optional[str] = None
    validation_errors: list = field(default_factory=list)
    
    # Additional metadata
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def is_valid(self) -> bool:
        """Check if the license state represents a valid license"""
        return self.licensed and self.active and self.status in [
            LicenseStatus.ACTIVE, 
            LicenseStatus.GRACE_PERIOD
        ]
    
    def requires_internet(self) -> bool:
        """Check if internet connection is required for continued operation"""
        return (
            self.grace_period_active and self.grace_period_warning_level >= 3
        ) or self.grace_period_expired
    
    def get_user_message(self) -> str:
        """Get user-friendly status message"""
        if self.status == LicenseStatus.ACTIVE:
            if self.source == ValidationSource.CLOUD_VALIDATION:
                return "License validated successfully"
            elif self.source == ValidationSource.ENCRYPTED_CACHE:
                if self.grace_period_active:
                    days_left = 10 - self.days_offline
                    return f"Operating offline ({days_left} days remaining)"
                return "License active (cached)"
            elif self.source == ValidationSource.LEGACY_LICENSE_KEY:
                return "Legacy license active"
            
        elif self.status == LicenseStatus.GRACE_PERIOD:
            days_left = 10 - self.days_offline
            if self.grace_period_warning_level >= 3:
                return f"URGENT: Must connect to internet today! ({days_left} days)"
            else:
                return f"Please connect to internet soon ({days_left} days)"
                
        elif self.status == LicenseStatus.EXPIRED:
            if self.subscription:
                return "Subscription expired - please renew"
            return "License expired"
            
        elif self.status == LicenseStatus.TRIAL:
            if self.trial_expired:
                return "Trial period expired"
            return f"Trial: {self.trial_days_left} days remaining"
            
        return "License validation failed"
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert license state to dictionary for API responses"""
        return {
            "licensed": self.licensed,
            "active": self.active,
            "status": self.status.value,
            "source": self.source.value,
            "subscription": self.subscription,
            "subscription_id": self.subscription_id,
            "subscription_status": self.subscription_status,
            "valid_until": self.valid_until,
            "customer": self.customer,
            "customer_email": self.customer_email,
            "hardware_id": self.hardware_id,
            "last_validation": self.last_validation.isoformat() if self.last_validation else None,
            "cloud_validation_attempted": self.cloud_validation_attempted,
            "cloud_validation_successful": self.cloud_validation_successful,
            "days_offline": self.days_offline,
            "grace_period_active": self.grace_period_active,
            "grace_period_expired": self.grace_period_expired,
            "grace_period_warning_level": self.grace_period_warning_level,
            "trial_days_left": self.trial_days_left,
            "trial_expired": self.trial_expired,
            "error_message": self.error_message,
            "validation_errors": self.validation_errors,
            "user_message": self.get_user_message(),
            "requires_internet": self.requires_internet(),
            "metadata": self.metadata
        }
    
    @classmethod
    def from_legacy_dict(cls, legacy_data: Dict[str, Any]) -> 'LicenseState':
        """Create LicenseState from legacy check_trial_status() result"""
        state = cls()
        
        # Map legacy fields to new structure
        state.licensed = legacy_data.get('licensed', False)
        state.active = legacy_data.get('active', False)
        state.subscription = legacy_data.get('subscription', False)
        state.subscription_id = legacy_data.get('subscription_id')
        state.subscription_status = legacy_data.get('subscription_status')
        state.valid_until = legacy_data.get('valid_until')
        state.customer = legacy_data.get('customer')
        state.customer_email = legacy_data.get('customer_email')
        state.hardware_id = legacy_data.get('hardware_id')
        state.cloud_validation_attempted = legacy_data.get('cloud_validation_attempted', False)
        state.cloud_validation_successful = legacy_data.get('cloud_validation', False)
        state.days_offline = legacy_data.get('days_offline', 0)
        state.grace_period_active = legacy_data.get('grace_period_active', False)
        state.grace_period_expired = legacy_data.get('grace_period_expired', False)
        state.grace_period_warning_level = legacy_data.get('grace_period_warning_level', 0)
        state.trial_days_left = legacy_data.get('days_left', 0)
        state.trial_expired = legacy_data.get('expired', False)
        state.error_message = legacy_data.get('message')
        
        # Map source
        source_str = legacy_data.get('source', 'trial_system')
        if source_str == 'cloud_validation':
            state.source = ValidationSource.CLOUD_VALIDATION
        elif source_str == 'cached_validation':
            state.source = ValidationSource.ENCRYPTED_CACHE
        elif source_str == 'legacy_license_key':
            state.source = ValidationSource.LEGACY_LICENSE_KEY
        else:
            state.source = ValidationSource.TRIAL_SYSTEM
            
        # Determine status
        if state.licensed and state.active:
            if state.grace_period_active:
                state.status = LicenseStatus.GRACE_PERIOD
            else:
                state.status = LicenseStatus.ACTIVE
        elif legacy_data.get('expired'):
            state.status = LicenseStatus.EXPIRED
        elif not state.licensed and state.trial_days_left > 0:
            state.status = LicenseStatus.TRIAL
        else:
            state.status = LicenseStatus.INVALID
            
        return state