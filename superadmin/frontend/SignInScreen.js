import React, { useState, useEffect, useRef } from 'react';
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
  Button,
} from 'react-native';
import { supabase } from './lib/supabase';
import {
  signIn,
  signUp,
  signInWithOtp,
  verifyOtp,
  resetPasswordForEmail,
} from './src/services/auth';
import { signInWithGoogle } from './src/services/googleAuth';

const { width } = Dimensions.get('window');

// Verifyyy Light Theme Palette - Exactly matching the Dashboard
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

  // --- Auth Mode: 'password' | 'otp' ---
  const [authMode, setAuthMode] = useState('password');
  // --- Sign In vs Sign Up Mode ---
  const [isSignUpMode, setIsSignUpMode] = useState(false);

  // --- Form States ---
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // --- OTP States ---
  const [otpStep, setOtpStep] = useState('request'); // 'request' | 'verify'
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [resendCountdown, setResendCountdown] = useState(45);
  const [canResend, setCanResend] = useState(false);
  const otpInputsRef = useRef([]);

  // --- Status & Feedback States ---
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [fpEmail, setFpEmail] = useState('');
  const [fpSent, setFpSent] = useState(false);
  const [fpLoading, setFpLoading] = useState(false);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = localStorage.getItem('verifyyy_superadmin_email');
        if (saved && !email) setEmail(saved);
      }
    } catch (e) {}
  }, []);

  // Countdown timer for Resend OTP
  useEffect(() => {
    let timer = null;
    if (otpStep === 'verify' && resendCountdown > 0) {
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
  }, [otpStep, resendCountdown]);

  const triggerToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3500);
  };

  // --- Password Authentication (Sign In / Sign Up) ---
  const handlePasswordAuth = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim();

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
      if (isSignUpMode) {
        const data = await signUp(cleanEmail, password);
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
          triggerToast('Account created! Please check your email to confirm registration or sign in.');
          setIsSignUpMode(false);
        }
      } else {
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
      }
    } catch (err) {
      setErrorMessage(err.message || 'Authentication failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const [googleLoading, setGoogleLoading] = useState(false);

  // --- Google OAuth Sign In ---
  const handleGoogleSignIn = async () => {
    setErrorMessage('');
    setGoogleLoading(true);
    try {
      const session = await signInWithGoogle();
      if (session) {
        if (Platform.OS !== 'web') {
          Alert.alert('Success', 'Google sign-in successful!');
        } else {
          triggerToast('Google sign-in successful!');
        }
        if (onLoginSuccess) {
          onLoginSuccess(session.user);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Google sign-in failed';
      setErrorMessage(message);
      if (Platform.OS !== 'web') {
        Alert.alert('Sign-in failed', message);
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  // --- OTP Flow ---
  const handleRequestOtp = async () => {
    setErrorMessage('');
    const cleanEmail = email.trim();

    if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
      setErrorMessage('Please enter a valid administrative email.');
      return;
    }

    setLoading(true);

    try {
      await signInWithOtp(cleanEmail);
      setOtpStep('verify');
      setResendCountdown(45);
      setCanResend(false);
      triggerToast(`Verification code sent to ${cleanEmail}`);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to send OTP code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    setErrorMessage('');
    const entered = otpDigits.join('');

    if (entered.length < 6) {
      setErrorMessage('Please enter all 6 digits of the code.');
      return;
    }

    setLoading(true);

    try {
      const data = await verifyOtp(email, entered);
      if (data?.user) {
        triggerToast('OTP verified successfully!');
        if (onLoginSuccess) onLoginSuccess(data.user);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpDigitChange = (val, index) => {
    const clean = val.replace(/[^0-9]/g, '');
    const updated = [...otpDigits];

    if (clean.length > 1) {
      const split = clean.slice(0, 6).split('');
      for (let i = 0; i < 6; i++) {
        updated[i] = split[i] || '';
      }
      setOtpDigits(updated);
      if (split.length === 6 && otpInputsRef.current[5]) {
        otpInputsRef.current[5].focus();
      }
      return;
    }

    updated[index] = clean;
    setOtpDigits(updated);

    if (clean && index < 5 && otpInputsRef.current[index + 1]) {
      otpInputsRef.current[index + 1].focus();
    }
  };

  const handleOtpKeyPress = (e, index) => {
    if (e.nativeEvent.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  };

  // --- Password Reset ---
  const handleSendResetEmail = async () => {
    if (!fpEmail.trim() || !EMAIL_REGEX.test(fpEmail.trim())) {
      setErrorMessage('Please enter a valid administrative email.');
      return;
    }
    setFpLoading(true);
    try {
      await resetPasswordForEmail(fpEmail);
      setFpSent(true);
    } catch (err) {
      setErrorMessage(err.message || 'Password reset request failed.');
    } finally {
      setFpLoading(false);
    }
  };

  return (
    <View style={styles.screenContainer}>
      {/* Toast Notification */}
      {toastMessage ? (
        <View style={styles.toastBanner}>
          <Text style={styles.toastText}>✓ {toastMessage}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollWrapper}>
        <View style={[styles.authCard, { maxWidth: isWeb ? 440 : '100%' }]}>
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

          {/* Auth Mode Tabs (Password Login vs Email OTP) */}
          <View style={styles.tabsContainer}>
            <TouchableOpacity
              style={[styles.tabButton, authMode === 'password' && styles.tabButtonActive]}
              onPress={() => {
                setAuthMode('password');
                setErrorMessage('');
              }}
            >
              <Text style={[styles.tabText, authMode === 'password' && styles.tabTextActive]}>
                {isSignUpMode ? 'Register' : 'Password Login'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, authMode === 'otp' && styles.tabButtonActive]}
              onPress={() => {
                setAuthMode('otp');
                setErrorMessage('');
              }}
            >
              <Text style={[styles.tabText, authMode === 'otp' && styles.tabTextActive]}>
                Email OTP
              </Text>
            </TouchableOpacity>
          </View>

          {/* Error Banner */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* MODE 1: Password Login */}
          {authMode === 'password' && (
            <View style={styles.formSection}>
              {/* Email */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Work Email Address</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="superadmin@verifyyy.ai"
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
                  {!isSignUpMode && (
                    <TouchableOpacity
                      onPress={() => {
                        setFpEmail(email);
                        setFpSent(false);
                        setForgotModalVisible(true);
                      }}
                    >
                      <Text style={styles.forgotLink}>Forgot?</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.passwordInputWrapper}>
                  <TextInput
                    style={[styles.textInput, { paddingRight: 64 }]}
                    placeholder={isSignUpMode ? 'Create password' : 'Enter password'}
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
                onPress={handlePasswordAuth}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {isSignUpMode ? 'Create Account' : 'Sign In'}
                  </Text>
                )}
              </TouchableOpacity>

              {/* Toggle Sign Up / Sign In */}
              <TouchableOpacity
                style={styles.switchModeRow}
                onPress={() => {
                  setIsSignUpMode(!isSignUpMode);
                  setErrorMessage('');
                }}
              >
                <Text style={styles.switchModeText}>
                  {isSignUpMode
                    ? 'Already have an account? Sign In'
                    : 'First time user? Create a new account'}
                </Text>
              </TouchableOpacity>

              {/* Divider */}
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Google Sign In Button */}
              <TouchableOpacity
                style={[styles.googleButton, (googleLoading || loading) && styles.buttonDisabled]}
                onPress={handleGoogleSignIn}
                disabled={googleLoading || loading}
              >
                {googleLoading ? (
                  <ActivityIndicator color={COLORS.primary} size="small" />
                ) : (
                  <View style={styles.googleButtonContent}>
                    <View style={styles.googleIconBadge}>
                      <Text style={styles.googleIconText}>G</Text>
                    </View>
                    <Text style={styles.googleButtonText}>Continue with Google</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* MODE 2: Email OTP */}
          {authMode === 'otp' && (
            <View style={styles.formSection}>
              {otpStep === 'request' ? (
                <>
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Work Email Address</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="superadmin@verifyyy.ai"
                      placeholderTextColor={COLORS.textMuted}
                      value={email}
                      onChangeText={(val) => {
                        setEmail(val);
                        setErrorMessage('');
                      }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleRequestOtp}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Send Verification Code</Text>
                    )}
                  </TouchableOpacity>

                  {/* Divider */}
                  <View style={styles.dividerRow}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>or</Text>
                    <View style={styles.dividerLine} />
                  </View>

                  {/* Google Sign In Button */}
                  <TouchableOpacity
                    style={[styles.googleButton, (googleLoading || loading) && styles.buttonDisabled]}
                    onPress={handleGoogleSignIn}
                    disabled={googleLoading || loading}
                  >
                    {googleLoading ? (
                      <ActivityIndicator color={COLORS.primary} size="small" />
                    ) : (
                      <View style={styles.googleButtonContent}>
                        <View style={styles.googleIconBadge}>
                          <Text style={styles.googleIconText}>G</Text>
                        </View>
                        <Text style={styles.googleButtonText}>Continue with Google</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={styles.otpSentCard}>
                    <Text style={styles.otpSentText}>
                      Code sent to <Text style={{ fontWeight: '700', color: COLORS.primary }}>{email}</Text>
                    </Text>
                    <TouchableOpacity onPress={() => setOtpStep('request')}>
                      <Text style={styles.changeEmailText}>Change Email</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.inputLabel, { textAlign: 'center', marginTop: 14 }]}>
                    Enter 6-Digit Code
                  </Text>

                  {/* 6 OTP Boxes */}
                  <View style={styles.otpBoxesRow}>
                    {otpDigits.map((digit, idx) => (
                      <TextInput
                        key={idx}
                        ref={(ref) => (otpInputsRef.current[idx] = ref)}
                        style={styles.otpBox}
                        maxLength={1}
                        keyboardType="numeric"
                        value={digit}
                        onChangeText={(val) => handleOtpDigitChange(val, idx)}
                        onKeyPress={(e) => handleOtpKeyPress(e, idx)}
                        textAlign="center"
                      />
                    ))}
                  </View>

                  <View style={styles.resendRow}>
                    {!canResend ? (
                      <Text style={styles.resendTimerText}>
                        Resend code in 00:{resendCountdown < 10 ? `0${resendCountdown}` : resendCountdown}
                      </Text>
                    ) : (
                      <TouchableOpacity onPress={handleRequestOtp}>
                        <Text style={styles.resendActionText}>Resend Code</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryButton, loading && styles.buttonDisabled]}
                    onPress={handleVerifyOtp}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#ffffff" size="small" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Verify &amp; Sign In</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Forgot Password Modal */}
      <Modal visible={forgotModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <Text style={styles.modalSubtitle}>
              Enter your work email address to receive password reset instructions.
            </Text>

            {!fpSent ? (
              <>
                <TextInput
                  style={[styles.textInput, { marginBottom: 16 }]}
                  placeholder="superadmin@verifyyy.ai"
                  placeholderTextColor={COLORS.textMuted}
                  value={fpEmail}
                  onChangeText={setFpEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
                <TouchableOpacity
                  style={[styles.primaryButton, fpLoading && styles.buttonDisabled]}
                  onPress={handleSendResetEmail}
                  disabled={fpLoading}
                >
                  {fpLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send Reset Link</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.fpSuccessBox}>
                <Text style={styles.fpSuccessTitle}>Reset Link Sent</Text>
                <Text style={styles.fpSuccessMsg}>
                  Check your inbox at <Text style={{ color: COLORS.primary, fontWeight: '700' }}>{fpEmail}</Text>.
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={() => setForgotModalVisible(false)}
            >
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: {
    flex: 1,
    backgroundColor: COLORS.background, // Light theme #f8fafc
  },
  scrollWrapper: {
    minHeight: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  toastBanner: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    zIndex: 9999,
    backgroundColor: '#ffffff',
    borderColor: COLORS.primary,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  toastText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  authCard: {
    width: '100%',
    backgroundColor: COLORS.card, // solid white #ffffff matching dashboard
    borderRadius: 16,
    padding: 36,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 24,
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
    borderColor: 'rgba(15, 118, 110, 0.2)',
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
    marginBottom: 22,
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
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.danger,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  formSection: {
    width: '100%',
  },
  inputGroup: {
    marginBottom: 18,
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
    marginBottom: 20,
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
  otpSentCard: {
    backgroundColor: COLORS.primaryLight,
    borderColor: 'rgba(15, 118, 110, 0.2)',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 14,
  },
  otpSentText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMain,
    marginBottom: 4,
  },
  changeEmailText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
  },
  otpBoxesRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 14,
  },
  otpBox: {
    width: 44,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    color: COLORS.textMain,
    fontSize: 20,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  resendRow: {
    alignItems: 'center',
    marginBottom: 16,
  },
  resendTimerText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMuted,
  },
  resendActionText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '700',
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
    maxWidth: 380,
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
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  fpSuccessMsg: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    fontFamily: FONT_FAMILY,
    marginHorizontal: 12,
    fontSize: 12,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  googleIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4285F4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleIconText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
  },
  googleButtonText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '600',
  },
});
