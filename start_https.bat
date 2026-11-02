@echo off
chcp 65001 >nul
title TransFlow — May chu HTTPS Chia Se Cong Khai
cd /d "%~dp0"

echo ==============================================================
echo   TRANSFLOW — KHOI DONG DUONG LINK HTTPS CHIA SE CONG KHAI
echo ==============================================================
echo.

:: Khoi dong local web server ngam neu chua chay
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue)) { Start-Process python -ArgumentList '-m http.server 8765 --bind 127.0.0.1 --directory web' -WindowStyle Hidden }"

timeout /t 2 /nobreak >nul

echo Dang tao chung chi SSL HTTPS chinh hang qua Cloudflare...
echo Hay copy duong link https://....trycloudflare.com hien ra ben duoi de mo hoac gui cho moi nguoi!
echo.
"%~dp0tools\cloudflared.exe" tunnel --url http://127.0.0.1:8765
pause
