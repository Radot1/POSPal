# License Disconnect Feature - Testing Guide

**Date**: October 11, 2025
**Purpose**: Step-by-step guide to test the disconnect feature

---

## Prerequisites

1. POSPal application running locally
2. Active license in localStorage
3. Flask backend server running on port 5000
4. Backend endpoint `/api/disconnect-license` implemented

---

## Test 1: UI Elements Visibility

### Steps:
1. Open POSPal application
2. Enter management password (default: 9999)
3. Click on "Licensing" tab
4. Scroll down to "Advanced Settings"
5. Click to expand Advanced Settings

### Expected Results:
- [ ] "Device Management" section appears
- [ ] Red "Disconnect License from This Device" button visible
- [ ] Helper text appears below button
- [ ] Button has unlink icon (fa-unlink)

**Status**: _______________

---

## Test 2: Warning Modal Display

### Steps:
1. Click "Disconnect License from This Device" button

### Expected Results:
- [ ] Warning modal appears
- [ ] Modal has red header with warning icon
- [ ] Current email is displayed correctly
- [ ] "What will happen" section shows 4 items
- [ ] "What will be preserved" section shows 4 items
- [ ] Confirmation checkbox is unchecked
- [ ] Confirm button is disabled (grayed out)
- [ ] Cancel button is enabled

**Status**: _______________

---

## Test 3: Checkbox Confirmation

### Steps:
1. Open warning modal (from Test 2)
2. Try clicking "Disconnect License" button (should not work)
3. Check the confirmation checkbox
4. Observe button state change

### Expected Results:
- [ ] Button disabled when checkbox unchecked
- [ ] Button enabled when checkbox checked
- [ ] Button changes from gray to red when enabled

**Status**: _______________

---

## Test 4: Modal Cancel

### Steps:
1. Open warning modal
2. Click "Cancel" button

### Expected Results:
- [ ] Modal closes
- [ ] Checkbox resets to unchecked
- [ ] No API calls made
- [ ] License still active

**Status**: _______________

---

## Test 5: Successful Disconnect (Happy Path)

### Prerequisites:
- Internet connection active
- Backend server running
- Valid license in localStorage

### Steps:
1. Open warning modal
2. Check confirmation checkbox
3. Click "Disconnect License" button
4. Wait for processing

### Expected Results:
- [ ] Button shows "Disconnecting..." with spinner
- [ ] Button disabled during processing
- [ ] Backend API called (`POST /api/disconnect-license`)
- [ ] Warning modal closes
- [ ] Success modal appears
- [ ] Unlock token displayed in success modal
- [ ] Countdown starts at 5 seconds
- [ ] Countdown decrements each second

**Check Console**:
```javascript
// Should see:
- "License cache cleared" log
- No error messages
```

**Check localStorage**:
```javascript
localStorage.getItem('pospal_unlock_token') // Should be null
localStorage.getItem('pospal_customer_email') // Should be null
```

**Status**: _______________

---

## Test 6: Unlock Token Copy

### Steps:
1. After successful disconnect (success modal visible)
2. Click "Copy" button next to unlock token

### Expected Results:
- [ ] "Unlock token copied to clipboard" notification appears
- [ ] Token is in clipboard (paste to verify)

**Verify**:
```
Paste token here: ___________________________
```

**Status**: _______________

---

## Test 7: Auto-Restart

### Steps:
1. After successful disconnect
2. Wait for countdown to reach 0

### Expected Results:
- [ ] Countdown shows 5, 4, 3, 2, 1
- [ ] At 0, page reloads automatically
- [ ] App enters trial mode
- [ ] No license data in localStorage

**Status**: _______________

---

## Test 8: Manual Restart

### Steps:
1. After successful disconnect (before countdown ends)
2. Click "Restart Now" button

### Expected Results:
- [ ] Page reloads immediately
- [ ] Countdown stops
- [ ] App enters trial mode

**Status**: _______________

---

## Test 9: Offline Disconnect

### Prerequisites:
- Disconnect from internet
- Or stop Flask backend server

### Steps:
1. Open warning modal
2. Check confirmation checkbox
3. Click "Disconnect License"

### Expected Results:
- [ ] Error notification appears
- [ ] Message: "Cannot connect to server. Please check your internet connection."
- [ ] Button re-enabled
- [ ] Button text resets to "Disconnect License"
- [ ] Modal stays open (user can retry)

**Status**: _______________

---

## Test 10: Rate Limiting

### Steps:
1. Perform 4 disconnect attempts rapidly
   - Attempt 1
   - Attempt 2
   - Attempt 3
   - Attempt 4 (should fail)

### Expected Results:
- [ ] First 3 attempts succeed
- [ ] 4th attempt returns error
- [ ] Error message: "Too many disconnect attempts. Please wait 5 minutes."
- [ ] HTTP 429 status code

**Note**: Wait 5 minutes before continuing tests

**Status**: _______________

---

## Test 11: Invalid Password

### Prerequisites:
- Modify backend to reject password

### Steps:
1. Change management password in `config.json`
2. Try to disconnect

### Expected Results:
- [ ] Error notification appears
- [ ] Message: "Invalid credentials or password"
- [ ] HTTP 401 status code
- [ ] Button re-enabled

**Status**: _______________

---

## Test 12: No Active License

### Steps:
1. Clear localStorage manually:
   ```javascript
   localStorage.clear();
   ```
2. Try to click disconnect button

### Expected Results:
- [ ] Error notification: "No active license found to disconnect"
- [ ] Modal closes immediately

**Status**: _______________

---

## Test 13: Partial Success (With Warnings)

### Prerequisites:
- Lock a file to simulate partial cleanup

### Steps:
1. Disconnect normally

