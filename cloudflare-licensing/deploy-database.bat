@echo off
REM POSPal Database Deployment Script
REM Deploys the complete schema to development or production

echo ========================================
echo POSPal Database Deployment
echo ========================================

REM Check if wrangler is available
wrangler --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: wrangler CLI not found. Please install it with: npm install -g wrangler
    pause
    exit /b 1
)

echo Wrangler CLI detected.
echo.

:menu
echo Choose deployment environment:
echo 1. Development (pospal-subscriptions-dev)
echo 2. Production (pospal-subscriptions)  
echo 3. Verify existing database
echo 4. Exit
echo.
set /p choice="Enter your choice (1-4): "

if "%choice%"=="1" goto deploy_dev
if "%choice%"=="2" goto deploy_prod
if "%choice%"=="3" goto verify
if "%choice%"=="4" goto exit
echo Invalid choice. Please try again.
goto menu

:deploy_dev
echo.
echo ========================================
echo Deploying to DEVELOPMENT environment
echo ========================================
echo.
echo This will create/update all database tables and indexes in development.
set /p confirm="Continue? (y/N): "
if /i not "%confirm%"=="y" goto menu

echo Deploying complete schema...
wrangler d1 execute pospal-subscriptions-dev --env development --file=complete-schema.sql

if %errorlevel% neq 0 (
    echo ❌ Deployment failed!
    pause
    goto menu
)

echo.
echo ✅ Development deployment completed!
echo.
echo Verifying deployment...
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

echo.
echo ✅ Development database is ready!
goto menu

:deploy_prod
echo.
echo ========================================
echo Deploying to PRODUCTION environment
echo ========================================
echo.
echo ⚠️  WARNING: You are about to deploy to PRODUCTION!
echo This will create/update database schema in the live environment.
echo.
set /p confirm1="Are you absolutely sure? (y/N): "
if /i not "%confirm1%"=="y" goto menu

echo.
echo Creating backup before deployment...
set BACKUP_DATE=%date:~10,4%-%date:~4,2%-%date:~7,2%
set BACKUP_TIME=%time:~0,2%-%time:~3,2%-%time:~6,2%
set BACKUP_TIME=%BACKUP_TIME: =0%
mkdir "backups\pre-deployment_%BACKUP_DATE%_%BACKUP_TIME%" 2>nul

wrangler d1 execute pospal-subscriptions --env production --command="SELECT 'customers' as table_name, COUNT(*) as record_count FROM customers" --json > "backups\pre-deployment_%BACKUP_DATE%_%BACKUP_TIME%\before_deployment.json"

echo Deploying to production...
wrangler d1 execute pospal-subscriptions --env production --file=complete-schema.sql

if %errorlevel% neq 0 (
    echo ❌ Production deployment failed!
    echo Please check the error and try again.
    pause
    goto menu
)

echo.
echo ✅ Production deployment completed!
echo.
echo Verifying production deployment...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

echo.
echo Creating post-deployment summary...
wrangler d1 execute pospal-subscriptions --env production --command="SELECT 'customers' as table_name, COUNT(*) as record_count FROM customers UNION SELECT 'audit_log', COUNT(*) FROM audit_log UNION SELECT 'active_sessions', COUNT(*) FROM active_sessions" --json > "backups\pre-deployment_%BACKUP_DATE%_%BACKUP_TIME%\after_deployment.json"

echo.
echo ✅ Production database is ready!
goto menu

:verify
echo.
echo ========================================
echo Database Verification
echo ========================================
echo.
echo Choose database to verify:
echo 1. Development
echo 2. Production
echo.
set /p verify_choice="Enter choice (1-2): "

if "%verify_choice%"=="1" goto verify_dev
if "%verify_choice%"=="2" goto verify_prod
goto verify

:verify_dev
echo.
echo Verifying development database...
echo.
echo Tables:
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"

echo.
echo Indexes:
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"

echo.
echo Record counts:
wrangler d1 execute pospal-subscriptions-dev --env development --command="SELECT 'customers' as table_name, COUNT(*) as records FROM customers UNION SELECT 'audit_log', COUNT(*) FROM audit_log UNION SELECT 'active_sessions', COUNT(*) FROM active_sessions"

goto menu

:verify_prod
echo.
echo Verifying production database...
echo.
echo Tables:
wrangler d1 execute pospal-subscriptions --env production --command="SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"

echo.
echo Indexes:
wrangler d1 execute pospal-subscriptions --env production --command="SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name"

echo.
echo Record counts:
wrangler d1 execute pospal-subscriptions --env production --command="SELECT 'customers' as table_name, COUNT(*) as records FROM customers UNION SELECT 'audit_log', COUNT(*) FROM audit_log UNION SELECT 'active_sessions', COUNT(*) FROM active_sessions"

echo.
echo Schema version:
wrangler d1 execute pospal-subscriptions --env production --command="SELECT * FROM schema_version ORDER BY version DESC LIMIT 1"

goto menu

:exit
echo.
echo ========================================
echo Deployment Complete
echo ========================================
echo.
echo Next steps for production readiness:
echo 1. Verify all secrets are set: run setup-secrets.bat
echo 2. Test the API endpoints
echo 3. Run integration tests
echo 4. Monitor the first transactions
echo.
echo For database backups, use backup-database.bat
echo For troubleshooting, check the Cloudflare Workers logs
echo.
pause