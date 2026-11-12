"""
auth_validator.py — Verifyyy eKYC Platform Security Module
=============================================================
Provides:
  - Server-side Supabase JWT verification (fail-closed)
  - Tenant membership and role lookup
  - Cryptographically secure, signed applicant session tokens
  - Tenant-scoped HMAC signed asset URLs
  - Identity number masking
  - File magic-byte validation

Security design principles:
  - All secrets loaded exclusively from environment variables; no defaults
  - Startup validation raises RuntimeError if required secrets are absent or weak
  - Supabase connectivity errors raise ConnectionError (HTTP 503), not silenced
  - Token revocation is persistent-ready (Supabase table backed in production)
  - Signed URLs include tenant_id in HMAC to prevent cross-tenant reuse
  - Fallback token re-registration after restart has been removed
"""

import os
import sys
import time
import json
import hmac
import hashlib
import base64
import secrets as _secrets_mod
import logging
import urllib.request
import urllib.parse
import urllib.error

logger = logging.getLogger("auth_validator")

# Minimum acceptable secret length (32 hex chars = 128-bit minimum)
_MIN_SECRET_LEN = 32

# In-process registries (development/single-instance fallback)
_ACTIVE_APPLICANT_SESSIONS: dict = {}
_REVOKED_TOKEN_HASHES: set = set()
_TOKEN_ATTEMPTS: dict = {}


def record_applicant_attempt(token: str) -> int:
    """Record an attempt for the applicant token. Returns total attempt count."""
    try:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        _TOKEN_ATTEMPTS[token_hash] = _TOKEN_ATTEMPTS.get(token_hash, 0) + 1
        if token_hash in _ACTIVE_APPLICANT_SESSIONS:
            _ACTIVE_APPLICANT_SESSIONS[token_hash]["attempts"] = _TOKEN_ATTEMPTS[token_hash]
        return _TOKEN_ATTEMPTS[token_hash]
    except Exception:
        return 1


def get_applicant_attempts(token: str) -> int:
    """Get the attempt count for an applicant token."""
    try:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        return _TOKEN_ATTEMPTS.get(token_hash, 0)
    except Exception:
        return 0


def rollback_applicant_attempt(token: str) -> int:
    """Do not count attempts that end in 5xx / 502. Roll back attempt count."""
    try:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        if token_hash in _TOKEN_ATTEMPTS and _TOKEN_ATTEMPTS[token_hash] > 0:
            _TOKEN_ATTEMPTS[token_hash] -= 1
        if token_hash in _ACTIVE_APPLICANT_SESSIONS:
            _ACTIVE_APPLICANT_SESSIONS[token_hash]["attempts"] = _TOKEN_ATTEMPTS.get(token_hash, 0)
        return _TOKEN_ATTEMPTS.get(token_hash, 0)
    except Exception:
        return 0

# Module-level configuration placeholders
SUPABASE_URL = ""
SUPABASE_KEY = ""
SUPABASE_SERVICE_ROLE_KEY = ""
APPLICANT_SESSION_SECRET = ""
ASSET_SIGNING_SECRET = ""
ALLOWED_CORS_ORIGINS: set = set()
_REVOCATION_BACKEND = "memory"


# ---------------------------------------------------------------------------
# 1. Secret and environment loading — NO HARDCODED DEFAULTS
# ---------------------------------------------------------------------------

def load_environment() -> None:
    """
    Locate and load the root .env file if secrets are not already set.
    Preserves any explicitly passed environment variables (override=False).
    """
    try:
        from dotenv import load_dotenv, find_dotenv
        _this_dir = os.path.dirname(os.path.abspath(__file__))
        _repo_root = os.path.abspath(os.path.join(_this_dir, "..", ".."))
        _root_env = os.path.join(_repo_root, ".env")
        if os.path.exists(_root_env):
            load_dotenv(_root_env, override=False)
        else:
            _found_env = find_dotenv(usecwd=True)
            if _found_env:
                load_dotenv(_found_env, override=False)
    except ImportError:
        pass


