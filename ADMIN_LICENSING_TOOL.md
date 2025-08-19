# POSPal Licensing Tool (Private)

This public repository does not contain the license generation tool.

Licensing flow (reseller model):
- Distributors collect the customer’s Hardware ID from the app (Management → License → Copy Hardware ID).
- The private licensing tool (kept in a private repository) creates a `license.key` bound to that Hardware ID.
- Distributor delivers `license.key` to the customer to place next to `POSPal.exe`.

Notes:
- Keep any signing secrets/private keys in the private repo only.
- Do not publish or embed secrets in public code.
- License file format (baseline):
```json
{
  "customer": "ACME Test Customer",
  "hardware_id": "0123ABCDEF456789",
  "signature": "<hex sha256 signature>"
}
```
- The application validates the signature locally. For improved security later, consider switching to asymmetric signing (private sign, public verify).
