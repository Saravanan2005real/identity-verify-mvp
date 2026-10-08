from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db, Company, Product, DashboardStat

router = APIRouter()

@router.get("/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    companies_count = db.query(Company).count()
    stat = db.query(DashboardStat).first()
    
    if not stat:
        return {
            "total_companies": companies_count,
            "total_links_generated": 0,
            "total_service_usage": 0,
            "total_payments": 0.0
        }
        
    return {
        "total_companies": companies_count,
        "total_links_generated": stat.total_links_generated,
        "total_service_usage": stat.total_service_usage,
        "total_payments": stat.total_payments
    }

@router.get("/companies")
def get_companies(db: Session = Depends(get_db)):
    return db.query(Company).all()

@router.get("/products")
def get_products(db: Session = Depends(get_db)):
    return db.query(Product).all()
