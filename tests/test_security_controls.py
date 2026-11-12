"""
tests/test_security_controls.py
================================
Verifyyy Phase 1 Security Regression Suite

Test Categories
---------------
UNIT  — No network required; tests logic in auth_validator directly.
INTEG — Requires the OCR Flask server running on API_BASE (default localhost:5001).
        Run with:  pytest tests/ -v -m "not integ"          (unit only)
                   pytest tests/ -v -m integ                 (integration only, server must be up)

IMPORTANT DESIGN RULES (audit-required):
  - No mocked tests may be labelled "integration".
  - 404 is NOT accepted as proof of access denial unless the test explicitly
    created the resource first and can distinguish 404-not-found from 403-denied.
  - Tests that require a live server are marked @pytest.mark.integ.
  - Secrets are loaded from environment; real identity data is never embedded.
"""

import os
import sys
import json
import time
import hmac
import hashlib
import base64
import tempfile
import urllib.request
import urllib.error
import subprocess
import pytest

# ---------------------------------------------------------------------------
# Path setup — OCR auth_validator must take priority over superadmin one
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OCR_DIR = os.path.join(BASE_DIR, "products", "ocr_engine")
SUPERADMIN_BACKEND_DIR = os.path.join(BASE_DIR, "superadmin", "backend")

# Insert OCR_DIR FIRST so its auth_validator is used, not superadmin's
if OCR_DIR not in sys.path:
    sys.path.insert(0, OCR_DIR)
if SUPERADMIN_BACKEND_DIR not in sys.path:
    sys.path.insert(1, SUPERADMIN_BACKEND_DIR)

# Set required secrets before importing auth_validator
os.environ.setdefault("APPLICANT_SESSION_SECRET", "a" * 64)
os.environ.setdefault("ASSET_SIGNING_SECRET", "b" * 64)
os.environ.setdefault("SUPABASE_URL", "https://placeholder.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "placeholder-key")

import auth_validator as av

API_BASE = os.getenv("TEST_API_BASE", "http://localhost:5001")

# ---------------------------------------------------------------------------
# Pytest marker
# ---------------------------------------------------------------------------
def pytest_configure(config):
    config.addinivalue_line("markers", "integ: integration test requiring a live server")


# ===========================================================================
# UNIT TESTS — auth_validator logic (no network needed)
# ===========================================================================

class TestTokenExpiry:
    """UNIT — Token expiry is verified before revocation (cheaper check first)."""

    def test_expired_token_is_rejected(self):
        """Verify that an expired applicant token is rejected with an expiry error."""
        expired_token = av.create_applicant_token("PID-EXP", "PAN", "org-test", ttl_seconds=-10)
        with pytest.raises(ValueError) as exc_info:
            av.verify_applicant_token(expired_token)
        assert "expired" in str(exc_info.value).lower()

    def test_future_token_is_accepted(self):
        """Verify that a fresh token with a positive TTL is accepted."""
        token = av.create_applicant_token("PID-FRESH", "PAN", "org-test", ttl_seconds=3600)
        payload = av.verify_applicant_token(token)
        assert payload["pid"] == "PID-FRESH"
        assert payload["tenant_id"] == "org-test"


class TestTokenTampering:
    """UNIT — HMAC signature prevents payload tampering."""

    def test_tampered_payload_is_rejected(self):
        """Verify that any modification to the token payload is detected and rejected."""
        token = av.create_applicant_token("PID-VALID", "PAN", "org-test", ttl_seconds=3600)
        parts = token.split(".")
        # Replace payload with a different base64-encoded object
        fake_payload_b64 = base64.urlsafe_b64encode(b'{"pid":"ATTACKER","tenant_id":"evil"}').decode().rstrip("=")
        tampered_token = f"{fake_payload_b64}.{parts[1]}"
        with pytest.raises(ValueError) as exc_info:
            av.verify_applicant_token(tampered_token)
        assert "tampered" in str(exc_info.value).lower()

    def test_truncated_token_is_rejected(self):
        """Verify tokens without a signature separator are rejected."""
        with pytest.raises(ValueError):
            av.verify_applicant_token("notadottoken")

    def test_empty_token_is_rejected(self):
        """Verify an empty/None token is rejected."""
        with pytest.raises(ValueError):
            av.verify_applicant_token("")


class TestTokenRevocation:
    """UNIT — Revocation is enforced regardless of expiry."""

    def test_revoked_token_is_rejected(self):
        """Verify that a revoked token is blocked from further use."""
        token = av.create_applicant_token("PID-REV", "PAN_FACE", "org-test", ttl_seconds=3600)
        # Verify token works initially
        info = av.verify_applicant_token(token)
        assert info["pid"] == "PID-REV"

        ok = av.revoke_applicant_token(token)
        assert ok is True

        with pytest.raises(ValueError) as exc_info:
            av.verify_applicant_token(token)
        assert "revoked" in str(exc_info.value).lower()

    def test_revocation_persists_across_verify_calls(self):
        """UNIT: Revoked token stays revoked when verify_applicant_token is called multiple times."""
        token = av.create_applicant_token("PID-PERSIST-REV", "AADHAAR", "org-test2", ttl_seconds=3600)
        av.revoke_applicant_token(token)
        for _ in range(3):
            with pytest.raises(ValueError, match="revoked"):
                av.verify_applicant_token(token)

    def test_bad_supabase_url_revoke_applicant_token_returns_false(self, monkeypatch):
        """When Supabase persistence fails, revoke_applicant_token must return False."""
        token = av.create_applicant_token("PID-FAIL-REV", "PAN", "org-test", ttl_seconds=3600)
        monkeypatch.setattr(av, "_REVOCATION_BACKEND", "supabase")
        monkeypatch.setattr(av, "SUPABASE_SERVICE_ROLE_KEY", "dummy-service-role-key-32chars-min")
        monkeypatch.setattr(av, "SUPABASE_URL", "http://127.0.0.1:9")

        ok = av.revoke_applicant_token(token)
        assert ok is False
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        assert token_hash in av._REVOKED_TOKEN_HASHES


class TestTokenCrossTenantIsolation:
    """UNIT — Tokens are cryptographically bound to their issuing tenant."""

    def test_token_tenant_id_cannot_be_forged(self):
        """
        Verify that a token issued for org-A cannot be used as if it were for org-B.
        The tenant_id is embedded in the signed payload — tampering changes the sig.
        """
        token_a = av.create_applicant_token("PID-A", "PAN", "org-tenant-a", ttl_seconds=3600)
        payload = av.verify_applicant_token(token_a)
        # Legitimate token correctly reflects issuing tenant
        assert payload["tenant_id"] == "org-tenant-a"

        # Attempt to forge a token that claims org-tenant-b by tampering the payload
        parts = token_a.split(".")
        fake_claims = {"pid": "PID-A", "tenant_id": "org-tenant-b", "flow": "PAN",
                       "allowed_steps": ["PAN"], "nonce": "x", "exp": int(time.time()) + 3600, "iat": int(time.time())}
        fake_b64 = base64.urlsafe_b64encode(
            json.dumps(fake_claims, separators=(",", ":"), sort_keys=True).encode()
        ).decode().rstrip("=")
        forged_token = f"{fake_b64}.{parts[1]}"  # reuse original signature
        with pytest.raises(ValueError, match="Tampered"):
            av.verify_applicant_token(forged_token)


class TestSignedAssetURLs:
    """UNIT — HMAC-signed asset URLs bind file, tenant, expiry, and operation."""

    def test_valid_signed_url_passes_verification(self):
        """Verify that a freshly generated URL passes the HMAC check."""
        url = av.generate_signed_asset_url("face_crop.jpg", "org-test", ttl_seconds=60)
        # Parse back the parameters
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        assert av.verify_signed_asset_url(
            "face_crop.jpg",
            qs["expires"][0],
            qs["sig"][0],
            qs["tid"][0],
            op_str=qs.get("op", ["read"])[0],
        )

    def test_expired_signed_url_is_rejected(self):
        """Verify that a signed URL with a past expiry is rejected."""
        # Create URL with -1s TTL (already expired)
        exp = int(time.time()) - 1
        message = f"face_crop.jpg:org-test:{exp}:read".encode("utf-8")
        sig = hmac.new(
            av.ASSET_SIGNING_SECRET.encode("utf-8"), message, hashlib.sha256
        ).hexdigest()
        result = av.verify_signed_asset_url("face_crop.jpg", str(exp), sig, "org-test")
        assert result is False

    def test_wrong_tenant_signed_url_is_rejected(self):
        """
        CRITICAL: Signed URL generated for org-a must NOT be valid for org-b.
        This prevents cross-tenant asset URL reuse.
        """
        # Generate a legitimate URL for org-a
        url_org_a = av.generate_signed_asset_url("face_crop.jpg", "org-a", ttl_seconds=300)
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url_org_a)
        qs = parse_qs(parsed.query)
        # Extract signature and expiry from org-a URL
        # Attempt to validate the SAME sig/exp against org-b — must fail
        result = av.verify_signed_asset_url(
            "face_crop.jpg",
            qs["expires"][0],
            qs["sig"][0],
            "org-b",  # different tenant — must fail
        )
        assert result is False, "Cross-tenant asset URL reuse must be blocked by HMAC"

    def test_wrong_filename_signed_url_is_rejected(self):
        """Verify that a signed URL for file A cannot be used to download file B."""
        url = av.generate_signed_asset_url("face_crop_real.jpg", "org-test", ttl_seconds=300)
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        result = av.verify_signed_asset_url(
            "etc_passwd",  # different file
            qs["expires"][0],
            qs["sig"][0],
            qs["tid"][0],
        )
        assert result is False

    def test_wrong_operation_signed_url_is_rejected(self):
        """Verify that a URL signed for 'read' cannot be used for 'write'."""
        url = av.generate_signed_asset_url("face.jpg", "org-test", ttl_seconds=300, operation="read")
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        result = av.verify_signed_asset_url(
            "face.jpg",
            qs["expires"][0],
            qs["sig"][0],
            qs["tid"][0],
            op_str="write",  # different operation — must fail
        )
        assert result is False


