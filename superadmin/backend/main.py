import os
import sys

# Ensure backend directory is in sys.path for sibling module imports
_this_dir = os.path.dirname(os.path.abspath(__file__))
if _this_dir not in sys.path:
    sys.path.insert(0, _this_dir)

from fastapi import FastAPI, Depends, HTTPException, Header, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from routers import dashboard
from database import init_db, get_db, Company, DashboardStat, Product, SuperadminAccessKey, AuthorizedSuperadmin
from pydantic import BaseModel
import secrets
from datetime import datetime
import auth_validator

# Validate security configuration immediately at application startup
auth_validator.validate_startup_secrets()

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

# ---------------------------------------------------------------------------
# Superadmin Access Control & Invitation Management Endpoints
# ---------------------------------------------------------------------------

class IssueKeyRequest(BaseModel):
    target_email: str
    note: str = ""
    role: str = "superadmin"

class AcceptKeyRequest(BaseModel):
    email: str
    access_key: str
    user_id: str = None

class RevokeKeyRequest(BaseModel):
    access_key: str

class RevokeAdminRequest(BaseModel):
    email: str

def _generate_access_key_str() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    parts = ["".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(4)]
    return f"SA-KEY-{'-'.join(parts)}"

@app.get("/api/v1/superadmin/access/keys")
def list_access_keys(db: Session = Depends(get_db), auth_user = Depends(require_superadmin)):
    keys = db.query(SuperadminAccessKey).order_by(SuperadminAccessKey.id.desc()).all()
    return {"status": "success", "data": [
        {
            "id": k.id,
            "access_key": k.access_key,
            "target_email": k.target_email,
            "created_by": k.created_by_email,
            "role": k.role,
            "note": k.note,
            "status": k.status,
            "created_at": k.created_at,
            "accepted_at": k.accepted_at,
        } for k in keys
    ]}

@app.post("/api/v1/superadmin/access/keys/generate")
def generate_access_key(req: IssueKeyRequest, db: Session = Depends(get_db), auth_user = Depends(require_superadmin)):
    clean_email = req.target_email.strip().lower()
    if "@" not in clean_email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    
    # Check if user is already an active superadmin
    existing_admin = db.query(AuthorizedSuperadmin).filter(
        AuthorizedSuperadmin.email == clean_email,
        AuthorizedSuperadmin.status == "ACTIVE"
    ).first()
    if existing_admin:
        raise HTTPException(status_code=400, detail=f"User {clean_email} already has active Superadmin clearance.")

    key_str = _generate_access_key_str()
    key_entry = SuperadminAccessKey(
        access_key=key_str,
        target_email=clean_email,
        created_by_email=auth_user.get("user", {}).get("email", "admin"),
        role=req.role or "superadmin",
        note=req.note or "Superadmin Portal Clearance",
        status="PENDING",
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    db.add(key_entry)
    db.commit()
    db.refresh(key_entry)

    return {
        "status": "success",
        "message": f"Superadmin access key created for {clean_email}",
        "data": {
            "id": key_entry.id,
            "access_key": key_entry.access_key,
            "target_email": key_entry.target_email,
            "status": key_entry.status,
            "created_at": key_entry.created_at,
        }
    }

@app.post("/api/v1/superadmin/access/keys/accept")
def accept_access_key_endpoint(req: AcceptKeyRequest, db: Session = Depends(get_db)):
    clean_email = req.email.strip().lower()
    clean_key = req.access_key.strip().upper()

    key_record = db.query(SuperadminAccessKey).filter(SuperadminAccessKey.access_key == clean_key).first()
    if not key_record:
        raise HTTPException(status_code=404, detail="Access Key not found. Please verify the code entered.")
    
    if key_record.status == "REVOKED":
        raise HTTPException(status_code=400, detail="This Access Key has been revoked by an administrator.")
    if key_record.status == "ACCEPTED":
        raise HTTPException(status_code=400, detail="This Access Key has already been redeemed.")
    if key_record.target_email.lower() != clean_email:
        raise HTTPException(
            status_code=403, 
            detail=f"This Access Key was issued for {key_record.target_email}. Please redeem with the invited email."
        )

    # Mark key as accepted
    key_record.status = "ACCEPTED"
    key_record.accepted_at = datetime.utcnow().isoformat() + "Z"
    key_record.accepted_by_user_id = req.user_id

    # Add or activate in authorized superadmins
    admin = db.query(AuthorizedSuperadmin).filter(AuthorizedSuperadmin.email == clean_email).first()
    if not admin:
        admin = AuthorizedSuperadmin(
            email=clean_email,
            role=key_record.role or "superadmin",
            status="ACTIVE",
            added_by=key_record.created_by_email,
            added_at=datetime.utcnow().isoformat() + "Z",
            access_key_used=clean_key,
            user_id=req.user_id,
        )
        db.add(admin)
    else:
        admin.status = "ACTIVE"
        admin.access_key_used = clean_key
        admin.user_id = req.user_id

    db.commit()

    return {
        "status": "success",
        "message": "Superadmin clearance granted successfully!",
        "data": {
            "email": clean_email,
            "role": key_record.role,
            "status": "ACTIVE",
        }
    }

@app.post("/api/v1/superadmin/access/keys/revoke")
def revoke_access_key_endpoint(req: RevokeKeyRequest, db: Session = Depends(get_db), auth_user = Depends(require_superadmin)):
    clean_key = req.access_key.strip().upper()
    key_record = db.query(SuperadminAccessKey).filter(SuperadminAccessKey.access_key == clean_key).first()
    if not key_record:
        raise HTTPException(status_code=404, detail="Access Key not found.")
    key_record.status = "REVOKED"
    db.commit()
    return {"status": "success", "message": "Access Key revoked."}

@app.get("/api/v1/superadmin/access/superadmins")
def list_superadmins(db: Session = Depends(get_db), auth_user = Depends(require_superadmin)):
    admins = db.query(AuthorizedSuperadmin).filter(AuthorizedSuperadmin.status == "ACTIVE").all()
    return {"status": "success", "data": [
        {
            "id": a.id,
            "email": a.email,
            "role": a.role,
            "status": a.status,
            "added_by": a.added_by,
            "added_at": a.added_at,
            "access_key_used": a.access_key_used,
        } for a in admins
    ]}

@app.post("/api/v1/superadmin/access/superadmins/revoke")
def revoke_superadmin_endpoint(req: RevokeAdminRequest, db: Session = Depends(get_db), auth_user = Depends(require_superadmin)):
    clean_email = req.email.strip().lower()
    caller_email = auth_user.get("user", {}).get("email", "").lower()

    if clean_email == caller_email:
        raise HTTPException(status_code=400, detail="Cannot revoke your own access.")

    admin = db.query(AuthorizedSuperadmin).filter(AuthorizedSuperadmin.email == clean_email).first()
    if not admin:
        raise HTTPException(status_code=404, detail="Superadmin not found.")
    admin.status = "REVOKED"
    db.commit()
    return {"status": "success", "message": f"Superadmin access for {clean_email} revoked."}


