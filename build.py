import PyInstaller.__main__
import shutil
import os

# Clean previous builds
build_dir = 'build'
dist_dir = 'dist'
if os.path.exists(build_dir):
    shutil.rmtree(build_dir)
if os.path.exists(dist_dir):
    shutil.rmtree(dist_dir)

# Build executable
PyInstaller.__main__.run([
    'app.py',
    '--onefile',
    '--noconsole',
    '--add-data', 'POSPal.html;.',
    '--name', 'POSPal',
    '--icon', 'app_icon.ico'
])

# Verify build
if not os.path.exists(os.path.join(dist_dir, 'POSPal.exe')):
    raise RuntimeError("Build failed - no executable generated")