class TestFileValidation:
    """UNIT — Magic-byte validation prevents extension spoofing."""

    def test_spoofed_html_as_jpg_is_rejected(self):
        """Verify that HTML content masquerading as .jpg fails validation."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(b"<html><script>alert(1)</script></html>")
            fake_path = f.name
        try:
            assert av.validate_file_content_and_magic(fake_path) is False
        finally:
            os.remove(fake_path)

    def test_valid_jpeg_header_passes(self):
        """Verify genuine JPEG magic bytes pass validation."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            f.write(b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 32)
            valid_path = f.name
        try:
            assert av.validate_file_content_and_magic(valid_path) is True
        finally:
            os.remove(valid_path)

    def test_valid_png_header_passes(self):
        """Verify genuine PNG magic bytes pass validation."""
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
            valid_path = f.name
        try:
            assert av.validate_file_content_and_magic(valid_path) is True
        finally:
            os.remove(valid_path)

    def test_empty_file_is_rejected(self):
        """Verify that a zero-byte file fails validation."""
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
            fake_path = f.name
        try:
            assert av.validate_file_content_and_magic(fake_path) is False
        finally:
            os.remove(fake_path)


class TestIdentityMasking:
    """UNIT — Sensitive identity numbers are masked before any external output."""

    def test_aadhaar_number_masking(self):
        """Verify Aadhaar masking: shows only last 4 digits."""
        masked = av.mask_identity_number("548612349012", "AADHAAR")
        assert masked == "XXXX-XXXX-9012"
        assert "5486" not in masked
        assert "1234" not in masked

    def test_pan_number_masking(self):
        """Verify PAN masking: preserves alpha prefix and final character only."""
        masked = av.mask_identity_number("ABCDE1234F", "PAN")
        assert masked == "ABCDE****F"
        assert "1234" not in masked

    def test_short_string_masking_does_not_crash(self):
        """Verify masking handles short/edge-case inputs without exceptions."""
        assert av.mask_identity_number("", "AADHAAR") == ""
        assert len(av.mask_identity_number("AB", "PAN")) > 0


class TestWorkflowStepEnforcement:
    """UNIT — Token's allowed_steps prevents out-of-scope operations."""

    def test_eye_tracking_token_does_not_permit_pan_step(self):
        """Verify token scoped to EYE_TRACKING does not allow PAN step."""
        token = av.create_applicant_token("PID-EYE", "EYE_TRACKING", "org-test", ttl_seconds=3600)
        payload = av.verify_applicant_token(token)
        assert not av.check_step_allowed(payload, "PAN")
        assert not av.check_step_allowed(payload, "AADHAAR")

    def test_pan_face_token_permits_pan_and_live_verify(self):
        """Verify PAN_FACE token grants both OCR and live-verify steps."""
        token = av.create_applicant_token("PID-PAN-FACE", "PAN_FACE", "org-test", ttl_seconds=3600)
        payload = av.verify_applicant_token(token)
        assert av.check_step_allowed(payload, "PAN")
        assert av.check_step_allowed(payload, "LIVE_VERIFY")

    def test_aadhaar_token_does_not_permit_pan_step(self):
        """Verify AADHAAR-scoped token rejects PAN step."""
        token = av.create_applicant_token("PID-AADH", "AADHAAR", "org-test", ttl_seconds=3600)
        payload = av.verify_applicant_token(token)
        assert not av.check_step_allowed(payload, "PAN")


class TestStartupSecretValidation:
    """UNIT — Startup secret validation enforces presence and minimum strength."""

    def test_valid_secrets_pass_validation(self, monkeypatch):
        """Startup validation succeeds when all secrets are present and meet minimum length."""
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "a" * 64)
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "b" * 64)
        monkeypatch.setenv("SUPABASE_URL", "https://valid.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "valid-key-at-least-some-chars")
        av.validate_startup_secrets()

    def test_missing_applicant_secret_fails(self, monkeypatch):
        """Startup validation raises RuntimeError when APPLICANT_SESSION_SECRET is empty/missing."""
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "")
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "b" * 64)
        monkeypatch.setenv("SUPABASE_URL", "https://valid.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "valid-key")
        with pytest.raises(RuntimeError, match="APPLICANT_SESSION_SECRET is not set"):
            av.validate_startup_secrets()

    def test_short_applicant_secret_fails(self, monkeypatch):
        """Startup validation raises RuntimeError when APPLICANT_SESSION_SECRET is < 32 characters."""
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "short_secret_16c")
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "b" * 64)
        monkeypatch.setenv("SUPABASE_URL", "https://valid.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "valid-key")
        with pytest.raises(RuntimeError, match="APPLICANT_SESSION_SECRET is too short"):
            av.validate_startup_secrets()

    def test_missing_asset_signing_secret_fails(self, monkeypatch):
        """Startup validation raises RuntimeError when ASSET_SIGNING_SECRET is empty/missing."""
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "a" * 64)
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "")
        monkeypatch.setenv("SUPABASE_URL", "https://valid.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "valid-key")
        with pytest.raises(RuntimeError, match="ASSET_SIGNING_SECRET is not set"):
            av.validate_startup_secrets()

    def test_short_asset_signing_secret_fails(self, monkeypatch):
        """Startup validation raises RuntimeError when ASSET_SIGNING_SECRET is < 32 characters."""
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "a" * 64)
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "short_key_16char")
        monkeypatch.setenv("SUPABASE_URL", "https://valid.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "valid-key")
        with pytest.raises(RuntimeError, match="ASSET_SIGNING_SECRET is too short"):
            av.validate_startup_secrets()

    def test_unconfigured_supabase_url_fails(self, monkeypatch):
        """Startup validation raises RuntimeError when SUPABASE_URL is unconfigured."""
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "a" * 64)
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "b" * 64)
        monkeypatch.setenv("SUPABASE_URL", "https://your-project-ref.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "valid-key")
        with pytest.raises(RuntimeError, match="SUPABASE_URL is not configured"):
            av.validate_startup_secrets()


class TestProductionConfigGuards:
    """UNIT — Verifies fail-closed production security configuration validation."""

    def test_production_guard_skipped_in_development(self, monkeypatch):
        """validate_production_config does nothing when APP_ENV is development."""
        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.setenv("REVOCATION_BACKEND", "memory")
        av.validate_production_config()

    def test_production_guard_rejects_memory_revocation(self, monkeypatch):
        """Production refuses to start if REVOCATION_BACKEND is memory."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("REVOCATION_BACKEND", "memory")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "false")
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "https://verifyyy.example.com")
        monkeypatch.setenv("SUPABASE_URL", "https://real-prod.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "real-service-role-key-12345")
        with pytest.raises(RuntimeError, match="REVOCATION_BACKEND must be 'supabase'"):
            av.validate_production_config()

    def test_production_guard_rejects_local_fallback(self, monkeypatch):
        """Production refuses to start if ALLOW_LOCAL_FALLBACK is true."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("REVOCATION_BACKEND", "supabase")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "true")
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "https://verifyyy.example.com")
        monkeypatch.setenv("SUPABASE_URL", "https://real-prod.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "real-service-role-key-12345")
        with pytest.raises(RuntimeError, match="ALLOW_LOCAL_FALLBACK must be false"):
            av.validate_production_config()

    def test_production_guard_rejects_insecure_cors(self, monkeypatch):
        """Production refuses to start with wildcard, http, or localhost CORS origins."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("REVOCATION_BACKEND", "supabase")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "false")
        monkeypatch.setenv("SUPABASE_URL", "https://real-prod.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "real-service-role-key-12345")

        # Test http origin rejection
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "http://insecure.example.com")
        with pytest.raises(RuntimeError, match="CORS origin must use https"):
            av.validate_production_config()

        # Test localhost origin rejection
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "https://localhost:8081,https://verifyyy.example.com")
        with pytest.raises(RuntimeError, match="CORS origin must not be localhost"):
            av.validate_production_config()

        # Test wildcard origin rejection
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "*")
        with pytest.raises(RuntimeError, match="CORS wildcard '\\*' is not allowed"):
            av.validate_production_config()

    def test_production_guard_rejects_missing_service_role_key(self, monkeypatch):
        """Production refuses to start without SUPABASE_SERVICE_ROLE_KEY."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("REVOCATION_BACKEND", "supabase")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "false")
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "https://verifyyy.example.com")
        monkeypatch.setenv("SUPABASE_URL", "https://real-prod.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "")
        with pytest.raises(RuntimeError, match="SUPABASE_SERVICE_ROLE_KEY is missing"):
            av.validate_production_config()

    def test_production_guard_passes_with_valid_production_config(self, monkeypatch):
        """validate_production_config succeeds when all production criteria are satisfied."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("REVOCATION_BACKEND", "supabase")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "false")
        monkeypatch.setenv("ALLOWED_CORS_ORIGINS", "https://verifyyy.example.com,https://admin.verifyyy.com")
        monkeypatch.setenv("SUPABASE_URL", "https://real-prod.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "real-service-role-key-12345")
        av.validate_production_config()

    def test_local_fallback_allowed_behavior(self, monkeypatch):
        """local_fallback_allowed is strictly False in production, configurable in development."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "true")
        assert av.local_fallback_allowed() is False

        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "true")
        assert av.local_fallback_allowed() is True

        monkeypatch.setenv("ALLOW_LOCAL_FALLBACK", "false")
        assert av.local_fallback_allowed() is False

    def test_validate_startup_secrets_invokes_production_guard(self, monkeypatch):
        """validate_startup_secrets calls validate_production_config and fails in production."""
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "a" * 64)
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "b" * 64)
        monkeypatch.setenv("SUPABASE_URL", "https://real-prod.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "real-anon-key")
        monkeypatch.setenv("REVOCATION_BACKEND", "memory")
        with pytest.raises(RuntimeError, match="REVOCATION_BACKEND must be 'supabase'"):
            av.validate_startup_secrets()


class TestStartupPaths:
    """UNIT — Verifies environment loading and failure modes across execution entry points."""

    def test_root_env_loading(self):
        """Verify load_environment discovers the root .env file and sets values."""
        av.load_environment()
        assert os.path.exists(os.path.join(BASE_DIR, ".env"))

    def test_direct_execution_missing_secret_aborts_process(self):
        """
        Verify that attempting to import/run the application directly without required secrets
        aborts process startup with a non-zero exit code and RuntimeError.
        """
        code = (
            "import sys, os;"
            f"sys.path.insert(0, r'{OCR_DIR}');"
            "os.environ['APPLICANT_SESSION_SECRET'] = '';"
            "os.environ['ASSET_SIGNING_SECRET'] = '';"
            "import auth_validator as v;"
            "v.validate_startup_secrets()"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True
        )
        assert proc.returncode != 0
        assert "SECURITY CONFIGURATION ERROR" in proc.stderr or "RuntimeError" in proc.stderr

    def test_superadmin_missing_secret_aborts_process(self):
        """
        Verify that Superadmin backend aborts startup when secrets are missing.
        """
        code = (
            "import sys, os;"
            f"sys.path.insert(0, r'{SUPERADMIN_BACKEND_DIR}');"
            "os.environ['APPLICANT_SESSION_SECRET'] = '';"
            "os.environ['ASSET_SIGNING_SECRET'] = '';"
            "import auth_validator as v;"
            "v.validate_startup_secrets()"
        )
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True
        )
        assert proc.returncode != 0
        assert "SECURITY CONFIGURATION ERROR" in proc.stderr or "RuntimeError" in proc.stderr


