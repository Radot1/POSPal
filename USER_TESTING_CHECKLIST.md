# License Disconnect - User Testing Checklist
**After Building with build.bat**

---

## 🔧 STEP 1: Build the App

```bash
cd C:\PROJECTS\POSPal\POSPal
build.bat
```

**Wait for build to complete**, then:

```bash
cd POSPal_v1.2.1
POSPal.exe
```

---

## ✅ TEST 1: Verify Button Exists (2 minutes)

### Steps:
1. Open POSPal.exe
2. Click **"Manage"** button (bottom right or top menu)
3. Enter password: **9999**
4. Click **"Licensing"** tab (top tabs in modal)
5. Scroll down to **"Advanced Settings"** section
6. Expand "Advanced Settings" if collapsed

### ✅ SUCCESS If You See:
- Red button that says **"Disconnect License from This Device"**
- Icon (unlink symbol) before the text
- Gray help text below: "Remove license activation from this device to use it on another computer"

### ❌ FAIL If:
- No button appears
- Button is in wrong location
- Button has wrong text/color

**Take Screenshot and tell me**: Button exists? YES / NO

---

## ✅ TEST 2: Warning Modal Opens (1 minute)

### Steps:
1. Click the **"Disconnect License from This Device"** button

### ✅ SUCCESS If You See:
- Modal pops up with title: **"⚠️ Disconnect License?"**
- Warning section (yellow box) explaining what will happen
- Info section (blue box) explaining what's preserved
- Your current email displayed (if you have active license)
- Device name displayed
- Checkbox with text: "I understand this will disconnect POSPal from this device"
- **"Disconnect License" button is GRAYED OUT (disabled)**
- "Cancel" button available

### ❌ FAIL If:
- Modal doesn't appear
- Modal is blank/broken
- Checkbox missing
- Buttons don't appear

**Take Screenshot and tell me**: Modal opens correctly? YES / NO

---

## ✅ TEST 3: Checkbox Enables Button (30 seconds)

### Steps:
1. With modal open (from Test 2)
2. Check the checkbox (click it)

### ✅ SUCCESS If:
- **"Disconnect License" button becomes RED and clickable** (not grayed out anymore)
- Button opacity increases (looks solid, not faded)

### ❌ FAIL If:
- Button stays grayed out
- Clicking checkbox does nothing

**Tell me**: Checkbox enables button? YES / NO

---

## ✅ TEST 4: Cancel Button Works (30 seconds)

### Steps:
1. With modal open, click **"Cancel"** button

### ✅ SUCCESS If:
- Modal closes immediately
- Returns to Management Modal (Licensing tab)
- No errors appear

### ❌ FAIL If:
- Modal stays open
- App crashes
- Error message appears

**Tell me**: Cancel works? YES / NO

---

## ✅ TEST 5: API Endpoint Responds (CRITICAL - 2 minutes)

**This tests if the backend is working**

### Steps:
1. With POSPal.exe running
2. Open modal again → click disconnect button
3. Check the checkbox
4. Click **"Disconnect License"** button
5. **WATCH CAREFULLY** what happens

### ✅ SUCCESS If You See ONE OF:
- **Success modal appears** with green checkmark and unlock token (BEST CASE)
- **Error message**: "Invalid email or unlock token" (means API is working, just no active license)
- **Error message**: "Rate limit exceeded" (means API is working)

### ❌ FAIL If You See:
- **Error**: "Failed to disconnect license" or "Network error"
- **Error**: "Cannot reach server"
- **Nothing happens** (button just stops, no response)
- **App crashes**

### What This Tells Us:
- ✅ Success modal = **Everything works perfectly**
- ✅ "Invalid credentials" error = **Backend works, just need valid license**
- ❌ Network error = **Backend endpoint has issues**
- ❌ Nothing happens = **JavaScript error**

**CRITICAL - Tell me exactly what happened**: _________________________________

---

## ✅ TEST 6: Full Disconnect Flow (Only if you have active license - 3 minutes)

**Skip this if you don't have an active license currently**

### Prerequisites:
- You must have an active POSPal license right now
- Email + unlock token stored in the app

### Steps:
1. Verify printing works (proves license is active)
2. Open Management Modal → Licensing → Advanced Settings
3. Click "Disconnect License from This Device"
4. Check confirmation checkbox
5. Click "Disconnect License"
6. **Wait and observe**

### ✅ SUCCESS If You See (in order):
1. Button text changes to "Disconnecting..." with spinner
2. Warning modal closes
3. **Success modal appears** with:
   - Green checkmark ✅
   - Text: "License Disconnected Successfully"
   - Your unlock token displayed (format: POSPAL-XXXX-XXXX-XXXX)
   - "Copy" button next to token
   - Countdown: "POSPal will restart in 5 seconds..."
   - Countdown decrements: 5 → 4 → 3 → 2 → 1
4. **Page refreshes automatically** after 5 seconds
5. After refresh: App shows trial mode / no license

### ❌ FAIL If:
- Error message appears
- Modal closes but nothing happens
- No countdown appears
- App doesn't restart
- After restart, license still shows as active

