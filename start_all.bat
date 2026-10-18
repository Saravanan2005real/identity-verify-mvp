@echo off
TITLE Verifyyy Platform Launcher
echo =====================================================================
echo                VERIFYYY - STARTING ALL SERVICES (LOCAL)
echo =====================================================================
echo.

set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

echo [1/4] Starting AI OCR Engine on Port 5001...
start "Verifyyy - AI OCR Engine (5001)" cmd /k "cd /d products\ocr_engine && if exist .venv\Scripts\activate.bat (call .venv\Scripts\activate.bat) && python engine.py"

timeout /t 3 /nobreak >nul

echo [2/4] Starting Products Gateway on Port 5174...
start "Verifyyy - Products Gateway (5174)" cmd /k "python products\serve_5174.py"

timeout /t 2 /nobreak >nul

echo [3/4] Starting Client Admin Portal on Port 8082...
start "Verifyyy - Client Admin (8082)" cmd /k "cd /d admin\frontend && npx expo start --web --port 8082"

timeout /t 2 /nobreak >nul

echo [4/4] Starting Superadmin Portal on Port 8081...
start "Verifyyy - Superadmin (8081)" cmd /k "cd /d superadmin\frontend && npx expo start --web --port 8081"

echo.
echo =====================================================================
echo All services launched in separate windows!
echo - Client Admin Portal:       http://localhost:8082
echo - Superadmin Portal:         http://localhost:8081
echo - Gateway & Verification UI: http://localhost:5174/verify.html
echo - AI OCR & Biometrics API:   http://localhost:5001
echo =====================================================================
pause
