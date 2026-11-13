# Database Migrations (`migrations/`)

This directory contains the production SQL migration scripts for **Verifyyy**'s Supabase PostgreSQL database. These scripts enforce multi-tenant security, Row-Level Security (RLS) isolation, cryptographically secure token revocation, and audit logging.

---

## Migration Index

| File | Title | Description |
| :--- | :--- | :--- |
| `20261024_000001_harden_rls_and_multi_tenancy.sql` | Phase 1 Security Hardening & Multi-Tenancy | Revokes open public access; creates `organizations` and `organization_members`; establishes multi-tenant RLS policies; adds audit trail triggers. |
| `20261025_000002_revocation_table_and_orphan_strategy.sql` | Token Revocation & Orphan Quarantine | Implements the durable `revoked_applicant_tokens` table for applicant token invalidation, fixes `INSERT` grants for the backend service role, and establishes an orphan record quarantine policy. |

---

## How to Apply Migrations

### Method 1: Supabase Web Dashboard (Recommended)
1. Log into your [Supabase Dashboard](https://supabase.com/dashboard).
2. Navigate to your project and open the **SQL Editor** from the left navigation.
3. Open `20261024_000001_harden_rls_and_multi_tenancy.sql`, paste the contents into the editor, and click **Run**.
4. Open `20261025_000002_revocation_table_and_orphan_strategy.sql`, paste the contents, and click **Run**.

### Method 2: Supabase CLI
```bash
# Link your local repo to your Supabase project:
supabase link --project-ref your-project-ref

# Apply pending migrations:
supabase db push
```

---

## Security Model Overview

### 1. Row-Level Security (RLS)
- **Tenant Isolation**: Every client admin may only read and write verification rows where `tenant_id` matches their verified organization membership.
- **Superadmin Bypass**: Platform superadmins are granted global access across all organizations.
- **Least-Privilege Grants**: Unauthenticated (`anon`) users are denied direct access to sensitive verification data and audit records.

### 2. Token Revocation
The `revoked_applicant_tokens` table stores SHA-256 hashes of explicitly revoked or invalidated applicant session tokens. The backend checks this table on incoming verification requests when `REVOCATION_BACKEND=supabase` is configured.

### 3. Orphan Record Quarantine
Historical or test verification sessions missing a `tenant_id` are automatically marked as `QUARANTINED` rather than being assigned to an arbitrary tenant, preventing unauthorized data leakage across organizational boundaries.
