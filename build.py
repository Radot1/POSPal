import PyInstaller.__main__

PyInstaller.__main__.run([
    'app.py',
    '--onefile',
    '--noconsole',
    '--add-data', 'POSPal.html;.',
    '--name', 'POSPal',
    '--icon', 'app_icon.ico'
])