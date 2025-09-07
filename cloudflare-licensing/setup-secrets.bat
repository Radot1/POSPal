@echo off
REM POSPal Cloudflare Workers Secrets Setup Script
REM This script helps set up environment variables for both development and production

echo ========================================
echo POSPal Cloudflare Workers Setup
echo ========================================

echo.
echo This script will help you set up secrets for your Cloudflare Workers.
echo Make sure you have wrangler CLI installed and authenticated.
echo.

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
echo Choose environment to configure:
echo 1. Development
echo 2. Production  
echo 3. Exit
echo.
set /p choice="Enter your choice (1-3): "

if "%choice%"=="1" goto development
if "%choice%"=="2" goto production
if "%choice%"=="3" goto exit
echo Invalid choice. Please try again.
goto menu

:development
echo.
echo ========================================
echo Setting up DEVELOPMENT environment
echo ========================================
echo.
echo You will need to provide the following secrets:
echo - STRIPE_SECRET_KEY (test key starting with sk_test_)
echo - STRIPE_WEBHOOK_SECRET (webhook secret starting with whsec_)
echo - RESEND_API_KEY (Resend.com API key starting with re_)
echo.
echo Enter your test Stripe secret key:
set /p stripe_secret="STRIPE_SECRET_KEY: "

echo Enter your webhook secret:
set /p webhook_secret="STRIPE_WEBHOOK_SECRET: "

echo Enter your Resend API key:
set /p resend_key="RESEND_API_KEY: "

echo.
echo Setting secrets for development environment...
echo wrangler secret put STRIPE_SECRET_KEY --env development
echo %stripe_secret% | wrangler secret put STRIPE_SECRET_KEY --env development

echo wrangler secret put STRIPE_WEBHOOK_SECRET --env development  
echo %webhook_secret% | wrangler secret put STRIPE_WEBHOOK_SECRET --env development

echo wrangler secret put RESEND_API_KEY --env development
echo %resend_key% | wrangler secret put RESEND_API_KEY --env development

echo.
echo ✓ Development environment configured!
goto menu

:production
echo.
echo ========================================
echo Setting up PRODUCTION environment
echo ========================================
echo.
echo WARNING: You are setting up PRODUCTION secrets!
echo Make sure you are using LIVE Stripe keys, not test keys.
echo.
echo You will need to provide the following secrets:
echo - STRIPE_SECRET_KEY (live key starting with sk_live_)
echo - STRIPE_WEBHOOK_SECRET (webhook secret starting with whsec_)
echo - RESEND_API_KEY (Resend.com API key starting with re_)
echo.
set /p confirm="Are you sure you want to continue? (y/N): "
if /i not "%confirm%"=="y" goto menu

echo Enter your live Stripe secret key:
set /p stripe_secret="STRIPE_SECRET_KEY: "

echo Enter your webhook secret:
set /p webhook_secret="STRIPE_WEBHOOK_SECRET: "

echo Enter your Resend API key:
set /p resend_key="RESEND_API_KEY: "

echo.
echo Setting secrets for production environment...
echo wrangler secret put STRIPE_SECRET_KEY --env production
echo %stripe_secret% | wrangler secret put STRIPE_SECRET_KEY --env production

echo wrangler secret put STRIPE_WEBHOOK_SECRET --env production
echo %webhook_secret% | wrangler secret put STRIPE_WEBHOOK_SECRET --env production

echo wrangler secret put RESEND_API_KEY --env production
echo %resend_key% | wrangler secret put RESEND_API_KEY --env production

echo.
echo ✓ Production environment configured!
goto menu

:exit
echo.
echo Setup complete!
echo.
echo Next steps:
echo 1. Copy .env.local.template to .env.local and fill in your values
echo 2. Deploy your worker: wrangler publish --env development
echo 3. Test the integration with your Flask app
echo.
echo For more information, see the deployment guide.
pause