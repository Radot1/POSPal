## Working Notes: POSPal Sales & Licensing Plan

Last updated: 2025-08-19

### New decisions from discussion
- Website: keep a public Download for anyone. Add “Find a Distributor” specifically for buying a license.

### Decisions just implemented (website)
- Header CTAs changed to "Download" (links to latest GitHub Release) and "Buy License" (links to `#distributors`).
- Hero CTAs updated: "Buy License" and "Download" replacing Calendly links.
- Pricing CTA updated to "Buy License" linking to `#distributors`.
- Bottom CTA updated to "Download" linking to latest Release.
- New `#distributors` section added with a dummy distributor entry (Acme POS Solutions) as placeholder.
- Updated copy to reflect flow "Download → Trial → Buy License from Distributor":
  - Metro map Step 2 label now "Download App".
  - "How it works" steps updated (Download, Trial, Buy License).
  - Hero tour text updated for stations 2–4 accordingly.
 - Added EULA link in footer and updated copyright:
   - Footer now links to `EULA.md`.
   - Footer copyright: © 2025 Robert Zoumboulis-Airey. All rights reserved.

### New files
- `EULA.md` created (English; governed by the laws of Greece; licensor: Robert Zoumboulis-Airey).

References:
- Download URL: `https://github.com/Radot1/POSPal/releases/latest` ([GitHub Repo](https://github.com/Radot1/POSPal))

### Decisions just implemented (in‑app)
- Updated activation steps to point to distributors instead of email in:
  - `POSPal.html`
  - `POSPalDesktop.html`
  - `managementComponent.html`
  Wording for step 2: "Contact an authorized distributor (see the website's 'Buy License' section) and provide your Hardware ID."
- Added a "Buy License" button inside the License section that opens `index.html#distributors` in a new tab.
- Added a "View EULA" button inside the License section that opens `EULA.md` in a new tab (all three locations).

### README updates
- Removed MIT badge reference and changed license section to: proprietary software governed by EULA.md.

### Assistant's last proposal and findings (for reference)

I scanned the repo and found where the trial, license UI, and contact links live. The website has Calendly links in `index.html`, and the app shows a “License Information” section with a mailto email in `POSPal.html`, `POSPalDesktop.html`, and `managementComponent.html`. The backend enforces trial/license in `app.py` with a `license.key` signature check.

#### Proposal: phased approach (discuss first, then implement)
- Phase 1 — Business flow and messaging
  - Define the distributor-led purchase flow and what users see when trial expires.
  - Replace all direct-to-you contact/Calendly with “Find a Distributor”.
- Phase 2 — Website edits
  - Replace Calendly CTAs with “Find a Distributor” and a distributor directory section.
  - Add legal footer and pages: EULA, Copyright, and License Terms.
- Phase 3 — In-app edits
  - Update the License modal text to “Contact an authorized distributor” (remove personal email).
  - Add a clear “Trial status” line and a link/QR to the distributor directory.
- Phase 4 — Licensing hardening
  - Move the license generator out of the public repo; rotate secret keys.
  - Switch to asymmetric signing (e.g., ECDSA) for license files; app verifies with a public key.
  - Optional: add a simple “Upload license.key” UI for convenience.
- Phase 5 — Contracts and IP
  - Draft EULA and Distributor Agreement (non-legal advice; you’ll want a lawyer review).
  - Copyright/Notice: add to app About/footers; add COPYRIGHT file; consider replacing the “MIT” badge in `README.txt` if you’re moving to a proprietary license or dual-licensing.

#### What I found to update
- Website CTAs (Calendly) in `index.html`:
```338:346:index.html
<a id="cta-step2" href="https://calendly.com/bzoumboulis/pospal-installation-service" target="_blank" class="cta-button cta-primary w-full sm:w-auto">
    <i class="fas fa-calendar-check mr-2"></i>
    <span>Start at Step 2</span>
</a>
```
- App License Info (mailto) in the management UI:
```116:119:managementComponent.html
<div class="border-t border-gray-300 pt-4"><h4 class="text-lg font-medium text-gray-700">How to Activate</h4><ol class="list-decimal list-inside text-sm text-gray-600 mt-2 space-y-2"><li>Copy your unique Hardware ID from above.</li><li>Email the Hardware ID to <a href="mailto:your-email@example.com" class="text-blue-600 hover:underline">your-email@example.com</a> to purchase a license.</li><li>You will receive a `license.key` file back.</li><li>Place the `license.key` file in the same folder as the `POSPal.exe` application.</li><li>Restart the POSPal application to activate the full version.</li></ol></div>
```
- Same license block also appears in:
```275:278:POSPal.html
<div class="border-t border-gray-300 pt-4"><h4 class="text-lg font-medium text-gray-700">How to Activate</h4><ol class="list-decimal list-inside text-sm text-gray-600 mt-2 space-y-2"><li>Copy your unique Hardware ID from above.</li><li>Email the Hardware ID to <a href="mailto:your-email@example.com" class="text-blue-600 hover:underline">your-email@example.com</a> to purchase a license.</li><li>You will receive a `license.key` file back.</li><li>Place the `license.key` file in the same folder as the `POSPal.exe` application.</li><li>Restart the POSPal application to activate the full version.</li></ol></div>
```
```386:387:POSPalDesktop.html
<div class="border-t border-gray-300 pt-4"><h4 class="text-lg font-medium text-gray-700">Your Hardware ID</h4>...
<div class="border-t border-gray-300 pt-4"><h4 class="text-lg font-medium text-gray-700">How to Activate</h4><ol class="list-decimal ..."><li>Copy your unique Hardware ID from above.</li><li>Email the Hardware ID to <a href="mailto:your-email@example.com" ...>your-email@example.com</a> ...
```
- Trial/license enforcement in backend:
```1093:1113:app.py
def check_trial_status():
    """Check trial status with tamper protection"""
    # License check (highest priority)
    if os.path.exists(LICENSE_FILE):
        try:
            with open(LICENSE_FILE) as f:
                license = json.load(f)
            # Validate signature
            data = f"{license['hardware_id']}{APP_SECRET_KEY}".encode()
            if hashlib.sha256(data).hexdigest() == license['signature']:
                # Validate hardware using enhanced fingerprint
                current_hw_id = get_enhanced_hardware_id()
                if current_hw_id == license['hardware_id']:
                    return {"licensed": True, "active": True}
        except:
            app.logger.warning("Invalid license file")
```

#### Quick content strategy (draft copy)
- Website CTA replacement:
  - “Book Setup” → “Find a Distributor”
  - New section “Authorized Distributors” listing partners and a short “How it works” blurb.
- App License modal copy:
  - “How to Activate”:
    - 1) Copy your Hardware ID.
    - 2) Contact an authorized distributor to purchase a license.
    - 3) You’ll receive a `license.key`.
    - 4) Place `license.key` next to `POSPal.exe` and restart.
  - Add: “Find a distributor: pospal.site/#distributors” (or your actual domain).

