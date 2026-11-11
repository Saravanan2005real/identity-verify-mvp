import os
from dotenv import load_dotenv, find_dotenv
from sqlalchemy import create_engine, Column, Integer, String, Float
from sqlalchemy.orm import declarative_base, sessionmaker

_this_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_this_dir, "..", ".."))
_root_env = os.path.join(_repo_root, ".env")
if os.path.exists(_root_env):
    load_dotenv(_root_env, override=False)
else:
    _found = find_dotenv(usecwd=True)
    if _found:
        load_dotenv(_found, override=False)

# Use DATABASE_URL from .env or fallback to SQLite for local development
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./superadmin.db")

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    import auth_validator
    if not auth_validator.local_fallback_allowed():
        raise RuntimeError(
            "PRODUCTION CONFIGURATION ERROR: SQLite database fallback is disallowed in production. "
            "Please configure a valid PostgreSQL DATABASE_URL in the environment."
        )
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)

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

class SuperadminAccessKey(Base):
    __tablename__ = "superadmin_access_keys"
    id = Column(Integer, primary_key=True, index=True)
    access_key = Column(String, unique=True, index=True)
    target_email = Column(String, index=True)
    created_by_email = Column(String)
    role = Column(String, default="superadmin")
    note = Column(String, default="")
    status = Column(String, default="PENDING")  # PENDING, ACCEPTED, REVOKED
    created_at = Column(String)
    accepted_at = Column(String, nullable=True)
    accepted_by_user_id = Column(String, nullable=True)

class AuthorizedSuperadmin(Base):
    __tablename__ = "authorized_superadmins"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    role = Column(String, default="superadmin")
    status = Column(String, default="ACTIVE")  # ACTIVE, REVOKED
    added_by = Column(String)
    added_at = Column(String)
    access_key_used = Column(String, nullable=True)
    user_id = Column(String, nullable=True)

def init_db():
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
