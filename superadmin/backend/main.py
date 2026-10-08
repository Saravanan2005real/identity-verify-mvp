from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import dashboard
from database import init_db

# Initialize database tables
init_db()

app = FastAPI(title="Super Admin API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])

@app.get("/")
def read_root():
    return {"status": "success", "message": "Welcome to the Super Admin API"}

from sqlalchemy.orm import Session
from fastapi import Depends
from database import get_db, Company, DashboardStat, Product

@app.get("/api/v1/b2b/dashboard")
def get_b2b_dashboard(company_id: int = 1, db: Session = Depends(get_db)):
    # Pull actual data from the database, or return 0 if none exists.
    # We remove the hardcoded '150', '142', '5' from here.
    stat = db.query(DashboardStat).first()
    
    # Normally you'd query links and pipelines directly
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
            {"id": "aadhar", "name": "Aadhaar Verification", "desc": "Verify Aadhaar via OTP"},
            {"id": "pan", "name": "PAN Verification", "desc": "Verify PAN card details"},
            {"id": "liveness", "name": "Liveness Detection", "desc": "Detect user liveness via camera"}
        ]
    }
