"""
PyInstaller hook for limits package
Prevents asyncio-related imports that cause issues with PyInstaller
"""
from PyInstaller.utils.hooks import collect_submodules

# Import only the synchronous parts of limits, exclude async
hiddenimports = [
    'limits.storage',
    'limits.storage.memory',
    'limits.strategies',
    'limits.util',
]

# Explicitly exclude async modules
excludedimports = [
    'limits.aio',
    'limits.aio.storage',
    'limits.aio.storage.memcached',
    'limits.aio.storage.redis',
]
