@echo off
sc create POSPalService binPath= "%cd%\POSPal.exe" start= auto
sc description POSPalService "POSPal Restaurant Order System"
sc start POSPalService