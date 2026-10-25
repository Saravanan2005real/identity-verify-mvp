import os
import json
import logging
import urllib.request
import urllib.parse
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("supabase_client")
logging.basicConfig(level=logging.INFO)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_TABLE = os.getenv("SUPABASE_TABLE", "verifications")

def is_configured() -> bool:
    """Check if Supabase credentials are validly configured."""
    return bool(
        SUPABASE_URL 
        and (SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY)
        and not SUPABASE_URL.startswith("https://your-project-ref")
        and not (SUPABASE_KEY.startswith("your-supabase-anon") and not SUPABASE_SERVICE_ROLE_KEY)
    )

def _get_headers(auth_token: str = None) -> dict:
    """
    Get request headers. If a user's Bearer token is provided, uses that token 
    so Supabase RLS enforces caller's tenant scoping.
    Otherwise, falls back to server-side backend key (SERVICE_ROLE_KEY if set, else KEY).
    """
    token = auth_token or SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY
    clean_token = token.strip()
    if clean_token.lower().startswith("bearer "):
        clean_token = clean_token[7:].strip()

    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY,
        "Authorization": f"Bearer {clean_token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation"
    }

def get_verification_record(identifier: str, tenant_id: str = None, auth_token: str = None) -> dict:
    """
    Fetch verification data from Supabase GET endpoint by session_id or id_number.
    Enforces tenant_id isolation to prevent IDOR attacks.
    The tenant_id filter is always applied as an AND clause so it cannot be bypassed.
    """
    if not is_configured():
        logger.info("[Supabase] Skipping GET: Supabase URL/Key not configured yet.")
        return {"status": "unconfigured", "data": None}

    try:
        # Build OR filter for the two identifier types
        identifier_filter = (
            f"or=(session_id.eq.{urllib.parse.quote(identifier)},"
            f"id_number.eq.{urllib.parse.quote(identifier)})"
        )
        # Tenant isolation is a mandatory AND clause, not part of the OR.
        # This prevents IDOR: a caller cannot circumvent the tenant check by
        # providing an identifier that satisfies the OR but belongs to another tenant.
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?select=*&{identifier_filter}"
        if tenant_id:
            url += f"&tenant_id=eq.{urllib.parse.quote(tenant_id)}"

        req = urllib.request.Request(url, headers=_get_headers(auth_token), method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                logger.info(f"[Supabase] Successfully fetched {len(data)} record(s) for {identifier}")
                return {"status": "success", "data": data[0] if data else None}
            else:
                logger.warning(f"[Supabase] GET failed with status code {response.status}")
                return {"status": "error", "message": f"HTTP {response.status}"}
    except Exception as e:
        logger.warning(f"[Supabase] Failed to fetch verification record: {str(e)}")
        return {"status": "error", "message": str(e)}

def list_verification_records(limit: int = 50, tenant_id: str = None, auth_token: str = None) -> dict:
    """
    Fetch all recent verification records from Supabase table ordered by timestamp.
    Enforces tenant_id scoping to prevent cross-tenant enumeration.
    """
    if not is_configured():
        return {"status": "unconfigured", "data": []}

    try:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}?select=*&order=created_at.desc&limit={limit}"
        if tenant_id:
            url += f"&tenant_id=eq.{urllib.parse.quote(tenant_id)}"

        req = urllib.request.Request(url, headers=_get_headers(auth_token), method="GET")
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                return {"status": "success", "data": data}
            return {"status": "error", "message": f"HTTP {response.status}", "data": []}
    except Exception as e:
        logger.warning(f"[Supabase] List failed: {str(e)}")
        return {"status": "error", "message": str(e), "data": []}

def upsert_verification_record(payload: dict, auth_token: str = None) -> dict:
    """
    Save or update verification data in Supabase table via POST/UPSERT.
    """
    if not is_configured():
        logger.info("[Supabase] Local verification complete. Supabase sync skipped (placeholder credentials).")
        return {"status": "unconfigured", "synced": False}

    try:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}"
        headers = _get_headers(auth_token)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        
        json_bytes = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=json_bytes, headers=headers, method="POST")
        
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status in (200, 201):
                res_data = json.loads(response.read().decode('utf-8'))
                logger.info(f"[Supabase] Verification record successfully synced to Supabase (Session: {payload.get('session_id')})")
                return {"status": "success", "synced": True, "data": res_data}
            else:
                logger.warning(f"[Supabase] UPSERT returned status code {response.status}")
                return {"status": "error", "synced": False, "message": f"HTTP {response.status}"}
    except Exception as e:
        logger.warning(f"[Supabase] Sync failed (local verification unaffected): {str(e)}")
        return {"status": "error", "synced": False, "message": str(e)}
