# Verification Products & Gateway (`products/`)

The `products/` directory houses the interactive applicant verification clients, demo applications, and the central Products Gateway reverse proxy server.

---

## Architecture & Gateway Routing

The **Products Gateway** runs on port **5174** and provides two primary functions:
1. **Static Web Serving**: Delivers HTML5, CSS, and vanilla JavaScript client applications directly to desktop and mobile browsers.
2. **Reverse Proxying**: Unifies routing and enforces Cross-Origin Resource Sharing (CORS) by proxying:
   - `/api/v1/*` → Forwarded to **AI OCR & Biometrics Engine** (`http://127.0.0.1:5001/api/v1/*`)
   - `/api/v1/eye/*` → Forwarded to **Eye Tracking Engine** (`http://127.0.0.1:5002/api/v1/eye/*`)

The gateway can be executed in two ways:
- **Python Standalone Gateway**: `python products/serve_5174.py` (Zero external dependencies; built-in HTTP server with reverse-proxy handler).
- **Production Nginx Gateway**: `products/nginx.conf` (Used in Docker and Linux production environments).

---

## Client Applications & Pages

| File | Port / Path | Description |
| :--- | :--- | :--- |
| **`verify.html` / `verify.js`** | `http://localhost:5174/verify.html` | **Verifyyy Dynamic Flow Runner**: The primary applicant onboarding client. Dynamically reads pipeline tokens and executes verification steps (`AADHAAR_FACE`, `PAN_FACE`, `EYE_TRACKING`, etc.) with responsive camera guides and progress indicators. |
| **`signin.html` / `signin.js`** | `http://localhost:5174/signin.html` | Standalone client portal sign-in page with modern UI and Supabase authentication. |
| **`demo_ocr_face.html`** | `http://localhost:5174/demo_ocr_face.html` | Standalone Document OCR and Live Webcam Face Match testing interface. |
| **`demo_eye_tracking.html`** | `http://localhost:5174/demo_eye_tracking.html` | 9-point WebGazer eye calibration and real-time gaze attention tracking interface. |
| **`demo_audio_liveness.html`** | `http://localhost:5174/demo_audio_liveness.html` | Voice waveform analysis and interactive speech challenge-response verification demo. |
| **`webgazer.js`** | `/webgazer.js` | Precompiled browser-based eye gaze tracking library. |
| **`style.css`** | `/style.css` | Design system styling (Teal / Slate responsive layout). |

---

## Quick Start

### 1. Launch Gateway Server (Port 5174)
From the project root:
```bash
python products/serve_5174.py
```

### 2. Access Applicant Verification Flow
Open your browser to:
- Standard flow: **`http://localhost:5174/verify.html`**
- Custom parameterized pipeline: **`http://localhost:5174/verify.html?pid=FLOW-001&flow=PAN_FACE,EYE_TRACKING`**
