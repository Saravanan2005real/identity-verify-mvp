-- Supabase Schema for Local eKYC Verification MVP
-- Execute this SQL in your Supabase SQL Editor (https://app.supabase.com -> SQL Editor)

CREATE TABLE IF NOT EXISTS public.verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(255) UNIQUE NOT NULL,
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
    overall_status VARCHAR(50) DEFAULT 'PENDING',
    extracted_face_url TEXT,
    live_holder_face_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

-- Allow public read access (or restrict to service_role / authenticated users as needed)
CREATE POLICY "Allow public read access" ON public.verifications 
    FOR SELECT USING (true);

-- Allow anon & service_role insert/update access for local verification sync
CREATE POLICY "Allow public insert access" ON public.verifications 
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update access" ON public.verifications 
    FOR UPDATE USING (true);

-- Create index on session_id and id_number for fast lookups
CREATE INDEX IF NOT EXISTS idx_verifications_session_id ON public.verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_verifications_id_number ON public.verifications(id_number);
