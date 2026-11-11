# Verifyyy — Enterprise eKYC & Digital Identity Verification Platform

[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Flask 3.0+](https://img.shields.io/badge/Flask-3.0+-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![React Native Web](https://img.shields.io/badge/React_Native_Web-0.21+-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://necolas.github.io/react-native-web/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.10+-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)](https://opencv.org)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-SFace_128D-005CED?style=for-the-badge&logo=onnx&logoColor=white)](https://onnxruntime.ai/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_RLS-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Docker Ready](https://img.shields.io/badge/Docker-Compose_Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## Table of Contents

1. [Executive Overview](#executive-overview)
2. [Key Innovations & Technical Capabilities](#key-innovations--technical-capabilities)
3. [System Architecture & Visual Diagrams](#system-architecture--visual-diagrams)
4. [Microservices & Port Matrix](#microservices--port-matrix)
5. [Security & Cryptographic Architecture (Phase 1 Remediation)](#security--cryptographic-architecture-phase-1-remediation)
6. [Repository Structure](#repository-structure)
7. [Environment Configuration & Secrets](#environment-configuration--secrets)
8. [Quick Start & Execution Guide](#quick-start--execution-guide)
   - [Option A: Local Bare-Metal (Recommended for Development)](#option-a-local-bare-metal-recommended-for-development)
   - [Option B: Containerized Deployment (Docker Compose)](#option-b-containerized-deployment-docker-compose)
9. [Verification Flow Runner & Dynamic Pipelines](#verification-flow-runner--dynamic-pipelines)
10. [Comprehensive API Reference](#comprehensive-api-reference)
11. [Testing & Quality Assurance Suite](#testing--quality-assurance-suite)
12. [Troubleshooting & Common Questions](#troubleshooting--common-questions)
13. [License](#license)

---

## Executive Overview

**Verifyyy** is an enterprise-grade Electronic Know Your Customer (**eKYC**) and digital identity verification platform. Engineered with a modular microservice architecture, it combines state-of-the-art computer vision (PaddleOCR, RetinaFace 5-point alignment, SFace ONNX 128-D neural network, ArcFace 512-D), real-time camera liveness detection, browser-based eye gaze tracking (WebGazer & FGI-Net), a no-code verification pipeline builder for enterprise clients, and centralized superadmin governance with cloud database synchronization.

### Core Problems Solved

1. **Geometric Facial Distortion on ID Documents**: Standard perspective rectification algorithms stretch or compress card faces during document planar warping. Verifyyy solves this by computing **unwarped coordinate re-projection** from raw, untouched camera frames, preserving natural facial aspect ratios.
2. **Rigid Verification Workflows**: Enterprises require differing risk tiers—from simple document OCR to multi-modal biometric liveness with human auditor review. Verifyyy provides a **visual drag-and-drop pipeline builder** that dynamically generates tokenized, tamper-resistant onboarding links.
3. **Resilient Cloud & Air-Gapped Boundaries**: The platform operates seamlessly with **Supabase PostgreSQL** in the cloud (with strict Row-Level Security), while providing zero-downtime local fallbacks (SQLite and in-memory caches) for offline or air-gapped environments.
4. **Hardened Multi-Tenant Security**: Zero-trust session tokens, tenant-scoped HMAC signed URLs, fail-fast startup secret validation, and cryptographic PII masking protect applicant data from inception to archival.

---

## Key Innovations & Technical Capabilities

### 🪪 Universal Document Classification & Dual-Pass OCR
* **Automatic Document Detection**: Identifies and classifies **Aadhaar Cards** (UIDAI 12-digit format), **PAN Cards** (10-character alphanumeric income tax identifiers), **Driving Licenses**, and **Voter IDs**.
* **Dual-Pass Extraction Pipeline**: Combines high-resolution quadrilateral contour warping, CLAHE illumination normalization, and dual-pass PaddleOCR extraction with algorithmic fuzzy error correction.
* **Image Quality Pre-Check (`quality.py`)**: Rejects illegible images before inference by measuring Laplacian variance blur, specular glare thresholds, contrast histograms, and ambient illumination.

### 👤 Three-Tier Cascaded Face Recognition
* **Zero-Distortion Landmark Cropping**: Uses RetinaFace 5-point landmark detection directly on original, unwarped frames to crop reference faces without perspective compression.
* **Tier 1 — SFace 128-D ONNX Neural Net**: Ultra-lightweight OpenCV DNN model (`sface.onnx` via `cv2.FaceRecognizerSF`) computing 128-dimensional facial embeddings and cosine distance similarity in under 15ms.
* **Tier 2 — ArcFace 512-D Verification**: High-dimensional angular margin loss feature projection with adaptive threshold relaxation (0.75) tailored for degraded, laminated, or aged government ID photos.
* **Tier 3 — OpenCV Fallback**: Histogram equalization, normalized 2D cross-correlation, and ORB feature descriptor matching for zero-dependency execution.

### 👁️ Biometric Liveness & Attention Tracking
* **Interactive Gaze Calibration**: 9-point target calibration via WebGazer and deep FGI-Net gaze vector tracking.
* **Active Anti-Spoofing & Attention**: Confirms applicant presence by tracking gaze trajectories across screen quadrants, verifying camera focus, and preventing replay attacks.
* **Audio Waveform Challenge**: Optional speech challenge-response verification for multi-modal liveness.

### ⚡ Visual Pipeline Builder & Dynamic Stepper
* **No-Code Flow Customization**: Tenant administrators configure custom verification sequences (e.g., `PAN_FACE,EYE_TRACKING,HUMAN_REVIEW`) via an Expo web interface.
* **Cryptographically Bound Links**: Instant shareable onboarding URLs containing encrypted workflow steps, session nonces, and tenant scopes.
* **Pure HTML5/JS Flow Runner**: Dynamic client stepper (`verify.html` / `verify.js`) requiring no bulky frontend frameworks, loading in milliseconds on any mobile or desktop browser.

---

## System Architecture & Visual Diagrams

The platform is designed around loosely coupled microservices communicating via secure HTTP APIs and synchronized with Supabase PostgreSQL:

```
                               ┌──────────────────────────────────────────────────────────┐
                               │                    Client Browser                        │
                               │  (Applicant Flow / Admin Portal / Superadmin Portal)     │
                               └────────────────────────────┬─────────────────────────────┘
                                                            │
                                  Reverse Proxy & Static    │  HTTP (CORS Enforced)
                                  Gateway (Port 5174)       │
                               ┌────────────────────────────▼─────────────────────────────┐
                               │       Products Gateway (serve_5174.py / Nginx)           │
                               │     Serves HTML5/JS clients & proxies backend routes     │
                               └──────────────┬────────────────────────────┬──────────────┘
                                              │                            │
                     /api/v1/* (OCR & Face)   │                            │  /api/v1/eye/*
                                              │                            │
              ┌───────────────────────────────▼────────┐   ┌───────────────▼──────────────────────────┐
              │     AI OCR & Biometrics Engine         │   │   Eye Tracking & Gaze Service            │
              │  Flask Microservice (Port 5001)        │   │   FastAPI Service (Port 5002)            │
              │  - PaddleOCR + Perspective Correction  │   │   - FGI-Net Gaze Estimation              │
              │  - RetinaFace Landmark Alignment       │   │   - 9-Point Calibration Grid             │
              │  - SFace 128-D ONNX / ArcFace 512-D    │   │   - Head Pose & Attention Heatmaps       │
              │  - auth_validator Security Engine      │   └──────────────────────────────────────────┘
              └───────────────────────┬────────────────┘
                                      │
                                      │ Cloud Sync & RLS / SQLite Fallback
                                      │
              ┌───────────────────────▼────────────────┐   ┌──────────────────────────────────────────┐
              │      Supabase PostgreSQL Database      │◄──┤      Superadmin Backend API              │
              │  - Multi-Tenant Row Level Security     │   │   FastAPI Service (Port 8000)            │
              │  - verifications Table + Audit Logs    │   │   - B2B Tenant Governance                │
              │  - revoked_applicant_tokens Table      │   │   - Service Catalog & Licensing          │
              └────────────────────────────────────────┘   │   - SQLite (superadmin.db) Fallback      │
                                                           └──────────────────────────────────────────┘
```

### Visual Architecture SVG References
Detailed vector architecture diagrams are included directly in the repository root:
* [High-Level Architecture](architecture_diagram.svg): End-to-end component overview and data flows.
* [Verification Sequence](diagram_2_sequence.svg): Step-by-step sequence diagram from link generation to final verdict.
* [Dynamic Pipeline Builder](diagram_3_pipeline_builder.svg): Client admin recipe creation and applicant execution.
* [Face Match Decision Flow](diagram_4_face_match_decision.svg): Cascade decision logic across SFace, ArcFace, and OpenCV.
* [Liveness & Anti-Spoofing](diagram_5_liveness_antispoof.svg): Multi-modal gaze and attention verification pipeline.
* [Supabase Entity-Relationship Model](diagram_6_supabase_er.svg): Database schema, foreign keys, and RLS security boundaries.

---

## Microservices & Port Matrix

| Service | Port / URL | Technology | Documented Entry Point | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Products Gateway** | `http://localhost:5174` | Python / Nginx | `python products/serve_5174.py` | Unified gateway proxy and static client host |
| **Verification Flow Runner** | `http://localhost:5174/verify.html` | HTML5 / JavaScript | Parameterized: `?pid=...&flow=...` | Interactive applicant document & selfie verification stepper |
| **AI OCR & Biometrics Engine** | `http://localhost:5001` | Flask / OpenCV / ONNX | `cd products/ocr_engine && python engine.py` | Core computer vision, dual-pass OCR, and face matching |
| **Eye Tracking Module** | `http://localhost:5002` | FastAPI / FGI-Net | `cd products/eye_tracking_module && python main.py` | Gaze vector analysis, calibration, and attention verification |
| **Superadmin Backend API** | `http://localhost:8000` | FastAPI / SQLAlchemy | `cd superadmin/backend && uvicorn main:app --port 8000` | Multi-tenant governance API, B2B services, and stats |
| **Superadmin Web Portal** | `http://localhost:8081` | React Native Web / Expo | `cd superadmin/frontend && npx expo start --web --port 8081` | Superadmin master control dashboard |
| **Client Admin Web Portal** | `http://localhost:8082` | React Native Web / Expo | `cd admin/frontend && npx expo start --web --port 8082` | Tenant admin portal, visual pipeline builder, audit queue |

---

## Security & Cryptographic Architecture (Phase 1 Remediation)

The platform adheres to zero-trust principles and implements the following security controls:

### 1. Fail-Fast Startup Secret & Production Guards (`validate_startup_secrets`, `validate_production_config`)
Both `products/ocr_engine/engine.py` and `superadmin/backend/main.py` execute `validate_startup_secrets()` upon application boot.
* Requires `APPLICANT_SESSION_SECRET` and `ASSET_SIGNING_SECRET` to be present and non-empty.
* Enforces minimum cryptographic strength: **>= 32 characters** (128-bit entropy minimum, 256-bit recommended).
* Rejects placeholder or unconfigured Supabase credentials.
* **Production Config Guards (`APP_ENV=production`)**:
  - `validate_production_config()` enforces `REVOCATION_BACKEND=supabase` (disallowing in-memory revocation in prod).
  - Enforces `ALLOW_LOCAL_FALLBACK=false` — `local_fallback_allowed()` prevents silent dev SQLite or unconfigured Supabase fallbacks.
  - Enforces explicit, HTTPS-only, non-wildcard, non-localhost CORS origins (`ALLOWED_CORS_ORIGINS`).
  - Verifies non-placeholder `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
* **Fail-Closed**: If any secret or production guard requirement fails, the process immediately raises `RuntimeError` and terminates.

### 2. Cryptographically Bound Applicant Session Tokens
* **HMAC-SHA256 Signatures**: Applicant tokens are signed with `APPLICANT_SESSION_SECRET` to prevent tampering.
* **Step-Gating Enforcement**: Allowed workflow steps are explicitly baked into the signed token claims (e.g., `['PAN_FACE', 'EYE_TRACKING']`). An applicant assigned to Aadhaar OCR cannot invoke PAN extraction.
* **Cryptographic Nonce**: Every token includes a 16-byte random hex nonce (`secrets.token_hex(16)`) to prevent replay attacks.
* **Tenant Isolation**: Tokens are strictly scoped to the issuing `tenant_id`. Cross-tenant replay is cryptographically impossible.

### 3. Tenant-Scoped HMAC Signed Asset URLs
Applicant document crops and selfies are stored privately and never served via static endpoints:
* Access requires an HMAC-SHA256 signed URL: `/ocr_uploads/<filename>?expires=<ts>&sig=<hex>&tid=<tenant_id>&op=<operation>`.
* The signature binds the filename, tenant ID, expiry timestamp, and permitted operation (`read` / `write`).
* URLs generated for Tenant A cannot be used by Tenant B, even if the filename is known.

### 4. Dual-Mode Token Revocation Engine
* **In-Memory Mode (`REVOCATION_BACKEND=memory`)**: High-performance local hash registry for single-instance development.
* **Supabase Mode (`REVOCATION_BACKEND=supabase`)**: Persistent revocation backed by the `revoked_applicant_tokens` PostgreSQL table, ensuring revocation survives service restarts and cluster scaling.
* **Expiry-First Evaluation**: Expired tokens fail immediately without querying the revocation database, preventing resource exhaustion.

### 5. PII Masking & Data Sanitization
* **Aadhaar Numbers**: Automatically redacted as `XXXX-XXXX-LAST4` across API responses and database tables.
* **PAN Numbers**: Automatically redacted as `ABCDE****F`, preserving only valid tax categories while masking identity digits.
* **Strict Git Exclusion**: All uploaded identity files, face crops, `.env` files, and local databases are ignored by `.gitignore` and `.dockerignore`.

---

## Repository Structure

```
identity-verify-mvp/
├── .env.example                     # Environment template with security instructions
├── .dockerignore                    # Root Docker build exclusion rules
├── .gitignore                       # Strict Git exclusion (PII, secrets, caches)
├── docker-compose.yml               # Containerized microservice deployment specification
├── start_all.bat                    # One-click Windows launch script (all services)
├── start_all.sh                     # One-click Linux/macOS launch script (all services)
├── supabase_schema.sql              # Hardened Supabase PostgreSQL schema with RLS
│
├── products/                        # Verification microservices & client interfaces
│   ├── ocr_engine/                  # Flask AI OCR & Biometrics Engine (Port 5001)
│   │   ├── engine.py                # Core Flask app, computer vision pipeline, endpoints
│   │   ├── auth_validator.py        # Security module: tokens, signed URLs, validation
│   │   ├── supabase_client.py       # Asynchronous Supabase PostgreSQL sync client
│   │   ├── quality.py               # Blur, glare, contrast, and illumination pre-check
│   │   ├── download_sface.py        # Model downloader for sface.onnx
│   │   ├── sface.onnx               # SFace 128-D ONNX deep neural network model
│   │   ├── Dockerfile               # Microservice container definition
│   │   └── requirements.txt         # OpenCV, PaddleOCR, Flask, DeepFace dependencies
│   ├── eye_tracking_module/         # FastAPI Gaze Estimation Service (Port 5002)
│   │   ├── main.py                  # Endpoint /estimate and uvicorn runner
│   │   ├── fgi_eye_tracker/         # FGI-Net deep gaze tracking implementation
│   │   └── requirements.txt         # FastAPI, OpenCV, PyTorch dependencies
│   ├── serve_5174.py                # Local Python gateway proxy (Port 5174)
│   ├── nginx.conf                   # Dockerized Nginx reverse proxy (Port 5174)
│   ├── verify.html / verify.js      # Dynamic multi-step applicant flow runner
│   ├── demo_ocr_face.html / .js     # Standalone OCR & face matching demo
│   └── demo_eye_tracking.html / .js # Browser-based gaze calibration demo
│
├── admin/                           # Client Tenant Portal (Port 8082)
│   └── frontend/                    # React Native Web / Expo application
│       ├── App.js                   # Visual pipeline builder, link generator, audit queue
│       └── package.json             # Expo web dependencies
│
├── superadmin/                      # Master Governance Platform (Ports 8081 & 8000)
│   ├── backend/                     # FastAPI Superadmin API (Port 8000)
│   │   ├── main.py                  # Multi-tenant API, startup validation, B2B catalog
│   │   ├── database.py              # SQLAlchemy connection (PostgreSQL / SQLite)
│   │   ├── auth_validator.py        # Superadmin authentication and membership lookup
│   │   └── routers/dashboard.py     # Analytics & tenant management router
│   └── frontend/                    # React Native Web / Expo Superadmin Portal (Port 8081)
│       └── App.js                   # Master tenant onboarding and usage analytics UI
│
├── migrations/                      # Version-controlled Supabase SQL migrations
│   ├── 20261024_000001_harden_rls_and_multi_tenancy.sql
│   └── 20261025_000002_revocation_table_and_orphan_strategy.sql
│
└── tests/                           # Security testing suite
    └── test_security_controls.py    # Automated regression suite (Unit & Integration)
```

---

## Environment Configuration & Secrets

### 1. Create Your `.env` File
Copy `.env.example` to `.env` in the repository root:

```bash
# Windows (PowerShell):
Copy-Item .env.example .env

# Windows (CMD):
copy .env.example .env

# Linux / macOS (Bash):
cp .env.example .env
```

### 2. Generate Cryptographically Secure Secrets
The platform requires two separate 256-bit hexadecimal secrets. Generate them using Python's `secrets` module:

```bash
python -c "import secrets; print('APPLICANT_SESSION_SECRET=' + secrets.token_hex(32))"
python -c "import secrets; print('ASSET_SIGNING_SECRET=' + secrets.token_hex(32))"
```

### 3. Populate `.env` Parameters

```ini
# ==============================================================================
# Supabase Cloud Configuration
# ==============================================================================
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-supabase-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
SUPABASE_TABLE=verifications

# ==============================================================================
# Application Secrets (Required at Startup — minimum 32 hex characters)
# ==============================================================================
APPLICANT_SESSION_SECRET=paste-your-generated-applicant-secret-here
ASSET_SIGNING_SECRET=paste-your-generated-asset-secret-here

# ==============================================================================
# Network & CORS Configuration
# ==============================================================================
ALLOWED_CORS_ORIGINS=http://localhost:8081,http://localhost:8082,http://localhost:5174,http://127.0.0.1:8081,http://127.0.0.1:8082,http://127.0.0.1:5174

# ==============================================================================
# Token Revocation Backend
# ==============================================================================
# Use "memory" for local development; "supabase" for production multi-instance
REVOCATION_BACKEND=memory

# ==============================================================================
# Frontend Expo Public Keys
# ==============================================================================
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-anon-or-publishable-key
```

> [!IMPORTANT]
> **Zero Insecure Defaults**: The application does **not** fall back to insecure default keys. If `APPLICANT_SESSION_SECRET` or `ASSET_SIGNING_SECRET` is missing or fewer than 32 characters, both the OCR engine and Superadmin backend will refuse to start.

---

## Quick Start & Execution Guide

### Prerequisites
* **Python**: 3.10 or higher (`python --version`)
* **Node.js**: 18.x or higher (`node -v`)
* **npm**: 9.x or higher (`npm -v`)
* *(Optional for Docker)*: Docker Desktop / Docker Engine + Docker Compose v2

---

### Option A: Local Bare-Metal (Recommended for Development)

#### Method 1: Automated One-Click Launch

* **Windows**:
  Double-click `start_all.bat` or run:
  ```cmd
  start_all.bat
  ```
  *(Spawns 4 dedicated console windows for OCR Engine 5001, Gateway 5174, Client Admin 8082, and Superadmin 8081).*

* **Linux / macOS**:
  ```bash
  chmod +x start_all.sh
  ./start_all.sh
  ```

---

#### Method 2: Manual Multi-Terminal Step-by-Step

Open **separate terminals** from the `identity-verify-mvp` root directory:

#### 🖥️ Terminal 1: AI OCR & Biometrics Engine (Port 5001)
```bash
cd products/ocr_engine

# 1. Activate virtual environment (create if needed: python -m venv .venv)
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# 2. Install dependencies (first time only)
pip install -r requirements.txt

# 3. Download SFace neural model if not present
python download_sface.py

# 4. Start the engine
python engine.py
```
> **Confirmation**: `* Starting Verifyyy AI OCR Engine on http://127.0.0.1:5001...`

#### 🌐 Terminal 2: Products Gateway Server (Port 5174)
```bash
# From repository root:
python products/serve_5174.py
```
> **Confirmation**: `Starting Gateway on http://localhost:5174 ...`  
> Open in browser: `http://localhost:5174/verify.html`

#### 🏢 Terminal 3: Client Admin Portal (Port 8082)
```bash
cd admin/frontend
npm install
npx expo start --web --port 8082
```
> Open in browser: `http://localhost:8082`

#### 👑 Terminal 4: Superadmin Platform (Ports 8081 & 8000)

* **4A: Superadmin Frontend (Port 8081)**:
  ```bash
  cd superadmin/frontend
  npm install
  npx expo start --web --port 8081
  ```
  > Open in browser: `http://localhost:8081`

* **4B: Superadmin Backend API (Port 8000)**:
  ```bash
  cd superadmin/backend
  pip install -r requirements.txt
  uvicorn main:app --reload --port 8000
  ```
  > Open Swagger Docs in browser: `http://localhost:8000/docs`

#### 👁️ Terminal 5 (Optional): Eye Tracking Gaze Service (Port 5002)
```bash
cd products/eye_tracking_module
pip install -r requirements.txt
python main.py
```
> **Confirmation**: `Uvicorn running on http://0.0.0.0:5002`

---

### Option B: Containerized Deployment (Docker Compose)

Docker Compose containerizes the core AI engine, the Nginx reverse proxy gateway, and the eye tracking module.

#### 1. GPU vs CPU Mode
By default, `ocr_module` in `docker-compose.yml` attempts to allocate an NVIDIA GPU.
* **Running on CPU only**: Open `docker-compose.yml` and comment out the `deploy: resources: reservations: devices:` block under `ocr_module`. The engine automatically detects CPU mode and executes PaddleOCR and ONNX SFace in CPU inference mode.

#### 2. Build & Launch Containers
```bash
# Build images and start services in detached mode:
docker compose up --build -d
```

#### 3. Inspect Container Status & Logs
```bash
# Check container status:
docker compose ps

# Follow live OCR engine logs:
docker compose logs -f ocr_module

# Follow live Nginx gateway logs:
docker compose logs -f accessibility_module
```

#### 4. Stop Containers
```bash
docker compose down
```

---

## Verification Flow Runner & Dynamic Pipelines

The Verification Flow Runner (`products/verify.html` + `products/verify.js`) renders a frictionless, responsive eKYC onboarding flow for applicants.

### Dynamic URL Structure
```
http://localhost:5174/verify.html?pid=<PIPELINE_ID>&flow=<MODULE_LIST>&applicant_token=<SIGNED_TOKEN>
```

### Supported Flow Modules
| Module Code | Name | Description |
| :--- | :--- | :--- |
| `PAN_FACE` | PAN & Face Verification | Document OCR on PAN card followed by real-time camera face match. |
| `AADHAAR_FACE` | Aadhaar & Face Verification | Dual-pass Aadhaar card OCR followed by real-time camera face match. |
| `PAN` | PAN Card OCR Only | Document capture and field extraction without face selfie. |
| `AADHAAR` | Aadhaar Card OCR Only | Document capture and field extraction without face selfie. |
| `EYE_TRACKING` | Gaze & Attention Analysis | 9-point calibration and anti-spoofing quadrant attention check. |
| `HUMAN_REVIEW` | Human Auditor Review | Flags verification session for manual side-by-side officer review. |

### Example Launch Links
* **Aadhaar + Selfie + Eye Tracking**:  
  `http://localhost:5174/verify.html?pid=FLOW-AADHAAR-01&flow=AADHAAR_FACE,EYE_TRACKING`
* **PAN + Selfie Match Only**:  
  `http://localhost:5174/verify.html?pid=FLOW-PAN-02&flow=PAN_FACE`

---

## Comprehensive API Reference

All requests to protected endpoints require either a Supabase Bearer token or an Applicant Session Token.

### 1. Issue Applicant Session Token
```http
POST /api/v1/auth/applicant_session
Content-Type: application/json
Authorization: Bearer <ADMIN_SUPABASE_TOKEN>
```
**Request Payload**:
```json
{
  "pid": "FLOW-XYZ123",
  "flow": "PAN_FACE,EYE_TRACKING",
  "tenant_id": "org_acme_corp",
  "ttl_seconds": 3600
}
```
**Response (200 OK)**:
```json
{
  "status": "success",
  "applicant_token": "eyJhbGciOiJIUzI1Ni...<token_b64>.<sig_hex>",
  "expires_at": 1729864800,
  "tenant_id": "org_acme_corp"
}
```

---

### 2. Document OCR & Face Crop Extraction
```http
POST /api/v1/ocr
Content-Type: multipart/form-data
X-Applicant-Token: <APPLICANT_TOKEN>
```
**Form Data**:
* `image`: Binary file (JPEG or PNG document photo).
* `doc_type`: (Optional) `aadhaar` | `pan` | `auto`.

**Response (200 OK)**:
```json
{
  "status": "success",
  "session_id": "a8f3b92c",
  "document_type": "aadhaar",
  "parsed_fields": {
    "name": "Jane Doe",
    "dob": "15/08/1995",
    "aadhaar_number": "XXXX-XXXX-9012"
  },
  "ocr_confidence": 94.8,
  "face_image_url": "/ocr_uploads/id_face_a8f3b92c.jpg?expires=...&sig=...&tid=org_acme_corp&op=read",
  "supabase_sync": {
    "status": "success"
  }
}
```

---

### 3. Live Face Verification & Biometric Liveness
```http
POST /api/v1/live_verify
Content-Type: application/json
X-Applicant-Token: <APPLICANT_TOKEN>
```
**Request Payload**:
```json
{
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
  "session_id": "a8f3b92c",
  "step3_faces": ["id_face_a8f3b92c.jpg"]
}
```
**Response (200 OK)**:
```json
{
  "status": "success",
  "session_id": "a8f3b92c",
  "face_match": true,
  "step3_face_matches": [
    {
      "step3_face": "id_face_a8f3b92c.jpg",
      "verified": true,
      "distance": 0.284,
      "threshold": 0.670,
      "model": "SFace_128D_ONNX"
    }
  ],
  "overall_status": "SUCCESS"
}
```

---

### 4. Fetch Verification Record (IDOR Protected)
```http
GET /api/v1/supabase/get/{session_id_or_id_number}
Authorization: Bearer <USER_SUPABASE_TOKEN>
```
**Response (200 OK)**:
Returns the matched record if the caller belongs to the owning organization or is a Superadmin. Foreign tenant requests return HTTP 403.

---

### 5. Administrative Data Retention Purge
```http
POST /api/v1/admin/purge_expired_assets
Authorization: Bearer <SUPERADMIN_TOKEN>
Content-Type: application/json
```
**Request Payload**:
```json
{
  "retention_hours": 24
}
```
**Response (200 OK)**:
```json
{
  "status": "success",
  "purged_files": 42,
  "retention_hours": 24
}
```

---

## Testing & Quality Assurance Suite

Verifyyy includes an automated regression test suite covering unit authentication logic, cryptographic URL signatures, token lifecycles, and startup paths.

### Running Unit Tests (No Server Required)
```bash
python -m pytest tests/test_security_controls.py -v -m "not integ"
```
**Expected Result**: `32 passed, 13 deselected in < 1.0s`

### Test Categories Covered
* **`TestStartupSecretValidation`**: Validates that missing or weak secrets (< 32 chars) trigger immediate `RuntimeError`.
* **`TestStartupPaths`**: Confirms that direct execution of `engine.py` and Superadmin `main.py` abort on invalid configuration.
* **`TestTokenExpiry`**: Asserts that expired applicant tokens are rejected before checking revocation.
* **`TestTokenTampering`**: Verifies HMAC signature integrity against payload tampering and truncation.
* **`TestTokenRevocation`**: Asserts that revoked tokens cannot be reused across consecutive calls.
* **`TestTokenCrossTenantIsolation`**: Confirms tokens cannot be forged or replayed across organizations.
* **`TestSignedAssetURLs`**: Verifies HMAC parameters, TTL expiration, tenant isolation, and operation boundaries.
* **`TestFileValidation`**: Confirms JPEG/PNG magic bytes and rejects spoofed HTML/scripts.
* **`TestIdentityMasking`**: Asserts Aadhaar (`XXXX-XXXX-LAST4`) and PAN (`ABCDE****F`) masking.
* **`TestWorkflowStepEnforcement`**: Confirms applicants cannot bypass mandatory prerequisite steps.

### Running Integration Tests (Requires Active Server)
```bash
# Start OCR Engine on port 5001 first, then run:
python -m pytest tests/test_security_controls.py -v -m integ
```

---

## Troubleshooting & Common Questions

### 1. `SECURITY CONFIGURATION ERROR — application cannot start`
* **Cause**: `APPLICANT_SESSION_SECRET` or `ASSET_SIGNING_SECRET` is unset, empty, or fewer than 32 characters.
* **Fix**: Generate 64-character hexadecimal keys using `python -c "import secrets; print(secrets.token_hex(32))"` and paste them into `.env`.

### 2. Windows PyTorch DLL Crashes (`c10.dll` / OpenMP errors)
* **Resolution**: The OCR Engine includes a dynamic Torch import interceptor (`_TorchMockFinder`) that automatically mocks PyTorch during PaddleOCR and ONNX loading, preventing broken Windows PyTorch C++ DLL conflicts while allowing EyeTracker to load real PyTorch when needed.

### 3. Model Files Missing (`sface.onnx`)
* **Resolution**: Run `python products/ocr_engine/download_sface.py` to automatically fetch the official OpenCV SFace ONNX neural model.

### 4. CORS Errors from Custom Frontends
* **Resolution**: Add your frontend URL (e.g., `http://my-domain:3000`) to `ALLOWED_CORS_ORIGINS` in `.env` as a comma-separated value.

---

## License

This project is licensed under the [MIT License](LICENSE).