### Expected Results:
- [ ] Success modal appears
- [ ] Warning notifications appear
- [ ] Console shows warnings array
- [ ] Unlock token still displayed
- [ ] App still restarts

**Status**: _______________

---

## Test 14: Mobile Responsiveness

### Steps:
1. Open Chrome DevTools
2. Toggle device toolbar (Ctrl+Shift+M)
3. Select mobile device (e.g., iPhone 12)
4. Test disconnect flow

### Expected Results:
- [ ] Button fits on mobile screen
- [ ] Warning modal readable on mobile
- [ ] Success modal readable on mobile
- [ ] All text properly sized
- [ ] Buttons touch-friendly

**Status**: _______________

---

## Test 15: Cross-Browser Testing

### Browsers to Test:
- [ ] Chrome
- [ ] Firefox
- [ ] Edge
- [ ] Safari (if available)

### For Each Browser:
1. Open warning modal
2. Complete disconnect
3. Test clipboard copy
4. Verify auto-restart

**Chrome**: _______________
**Firefox**: _______________
**Edge**: _______________
**Safari**: _______________

---

## Test 16: End-to-End Device Migration

### Steps:
1. **Device A**: Disconnect license
2. Copy unlock token
3. Verify app enters trial mode
4. **Device B**: Open POSPal
5. Enter email and unlock token
6. Activate license

### Expected Results:
- [ ] Device A: License disconnected, trial mode active
- [ ] Device B: License activates successfully
- [ ] Device A: Cannot reactivate (device limit reached)
- [ ] Cloud: Only Device B session active

**Status**: _______________

---

## Test 17: localStorage Cleanup Verification

### After Successful Disconnect:

Check all keys cleared:
```javascript
// Should all return null
localStorage.getItem('pospal_unlock_token')
localStorage.getItem('pospal_customer_email')
localStorage.getItem('pospal_customer_name')
localStorage.getItem('pospal_license_status')
sessionStorage.getItem('pospal_session_id')
```

### Expected Results:
- [ ] All license keys removed
- [ ] Session ID removed
- [ ] No orphaned data

**Status**: _______________

---

## Test 18: Data Preservation Verification

### After Disconnect:

Check data preserved:
```javascript
// Should still exist
- Menu items in data/menu.json
- Order history in data/orders/
- Analytics data
- Settings in config.json
```

### Expected Results:
- [ ] Menu items intact
- [ ] Order history intact
- [ ] Analytics data intact
- [ ] Settings intact

**Status**: _______________

---

## Test 19: Backend API Response Verification

### Using cURL or Postman:

```bash
curl -X POST http://localhost:5000/api/disconnect-license \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "unlock_token": "POSPAL-TEST-TEST-TEST",
    "confirm_password": "9999"
  }'
```

### Expected Response:
```json
{
  "success": true,
  "unlock_token": "POSPAL-TEST-TEST-TEST",
  "cleanup_summary": {
    "local_files_cleared": true,
    "trial_data_cleared": true,
    "device_sessions_cleared": true,
    "cloud_session_ended": true,
    "license_cache_cleared": true
  },
  "warnings": []
}
```

**Status**: _______________

---

## Test 20: Console Error Check

### During All Tests:

Open browser console (F12) and check for:
- [ ] No JavaScript errors
- [ ] No unhandled promise rejections
- [ ] No network errors (except expected offline test)
- [ ] Proper log messages

**Status**: _______________

---

## Performance Testing

### Metrics to Check:

1. **Modal Open Time**
   - Should be < 100ms
   - Actual: _______________

2. **API Response Time**
   - Should be < 2 seconds
   - Actual: _______________

3. **Page Reload Time**
   - Should be < 3 seconds
   - Actual: _______________

---

## Accessibility Testing

### Keyboard Navigation:
- [ ] Tab through all buttons
- [ ] Enter/Space activates buttons
- [ ] Escape closes modals
- [ ] Focus visible on all elements

### Screen Reader:
- [ ] Button labels readable
- [ ] Modal content announced
- [ ] Error messages announced

**Status**: _______________

---

## Security Verification

### Check:
- [ ] Password not visible in network tab
- [ ] Unlock token only sent to backend
- [ ] No credentials logged to console
- [ ] HTTPS used in production

**Status**: _______________

---

## Edge Cases

### Test These Scenarios:

1. **Double-click disconnect button**
   - Expected: Only one API call
   - Result: _______________

2. **Close browser during disconnect**
   - Expected: Restart shows trial mode
   - Result: _______________

3. **Disconnect with corrupted localStorage**
   - Expected: Error handled gracefully
   - Result: _______________

4. **Disconnect while offline, then go online**
   - Expected: Cloud session expires naturally
   - Result: _______________

---

## Final Checklist

### Before Production:
- [ ] All 20 tests passed
- [ ] No console errors
- [ ] Performance acceptable
- [ ] Mobile responsive
- [ ] Cross-browser compatible
- [ ] Documentation updated
- [ ] Backend endpoint confirmed working
- [ ] Rate limiting verified
- [ ] Error handling tested

---

## Known Issues Log

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
|       |          |        |       |
|       |          |        |       |
|       |          |        |       |

---

## Test Summary

**Total Tests**: 20
**Passed**: _____ / 20
**Failed**: _____ / 20
**Blocked**: _____ / 20

**Overall Status**: _______________

**Tested By**: _______________
**Date**: _______________
**Environment**: _______________

---

## Next Steps After Testing

1. [ ] Fix any issues found
2. [ ] Re-test failed scenarios
3. [ ] Update documentation with findings
4. [ ] Get user approval
5. [ ] Deploy to production via `build.bat`
6. [ ] Monitor for issues in production
7. [ ] Gather user feedback

---

**Notes**:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