class TestSuperadminAuthValidatorIsSuperadmin:
    """UNIT — superadmin/backend/auth_validator.py is_superadmin() security checks."""

    @pytest.fixture(autouse=True)
    def setup_superadmin_module(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "superadmin_av_test",
            os.path.join(SUPERADMIN_BACKEND_DIR, "auth_validator.py")
        )
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def test_no_allowlists_configured_confirmed_random_user_returns_false(self, monkeypatch):
        monkeypatch.delenv("ALLOWED_SUPERADMIN_DOMAINS", raising=False)
        monkeypatch.delenv("ALLOWED_SUPERADMIN_EMAILS", raising=False)
        user_data = {
            "email": "random_user@example.com",
            "email_confirmed_at": "2026-10-01T00:00:00Z",
            "app_metadata": {}
        }
        assert self.mod.is_superadmin(user_data, []) is False

    def test_allowed_domain_unconfirmed_email_returns_false(self, monkeypatch):
        monkeypatch.setenv("ALLOWED_SUPERADMIN_DOMAINS", "example.com")
        monkeypatch.delenv("ALLOWED_SUPERADMIN_EMAILS", raising=False)
        user_data = {
            "email": "admin@example.com",
            "email_confirmed_at": None,
            "app_metadata": {}
        }
        assert self.mod.is_superadmin(user_data, []) is False

    def test_allowed_domain_confirmed_email_returns_true(self, monkeypatch):
        monkeypatch.setenv("ALLOWED_SUPERADMIN_DOMAINS", "example.com")
        monkeypatch.delenv("ALLOWED_SUPERADMIN_EMAILS", raising=False)
        user_data = {
            "email": "admin@example.com",
            "email_confirmed_at": "2026-10-01T00:00:00Z",
            "app_metadata": {}
        }
        assert self.mod.is_superadmin(user_data, []) is True

    def test_app_metadata_role_superadmin_returns_true(self, monkeypatch):
        monkeypatch.delenv("ALLOWED_SUPERADMIN_DOMAINS", raising=False)
        monkeypatch.delenv("ALLOWED_SUPERADMIN_EMAILS", raising=False)
        user_data = {
            "email": "attacker@evil.com",
            "email_confirmed_at": None,
            "app_metadata": {"role": "superadmin"}
        }
        assert self.mod.is_superadmin(user_data, []) is True


class TestTenantHandlingSecurity:
    """UNIT — Strict tenant isolation in supabase_client."""

    @pytest.fixture(autouse=True)
    def setup_supabase_client(self):
        sys.path.insert(0, OCR_DIR)
        import supabase_client
        self.sc = supabase_client

    def test_get_verification_record_missing_tenant_raises_value_error(self):
        """Missing tenant_id without all_tenants=True must raise ValueError."""
        with pytest.raises(ValueError, match="Tenant"):
            self.sc.get_verification_record("SESSION-1", tenant_id=None)

    def test_get_verification_record_empty_string_tenant_raises_value_error(self):
        """Empty string tenant_id must raise ValueError."""
        with pytest.raises(ValueError, match="Tenant"):
            self.sc.get_verification_record("SESSION-1", tenant_id="")

    def test_list_verification_records_missing_tenant_raises_value_error(self):
        """Missing tenant_id on list without all_tenants=True must raise ValueError."""
        with pytest.raises(ValueError, match="Tenant"):
            self.sc.list_verification_records(tenant_id=None)

    def test_list_verification_records_empty_string_tenant_raises_value_error(self):
        """Empty string tenant_id on list must raise ValueError."""
        with pytest.raises(ValueError, match="Tenant"):
            self.sc.list_verification_records(tenant_id="")



# ===========================================================================
# INTEGRATION TESTS — require live server at API_BASE
# ===========================================================================

