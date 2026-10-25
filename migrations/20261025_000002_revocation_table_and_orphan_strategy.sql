-- ==============================================================================
-- Migration: 20261025_000002_revocation_table_and_orphan_strategy.sql
-- Description:
--   Phase 1 Security Remediation — Supplement to migration 000001:
--   1. Durable applicant token revocation table (required for REVOCATION_BACKEND=supabase).
--   2. Fix missing INSERT grant on verifications for authenticated role (OCR upsert).
--   3. Quarantine strategy for orphaned verifications rows (no tenant_id).
--      Orphaned rows are moved to a quarantine state rather than assigned to an
--      arbitrary default tenant. An operator must review and either:
--        (a) map the row to a verified tenant (UPDATE tenant_id), or
--        (b) permanently delete after data-retention period.
--   4. Preflight checks to validate preconditions before the migration runs.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- PREFLIGHT CHECKS (run these SELECTs manually before applying the migration)
-- ------------------------------------------------------------------------------
-- Check 1: Confirm the verifications table has a tenant_id column (not organization_id)
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='verifications' AND column_name='tenant_id';
-- Expected: 1 row returned.
--
-- Check 2: Count orphaned rows that will be quarantined
-- SELECT COUNT(*) FROM public.verifications WHERE tenant_id IS NULL;
-- Review the count — large numbers may indicate a data quality issue to resolve first.
--
-- Check 3: Verify organizations table exists and has at least one active row
-- SELECT COUNT(*) FROM public.organizations WHERE status='ACTIVE';
--
-- BACKUP REMINDER: Take a full Supabase backup before running this migration.
-- Supabase Dashboard > Database > Backups > Download
-- ROLLBACK NOTE: This migration cannot be automatically reversed because:
--   (a) The quarantine status is written into existing rows.
--   (b) Restoring from backup is the only safe rollback path.
-- ==============================================================================

-- 1. Durable token revocation table
CREATE TABLE IF NOT EXISTS public.revoked_applicant_tokens (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex of the full token
    pid        TEXT,                          -- applicant process ID for audit
    reason     TEXT        NOT NULL DEFAULT 'explicit',
    revoked_at BIGINT      NOT NULL,          -- Unix epoch seconds
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_hash ON public.revoked_applicant_tokens(token_hash);

-- RLS on revocation table
ALTER TABLE public.revoked_applicant_tokens ENABLE ROW LEVEL SECURITY;

-- Only the service role (backend) may read/write revoked tokens.
-- No direct client access is required or allowed.
CREATE POLICY "Service role full access on revoked tokens"
    ON public.revoked_applicant_tokens
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON TABLE public.revoked_applicant_tokens FROM anon;
REVOKE ALL ON TABLE public.revoked_applicant_tokens FROM authenticated;
GRANT ALL  ON TABLE public.revoked_applicant_tokens TO service_role;

-- 2. Fix missing INSERT grant on verifications for the authenticated role
--    (the OCR engine upserts records via the anon/publishable key which maps
--     to the authenticated role when a valid JWT is supplied, or service_role
--     when SUPABASE_SERVICE_ROLE_KEY is used).
--    service_role already has ALL; this grant is for authenticated upserts
--    going through RLS policies.
GRANT INSERT ON TABLE public.verifications TO authenticated;

-- 3. Quarantine strategy for orphaned verifications rows (tenant_id IS NULL)
--
-- Rows without a tenant_id were created before the multi-tenant migration.
-- They MUST NOT be silently assigned to any tenant — that would create a false
-- ownership claim. Instead, mark them as MANUAL_REVIEW so operators can triage.
--
-- Operators should then:
--   a) Identify the original session owner via session_id / extracted_name / dob.
--   b) UPDATE tenant_id = '<verified-org-id>' WHERE id = '<row-id>';
--   c) Or permanently delete rows that cannot be attributed after the retention window.
--
-- NOTE: This UPDATE is idempotent and safe to re-run.
DO $$
DECLARE
    quarantine_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO quarantine_count
    FROM public.verifications
    WHERE tenant_id IS NULL;

    IF quarantine_count > 0 THEN
        RAISE NOTICE 'Quarantining % orphaned verification row(s) with no tenant_id.', quarantine_count;
        RAISE NOTICE 'These rows are set to MANUAL_REVIEW. Operator action required before they appear in any tenant dashboard.';

        UPDATE public.verifications
        SET overall_status = 'MANUAL_REVIEW',
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'quarantine_reason', 'No tenant_id at time of Phase1 migration',
                'quarantine_date', NOW()::text,
                'migration', '20261025_000002'
            ),
            updated_at = NOW()
        WHERE tenant_id IS NULL
          AND overall_status NOT IN ('MANUAL_REVIEW', 'REJECTED');
    ELSE
        RAISE NOTICE 'No orphaned rows found — no quarantine action required.';
    END IF;
END $$;

-- 4. Add a partial index to make orphan detection fast post-migration
CREATE INDEX IF NOT EXISTS idx_verifications_orphaned
    ON public.verifications(overall_status)
    WHERE tenant_id IS NULL;

-- 5. Secure index on revocation table timestamp for expiry queries
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_revoked_at
    ON public.revoked_applicant_tokens(revoked_at);
