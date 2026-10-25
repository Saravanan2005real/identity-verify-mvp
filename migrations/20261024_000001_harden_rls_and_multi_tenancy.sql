-- ==============================================================================
-- Migration: 20261024_000001_harden_rls_and_multi_tenancy.sql
-- Description:
--   Phase 1 Database Security Hardening:
--   1. Revoke unsafe public access policies on public.verifications.
--   2. Establish trusted tenant structure (organizations & memberships).
--   3. Enforce multi-tenant Row-Level Security (RLS) on all exposed tables.
--   4. Prevent privilege escalation, tampering with audit verdicts, and tenant hopping.
--   5. Provide secure database functions with server-side validation.
--   6. Enforce least-privilege PostgreSQL grants.
-- ==============================================================================

-- 1. Ensure required cryptographic extension exists
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. Organizations / Tenants & Memberships Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'PENDING')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer' CHECK (role IN ('superadmin', 'tenant_admin', 'reviewer', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_org_user UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON public.organization_members(organization_id);

-- ------------------------------------------------------------------------------
-- 3. Verification Sessions Schema Evolution (Add Tenant & Security Columns)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) UNIQUE NOT NULL,
    tenant_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT,
    applicant_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    document_type VARCHAR(50),
    id_number VARCHAR(100),
    extracted_name VARCHAR(255),
    dob VARCHAR(50),
    ocr_confidence FLOAT DEFAULT 0.0,
    face_match_verified BOOLEAN DEFAULT FALSE,
    face_match_distance FLOAT,
    face_match_threshold FLOAT,
    liveness_verified BOOLEAN DEFAULT FALSE,
    liveness_score FLOAT DEFAULT 0.0,
    overall_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (overall_status IN ('PENDING', 'OCR_COMPLETED', 'SUCCESS', 'MANUAL_REVIEW', 'FAILED', 'REJECTED')),
    extracted_face_url TEXT,
    live_holder_face_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure tenant_id column exists if table was previously created without it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'verifications' 
          AND column_name = 'tenant_id'
    ) THEN
        ALTER TABLE public.verifications ADD COLUMN tenant_id UUID REFERENCES public.organizations(id) ON DELETE RESTRICT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'verifications' 
          AND column_name = 'applicant_id'
    ) THEN
        ALTER TABLE public.verifications ADD COLUMN applicant_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. Audit Trail & Review Decisions Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id UUID NOT NULL REFERENCES public.verifications(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    decision VARCHAR(50) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'FLAGGED', 'SYSTEM_PROCESSED')),
    notes TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_records_verif_id ON public.audit_records(verification_id);
CREATE INDEX IF NOT EXISTS idx_audit_records_org_id ON public.audit_records(organization_id);

-- ------------------------------------------------------------------------------
-- 5. Helper Functions for Trusted Server-Side Authorization
-- ------------------------------------------------------------------------------
-- Check if current authenticated user has a global platform superadmin role
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = auth.uid()
          AND role = 'superadmin'
    ) OR (
        auth.jwt() -> 'app_metadata' ->> 'role' = 'superadmin'
    );
$$;

-- Check if current authenticated user is an active member of a specific organization
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.organization_id = org_id
          AND om.user_id = auth.uid()
          AND o.status = 'ACTIVE'
    ) OR public.is_superadmin();
$$;

-- Check if user is an organization admin
CREATE OR REPLACE FUNCTION public.is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.organization_id = org_id
          AND om.user_id = auth.uid()
          AND om.role IN ('superadmin', 'tenant_admin')
    ) OR public.is_superadmin();
$$;

-- ------------------------------------------------------------------------------
-- 6. Trigger: Guard Sensitive & Privileged Fields from Client-Side Tampering
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_verification_field_tampering()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Allow service_role and backend processes full authority
    IF (auth.jwt() ->> 'role' = 'service_role') OR public.is_superadmin() THEN
        RETURN NEW;
    END IF;

    -- Tenant owners and regular users CANNOT change tenant ownership
    IF OLD.tenant_id IS NOT NULL AND NEW.tenant_id <> OLD.tenant_id THEN
        RAISE EXCEPTION 'Modifying tenant_id on existing verification is strictly forbidden';
    END IF;

    -- Non-reviewer / non-admin cannot alter overall_status directly via client API
    IF OLD.overall_status <> NEW.overall_status THEN
        IF NOT public.is_org_admin(OLD.tenant_id) THEN
            RAISE EXCEPTION 'Insufficient permissions to alter verification status directly';
        END IF;
    END IF;

    -- Non-service roles cannot manipulate raw biometric distance/threshold calculations
    IF (OLD.face_match_distance IS DISTINCT FROM NEW.face_match_distance) OR
       (OLD.face_match_threshold IS DISTINCT FROM NEW.face_match_threshold) THEN
        IF auth.jwt() ->> 'role' <> 'service_role' THEN
            RAISE EXCEPTION 'Biometric distance and thresholds can only be recorded by verified engine';
        END IF;
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_verification_fields ON public.verifications;
CREATE TRIGGER trg_guard_verification_fields
    BEFORE UPDATE ON public.verifications
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_verification_field_tampering();