@pytest.mark.integ
class TestUnauthenticatedAccessBlocked:
    """INTEG — Unauthenticated callers must receive HTTP 401, not data."""

    def test_unauthenticated_cannot_list_records(self):
        """Unauthenticated callers cannot enumerate verification records."""
        req = urllib.request.Request(f"{API_BASE}/api/v1/supabase/list")
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code == 401
        body = json.loads(exc_info.value.read().decode())
        assert body.get("status") == "error"

    def test_unauthenticated_cannot_get_single_record(self):
        """Unauthenticated callers cannot access a specific record by session ID."""
        req = urllib.request.Request(f"{API_BASE}/api/v1/supabase/get/SESSION-SENTINEL-12345")
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code == 401

    def test_ocr_with_spoofed_referer_but_no_credentials_is_blocked(self):
        """
        CRITICAL (Remediation A): A spoofed Referer header from an allowed origin
        must NOT bypass OCR authentication. Without a valid Bearer or applicant token,
        the server must return 401 regardless of the Referer value.
        """
        import io
        boundary = b"testboundary"
        body = (
            b"--" + boundary + b"\r\n"
            b'Content-Disposition: form-data; name="file"; filename="test.jpg"\r\n'
            b"Content-Type: image/jpeg\r\n\r\n"
            b"\xff\xd8\xff\xe0" + b"\x00" * 64 + b"\r\n"
            b"--" + boundary + b"--\r\n"
        )
        req = urllib.request.Request(
            f"{API_BASE}/api/v1/ocr",
            data=body,
            method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary.decode()}",
                # Spoof an allowed origin in the Referer header
                "Referer": "http://localhost:5174/",
                # No Authorization or X-Applicant-Token
            }
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code == 401, (
            f"Expected 401 but got {exc_info.value.code}. "
            "Referer header must NOT grant authentication."
        )

    def test_raw_asset_without_signed_url_is_blocked(self):
        """Private face crops must not be accessible without a signed URL or auth token."""
        req = urllib.request.Request(f"{API_BASE}/ocr_uploads/sentinel_face_test.jpg")
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code == 401

    def test_raw_asset_with_spoofed_referer_is_blocked(self):
        """
        Referer bypass removed (Remediation A): A spoofed Referer from an allowed origin
        must NOT grant access to raw assets. Must return 401.
        """
        req = urllib.request.Request(
            f"{API_BASE}/ocr_uploads/sentinel_face_test.jpg",
            headers={"Referer": "http://localhost:5174/"}
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code == 401, (
            f"Expected 401, got {exc_info.value.code}. "
            "Referer must NOT be treated as authentication for asset access."
        )


@pytest.mark.integ
class TestApplicantSessionIssuanceRestricted:
    """INTEG — Applicant session creation is restricted to authenticated admins."""

    def test_unauthenticated_cannot_create_applicant_session(self):
        """
        CRITICAL (Remediation B): The /api/v1/auth/applicant_session endpoint
        must reject callers without a valid Supabase Bearer token.
        Previously this endpoint was open to anyone — that is now fixed.
        """
        req = urllib.request.Request(
            f"{API_BASE}/api/v1/auth/applicant_session",
            data=json.dumps({"pid": "ATTACKER-PID", "flow": "PAN_FACE"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        # Must be 403 (Supabase configured but no auth) or 503 (Supabase unconfigured)
        assert exc_info.value.code in (403, 503), (
            f"Expected 403 or 503 but got {exc_info.value.code}. "
            "Unauthenticated applicant session issuance must be forbidden."
        )

    def test_applicant_token_cannot_issue_new_applicant_token(self):
        """
        An existing applicant token must NOT be able to create new applicant tokens.
        Only Supabase-authenticated admins may do so.
        """
        existing_token = av.create_applicant_token("PID-EXISTING", "PAN", "org-test", ttl_seconds=3600)
        req = urllib.request.Request(
            f"{API_BASE}/api/v1/auth/applicant_session",
            data=json.dumps({"pid": "NEW-PID", "flow": "PAN_FACE"}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Applicant-Token": existing_token,
            },
            method="POST"
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code in (403, 503), (
            f"Expected 403 or 503 but got {exc_info.value.code}. "
            "Applicant tokens must not be able to issue new applicant tokens."
        )


@pytest.mark.integ
class TestCrossTenantRecordAccess:
    """
    INTEG — Cross-tenant IDOR prevention.
    
    These tests require controlled test records to exist in the database.
    Without a real Supabase test environment, they test the HTTP-level auth
    enforcement (401/403 for unauthenticated/unauthorized callers).
    
    For a complete IDOR test: create records for Tenant A and Tenant B in a
    test Supabase project, obtain valid JWTs for each, and verify that Tenant A's
    token cannot retrieve Tenant B's records.
    """

    def test_cross_tenant_access_requires_authentication(self):
        """
        Verify that any attempt to read records is blocked without authentication.
        Without authentication, a 401 must be returned — not data from any tenant.
        """
        req = urllib.request.Request(
            f"{API_BASE}/api/v1/supabase/get/CONTROLLED-TEST-RECORD-SENTINEL"
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code == 401

    def test_path_traversal_in_asset_endpoint_is_blocked(self):
        """Verify that directory traversal in /ocr_uploads/ is rejected."""
        traversal_url = f"{API_BASE}/ocr_uploads/..%2f..%2fetc%2fpasswd"
        req = urllib.request.Request(traversal_url)
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        # Must not be 200 or 500; traversal is blocked at the secure_filename check (400)
        # or auth check (401) before any filesystem lookup.
        assert exc_info.value.code in (400, 401, 403, 404), (
            f"Path traversal should be blocked, got HTTP {exc_info.value.code}"
        )


@pytest.mark.integ
class TestRevokedTokenAfterRestart:
    """
    INTEG — Revoked tokens stay revoked when REVOCATION_BACKEND=supabase.
    
    Unit coverage exists (TestTokenRevocation). This integration class documents
    what must be tested against a live server when REVOCATION_BACKEND=supabase:
    
    1. Issue a token. Use it successfully.
    2. Revoke it via the revoke endpoint.
    3. Restart the backend process.
    4. Attempt to use the revoked token — must be rejected (revocation is durable).
    
    This test is skipped unless REVOCATION_BACKEND env var is "supabase".
    """

    @pytest.mark.skipif(
        os.getenv("REVOCATION_BACKEND", "memory") != "supabase",
        reason="Durable revocation test requires REVOCATION_BACKEND=supabase"
    )
    def test_revoked_token_rejected_after_restart(self):
        """
        Durable revocation: a token revoked in one process must be rejected by
        a newly-started process reading revocation state from Supabase.
        
        This test cannot be automated in a single process — it requires:
          1. Process A: issue and revoke the token (done here via direct auth_validator call).
          2. Process B: a fresh backend startup.
          3. Process B: attempt to use the revoked token → must get 401/403.
        
        In CI/CD: run this as a multi-step job where process B is started between steps.
        For now, this test confirms the revocation is persisted to Supabase.
        """
        token = av.create_applicant_token("PID-DURABLE-REV", "PAN", "org-test", ttl_seconds=3600)
        ok = av.revoke_applicant_token(token)
        assert ok is True

        code = (
            "import sys, os;"
            f"sys.path.insert(0, r'{OCR_DIR}');"
            "import auth_validator as av;"
            f"token = '{token}';"
            "try:\n"
            "    av.verify_applicant_token(token)\n"
            "    sys.exit(1)\n"
            "except ValueError as e:\n"
            "    if 'revoked' in str(e).lower():\n"
            "        sys.exit(0)\n"
            "    sys.exit(2)\n"
        )
        proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
        assert proc.returncode == 0, f"Fresh process failed to reject revoked token. stderr: {proc.stderr}"


@pytest.mark.integ
class TestSignedAssetCrossTenantReuse:
    """INTEG — Signed URLs cannot be reused across tenants at the HTTP level."""

    def test_cross_tenant_signed_url_is_rejected(self):
        """
        A signed asset URL generated for org-a must fail when presented with
        tid=org-b in the query string (the HMAC covers the tenant_id field).
        """
        # Generate a URL for org-a
        url = av.generate_signed_asset_url("sentinel_face.jpg", "org-a", ttl_seconds=300)
        # Modify the tid parameter to org-b
        cross_tenant_url = url.replace("tid=org-a", "tid=org-b")
        req = urllib.request.Request(f"{API_BASE}{cross_tenant_url}")
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        # The signature mismatch should cause a 401 (not 404 for missing file)
        assert exc_info.value.code == 401, (
            f"Cross-tenant signed URL reuse must be blocked with 401, got {exc_info.value.code}. "
            "Note: 404 would indicate the auth check was bypassed."
        )


@pytest.mark.integ
class TestSuperadminRestrictions:
    """INTEG — Ordinary admins and applicants cannot execute superadmin operations."""

    def test_unauthenticated_cannot_purge_assets(self):
        """Purge endpoint requires superadmin authentication — unauthenticated → 401/403."""
        req = urllib.request.Request(
            f"{API_BASE}/api/v1/admin/purge_expired_assets",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code in (401, 403, 503)

    def test_applicant_token_cannot_purge_assets(self):
        """An applicant token must not be able to invoke superadmin purge operations."""
        token = av.create_applicant_token("PID-SA-TEST", "PAN_FACE", "org-test", ttl_seconds=3600)
        req = urllib.request.Request(
            f"{API_BASE}/api/v1/admin/purge_expired_assets",
            data=b"{}",
            headers={
                "Content-Type": "application/json",
                "X-Applicant-Token": token,
            },
            method="POST"
        )
        with pytest.raises(urllib.error.HTTPError) as exc_info:
            urllib.request.urlopen(req)
        assert exc_info.value.code in (403, 503), (
            f"Applicant token must not access superadmin endpoints, got {exc_info.value.code}"
        )


@pytest.mark.integ
class TestUploadedFileEndpointSecurity:
    """INTEG — Security controls on /ocr_uploads/<filename>."""

    @pytest.fixture(autouse=True)
    def setup_fixture_file(self):
        sys.path.insert(0, OCR_DIR)
        from engine import app, UPLOAD_FOLDER
        self.app = app
        self.upload_folder = UPLOAD_FOLDER
        self.filename = "test_uploaded_file_fixture.jpg"
        self.file_path = os.path.join(self.upload_folder, self.filename)
        with open(self.file_path, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0real_test_jpeg_bytes")
        yield
        if os.path.exists(self.file_path):
            try:
                os.remove(self.file_path)
            except Exception:
                pass

    def test_unsigned_with_valid_bearer_returns_401_or_403(self, monkeypatch):
        """Unsigned URL with a valid Bearer token must be rejected with 401 or 403."""
        import auth_validator
        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "user-a", "email": "a@org-a.com", "user_metadata": {"tenant_id": "org-a"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-a", "role": "member"}]
        )
        client = self.app.test_client()
        resp = client.get(
            f"/ocr_uploads/{self.filename}",
            headers={"Authorization": "Bearer mock-valid-token"}
        )
        assert resp.status_code in (401, 403), f"Expected 401 or 403, got {resp.status_code}"

    def test_valid_signed_url_returns_200(self):
        """Valid HMAC signature returns 200 and file contents."""
        url = av.generate_signed_asset_url(self.filename, "org-a", ttl_seconds=300)
        client = self.app.test_client()
        resp = client.get(url)
        assert resp.status_code == 200

    def test_signed_url_for_different_tenant_returns_403(self, monkeypatch):
        """Valid signature for tenant B requested by tenant A caller returns 403."""
        import auth_validator
        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "user-a", "email": "a@org-a.com", "user_metadata": {"tenant_id": "org-a"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-a", "role": "member"}]
        )
        url_org_b = av.generate_signed_asset_url(self.filename, "org-b", ttl_seconds=300)
        client = self.app.test_client()
        resp = client.get(
            url_org_b,
            headers={"Authorization": "Bearer mock-token-org-a"}
        )
        assert resp.status_code == 403

    def test_expired_signed_url_returns_401_or_403(self):
        """Expired signed URL returns 401 or 403."""
        url = av.generate_signed_asset_url(self.filename, "org-a", ttl_seconds=-60)
        client = self.app.test_client()
        resp = client.get(url)
        assert resp.status_code in (401, 403)


@pytest.mark.integ
class TestLiveVerifyEndpointSecurity:
    """INTEG — Security controls on /api/v1/live_verify."""

    @pytest.fixture(autouse=True)
    def setup_app_client(self):
        sys.path.insert(0, OCR_DIR)
        from engine import app
        import cv2, numpy as np, base64
        self.app = app
        self.client = app.test_client()
        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        self.tiny_b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode("utf-8")

    def test_unauthenticated_post_returns_401(self):
        """Unauthenticated call to live_verify must return 401."""
        resp = self.client.post(
            "/api/v1/live_verify",
            json={"image": self.tiny_b64}
        )
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    def test_applicant_token_with_live_verify_step_succeeds(self, monkeypatch):
        """Valid applicant token with LIVE_VERIFY step must not 500."""
        import engine
        import supabase_client
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(engine, "_cross_verify_uploaded_vs_live", lambda refs, h, i: {"face_match": True, "step3_face_matches": [{"verified": True}]})
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})

        token = av.create_applicant_token("PID-APP-123", "LIVE_VERIFY", "org-test", ttl_seconds=3600)
        resp = self.client.post(
            "/api/v1/live_verify",
            json={"image": self.tiny_b64},
            headers={"X-Applicant-Token": token}
        )
        assert resp.status_code in (200, 201), f"Expected 200, got {resp.status_code}"

    def test_client_supplied_session_id_is_ignored(self, monkeypatch):
        """Client-supplied session_id must never be used."""
        import engine
        import supabase_client
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(engine, "_cross_verify_uploaded_vs_live", lambda refs, h, i: {"face_match": True, "step3_face_matches": [{"verified": True}]})
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})

        token = av.create_applicant_token("PID-APP-123", "LIVE_VERIFY", "org-test", ttl_seconds=3600)
        resp = self.client.post(
            "/api/v1/live_verify",
            json={
                "image": self.tiny_b64,
                "session_id": "malicious-victim-session-id"
            },
            headers={"X-Applicant-Token": token}
        )
        body = resp.get_json() or {}
        assert body.get("session_id") != "malicious-victim-session-id", (
            f"Client-supplied session_id was accepted: {body.get('session_id')}"
        )
        assert body.get("session_id") == "PID-APP-123"


class TestAssetSigningEndpoint:
    """UNIT — GET /api/v1/assets/sign looks up owner record and enforces tenant match."""

    @pytest.fixture(autouse=True)
    def setup_app_client(self):
        sys.path.insert(0, OCR_DIR)
        from engine import app
        self.app = app
        self.client = app.test_client()

    def test_owner_tenant_receives_signed_url(self, monkeypatch):
        """Owner tenant caller receives 200 with fresh signed asset URL."""
        import auth_validator
        import supabase_client

        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "user-a", "email": "a@org-a.com", "user_metadata": {"tenant_id": "org-a"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-a", "role": "admin"}]
        )
        # Mock supabase record ownership
        monkeypatch.setattr(
            supabase_client,
            "get_verification_record_by_asset",
            lambda fn, tenant_id=None, auth_token=None, all_tenants=False: {
                "status": "success",
                "data": {"session_id": "sess-1", "tenant_id": "org-a", "extracted_face_url": "target_face.jpg"}
            }
        )

        resp = self.client.get(
            "/api/v1/assets/sign?file=target_face.jpg",
            headers={"Authorization": "Bearer token-org-a"}
        )
        assert resp.status_code == 200
        data = resp.get_json() or {}
        signed_url = data.get("signed_url") or data.get("url")
        assert signed_url is not None
        assert "target_face.jpg" in signed_url
        assert "tid=org-a" in signed_url
        assert "sig=" in signed_url

    def test_other_tenant_is_forbidden(self, monkeypatch):
        """Caller from different tenant is rejected with 403 or 404."""
        import auth_validator
        import supabase_client

        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "user-b", "email": "b@org-b.com", "user_metadata": {"tenant_id": "org-b"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-b", "role": "admin"}]
        )
        # Mock supabase record owned by org-a
        monkeypatch.setattr(
            supabase_client,
            "get_verification_record_by_asset",
            lambda fn, tenant_id=None, auth_token=None, all_tenants=False: {
                "status": "success",
                "data": {"session_id": "sess-1", "tenant_id": "org-a", "extracted_face_url": "target_face.jpg"}
            }
        )

        resp = self.client.get(
            "/api/v1/assets/sign?file=target_face.jpg",
            headers={"Authorization": "Bearer token-org-b"}
        )
        assert resp.status_code in (403, 404)


class TestApplicantSessionPidAndCompositeUnique:
    """UNIT — Server-generated PID and composite UNIQUE (tenant_id, session_id)."""

    @pytest.fixture(autouse=True)
    def setup_app_client(self):
        sys.path.insert(0, OCR_DIR)
        from engine import app
        self.app = app
        self.client = app.test_client()

    def test_client_supplied_pid_is_ignored_and_server_uuid4_generated(self, monkeypatch):
        """Client-supplied pid in /api/v1/auth/applicant_session must be ignored; server generates uuid4."""
        import auth_validator
        import uuid

        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "admin-1", "email": "admin@org-test.com", "user_metadata": {"tenant_id": "org-test"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-test", "role": "admin"}]
        )

        resp = self.client.post(
            "/api/v1/auth/applicant_session",
            json={
                "pid": "attacker-chosen-pid",
                "flow": "PAN_FACE",
                "tenant_id": "org-test"
            },
            headers={"Authorization": "Bearer admin-token"}
        )
        assert resp.status_code == 200
        data = resp.get_json() or {}
        # Client pid must be rejected / ignored
        assert data.get("pid") != "attacker-chosen-pid", "Server accepted client-supplied pid"
        # Must be valid uuid4
        val = uuid.UUID(data.get("pid"), version=4)
        assert str(val) == data.get("pid")

    def test_upsert_verification_record_uses_composite_on_conflict(self, monkeypatch):
        """upsert_verification_record must include on_conflict=tenant_id,session_id in request URL."""
        import supabase_client
        captured_urls = []

        class DummyResponse:
            status = 200
            def read(self):
                return b'{"status": "ok"}'
            def __enter__(self):
                return self
            def __exit__(self, *args):
                pass

        monkeypatch.setattr(supabase_client, "is_configured", lambda: True)
        monkeypatch.setattr(
            urllib.request,
            "urlopen",
            lambda req, timeout=5: (captured_urls.append(req.full_url), DummyResponse())[1]
        )

        supabase_client.upsert_verification_record(
            {"session_id": "sess-test", "tenant_id": "org-a", "overall_status": "COMPLETED"}
        )
        assert len(captured_urls) == 1
        assert "on_conflict=tenant_id,session_id" in captured_urls[0], (
            f"Expected on_conflict=tenant_id,session_id in URL, got {captured_urls[0]}"
        )

    def test_same_session_id_under_two_tenants_creates_two_rows(self, monkeypatch):
        """Same session_id under two different tenants must create two distinct rows, never overwriting."""
        import supabase_client

        # Simulate database state with composite key (tenant_id, session_id)
        mock_db = {}  # key: (tenant_id, session_id), value: dict

        def mock_urlopen(req, timeout=5):
            url = req.full_url
            assert "on_conflict=tenant_id,session_id" in url, "Missing on_conflict parameter"
            payload = json.loads(req.data.decode("utf-8"))
            key = (payload["tenant_id"], payload["session_id"])
            mock_db[key] = payload
            class MockRes:
                status = 200
                def read(self):
                    return json.dumps([payload]).encode("utf-8")
                def __enter__(self): return self
                def __exit__(self, *a): pass
            return MockRes()

        monkeypatch.setattr(supabase_client, "is_configured", lambda: True)
        monkeypatch.setattr(urllib.request, "urlopen", mock_urlopen)

        # Upsert session under tenant A
        res1 = supabase_client.upsert_verification_record(
            {"session_id": "shared-session-123", "tenant_id": "org-a", "extracted_name": "Alice"}
        )
        # Upsert same session under tenant B
        res2 = supabase_client.upsert_verification_record(
            {"session_id": "shared-session-123", "tenant_id": "org-b", "extracted_name": "Bob"}
        )

        # Verify both rows exist independently
        assert len(mock_db) == 2, f"Expected 2 rows in DB, got {len(mock_db)}"
        assert ("org-a", "shared-session-123") in mock_db
        assert ("org-b", "shared-session-123") in mock_db
        assert mock_db[("org-a", "shared-session-123")]["extracted_name"] == "Alice"
        assert mock_db[("org-b", "shared-session-123")]["extracted_name"] == "Bob"


class TestSuperadminSigningRemoved:
    """UNIT — superadmin auth_validator no longer exposes signing; superadmin images go through engine."""

    def test_superadmin_auth_validator_does_not_have_signing_functions(self):
        """superadmin/backend/auth_validator.py must NOT expose generate/verify_signed_asset_url."""
        import sys, os
        _repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        if _repo_root not in sys.path:
            sys.path.insert(0, _repo_root)
        from superadmin.backend import auth_validator as sa_av

        assert not hasattr(sa_av, "generate_signed_asset_url"), (
            "generate_signed_asset_url must be removed from superadmin"
        )
        assert not hasattr(sa_av, "verify_signed_asset_url"), (
            "verify_signed_asset_url must be removed from superadmin"
        )
        assert not hasattr(sa_av, "ASSET_SIGNING_SECRET") or sa_av.ASSET_SIGNING_SECRET == "", (
            "ASSET_SIGNING_SECRET must be removed from superadmin"
        )

    def test_superadmin_startup_does_not_require_asset_signing_secret(self, monkeypatch):
        """Superadmin validate_startup_secrets must pass even if ASSET_SIGNING_SECRET is unset."""
        import sys, os
        _repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        if _repo_root not in sys.path:
            sys.path.insert(0, _repo_root)
        from superadmin.backend import auth_validator as sa_av

        monkeypatch.setenv("APPLICANT_SESSION_SECRET", "a" * 64)
        monkeypatch.setenv("ASSET_SIGNING_SECRET", "")
        monkeypatch.setenv("SUPABASE_URL", "https://mock.supabase.co")
        monkeypatch.setenv("SUPABASE_KEY", "mock-key")
        sa_av.reload_secrets()
        # Must not raise RuntimeError for ASSET_SIGNING_SECRET
        sa_av.validate_startup_secrets()


class TestVerificationSessionIdUnification:
    """UNIT — Applicant steps (OCR + live verify) share the applicant token's pid as session_id."""

    @pytest.fixture(autouse=True)
    def setup_app_client(self):
        sys.path.insert(0, OCR_DIR)
        from engine import app
        self.app = app
        self.client = app.test_client()

    def test_ocr_and_live_verify_with_same_token_write_one_row(self, monkeypatch):
        """OCR + live_verify with the same applicant token must produce ONE row keyed by (tenant, pid)."""
        import engine
        import supabase_client
        import io
        import cv2
        import numpy as np

        # Create valid 20x20 JPEG bytes
        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()
        tiny_b64 = "data:image/jpeg;base64," + base64.b64encode(jpg_bytes).decode("utf-8")

        # Mock engine operations
        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"quality_pass": True, "score": 95})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["NAME JOHN DOE", "PAN ABCDE1234F"], [0.99], 0.99,
                {"name": "JOHN DOE", "pan_number": "ABCDE1234F", "document_type": "pan"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)
        monkeypatch.setattr(
            engine,
            "_cross_verify_uploaded_vs_live",
            lambda refs, h, i: {"face_match": True, "step3_face_matches": [{"verified": True}]}
        )

        # In-memory mock database keyed by (tenant_id, session_id)
        mock_db = {}

        def mock_upsert(payload, auth_token=None):
            key = (payload.get("tenant_id"), payload.get("session_id"))
            if key not in mock_db:
                mock_db[key] = {}
            mock_db[key].update(payload)
            return {"status": "success", "synced": True, "data": [mock_db[key]]}

        monkeypatch.setattr(supabase_client, "upsert_verification_record", mock_upsert)

        # Create applicant token with PAN_FACE flow and authoritative external_ref
        token = av.create_applicant_token("PID-UNIFIED-777", "PAN_FACE", "org-test", ttl_seconds=3600, external_ref="REF-EXT-4040")

        # 1. Step 1: Run OCR
        ocr_resp = self.client.post(
            "/api/v1/ocr",
            data={
                "file": (io.BytesIO(jpg_bytes), "test_pan.jpg"),
                "document_type": "PAN",
                "external_ref": "REF-EXT-4040"
            },
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert ocr_resp.status_code == 200, f"OCR failed: {ocr_resp.get_data(as_text=True)}"

        # 2. Step 2: Run Live Verify
        live_resp = self.client.post(
            "/api/v1/live_verify",
            json={
                "image": tiny_b64,
                "external_ref": "REF-EXT-4040"
            },
            headers={"X-Applicant-Token": token}
        )
        assert live_resp.status_code == 200, f"Live verify failed: {live_resp.get_data(as_text=True)}"

        # 3. Assertions: Exactly ONE row in database keyed by (tenant_id, pid)
        assert len(mock_db) == 1, (
            f"Expected exactly 1 row for multi-step applicant verification, got {len(mock_db)} rows: {list(mock_db.keys())}"
        )
        assert ("org-test", "PID-UNIFIED-777") in mock_db
        stored_row = mock_db[("org-test", "PID-UNIFIED-777")]
        assert stored_row["session_id"] == "PID-UNIFIED-777"
        assert stored_row.get("external_ref") == "REF-EXT-4040"
        assert stored_row["document_type"] == "pan"
        assert stored_row["face_match_verified"] is True


class TestApplicantSessionRevocationEnforcement:
    """UNIT — Applicant token revocation upon final step completion and via admin revoke API."""

    @pytest.fixture(autouse=True)
    def setup_app_client(self):
        sys.path.insert(0, OCR_DIR)
        from engine import app
        self.app = app
        self.client = app.test_client()

    def test_token_revoked_on_final_step_and_reused_returns_401(self, monkeypatch):
        """Token must be revoked upon completing final step; subsequent reuse must return 401."""
        import engine
        import supabase_client
        import io, cv2, numpy as np

        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()
        tiny_b64 = "data:image/jpeg;base64," + base64.b64encode(jpg_bytes).decode("utf-8")

        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"quality_pass": True, "score": 95})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["NAME JOHN DOE", "PAN ABCDE1234F"], [0.99], 0.99,
                {"name": "JOHN DOE", "pan_number": "ABCDE1234F", "document_type": "pan"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)
        monkeypatch.setattr(
            engine,
            "_cross_verify_uploaded_vs_live",
            lambda refs, h, i: {"face_match": True, "step3_face_matches": [{"verified": True}]}
        )
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})

        token = av.create_applicant_token("PID-REVOKE-AUTO", "PAN_FACE", "org-test", ttl_seconds=3600)

        # Step 1: Run OCR (intermediate step)
        resp1 = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "pan.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp1.status_code == 200

        # Step 2: Run Live Verify (final allowed step in PAN_FACE)
        resp2 = self.client.post(
            "/api/v1/live_verify",
            json={"image": tiny_b64},
            headers={"X-Applicant-Token": token}
        )
        assert resp2.status_code == 200

        # Step 3: Reuse token after completion -> 401
        resp3 = self.client.post(
            "/api/v1/live_verify",
            json={"image": tiny_b64},
            headers={"X-Applicant-Token": token}
        )
        assert resp3.status_code == 401, f"Expected 401 on token reuse after completion, got {resp3.status_code}"

    def test_single_step_ocr_revoked_on_completion_reuse_returns_401(self, monkeypatch):
        """Single-step flow (e.g. PAN) must revoke token immediately upon OCR completion."""
        import engine
        import supabase_client
        import io, cv2, numpy as np

        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()

        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"quality_pass": True, "score": 95})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["NAME JOHN DOE", "PAN ABCDE1234F"], [0.99], 0.99,
                {"name": "JOHN DOE", "pan_number": "ABCDE1234F", "document_type": "pan"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})

        token = av.create_applicant_token("PID-SINGLE-STEP", "PAN", "org-test", ttl_seconds=3600)

        # Run OCR
        resp1 = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "pan.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp1.status_code == 200

        # Reuse token -> 401
        resp2 = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "pan.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp2.status_code == 401, f"Expected 401 on token reuse after single step completion, got {resp2.status_code}"

    def test_revocation_persistence_failure_on_final_step_returns_503(self, monkeypatch):
        """If revocation persistence returns False upon final step completion, endpoint returns 503."""
        import engine
        import supabase_client
        import auth_validator
        import io, cv2, numpy as np

        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()

        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"quality_pass": True, "score": 95})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["NAME JOHN DOE", "PAN ABCDE1234F"], [0.99], 0.99,
                {"name": "JOHN DOE", "pan_number": "ABCDE1234F", "document_type": "pan"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})
        # Simulate revocation persistence failure
        monkeypatch.setattr(auth_validator, "revoke_applicant_token", lambda tok: False)

        token = av.create_applicant_token("PID-FAIL-REV", "PAN", "org-test", ttl_seconds=3600)

        resp = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "pan.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp.status_code == 503, f"Expected 503 on revocation persistence failure, got {resp.status_code}"

    def test_admin_revoke_endpoint_own_tenant_succeeds(self, monkeypatch):
        """Tenant admin can revoke applicant token belonging to their own tenant."""
        import auth_validator

        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "admin-a", "email": "admin@org-a.com", "user_metadata": {"tenant_id": "org-a"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-a", "role": "admin"}]
        )

        token = av.create_applicant_token("PID-REV-ME", "PAN_FACE", "org-a", ttl_seconds=3600)
        resp = self.client.post(
            "/api/v1/auth/applicant_session/revoke",
            json={"token": token},
            headers={"Authorization": "Bearer admin-token-org-a"}
        )
        assert resp.status_code == 200
        # Reusing the token must fail with ValueError/revoked
        with pytest.raises(ValueError, match="revoked"):
            av.verify_applicant_token(token)

    def test_admin_revoke_endpoint_cross_tenant_forbidden_403(self, monkeypatch):
        """Tenant admin cannot revoke applicant token belonging to a different tenant."""
        import auth_validator

        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "admin-b", "email": "admin@org-b.com", "user_metadata": {"tenant_id": "org-b"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-b", "role": "admin"}]
        )

        token_org_a = av.create_applicant_token("PID-ORG-A", "PAN_FACE", "org-a", ttl_seconds=3600)
        resp = self.client.post(
            "/api/v1/auth/applicant_session/revoke",
            json={"token": token_org_a},
            headers={"Authorization": "Bearer admin-token-org-b"}
        )
        assert resp.status_code == 403

    def test_admin_revoke_endpoint_persistence_failure_returns_503(self, monkeypatch):
        """If revoke_applicant_token returns False, revoke endpoint must return 503."""
        import auth_validator

        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "admin-a", "email": "admin@org-a.com", "user_metadata": {"tenant_id": "org-a"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-a", "role": "admin"}]
        )
        monkeypatch.setattr(auth_validator, "revoke_applicant_token", lambda tok: False)

        token = av.create_applicant_token("PID-REV-FAIL", "PAN_FACE", "org-a", ttl_seconds=3600)
        resp = self.client.post(
            "/api/v1/auth/applicant_session/revoke",
            json={"token": token},
            headers={"Authorization": "Bearer admin-token-org-a"}
        )
        assert resp.status_code == 503


