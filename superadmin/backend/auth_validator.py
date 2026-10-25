import os
import time
import json
import hmac
import hashlib
import base64
import logging
import urllib.request
import urllib.parse
import urllib.error

logger = logging.getLogger("auth_validator")

# Secrets and environment configs
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://mhxhttawwpqywedzpybf.supabase.co").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", os.getenv("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fa7-pjSYD5TS9Z-YxOUMGQ_JrX2jY-E"))
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
APPLICANT_SESSION_SECRET = os.getenv("APPLICANT_SESSION_SECRET", "verifyyy_applicant_session_hmac_secret_2026")
ASSET_SIGNING_SECRET = os.getenv("ASSET_SIGNING_SECRET", "verifyyy_asset_signed_url_hmac_secret_2026")

ALLOWED_CORS_ORIGINS = {
    "http://localhost:8081",
    "http://localhost:8082",
    "http://localhost:5174",
    "http://127.0.0.1:8081",
    "http://127.0.0.1:8082",
    "http://127.0.0.1:5174",
}

def verify_supabase_token(access_token: str) -> dict:
    if not access_token:
        raise ValueError("Missing authentication token.")

    clean_token = access_token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    if not clean_token:
        raise ValueError("Empty bearer token provided.")

    if not SUPABASE_URL or SUPABASE_URL.startswith("https://your-project-ref"):
        raise ValueError("Supabase URL is not properly configured.")

    auth_url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json"
    }

    try:
        req = urllib.request.Request(auth_url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                user_data = json.loads(response.read().decode("utf-8"))
                return user_data
            else:
                raise ValueError(f"Supabase auth returned HTTP {response.status}")
    except urllib.error.HTTPError as e:
        logger.warning(f"Supabase token verification failed: HTTP {e.code}")
        raise ValueError("Invalid or expired authentication token.")
    except Exception as e:
        logger.error(f"Error connecting to Supabase Auth: {str(e)}")
        raise ValueError("Unable to verify authentication token.")

def get_user_tenant_membership(user_id: str, access_token: str) -> list:
    clean_token = access_token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    url = f"{SUPABASE_URL}/rest/v1/organization_members?select=organization_id,role&user_id=eq.{urllib.parse.quote(user_id)}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json"
    }

    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                memberships = json.loads(response.read().decode("utf-8"))
                return memberships
            return []
    except Exception as e:
        logger.warning(f"Could not load tenant membership for user {user_id}: {e}")
        return []

def is_superadmin(user_data: dict, memberships: list) -> bool:
    app_meta = user_data.get("app_metadata", {})
    if app_meta.get("role") == "superadmin":
        return True
    
    for m in (memberships or []):
        if m.get("role") == "superadmin":
            return True
            
    return False

import secrets

# In-memory session tracking for applicant tokens (maps token_hash -> session state)
# In production clusters, this can be backed by Redis or PostgreSQL
_ACTIVE_APPLICANT_SESSIONS = {}
_REVOKED_TOKEN_HASHES = set()

