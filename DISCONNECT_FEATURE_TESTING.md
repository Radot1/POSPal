# License Disconnect Feature - Complete Testing Guide
**Created**: October 11, 2025
**Status**: READY FOR TESTING
**Implementation**: COMPLETE (Backend + Frontend)

---

## 🎯 Quick Start Testing

### Step 1: Start Flask Server
```bash
cd C:\PROJECTS\POSPal\POSPal
python app.py
```
**Expected Output**: `Running on http://127.0.0.1:5000`

### Step 2: Open POSPal in Browser
```
http://localhost:5000
```

### Step 3: Test the Feature
1. Open Management Modal (password: 9999)
2. Go to **Licensing** tab
3. Scroll down to **Advanced Settings** (expand if collapsed)
4. You should see: **"Disconnect License from This Device"** button

---

## 📋 Complete Test Checklist

### ✅ Backend Tests (Without Frontend)

#### Test 1: Backend Endpoint Exists
```bash
# Start Flask first: python app.py

# Test endpoint responds
curl -X POST http://localhost:5000/api/disconnect-license \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "unlock_token": "TEST", "confirm_password": "9999"}'
```
**Expected**: JSON response (will fail validation but endpoint exists)

#### Test 2: Invalid Password
```bash
curl -X POST http://localhost:5000/api/disconnect-license \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com", "unlock_token": "TEST", "confirm_password": "wrong"}'
```
**Expected**:
```json
{
  "success": false,
  "error": "INVALID_PASSWORD",
  "message": "Invalid management password"
}
```

#### Test 3: Missing Fields
```bash
curl -X POST http://localhost:5000/api/disconnect-license \
  -H "Content-Type: application/json" \
  -d '{"email": "test@test.com"}'
```
**Expected**:
```json
{
  "success": false,
  "error": "MISSING_REQUIRED_FIELDS",
  "message": "Email, unlock_token, and confirm_password are required"
}
```

#### Test 4: Rate Limiting (Run 4 times quickly)
```bash
# Run this command 4 times in a row
for i in {1..4}; do
  curl -X POST http://localhost:5000/api/disconnect-license \
    -H "Content-Type: application/json" \
    -d '{"email": "ratelimit@test.com", "unlock_token": "TEST", "confirm_password": "9999"}'
  echo ""
done
```
**Expected**: 4th request returns 429 (rate limited)

---

### ✅ Frontend Tests (In Browser)

#### Test 5: Button Appears in UI
1. Open http://localhost:5000
2. Click **"Manage"** button (enter password: 9999)
3. Go to **Licensing** tab
4. Scroll to **Advanced Settings**
5. Look for **"Device Management"** section

**Expected**:
- ✅ Red "Disconnect License from This Device" button visible
- ✅ Icon (unlink) appears before text
- ✅ Help text below: "Remove license activation from this device..."

#### Test 6: Warning Modal Opens
1. Click **"Disconnect License from This Device"** button

**Expected**:
- ✅ Modal appears with title "⚠️ Disconnect License?"
- ✅ Warning section shows what will happen
- ✅ Reassurance section shows what's preserved
- ✅ Current license email displayed (if logged in)
- ✅ Current device name displayed
- ✅ Confirmation checkbox visible
- ✅ "Disconnect License" button is **DISABLED**

#### Test 7: Checkbox Enables Button
1. Open warning modal (previous test)
2. Check the confirmation checkbox

**Expected**:
- ✅ "Disconnect License" button becomes **ENABLED** (red)
- ✅ Button opacity changes from 50% to 100%

#### Test 8: Cancel Button Works
1. Open warning modal
2. Click **"Cancel"** button

**Expected**:
- ✅ Modal closes
- ✅ No API call made
- ✅ License still active

#### Test 9: X Button Closes Modal
1. Open warning modal
2. Click **X** in top-right corner

**Expected**:
- ✅ Modal closes
- ✅ Same as cancel

---

### ✅ End-to-End Tests (Full Flow)

#### Test 10: Successful Disconnect (With Active License)

**Prerequisites**:
- Have an active license (email + unlock_token in localStorage)
- OR set up test data manually

**Steps**:
1. Open Management Modal → Licensing → Advanced Settings
2. Click **"Disconnect License from This Device"**
3. Verify current email/device shown in modal
4. Check the confirmation checkbox
5. Click **"Disconnect License"** button

**Expected During Processing**:
- ✅ Button text changes to "Disconnecting..." with spinner
- ✅ Button disabled during processing
- ✅ No errors in browser console (F12)