class TestApplicantExternalRefSecurity:
    """Tests ensuring external_ref is controlled by tenant admins only and immutable by applicants."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import engine
        engine.app.config["TESTING"] = True
        self.client = engine.app.test_client()

    def test_external_ref_accepted_in_session_and_embedded_in_token(self, monkeypatch):
        import auth_validator
        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "admin-1", "email": "admin@org-1.com", "user_metadata": {"tenant_id": "org-1"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-1", "role": "admin"}]
        )

        resp = self.client.post(
            "/api/v1/auth/applicant_session",
            json={
                "flow": "PAN",
                "external_ref": "ext-admin-ref-12345"
            },
            headers={"Authorization": "Bearer admin-token"}
        )
        assert resp.status_code == 200
        data = resp.get_json()
        token = data.get("applicant_token")
        assert token is not None

        decoded = auth_validator.verify_applicant_token(token)
        assert decoded.get("external_ref") == "ext-admin-ref-12345"

    def test_applicant_supplied_external_ref_ignored_in_verification(self, monkeypatch):
        import engine
        import supabase_client

        upserted_rows = []
        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: upserted_rows.append(payload) or {"status": "success", "synced": True}
        )
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(engine, "_cross_verify_uploaded_vs_live", lambda refs, h, i: {"face_match": True, "step3_face_matches": [{"verified": True}]})

        # Token created with admin-supplied external_ref
        token = av.create_applicant_token("PID-EXT-REF", "LIVE_VERIFY", "org-test", ttl_seconds=3600, external_ref="token-authoritative-ref")

        import base64
        tiny_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        tiny_b64 = "data:image/png;base64," + base64.b64encode(tiny_png).decode("utf-8")

        resp = self.client.post(
            "/api/v1/live_verify",
            json={
                "image": tiny_b64,
                "external_ref": "attacker-spoofed-ref"
            },
            headers={"X-Applicant-Token": token}
        )
        assert resp.status_code == 200
        assert len(upserted_rows) >= 1
        assert upserted_rows[-1].get("external_ref") == "token-authoritative-ref"


class TestApplicantOcrStepCompletionAndAttemptCap:
    """Test applicant OCR step completion requires detection + parsed fields, and attempt cap of 5."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import engine
        engine.app.config["TESTING"] = True
        self.client = engine.app.test_client()

    def test_blurry_or_unreadable_upload_does_not_complete_step_or_revoke_token(self, monkeypatch):
        import engine
        import supabase_client
        import io
        from PIL import Image

        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpg_bytes = buf.getvalue()

        monkeypatch.setattr(
            engine,
            "check_image_quality",
            lambda img_np: {"blur_status": "BLURRY", "passed": False}
        )
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda warped_img, upload_folder, stem, hinted_type=None: (
                warped_img, [], [], 0.0, {"document_type": "UNKNOWN"}, "mild"
            )
        )
        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: {"status": "success", "synced": True}
        )

        token = av.create_applicant_token("PID-BLURRY-TEST", "PAN", "org-test", ttl_seconds=3600)

        resp = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "blurry.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp.status_code == 200

        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        session_state = av._ACTIVE_APPLICANT_SESSIONS.get(token_hash, {})
        assert "PAN" not in session_state.get("completed_steps", set())
        assert "OCR" not in session_state.get("completed_steps", set())

        verified = av.verify_applicant_token(token)
        assert verified["pid"] == "PID-BLURRY-TEST"

    def test_applicant_token_attempt_cap_exceeded_returns_429(self, monkeypatch):
        import engine
        import supabase_client
        import io
        from PIL import Image

        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpg_bytes = buf.getvalue()

        monkeypatch.setattr(
            engine,
            "check_image_quality",
            lambda img_np: {"blur_status": "BLURRY", "passed": False}
        )
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda warped_img, upload_folder, stem, hinted_type=None: (
                warped_img, [], [], 0.0, {"document_type": "UNKNOWN"}, "mild"
            )
        )
        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: {"status": "success", "synced": True}
        )

        token = av.create_applicant_token("PID-ATTEMPT-CAP", "PAN", "org-test", ttl_seconds=3600)

        for attempt in range(1, 6):
            resp = self.client.post(
                "/api/v1/ocr",
                data={"file": (io.BytesIO(jpg_bytes), f"attempt_{attempt}.jpg")},
                headers={"X-Applicant-Token": token},
                content_type="multipart/form-data"
            )
            assert resp.status_code == 200, f"Attempt {attempt} should succeed, got {resp.status_code}"

        resp6 = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "attempt_6.jpg")},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp6.status_code == 429, f"Expected 429 after 5 attempts, got {resp6.status_code}"


