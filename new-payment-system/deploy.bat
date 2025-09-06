@echo off
echo ========================================
echo POSPal Licensing System v2.0 Deployment
echo ========================================
echo.

:: Check if in correct directory
if not exist "wrangler.toml" (
    echo ERROR: wrangler.toml not found!
    echo Please run this from the new-payment-system directory
    pause
    exit /b 1
)

:: Set environment (default to development)
set ENV=%1
if "%ENV%"=="" set ENV=development

echo Deploying to environment: %ENV%
echo.

:: Step 1: Create D1 databases if they don't exist
echo [1/6] Creating D1 databases...
echo.

if "%ENV%"=="development" (
    echo Creating development database...
    wrangler d1 create pospal-licensing-dev
) else (
    echo Creating production database...  
    wrangler d1 create pospal-licensing-prod
)

echo.
echo IMPORTANT: Copy the database ID from above and update wrangler.toml
pause

:: Step 2: Run database schema
echo [2/6] Setting up database schema...
wrangler d1 execute pospal-licensing-%ENV% --env %ENV% --file=schema.sql

:: Step 3: Set secrets (user will need to provide these)
echo.
echo [3/6] Setting up secrets...
echo.
echo You need to set the following secrets. Press Enter after each one:
echo.

echo Setting STRIPE_SECRET_KEY...
set /p STRIPE_SECRET="Enter your new Stripe secret key: "
wrangler secret put STRIPE_SECRET_KEY --env %ENV%
echo %STRIPE_SECRET% | wrangler secret put STRIPE_SECRET_KEY --env %ENV%

echo.
echo Setting STRIPE_WEBHOOK_SECRET...
set /p WEBHOOK_SECRET="Enter your Stripe webhook secret: "
echo %WEBHOOK_SECRET% | wrangler secret put STRIPE_WEBHOOK_SECRET --env %ENV%

echo.
echo Setting RESEND_API_KEY...  
set /p RESEND_KEY="Enter your Resend API key: "
echo %RESEND_KEY% | wrangler secret put RESEND_API_KEY --env %ENV%

echo.
echo Setting JWT_SECRET...
echo Generating secure JWT secret...
wrangler secret put JWT_SECRET --env %ENV%
echo Enter a secure random string for JWT signing (32+ characters): 

echo.
echo Setting APP_SECRET_KEY (must match POSPal app.py)...
set /p APP_SECRET="Enter the APP_SECRET_KEY from POSPal (0x8F3A2B1C9D4E5F6A): "
echo %APP_SECRET% | wrangler secret put APP_SECRET_KEY --env %ENV%

:: Step 4: Deploy the worker
echo.
echo [4/6] Deploying Cloudflare Worker...
wrangler publish --env %ENV%

:: Step 5: Set up custom domain (manual step)
echo.
echo [5/6] Custom domain setup...
echo.
if "%ENV%"=="development" (
    echo Please configure DNS for license-dev.pospal.gr to point to your worker
) else (
    echo Please configure DNS for license.pospal.gr to point to your worker
)
echo This must be done manually in Cloudflare dashboard.
echo.

:: Step 6: Disable maintenance mode
echo [6/6] Disabling maintenance mode...
wrangler d1 execute pospal-licensing-%ENV% --env %ENV% --command "UPDATE system_config SET value = 'false' WHERE key = 'maintenance_mode'"

echo.
echo ========================================
echo DEPLOYMENT COMPLETE!
echo ========================================
echo.
if "%ENV%"=="development" (
    echo Your new licensing system is available at:
    echo https://license-dev.pospal.gr
) else (
    echo Your new licensing system is available at:
    echo https://license.pospal.gr
)
echo.
echo Next steps:
echo 1. Test the /health endpoint
echo 2. Create a test user account  
echo 3. Update POSPal app to use new authentication
echo 4. Redirect old payment forms to maintenance.html
echo.
pause