**Expected On Success**:
- ✅ Warning modal closes
- ✅ Success modal appears with green checkmark
- ✅ Unlock token displayed (format: POSPAL-XXXX-XXXX-XXXX)
- ✅ "Copy" button next to token
- ✅ Next steps shown (numbered list)
- ✅ Countdown starts: "POSPal will restart in 5 seconds..."
- ✅ Countdown decrements: 5 → 4 → 3 → 2 → 1
- ✅ Page reloads automatically after 5 seconds

#### Test 11: Copy Token Button
1. Complete Test 10 until success modal appears
2. **Before countdown ends**, click **"Copy"** button

**Expected**:
- ✅ Green notification: "Unlock token copied to clipboard"
- ✅ Token is actually in clipboard (paste somewhere to verify)

#### Test 12: Manual Restart Button
1. Complete Test 10 until success modal appears
2. Click **"Close & Restart Now"** button

**Expected**:
- ✅ Page reloads immediately (doesn't wait for countdown)
- ✅ App starts in trial mode (no license)

#### Test 13: Verify Cleanup Happened
After Test 10 or 12, verify files were cleared:

**Check localStorage** (F12 → Application → Local Storage):
- ✅ `pospal_license_status` - REMOVED
- ✅ `pospal_license_validated` - REMOVED
- ✅ `pospal_customer_email` - REMOVED (if exists)

**Check sessionStorage**:
- ✅ `pospal_session_id` - REMOVED

**Check Files** (Windows Explorer):
1. `C:\ProgramData\POSPal\license_cache.enc` - ✅ DELETED
2. `C:\PROJECTS\POSPal\POSPal\data\license_cache.enc` - ✅ DELETED
3. `C:\PROJECTS\POSPal\POSPal\data\trial.json` - ✅ DELETED (or reset)
4. `C:\PROJECTS\POSPal\POSPal\data\device_sessions.json` - ✅ CLEARED

---

### ✅ Error Handling Tests

#### Test 14: Disconnect While Offline
1. Open Management Modal → Disconnect
2. **Turn off internet/WiFi**
3. Check confirmation checkbox
4. Click "Disconnect License"

**Expected**:
- ✅ API call fails (cannot reach localhost if WiFi off, or cloud endpoint fails)
- ✅ Local files still cleared
- ✅ Success modal shows with warnings
- ✅ Warning message: "Cloud session could not be ended (offline)"
- ✅ Success modal still displays unlock token

#### Test 15: Disconnect Without Active License
1. Make sure no license is active (localStorage empty)
2. Try to open disconnect modal

**Expected**:
- ✅ Modal opens
- ✅ Email shows: "No license active" or similar
- ✅ Can still proceed (clears any cached data)

#### Test 16: Server Error During Disconnect
**How to Test**: Stop Flask server, then try disconnect

1. Stop Flask: Ctrl+C in terminal
2. Open Management Modal → Disconnect
3. Try to disconnect

**Expected**:
- ✅ Error notification: "Failed to disconnect license"
- ✅ Or: "Network error" / "Cannot reach server"
- ✅ User gets clear error message

---

### ✅ Production Build Tests

#### Test 17: Build and Test in Packaged App
```bash
# Build the app
cmd /c build.bat

# Navigate to build directory
cd POSPal_v1.2.1

# Run the executable
POSPal.exe
```

**Steps**:
1. Open POSPal.exe
2. Test disconnect feature (same as Test 10)
3. Verify files cleared in production paths:
   - `C:\ProgramData\POSPal\`
   - `POSPal_v1.2.1\data\`

**Expected**:
- ✅ Feature works same as development
- ✅ All files cleared from correct production paths
- ✅ App restarts successfully

---

### ✅ Integration Tests (With Real Subscription)

#### Test 18: Disconnect Real Active Subscription
**Prerequisites**: Need real active subscription

1. Have POSPal running with real active license
2. Verify printing works (license is truly active)
3. Open Management Modal → Disconnect
4. Complete disconnect flow
5. Restart app
6. Try to print

**Expected**:
- ✅ After restart, printing BLOCKED
- ✅ Trial mode warning shown
- ✅ License Info shows "No active license"

#### Test 19: Reactivate on Same Device
After Test 18:

1. Go to License Info page
2. Enter same email + unlock_token
3. Click "Activate License"

**Expected**:
- ✅ License reactivates successfully
- ✅ Printing works again
- ✅ Session created in cloud

#### Test 20: Activate on Different Device
After Test 18:

1. On **DIFFERENT computer**, install POSPal
2. Enter email + unlock_token from Test 18
3. Activate license

**Expected**:
- ✅ License activates on new device
- ✅ Original device remains disconnected
- ✅ Only one device active at a time

---

## 🐛 Common Issues & Solutions

### Issue 1: Button Not Appearing
**Symptom**: Can't find disconnect button in Advanced Settings

**Solution**:
1. Make sure you're in the **Licensing** tab (not Orders or Settings)
2. Scroll down to **Advanced Settings** section
3. Expand "Advanced Settings" if collapsed
4. Look for red "Disconnect License" button

**Check**: View page source (Ctrl+U), search for "disconnect-license-btn"

### Issue 2: Modal Not Opening
**Symptom**: Clicking button does nothing

**Solution**:
1. Open browser console (F12 → Console)
2. Look for JavaScript errors
3. Check if `showDisconnectLicenseModal` function exists:
   ```javascript
   typeof showDisconnectLicenseModal
   // Should return: "function"
   ```

### Issue 3: API Call Fails
**Symptom**: Error notification after clicking disconnect

**Solutions**:
- **Check Flask is running**: Terminal should show "Running on http://127.0.0.1:5000"
- **Check network tab** (F12 → Network): Look for /api/disconnect-license request
- **Check Flask logs**: Terminal shows request and any errors
- **Check password**: Default is "9999" in config.json

### Issue 4: Files Not Deleted
**Symptom**: Files still exist after disconnect

**Solutions**:
- **Check file permissions**: Files might be locked by another process
- **Check Flask logs**: Should show "Cleared [filename]" messages
- **Manually verify**: Use Windows Explorer to check directories
- **Try as Administrator**: Run Flask with elevated permissions

### Issue 5: Page Doesn't Reload
**Symptom**: Success modal shows but app doesn't restart

**Solutions**:
- Click **"Close & Restart Now"** button manually
- Refresh page manually (F5)
- Close and reopen browser
- Check browser console for errors

---

## 📊 Test Results Tracking

Use this checklist to track your testing:

```
BACKEND TESTS:
[ ] Test 1: Endpoint exists
[ ] Test 2: Invalid password blocked
[ ] Test 3: Missing fields rejected
[ ] Test 4: Rate limiting works

FRONTEND TESTS:
[ ] Test 5: Button appears in UI
[ ] Test 6: Warning modal opens
[ ] Test 7: Checkbox enables button
[ ] Test 8: Cancel works
[ ] Test 9: X button closes

END-TO-END TESTS:
[ ] Test 10: Successful disconnect
[ ] Test 11: Copy token works
[ ] Test 12: Manual restart works
[ ] Test 13: Cleanup verified

ERROR HANDLING:
[ ] Test 14: Offline disconnect
[ ] Test 15: No license disconnect
[ ] Test 16: Server error handled

PRODUCTION:
[ ] Test 17: Build.bat successful
[ ] Test 18: Disconnect real subscription
[ ] Test 19: Reactivate same device
[ ] Test 20: Activate different device

OVERALL STATUS: [ ] PASS / [ ] FAIL
```

---

## 🚀 Production Deployment Checklist

Before deploying to production:

- [ ] All 20 tests passed
- [ ] No errors in browser console
- [ ] No errors in Flask logs
- [ ] Files cleaned up correctly
- [ ] Build.bat creates working executable
- [ ] Tested on actual Windows machine
- [ ] Tested with real active subscription
- [ ] Tested device migration flow
- [ ] Documentation updated (API_REFERENCE.md)
- [ ] Integration plan reviewed
- [ ] Backup of current working version created

---

## 📞 Support Information

**If something breaks during testing:**

1. **Check Flask logs** - Most detailed error information
2. **Check browser console** - JavaScript errors
3. **Check backend test script**: Run `python test_disconnect_endpoint.py`
4. **Review integration plan**: `LICENSE_DISCONNECT_INTEGRATION_PLAN.md`
5. **Review implementation docs**:
   - Backend: `DISCONNECT_ENDPOINT_IMPLEMENTATION.md`
   - Frontend: `DISCONNECT_FRONTEND_IMPLEMENTATION.md`

**Rollback procedure** (if needed):
1. Comment out disconnect button in `managementComponent.html` (line 376-389)
2. Comment out endpoint in `app.py` (line 7043-7474)
3. Rebuild with `build.bat`

---

## ✅ Final Verification

After all tests pass, verify:

1. **Feature works end-to-end**: Can disconnect and reactivate
2. **No broken functionality**: Existing features still work
3. **Clean implementation**: No console errors
4. **User-friendly**: Clear messages and guidance
5. **Production-ready**: Build works correctly

**Ready for production deployment**: YES / NO

---

**Last Updated**: October 11, 2025
**Implementation Status**: ✅ COMPLETE
**Testing Status**: ⏳ READY FOR TESTING
