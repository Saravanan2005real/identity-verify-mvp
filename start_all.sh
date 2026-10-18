#!/bin/bash
# =====================================================================
#             VERIFYYY - START ALL SERVICES (LINUX/MACOS)
# =====================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "====================================================================="
echo "                VERIFYYY - STARTING ALL SERVICES"
echo "====================================================================="

# 1. OCR Engine (Port 5001)
echo "[1/4] Starting AI OCR Engine on Port 5001..."
(
    cd products/ocr_engine
    if [ -d ".venv" ]; then
        source .venv/bin/activate
    fi
    python3 engine.py
) &
PID_OCR=$!

sleep 3

# 2. Products Gateway (Port 5174)
echo "[2/4] Starting Products Gateway on Port 5174..."
(
    python3 products/serve_5174.py
) &
PID_GW=$!

sleep 2

# 3. Client Admin Portal (Port 8082)
echo "[3/4] Starting Client Admin Portal on Port 8082..."
(
    cd admin/frontend
    npx expo start --web --port 8082
) &
PID_ADMIN=$!

sleep 2

# 4. Superadmin Portal (Port 8081)
echo "[4/4] Starting Superadmin Portal on Port 8081..."
(
    cd superadmin/frontend
    npx expo start --web --port 8081
) &
PID_SUPERADMIN=$!

echo ""
echo "====================================================================="
echo "All Verifyyy services started!"
echo "- Client Admin Portal:       http://localhost:8082"
echo "- Superadmin Portal:         http://localhost:8081"
echo "- Gateway & Verification UI: http://localhost:5174/verify.html"
echo "- AI OCR & Biometrics API:   http://localhost:5001"
echo "====================================================================="
echo "Press Ctrl+C to terminate all services."

trap "kill $PID_OCR $PID_GW $PID_ADMIN $PID_SUPERADMIN; exit" INT TERM
wait
