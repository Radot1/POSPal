"""
License Migration Manager
Handles smooth transition from legacy license system to unified controller
"""

import os
import json
import shutil
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

from .license_state import LicenseState, ValidationSource, LicenseStatus
from .storage_manager import UnifiedStorageManager


class MigrationResult:
    """Result of migration operation"""
    
    def __init__(self, success: bool, message: str, details: Dict[str, Any] = None):
        self.success = success
        self.message = message
        self.details = details or {}
        self.timestamp = datetime.now().isoformat()


class LicenseMigrationManager:
    """
    Manages migration from legacy license system to unified controller
    
    Provides:
    - Safe migration with rollback capability
    - Data validation and migration
    - Backward compatibility during transition
    - Migration status tracking
    """
    
    def __init__(self, storage_manager: UnifiedStorageManager, app_logger):
        self.storage = storage_manager
        self.logger = app_logger
        
        # Migration tracking
        self._migration_log_file = os.path.join(storage_manager.data_dir, 'migration_log.json')
        self._backup_dir = os.path.join(storage_manager.data_dir, 'migration_backup')
        
    def assess_migration_needs(self) -> Dict[str, Any]:
        """
        Assess what needs to be migrated
        
        Returns:
            Dict containing migration assessment
        """
        assessment = {
            "needs_migration": False,
            "legacy_license_exists": False,
            "legacy_cache_exists": False,
            "unified_cache_exists": False,
            "migration_completed": False,
            "recommendations": [],
            "risks": [],
            "estimated_downtime": "< 1 second"
        }
        
        try:
            # Check for legacy license file
            if os.path.exists(self.storage.legacy_license_file):
                assessment["legacy_license_exists"] = True
                assessment["needs_migration"] = True
                assessment["recommendations"].append("Migrate legacy license.key file")
            
            # Check for existing encrypted cache
            if os.path.exists(self.storage.encrypted_cache_file):
                assessment["unified_cache_exists"] = True
                assessment["recommendations"].append("Verify encrypted cache integrity")
            
            # Check migration history
            migration_history = self._load_migration_log()
            if migration_history:
                last_migration = migration_history[-1]
                if last_migration.get("status") == "completed":
                    assessment["migration_completed"] = True
                elif last_migration.get("status") == "failed":
                    assessment["risks"].append("Previous migration failed - may need cleanup")
            
            # Generate recommendations
            if assessment["needs_migration"] and not assessment["migration_completed"]:
                assessment["recommendations"].append("Run migration to unified license system")
                
            if assessment["legacy_license_exists"] and assessment["unified_cache_exists"]:
                assessment["recommendations"].append("Consider removing legacy files after validation")
            
            return assessment
            
        except Exception as e:
            self.logger.error(f"Migration assessment error: {e}")
            assessment["error"] = str(e)
            assessment["risks"].append(f"Assessment failed: {e}")
            return assessment
    
    def execute_migration(self, dry_run: bool = False) -> MigrationResult:
        """
        Execute license system migration
        
        Args:
            dry_run: If True, only simulate migration without making changes
            
        Returns:
            MigrationResult: Result of migration operation
        """
        try:
            self.logger.info(f"Starting license migration (dry_run={dry_run})")
            
            # Step 1: Pre-migration validation
            pre_validation = self._pre_migration_validation()
            if not pre_validation["valid"]:
                return MigrationResult(
                    False, 
                    f"Pre-migration validation failed: {pre_validation['message']}",
                    pre_validation
                )
            
            # Step 2: Create backup
            if not dry_run:
                backup_result = self._create_migration_backup()
                if not backup_result["success"]:
                    return MigrationResult(
                        False,
                        f"Backup creation failed: {backup_result['message']}",
                        backup_result
                    )
            
            # Step 3: Migrate data
            migration_steps = []
            
            # Migrate legacy license if exists
            if os.path.exists(self.storage.legacy_license_file):
                legacy_result = self._migrate_legacy_license(dry_run)
                migration_steps.append({"step": "legacy_license", "result": legacy_result})
                
                if not legacy_result["success"]:
                    return MigrationResult(
                        False,
                        f"Legacy license migration failed: {legacy_result['message']}",
                        {"steps": migration_steps}
                    )
            
            # Validate existing cache
            cache_result = self._validate_existing_cache(dry_run)
            migration_steps.append({"step": "cache_validation", "result": cache_result})
            
            # Step 4: Post-migration validation
            post_validation = self._post_migration_validation(dry_run)
            migration_steps.append({"step": "post_validation", "result": post_validation})
            
            if not post_validation["success"]:
                if not dry_run:
                    self._rollback_migration()
                return MigrationResult(
                    False,
                    f"Post-migration validation failed: {post_validation['message']}",
                    {"steps": migration_steps}
                )
            
            # Step 5: Log migration success
            if not dry_run:
                self._log_migration_success(migration_steps)
            
            result_message = "Migration completed successfully" if not dry_run else "Migration simulation successful"
            
            return MigrationResult(
                True,
                result_message,
                {"steps": migration_steps, "dry_run": dry_run}
            )
            
        except Exception as e:
            self.logger.error(f"Migration error: {e}")
            
            # Attempt rollback on error
            if not dry_run:
                try:
                    self._rollback_migration()
                except Exception as rollback_error:
                    self.logger.error(f"Rollback failed: {rollback_error}")
            
            return MigrationResult(
                False,
                f"Migration failed with error: {str(e)}",
                {"error": str(e), "dry_run": dry_run}
            )
    
    def _pre_migration_validation(self) -> Dict[str, Any]:
        """Validate system before migration"""
        try:
            validation = {
                "valid": True,
                "message": "Pre-migration validation passed",
                "checks": {}
            }
            
            # Check disk space
            try:
                free_space = shutil.disk_usage(self.storage.data_dir).free
                if free_space < 10 * 1024 * 1024:  # 10MB minimum
                    validation["valid"] = False
                    validation["message"] = "Insufficient disk space"
                validation["checks"]["disk_space_mb"] = free_space // (1024 * 1024)
            except Exception as e:
                validation["checks"]["disk_space_error"] = str(e)
            
            # Check write permissions
            test_file = os.path.join(self.storage.data_dir, 'migration_test.tmp')
            try:
                os.makedirs(self.storage.data_dir, exist_ok=True)
                with open(test_file, 'w') as f:
                    f.write('test')
                os.remove(test_file)
                validation["checks"]["write_permissions"] = True
            except Exception as e:
                validation["valid"] = False
                validation["message"] = f"No write permissions: {e}"
                validation["checks"]["write_permissions"] = False
            
            # Check existing files
            validation["checks"]["legacy_license_exists"] = os.path.exists(self.storage.legacy_license_file)
            validation["checks"]["cache_exists"] = os.path.exists(self.storage.encrypted_cache_file)
            
            return validation
            
        except Exception as e:
            return {
                "valid": False,
                "message": f"Pre-migration validation error: {e}",
                "error": str(e)
            }
    
    def _create_migration_backup(self) -> Dict[str, Any]:
        """Create backup before migration"""
        try:
            # Create backup directory
            backup_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_path = os.path.join(self._backup_dir, f"migration_{backup_timestamp}")
            os.makedirs(backup_path, exist_ok=True)
            
            backed_up_files = []
            
            # Backup legacy license file
            if os.path.exists(self.storage.legacy_license_file):
                backup_file = os.path.join(backup_path, 'license.key')
                shutil.copy2(self.storage.legacy_license_file, backup_file)
                backed_up_files.append('license.key')
            
            # Backup existing cache
            if os.path.exists(self.storage.encrypted_cache_file):
                backup_file = os.path.join(backup_path, 'license_cache.enc')
                shutil.copy2(self.storage.encrypted_cache_file, backup_file)
                backed_up_files.append('license_cache.enc')
            
            # Backup trial info if exists
            trial_file = os.path.join(self.storage.data_dir, 'trial_info.json')
            if os.path.exists(trial_file):
                backup_file = os.path.join(backup_path, 'trial_info.json')
                shutil.copy2(trial_file, backup_file)
                backed_up_files.append('trial_info.json')
            
            self.logger.info(f"Migration backup created: {backup_path}")
            
            return {
                "success": True,
                "backup_path": backup_path,
                "backed_up_files": backed_up_files,
                "timestamp": backup_timestamp
            }
            
        except Exception as e:
            self.logger.error(f"Backup creation error: {e}")
            return {
                "success": False,
                "message": f"Backup failed: {e}",
                "error": str(e)
            }
    
    def _migrate_legacy_license(self, dry_run: bool) -> Dict[str, Any]:
        """Migrate legacy license file to unified system"""
        try:
            # Load legacy license
            legacy_state = self.storage.load_legacy_license()
            
            if not legacy_state:
                return {
                    "success": False,
                    "message": "Failed to load legacy license",
                    "dry_run": dry_run
                }
            
            if not legacy_state.is_valid():
                return {
                    "success": False,
                    "message": "Legacy license is invalid",
                    "dry_run": dry_run
                }
            
            if dry_run:
                return {
                    "success": True,
                    "message": "Legacy license migration simulation successful",
                    "legacy_state": legacy_state.to_dict(),
                    "dry_run": True
                }
            
            # Convert to cache format and save
            license_data = {
                'customer': legacy_state.customer,
                'customer_email': legacy_state.customer_email,
                'unlock_token': legacy_state.unlock_token,
                'hardware_id': legacy_state.hardware_id,
            }
            
            if legacy_state.subscription and legacy_state.valid_until:
                license_data.update({
                    'valid_until': legacy_state.valid_until,
                    'subscription_id': legacy_state.subscription_id,
                    'subscription_status': legacy_state.subscription_status
                })
            
            # Save to encrypted cache
            save_success = self.storage.save_encrypted_cache(
                license_data, 
                datetime.now().isoformat()
            )
            
            if not save_success:
                return {
                    "success": False,
                    "message": "Failed to save migrated data to cache",
                    "dry_run": dry_run
                }
            
            self.logger.info("Legacy license migrated successfully")
            
            return {
                "success": True,
                "message": "Legacy license migrated successfully",
                "migrated_data": license_data,
                "dry_run": dry_run
            }
            
        except Exception as e:
            self.logger.error(f"Legacy license migration error: {e}")
            return {
                "success": False,
                "message": f"Legacy license migration failed: {e}",
                "error": str(e),
                "dry_run": dry_run
            }
    
    def _validate_existing_cache(self, dry_run: bool) -> Dict[str, Any]:
        """Validate existing encrypted cache"""
        try:
            cache_data = self.storage.load_encrypted_cache()
            
            if not cache_data:
                return {
                    "success": True,
                    "message": "No existing cache to validate",
                    "dry_run": dry_run
                }
            
            # Validate cache structure
            required_fields = ['license_data', 'last_validation', 'hardware_id']
            missing_fields = [field for field in required_fields if field not in cache_data]
            
            if missing_fields:
                if not dry_run:
                    self.storage.clear_encrypted_cache()
                
                return {
                    "success": False,
                    "message": f"Invalid cache structure - missing fields: {missing_fields}",
                    "cleared_cache": not dry_run,
                    "dry_run": dry_run
                }
            
            # Validate hardware ID
            if cache_data['hardware_id'] != self.storage.get_hardware_id():
                if not dry_run:
                    self.storage.clear_encrypted_cache()
                
                return {
                    "success": False,
                    "message": "Cache hardware ID mismatch - cleared invalid cache",
                    "cleared_cache": not dry_run,
                    "dry_run": dry_run
                }
            
            return {
                "success": True,
                "message": "Existing cache validation passed",
                "cache_valid": True,
                "dry_run": dry_run
            }
            
        except Exception as e:
            self.logger.error(f"Cache validation error: {e}")
            return {
                "success": False,
                "message": f"Cache validation failed: {e}",
                "error": str(e),
                "dry_run": dry_run
            }
    
    def _post_migration_validation(self, dry_run: bool) -> Dict[str, Any]:
        """Validate system after migration"""
        try:
            # Test unified system
            from .license_controller import LicenseController
            from .validation_flow import ValidationFlow
            
            # Create temporary validation flow for testing
            temp_validation = ValidationFlow(self.storage, None, self.logger)
            
            if dry_run:
                return {
                    "success": True,
                    "message": "Post-migration validation simulation passed",
                    "dry_run": True
                }
            
            # Test actual validation
            try:
                test_state = temp_validation.validate_license()
                
                if not test_state:
                    return {
                        "success": False,
                        "message": "Post-migration validation failed - no state returned"
                    }
                
                return {
                    "success": True,
                    "message": "Post-migration validation passed",
                    "validation_state": test_state.to_dict(),
                    "dry_run": dry_run
                }
                
            except Exception as validation_error:
                return {
                    "success": False,
                    "message": f"Post-migration validation failed: {validation_error}",
                    "error": str(validation_error),
                    "dry_run": dry_run
                }
            
        except Exception as e:
            self.logger.error(f"Post-migration validation error: {e}")
            return {
                "success": False,
                "message": f"Post-migration validation error: {e}",
                "error": str(e),
                "dry_run": dry_run
            }
    
    def _rollback_migration(self) -> bool:
        """Rollback migration if it fails"""
        try:
            # Find most recent backup
            if not os.path.exists(self._backup_dir):
                self.logger.warning("No backup directory found for rollback")
                return False
            
            backup_dirs = [d for d in os.listdir(self._backup_dir) 
                          if d.startswith('migration_') and os.path.isdir(os.path.join(self._backup_dir, d))]
            
            if not backup_dirs:
                self.logger.warning("No migration backups found for rollback")
                return False
            
            # Use most recent backup
            backup_dirs.sort(reverse=True)
            latest_backup = os.path.join(self._backup_dir, backup_dirs[0])
            
            # Restore files
            restored_files = []
            
            # Restore legacy license
            backup_license = os.path.join(latest_backup, 'license.key')
            if os.path.exists(backup_license):
                shutil.copy2(backup_license, self.storage.legacy_license_file)
                restored_files.append('license.key')
            
            # Restore cache
            backup_cache = os.path.join(latest_backup, 'license_cache.enc')
            if os.path.exists(backup_cache):
                shutil.copy2(backup_cache, self.storage.encrypted_cache_file)
                restored_files.append('license_cache.enc')
            
            self.logger.info(f"Migration rollback completed - restored: {restored_files}")
            return True
            
        except Exception as e:
            self.logger.error(f"Migration rollback error: {e}")
            return False
    
    def _log_migration_success(self, migration_steps: List[Dict[str, Any]]) -> None:
        """Log successful migration"""
        try:
            migration_log = self._load_migration_log()
            
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "status": "completed",
                "steps": migration_steps,
                "version": "1.0"
            }
            
            migration_log.append(log_entry)
            
            with open(self._migration_log_file, 'w') as f:
                json.dump(migration_log, f, indent=2)
            
            self.logger.info("Migration logged successfully")
            
        except Exception as e:
            self.logger.error(f"Failed to log migration: {e}")
    
    def _load_migration_log(self) -> List[Dict[str, Any]]:
        """Load migration history log"""
        try:
            if os.path.exists(self._migration_log_file):
                with open(self._migration_log_file, 'r') as f:
                    return json.load(f)
            return []
        except Exception as e:
            self.logger.error(f"Failed to load migration log: {e}")
            return []
    
    def get_migration_history(self) -> List[Dict[str, Any]]:
        """Get migration history"""
        return self._load_migration_log()
    
    def cleanup_migration_files(self, keep_backups: int = 3) -> Dict[str, Any]:
        """Clean up old migration files"""
        try:
            cleanup_result = {
                "cleaned_backups": 0,
                "kept_backups": 0,
                "errors": []
            }
            
            if not os.path.exists(self._backup_dir):
                return cleanup_result
            
            # List all backup directories
            backup_dirs = [d for d in os.listdir(self._backup_dir) 
                          if d.startswith('migration_') and os.path.isdir(os.path.join(self._backup_dir, d))]
            
            backup_dirs.sort(reverse=True)  # Most recent first
            
            # Keep most recent backups, remove older ones
            for i, backup_dir in enumerate(backup_dirs):
                backup_path = os.path.join(self._backup_dir, backup_dir)
                
                if i < keep_backups:
                    cleanup_result["kept_backups"] += 1
                else:
                    try:
                        shutil.rmtree(backup_path)
                        cleanup_result["cleaned_backups"] += 1
                    except Exception as e:
                        cleanup_result["errors"].append(f"Failed to remove {backup_dir}: {e}")
            
            return cleanup_result
            
        except Exception as e:
            self.logger.error(f"Migration cleanup error: {e}")
            return {"error": str(e)}