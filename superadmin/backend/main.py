from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from routers import dashboard
from database import init_db, get_db, Company, DashboardStat, Product
import auth_validator

# Initialize database tables
init_db()

app = FastAPI(title="Super Admin API", version="1.0.0")

ALLOWED_ORIGINS = [
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:5174",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:8082",
    "http://127.0.0.1:5174",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

def require_superadmin(authorization: str = Header(None)):
    """
    Enforce that the caller is authenticated via Supabase and possesses the 'superadmin' role.
    Protects superadmin operations from ordinary users and tenant administrators.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header."
        )

    token = authorization[7:].strip()
    try:
        user_data = auth_validator.verify_supabase_token(token)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e)
        )

    memberships = auth_validator.get_user_tenant_membership(user_data["id"], token)
    if not auth_validator.is_superadmin(user_data, memberships):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Superadmin role required."
        )

    return {"user": user_data, "memberships": memberships}

app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(require_superadmin)])

@app.get("/")
def read_root():
    return {"status": "success", "message": "Super Admin API"}

@app.get("/api/v1/b2b/dashboard")
def get_b2b_dashboard(company_id: int = 1, db: Session = Depends(get_db), auth_user = Depends(require_superadmin)):
    stat = db.query(DashboardStat).first()
    return {
        "status": "success",
        "data": {
            "pipelines_built": 0, 
            "links_generated": stat.total_links_generated if stat else 0,
            "verifications_completed": stat.total_service_usage if stat else 0,
            "recent_verifications": []
        }
    }

@app.get("/api/v1/b2b/verification-services")
def get_b2b_services():
    return {
        "status": "success",
        "data": [
            {"id": "aadhaar_face", "name": "Aadhaar & Face Verification", "desc": "Combined Aadhaar Document OCR & Live Face Verification with Liveness Check"},
            {"id": "pan_face", "name": "PAN & Face Verification", "desc": "Combined PAN Card Document OCR & Live Face Verification with Liveness Check"},
            {"id": "pan", "name": "PAN Verification (OCR Only)", "desc": "PAN Card Verification & Field Extraction"},
            {"id": "aadhaar", "name": "Aadhaar Verification (OCR Only)", "desc": "Aadhaar Card Verification & Field Extraction"},
            {"id": "eye_tracking", "name": "Eye Tracking & Attention Analysis", "desc": "WebGazer eye tracking and gaze calibration"}
        ]
    }

