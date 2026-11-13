# AI OCR & Face Verification Engine (`products/ocr_engine`)

The **AI OCR & Face Verification Engine** is the core computer vision and biometrics microservice of the Verifyyy platform. Running on **Flask** on port **5001**, it performs high-accuracy document classification, optical character recognition (OCR), unwarped face crop extraction, and multi-tier facial verification.

---

## Architectural Highlights

### 1. Zero-Distortion Face Extraction
Standard document perspective correction stretches or compresses faces embedded on identity cards when rectifying skewed photos, leading to false rejection in biometric matchers.
Verifyyy eliminates this by:
1. Detecting document corners via convex hull and contour approximation.
2. Detecting the embedded photo using RetinaFace landmark detection on the **unwarped, original frame**.
3. Mapping coordinates back to the pristine camera capture before extracting reference face crops.

### 2. Multi-Tier Cascaded Face Verification
- **Tier 1 — SFace 128-D ONNX Neural Net**:
  Uses OpenCV DNN (`sface.onnx` via `cv2.FaceRecognizerSF`) to produce 128-dimensional biometric embeddings. Performs cosine similarity comparisons in **<15ms**.
- **Tier 2 — ArcFace 512-D Neural Embedding**:
  High-dimensional angular margin loss feature projection with adaptive threshold relaxation (0.75) optimized for degraded or laminated physical ID cards.
- **Tier 3 — OpenCV Algorithmic Fallback**:
  Normalized 2D cross-correlation and ORB descriptor matching ensuring 100% functionality in air-gapped or low-resource offline environments.

### 3. Dual-Pass OCR & UIDAI Compliance
- **Dual-Pass PaddleOCR**: Combines high-resolution contrast-limited adaptive histogram equalization (CLAHE) with dual-pass text detection and heuristic error correction.
- **UIDAI Masking**: Compliant 8-digit Aadhaar masking (`XXXX XXXX 1234`) with real Verhoeff checksum validation.
- **PAN Extraction**: Regular expression parsing of 10-character alphanumeric tax identifiers, DOB, and holder name.

### 4. Security & Hardening (`auth_validator.py`)
- **HMAC-SHA256 Applicant Session Tokens**:
  Time-limited applicant tokens bound to specific pipelines (`pid`) and flows (`flow`).
  Issuance restricted to authenticated tenant administrators via `/api/v1/auth/applicant_session`.
- **Signed Biometric Asset URLs**:
  Prevents unauthorized scraping of ID photos and live selfies. Assets are served only with valid cryptographic signatures and expiration timestamps.
- **Workflow Step & Prerequisite Enforcement**:
  Mandatory prerequisite validation: applicants cannot call `/api/v1/live_verify` without having completed the document OCR step first.
- **DoS Protection & Strict Whitelisting**:
  Enforces a 10MB payload limit (`MAX_CONTENT_LENGTH`) and strict origin whitelisting (`ALLOWED_ORIGINS`).
- **Data Retention & Asset Purging**:
  Administrative endpoint `/api/v1/admin/purge_expired_assets` allows superadmins to purge temporary files older than a specified retention window (default: 24h).

---

## Project Structure

```
products/ocr_engine/
├── auth_validator.py        # Token validation, signed URLs, and workflow enforcement
├── download_sface.py        # Script to download OpenCV SFace ONNX model binary
├── engine.py                # Main Flask application and computer vision endpoints
├── quality.py               # Blur (Laplacian), glare, illumination, and contrast analyzer
├── sface.onnx               # OpenCV SFace 128-D ONNX neural network model
├── supabase_client.py       # Asynchronous Supabase REST client with offline fallback
├── FSRCNN_x2.pb             # Super-resolution model for low-resolution document crops
├── Dockerfile               # Container build configuration
└── requirements.txt         # Python dependencies (OpenCV, PaddleOCR, Flask, PyJWT, etc.)
```

---

## API Reference

### 1. Document OCR & Face Extraction
```http
POST /api/v1/ocr
Content-Type: multipart/form-data
```
- **Form Data**:
  - `image`: Document image file (JPEG, PNG).
  - `doc_type`: (Optional) `aadhaar` | `pan` | `auto`.
- **Headers**:
  - `X-Applicant-Token` (or Supabase Authorization Bearer)
- **Response**: Extracted metadata (Name, DOB, ID Number), OCR confidence, and signed reference face crop URL.

### 2. Live Face Verification & Liveness
```http
POST /api/v1/live_verify
Content-Type: application/json
```
- **Body**:
  - `image`: Base64-encoded webcam selfie frame.
  - `session_id`: Unique verification session UUID.
  - `step3_faces`: Array containing the reference ID crop filename.
  - `applicant_token`: (Optional if passed in `X-Applicant-Token` header)
- **Response**: Biometric verdict (`face_match: true/false`), cosine distance, model used, and Supabase sync status.

### 3. Issue Applicant Session Token
```http
POST /api/v1/auth/applicant_session
Content-Type: application/json
Authorization: Bearer <tenant_or_superadmin_jwt>
```
- **Body**:
  - `pid`: Pipeline ID (e.g. `FLOW-001`)
  - `flow`: Flow string (e.g. `PAN_FACE`)
  - `ttl_seconds`: Token validity period (default: 7200s, max: 86400s)
- **Response**: Signed applicant token and expiration info.

### 4. Admin Asset Retention Purge
```http
POST /api/v1/admin/purge_expired_assets
Authorization: Bearer <superadmin_jwt>
```
- **Body**: `{"retention_hours": 24}`
- **Response**: Count of purged assets and status.

### 5. Fetch Session & List Sessions
- `GET /api/v1/supabase/get/<session_id>`: Get verification session details.
- `GET /api/v1/supabase/list?limit=50`: List recent verification records (requires tenant authentication).

---

## Getting Started

### 1. Setup Virtual Environment
```bash
cd products/ocr_engine
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Download SFace Model (if not already present)
```bash
python download_sface.py
```

### 4. Start the Engine
```bash
# Run standalone on port 5001:
python engine.py
```
Or with explicit environment variable:
```bash
OCR_STANDALONE=1 python engine.py
```

Server will start on **`http://localhost:5001`**.
