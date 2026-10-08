from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, sessionmaker

SQLALCHEMY_DATABASE_URL = "sqlite:///./superadmin.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Company(Base):
    __tablename__ = "companies"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    usage = Column(Integer, default=0)
    status = Column(String, default="Active")

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    active_users = Column(Integer, default=0)

class DashboardStat(Base):
    __tablename__ = "dashboard_stats"
    id = Column(Integer, primary_key=True, index=True)
    total_links_generated = Column(Integer, default=0)
    total_service_usage = Column(Integer, default=0)
    total_payments = Column(Float, default=0.0)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
