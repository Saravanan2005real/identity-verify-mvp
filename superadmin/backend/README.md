# Superadmin Backend API (`superadmin/backend`)

The **Superadmin Backend API** is a high-performance REST service built with **FastAPI** and **SQLAlchemy**. It powers multi-tenant organization provisioning, platform governance, B2B verification service catalog distribution, and administrative metrics.

---

## Key Features

- **RBAC & Supabase JWT Security**:
  - Protected by `auth_validator.py` and the `require_superadmin` FastAPI dependency.
  - Validates Supabase RS256 / HS256 Bearer tokens and checks `app_metadata` or the database membership table for the `superadmin` role.
  - Cross-tenant leakage is strictly prevented.
- **Explicit CORS Policy**:
  - Restricts cross-origin requests strictly to trusted admin portal origins (`http://localhost:8081`, `http://localhost:8082`, `http://localhost:5174`, etc.).
- **B2B Service Catalog**:
  - Serves available verification engine capabilities (`/api/v1/b2b/verification-services`).
- **Tenant Management & Analytics**:
  - Tracks tenant accounts, verification pipelines, and dashboard statistics via SQLite / PostgreSQL.
- **OpenAPI & Swagger Documentation**:
  - Interactive API documentation auto-generated at `/docs` and `/redoc`.

---

## Technology Stack

- **Framework**: FastAPI (Python 3.10+)
- **ORM & Database**: SQLAlchemy with SQLite (`superadmin.db`) or PostgreSQL
- **Security**: JWT validation via PyJWT, cryptography, and Supabase Auth
- **Server**: Uvicorn ASGI server

---

## Project Structure

```
superadmin/backend/
├── auth_validator.py        # Supabase JWT token verification & superadmin role checker
├── database.py              # Database connection, session maker, and SQLAlchemy models
├── main.py                  # FastAPI application entrypoint, CORS, and route mounts
├── models/                  # Database model definitions
├── routers/
│   └── dashboard.py         # Dashboard analytics & metrics endpoints
├── schemas/                 # Pydantic request & response schemas
├── superadmin.db            # Local SQLite database file (offline fallback)
└── requirements.txt         # Python dependencies
```

---

## API Endpoints

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | No | Health check and welcome message |
| `GET` | `/api/dashboard/stats` | Superadmin JWT | Platform-wide verification and tenant analytics |
| `GET` | `/api/v1/b2b/dashboard` | Superadmin JWT | Tenant metrics and verification volume |
| `GET` | `/api/v1/b2b/verification-services` | No | Catalog of available verification modules |
| `GET` | `/docs` | No | Interactive Swagger UI API documentation |

---

## Getting Started

### 1. Setup Virtual Environment & Install Dependencies
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Linux / macOS
source venv/bin/activate

pip install -r requirements.txt
```

### 2. Start the Server (Port 8000)
```bash
uvicorn main:app --reload --port 8000
```
or run directly:
```bash
python main.py
```

- API Base URL: **`http://localhost:8000`**
- Swagger Documentation: **`http://localhost:8000/docs`**
