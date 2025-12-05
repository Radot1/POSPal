"""
Embedded secrets shipped with the packaged POSPal build.

These values are only consumed inside the executable to ensure
end users never have to copy/paste tokens or see them in the UI.
"""

from __future__ import annotations

import base64

_EMBEDDED_CF_TOKEN_B64 = "Y2ZfbWVudV8yN2Q3NTQ5MTM2N2U5YjI2ODBmMDI3MGZkZDgyZTM0MzNkYzBkNjJjN2RjOGMxMmRkZDU1MzkwNmQxZTU0ZmQ3"

# Decode at import time so the plain token never lives in config files or UI state
EMBEDDED_CLOUDFLARE_TOKEN = base64.b64decode(_EMBEDDED_CF_TOKEN_B64).decode('utf-8')

__all__ = ["EMBEDDED_CLOUDFLARE_TOKEN"]
