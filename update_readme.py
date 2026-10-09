content = """# Identity Verify MVP

An Electronic Know Your Customer (eKYC) Minimum Viable Product (MVP) focusing on advanced identity verification. The platform leverages cutting-edge computer vision, OCR, face verification, and liveness detection to seamlessly verify user identities.

## Key Upgrades & Features

- **Universal ID OCR (Aadhaar & PAN)**: Automatic document type detection (`detect_document_type`) with specialized parsing for Aadhaar and PAN cards.
- **Unwarped Face Extraction**: Extracts the face directly from the raw, unwarped camera frame using RetinaFace to completely eliminate aspect ratio distortion and geometric squashing caused by perspective warping.
- **Advanced Face Verification (ArcFace)**: Uses DeepFace/ArcFace to project faces into a 512-dimensional vector. Evaluates the Cosine Distance and mathematically relaxes the threshold to handle low-quality or degraded printed ID photos (e.g., old PAN cards).
- **Responsive Embedded Dashboard**: The React Native Superadmin Dashboard seamlessly loads the independent eKYC modules via responsive `iframes`.
- **Global Design System**: A unified UI theme (Teal-700/Slate-50) applied across all verification modules.
- **Eye Tracking Calibration**: Precision calibration using WebGazer with exactly 1.0-second hover times and fully responsive dot positioning.

## Architecture

The system follows a microservice architecture, utilizing a centralized Nginx reverse proxy to route traffic between the React Native frontend, static HTML module demos, and FastAPI backend services.

```mermaid
graph TD
    classDef frontend fill:#3498db,stroke:#2980b9,stroke-width:2px,color:#fff
    classDef backend fill:#2ecc71,stroke:#27ae60,stroke-width:2px,color:#fff
    classDef proxy fill:#f39c12,stroke:#d35400,stroke-width:2px,color:#fff
    classDef user fill:#9b59b6,stroke:#8e44ad,stroke-width:2px,color:#fff

    User(("End User")):::user
    
    subgraph ReverseProxy ["Central Nginx Proxy (Port 5174)"]
        Nginx["Nginx Server"]:::proxy
    end

    subgraph Products ["Verification Microservices"]
        OCR["OCR & Face Engine<br/>(RetinaFace + ArcFace)"]:::backend
        EyeTrack["Eye Tracking Backend<br/>(FastAPI)"]:::backend
        StaticDemos["Static HTML Demos<br/>(Served by Nginx)"]:::frontend
    end

    subgraph SuperAdmin_Portal ["Superadmin Portal"]
        SuperAdminFE["Superadmin Dashboard<br/>(React Native Web)"]:::frontend
        SuperAdminBE["Superadmin Backend<br/>(FastAPI)"]:::backend
    end

    User -->|"Access Dashboard"| SuperAdminFE
    SuperAdminFE -->|"Embeds Modules via iframe"| Nginx
    
    Nginx -->|"Serves /"| StaticDemos
    Nginx -->|"Routes /api/v1/ocr/*"| OCR
    Nginx -->|"Routes /api/v1/eye/*"| EyeTrack
    
    SuperAdminFE -->|"Manages Analytics"| SuperAdminBE
```

## Technologies Used

- **Frontend**: React Native Web, Vanilla JS/HTML/CSS for module demos
- **Proxy**: Nginx
- **Backend**: Python (FastAPI, Flask)
- **AI / Computer Vision**: 
  - **PaddleOCR**: Dual-pass text extraction with AI-based error correction.
  - **RetinaFace**: Precise face detection and 5-point facial landmark alignment.
  - **ArcFace (DeepFace)**: High-dimensional face verification and feature extraction.
  - **WebGazer**: Browser-based eye tracking.

## Getting Started

To run the complete platform, start the following three components in separate terminals. 

*(Note: If this is your first time, ensure Docker Desktop is running and you have run `npm install` in the frontend directory.)*

### 1. Verification Modules & Proxy (Docker)
This starts the OCR AI engine, the Eye Tracking engine, and the Nginx reverse proxy.
Open a terminal in the root directory (`C:\Users\DINESH\mvp\identity-verify-mvp`) and run:
```bash
docker compose up -d
```

### 2. Superadmin Backend (FastAPI)
This runs the core API powering the Superadmin management dashboard.
Open a terminal in `superadmin/backend` and run:
```bash
uvicorn main:app --reload
```

### 3. Superadmin Frontend (React Native Web)
This launches the React Native user interface.
Open a terminal in `superadmin/frontend` and run:
```bash
npm run web
```

## Module URLs

Once the services are running, the application and its independent modules are accessible at:
- **Superadmin Dashboard**: [http://localhost:8081](http://localhost:8081)
- **Standalone Module Demos (Nginx)**: [http://localhost:5174](http://localhost:5174)
- **OCR AI Microservice**: [http://localhost:5001](http://localhost:5001)
- **Eye Tracking Microservice**: [http://localhost:5002](http://localhost:5002)
"""

with open(r'C:\Users\DINESH\mvp\identity-verify-mvp\README.md', 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated README.md")
