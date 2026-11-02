@echo off
chcp 65001 >nul
title Cap nhat Web HTTPS co dinh (GitHub Pages)
cd /d "%~dp0"
echo Dang dong goi va cap nhat len https://hducduy2006-hub.github.io/transflow/ ...
python "%~dp0cap_nhat_web_https.py"
echo.
pause
