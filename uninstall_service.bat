@echo off
sc stop POSPalService
sc delete POSPalService
del POSPal.exe
del config.json