def create_applicant_token(pid: str, flow: str, tenant_id: str = "default-org", ttl_seconds: int = 3600) -> str:
    """
    Generate a cryptographically secure, signed applicant session token.
    Includes:
      - secure random nonce (secrets.token_hex)
      - strictly bounded allowed workflow steps (parsed from flow)
      - expiration timestamp
      - tenant scoping
    """
    exp = int(time.time()) + ttl_seconds
    nonce = secrets.token_hex(16)
    allowed_steps = [s.strip().upper() for s in (flow or "").split(",") if s.strip()]

    payload = {
        "pid": pid,
        "flow": flow,
        "allowed_steps": allowed_steps,
        "tenant_id": tenant_id,
        "nonce": nonce,
        "exp": exp,
        "created_at": int(time.time()),
    }
    payload_str = json.dumps(payload, separators=(',', ':'), sort_keys=True)
    payload_b64 = base64.urlsafe_b64encode(payload_str.encode('utf-8')).decode('utf-8').rstrip('=')
    
    sig = hmac.new(
        APPLICANT_SESSION_SECRET.encode('utf-8'),
        payload_b64.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    full_token = f"{payload_b64}.{sig}"
    token_hash = hashlib.sha256(full_token.encode('utf-8')).hexdigest()
    
    # Track session state
    _ACTIVE_APPLICANT_SESSIONS[token_hash] = {
        "pid": pid,
        "tenant_id": tenant_id,
        "allowed_steps": allowed_steps,
        "completed_steps": set(),
        "exp": exp,
        "used": False
    }

    return full_token

def verify_applicant_token(token: str) -> dict:
    """
    Verify and decode a signed applicant verification session token.
    Enforces signature authenticity, expiration, and revocation status.
    """
    if not token or "." not in token:
        raise ValueError("Invalid applicant token format.")
        
    payload_b64, sig = token.split(".", 1)
    
    expected_sig = hmac.new(
        APPLICANT_SESSION_SECRET.encode('utf-8'),
        payload_b64.encode('utf-8'),
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Tampered applicant session token.")
        
    padding = '=' * (-len(payload_b64) % 4)
    try:
        payload_json = base64.urlsafe_b64decode((payload_b64 + padding).encode('utf-8')).decode('utf-8')
        payload = json.loads(payload_json)
    except Exception:
        raise ValueError("Malformed applicant session payload.")
        
    token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
    if token_hash in _REVOKED_TOKEN_HASHES:
        raise ValueError("This applicant session token has been revoked.")

    exp = payload.get("exp", 0)
    if time.time() > exp:
        raise ValueError("Applicant session token has expired.")
        
    # Check if session is tracked in active registry
    if token_hash in _ACTIVE_APPLICANT_SESSIONS:
        session_state = _ACTIVE_APPLICANT_SESSIONS[token_hash]
        payload["completed_steps"] = list(session_state.get("completed_steps", []))
        payload["is_used"] = session_state.get("used", False)
    else:
        # Fallback registration if restarted
        _ACTIVE_APPLICANT_SESSIONS[token_hash] = {
            "pid": payload.get("pid"),
            "tenant_id": payload.get("tenant_id"),
            "allowed_steps": payload.get("allowed_steps", []),
            "completed_steps": set(),
            "exp": exp,
            "used": False
        }
        payload["completed_steps"] = []
        payload["is_used"] = False

    payload["token_hash"] = token_hash
    return payload

def revoke_applicant_token(token: str) -> bool:
    """Explicitly revoke an applicant token (e.g. upon completion or security flag)."""
    try:
        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        _REVOKED_TOKEN_HASHES.add(token_hash)
        _ACTIVE_APPLICANT_SESSIONS.pop(token_hash, None)
        return True
    except Exception:
        return False

def record_applicant_step_completion(token: str, step_name: str) -> bool:
    """Record verified completion of a mandatory workflow step."""
    try:
        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        if token_hash in _ACTIVE_APPLICANT_SESSIONS:
            _ACTIVE_APPLICANT_SESSIONS[token_hash]["completed_steps"].add(step_name.upper())
            return True
        return False
    except Exception:
        return False

def check_step_allowed(payload: dict, step_name: str) -> bool:
    """Enforce that the requested operation is permitted in this token's workflow."""
    allowed = payload.get("allowed_steps", [])
    step = step_name.upper()
    # If the pipeline includes composite steps like PAN_FACE, it permits PAN and LIVE_VERIFY
    for a in allowed:
        if step == a or (step in ("PAN", "AADHAAR") and (f"{step}_FACE" in a or step in a)):
            return True
        if step in ("LIVE_VERIFY", "FACE_MATCH") and ("_FACE" in a):
            return True
        if step == "EYE_TRACKING" and "EYE_TRACKING" in a:
            return True
    return False

def generate_signed_asset_url(filename: str, tenant_id: str = "default-org", ttl_seconds: int = 900) -> str:
    """
    Generate a short-lived signed URL for accessing document or face images.
    Returns: '/ocr_uploads/{filename}?expires={exp}&sig={sig}'
    """
    if not filename:
        return None
    basename = os.path.basename(filename)
    exp = int(time.time()) + ttl_seconds
    message = f"{basename}:{exp}".encode('utf-8')
    sig = hmac.new(ASSET_SIGNING_SECRET.encode('utf-8'), message, hashlib.sha256).hexdigest()
    return f"/ocr_uploads/{basename}?expires={exp}&sig={sig}"

def verify_signed_asset_url(filename: str, exp_str: str, sig: str, tenant_id: str = "default-org") -> bool:
    """
    Validate the HMAC signature and expiration timestamp of a signed asset URL.
    """
    if not exp_str or not sig:
        return False
    try:
        exp = int(exp_str)
        if time.time() > exp:
            return False
        basename = os.path.basename(filename)
        expected_msg = f"{basename}:{exp}".encode('utf-8')
        expected_sig = hmac.new(ASSET_SIGNING_SECRET.encode('utf-8'), expected_msg, hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, expected_sig)
    except Exception:
        return False

def mask_identity_number(id_num: str, doc_type: str = "ID") -> str:
    """
    Safely mask sensitive identity numbers for display in responses, logs, and UIs.
    Example Aadhaar: 'XXXX-XXXX-9012'
    Example PAN: 'ABCDE****F'
    """
    if not id_num or not isinstance(id_num, str):
        return ""
    clean = id_num.strip()
    digits = "".join(c for c in clean if c.isdigit())
    alpha_num = "".join(c for c in clean if c.isalnum())

    doc_upper = (doc_type or "").upper()

    if "AADHAAR" in doc_upper or len(digits) == 12:
        if len(digits) == 12:
            return f"XXXX-XXXX-{digits[-4:]}"
        elif len(clean) >= 4:
            return f"XXXX-XXXX-{clean[-4:]}"
    elif "PAN" in doc_upper or (len(alpha_num) == 10 and alpha_num[:5].isalpha()):
        if len(alpha_num) == 10:
            return f"{alpha_num[:5]}****{alpha_num[-1]}"
        elif len(clean) >= 5:
            return f"{clean[:3]}****{clean[-1]}"
    
    if len(clean) > 4:
        return "*" * (len(clean) - 4) + clean[-4:]
    return "****"

def validate_file_content_and_magic(file_path: str) -> bool:
    """
    Validate uploaded file using magic numbers (header bytes) to prevent extension spoofing.
    Allowed headers:
      - JPEG: \xFF\xD8\xFF
      - PNG: \x89PNG\r\n\x1a\n
      - PDF: %PDF-
    """
    if not os.path.exists(file_path):
        return False
    try:
        with open(file_path, "rb") as f:
            header = f.read(16)
        if len(header) < 4:
            return False
        # JPEG check
        if header.startswith(b"\xff\xd8\xff"):
            return True
        # PNG check
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return True
        # PDF check
        if header.startswith(b"%PDF-"):
            return True
        return False
    except Exception as e:
        logger.warning(f"File magic check failed: {e}")
        return False
