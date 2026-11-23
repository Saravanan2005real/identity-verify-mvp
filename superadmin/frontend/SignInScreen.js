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
  Platform,
} from 'react-native';
import { supabase } from './lib/supabase';
import {
  signIn,
  sendVerificationLink,
  updatePassword,
} from './src/services/auth';
import {
  validateEmailDomainPolicy,
  getAllowedSuperadminDomains,
} from './src/services/accessControl';

const { width } = Dimensions.get('window');

// Zudoc Brand Theme Palette - Exactly matching admin portal and zudoc.co
const COLORS = {
  primary: '#008080', // Zudoc Official Teal
  primaryHover: '#006565',
  primaryLight: 'rgba(0, 128, 128, 0.08)',
  background: '#F7F9FB', // Zudoc Clean Slate White
  card: '#ffffff',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  inputBorderFocus: '#008080',
  textMain: '#0f172a',
  textMuted: '#64748b',
  border: 'rgba(203, 213, 225, 0.7)',
  danger: '#ef4444',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  success: '#10b981',
  successBg: '#ecfdf5',
};

const FONT_FAMILY = Platform.select({
  web: '"Manrope", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

const SUPERADMIN_API_URL = (
  process.env.EXPO_PUBLIC_SUPERADMIN_API_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

export default function SignInScreen({
  portalName = 'Superadmin Control Center',
  portalRole = 'superadmin',
  defaultEmail = '',
  onLoginSuccess,
}) {
  const isWeb = width > 768;

  // --- Modes: 'login' | 'register' | 'forgot' ---
  const [authMode, setAuthMode] = useState('login');

  // --- Form States ---
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // --- Registration Step 2: Create Password ---
  // Steps: 'email_verify' | 'create_password'
  const [registerStep, setRegisterStep] = useState('email_verify');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // --- Verification Link States (for Register & Forgot Password) ---
  const [linkSent, setLinkSent] = useState(false);
  const [linkSentEmail, setLinkSentEmail] = useState('');
  const [directLink, setDirectLink] = useState('');
  const [resendCountdown, setResendCountdown] = useState(45);
  const [canResend, setCanResend] = useState(false);

  // --- Feedback States ---
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');

  const allowedDomains = getAllowedSuperadminDomains();
  const domainLabel = allowedDomains.length > 0 ? `@${allowedDomains.join(' or @')}` : '@zudoc.co';

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = localStorage.getItem('verifyyy_superadmin_email');
        if (saved && !email) setEmail(saved);
      }
    } catch (e) {}

    // Listen for incoming authentication session from verification link click
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const userEmail = (session.user.email || '').toLowerCase();
        const policy = validateEmailDomainPolicy(userEmail);
        if (policy.allowed) {
          // If in the registration flow, advance to Step 2 (Create Password)
          if (authMode === 'register' && registerStep === 'email_verify') {
            triggerToast('Email verified! Please create your password.');
            setRegisterStep('create_password');
            setLinkSent(false);
          } else {
            triggerToast('Authentication confirmed! Entering portal...');
            if (onLoginSuccess) onLoginSuccess(session.user);
          }
        } else {
          setErrorMessage(`Access restricted: ${userEmail} is not an authorized ${domainLabel} account.`);
          supabase.auth.signOut();
        }
      }
    });

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, [authMode, registerStep]);

  // Countdown timer for Resend Link
  useEffect(() => {
    let timer = null;
    if (linkSent && resendCountdown > 0) {
      timer = setInterval(() => {
        setResendCountdown((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [linkSent, resendCountdown]);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // Helper to check account existence via backend with robust fallback
  const checkAccountExists = async (targetEmail) => {
    const urls = [
      `${SUPERADMIN_API_URL}/api/v1/superadmin/auth/check-account`,
      'http://127.0.0.1:8000/api/v1/superadmin/auth/check-account',
      'http://localhost:8000/api/v1/superadmin/auth/check-account',
    ];
    for (const url of urls) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: targetEmail }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && typeof data.exists === 'boolean') return data;
        }
      } catch (_) {}
    }
    return null;
  };

  // Helper to generate verification link via backend with robust fallback
  const fetchDirectLink = async (targetEmail, linkType = 'magiclink') => {
    const urls = [
      `${SUPERADMIN_API_URL}/api/v1/superadmin/auth/generate-magic-link`,
      'http://127.0.0.1:8000/api/v1/superadmin/auth/generate-magic-link',
      'http://localhost:8000/api/v1/superadmin/auth/generate-magic-link',
    ];
    for (const url of urls) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: targetEmail, link_type: linkType }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data?.action_link) return data.action_link;
        }
      } catch (_) {}
    }
    return '';
  };

  // ---------------------------------------------------------------------------
  // 1. LOGIN FLOW
  // ---------------------------------------------------------------------------
  const handleLogin = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    const domainCheck = validateEmailDomainPolicy(cleanEmail);
    if (!domainCheck.allowed) {
      setErrorMessage(
        domainCheck.reason ||
        `Access restricted: Superadmin login is strictly permitted only for ${domainLabel} email addresses.`
      );
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    setLoading(true);

    try {
      // Check if account exists first
      const accountInfo = await checkAccountExists(cleanEmail);
      if (accountInfo && accountInfo.exists === false) {
        setErrorMessage('There is no account existed in this mail. Please register first.');
        setLoading(false);
        return;
      }

      const data = await signIn(cleanEmail, password);
      if (data?.user) {
        if (rememberMe) {
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem('verifyyy_superadmin_email', cleanEmail);
            }
          } catch (e) {}
        }
        triggerToast('Signed in successfully!');
        if (onLoginSuccess) onLoginSuccess(data.user);
      }
    } catch (err) {
      console.warn('Login error:', err);
      const msg = (err?.message || '').toLowerCase();
      if (msg.includes('invalid login credentials') || msg.includes('invalid_grant')) {
        setErrorMessage('Incorrect password or account credentials. If you forgot your password, please use Forgot Password.');
      } else if (msg.includes('email not confirmed')) {
        setErrorMessage('Email address has not been confirmed yet. Please verify your email first.');
      } else {
        setErrorMessage(err.message || 'Authentication failed. Please check credentials.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 2. REGISTER FLOW: Step 1 (Verify Email with Duplicate Avoidance)
  // ---------------------------------------------------------------------------
  const handleRegisterSendVerification = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('Please enter a valid corporate email address.');
      return;
    }

    const domainCheck = validateEmailDomainPolicy(cleanEmail);
    if (!domainCheck.allowed) {
      setErrorMessage(
        domainCheck.reason ||
        `Access restricted: Superadmin registration is strictly permitted only for ${domainLabel} email addresses.`
      );
      return;
    }

    setLoading(true);

    try {
      // DUPLICATE REGISTRATION CHECK: Prevent duplicate accounts
      const accountInfo = await checkAccountExists(cleanEmail);
      if (accountInfo && accountInfo.exists === true) {
        setErrorMessage('An account with this email already exists. Duplicate registration is avoided. Please sign in instead.');
        setLoading(false);
        return;
      }

      // Dispatch verification link
      await sendVerificationLink(cleanEmail).catch((err) => {
        console.warn('SMTP dispatch note (using direct link fallback):', err);
      });

      // Obtain direct link helper
      const actionLink = await fetchDirectLink(cleanEmail, 'signup');
      if (actionLink) setDirectLink(actionLink);

      setLinkSent(true);
      setLinkSentEmail(cleanEmail);
      setResendCountdown(45);
      setCanResend(false);
      triggerToast('Verification link sent! Please verify your email.');
    } catch (err) {
      console.warn('Register link error:', err);
      setErrorMessage(err.message || 'Failed to send verification email.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 2b. REGISTER FLOW: Step 2 (Create Password & Once Again Password)
  // ---------------------------------------------------------------------------
  const handleCreatePasswordSubmit = async () => {
    setErrorMessage('');

    if (!newPassword || newPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your confirmation password.');
      return;
    }

    setLoading(true);

    try {
      // Set the password in Supabase for the authenticated session
      const data = await updatePassword(newPassword);
      triggerToast('Password created successfully! Welcome to Superadmin.');

      const cleanEmail = email.trim().toLowerCase();
      if (rememberMe) {
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem('verifyyy_superadmin_email', cleanEmail);
          }
        } catch (e) {}
      }

      // "then let them in"
      if (onLoginSuccess) {
        onLoginSuccess(data.user);
      }
    } catch (err) {
      console.warn('Create password error:', err);
      setErrorMessage(err.message || 'Failed to set password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // 3. FORGOT PASSWORD FLOW
  // ---------------------------------------------------------------------------
  const handleForgotPassword = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    const domainCheck = validateEmailDomainPolicy(cleanEmail);
    if (!domainCheck.allowed) {
      setErrorMessage(
        domainCheck.reason ||
        `Access restricted: Superadmin access is strictly permitted only for ${domainLabel} email addresses.`
      );
      return;
    }

    setLoading(true);

    try {
      // Check if account exists
      const accountInfo = await checkAccountExists(cleanEmail);
      if (accountInfo && accountInfo.exists === false) {
        setErrorMessage('There is no account existed in this mail.');
        setLoading(false);
        return;
      }

      // Send verification link (using recovery type)
      await sendVerificationLink(cleanEmail).catch((err) => {
        console.warn('SMTP dispatch note (using direct link fallback):', err);
      });

      // Obtain direct link
      const actionLink = await fetchDirectLink(cleanEmail, 'recovery');
      if (actionLink) setDirectLink(actionLink);

      setLinkSent(true);
      setLinkSentEmail(cleanEmail);
      setResendCountdown(45);
      setCanResend(false);
      triggerToast('Verification link sent to your email!');
    } catch (err) {
      console.warn('Forgot password error:', err);
      setErrorMessage(err.message || 'Failed to send verification link.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screenContainer}>
      {/* Toast Banner */}
      {toastMessage ? (
        <View style={styles.toastBanner}>
          <Text style={styles.toastText}>✓ {toastMessage}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollWrapper}>
        <View style={[styles.authCard, { maxWidth: isWeb ? 460 : '100%' }]}>
          {/* Header Brand - Exactly matching Admin Portal */}
          <View style={styles.brandHeader}>
            <View style={[styles.logoRow, { gap: 10, justifyContent: 'center' }]}>
              <svg width="34" height="34" viewBox="0 0 43 42" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M0 9V2C0 0.895431 0.89543 0 2 0H33.4529C38.4418 0 42.4788 4.0581 42.4528 9.04694L42.3224 34.0417C42.2995 38.4437 38.7245 42 34.3225 42H2C0.895431 42 0 41.1046 0 40V31.7938C0 30.6341 0.403121 29.5105 1.14035 28.6153L13.4 13.7286C13.7799 13.2673 14.3462 13 14.9438 13H24.2974C25.5692 13 26.2639 14.4833 25.4498 15.4603L12.5 31H29C30.6569 31 32 29.6569 32 28V14C32 12.3431 30.6569 11 29 11H2C0.895431 11 0 10.1046 0 9Z" fill="#008080"/>
              </svg>
              <Text style={[styles.brandName, { fontFamily: "'Rival Sans', 'Manrope', sans-serif", fontSize: 24, fontWeight: '800', color: '#0f172a', letterSpacing: -0.6 }]}>zudoc</Text>
              <View style={[styles.portalBadge, { backgroundColor: 'rgba(0, 128, 128, 0.08)', borderColor: 'rgba(0, 128, 128, 0.22)' }]}>
                <Text style={[styles.portalBadgeText, { color: '#008080' }]}>SUPERADMIN</Text>
              </View>
            </View>
            <Text style={styles.portalTitle}>{portalName}</Text>
          </View>

          {/* Mode Tabs (Sign In vs Register) - Hidden in Forgot mode or Password creation step */}
          {authMode !== 'forgot' && registerStep !== 'create_password' && !linkSent && (
            <View style={styles.tabsContainer}>
              <TouchableOpacity
                style={[styles.tabButton, authMode === 'login' && styles.tabButtonActive]}
                onPress={() => {
                  setAuthMode('login');
                  setErrorMessage('');
                  setLinkSent(false);
                }}
              >
                <Text style={[styles.tabText, authMode === 'login' && styles.tabTextActive]}>
                  Sign In
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.tabButton, authMode === 'register' && styles.tabButtonActive]}
                onPress={() => {
                  setAuthMode('register');
                  setRegisterStep('email_verify');
                  setErrorMessage('');
                  setLinkSent(false);
                }}
              >
                <Text style={[styles.tabText, authMode === 'register' && styles.tabTextActive]}>
                  Register
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Error Banner with Quick Action */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
              {errorMessage.includes('already exists') && authMode === 'register' && (
                <TouchableOpacity
                  style={{ marginTop: 6 }}
                  onPress={() => {
                    setAuthMode('login');
                    setErrorMessage('');
                  }}
                >
                  <Text style={[styles.errorActionLink, { color: COLORS.primary }]}>👉 Go to Sign In</Text>
                </TouchableOpacity>
              )}
              {errorMessage.includes('no account existed') && (
                <TouchableOpacity
                  style={{ marginTop: 6 }}
                  onPress={() => {
                    setAuthMode('register');
                    setRegisterStep('email_verify');
                    setErrorMessage('');
                  }}
                >
                  <Text style={[styles.errorActionLink, { color: COLORS.primary }]}>👉 Register with {email || 'this email'}</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* =========================================================================
              VIEW 1: SIGN IN (Email + Password + Forgot Link)
             ========================================================================= */}
          {authMode === 'login' && (
            <View style={styles.formSection}>
              {/* Email */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>
                  Email Address <Text style={{ color: COLORS.primary }}>({domainLabel} only)</Text>
                </Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="admin@zudoc.co"
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
                      setAuthMode('forgot');
                      setErrorMessage('');
                      setLinkSent(false);
                      setDirectLink('');
                    }}
                  >
                    <Text style={styles.forgotLink}>Forgot password?</Text>
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

              {/* Keep me signed in */}
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
                onPress={handleLogin}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Sign In as Superadmin</Text>
                )}
              </TouchableOpacity>

              {/* Bottom switch to register */}
              <TouchableOpacity
                style={styles.switchModeRow}
                onPress={() => {
                  setAuthMode('register');
                  setRegisterStep('email_verify');
                  setErrorMessage('');
                }}
              >
                <Text style={styles.switchModeText}>
                  Don't have an account yet? <Text style={{ fontWeight: '700' }}>Register here →</Text>
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* =========================================================================
              VIEW 2: REGISTER (Step 1: Email Verification | Step 2: Create Password)
             ========================================================================= */}
          {authMode === 'register' && (
            <View style={styles.formSection}>
              {/* Step 1: Email Verification Link */}
              {registerStep === 'email_verify' && (
                <>
                  {linkSent ? (
                    <View style={styles.verificationNoticeCard}>
                      <Text style={styles.verificationTitle}>Verification Link Sent</Text>
                      <Text style={styles.verificationText}>
                        We've sent a verification link to{' '}
                        <Text style={{ fontWeight: '700', color: COLORS.primary }}>{linkSentEmail}</Text>.
                      </Text>
                      <Text style={[styles.verificationText, { marginTop: 6, fontSize: 12, color: COLORS.textMuted }]}>
                        Please open your inbox and click the verification link. Once verified, you will be prompted to set your password.
                      </Text>

                      {/* Instant Link Helper */}
                      {directLink ? (
                        <View style={styles.directLinkCard}>
                          <View style={styles.rateLimitNotice}>
                            <Text style={styles.rateLimitTitle}>⚠️ No Email Needed (Rate Limit Active)</Text>
                            <Text style={styles.rateLimitDesc}>
                              Supabase email delivery is rate-limited. Click below to verify your email directly and set your password:
                            </Text>
                          </View>
                          <TouchableOpacity
                            style={styles.openDirectBtn}
                            onPress={() => {
                              if (typeof window !== 'undefined' && window.location) {
                                window.location.href = directLink;
                              }
                            }}
                          >
                            <Text style={styles.openDirectBtnText}>🚀 CLICK HERE TO VERIFY &amp; SET PASSWORD</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}

                      <View style={{ marginTop: 16, alignItems: 'center', gap: 10, width: '100%' }}>
                        <TouchableOpacity
                          style={styles.resendBtn}
                          onPress={canResend ? handleRegisterSendVerification : undefined}
                          disabled={!canResend || loading}
                        >
                          <Text style={[styles.resendBtnText, !canResend && { color: COLORS.textMuted }]}>
                            {canResend
                              ? 'Resend Verification Email ✉️'
                              : `Resend email in 00:${resendCountdown < 10 ? `0${resendCountdown}` : resendCountdown}`}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => {
                            setLinkSent(false);
                            setErrorMessage('');
                            setDirectLink('');
                          }}
                        >
                          <Text style={styles.changeEmailText}>Use a different email address</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.infoBox}>
                        <Text style={styles.infoBoxText}>
                          Step 1: Enter your corporate mail ID. We'll verify your email before creating your password. Duplicate registrations are prevented.
                        </Text>
                      </View>

                      <View style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>
                          Work Email Address <Text style={{ color: COLORS.primary }}>({domainLabel} only)</Text>
                        </Text>
                        <TextInput
                          style={styles.textInput}
                          placeholder="yourname@zudoc.co"
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

                      <TouchableOpacity
                        style={[styles.primaryButton, loading && styles.buttonDisabled]}
                        onPress={handleRegisterSendVerification}
                        disabled={loading}
                      >
                        {loading ? (
                          <ActivityIndicator color="#ffffff" size="small" />
                        ) : (
                          <Text style={styles.primaryButtonText}>Verify Email Address ✉️</Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.switchModeRow}
                        onPress={() => {
                          setAuthMode('login');
                          setErrorMessage('');
                        }}
                      >
                        <Text style={styles.switchModeText}>
                          Already have an account? <Text style={{ fontWeight: '700' }}>Sign In here →</Text>
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </>
              )}

              {/* Step 2: Create Password & Once Again Password */}
              {registerStep === 'create_password' && (
                <>
                  <View style={[styles.infoBox, { borderLeftColor: COLORS.success }]}>
                    <Text style={[styles.infoBoxText, { color: '#065f46', fontWeight: '700' }]}>
                      ✓ Email Verified! Now create your password to complete registration.
                    </Text>
                  </View>

                  {/* Password */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Create Password (min 6 characters)</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={[styles.textInput, { paddingRight: 64 }]}
                        placeholder="Create a strong password"
                        placeholderTextColor={COLORS.textMuted}
                        value={newPassword}
                        onChangeText={(val) => {
                          setNewPassword(val);
                          setErrorMessage('');
                        }}
                        secureTextEntry={!showNewPassword}
                        autoCapitalize="none"
                      />
                      <TouchableOpacity
                        style={styles.eyeToggleBtn}
                        onPress={() => setShowNewPassword(!showNewPassword)}
                      >
                        <Text style={styles.eyeToggleText}>{showNewPassword ? 'Hide' : 'Show'}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Confirm Password (Once Again Password) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Confirm Password (once again)</Text>
                    <View style={styles.passwordInputWrapper}>
                      <TextInput
                        style={[styles.textInput, { paddingRight: 64 }]}
                        placeholder="Re-enter your password"
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

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleCreatePasswordSubmit}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Save Password &amp; Enter Superadmin 🚀</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* =========================================================================
              VIEW 3: FORGOT PASSWORD (Enter Mail ID -> Send Verification Link -> Let Them In)
             ========================================================================= */}
          {authMode === 'forgot' && (
            <View style={styles.formSection}>
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontFamily: FONT_FAMILY, fontSize: 18, fontWeight: '800', color: COLORS.textMain, marginBottom: 4 }}>
                  Reset Password / Account Recovery
                </Text>
                <Text style={{ fontFamily: FONT_FAMILY, fontSize: 13, color: COLORS.textMuted, lineHeight: 18 }}>
                  Enter your registered mail ID to receive a verification link and sign in directly.
                </Text>
              </View>

              {linkSent ? (
                <View style={styles.verificationNoticeCard}>
                  <Text style={styles.verificationTitle}>Verification Link Sent</Text>
                  <Text style={styles.verificationText}>
                    We've sent a login verification link to{' '}
                    <Text style={{ fontWeight: '700', color: COLORS.primary }}>{linkSentEmail}</Text>.
                  </Text>
                  <Text style={[styles.verificationText, { marginTop: 6, fontSize: 12, color: COLORS.textMuted }]}>
                    Open the link in your email to authenticate and enter the Superadmin portal immediately.
                  </Text>

                  {/* Instant Link Helper */}
                  {directLink ? (
                    <View style={styles.directLinkCard}>
                      <View style={styles.rateLimitNotice}>
                        <Text style={styles.rateLimitTitle}>⚠️ No Email Needed (Rate Limit Active)</Text>
                        <Text style={styles.rateLimitDesc}>
                          Supabase email service is currently rate-limited, so no email will arrive in your real inbox. Click the button below to log in immediately:
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.openDirectBtn}
                        onPress={() => {
                          if (typeof window !== 'undefined' && window.location) {
                            window.location.href = directLink;
                          }
                        }}
                      >
                        <Text style={styles.openDirectBtnText}>🚀 CLICK HERE TO LOG IN DIRECTLY</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={{ marginTop: 8 }}
                        onPress={async () => {
                          try {
                            if (typeof navigator !== 'undefined' && navigator.clipboard) {
                              await navigator.clipboard.writeText(directLink);
                              triggerToast('Verification link copied to clipboard!');
                            }
                          } catch (e) {}
                        }}
                      >
                        <Text style={styles.copyLinkText}>📋 Copy Direct Login URL</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  <View style={{ marginTop: 16, alignItems: 'center', gap: 10, width: '100%' }}>
                    <TouchableOpacity
                      style={styles.resendBtn}
                      onPress={canResend ? handleForgotPassword : undefined}
                      disabled={!canResend || loading}
                    >
                      <Text style={[styles.resendBtnText, !canResend && { color: COLORS.textMuted }]}>
                        {canResend
                          ? 'Resend Verification Email ✉️'
                          : `Resend email in 00:${resendCountdown < 10 ? `0${resendCountdown}` : resendCountdown}`}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        setAuthMode('login');
                        setLinkSent(false);
                        setErrorMessage('');
                        setDirectLink('');
                      }}
                    >
                      <Text style={styles.changeEmailText}>← Back to Sign In</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>
                      Registered Email Address <Text style={{ color: COLORS.primary }}>({domainLabel} only)</Text>
                    </Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="admin@zudoc.co"
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

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleForgotPassword}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Send Verification Link ✉️</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.switchModeRow}
                    onPress={() => {
                      setAuthMode('login');
                      setErrorMessage('');
                    }}
                  >
                    <Text style={styles.switchModeText}>← Back to Sign In</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: COLORS.background, // #F7F9FB
  },
  toastBanner: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    backgroundColor: '#065f46',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    zIndex: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  toastText: {
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  scrollWrapper: {
    minHeight: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  authCard: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 2,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  brandName: {
    fontFamily: FONT_FAMILY,
    fontSize: 28,
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
    borderColor: 'rgba(0, 128, 128, 0.2)',
  },
  portalBadgeText: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primary,
  },
  portalTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textMain,
    marginTop: 2,
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    borderRadius: 7,
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  tabText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
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
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 17,
  },
  errorActionLink: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: 'rgba(0, 128, 128, 0.06)',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.primary,
    padding: 10,
    borderRadius: 6,
    marginBottom: 16,
  },
  infoBoxText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMain,
    lineHeight: 17,
  },
  verificationNoticeCard: {
    backgroundColor: COLORS.primaryLight,
    borderColor: 'rgba(0, 128, 128, 0.25)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginVertical: 4,
    width: '100%',
  },
  verificationTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.primary,
    marginBottom: 8,
    textAlign: 'center',
  },
  verificationText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMain,
    textAlign: 'center',
    lineHeight: 19,
  },
  directLinkCard: {
    backgroundColor: '#ffffff',
    borderColor: 'rgba(0, 128, 128, 0.3)',
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    marginVertical: 12,
    width: '100%',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  directLinkHeader: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 2,
  },
  rateLimitNotice: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
    width: '100%',
  },
  rateLimitTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '800',
    color: '#92400e',
    marginBottom: 2,
    textAlign: 'center',
  },
  rateLimitDesc: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: '#b45309',
    textAlign: 'center',
    lineHeight: 16,
  },
  copyLinkText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
    textAlign: 'center',
  },
  directLinkDesc: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: 8,
  },
  openDirectBtn: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openDirectBtnText: {
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  resendBtn: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  resendBtnText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    textDecorationLine: 'underline',
  },
  changeEmailText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
  },
  formSection: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 16,
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
    fontWeight: '700',
  },
  textInput: {
    fontFamily: FONT_FAMILY,
    backgroundColor: COLORS.inputBg,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 14,
    color: COLORS.textMain,
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
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkboxBox: {
    width: 17,
    height: 17,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  rememberText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
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
  switchModeText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '600',
  },
});
