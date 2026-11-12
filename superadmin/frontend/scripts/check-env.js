#!/usr/bin/env node
/**
 * check-env.js — Pre-build Environment Validation for Superadmin Platform
 * Fails the build immediately if required EXPO_PUBLIC_* variables are missing or empty.
 */
const fs = require('fs');
const path = require('path');

// Optionally read .env if present in the frontend directory or root directory
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  try {
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch (_) {}
}

loadEnvFile(path.resolve(__dirname, '..', '.env'));
loadEnvFile(path.resolve(__dirname, '..', '..', '..', '.env'));

const requiredVars = [
  {
    name: 'EXPO_PUBLIC_SUPABASE_URL',
    check: () => Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()),
    description: 'Supabase project REST endpoint',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or EXPO_PUBLIC_SUPABASE_ANON_KEY)',
    check: () => Boolean(
      (process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY)?.trim()
    ),
    description: 'Supabase client publishable / anon key',
  },
  {
    name: 'EXPO_PUBLIC_SUPERADMIN_API_URL',
    check: () => Boolean(process.env.EXPO_PUBLIC_SUPERADMIN_API_URL?.trim()),
    description: 'Superadmin Backend API URL',
  },
];

const missing = [];
for (const v of requiredVars) {
  if (!v.check()) {
    missing.push(`  - ${v.name}: ${v.description}`);
  }
}

if (missing.length > 0) {
  console.error('\n============================================================');
  console.error('[ERROR] Frontend Build Pre-check Failed: Missing Environment Variables');
  console.error('============================================================');
  console.error('The following required environment variables are missing or empty:\n');
  console.error(missing.join('\n'));
  console.error('\nPlease define them in your environment or .env file before building.\n');
  process.exit(1);
}

console.log('[check-env] Environment validation passed for Superadmin Platform.');
process.exit(0);

