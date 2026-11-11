import React, { useState } from 'react';
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
import { acceptAccessKey } from './src/services/accessControl';

const { width } = Dimensions.get('window');

const COLORS = {
  primary: '#0f766e', // teal-700
  primaryHover: '#0d5f58',
  primaryLight: 'rgba(15, 118, 110, 0.1)',
  background: '#f8fafc', // slate-50
  card: '#ffffff',
  textMain: '#0f172a', // slate-900
  textMuted: '#64748b', // slate-500
  border: '#e2e8f0', // slate-200
  danger: '#ef4444',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  warningBorder: '#fde68a',
  success: '#10b981',
  successBg: '#ecfdf5',
  successBorder: '#a7f3d0',
};

const FONT_FAMILY = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

export default function AccessRestrictedScreen({
  user,
  onAccessGranted,
  onSignOut,
}) {
  const isWeb = width > 768;
  const userEmail = user?.email || 'Unknown User';

  const [accessKey, setAccessKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleAcceptKey = () => {
    setErrorMessage('');
    setSuccessMessage('');

    const cleanKey = accessKey.trim().toUpperCase();
    if (!cleanKey) {
      setErrorMessage('Please enter the Access Key provided by an administrator.');
      return;
    }

    setLoading(true);

    try {
      const result = acceptAccessKey({
        email: userEmail,
        accessKey: cleanKey,
        userId: user?.id || null,
      });

      setSuccessMessage(result.message || 'Superadmin access activated successfully!');
      setTimeout(() => {
        if (onAccessGranted) {
          onAccessGranted(result.superadmin);
        }
      }, 1200);
    } catch (err) {
      setErrorMessage(err.message || 'Failed to accept access key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollWrapper}>
        <View style={[styles.card, { maxWidth: isWeb ? 540 : '100%' }]}>
          {/* Header Warning Icon */}
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>🛡️</Text>
          </View>

          {/* Badges */}
          <View style={styles.badgeRow}>
            <View style={styles.restrictedBadge}>
              <Text style={styles.restrictedBadgeText}>ACCESS RESTRICTED</Text>
            </View>
            <View style={styles.zeroTrustBadge}>
              <Text style={styles.zeroTrustBadgeText}>SECURITY GATE</Text>
            </View>
          </View>

          <Text style={styles.title}>Superadmin Access Required</Text>
          <Text style={styles.description}>
            This portal is strictly restricted to verified Superadmins. Your account has not yet
            been granted access permissions.
          </Text>

          {/* Logged in Identity Card */}
          <View style={styles.identityCard}>
            <View style={styles.identityAvatar}>
              <Text style={styles.avatarText}>
                {userEmail.charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={styles.identityDetails}>
              <Text style={styles.identityLabel}>Authenticated Account</Text>
              <Text style={styles.identityEmail} numberOfLines={1}>
                {userEmail}
              </Text>
              <View style={styles.statusPill}>
                <View style={styles.statusDot} />
                <Text style={styles.statusPillText}>Not Authorized as Superadmin</Text>
              </View>
            </View>
          </View>

          {/* Error Message */}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorIcon}>⚠️</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Success Message */}
          {successMessage ? (
            <View style={styles.successBox}>
              <Text style={styles.successIcon}>✓</Text>
              <Text style={styles.successText}>{successMessage}</Text>
            </View>
          ) : null}

          {/* Redemption Form */}
          <View style={styles.redemptionSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Accept Access Invitation</Text>
              <Text style={styles.sectionSubtitle}>
                Enter the Superadmin Access Key that was shared with your email address to gain access.
              </Text>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Superadmin Access Key</Text>
              <TextInput
                style={styles.keyInput}
                placeholder="SA-KEY-XXXX-XXXX-XXXX-XXXX"
                placeholderTextColor={COLORS.textMuted}
                value={accessKey}
                onChangeText={(val) => {
                  setAccessKey(val.toUpperCase());
                  setErrorMessage('');
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                spellCheck={false}
              />
              <Text style={styles.inputHelp}>
                Example format: SA-KEY-XXXX-XXXX-XXXX-XXXX (Case insensitive)
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.acceptButton, loading && styles.buttonDisabled]}
              onPress={handleAcceptKey}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text style={styles.acceptButtonText}>Accept Key & Unlock Access 🔓</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* How to get access helper */}
          <View style={styles.helpBox}>
            <Text style={styles.helpTitle}>💡 How do I gain access?</Text>
            <Text style={styles.helpText}>
              An existing Superadmin on the team must go to the{' '}
              <Text style={{ fontWeight: '700' }}>Superadmin Access</Text> tab in their portal,
              enter your email ID (<Text style={{ fontWeight: '700' }}>{userEmail}</Text>), and
              share the generated Access Key with you.
            </Text>
          </View>

          {/* Action Row */}
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.signOutButton} onPress={onSignOut}>
              <Text style={styles.signOutButtonText}>← Sign Out / Switch Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollWrapper: {
    minHeight: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 36,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
    alignItems: 'center',
  },
  iconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: {
    fontSize: 32,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  restrictedBadge: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  restrictedBadgeText: {
    fontFamily: FONT_FAMILY,
    color: '#b91c1c',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  zeroTrustBadge: {
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  zeroTrustBadgeText: {
    fontFamily: FONT_FAMILY,
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textMain,
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
    maxWidth: 440,
  },
  identityCard: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  identityAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  identityDetails: {
    flex: 1,
  },
  identityLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  identityEmail: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMain,
    marginVertical: 2,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.danger,
    marginRight: 6,
  },
  statusPillText: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.danger,
    fontWeight: '600',
  },
  errorBox: {
    width: '100%',
    backgroundColor: COLORS.dangerBg,
    borderColor: COLORS.dangerBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  errorIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  errorText: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    color: '#b91c1c',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  successBox: {
    width: '100%',
    backgroundColor: COLORS.successBg,
    borderColor: COLORS.successBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  successIcon: {
    color: COLORS.success,
    fontSize: 16,
    fontWeight: '800',
    marginRight: 8,
  },
  successText: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    color: '#065f46',
    fontSize: 13,
    fontWeight: '600',
  },
  redemptionSection: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    marginBottom: 20,
  },
  sectionHeader: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMuted,
    lineHeight: 17,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMain,
    marginBottom: 6,
  },
  keyInput: {
    fontFamily: Platform.select({
      web: 'monospace, "Courier New", Courier',
      default: undefined,
    }),
    height: 48,
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textMain,
    letterSpacing: 1.2,
  },
  inputHelp: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  acceptButton: {
    height: 48,
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  acceptButtonText: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
  helpBox: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
  },
  helpTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 4,
  },
  helpText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
  },
  actionsRow: {
    width: '100%',
    alignItems: 'center',
  },
  signOutButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  signOutButtonText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
  },
});
