-- Migration: 20261026_000003_composite_unique_tenant_session.sql
-- Description: Replace single-column UNIQUE (session_id) constraint with composite
-- UNIQUE (tenant_id, session_id) constraint on public.verifications to prevent
-- cross-tenant session collision and overwrite in multi-tenant environments.
-- Also enforce tenant_id NOT NULL and add external_ref column.

-- 1. Drop existing single-column unique constraint and its index if present
ALTER TABLE public.verifications DROP CONSTRAINT IF EXISTS verifications_session_id_key;
DROP INDEX IF EXISTS public.verifications_session_id_key;

-- 2. Add composite UNIQUE constraint on (tenant_id, session_id)
ALTER TABLE public.verifications
    ADD CONSTRAINT verifications_tenant_id_session_id_key UNIQUE (tenant_id, session_id);

-- 3. Add composite index to optimize tenant + session queries
CREATE INDEX IF NOT EXISTS idx_verifications_tenant_session
    ON public.verifications (tenant_id, session_id);

-- 4. Enforce tenant_id is NOT NULL
ALTER TABLE public.verifications
    ALTER COLUMN tenant_id SET NOT NULL;

-- 5. Add optional external_ref column to store client/external identifiers
ALTER TABLE public.verifications
    ADD COLUMN IF NOT EXISTS external_ref VARCHAR(255);
