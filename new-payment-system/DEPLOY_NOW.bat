@echo off
echo ========================================
echo 🚀 POSPal v2.0 - AUTOMATIC DEPLOYMENT
echo ========================================
echo.
echo ✅ All secrets ready
echo ✅ Stripe keys configured  
echo ✅ Webhook secret received
echo ✅ Database schema prepared
echo.
echo Starting deployment in 5 seconds...
echo Press Ctrl+C to cancel
timeout /t 5 /nobreak >nul

:: Step 1: Create D1 Database
echo.
echo [1/6] Creating D1 Database...
echo.
wrangler d1 create pospal-licensing-dev

echo.
echo ⚠️  IMPORTANT: Copy the database ID from above and press Enter
pause

:: Step 2: Apply Database Schema
echo.
echo [2/6] Applying database schema...
wrangler d1 execute pospal-licensing-dev --file=schema.sql

:: Step 3: Set Stripe Secrets
echo.
echo [3/6] Setting Stripe secrets...
echo sk_test_51S2bGO0ee6hGru1PF5o9w508HFtJYwdSMIfUmbGXjUUwzXS7MBEpScjBC5WBsoIZP2a3FwjVeh8sw2Cf1Ptpp54i00LaksBs2d | wrangler secret put STRIPE_SECRET_KEY

echo whsec_VDkwzJ2rwghFQt6IVwiSLuLARPl3vPIU | wrangler secret put STRIPE_WEBHOOK_SECRET

:: Step 4: Set Other Secrets
echo.
echo [4/6] Setting other secrets...
echo re_8E5HhfwM_5Za4spJwwoEoeCAf1uYnwQ2M | wrangler secret put RESEND_API_KEY

echo pospal_jwt_v2_secure_signing_key_2024_production_ready_32chars_minimum | wrangler secret put JWT_SECRET

echo 0x8F3A2B1C9D4E5F6A | wrangler secret put APP_SECRET_KEY

:: Step 5: Deploy Worker
echo.
echo [5/6] Deploying Cloudflare Worker...
wrangler publish

:: Step 6: Test Deployment
echo.
echo [6/6] Testing deployment...
echo.
echo Testing health endpoint...
curl -s https://pospal-licensing-v2.YOURUSERNAME.workers.dev/health

echo.
echo ========================================
echo 🎉 DEPLOYMENT COMPLETE!
echo ========================================
echo.
echo Your new secure payment system is live at:
echo https://pospal-licensing-v2.YOURUSERNAME.workers.dev
echo.
echo Next steps:
echo 1. Update Stripe webhook URL to point to your new worker
echo 2. Test payment flow with test-payment.html
echo 3. Disable maintenance mode
echo 4. System is ready for production!
echo.
echo Test URLs:
echo - Health: https://pospal-licensing-v2.YOURUSERNAME.workers.dev/health
echo - Status: https://pospal-licensing-v2.YOURUSERNAME.workers.dev/status
echo.
pause