# Security & Regression Test Suite (`tests/`)

This directory contains the automated test suite for **Verifyyy**, focusing on security controls, cryptographic token validation, multi-tenant isolation, asset URL signatures, and workflow step enforcement.

---

## Test Categories

The test suite in `tests/test_security_controls.py` is partitioned into two distinct categories using Pytest markers:

| Marker | Type | Prerequisites | Description |
| :--- | :--- | :--- | :--- |
| `not integ` | **Unit Tests** | None (100% offline) | Directly validates cryptographic token generation, tampering detection, expiration logic, signed asset URL validation, file header verification, identity masking, and step enforcement. |
| `integ` | **Integration Tests** | Live OCR Engine on `http://localhost:5001` | Executes live HTTP requests against the running Flask engine to verify rejection of unauthenticated requests, spoofed referers, token replay, path traversal, and unauthorized asset purges. |

---

## Running the Tests

### 1. Run Unit Tests (Fast & Standalone)
Does not require any servers to be running:
```bash
pytest tests/ -v -m "not integ"
```
**Expected Output**: 23 tests passed.

### 2. Run Integration Tests (Requires Running Backend)
First, ensure the AI OCR Engine is running on port 5001:
```bash
cd products/ocr_engine && python engine.py
```
Then in another terminal:
```bash
pytest tests/ -v -m "integ"
```

### 3. Run All Tests
```bash
pytest tests/ -v
```

---

## Test Coverage Matrix

- **`TestTokenExpiry`**: Validates rejection of expired HMAC tokens and acceptance of valid future tokens.
- **`TestTokenTampering`**: Verifies that modified payloads, truncated signatures, or empty tokens are rejected.
- **`TestTokenRevocation`**: Ensures revoked tokens are rejected across consecutive calls.
- **`TestTokenCrossTenantIsolation`**: Ensures tenant IDs embedded within tokens cannot be forged or substituted.
- **`TestSignedAssetURLs`**: Validates HMAC cryptographic signatures, expiration timestamps, tenant scoping, and path restrictions on biometric images.
- **`TestFileValidation`**: Tests magic byte detection to reject polyglot/spoofed HTML or script files uploaded as JPEGs.
- **`TestIdentityMasking`**: Verifies compliant masking of Aadhaar (first 8 digits hidden) and PAN tax numbers.
- **`TestWorkflowStepEnforcement`**: Verifies applicants cannot execute steps not authorized by their pipeline token.
- **`TestUnauthenticatedAccessBlocked`**: (Integration) Verifies unauthenticated callers cannot list or retrieve verification records.
- **`TestApplicantSessionIssuanceRestricted`**: (Integration) Enforces that applicant tokens cannot issue new applicant tokens.
- **`TestCrossTenantRecordAccess`**: (Integration) Tests protection against path traversal and unauthorized cross-tenant data retrieval.
- **`TestSuperadminRestrictions`**: (Integration) Verifies that asset purging requires superadmin credentials.
