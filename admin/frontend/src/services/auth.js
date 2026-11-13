import { supabase } from '../../lib/supabase';

/**
 * Sign up a new user with email and password
 * @param {string} email
 * @param {string} password
 * @param {object} options
 */
export async function signUp(email, password, options = {}) {
  const redirectUrl =
    options.emailRedirectTo ||
    (typeof window !== 'undefined' && window.location
      ? window.location.origin
      : (process.env.EXPO_PUBLIC_ADMIN_PORTAL_URL || 'http://localhost:8082'));

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: redirectUrl,
      ...options,
    },
  });

  if (error) throw error;

  return data;
}

/**
 * Resend verification email for an unconfirmed signup
 * @param {string} email
 * @param {object} options
 */
export async function resendVerificationEmail(email, options = {}) {
  const redirectUrl =
    options.emailRedirectTo ||
    (typeof window !== 'undefined' && window.location
      ? window.location.origin
      : (process.env.EXPO_PUBLIC_ADMIN_PORTAL_URL || 'http://localhost:8082'));

  const { data, error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: {
      emailRedirectTo: redirectUrl,
      ...options,
    },
  });

  if (error) throw error;

  return data;
}

/**
 * Sign in an existing user with email and password
 * @param {string} email
 * @param {string} password
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
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
 * Request passwordless one-time password (OTP) via email
 * @param {string} email
 */
export async function signInWithOtp(email) {
  const { data, error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) throw error;

  return data;
}

/**
 * Verify received 6-digit email OTP
 * @param {string} email
 * @param {string} token
 */
export async function verifyOtp(email, token) {
  const cleanEmail = email.trim();
  const cleanToken = token.trim();

  let res = await supabase.auth.verifyOtp({
    email: cleanEmail,
    token: cleanToken,
    type: 'email',
  });

  // If type: 'email' fails with token/type mismatch, fallback to 'signup'
  if (res.error && (res.error.message?.toLowerCase().includes('type') || res.error.message?.toLowerCase().includes('invalid'))) {
    const fallback = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'signup',
    });
    if (!fallback.error) {
      return fallback.data;
    }
  }

  if (res.error) throw res.error;

  return res.data;
}

/**
 * Send password reset email
 * @param {string} email
 */
export async function resetPasswordForEmail(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email.trim());

  if (error) throw error;

  return data;
}