-- ------------------------------------------------------------------------------
-- 7. Remove Unsafe Public RLS Policies
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow public read access" ON public.verifications;
DROP POLICY IF EXISTS "Allow public insert access" ON public.verifications;
DROP POLICY IF EXISTS "Allow public update access" ON public.verifications;

-- Ensure RLS is active on all tables
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_records ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 8. Least-Privilege Policies: Organizations & Memberships
-- ------------------------------------------------------------------------------
-- Organizations
CREATE POLICY "Superadmins can manage all organizations"
    ON public.organizations
    FOR ALL
    TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

CREATE POLICY "Members can view their own organization"
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (public.is_org_member(id));

-- Organization Members
CREATE POLICY "Superadmins can manage all members"
    ON public.organization_members
    FOR ALL
    TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

CREATE POLICY "Tenant admins can manage their organization members"
    ON public.organization_members
    FOR ALL
    TO authenticated
    USING (public.is_org_admin(organization_id))
    WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Members can view colleagues within same organization"
    ON public.organization_members
    FOR SELECT
    TO authenticated
    USING (public.is_org_member(organization_id));

-- ------------------------------------------------------------------------------
-- 9. Least-Privilege Policies: Verifications
-- ------------------------------------------------------------------------------
-- A. Backend Microservices (service_role) have full access to sync and query
CREATE POLICY "Service role full access on verifications"
    ON public.verifications
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- B. Tenant Administrators & Reviewers can SELECT records belonging to their tenant
CREATE POLICY "Tenant members can view verifications for their organization"
    ON public.verifications
    FOR SELECT
    TO authenticated
    USING (
        (tenant_id IS NOT NULL AND public.is_org_member(tenant_id))
        OR public.is_superadmin()
    );

-- C. Tenant Administrators can UPDATE records for their tenant (e.g. review verdicts)
CREATE POLICY "Tenant admins can update verifications for their organization"
    ON public.verifications
    FOR UPDATE
    TO authenticated
    USING (
        (tenant_id IS NOT NULL AND public.is_org_admin(tenant_id))
        OR public.is_superadmin()
    )
    WITH CHECK (
        (tenant_id IS NOT NULL AND public.is_org_admin(tenant_id))
        OR public.is_superadmin()
    );

-- D. Applicants: If an applicant has an authenticated session, they can only view their own record
CREATE POLICY "Applicants can view only their own assigned verification"
    ON public.verifications
    FOR SELECT
    TO authenticated
    USING (
        applicant_id = auth.uid()
    );

-- ------------------------------------------------------------------------------
-- 10. Least-Privilege Policies: Audit Records
-- ------------------------------------------------------------------------------
CREATE POLICY "Service role full access on audit records"
    ON public.audit_records
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Tenant members can view audit records for their organization"
    ON public.audit_records
    FOR SELECT
    TO authenticated
    USING (
        public.is_org_member(organization_id)
        OR public.is_superadmin()
    );

CREATE POLICY "Tenant admins and reviewers can create audit records"
    ON public.audit_records
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_org_member(organization_id)
        AND (reviewer_id = auth.uid() OR reviewer_id IS NULL)
    );

-- ------------------------------------------------------------------------------
-- 11. Revoke Direct Public Execution Grants & Enforce Role Grants
-- ------------------------------------------------------------------------------
-- Revoke all permissions from the anon role on sensitive tables
REVOKE ALL ON TABLE public.verifications FROM anon;
REVOKE ALL ON TABLE public.organizations FROM anon;
REVOKE ALL ON TABLE public.organization_members FROM anon;
REVOKE ALL ON TABLE public.audit_records FROM anon;

-- Grant selective privileges to authenticated users and service_role
GRANT SELECT, UPDATE ON TABLE public.verifications TO authenticated;
GRANT SELECT ON TABLE public.organizations TO authenticated;
GRANT SELECT ON TABLE public.organization_members TO authenticated;
GRANT SELECT, INSERT ON TABLE public.audit_records TO authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- ------------------------------------------------------------------------------
-- 12. Secure Indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_verifications_session_id ON public.verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_verifications_tenant_id ON public.verifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_verifications_applicant_id ON public.verifications(applicant_id);
CREATE INDEX IF NOT EXISTS idx_verifications_id_number ON public.verifications(id_number);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON public.verifications(overall_status);
