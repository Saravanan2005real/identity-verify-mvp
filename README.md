# Identity Verify MVP

An Electronic Know Your Customer (eKYC) Minimum Viable Product (MVP) focusing on identity verification using advanced biometrics, OCR, and liveness detection.

## Project Structure

This repository is organized into three main components:

1. **Superadmin Dashboard** (`/superadmin`): Contains both frontend and backend systems for overarching management of the platform and analytics.
2. **Admin Dashboard** (`/admin`): Contains the frontend interface for tenant-level administrative tasks.
3. **Products & Demos** (`/products`): Contains the core verification modules and interactive demonstrations:
    - **Audio Liveness Detection** (`demo_audio_liveness.html`)
    - **Eye Tracking for Liveness** (`demo_eye_tracking.html` using WebGazer)
    - **OCR & Face Recognition** (`demo_ocr_face.html` using MediaPipe)

## Architecture

The system follows a modular architecture separating the core verification products from the administrative dashboards.

```mermaid
graph TD
    classDef frontend fill:#3498db,stroke:#2980b9,stroke-width:2px,color:#fff
    classDef backend fill:#2ecc71,stroke:#27ae60,stroke-width:2px,color:#fff
    classDef product fill:#e67e22,stroke:#d35400,stroke-width:2px,color:#fff
    classDef user fill:#9b59b6,stroke:#8e44ad,stroke-width:2px,color:#fff

    User(("End User")):::user
    Admin(("Tenant Admin")):::user
    SuperAdmin(("Super Admin")):::user

    subgraph Products ["Core Verification Products"]
        OCR["OCR & Face Rec<br/>MediaPipe"]:::product
        EyeTrack["Eye Tracking<br/>WebGazer"]:::product
        AudioLive["Audio Liveness"]:::product
    end

    subgraph Admin_Portal ["Admin Portal"]
        AdminFE["Admin Frontend<br/>React/JS"]:::frontend
    end

    subgraph SuperAdmin_Portal ["Superadmin Portal"]
        SuperAdminFE["Superadmin Frontend<br/>React/JS"]:::frontend
        SuperAdminBE["Superadmin Backend<br/>Python"]:::backend
        DB[("System Database")]
    end

    User -->|"Interacts with"| Products
    Products -->|"Sends Verification Data"| SuperAdminBE
    
    Admin -->|"Manages Users/Settings"| AdminFE
    AdminFE -->|"API Calls"| SuperAdminBE
    
    SuperAdmin -->|"System Overview"| SuperAdminFE
    SuperAdminFE -->|"API Calls"| SuperAdminBE
    
    SuperAdminBE --> DB
```

## Technologies Used

- **Frontend**: JavaScript, HTML, CSS (React likely used in admin/superadmin based on App.js)
- **Backend**: Python (Superadmin backend)
- **Biometrics & Vision**: 
  - MediaPipe for Face Mesh and Vision tasks
  - WebGazer for Eye Tracking
  - Audio processing for Liveness

## Getting Started

*(Instructions on how to run each module will be added here. Typically involves starting a Python backend server and serving the frontend assets.)*