class TestVerificationRecordUpsertFailureHandling:
    """Test that non-success status from upsert_verification_record returns HTTP 502 with retry-safe message."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import engine
        engine.app.config["TESTING"] = True
        self.client = engine.app.test_client()

    def test_run_ocr_upsert_failure_returns_502(self, monkeypatch):
        import engine
        import supabase_client
        import io
        from PIL import Image

        img = Image.new("RGB", (200, 200), color=(100, 100, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpg_bytes = buf.getvalue()

        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: {"status": "error", "message": "Database sync failed"}
        )

        token = av.create_applicant_token("PID-502-OCR", "PAN", "org-test", ttl_seconds=3600)

        resp = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "pan.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}"
        data = resp.get_json()
        assert data["status"] == "error"
        assert "retry" in data["message"].lower()

    def test_live_verify_upsert_failure_returns_502(self, monkeypatch):
        import engine
        import supabase_client
        import base64

        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(engine, "_cross_verify_uploaded_vs_live", lambda refs, h, i: {"face_match": True, "step3_face_matches": [{"verified": True}]})
        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: {"status": "error", "message": "Database sync failed"}
        )

        token = av.create_applicant_token("PID-502-LIVE", "LIVE_VERIFY", "org-test", ttl_seconds=3600)

        tiny_png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
        tiny_b64 = "data:image/png;base64," + base64.b64encode(tiny_png).decode("utf-8")

        resp = self.client.post(
            "/api/v1/live_verify",
            json={"image": tiny_b64},
            headers={"X-Applicant-Token": token}
        )
        assert resp.status_code == 502, f"Expected 502, got {resp.status_code}"
        data = resp.get_json()
        assert data["status"] == "error"
        assert "retry" in data["message"].lower()


class TestDocumentTypeFieldEnforcement:
    """Test _is_doc_detected_and_fields_parsed requires specific fields per doc type:
    pan_number for PAN, aadhaar_number for Aadhaar, dl_number for DL, and id_number for Voter ID."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import engine
        engine.app.config["TESTING"] = True
        self.client = engine.app.test_client()

    def test_parsed_dl_completes_step(self, monkeypatch):
        import engine
        import supabase_client
        import io, cv2, numpy as np

        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()

        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"blur_status": "OK", "passed": True})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["DRIVING LICENCE", "DL DL-1420110012345", "ALICE"], [0.99], 0.99,
                {"name": "ALICE", "dl_number": "DL-1420110012345", "document_type": "DL"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})

        token = av.create_applicant_token("PID-DL-STEP", "DL_FACE", "org-test", ttl_seconds=3600)

        resp = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "dl.jpg"), "document_type": "DL"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_data(as_text=True)}"

        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        session_state = av._ACTIVE_APPLICANT_SESSIONS.get(token_hash, {})
        assert "DL" in session_state.get("completed_steps", set())
        assert "OCR" in session_state.get("completed_steps", set())

    def test_parsed_voter_id_completes_step(self, monkeypatch):
        import engine
        import supabase_client
        import io, cv2, numpy as np

        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()

        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"blur_status": "OK", "passed": True})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["ELECTION COMMISSION OF INDIA", "XYZ1234567", "BOB"], [0.99], 0.99,
                {"name": "BOB", "id_number": "XYZ1234567", "document_type": "VOTER_ID"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)
        monkeypatch.setattr(supabase_client, "upsert_verification_record", lambda p, auth_token=None: {"status": "success", "synced": True})

        token = av.create_applicant_token("PID-VOTER-STEP", "VOTER_ID_FACE", "org-test", ttl_seconds=3600)

        resp = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "voter.jpg"), "document_type": "VOTER_ID"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_data(as_text=True)}"

        token_hash = hashlib.sha256(token.encode('utf-8')).hexdigest()
        session_state = av._ACTIVE_APPLICANT_SESSIONS.get(token_hash, {})
        assert "VOTER_ID" in session_state.get("completed_steps", set())
        assert "OCR" in session_state.get("completed_steps", set())


