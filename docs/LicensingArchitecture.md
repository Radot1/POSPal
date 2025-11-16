# Licensing Architecture

This document summarizes the current licensing system so anyone can reason about
backend data, frontend state, and trial enforcement without digging through the
codebase.

## 1. Canonical License State Model

`/api/license/status` and `/api/trial_status` always include a `license_state`
string. The frontend consumes only this field when deciding what to show.

| State                          | Meaning / Source                                                      | Frontend Behaviour                                               |
|--------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------|
| `licensed_active`              | Cloudflare validated Stripe subscription / server_license.enc valid    | Green badge, subscription grid + stats, single portal button     |
| `licensed_grace`               | Cached server license + within offline grace window                    | Amber badge, grace strip, buttons enabled but show reconnect hint|
| `licensed_renewal_required`    | Stripe subscription `past_due`/`unpaid`/`manual`                       | Orange badge, renewal CTA, portal + checkout available           |
| `licensed_cancelled`           | Stripe subscription cancelled/terminated                               | Red badge, “Reactivate” CTA, portal shown for billing history    |
| `trial_active`                 | Remote trial registry says days remaining > 0                          | Blue trial card, “Subscribe now” CTA, portal hidden              |
| `trial_expired`                | Remote trial registry expired (or 30 days elapsed offline)             | Red “Trial expired” card, checkout CTA, printing/orders disabled |
| `license_missing`              | No server license and no trial record anywhere                         | Grey “No license” card, unlock + subscribe buttons               |
| `license_error` / `unknown`    | Worker/app failure, remote tamper flag, or other unrecoverable error   | Neutral badge, toast + retry guidance, portal hidden             |

All other payload data (`subscription_status`, `days_left`, `next_billing_date`)
is just UI metadata—it never drives logic directly anymore.

## 2. Frontend State Machine (POSPal Desktop)

- `FrontendLicenseManager.processServerLicenseStatus()` inspects `license_state`
  and delegates to helpers in `StatusDisplayManager` (badge text, cards,
  buttons, footer).
- Portal buttons: `showPortalButtons({ showManageButton })` now supports
  hiding the secondary “Manage Subscription” button so fully licensed installs
  only get the quick access CTA.
- Subscription stats (next payment, price, renewal countdown) are populated via
  `applyServerBillingDetails()` using the latest `/api/license/status` payload.
- Existing offline/grace strip remains unchanged; the only change is that the
  card now matches the same state string.

## 3. Remote Trial Enforcement (Cloudflare Worker)

### Worker Schema (`trial_devices` table)

```
CREATE TABLE trial_devices (
    hardware_hash TEXT PRIMARY KEY,
    hardware_last4 TEXT,
    first_run TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT DEFAULT 'active',   -- active | expired | blocked
    tamper_flag INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_ip TEXT,
    metadata TEXT
);
```

### Endpoints

| Endpoint          | Payload / Query                               | Behaviour |
|-------------------|-----------------------------------------------|-----------|
| `POST /trial/register` | `{ hardwareId, firstRunDate, appVersion, hostname, platform }` | Hashes hardware ID (with salt), creates or updates a record, returns canonical `firstRunDate/expiresAt/daysLeft/tamperFlag`. |
| `POST /trial/status` or `GET /trial/status?hardwareId=…` | Same body or query params as above | Returns the authoritative state. If no record exists, it creates one using the supplied `firstRunDate`. |

Tamper detection:

- If the device ever reports a later `firstRunDate` than the worker already
  stored, it sets `tamper_flag=1`.
- Status `expired` or `blocked` forces `daysLeft=0` so apps can’t re-enable
  printing/orders by wiping local files.

### Worker Configuration

- `TRIAL_DURATION_DAYS` env var keeps the worker/app aligned (default 30).
- Optional `TRIAL_HW_SALT` secret can be set to obfuscate raw hardware IDs.

## 4. Desktop App Workflow Changes (`app.py`)

1. **Initialization**  
   `initialize_trial()` gathers any local signatures (app folder + ProgramData)
   and, if remote sync is enabled (`POSPAL_ENABLE_REMOTE_TRIAL_SYNC=true`), calls
   `/trial/register`. The earliest date wins (remote > local). The resulting
   date is written back to both local files with a SHA-256 signature.

2. **Status Snapshot**  
   `_calculate_trial_snapshot()` now calls `/trial/status` using the cached
   hardware ID. The worker response overrides local `days_left/expired` if it’s
   stricter.

3. **Helper Functions**  
   - `_get_trial_hardware_id()` reuses the enhanced hardware fingerprint.
   - `_register_trial_with_cloud()` / `_fetch_remote_trial_status()` handle the
     Worker calls via the existing `call_cloudflare_api()` helper.
   - `_generate_trial_signature()` centralizes the signed JSON format, so files
     can’t be hand-edited without the app secret key.

4. **Feature Flags & Offline Behaviour**  
   - Environment overrides: `POSPAL_ENABLE_REMOTE_TRIAL_SYNC=false` allows QA to
     run without touching the worker; `TRIAL_REGISTER_ENDPOINT`/`TRIAL_STATUS_ENDPOINT`
     fall back to `/trial/register` and `/trial/status`.
   - If the worker can’t be reached, the app continues to use the last known
     local record. As soon as connectivity is restored, the remote record
     wins (preventing permanent resets).

## 5. Deployment Checklist

1. Deploy the new D1 schema/migration (`cloudflare-licensing/add-trial-devices-table.sql`
   or the updated `complete-schema.sql`).
2. Update `wrangler.toml` for each environment (`TRIAL_DURATION_DAYS`,
   optional `TRIAL_HW_SALT` secret).
3. Redeploy the worker (`wrangler deploy`) so `/trial/register` and
   `/trial/status` go live.
4. Redeploy the desktop app (ensuring the new environment variables are in `.env`
   / release configuration).
5. Rebuild frontend assets (the new license state UI is already part of
   `pospalCore.js`—no extra steps needed).

## 6. Supporting & Troubleshooting

- **Force-expire or extend a trial**: update `trial_devices.status` or
  `expires_at` in D1 (e.g., set `status='blocked'` to forbid launches).
- **Diagnose tamper flags**: `tamper_flag=1` means the device tried to advance
  the start date. Support can review `last_ip/metadata` to confirm.
- **Backend logging**: look for `Trial registry enforced start date` /
  `Remote trial registry adjusted first run` entries in `pospal_debug.log`.
- **Temporary bypass**: set `POSPAL_ENABLE_REMOTE_TRIAL_SYNC=false` before
  launching the app (useful in lab environments where the worker is unavailable).

With these pieces in place, licensing behaviour is predictable, UIs remain
in sync with backend truth, and a reinstall can no longer reset the free trial
window.