**Tell me**: Full flow worked? YES / NO / SKIPPED (no active license)

---

## ✅ TEST 7: Files Were Deleted (2 minutes)

**Only after Test 6 completes successfully**

### Steps:
1. After disconnect completes and app restarts
2. Open Windows File Explorer
3. Check these locations:

**Location 1**: `C:\ProgramData\POSPal\`
- Look for: `license_cache.enc`
- **Should be**: DELETED (file not there)

**Location 2**: `C:\PROJECTS\POSPal\POSPal\POSPal_v1.2.1\data\`
- Look for: `license_cache.enc` and `trial.json`
- **Should be**: DELETED or EMPTY

**Location 3**: `C:\PROJECTS\POSPal\POSPal\POSPal_v1.2.1\data\device_sessions.json`
- Open this file (if exists)
- **Should be**: Empty `{}` or very small

### ✅ SUCCESS If:
- All cache files deleted
- trial.json deleted or reset
- device_sessions empty

### ❌ FAIL If:
- Files still exist with old data
- Files locked/cannot delete

**Tell me**: Files were cleaned up? YES / NO / COULDN'T CHECK

---

## ✅ TEST 8: Copy Token Button (30 seconds)

**Only if Test 6 worked and success modal appeared**

### Steps:
1. In success modal, click **"Copy"** button next to unlock token
2. Open Notepad
3. Press Ctrl+V (paste)

### ✅ SUCCESS If:
- Token pasted in Notepad (format: POSPAL-XXXX-XXXX-XXXX)
- Green notification appeared: "Unlock token copied to clipboard"

### ❌ FAIL If:
- Nothing pasted
- No notification
- Wrong text pasted

**Tell me**: Copy button works? YES / NO / DIDN'T TEST

---

## 📊 RESULTS SUMMARY

Fill this out after testing:

```
TEST 1 - Button Exists:              [ ] PASS  [ ] FAIL
TEST 2 - Modal Opens:                 [ ] PASS  [ ] FAIL
TEST 3 - Checkbox Enables Button:    [ ] PASS  [ ] FAIL
TEST 4 - Cancel Works:                [ ] PASS  [ ] FAIL
TEST 5 - API Responds:                [ ] PASS  [ ] FAIL
TEST 6 - Full Disconnect Flow:        [ ] PASS  [ ] FAIL  [ ] SKIP
TEST 7 - Files Deleted:               [ ] PASS  [ ] FAIL  [ ] SKIP
TEST 8 - Copy Token:                  [ ] PASS  [ ] FAIL  [ ] SKIP

OVERALL STATUS: [ ] ALL PASS  [ ] SOME FAIL  [ ] MAJOR ISSUES
```

---

## 🐛 If Something Fails

### If TEST 1 FAILS (Button doesn't appear):
**Problem**: Frontend code didn't get included in build
**Tell me**: "Button not appearing"
**I'll fix**: Check managementComponent.html compilation

### If TEST 2 FAILS (Modal doesn't open):
**Problem**: JavaScript error or modal HTML issue
**Tell me**: "Modal broken" + any error you see
**Check**: Press F12 in browser, look for red errors in Console tab

### If TEST 3-4 FAIL (Checkbox/Cancel):
**Problem**: JavaScript event handlers
**Tell me**: "Buttons not responding"
**Check**: F12 → Console for errors

### If TEST 5 FAILS (API doesn't respond):
**Problem**: Backend endpoint has issues
**Tell me exactly what error message you saw**
**Most likely**: Typo in endpoint or missing import
**I'll fix**: Debug the Flask endpoint

### If TEST 6 FAILS (Full flow breaks):
**Tell me at which step it failed**:
- During "Disconnecting..." phase?
- Success modal didn't appear?
- Countdown didn't start?
- App didn't restart?

### If TEST 7 FAILS (Files not deleted):
**Problem**: File permissions or path issues
**Tell me**: Which files are still there
**Check**: Are files locked by another process?

---

## 💡 Quick Troubleshooting

### If POSPal.exe Won't Start After Build:
```bash
# Check for Python errors
cd POSPal_v1.2.1
POSPal.exe
# Look at terminal output for errors
```

### If Browser Console Shows Errors (F12 → Console):
- Take screenshot of red errors
- Send to me for debugging

### If Nothing Works At All:
**Most likely cause**: Build failed or Python syntax error
**Solution**: I'll need to see the build.bat output

---

## 🎯 What I Need From You

After testing, tell me:

1. **Test results** (PASS/FAIL for each test)
2. **Screenshots** (especially if something fails)
3. **Any error messages** (exact text)
4. **Which test failed first** (if any)

Then I can:
- ✅ Celebrate if everything works!
- 🔧 Fix specific issues if something broke
- 🎯 Guide you through more detailed testing

---

## ⏱️ Time Estimate

- **Minimum Testing** (Tests 1-5): 5-10 minutes
- **Full Testing** (Tests 1-8 with active license): 10-15 minutes
- **Troubleshooting** (if issues): Variable

---

**Ready to build and test! Good luck! 🚀**

Let me know the results!
