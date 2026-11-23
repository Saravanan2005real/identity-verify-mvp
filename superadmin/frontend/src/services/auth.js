import { supabase } from '../../lib/supabase';

/**
 * Send passwordless verification link (magic link) to the specified @zudoc.co email.
 * Includes emailRedirectTo pointing to the superadmin portal origin so clicking the link
 * in email automatically returns to and authenticates the superadmin session.
 * 
 * @param {string} email
 */
export async function sendVerificationLink(email) {
  const cleanEmail = email.trim().toLowerCase();
  
  const redirectTo =
    typeof window !== 'undefined' && window.location && window.location.origin
      ? window.location.origin
      : (process.env.EXPO_PUBLIC_SUPERADMIN_PORTAL_URL || 'http://localhost:8081');

  const { data, error } = await supabase.auth.signInWithOtp({
    email: cleanEmail,
    options: {
      emailRedirectTo: redirectTo,
      shouldCreateUser: true,
    },
  });

  if (error) throw error;

  return data;
}

/**
 * Request passwordless one-time password (OTP) / verification link via email
 * @param {string} email
 */
export async function signInWithOtp(email) {
  return sendVerificationLink(email);
}

/**
 * Verify received 6-digit email OTP
 * @param {string} email
 * @param {string} token
 */
export async function verifyOtp(email, token) {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();

  // Try email OTP first
  const { data, error } = await supabase.auth.verifyOtp({
    email: cleanEmail,
    token: cleanToken,
    type: 'email',
  });

  if (error) {
    // If 'email' type fails, try 'magiclink' OTP type if supported
    try {
      const fallback = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: 'magiclink',
      });
      if (!fallback.error) return fallback.data;
    } catch (_) {}
    throw error;
  }

  return data;
}

/**
 * Sign in an existing user with email and password (fallback)
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) throw error;

  return data;
}

/**
 * Sign up a new user with email and password
 * @param {string} email
 * @param {string} password
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) throw error;

  return data;
}

/**
 * Sign out the current user session
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) throw error;
}

/**
 * Send password reset email with optional redirect URL
 * @param {string} email
 */
export async function resetPasswordForEmail(email) {
  const redirectTo =
    typeof window !== 'undefined' && window.location
      ? window.location.origin
      : undefined;

  const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  });

  if (error) throw error;

  return data;
}

/**
 * Verify received recovery OTP code
 * @param {string} email
 * @param {string} token
 */
export async function verifyPasswordResetOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'recovery',
  });

  if (error) throw error;

  return data;
}

/**
 * Update the user's password in Supabase
 * @param {string} newPassword
 */
export async function updatePassword(newPassword) {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword,
  });

  if (error) throw error;

  return data;
}
