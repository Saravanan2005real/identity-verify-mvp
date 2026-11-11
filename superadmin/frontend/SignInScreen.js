import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Modal,
  Platform,
  Alert,
} from 'react-native';
import { supabase } from './lib/supabase';
import {
  signIn,
  signUp,
  resetPasswordForEmail,
  verifyPasswordResetOtp,
  updatePassword,
} from './src/services/auth';
import {
  validateEmailDomainPolicy,
  getAllowedSuperadminDomains,
} from './src/services/accessControl';

const { width } = Dimensions.get('window');

// Verifyyy Light Theme Palette
const COLORS = {
  primary: '#0f766e', // teal-700
  primaryHover: '#0d5f58',
  primaryLight: 'rgba(15, 118, 110, 0.1)',
  background: '#f8fafc', // slate-50
  card: '#ffffff',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1', // slate-300
  inputBorderFocus: '#0f766e',
  textMain: '#0f172a', // slate-900
  textMuted: '#64748b', // slate-500
  border: 'rgba(203, 213, 225, 0.7)',
  danger: '#ef4444',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  success: '#10b981',
  successBg: '#ecfdf5',
};

const FONT_FAMILY = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export default function SignInScreen({
  portalName = 'Verifyyy Superadmin',
  portalRole = 'superadmin',
  defaultEmail = '',
  onLoginSuccess,
}) {
  const isWeb = width > 768;

  // --- Auth Mode: 'signin' | 'signup' ---
  const [authMode, setAuthMode] = useState('signin');

  // --- Form States ---
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // --- Verification Link Sent States ---
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [signupSuccessEmail, setSignupSuccessEmail] = useState('');

  // --- Status & Feedback States ---
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  // --- Forgot Password Flow States ---
  // Steps: 'request' | 'enter_code' | 'set_password' | 'success'
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotStep, setForgotStep] = useState('request');
  const [fpEmail, setFpEmail] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpNewPassword, setFpNewPassword] = useState('');
  const [fpConfirmPassword, setFpConfirmPassword] = useState('');
  const [fpShowPassword, setFpShowPassword] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);
  const [fpError, setFpError] = useState('');

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = localStorage.getItem('verifyyy_superadmin_email');
        if (saved && !email) setEmail(saved);
      }
    } catch (e) {}

    // Check if URL hash indicates a password recovery session
    if (typeof window !== 'undefined' && window.location && window.location.hash) {
      if (window.location.hash.includes('type=recovery')) {
        setForgotStep('set_password');
        setForgotModalVisible(true);
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setForgotStep('set_password');
        setForgotModalVisible(true);
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // --- 1. Sign In (with Supabase Email & Password) ---
  const handlePasswordSignIn = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('Please enter a valid administrative email.');
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      const data = await signIn(cleanEmail, password);
      const user = data?.user;

      if (user) {
        if (rememberMe) {
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem('verifyyy_superadmin_email', cleanEmail);
            }
          } catch (e) {}
        }
        triggerToast('Signed in successfully!');
        if (onLoginSuccess) onLoginSuccess(user);
      }
    } catch (err) {
      const raw = (err.message || '').toLowerCase();
      if (raw.includes('invalid login credentials')) {
        setErrorMessage("Account doesn't exist or incorrect credentials. If you haven't created an account yet, please create a new account.");
      } else if (raw.includes('email not confirmed')) {
        setErrorMessage('Email address has not been confirmed yet. Please check your inbox and click the verification link sent by Supabase.');
      } else {
        setErrorMessage(err.message || 'Authentication failed. Please check credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  // --- 2. Create Account (Sign Up with Email & Password stored in Supabase) ---
  const handleSignUp = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('Please enter a valid administrative email address.');
      return;
    }

    // Corporate domain policy check (e.g. @zudoc.com when configured)
    const domainPolicy = validateEmailDomainPolicy(cleanEmail);
    if (!domainPolicy.allowed) {
      setErrorMessage(domainPolicy.reason);
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your confirmation password.');
      return;
    }

    setLoading(true);

    try {
      const data = await signUp(cleanEmail, password);

      // If Supabase immediately returns an active session
      if (data?.session) {
        triggerToast('Superadmin account created successfully!');
        if (rememberMe) {
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem('verifyyy_superadmin_email', cleanEmail);
            }
          } catch (e) {}
        }
        if (onLoginSuccess) onLoginSuccess(data.user);
      } else {
        // Supabase sent an email confirmation link
        setSignupSuccessEmail(cleanEmail);
        setSignupSuccess(true);
        triggerToast('Verification link sent to your email!');
      }
    } catch (err) {
      console.warn('Sign up error:', err);
      const msg = (err?.message || '').toLowerCase();
      if (!msg || msg === '{}' || err?.status === 500) {
        setErrorMessage('Failed to send confirmation email (Supabase SMTP Error). Please verify SMTP settings in Supabase.');
      } else if (msg.includes('already registered') || msg.includes('user already exists')) {
        setErrorMessage('An account with this email already exists. Please sign in with your password.');
      } else {
        setErrorMessage(err.message || 'Failed to create Superadmin account.');
      }
    } finally {
      setLoading(false);
    }
  };

  // --- Password Reset Step 1: Send Reset Code / Link ---
  const handleSendResetCode = async () => {
    setFpError('');
    const cleanEmail = fpEmail.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setFpError('Please enter a valid administrative email.');
      return;
    }

    setFpLoading(true);
    try {
      await resetPasswordForEmail(cleanEmail);
      setForgotStep('enter_code');
      triggerToast('Password reset code / link sent to your email!');
    } catch (err) {
      console.warn('Password reset request error:', err);
      const msg = err?.message || '';
      if (!msg || msg === '{}' || err?.status === 500) {
        setFpError('Supabase email delivery failed (SMTP Error). Please check your SMTP credentials in Supabase Dashboard, or toggle Custom SMTP off.');
      } else {
        setFpError(msg);
      }
    } finally {
      setFpLoading(false);
    }
  };

  // --- Password Reset Step 2: Verify OTP Code & Set New Password ---
  const handleVerifyCodeAndReset = async () => {
    setFpError('');
    const cleanCode = fpCode.trim();

    if (!cleanCode) {
      setFpError('Please enter the OTP code received in your email.');
      return;
    }

    if (!fpNewPassword || fpNewPassword.length < 6) {
      setFpError('New password must be at least 6 characters.');
      return;
    }

    if (fpNewPassword !== fpConfirmPassword) {
      setFpError('Passwords do not match. Please re-enter.');
      return;
    }

    setFpLoading(true);
    try {
      // 1. Verify recovery code with Supabase
      await verifyPasswordResetOtp(fpEmail, cleanCode);
      // 2. Update password for authenticated recovery session in Supabase
      await updatePassword(fpNewPassword);

      setForgotStep('success');
      triggerToast('Password updated successfully in Supabase!');
    } catch (err) {
      console.warn('Verify code error:', err);
      const msg = (err?.message || '').toLowerCase();
      if (!msg || msg === '{}' || err?.status === 500) {
        setFpError('Failed to verify OTP code. Please check that the code is correct or request a new one.');
      } else if (msg.includes('invalid') || msg.includes('expired') || msg.includes('token')) {
        setFpError('Invalid or expired reset code. Please request a new code or click the email link.');
      } else {
        setFpError(err.message || 'Failed to update password.');
      }
    } finally {
      setFpLoading(false);
    }
  };

  // --- Password Reset Step 2b: Set New Password from Recovery Link Click ---
  const handleSetPasswordFromLink = async () => {
    setFpError('');

    if (!fpNewPassword || fpNewPassword.length < 6) {
      setFpError('New password must be at least 6 characters.');
      return;
    }

    if (fpNewPassword !== fpConfirmPassword) {
      setFpError('Passwords do not match. Please re-enter.');
      return;
    }

    setFpLoading(true);
    try {
      await updatePassword(fpNewPassword);
      setForgotStep('success');
      triggerToast('Password updated successfully in Supabase!');
    } catch (err) {
      console.warn('Set password link error:', err);
      const msg = err?.message || '';
      if (!msg || msg === '{}' || err?.status === 500) {
        setFpError('Failed to update password. Your reset session may have expired. Please request a new link.');
      } else {
        setFpError(msg);
      }
    } finally {
      setFpLoading(false);
    }
  };

  const allowedDomains = getAllowedSuperadminDomains();
  const domainHint = allowedDomains.length > 0 ? `@${allowedDomains.join(' or @')}` : null;
  const emailPlaceholder = allowedDomains.length > 0 ? `admin@${allowedDomains[0]}` : 'yourname@gmail.com';

  return (
    <View style={styles.screenContainer}>
      {/* Toast Notification */}
      {toastMessage ? (
        <View style={styles.toastBanner}>
          <Text style={styles.toastText}>✓ {toastMessage}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollWrapper}>
        <View style={[styles.authCard, { maxWidth: isWeb ? 460 : '100%' }]}>
          {/* Header Brand */}
          <View style={styles.brandHeader}>
            <View style={styles.logoRow}>
              <Text style={styles.brandName}>Verifyyy</Text>
              <View style={styles.portalBadge}>
                <Text style={styles.portalBadgeText}>{portalRole.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.portalTitle}>{portalName}</Text>
          </View>

          {/* Verification Link Sent State */}
          {signupSuccess ? (
            <View style={styles.verificationNoticeCard}>
              <View style={styles.verificationIconCircle}>
                <Text style={styles.verificationIconText}>✉️</Text>
              </View>
              <Text style={styles.verificationNoticeTitle}>Verify Your Email</Text>
              <Text style={styles.verificationNoticeText}>
                We've sent a verification link to{' '}
                <Text style={{ fontWeight: '700', color: COLORS.primary }}>{signupSuccessEmail}</Text>.
              </Text>
              <Text style={styles.verificationNoticeSubtext}>
                Your password has been securely stored in Supabase. Please open your inbox and click the verification link to activate your Superadmin account.
              </Text>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={() => {
                  setSignupSuccess(false);
                  setAuthMode('signin');
                  setErrorMessage('');
                }}
              >
                <Text style={styles.primaryButtonText}>Proceed to Sign In</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryLinkBtn}
                onPress={async () => {
                  try {
                    await supabase.auth.resend({
                      type: 'signup',
                      email: signupSuccessEmail,
                    });
                    triggerToast('Verification link resent!');
                  } catch (e) {
                    triggerToast('Please wait a moment before requesting another link.');
                  }
                }}
              >
                <Text style={styles.secondaryLinkText}>Resend verification email</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Security Gate Notice */}
              <View style={styles.securityBanner}>
                <Text style={styles.securityBannerIcon}>🔒</Text>
                <View style={styles.securityBannerContent}>
                  <Text style={styles.securityBannerTitle}>Restricted Portal</Text>
                  <Text style={styles.securityBannerText}>
                    {domainHint
                      ? `Access restricted to verified ${domainHint} accounts with Supabase password auth.`
                      : 'Authenticated Superadmin access backed by Supabase authentication.'}
                  </Text>
                </View>
              </View>

              {/* Auth Mode Tabs (Sign In | Create Account | Redeem Key) */}
              <View style={styles.tabsContainer}>
                <TouchableOpacity
                  style={[styles.tabButton, authMode === 'signin' && styles.tabButtonActive]}
                  onPress={() => {
                    setAuthMode('signin');
                    setErrorMessage('');
                  }}
                >
                  <Text style={[styles.tabText, authMode === 'signin' && styles.tabTextActive]}>
                    Sign In
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.tabButton, authMode === 'signup' && styles.tabButtonActive]}
                  onPress={() => {
                    setAuthMode('signup');
                    setErrorMessage('');
                  }}
                >
                  <Text style={[styles.tabText, authMode === 'signup' && styles.tabTextActive]}>
                    Create Account
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Error Banner with Quick Action */}
              {errorMessage ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                  {errorMessage.includes("doesn't exist") && authMode === 'signin' && (
                    <TouchableOpacity
                      style={styles.errorActionBtn}
                      onPress={() => {
                        setAuthMode('signup');
                        setErrorMessage('');
                      }}
                    >
                      <Text style={styles.errorActionText}>👉 Create New Account with {email || 'this email'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : null}

              {/* MODE 1: Sign In */}
              {authMode === 'signin' && (
                <View style={styles.formSection}>
                  {/* Email */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Email Address</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder={emailPlaceholder}
                      placeholderTextColor={COLORS.textMuted}
                      value={email}
                      onChangeText={(val) => {
                        setEmail(val);
                        setErrorMessage('');
                      }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoCorrect={false}
                    />
                  </View>

                  {/* Password */}
                  <View style={styles.inputGroup}>
                    <View style={styles.labelRow}>
                      <Text style={styles.inputLabel}>Password</Text>
                      <TouchableOpacity
                        onPress={() => {
                          setFpEmail(email);
                          setForgotStep('request');
                          setFpError('');
                          setFpCode('');
                          setFpNewPassword('');
                          setFpConfirmPassword('');
                          setForgotModalVisible(true);
                        }}
                      >
                        <Text style={styles.forgotLink}>Forgot?</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={[styles.textInput, { paddingRight: 64 }]}
                        placeholder="Enter your password"
                        placeholderTextColor={COLORS.textMuted}
                        value={password}
                        onChangeText={(val) => {
                          setPassword(val);
                          setErrorMessage('');
                        }}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.eyeToggleBtn}
                        onPress={() => setShowPassword(!showPassword)}
                      >
                        <Text style={styles.eyeToggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Keep signed in */}
                  <View style={styles.rememberRow}>
                    <TouchableOpacity
                      style={styles.checkboxContainer}
                      onPress={() => setRememberMe(!rememberMe)}
                    >
                      <View style={[styles.checkboxBox, rememberMe && styles.checkboxChecked]}>
                        {rememberMe && <Text style={styles.checkMark}>✓</Text>}
                      </View>
                      <Text style={styles.rememberText}>Keep me signed in</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Submit Button */}
                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handlePasswordSignIn}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Sign In as Superadmin</Text>
                    )}
                  </TouchableOpacity>

                  {/* Switch to Create Account */}
                  <TouchableOpacity
                    style={styles.switchModeRow}
                    onPress={() => {
                      setAuthMode('signup');
                      setErrorMessage('');
                    }}
                  >
                    <Text style={styles.switchModeText}>
                      Don't have an account yet? <Text style={{ fontWeight: '700' }}>Create an Account →</Text>
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* MODE 2: Create Account (Sign Up with Password) */}
              {authMode === 'signup' && (
                <View style={styles.formSection}>
                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxText}>
                      Create your Superadmin account. Your password will be securely encrypted and saved in Supabase.
                    </Text>
                  </View>

                  {/* Email */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Email Address</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder={emailPlaceholder}
                      placeholderTextColor={COLORS.textMuted}
                      value={email}
                      onChangeText={(val) => {
                        setEmail(val);
                        setErrorMessage('');
                      }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoCorrect={false}
                    />
                  </View>

                  {/* Create Password */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Create Password (min 6 characters)</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={[styles.textInput, { paddingRight: 64 }]}
                        placeholder="Create a strong password"
                        placeholderTextColor={COLORS.textMuted}
                        value={password}
                        onChangeText={(val) => {
                          setPassword(val);
                          setErrorMessage('');
                        }}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.eyeToggleBtn}
                        onPress={() => setShowPassword(!showPassword)}
                      >
                        <Text style={styles.eyeToggleText}>{showPassword ? 'Hide' : 'Show'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Confirm Password */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Confirm Password</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={[styles.textInput, { paddingRight: 64 }]}
                        placeholder="Re-enter password"
                        placeholderTextColor={COLORS.textMuted}
                        value={confirmPassword}
                        onChangeText={(val) => {
                          setConfirmPassword(val);
                          setErrorMessage('');
                        }}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.eyeToggleBtn}
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      >
                        <Text style={styles.eyeToggleText}>{showConfirmPassword ? 'Hide' : 'Show'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Submit Button */}
                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleSignUp}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Create Superadmin Account</Text>
                    )}
                  </TouchableOpacity>

                  {/* Switch to Sign In */}
                  <TouchableOpacity
                    style={styles.switchModeRow}
                    onPress={() => {
                      setAuthMode('signin');
                      setErrorMessage('');
                    }}
                  >
                    <Text style={styles.switchModeText}>
                      Already have an account? <Text style={{ fontWeight: '700' }}>Sign In with Password →</Text>
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Comprehensive Forgot Password Pipeline Modal */}
      <Modal visible={forgotModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {/* Step 1: Request Reset Code / Link */}
            {forgotStep === 'request' && (
              <>
                <Text style={styles.modalTitle}>Reset Password</Text>
                <Text style={styles.modalSubtitle}>
                  Enter your email address to receive a recovery code and verification link.
                </Text>

                {fpError ? (
                  <View style={styles.modalErrorBox}>
                    <Text style={styles.modalErrorText}>{fpError}</Text>
                  </View>
                ) : null}

                <TextInput
                  style={[styles.textInput, { marginBottom: 16 }]}
                  placeholder={emailPlaceholder}
                  placeholderTextColor={COLORS.textMuted}
                  value={fpEmail}
                  onChangeText={(val) => {
                    setFpEmail(val);
                    setFpError('');
                  }}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />

                <TouchableOpacity
                  style={[styles.primaryButton, fpLoading && styles.buttonDisabled]}
                  onPress={handleSendResetCode}
                  disabled={fpLoading}
                >
                  {fpLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send Reset Code / Link</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => {
                    setForgotModalVisible(false);
                    setFpError('');
                  }}
                >
                  <Text style={styles.modalCloseBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Step 2: Enter Code & New Password */}
            {forgotStep === 'enter_code' && (
              <>
                <Text style={styles.modalTitle}>Set New Password</Text>
                <Text style={styles.modalSubtitle}>
                  We've sent a recovery code / link to{' '}
                  <Text style={{ fontWeight: '700', color: COLORS.primary }}>{fpEmail}</Text>.
                  Enter the code from your email and set your new password below.
                </Text>

                {fpError ? (
                  <View style={styles.modalErrorBox}>
                    <Text style={styles.modalErrorText}>{fpError}</Text>
                  </View>
                ) : null}

                {/* OTP Code */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Recovery Code / OTP (from email)</Text>
                  <TextInput
                    style={[styles.textInput, styles.monospaceInput]}
                    placeholder="Enter 6-digit code or token"
                    placeholderTextColor={COLORS.textMuted}
                    value={fpCode}
                    onChangeText={(val) => {
                      setFpCode(val.trim());
                      setFpError('');
                    }}
                    autoCapitalize="none"
                  />
                </View>

                {/* New Password */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>New Password (min 6 characters)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter new password"
                    placeholderTextColor={COLORS.textMuted}
                    value={fpNewPassword}
                    onChangeText={(val) => {
                      setFpNewPassword(val);
                      setFpError('');
                    }}
                    secureTextEntry={!fpShowPassword}
                    autoCapitalize="none"
                  />
                </View>

                {/* Confirm New Password */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Confirm New Password</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Re-enter new password"
                    placeholderTextColor={COLORS.textMuted}
                    value={fpConfirmPassword}
                    onChangeText={(val) => {
                      setFpConfirmPassword(val);
                      setFpError('');
                    }}
                    secureTextEntry={!fpShowPassword}
                    autoCapitalize="none"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, fpLoading && styles.buttonDisabled]}
                  onPress={handleVerifyCodeAndReset}
                  disabled={fpLoading}
                >
                  {fpLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Update Password &amp; Continue</Text>
                  )}
                </TouchableOpacity>

                <View style={{ marginTop: 12, alignItems: 'center' }}>
                  <Text style={{ fontSize: 11, color: COLORS.textMuted, textAlign: 'center', lineHeight: 15 }}>
                    💡 Received a link instead? You can also click the link directly in your email to open the password reset screen.
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.modalCloseBtn, { marginTop: 8 }]}
                  onPress={() => setForgotStep('request')}
                >
                  <Text style={styles.modalCloseBtnText}>← Back to change email</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Step 2b: Direct Password Reset from Email Link Click */}
            {forgotStep === 'set_password' && (
              <>
                <Text style={styles.modalTitle}>Set New Password</Text>
                <Text style={styles.modalSubtitle}>
                  Recovery link verified! Please choose your new Superadmin password below.
                </Text>

                {fpError ? (
                  <View style={styles.modalErrorBox}>
                    <Text style={styles.modalErrorText}>{fpError}</Text>
                  </View>
                ) : null}

                {/* New Password */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>New Password (min 6 characters)</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Enter new password"
                    placeholderTextColor={COLORS.textMuted}
                    value={fpNewPassword}
                    onChangeText={(val) => {
                      setFpNewPassword(val);
                      setFpError('');
                    }}
                    secureTextEntry={!fpShowPassword}
                    autoCapitalize="none"
                  />
                </View>

                {/* Confirm New Password */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Confirm New Password</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Re-enter new password"
                    placeholderTextColor={COLORS.textMuted}
                    value={fpConfirmPassword}
                    onChangeText={(val) => {
                      setFpConfirmPassword(val);
                      setFpError('');
                    }}
                    secureTextEntry={!fpShowPassword}
                    autoCapitalize="none"
                  />
                </View>

                <TouchableOpacity
                  style={[styles.primaryButton, fpLoading && styles.buttonDisabled]}
                  onPress={handleSetPasswordFromLink}
                  disabled={fpLoading}
                >
                  {fpLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save New Password &amp; Sign In</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => setForgotModalVisible(false)}
                >
                  <Text style={styles.modalCloseBtnText}>Close</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Step 3: Success Confirmation */}
            {forgotStep === 'success' && (
              <View style={styles.fpSuccessBox}>
                <View style={styles.verificationIconCircle}>
                  <Text style={styles.verificationIconText}>✓</Text>
                </View>
                <Text style={styles.fpSuccessTitle}>Password Updated!</Text>
                <Text style={styles.fpSuccessMsg}>
                  Your new password has been securely updated in Supabase. You can now sign in using your updated password.
                </Text>

                <TouchableOpacity
                  style={[styles.primaryButton, { width: '100%', marginTop: 16 }]}
                  onPress={() => {
                    setForgotModalVisible(false);
                    setForgotStep('request');
                    setAuthMode('signin');
                    if (fpEmail) setEmail(fpEmail);
                    setPassword('');
                    setConfirmPassword('');
                  }}
                >
                  <Text style={styles.primaryButtonText}>Sign In with New Password</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollWrapper: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  authCard: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 28,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  brandName: {
    fontFamily: FONT_FAMILY,
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: -0.5,
  },
  portalBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(15, 118, 110, 0.2)',
  },
  portalBadgeText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  portalTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  securityBanner: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
    alignItems: 'center',
    gap: 10,
  },
  securityBannerIcon: {
    fontSize: 16,
  },
  securityBannerContent: {
    flex: 1,
  },
  securityBannerTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 1,
  },
  securityBannerText: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.textMuted,
    lineHeight: 15,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 4,
    marginBottom: 18,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tabTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  errorBox: {
    backgroundColor: COLORS.dangerBg,
    borderColor: COLORS.dangerBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  errorText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.danger,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  errorActionBtn: {
    marginTop: 8,
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
  },
  errorActionText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  infoBox: {
    backgroundColor: '#f0fdfa',
    borderColor: '#ccfbf1',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  infoBoxText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: '#0f766e',
    lineHeight: 16,
  },
  verificationNoticeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 24,
    alignItems: 'center',
  },
  verificationIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(15, 118, 110, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  verificationIconText: {
    fontSize: 28,
  },
  verificationNoticeTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 8,
  },
  verificationNoticeText: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    color: COLORS.textMain,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 20,
  },
  verificationNoticeSubtext: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  secondaryLinkBtn: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryLinkText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
  formSection: {
    width: '100%',
  },
  redeemNoticeBox: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  redeemNoticeTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 2,
  },
  redeemNoticeText: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: '#15803d',
    lineHeight: 16,
  },
  inputGroup: {
    marginBottom: 14,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  inputLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMain,
    marginBottom: 6,
  },
  forgotLink: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  textInput: {
    fontFamily: FONT_FAMILY,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.textMain,
  },
  monospaceInput: {
    fontFamily: Platform.select({
      web: 'monospace, "Courier New", Courier',
      default: undefined,
    }),
    fontWeight: '700',
    letterSpacing: 1,
  },
  passwordInputWrapper: {
    position: 'relative',
    justifyContent: 'center',
  },
  eyeToggleBtn: {
    position: 'absolute',
    right: 12,
    padding: 6,
  },
  eyeToggleText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  rememberText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMain,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  switchModeRow: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchModeRowSecondary: {
    marginTop: 10,
    alignItems: 'center',
  },
  switchModeText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.primary,
  },
  toastBanner: {
    position: 'absolute',
    top: 20,
    left: '50%',
    transform: [{ translateX: -160 }],
    width: 320,
    backgroundColor: '#10b981',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 5,
  },
  toastText: {
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 28,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  modalTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 4,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  modalErrorBox: {
    backgroundColor: COLORS.dangerBg,
    borderColor: COLORS.dangerBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  modalErrorText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.danger,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  modalCloseBtn: {
    marginTop: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  fpSuccessBox: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  fpSuccessTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 6,
  },
  fpSuccessMsg: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
