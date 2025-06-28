import PyInstaller.__main__
import os
import shutil

# Clean previous builds
if os.path.exists('dist'):
    shutil.rmtree('dist')
if os.path.exists('build'):
    shutil.rmtree('build')

PyInstaller.__main__.run([
    'app.py',
    '--onefile',
    '--noconsole',
    '--add-data', 'POSPal.html;.',
    '--name', 'POSPal',
    '--icon', 'app_icon.ico'
])