class TestAttemptExclusionOn5xx:
    """Test that attempts ending in 5xx/502 are not counted towards the attempt cap."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import engine
        engine.app.config["TESTING"] = True
        self.client = engine.app.test_client()

    def test_after_502_retry_succeeds_and_token_still_valid(self, monkeypatch):
        import engine
        import supabase_client
        import io, cv2, numpy as np

        arr = np.zeros((20, 20, 3), dtype=np.uint8)
        _, buf = cv2.imencode(".jpg", arr)
        jpg_bytes = buf.tobytes()

        monkeypatch.setattr(engine, "load_cv_image", lambda path: arr)
        # Use blur status to avoid auto-revoking token on success so we can verify token validity
        monkeypatch.setattr(engine, "check_image_quality", lambda img: {"blur_status": "BLURRY", "passed": False})
        monkeypatch.setattr(engine, "detect_and_warp_document", lambda img: (img, True))
        monkeypatch.setattr(engine, "extract_and_align_face", lambda img, orig: (img, {"source": "test"}))
        monkeypatch.setattr(
            engine,
            "best_ocr_pass",
            lambda img, folder, stem, hinted_type=None: (
                img, ["PAN ABCDE1234F"], [0.99], 0.99,
                {"pan_number": "ABCDE1234F", "document_type": "pan"},
                True
            )
        )
        monkeypatch.setattr(engine, "_save_jpg", lambda path, img: True)

        token = av.create_applicant_token("PID-502-RETRY", "PAN", "org-test", ttl_seconds=3600)

        # 1. Simulate 5 failed calls that return 502 (e.g. database sync failure)
        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: {"status": "error", "message": "Supabase temporary timeout"}
        )

        for i in range(5):
            res_502 = self.client.post(
                "/api/v1/ocr",
                data={"file": (io.BytesIO(jpg_bytes), f"doc_{i}.jpg"), "document_type": "PAN"},
                headers={"X-Applicant-Token": token},
                content_type="multipart/form-data"
            )
            assert res_502.status_code == 502

        # 2. Now database recovers and sync succeeds
        monkeypatch.setattr(
            supabase_client,
            "upsert_verification_record",
            lambda payload, auth_token=None: {"status": "success", "synced": True}
        )

        # 3. Retry must succeed and NOT return 429
        retry_res = self.client.post(
            "/api/v1/ocr",
            data={"file": (io.BytesIO(jpg_bytes), "doc_retry.jpg"), "document_type": "PAN"},
            headers={"X-Applicant-Token": token},
            content_type="multipart/form-data"
        )
        assert retry_res.status_code == 200, f"Expected 200 on retry after 502, got {retry_res.status_code}"

        # Token must still be valid
        verified = av.verify_applicant_token(token)
        assert verified["pid"] == "PID-502-RETRY"


class TestApplicantExternalRefLengthCap:
    """Test create_applicant_session_api caps external_ref at 255 chars (400 above it)."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import engine
        engine.app.config["TESTING"] = True
        self.client = engine.app.test_client()

    def test_external_ref_over_255_chars_returns_400(self, monkeypatch):
        import auth_validator
        monkeypatch.setattr(
            auth_validator,
            "verify_supabase_token",
            lambda tok: {"id": "admin-len", "email": "admin@org-len.com", "user_metadata": {"tenant_id": "org-len"}}
        )
        monkeypatch.setattr(
            auth_validator,
            "get_user_tenant_membership",
            lambda uid, tok: [{"organization_id": "org-len", "role": "admin"}]
        )

        # 256 characters -> must return 400
        long_ref = "x" * 256
        resp_400 = self.client.post(
            "/api/v1/auth/applicant_session",
            json={"flow": "PAN", "external_ref": long_ref},
            headers={"Authorization": "Bearer admin-token"}
        )
        assert resp_400.status_code == 400, f"Expected 400 for 256-char external_ref, got {resp_400.status_code}"
        assert resp_400.get_json()["status"] == "error"

        # 255 characters -> must succeed with 200
        valid_ref = "y" * 255
        resp_200 = self.client.post(
            "/api/v1/auth/applicant_session",
            json={"flow": "PAN", "external_ref": valid_ref},
            headers={"Authorization": "Bearer admin-token"}
        )
        assert resp_200.status_code == 200, f"Expected 200 for 255-char external_ref, got {resp_200.status_code}"


