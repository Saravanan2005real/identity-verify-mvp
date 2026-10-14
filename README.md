# Verifyyy - Enterprise eKYC & Identity Verification Platform

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Flask](https://img.shields.io/badge/Flask-3.0+-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![React Native Web](https://img.shields.io/badge/React_Native_Web-0.21+-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://necolas.github.io/react-native-web/)
[![OpenCV](https://img.shields.io/badge/OpenCV-4.10+-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)](https://opencv.org)
[![ONNX Runtime](https://img.shields.io/badge/ONNX_Runtime-SFace_128D-005CED?style=for-the-badge&logo=onnx&logoColor=white)](https://onnxruntime.ai/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL_Cloud-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

**Verifyyy** is an enterprise-grade Electronic Know Your Customer (**eKYC**) and digital identity verification platform. Built with a modular microservice architecture, it combines state-of-the-art computer vision (PaddleOCR, RetinaFace 5-point alignment, SFace ONNX 128-D neural network, ArcFace 512-D), real-time camera liveness detection, browser-based eye gaze tracking (WebGazer & FGI-Net), a no-code verification pipeline builder for enterprise clients, and centralized superadmin governance with cloud database synchronization.

---

## Table of Contents
- [Executive Overview](#executive-overview)
- [Key Features & Innovations](#key-features--innovations)
- [System Architecture & Visual Diagrams](#system-architecture--visual-diagrams)
  - [1. High-Level Architecture Diagram](#1-high-level-architecture-diagram)
  - [2. End-to-End Verification Sequence](#2-end-to-end-verification-sequence)
  - [3. Dynamic Pipeline Builder & Runner Flow](#3-dynamic-pipeline-builder--runner-flow)
  - [4. Multi-Tier AI Face Match & Fallback Decision Logic](#4-multi-tier-ai-face-match--fallback-decision-logic)
  - [5. Multi-Modal Liveness & Anti-Spoofing Architecture](#5-multi-modal-liveness--anti-spoofing-architecture)
  - [6. Supabase Entity-Relationship & Cloud Sync Architecture](#6-supabase-entity-relationship--cloud-sync-architecture)
- [Repository Structure](#repository-structure)
- [Microservices & Subsystems](#microservices--subsystems)
  - [1. Products Gateway Server](#1-products-gateway-server)
  - [2. AI OCR & Face Verification Engine](#2-ai-ocr--face-verification-engine)
  - [3. Interactive Verification Flow Runner](#3-interactive-verification-flow-runner)
  - [4. Client Admin Portal & Pipeline Builder](#4-client-admin-portal--pipeline-builder)
  - [5. Superadmin Management Platform](#5-superadmin-management-platform)
  - [6. Eye Tracking & Attention Analysis Module](#6-eye-tracking--attention-analysis-module)
  - [7. Voice & Audio Liveness Challenge](#7-voice--audio-liveness-challenge)
- [Database & Cloud Sync (Supabase)](#database--cloud-sync-supabase)
- [Quick Start & Execution Guide](#quick-start--execution-guide)
  - [Prerequisites](#prerequisites)
  - [Option A: Local Bare-Metal Setup](#option-a-local-bare-metal-setup)
  - [Option B: Docker Compose Deployment](#option-b-docker-compose-deployment)
- [Port & Service Routing Matrix](#port--service-routing-matrix)
- [Comprehensive API Reference](#comprehensive-api-reference)
- [Security, Privacy & UIDAI Compliance](#security-privacy--uidai-compliance)
- [License](#license)

---

## Executive Overview

Modern customer onboarding and digital KYC systems face three primary challenges:
1. **Severe Geometric Distortion**: Standard document perspective correction stretches or compresses faces embedded on identification cards, causing downstream biometric comparisons to fail.
2. **Brittle Rigid Pipelines**: Enterprises have varying risk profiles—some require simple PAN OCR, while high-risk financial onboarding requires document OCR, deep facial matching, gaze tracking, and manual officer auditing.
3. **Complex Offline & Cloud Boundaries**: Systems must operate smoothly under transient cloud outages without blocking onboarding queues.

**Verifyyy** resolves these hurdles by:
- Preserving pristine facial geometry using **unwarped coordinate re-projection** from raw camera frames before quadrilateral rectification.
- Employing a **three-tier cascaded facial recognition engine** (SFace ONNX -> ArcFace -> Multi-descriptor OpenCV matcher) with sub-second inference.
- Empowering business operators with a **visual drag-and-drop pipeline builder** that yields instant, tokenized applicant onboarding links.
- Offering **seamless cloud sync to Supabase PostgreSQL** alongside a resilient local SQLite/in-memory fallback mode.

---

## Key Features & Innovations

### 🪪 Universal Document Classification & Dual-Pass OCR
- **Automatic Document Detection**: Intelligently classifies documents as **Aadhaar Cards** (UIDAI 12-digit format), **PAN Cards** (10-character alphanumeric tax identifiers), **Driving Licenses**, or **Voter IDs**.
- **Dual-Pass Extraction Pipeline**: Combines high-resolution perspective rectification, CLAHE illumination normalization, and dual-pass PaddleOCR extraction with algorithmic fuzzy error correction.
- **Strict Regular Expression Extraction**: Automatically parses Name, Date of Birth (DOB), ID Number, and Father's Name with heuristic validation.
- **Image Quality Pre-Check (`quality.py`)**: Assesses Laplacian variance blur, glare thresholds, contrast, and ambient lighting before running inference, rejecting poor uploads with actionable feedback.

### 👤 Multi-Tier Deep Face Recognition
- **Zero-Distortion Face Cropping**: Uses RetinaFace 5-point landmark alignment to crop reference faces directly from original, unwarped frames. This completely eliminates the aspect ratio compression commonly caused by document perspective warping.
- **Tier 1 — SFace 128-D ONNX Neural Net**: Ultra-lightweight OpenCV DNN model (`sface.onnx` via `cv2.FaceRecognizerSF`) generating 128-dimensional facial embeddings and computing cosine distance similarity in under 15ms.
- **Tier 2 — ArcFace 512-D Verification**: High-dimensional angular margin loss feature projection with adaptive threshold relaxation (0.75) tailored for degraded, laminated, or aged government ID photos.
- **Tier 3 — OpenCV Computer Vision Fallback**: Histogram equalization, normalized 2D cross-correlation, and ORB feature descriptor matching for zero-dependency execution in air-gapped environments.

### ⚡ Visual Pipeline Builder & Dynamic Flow Runner
- **No-Code Pipeline Assembly**: Client administrators can build custom eKYC recipes (e.g., Aadhaar & Face Match → Eye Tracking Attention Check → Human Review).
- **Tokenized Shareable Links**: Instant URL generation with parameterized query arguments (`/verify.html?pid=FLOW-ABC123&flow=AADHAAR_FACE,EYE_TRACKING`).
- **Dynamic Step Runner**: Renders responsive progress steppers, real-time camera feedback, capture guides, and verification verdicts in pure HTML5/JavaScript without heavy frontend frameworks.

### 👁️ Biometric Liveness & Attention Tracking
- **Interactive Gaze Calibration**: 9-point target calibration via WebGazer and deep FGI-Net gaze vector tracking.
- **Active Attention Verification**: Verifies user presence and anti-spoofing by enforcing camera focus and tracking gaze trajectory across screen quadrants.
- **Voice & Audio Liveness Challenge**: Audio waveform recording and challenge-response phrase validation (`demo_audio_liveness.html`).

### 🌐 Cloud Persistence with Resilient Local Fallback
- **Supabase Cloud Sync**: Asynchronous REST client upserting verification sessions, document metadata, match confidence scores, and crop asset URLs to Supabase PostgreSQL.
- **Row Level Security (RLS)**: Enforces table policies for multi-tenant isolation.
- **Fail-Safe Offline Operation**: Automatic fallback to local SQLite (`superadmin.db`) and in-memory caches when cloud keys are unset or network connectivity drops.

---

## System Architecture & Visual Diagrams

### 1. High-Level Architecture Diagram

```mermaid
graph TB
    classDef client fill:#0284c7,stroke:#0369a1,stroke-width:2px,color:#ffffff
    classDef gateway fill:#d97706,stroke:#b45309,stroke-width:2px,color:#ffffff
    classDef ai fill:#059669,stroke:#047857,stroke-width:2px,color:#ffffff
    classDef app fill:#7c3aed,stroke:#6d28d9,stroke-width:2px,color:#ffffff
    classDef data fill:#db2777,stroke:#be185d,stroke-width:2px,color:#ffffff

    subgraph EndUsers ["End Users & Administrators"]
        Applicant["Applicant / End User"]:::client
        TenantAdmin["Tenant Client Admin"]:::client
        SuperAdmin["Super Administrator"]:::client
    end

    subgraph GatewayLayer ["Reverse Proxy & Gateway Layer (Port 5174)"]
        Gateway["Python Gateway (serve_5174.py) / Nginx Reverse Proxy<br/>Routes /api/v1/ to OCR Engine (Port 5001)<br/>Routes /api/v1/eye/ to Eye Tracker (Port 5002)<br/>Serves Static Verification HTML5 Clients"]:::gateway
    end

    subgraph VerificationClients ["Applicant Verification Experiences"]
        FlowRunner["Dynamic Flow Runner<br/>(verify.html + verify.js)"]:::client
        OCRDemo["OCR & Face Match Demo<br/>(demo_ocr_face.html)"]:::client
        EyeDemo["Eye Tracking Demo<br/>(demo_eye_tracking.html)"]:::client
        AudioDemo["Audio Liveness Demo<br/>(demo_audio_liveness.html)"]:::client
    end

    subgraph AIMicroservices ["AI & Computer Vision Engines"]
        OCRService["AI OCR & Biometrics Engine (Flask : Port 5001)<br/>- Document Quality Guard (Laplacian Blur & Glare)<br/>- Perspective Rectification & PaddleOCR Dual-Pass<br/>- Unwarped RetinaFace 5-Point Alignment<br/>- SFace 128-D ONNX Neural Network<br/>- ArcFace 512-D Deep Biometrics<br/>- OpenCV ORB & Histogram Fallback"]:::ai
        EyeService["Eye Tracking Engine (FastAPI : Port 5002)<br/>- FGI-Net Deep Gaze Estimation<br/>- WebGazer Browser Calibration<br/>- Attention Heatmap & Vector Analysis"]:::ai
    end

    subgraph ManagementApps ["Administrative Management Portals"]
        AdminFE["Client Admin Portal (React Native Web : Port 8082)<br/>- Visual No-Code Pipeline Builder<br/>- Instant Link Generator<br/>- Real-Time Verifications Table<br/>- Side-by-Side Face Audit Modal"]:::app
        SuperAdminFE["Superadmin Portal (React Native Web : Port 8081)<br/>- Tenant Client Management<br/>- B2B Verification Catalog<br/>- System Health & Telemetry"]:::app
        SuperAdminBE["Superadmin Backend (FastAPI : Port 8000)<br/>- SQLite / PostgreSQL Database<br/>- Multi-Tenant Licensing API"]:::app
    end

    subgraph StorageTier ["Persistence & Cloud Synchronization"]
        LocalDB[("Local SQLite Database<br/>superadmin.db")]:::data
        SupabaseCloud[("Supabase Cloud Database<br/>Table: verifications<br/>Row Level Security & B-Tree Indexes")]:::data
    end

    %% User Connections
    Applicant -->|"1. Opens Verification Link"| Gateway
    TenantAdmin -->|"Builds Pipelines & Audits"| AdminFE
    SuperAdmin -->|"System Oversight"| SuperAdminFE

    %% Gateway Routing
    Gateway -->|"Delivers"| FlowRunner
    Gateway -->|"Delivers"| OCRDemo
    Gateway -->|"Delivers"| EyeDemo
    Gateway -->|"Delivers"| AudioDemo
    Gateway -->|"Proxy: /api/v1/"| OCRService
    Gateway -->|"Proxy: /api/v1/eye/"| EyeService

    %% Microservice Interactions
    FlowRunner -->|"Submits ID & Live Selfie"| OCRService
    AdminFE -->|"Reads Verification Records"| OCRService
    SuperAdminFE -->|"API Calls"| SuperAdminBE
    SuperAdminBE -->|"CRUD Operations"| LocalDB

    %% Cloud Sync
    OCRService -.->|"Async REST Upsert"| SupabaseCloud
    AdminFE -.->|"Direct / Proxied Queries"| SupabaseCloud
```

---

### 2. End-to-End Verification Sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as Applicant
    participant Gateway as Gateway (Port 5174)
    participant UI as Flow Runner (verify.html)
    participant OCR as OCR & Biometrics Engine (Port 5001)
    participant AI as SFace / ArcFace Models
    participant Cloud as Supabase Cloud DB
    actor Admin as Client Admin (Port 8082)

    User->>Gateway: Access Verification Link (/verify.html?pid=FLOW-01&flow=PAN_FACE)
    Gateway-->>User: Serve Runner UI and dynamic pipeline stepper
    
    User->>UI: Upload Document Image (Aadhaar / PAN)
    UI->>OCR: POST /api/v1/ocr (Multipart Form-Data)
    Note over OCR: 1. Image Quality Assessment (Laplacian blur & glare)<br/>2. Document classification & Perspective rectification<br/>3. Dual-pass PaddleOCR field extraction<br/>4. Unwarped RetinaFace face crop extraction
    OCR-->>UI: Return extracted fields (Name, DOB, ID) + Reference Face Crop URL
    UI-->>User: Display extracted data for applicant confirmation

    User->>UI: Launch Live Camera for Selfie & Liveness Check
    UI->>OCR: POST /api/v1/live_verify (Base64 Live Frame + Session ID + Reference Crop)
    OCR->>AI: Compare Live Selfie vs Reference ID Face
    Note over AI: 1. Primary: SFace 128-D ONNX Cosine Similarity<br/>2. Secondary: ArcFace 512-D Angular Loss<br/>3. Fallback: OpenCV ORB & Histogram Matcher
    AI-->>OCR: Verification Verdict (Match: True, Distance: 0.28, Threshold: 0.67)

    OCR->>Cloud: POST /rest/v1/verifications (Asynchronous upsert)
    Cloud-->>OCR: 201 Created / 200 Merged
    OCR-->>UI: Return Final Verdict (SUCCESS / MANUAL_REVIEW)
    UI-->>User: Display Verification Completed Screen

    Admin->>OCR: GET /api/v1/supabase/list
    OCR-->>Admin: Return Applicant Records & Match Verdicts
    Admin->>Admin: Review Side-by-Side Crops (ID Crop vs Live Selfie) & One-Click Approval
```

---

### 3. Dynamic Pipeline Builder & Runner Flow

```mermaid
graph LR
    classDef builder fill:#4338ca,stroke:#3730a3,stroke-width:2px,color:#ffffff
    classDef link fill:#0284c7,stroke:#0369a1,stroke-width:2px,color:#ffffff
    classDef runner fill:#059669,stroke:#047857,stroke-width:2px,color:#ffffff
    classDef decision fill:#d97706,stroke:#b45309,stroke-width:2px,color:#ffffff

    subgraph BuilderStep ["1. Pipeline Construction (Admin Portal)"]
        Modules["Available Modules:<br/>• Aadhaar & Face<br/>• PAN & Face<br/>• Eye Tracking<br/>• Human Review"]:::builder
        Canvas["Visual Drag & Drop Canvas<br/>Order: (Aadhaar) → (Face Match) → (Gaze)"]:::builder
        Modules --> Canvas
    end

    subgraph LinkStep ["2. Parameterized Token Generation"]
        Generator["Generate Link Engine<br/>Creates Unique Pipeline ID (PID)"]:::link
        ShareURL["Shareable Applicant URL:<br/>/verify.html?pid=FLOW-9182&flow=AADHAAR_FACE,EYE_TRACKING"]:::link
        Canvas --> Generator --> ShareURL
    end

    subgraph ExecutionStep ["3. Dynamic Client Execution"]
        Parser["Flow Runner URL Parser<br/>Extracts active sequence"]:::runner
        Stepper["Dynamic Stepper Builder<br/>Renders Step 1..N with live indicators"]:::runner
        ShareURL --> Parser --> Stepper
    end

    subgraph VerdictStep ["4. Consolidated Verdict"]
        Audit["Unified Verification Record<br/>Status: PASSED / FLAGGED_FOR_AUDIT"]:::decision
        Stepper --> Audit
    end
```

---

### 4. Multi-Tier AI Face Match & Fallback Decision Logic

```mermaid
flowchart TD
    classDef start fill:#0f172a,stroke:#334155,stroke-width:2px,color:#ffffff
    classDef process fill:#0284c7,stroke:#0369a1,stroke-width:2px,color:#ffffff
    classDef model fill:#7c3aed,stroke:#6d28d9,stroke-width:2px,color:#ffffff
    classDef pass fill:#16a34a,stroke:#15803d,stroke-width:2px,color:#ffffff
    classDef review fill:#dc2626,stroke:#b91c1c,stroke-width:2px,color:#ffffff

    InputFrame["Input Live Selfie Frame + Extracted ID Face Crop"]:::start
    FaceDet{"Face Detected in Both Images?"}:::process
    InputFrame --> FaceDet

    FaceDet -- No --> FailNoFace["Verdict: FAILED (No face detected)"]:::review
    FaceDet -- Yes --> SFaceModel["Tier 1: SFace 128-D ONNX Neural Network<br/>Compute Cosine Distance"]:::model

    SFaceModel --> CheckSFace{"Distance ≤ 0.670?"}:::process
    CheckSFace -- Yes --> MatchPassed["Verdict: VERIFIED (SFace Cosine Match)"]:::pass

    CheckSFace -- No --> ArcFaceModel["Tier 2: ArcFace 512-D Verification<br/>Compute Angular Distance"]:::model
    ArcFaceModel --> CheckArc{"Distance ≤ 0.750?"}:::process
    CheckArc -- Yes --> MatchPassedArc["Verdict: VERIFIED (ArcFace Match)"]:::pass

    CheckArc -- No --> FallbackCV["Tier 3: OpenCV CV Fallback<br/>Histogram Cross-Correlation & ORB Descriptors"]:::model
    FallbackCV --> CheckCV{"Correlation ≥ 0.70 OR ORB Matches ≥ 15?"}:::process
    CheckCV -- Yes --> MatchPassedCV["Verdict: VERIFIED (CV Correlation Match)"]:::pass

    CheckCV -- No --> ManualReview["Verdict: MANUAL_REVIEW (Flagged for Officer Audit)"]:::review
```

---

### 5. Multi-Modal Liveness & Anti-Spoofing Architecture

```mermaid
flowchart TD
    classDef capture fill:#0369a1,stroke:#0284c7,stroke-width:2px,color:#ffffff
    classDef check fill:#4338ca,stroke:#3730a3,stroke-width:2px,color:#ffffff
    classDef decision fill:#d97706,stroke:#b45309,stroke-width:2px,color:#ffffff
    classDef pass fill:#16a34a,stroke:#15803d,stroke-width:2px,color:#ffffff
    classDef reject fill:#dc2626,stroke:#b91c1c,stroke-width:2px,color:#ffffff

    subgraph Modality1 ["1. Live Visual Face & Quality Liveness"]
        CamInput["Webcam Video Stream"]:::capture
        QualityCheck["Laplacian Variance Blur Filter<br/>Glare Threshold & Contrast Check"]:::check
        PoseEst["Head Pose & RetinaFace Landmarks<br/>5-Point Unwarped Geometry"]:::check
        CamInput --> QualityCheck --> PoseEst
    end

    subgraph Modality2 ["2. Active Gaze & Attention Verification"]
        GazeGrid["WebGazer 9-Point Target Calibration"]:::capture
        VectorTrack["FGI-Net Neural Gaze Vector Tracking<br/>Real-Time Pupil Center & Direction"]:::check
        QuadrantSeq["Randomized Quadrant Target Challenge<br/>(Top, Bottom, Left, Right)"]:::check
        GazeGrid --> VectorTrack --> QuadrantSeq
    end

    subgraph Modality3 ["3. Audio & Voice Liveness Challenge"]
        MicInput["WebAudio API Waveform Capture"]:::capture
        ChallengeGen["Dynamic Oral Challenge Phrase"]:::capture
        SpectroCheck["Audio Energy & Frequency Spectrum Liveness"]:::check
        MicInput --> ChallengeGen --> SpectroCheck
    end

    subgraph VerdictEngine ["Consolidated Anti-Spoofing Engine"]
        ScoreFusion{"Multi-Modal Fusion:<br/>Face Pose Valid?<br/>Gaze Focused on Targets?<br/>Audio Response Verified?"}:::decision
        PassAll["Overall Liveness: VERIFIED<br/>(Biometric Spoofing Risk: Minimal)"]:::pass
        FailRisk["Overall Liveness: SPOOF_DETECTED<br/>(Flagged or Session Rejected)"]:::reject
    end

    PoseEst --> ScoreFusion
    QuadrantSeq --> ScoreFusion
    SpectroCheck --> ScoreFusion
    ScoreFusion -- All Passed --> PassAll
    ScoreFusion -- Failed Any Check --> FailRisk
```

---

### 6. Supabase Entity-Relationship & Cloud Sync Architecture

```mermaid
erDiagram
    TENANT_CLIENT ||--o{ VERIFICATION_SESSION : owns
    VERIFICATION_SESSION ||--|| AUDIT_RECORD : produces
    VERIFICATION_SESSION ||--o{ BIOMETRIC_ASSET : references

    TENANT_CLIENT {
        uuid client_id PK "Unique Tenant ID"
        string client_name "Registered Enterprise Name"
        string api_key "Hashed Client Secret"
        string status "ACTIVE or SUSPENDED"
    }

    VERIFICATION_SESSION {
        uuid id PK "gen_random_uuid()"
        string session_id UK "Unique Session Reference"
        string document_type "aadhaar, pan, dl, or voter"
        string id_number "Masked ID e.g. XXXX XXXX 1234"
        string extracted_name "Full Name from Document"
        string dob "Date of Birth DD/MM/YYYY"
        float ocr_confidence "PaddleOCR Confidence Score"
        boolean face_match_verified "Biometric Verification Result"
        float face_match_distance "Cosine or Angular Distance"
        float face_match_threshold "Model Acceptance Threshold"
        boolean liveness_verified "Liveness Detection Verdict"
        float liveness_score "Liveness Confidence Score"
        string overall_status "SUCCESS, MANUAL_REVIEW, REJECTED"
        string extracted_face_url "Reference Face Crop Storage Path"
        string live_holder_face_url "Live Webcam Selfie Storage Path"
        jsonb metadata "Browser, IP, Pipeline Step Data"
        timestamptz created_at "Timestamp of Submission"
        timestamptz updated_at "Timestamp of Last Update"
    }

    AUDIT_RECORD {
        uuid audit_id PK "Audit Log Identifier"
        uuid session_id FK "References VERIFICATION_SESSION"
        string reviewer_id "Officer or Admin Username"
        string audit_decision "APPROVED or REJECTED"
        text review_notes "Officer Notes and Observations"
        timestamptz reviewed_at "Decision Timestamp"
    }

    BIOMETRIC_ASSET {
        string asset_id PK "SHA-256 Hash of Crop"
        string asset_type "id_face_crop, live_selfie, debug_crop"
        string storage_bucket "Supabase Storage or Local Uploads"
        string file_path "Relative Disk or CDN Path"
    }
```

---

## Repository Structure

```
identity-verify-mvp/
├── .env.example                     # Environment template for Supabase cloud credentials
├── .gitignore                       # Clean Git configuration excluding models, uploads, logs
├── docker-compose.yml               # Multi-container orchestration (OCR, Eye Tracker, Nginx)
├── README.md                        # Comprehensive system documentation & architecture
├── supabase_schema.sql              # Supabase table DDL, RLS policies, and index statements
│
├── admin/                           # Client Admin Portal
│   └── frontend/                    # React Native Web application (Port 8082)
│       ├── App.js                   # Pipeline Builder, Links Manager, Live Review Queue
│       ├── index.js                 # Application entrypoint
│       └── package.json             # React Native Web / Expo dependencies
│
├── products/                        # Verification Engines & Frontend Runners
│   ├── demo_ocr_face.html           # Standalone Document OCR & Live Face Match Demo
│   ├── demo_ocr_face.js             # Client logic for demo OCR and Supabase lookup
│   ├── demo_eye_tracking.html       # WebGazer eye tracking & attention calibration demo
│   ├── demo_eye_tracking.js         # Gaze tracking controller
│   ├── demo_audio_liveness.html     # Voice liveness & challenge-response demo
│   ├── demo_audio_liveness.js       # Audio waveform & speech verification logic
│   ├── verify.html                  # Dynamic Verifyyy Flow Runner UI
│   ├── verify.js                    # Multi-step pipeline execution engine
│   ├── webgazer.js                  # Precompiled WebGazer browser gaze tracking library
│   ├── style.css                    # Unified design system styles (Teal / Slate theme)
│   ├── nginx.conf                   # Reverse proxy configuration
│   ├── serve_5174.py                # Standalone Python Gateway & Reverse Proxy (Port 5174)
│   │
│   ├── ocr_engine/                  # Flask AI Computer Vision Engine (Port 5001)
│   │   ├── engine.py                # Core OCR, SFace, ArcFace, and verification APIs
│   │   ├── download_sface.py        # Automated SFace ONNX model downloader
│   │   ├── sface.onnx               # OpenCV SFace 128-D ONNX model binary
│   │   ├── supabase_client.py       # Resilient Supabase REST client (GET, LIST, UPSERT)
│   │   ├── quality.py               # Blur, glare, illumination, and sharpness checker
│   │   ├── FSRCNN_x2.pb             # Super-resolution model for low-res document crops
│   │   ├── Dockerfile               # Container build for OCR microservice
│   │   └── requirements.txt         # Python dependencies
│   │
│   ├── eye_tracking_module/         # FastAPI Eye Tracking Service (Port 5002)
│   │   ├── main.py                  # Gaze vector analytics API
│   │   ├── demo.py                  # Standalone OpenCV webcam tracker demo
│   │   ├── FGI-Net/                 # Deep neural gaze tracking research model
│   │   ├── fgi_eye_tracker/         # Real-time pupil & eye estimation library
│   │   ├── weights/                 # Trained model weights (fgi_net.pth)
│   │   ├── Dockerfile               # Container build for eye tracking
│   │   └── requirements.txt         # FastAPI dependencies
│   │
│   └── ocr_uploads/                 # Ephemeral runtime upload cache (.gitkeep protected)
│
└── superadmin/                      # Platform Superadmin Management System
    ├── backend/                     # FastAPI core backend (Port 8000)
    │   ├── main.py                  # Multi-tenant API endpoints & B2B service catalog
    │   ├── database.py              # SQLite / PostgreSQL SQLAlchemy connection
    │   ├── superadmin.db            # Local SQLite database
    │   ├── routers/dashboard.py     # Administrative analytics router
    │   └── requirements.txt         # FastAPI dependencies
    └── frontend/                    # React Native Web Superadmin Dashboard (Port 8081)
        ├── App.js                   # Tenant management & service overview UI
        └── package.json             # Expo dependencies
```

---

## Microservices & Subsystems

### 1. Products Gateway Server
- **Implementation**: `products/serve_5174.py` (Local Python) or `products/nginx.conf` (Dockerized Nginx).
- **Port**: `5174`.
- **Purpose**: Serves static HTML5/JS verification clients and transparently proxies API requests (`/api/v1/*` to OCR Engine on port 5001, `/api/v1/eye/*` to Eye Tracker on port 5002) with full CORS support.

### 2. AI OCR & Face Verification Engine
- **Implementation**: `products/ocr_engine/engine.py`.
- **Framework**: Flask on port `5001`.
- **Capabilities**:
  - Image quality assessment (`quality.py`) for blur, glare, and low illumination.
  - Quadrilateral document edge detection and perspective transformation.
  - Dual-pass PaddleOCR with regex extraction for Aadhaar and PAN cards.
  - RetinaFace landmark extraction directly from unwarped raw frames.
  - SFace ONNX 128-D cosine distance matching (`sface.onnx`).
  - ArcFace 512-D angular margin verification with relaxed threshold (0.75).
  - Multi-feature OpenCV fallback (histogram correlation + ORB descriptors).
  - Asynchronous background synchronization to Supabase PostgreSQL.

### 3. Interactive Verification Flow Runner
- **Files**: `products/verify.html` and `products/verify.js`.
- **Port**: `http://localhost:5174/verify.html`.
- **Purpose**: Dynamically renders applicant verification steps according to the `flow` query parameter (e.g., `AADHAAR_FACE,EYE_TRACKING,HUMAN_REVIEW`).
- **Features**: Live camera preview, real-time facial framing indicators, instant OCR field confirmation, eye gaze calibration, and automated completion screens.

### 4. Client Admin Portal & Pipeline Builder
- **Files**: `admin/frontend/App.js`.
- **Framework**: React Native Web / Expo on port `8082`.
- **Features**:
  - **Visual Pipeline Builder**: Build, customize, and save multi-step verification recipes.
  - **Instant Link Generator**: Create shareable applicant links with customized parameters.
  - **Real-Time Audit Queue**: Review recent applicant submissions synced directly from Supabase.
  - **Side-by-Side Review Modal**: Inspect extracted ID photos against live webcam selfies with one-click Approve/Reject actions.

### 5. Superadmin Management Platform
- **Backend**: `superadmin/backend/main.py` (FastAPI on port `8000`).
- **Frontend**: `superadmin/frontend/App.js` (React Native Web on port `8081`).
- **Features**: Multi-tenant client onboarding, B2B service catalog management, API usage monitoring, and platform licensing.

### 6. Eye Tracking & Attention Analysis Module
- **Backend**: `products/eye_tracking_module/main.py` (FastAPI on port `5002`).
- **Client**: `products/webgazer.js` + `products/demo_eye_tracking.html`.
- **Features**: 9-point eye calibration grid, real-time attention heatmaps, and deep FGI-Net gaze vector tracking.

### 7. Voice & Audio Liveness Challenge
- **Files**: `products/demo_audio_liveness.html` and `products/demo_audio_liveness.js`.
- **Features**: In-browser audio waveform capture and speech challenge-response verification.

---

## Database & Cloud Sync (Supabase)

Verifyyy integrates natively with [Supabase](https://supabase.com) PostgreSQL database storage while remaining completely resilient to offline environments.

### 1. Database Schema DDL
Execute the schema script in your Supabase SQL Editor (`supabase_schema.sql`):

```sql
CREATE TABLE IF NOT EXISTS public.verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) UNIQUE NOT NULL,
    document_type VARCHAR(50),
    id_number VARCHAR(100),
    extracted_name VARCHAR(255),
    dob VARCHAR(50),
    ocr_confidence FLOAT DEFAULT 0.0,
    face_match_verified BOOLEAN DEFAULT FALSE,
    face_match_distance FLOAT,
    face_match_threshold FLOAT,
    liveness_verified BOOLEAN DEFAULT FALSE,
    liveness_score FLOAT DEFAULT 0.0,
    overall_status VARCHAR(50) DEFAULT 'PENDING',
    extracted_face_url TEXT,
    live_holder_face_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access" ON public.verifications FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON public.verifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access" ON public.verifications FOR UPDATE USING (true);

CREATE INDEX IF NOT EXISTS idx_verifications_session_id ON public.verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_verifications_id_number ON public.verifications(id_number);
```

### 2. Environment Configuration
Copy `.env.example` to `.env` in the repository root:

```bash
cp .env.example .env
```

Set your Supabase credentials:
```ini
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_KEY=your-supabase-anon-or-service-key
SUPABASE_TABLE=verifications
```

> **Zero-Downtime Fallback Guarantee**: If `.env` is omitted or credentials remain as placeholders, the platform automatically switches to **Local Standalone Mode** with SQLite persistence and local asset storage.

---

## Quick Start & Execution Guide

### Prerequisites
- **Git**
- **Python 3.10+**
- **Node.js 18+** & `npm`
- **Docker Desktop** (Optional, for containerized deployment)

---

### Option A: Local Bare-Metal Setup

Open separate terminal windows for the microservices:

#### 1. OCR & Biometrics Engine (Port 5001)
```bash
cd products/ocr_engine
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate

pip install -r requirements.txt
python download_sface.py
python engine.py
# Running on http://127.0.0.1:5001
```

#### 2. Products Gateway Server (Port 5174)
```bash
python products/serve_5174.py
# Running on http://127.0.0.1:5174
```

#### 3. Client Admin Portal (Port 8082)
```bash
cd admin/frontend
npm install
npm run web -- --port 8082
# Running on http://localhost:8082
```

#### 4. Eye Tracking Module (Port 5002 - Optional)
```bash
cd products/eye_tracking_module
pip install fastapi uvicorn
uvicorn main:app --reload --port 5002
# Running on http://127.0.0.1:5002
```

#### 5. Superadmin Backend & Frontend (Ports 8000 & 8081 - Optional)
```bash
# Terminal A: Superadmin Backend
cd superadmin/backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal B: Superadmin Frontend
cd superadmin/frontend
npm install
npm run web -- --port 8081
```

---

### Option B: Docker Compose Deployment

To build and run the OCR Engine, Eye Tracker, and Nginx Gateway in containers:

```bash
docker compose up --build -d
```

Check running services:
```bash
docker compose ps
```

---

## Port & Service Routing Matrix

| Service | Port / URL | Tech Stack | Description |
| :--- | :--- | :--- | :--- |
| **Central Gateway** | [http://localhost:5174](http://localhost:5174) | Python / Nginx | Gateway reverse proxy and static demo server |
| **Verifyyy Dynamic Flow Runner** | [http://localhost:5174/verify.html](http://localhost:5174/verify.html) | HTML5 / JavaScript | Interactive applicant verification pipeline |
| **OCR & Face Match Demo** | [http://localhost:5174/demo_ocr_face.html](http://localhost:5174/demo_ocr_face.html) | HTML5 / JavaScript | Standalone document OCR & webcam matching UI |
| **Eye Tracking Demo** | [http://localhost:5174/demo_eye_tracking.html](http://localhost:5174/demo_eye_tracking.html) | WebGazer / JS | Browser-based eye gaze calibration demo |
| **Audio Liveness Demo** | [http://localhost:5174/demo_audio_liveness.html](http://localhost:5174/demo_audio_liveness.html) | HTML5 WebAudio | Voice challenge & liveness demo |
| **OCR & Face Engine** | [http://localhost:5001](http://localhost:5001) | Flask / OpenCV / ONNX | Core computer vision and biometrics service |
| **Eye Tracking Engine** | [http://localhost:5002](http://localhost:5002) | FastAPI / FGI-Net | Deep gaze analytics and vector estimation |
| **Client Admin Portal** | [http://localhost:8082](http://localhost:8082) | React Native Web / Expo | Pipeline builder, link manager, and audit queue |
| **Superadmin Frontend** | [http://localhost:8081](http://localhost:8081) | React Native Web / Expo | Multi-tenant platform governance dashboard |
| **Superadmin Backend API** | [http://localhost:8000](http://localhost:8000) | FastAPI / SQLAlchemy | B2B service catalog and client account API |

---

## Comprehensive API Reference

### 1. Document OCR & Face Extraction
```http
POST /api/v1/ocr
Content-Type: multipart/form-data
```

**Request Parameters**:
- `image`: Binary file (JPEG / PNG).
- `doc_type`: (Optional) `aadhaar` | `pan` | `auto`.

**Sample Response (200 OK)**:
```json
{
  "status": "success",
  "session_id": "a8f3b92c",
  "document_type": "aadhaar",
  "extracted_fields": {
    "name": "Jane Doe",
    "dob": "15/08/1995",
    "aadhaar_number": "XXXX XXXX 1234"
  },
  "ocr_confidence": 94.8,
  "face_image_url": "/ocr_uploads/id_face_a8f3b92c.jpg",
  "supabase_sync": {
    "synced": true,
    "status": "success"
  }
}
```

---

### 2. Live Face Verification & Liveness
```http
POST /api/v1/live_verify
Content-Type: application/json
```

**Request Payload**:
```json
{
  "image": "data:image/jpeg;base64,...",
  "session_id": "a8f3b92c",
  "step3_faces": ["id_face_a8f3b92c.jpg"]
}
```

**Sample Response (200 OK)**:
```json
{
  "status": "success",
  "session_id": "a8f3b92c",
  "step41_complete": true,
  "face_match": true,
  "step3_face_matches": [
    {
      "step3_face": "id_face_a8f3b92c.jpg",
      "verified": true,
      "distance": 0.284,
      "threshold": 0.670,
      "model": "SFace_Deep_Neural_Network"
    }
  ],
  "overall_status": "SUCCESS",
  "supabase_sync": {
    "synced": true,
    "status": "success"
  }
}
```

---

### 3. Fetch Verification Record
```http
GET /api/v1/supabase/get/{session_id_or_id_number}
```

**Response**: Returns the matched verification session row from Supabase Cloud or local store.

---

### 4. List Verification Sessions
```http
GET /api/v1/supabase/list
```

**Response**: Returns the 50 most recent applicant verification records for the Client Admin review table.

---

### 5. Superadmin B2B Services Catalog
```http
GET /api/v1/b2b/verification-services
```

**Response**: Returns available verification modules (Aadhaar & Face, PAN & Face, Eye Tracking, etc.).

---

## Security, Privacy & UIDAI Compliance

- **UIDAI Data Masking**: Aadhaar card numbers are masked by default (first 8 digits masked: `XXXX XXXX 1234`) in compliant views.
- **Strict PII Sanitization in Git**: The root `.gitignore` strictly excludes all uploaded applicant identity documents, live selfies, face crops, and temporary logs from version control.
- **Isolated Secret Management**: Cloud credentials (`.env`) are never committed to the repository; `.env.example` provides safe placeholder schemas.
- **Row Level Security (RLS)**: Enforces database boundaries so tenant clients access only their respective verification sessions.
- **Ephemeral Processing**: Biometric embeddings are computed in memory during the verification request lifecycle without storing raw biometric vectors permanently.

---

## License

This project is licensed under the [MIT License](LICENSE).
