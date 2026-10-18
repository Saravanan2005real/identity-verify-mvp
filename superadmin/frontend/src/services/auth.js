import { supabase } from '../../lib/supabase';

/**
 * Sign up a new user with email and password
 * @param {string} email
 * @param {string} password
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
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
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });

  if (error) throw error;

  return data;
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