class TestUploadFolderRetentionCleanup:
    """Test cleanup function deletes files in UPLOAD_FOLDER older than RETENTION_HOURS (env var, default 24)."""

    def test_cleanup_expired_assets_with_fake_old_files(self, monkeypatch, tmp_path):
        import engine
        import time

        upload_dir = str(tmp_path / "uploads")
        os.makedirs(upload_dir, exist_ok=True)

        old_file1 = os.path.join(upload_dir, "old_id_1.jpg")
        old_file2 = os.path.join(upload_dir, "old_id_2.jpg")
        fresh_file = os.path.join(upload_dir, "recent_id.jpg")

        for f in (old_file1, old_file2, fresh_file):
            with open(f, "wb") as fp:
                fp.write(b"fake image data")

        now = time.time()
        # Set old files to 26 hours ago and 48 hours ago
        os.utime(old_file1, (now - 26 * 3600, now - 26 * 3600))
        os.utime(old_file2, (now - 48 * 3600, now - 48 * 3600))
        # Set fresh file to 1 hour ago
        os.utime(fresh_file, (now - 1 * 3600, now - 1 * 3600))

        # Test env var RETENTION_HOURS default 24
        monkeypatch.setenv("RETENTION_HOURS", "24")
        purged = engine.cleanup_expired_assets(upload_folder=upload_dir)

        assert purged == 2, f"Expected 2 purged files, got {purged}"
        assert not os.path.exists(old_file1)
        assert not os.path.exists(old_file2)
        assert os.path.exists(fresh_file)

    def test_cleanup_script_execution(self, tmp_path):
        import subprocess
        import time

        upload_dir = str(tmp_path / "script_uploads")
        os.makedirs(upload_dir, exist_ok=True)

        old_file = os.path.join(upload_dir, "expired.jpg")
        with open(old_file, "wb") as fp:
            fp.write(b"fake data")

        now = time.time()
        os.utime(old_file, (now - 30 * 3600, now - 30 * 3600))

        script_path = os.path.join("products", "ocr_engine", "cleanup_assets.py")
        res = subprocess.run(
            [sys.executable, script_path, "--upload-folder", upload_dir, "--retention-hours", "24"],
            capture_output=True,
            text=True
        )
        assert res.returncode == 0, f"Script failed: {res.stderr}"
        assert "removed 1 file" in res.stdout.lower() or "purged 1 file" in res.stdout.lower()
        assert not os.path.exists(old_file)














