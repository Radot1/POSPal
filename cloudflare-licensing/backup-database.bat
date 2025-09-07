@echo off
REM POSPal Database Backup Script for Cloudflare D1
REM This script creates backups of the production database

echo ========================================
echo POSPal Database Backup Utility
echo ========================================

REM Check if wrangler is available
wrangler --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: wrangler CLI not found. Please install it with: npm install -g wrangler
    pause
    exit /b 1
)

REM Create backup directory with timestamp
set BACKUP_DATE=%date:~10,4%-%date:~4,2%-%date:~7,2%
set BACKUP_TIME=%time:~0,2%-%time:~3,2%-%time:~6,2%
set BACKUP_TIME=%BACKUP_TIME: =0%
set BACKUP_DIR=backups\%BACKUP_DATE%_%BACKUP_TIME%
mkdir "%BACKUP_DIR%" 2>nul

echo Creating backup in: %BACKUP_DIR%
echo.

:menu
echo Choose backup environment:
echo 1. Development
echo 2. Production  
echo 3. Both
echo 4. Exit
echo.
set /p choice="Enter your choice (1-4): "

if "%choice%"=="1" goto backup_dev
if "%choice%"=="2" goto backup_prod
if "%choice%"=="3" goto backup_both
if "%choice%"=="4" goto exit
echo Invalid choice. Please try again.
goto menu

:backup_dev
echo.
echo ========================================
echo Backing up DEVELOPMENT database
echo ========================================
echo.

echo Exporting customers table...
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT * FROM customers" --json > "%BACKUP_DIR%\dev_customers.json"

echo Exporting audit_log table...
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10000" --json > "%BACKUP_DIR%\dev_audit_log.json"

echo Exporting email_log table...
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT * FROM email_log ORDER BY created_at DESC LIMIT 5000" --json > "%BACKUP_DIR%\dev_email_log.json"

echo Exporting active_sessions table...
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT * FROM active_sessions" --json > "%BACKUP_DIR%\dev_active_sessions.json"

echo Exporting refund_requests table...
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT * FROM refund_requests" --json > "%BACKUP_DIR%\dev_refund_requests.json"

echo.
echo ✓ Development backup completed!
goto menu

:backup_prod
echo.
echo ========================================
echo Backing up PRODUCTION database
echo ========================================
echo.
echo WARNING: You are about to backup PRODUCTION data!
set /p confirm="Are you sure you want to continue? (y/N): "
if /i not "%confirm%"=="y" goto menu

echo Exporting customers table...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM customers" --json > "%BACKUP_DIR%\prod_customers.json"

echo Exporting audit_log table (last 10000 records)...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 10000" --json > "%BACKUP_DIR%\prod_audit_log.json"

echo Exporting email_log table (last 5000 records)...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM email_log ORDER BY created_at DESC LIMIT 5000" --json > "%BACKUP_DIR%\prod_email_log.json"

echo Exporting active_sessions table...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM active_sessions" --json > "%BACKUP_DIR%\prod_active_sessions.json"

echo Exporting refund_requests table...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM refund_requests" --json > "%BACKUP_DIR%\prod_refund_requests.json"

echo Creating summary report...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT 'customers' as table_name, COUNT(*) as record_count FROM customers UNION SELECT 'audit_log', COUNT(*) FROM audit_log UNION SELECT 'email_log', COUNT(*) FROM email_log UNION SELECT 'active_sessions', COUNT(*) FROM active_sessions UNION SELECT 'refund_requests', COUNT(*) FROM refund_requests" --json > "%BACKUP_DIR%\prod_summary.json"

echo.
echo ✓ Production backup completed!
goto menu

:backup_both
echo.
echo ========================================
echo Backing up BOTH environments
echo ========================================
call :backup_dev
call :backup_prod
goto menu

:exit
echo.
echo ========================================
echo Backup Summary
echo ========================================
echo Backup location: %BACKUP_DIR%
echo.
echo Files created:
dir /b "%BACKUP_DIR%\*.json" 2>nul
echo.
echo IMPORTANT BACKUP NOTES:
echo - Store backups in a secure location
echo - Test restore procedures regularly
echo - Keep multiple backup versions
echo - Consider encrypting sensitive data
echo.
echo For restore procedures, see restore-database.bat
pause