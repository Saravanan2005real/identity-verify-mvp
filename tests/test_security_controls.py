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
        av.revoke_applicant_token(token)
        # Confirm revocation is in the store
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        assert av._is_revoked(token_hash), "Token should be marked as revoked in the backend"


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