def reload_secrets() -> None:
    """
    Synchronize module-level security configuration variables with current os.environ.
    Ensures runtime/test environment changes are reflected immediately.
    """
    global SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY
    global APPLICANT_SESSION_SECRET, ASSET_SIGNING_SECRET
    global ALLOWED_CORS_ORIGINS, _REVOCATION_BACKEND

    SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY", "") or os.getenv("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    APPLICANT_SESSION_SECRET = os.getenv("APPLICANT_SESSION_SECRET", "")
    ASSET_SIGNING_SECRET = os.getenv("ASSET_SIGNING_SECRET", "")

    raw_origins = os.getenv(
        "ALLOWED_CORS_ORIGINS",
        "http://localhost:8081,http://localhost:8082,http://localhost:5174,"
        "http://127.0.0.1:8081,http://127.0.0.1:8082,http://127.0.0.1:5174",
    )
    ALLOWED_CORS_ORIGINS = {o.strip() for o in raw_origins.split(",") if o.strip()}
    _REVOCATION_BACKEND = os.getenv("REVOCATION_BACKEND", "memory").lower()


# Initial load from environment or .env at module import
load_environment()
reload_secrets()


# ---------------------------------------------------------------------------
# 2. Production Configuration Validation & Environment Guards
# ---------------------------------------------------------------------------

def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")

def is_production() -> bool:
    return os.getenv("APP_ENV", "development").strip().lower() == "production"

def local_fallback_allowed() -> bool:
    """SQLite / in-memory fallback is a dev convenience only."""
    if is_production():
        return False
    return _env_bool("ALLOW_LOCAL_FALLBACK", True)

def validate_production_config() -> None:
    """Fail closed: refuse to boot in production with dev-only settings."""
    if not is_production():
        return

    problems = []

    # 1. Token revocation must be shared and persistent
    if os.getenv("REVOCATION_BACKEND", "memory").strip().lower() != "supabase":
        problems.append("REVOCATION_BACKEND must be 'supabase' (memory is per-process and lost on restart)")

    # 2. No silent local fallback
    if _env_bool("ALLOW_LOCAL_FALLBACK", False):
        problems.append("ALLOW_LOCAL_FALLBACK must be false")

    # 3. CORS: explicit, https-only, no localhost, no wildcard
    origins = [o.strip() for o in os.getenv("ALLOWED_CORS_ORIGINS", "").split(",") if o.strip()]
    if not origins:
        problems.append("ALLOWED_CORS_ORIGINS must be set")
    for o in origins:
        if o == "*":
            problems.append("CORS wildcard '*' is not allowed")
        elif not o.startswith("https://"):
            problems.append(f"CORS origin must use https: {o}")
        elif "localhost" in o or "127.0.0.1" in o:
            problems.append(f"CORS origin must not be localhost: {o}")

    # 4. Real Supabase credentials must exist
    for key in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
        if not os.getenv(key, "").strip() or "your-" in os.getenv(key, ""):
            problems.append(f"{key} is missing or still a placeholder")

    if problems:
        raise RuntimeError(
            "PRODUCTION CONFIGURATION ERROR - refusing to start:\n  - " + "\n  - ".join(problems)
        )


# ---------------------------------------------------------------------------
# 3. Startup secret validation
# ---------------------------------------------------------------------------

def _is_placeholder_secret(val: str) -> bool:
    if not val:
        return True
    s = str(val).strip()
    if "CHANGE_ME" in s or "your-" in s:
        return True
    if len(s) > 1 and len(set(s)) == 1:
        return True
    return False

