# PyInstaller flask-limiter Fix

## Problem
When building POSPal with PyInstaller, the executable crashed on startup with:
```
ImportError: cannot import name 'aio' from partially initialized module 'limits'
```

This occurred because flask-limiter's dependency `limits` package tried to import its async module (`limits.aio`), which in turn imported `asyncio.windows_events` and `asyncio.windows_utils`. These asyncio modules cause a circular import error when frozen by PyInstaller.

## Solution
Implemented a runtime mock of the `limits.aio` module that prevents the circular import while maintaining rate limiting functionality.

### Changes Made

#### 1. app.py (lines 1541-1560)
Added code before flask_limiter import that:
- Detects if running in a PyInstaller frozen environment using `sys.frozen`
- Creates mock modules for `limits.aio` and `limits.aio.storage`
- Injects these mocks into `sys.modules` before flask_limiter is imported
- Only runs when frozen (doesn't affect development mode)

#### 2. build.bat (lines 121, 131-132, 168, 178-179)
Updated PyInstaller build commands:
- Added `--additional-hooks-dir=..\.` to use the hook-limits.py file
- Added `--hidden-import limits.storage.memory` and `--hidden-import limits.strategies` to ensure synchronous rate limiting components are included
- Removed `--exclude-module limits.aio` flags (no longer needed with mock approach)
- Kept `--exclude-module asyncio.windows_events` and `--exclude-module asyncio.windows_utils` to prevent asyncio issues

## How It Works

### Runtime Detection
```python
if getattr(sys, 'frozen', False):
    # We're running in a PyInstaller bundle
```

### Module Mocking
The fix creates empty mock modules and injects them into `sys.modules` before flask_limiter tries to import them:
```python
mock_aio = ModuleType('limits.aio')
mock_aio.__path__ = []
sys.modules['limits.aio'] = mock_aio
```

### Fallback Behavior
Flask-limiter automatically falls back to synchronous rate limiting when async components are unavailable. Since POSPal only uses basic in-memory rate limiting (no Redis, no async features), this fallback works perfectly.

## Testing

### Development Mode
- The mock code doesn't run (`sys.frozen` is False)
- Normal imports work as expected
- All development functionality preserved

### Production Mode (PyInstaller)
- Mock modules prevent circular import
- Flask-limiter imports successfully
- Rate limiting works with synchronous storage backend

## Rate Limiting Still Works
POSPal uses basic rate limiting configuration:
```python
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"]
)
```

This configuration uses in-memory storage and doesn't require async functionality, so it works perfectly with the mock approach.

## Build Instructions
1. Run `build.bat` as normal
2. The fix is automatically applied during both development and production
3. No manual intervention required

## Compatibility
- Works with PyInstaller's `--onefile` and `--onedir` modes
- Compatible with Windows (tested on Windows 10/11)
- Maintains backward compatibility with existing POSPal functionality
- No impact on CMD window suppression or other Windows integrations

## Technical Notes
- The `hook-limits.py` file provides additional guidance to PyInstaller about which modules to include/exclude
- Asyncio modules are excluded at build time to prevent size bloat and potential conflicts
- The mock approach is cleaner than patching flask-limiter source code
- Future flask-limiter updates should work without modification (as long as they maintain fallback behavior)