#### Licensing hardening (high-level)
- Remove `generate_license.py` from the public distribution, keep it in a private repo or a private admin tool.
- Rotate `APP_SECRET_KEY`, switch to ECDSA:
  - Admin tool signs `{hardware_id, product, expiry?}`; app verifies with embedded public key.
  - Optional: embed distributor ID in the license payload.
- Optionally add an `/api/upload_license` endpoint and an in-app “Upload license” button to avoid manual file placement.

#### Contracts and IP
- EULA: end-user license with restrictions (no reverse engineering, no redistribution), license term, warranty/liability.
- Distributor Agreement: territory, pricing/discounts, responsibilities (install/setup), marketing, support boundaries, payment terms, license ordering process, and IP ownership clauses.
- Copyright/Notice: add to app About/footers; add COPYRIGHT file; consider replacing the “MIT” badge in `README.txt` if you’re moving to a proprietary license or dual-licensing.

#### Questions to align before I implement
1) What’s your public brand name, company/legal entity name, and website domain for links/footers?
2) How do you want the distributor directory managed (static list for now vs. a small JSON file we can update and publish)?
3) Do you want an in-app “Upload license.key” button now?
4) Are you okay moving to ECDSA-signed licenses and rotating the current secret?
5) Target languages/currency (just EN/EUR for now)?