def validate_startup_secrets() -> None:
    """
    Call once at application startup.
    Raises RuntimeError immediately if required secrets are absent, too short,
    contain placeholders (CHANGE_ME, your-, repeated chars),
    or if production environment violates production configuration guards.
    """
    reload_secrets()
    validate_production_config()
    errors = []
    if not SUPABASE_URL or SUPABASE_URL.startswith("https://your-project-ref") or "your-" in SUPABASE_URL or "CHANGE_ME" in SUPABASE_URL:
        errors.append("SUPABASE_URL is not configured or contains placeholder.")
    if not SUPABASE_KEY or _is_placeholder_secret(SUPABASE_KEY):
        errors.append("SUPABASE_KEY (publishable/anon key) is not configured or contains placeholder.")
    if not APPLICANT_SESSION_SECRET:
        errors.append("APPLICANT_SESSION_SECRET is not set.")
    elif len(APPLICANT_SESSION_SECRET) < _MIN_SECRET_LEN:
        errors.append(
            f"APPLICANT_SESSION_SECRET is too short ({len(APPLICANT_SESSION_SECRET)} chars); "
            f"minimum {_MIN_SECRET_LEN} characters required. "
            "Generate: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    elif _is_placeholder_secret(APPLICANT_SESSION_SECRET):
        errors.append("APPLICANT_SESSION_SECRET contains placeholder (CHANGE_ME/your-) or repeated characters.")
    if not ASSET_SIGNING_SECRET:
        errors.append("ASSET_SIGNING_SECRET is not set.")
    elif len(ASSET_SIGNING_SECRET) < _MIN_SECRET_LEN:
        errors.append(
            f"ASSET_SIGNING_SECRET is too short ({len(ASSET_SIGNING_SECRET)} chars); "
            f"minimum {_MIN_SECRET_LEN} characters required."
        )
    elif _is_placeholder_secret(ASSET_SIGNING_SECRET):
        errors.append("ASSET_SIGNING_SECRET contains placeholder (CHANGE_ME/your-) or repeated characters.")
    if errors:
        msg = "SECURITY CONFIGURATION ERROR — application cannot start:\n" + "\n".join(f"  * {e}" for e in errors)
        logger.critical(msg)
        raise RuntimeError(msg)
    logger.info("Startup secret validation passed.")



# ---------------------------------------------------------------------------
# 3. Supabase token verification — fail-CLOSED on connectivity errors
# ---------------------------------------------------------------------------

def verify_supabase_token(access_token: str) -> dict:
    """
    Verify a Supabase access token via the GoTrue /auth/v1/user endpoint.

    Raises:
        ValueError   — empty/blank input or GoTrue rejects the token (HTTP 4xx)
        ConnectionError — network/timeout; callers MUST map this to HTTP 503,
                          never fall through to weaker authentication.
    """
    if not access_token:
        raise ValueError("Missing authentication token.")

    clean_token = access_token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()
    if not clean_token:
        raise ValueError("Empty bearer token provided.")

    if not SUPABASE_URL or SUPABASE_URL.startswith("https://your-project-ref"):
        raise ValueError("Supabase URL is not configured.")

    auth_url = f"{SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    try:
        req = urllib.request.Request(auth_url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read().decode("utf-8"))
            raise ValueError(f"Supabase auth returned HTTP {response.status}")
    except urllib.error.HTTPError as e:
        logger.warning("Supabase token verification rejected: HTTP %s", e.code)
        raise ValueError("Invalid or expired authentication token.")
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        # Network-level failure — raise ConnectionError so callers can return 503.
        # Must NOT be caught and silenced.
        logger.error("Supabase Auth unreachable: %s", e)
        raise ConnectionError("Authentication service temporarily unavailable.")
    except ValueError:
        raise
    except Exception as e:
        logger.error("Unexpected error verifying Supabase token: %s", e)
        raise ConnectionError("Authentication service temporarily unavailable.")

def get_user_tenant_membership(user_id: str, access_token: str) -> list:
    """Load the caller's organization memberships. Returns [] on failure (non-fatal)."""
    clean_token = access_token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    url = (
        f"{SUPABASE_URL}/rest/v1/organization_members"
        f"?select=organization_id,role&user_id=eq.{urllib.parse.quote(user_id)}"
    )
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
    }
    try:
        req = urllib.request.Request(url, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                return json.loads(response.read().decode("utf-8"))
            return []
    except Exception as e:
        logger.warning("Could not load tenant membership for user %s: %s", user_id, e)
        return []


def is_superadmin(user_data: dict, memberships: list) -> bool:
    if user_data.get("app_metadata", {}).get("role") == "superadmin":
        return True
    return any(m.get("role") == "superadmin" for m in (memberships or []))


# ---------------------------------------------------------------------------
# 4. Revocation backend
# ---------------------------------------------------------------------------

def _is_revoked(token_hash: str) -> bool:
    """Check revocation registry. Fails closed if Supabase backend is unreachable."""
    if _REVOCATION_BACKEND == "supabase" and SUPABASE_SERVICE_ROLE_KEY:
        try:
            url = (
                f"{SUPABASE_URL}/rest/v1/revoked_applicant_tokens"
                f"?select=token_hash&token_hash=eq.{urllib.parse.quote(token_hash)}&limit=1"
            )
            hdrs = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            }
            req = urllib.request.Request(url, headers=hdrs, method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                return len(json.loads(resp.read().decode("utf-8"))) > 0
        except Exception as e:
            logger.error("Revocation DB check failed: %s — failing closed", e)
            return True  # fail-closed
    return token_hash in _REVOKED_TOKEN_HASHES


def _persist_revocation(token_hash: str, pid: str = "", reason: str = "explicit") -> None:
    _REVOKED_TOKEN_HASHES.add(token_hash)
    if _REVOCATION_BACKEND == "supabase" and SUPABASE_SERVICE_ROLE_KEY:
        try:
            url = f"{SUPABASE_URL}/rest/v1/revoked_applicant_tokens"
            hdrs = {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            }
            payload = json.dumps({"token_hash": token_hash, "pid": pid, "reason": reason,
                                   "revoked_at": int(time.time())}).encode("utf-8")
            req = urllib.request.Request(url, data=payload, headers=hdrs, method="POST")
            urllib.request.urlopen(req, timeout=3)
        except Exception as e:
            logger.error("Supabase revocation write failed: %s", e)
            raise RuntimeError(f"Failed to persist token revocation to Supabase: {e}") from e

# ---------------------------------------------------------------------------
# 5. Applicant token — creation, verification, revocation
# ---------------------------------------------------------------------------

def create_applicant_token(
    pid: str,
    flow: str,
    tenant_id: str,
    ttl_seconds: int = 3600,
    external_ref: str = None,
) -> str:
    """
    Generate a cryptographically signed applicant session token.
    All fields (pid, flow, allowed_steps, tenant_id, nonce, expiry, and optional external_ref)
    are included in the HMAC signature.
    """
    if not pid or not flow or not tenant_id:
        raise ValueError("pid, flow, and tenant_id are all required.")
    exp = int(time.time()) + ttl_seconds
    nonce = _secrets_mod.token_hex(16)
    allowed_steps = sorted({s.strip().upper() for s in flow.split(",") if s.strip()})
    payload = {
        "pid": pid,
        "flow": flow,
        "allowed_steps": allowed_steps,
        "tenant_id": tenant_id,
        "nonce": nonce,
        "exp": exp,
        "iat": int(time.time()),
    }
    if external_ref:
        payload["external_ref"] = str(external_ref).strip()

    payload_str = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    payload_b64 = base64.urlsafe_b64encode(payload_str.encode("utf-8")).decode("utf-8").rstrip("=")
    sig = hmac.new(
        APPLICANT_SESSION_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    full_token = f"{payload_b64}.{sig}"
    token_hash = hashlib.sha256(full_token.encode("utf-8")).hexdigest()
    _ACTIVE_APPLICANT_SESSIONS[token_hash] = {
        "pid": pid,
        "tenant_id": tenant_id,
        "allowed_steps": allowed_steps,
        "completed_steps": set(),
        "exp": exp,
        "nonce": nonce,
        "external_ref": str(external_ref).strip() if external_ref else None,
    }
    return full_token


def verify_applicant_token(token: str) -> dict:
    """
    Verify a signed applicant session token.

    Raises ValueError for: invalid format, tampered signature, revoked, expired.
    Does NOT re-register unknown token hashes — the dangerous fallback has been
    removed. Unknown hash = token from a different process; applicant must re-issue.
    """
    if not token or "." not in token:
        raise ValueError("Invalid applicant token format.")
    payload_b64, sig = token.split(".", 1)
    expected_sig = hmac.new(
        APPLICANT_SESSION_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise ValueError("Tampered applicant session token.")
    padding = "=" * (-len(payload_b64) % 4)
    try:
        payload = json.loads(
            base64.urlsafe_b64decode((payload_b64 + padding).encode("utf-8")).decode("utf-8")
        )
    except Exception:
        raise ValueError("Malformed applicant session payload.")
    # Expiry before revocation (cheaper check first)
    exp = payload.get("exp", 0)
    if time.time() > exp:
        raise ValueError("Applicant session token has expired.")
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    if _is_revoked(token_hash):
        raise ValueError("This applicant session token has been revoked.")
    # Hydrate completed_steps from in-process registry if present
    session_state = _ACTIVE_APPLICANT_SESSIONS.get(token_hash)
    if session_state:
        payload["completed_steps"] = list(session_state.get("completed_steps", []))
    else:
        # Token was issued by a different process instance.
        # Do NOT re-register. Return empty completed_steps.
        payload["completed_steps"] = []
    payload["token_hash"] = token_hash
    return payload


def revoke_applicant_token(token: str) -> bool:
    """Revoke an applicant token. Persists to the configured backend."""
    try:
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        pid = ""
        try:
            pb64 = token.split(".", 1)[0]
            pad = "=" * (-len(pb64) % 4)
            pid = json.loads(base64.urlsafe_b64decode(pb64 + pad).decode("utf-8")).get("pid", "")
        except Exception:
            pass
        _persist_revocation(token_hash, pid=pid)
        _ACTIVE_APPLICANT_SESSIONS.pop(token_hash, None)
        return True
    except Exception as e:
        logger.error("Token revocation failed: %s", e)
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

def is_workflow_complete(token: str) -> bool:
    """
    Check if all allowed / required steps for an applicant token have been completed.
    Returns True if every required step in the workflow has been completed.
    """
    try:
        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        session = _ACTIVE_APPLICANT_SESSIONS.get(token_hash)
        if not session:
            return False
        completed = session.get("completed_steps", set())
        allowed = session.get("allowed_steps", [])
        
        for step in allowed:
            s = step.upper()
            if "_FACE" in s:
                doc = s.replace("_FACE", "")
                if not (doc in completed or "OCR" in completed):
                    return False
                if "LIVE_VERIFY" not in completed and "FACE_MATCH" not in completed:
                    return False
            elif s in ("PAN", "AADHAAR", "DL", "VOTER_ID"):
                if not (s in completed or "OCR" in completed):
                    return False
            elif s in ("LIVE_VERIFY", "FACE_MATCH"):
                if "LIVE_VERIFY" not in completed and "FACE_MATCH" not in completed:
                    return False
            elif s == "EYE_TRACKING":
                if "EYE_TRACKING" not in completed:
                    return False
            else:
                if s not in completed:
                    return False
        return True
    except Exception:
        return False

def check_step_allowed(payload: dict, step_name: str) -> bool:
    """Enforce that the requested operation is permitted in this token's workflow."""
    allowed = payload.get("allowed_steps", [])
    step = step_name.upper()
    # If the pipeline includes composite steps like PAN_FACE, it permits PAN and LIVE_VERIFY
    for a in allowed:
        if step == a or (step in ("PAN", "AADHAAR", "DL", "VOTER_ID") and (f"{step}_FACE" in a or step in a)):
            return True
        if step in ("LIVE_VERIFY", "FACE_MATCH") and ("_FACE" in a):
            return True
        if step == "EYE_TRACKING" and "EYE_TRACKING" in a:
            return True
    return False

# ---------------------------------------------------------------------------
# 6. Tenant-scoped signed asset URLs
# ---------------------------------------------------------------------------

def generate_signed_asset_url(
    filename: str,
    tenant_id: str,
    ttl_seconds: int = 900,
    operation: str = "read",
) -> str:
    """
    Generate a short-lived, tenant-scoped signed URL.
    HMAC message = '{basename}:{tenant_id}:{exp}:{operation}'
    All four fields are verified during validation.
    Returns: '/ocr_uploads/{filename}?expires={exp}&tid={tid}&op={op}&sig={sig}'
    """
    if not filename:
        return None
    basename = os.path.basename(filename)
    exp = int(time.time()) + ttl_seconds
    safe_tid = urllib.parse.quote(tenant_id or "unknown", safe="")
    message = f"{basename}:{tenant_id}:{exp}:{operation}".encode("utf-8")
    sig = hmac.new(ASSET_SIGNING_SECRET.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"/ocr_uploads/{basename}?expires={exp}&tid={safe_tid}&op={operation}&sig={sig}"


def verify_signed_asset_url(
    filename: str,
    exp_str: str,
    sig: str,
    tenant_id: str,
    op_str: str = "read",
) -> bool:
    """
    Validate the HMAC signature and expiry of a tenant-scoped signed asset URL.
    Returns False if any field is absent, expired, or the signature mismatches.
    """
    if not exp_str or not sig or not tenant_id:
        return False
    try:
        exp = int(exp_str)
        if time.time() > exp:
            return False
        basename = os.path.basename(filename)
        operation = op_str or "read"
        expected_msg = f"{basename}:{tenant_id}:{exp}:{operation}".encode("utf-8")
        expected_sig = hmac.new(
            ASSET_SIGNING_SECRET.encode("utf-8"), expected_msg, hashlib.sha256
        ).hexdigest()
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
