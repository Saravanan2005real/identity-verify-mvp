import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  TextInput,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as Linking from 'expo-linking';
import SignInScreen from './SignInScreen';
import AccessRestrictedScreen from './AccessRestrictedScreen';
import { supabase } from './lib/supabase';
import { signOut } from './src/services/auth';
import {
  isSuperadminAuthorized,
  recordAuthorizedSuperadmin,
  getAuthorizedSuperadmins,
  getAccessKeys,
  issueAccessKey,
  revokeAccessKey,
  revokeSuperadminAccess,
  getAccessAuditLogs,
  getAccessSummaryStats,
} from './src/services/accessControl';

const { width } = Dimensions.get('window');

const SUPERADMIN_API_URL = (
  process.env.EXPO_PUBLIC_SUPERADMIN_API_URL || 'http://127.0.0.1:8000'
).replace(/\/+$/, '');

// Theme Colors for Verifyyy matching Customer Portal
const COLORS = {
  primary: '#0f766e', // teal-700
  primaryHover: '#0d5f58',
  primaryLight: 'rgba(15, 118, 110, 0.1)', // teal accent light
  background: '#f8fafc', // slate-50
  card: '#ffffff',
  textMain: '#0f172a', // slate-900
  textMuted: '#64748b', // slate-500
  border: '#e2e8f0', // slate-200
  borderDark: '#cbd5e1',
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

export default function App() {
  const isWeb = width > 768;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard' | 'products' | 'access'

  const [stats, setStats] = useState([
    { id: '1', title: 'Total Companies', value: '1', icon: '🏢' },
    { id: '2', title: 'Active Clients', value: '1', icon: '✅' },
    { id: '3', title: 'Verified Today', value: '0', icon: '⚡' },
    { id: '4', title: 'Manual Review', value: '0', icon: '🔍' },
  ]);
  const [companies, setCompanies] = useState([]);
  const [products, setProducts] = useState([]);

  // --- Access Control Management State ---
  const [authorizedAdmins, setAuthorizedAdmins] = useState([]);
  const [accessKeysList, setAccessKeysList] = useState([]);
  const [auditLogsList, setAuditLogsList] = useState([]);
  const [accessSummary, setAccessSummary] = useState({
    activeSuperadmins: 1,
    pendingKeys: 0,
    acceptedKeys: 0,
    revokedKeys: 0,
  });

  // Issue Key Form State
  const [targetEmail, setTargetEmail] = useState('');
  const [keyRole, setKeyRole] = useState('superadmin');
  const [keyNote, setKeyNote] = useState('');
  const [issueLoading, setIssueLoading] = useState(false);
  const [issueError, setIssueError] = useState('');
  const [issuedModalData, setIssuedModalData] = useState(null);
  const [copyToast, setCopyToast] = useState('');

  // Refresh access state from service
  const refreshAccessData = () => {
    setAuthorizedAdmins(getAuthorizedSuperadmins());
    setAccessKeysList(getAccessKeys());
    setAuditLogsList(getAccessAuditLogs());
    setAccessSummary(getAccessSummaryStats());
  };

  useEffect(() => {
    refreshAccessData();
  }, [isAuthenticated, isAuthorized]);

  useEffect(() => {
    // 1. Supabase Session Detection
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        // Enforce no Google OAuth session on Superadmin
        if (session.user.app_metadata?.provider === 'google') {
          supabase.auth.signOut();
          setCurrentUser(null);
          setIsAuthenticated(false);
          setIsAuthorized(false);
          return;
        }

        setCurrentUser(session.user);
        setIsAuthenticated(true);
        const authorized = isSuperadminAuthorized(session.user.email);
        if (authorized) {
          recordAuthorizedSuperadmin(session.user.email, session.user.id);
        }
        setIsAuthorized(authorized);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        // Enforce no Google OAuth session on Superadmin
        if (session.user.app_metadata?.provider === 'google') {
          supabase.auth.signOut();
          setCurrentUser(null);
          setIsAuthenticated(false);
          setIsAuthorized(false);
          return;
        }

        setCurrentUser(session.user);
        setIsAuthenticated(true);
        const authorized = isSuperadminAuthorized(session.user.email);
        if (authorized) {
          recordAuthorizedSuperadmin(session.user.email, session.user.id);
        }
        setIsAuthorized(authorized);
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
        setIsAuthorized(false);
      }
    });

    // Handle deep link authentication
    const handleAuthUrl = async (url) => {
      if (!url) return;
      try {
        const { queryParams } = Linking.parse(url);
        if (queryParams?.code) {
          await supabase.auth.exchangeCodeForSession(queryParams.code);
        } else if (url.includes('#')) {
          const hash = url.split('#')[1];
          const params = new URLSearchParams(hash);
          const access_token = params.get('access_token');
          const refresh_token = params.get('refresh_token');
          if (access_token && refresh_token) {
            await supabase.auth.setSession({ access_token, refresh_token });
          }
        }
      } catch (err) {
        console.warn('Deep link authentication error:', err);
      }
    };

    Linking.getInitialURL().then(handleAuthUrl);
    const linkSub = Linking.addEventListener('url', ({ url }) => handleAuthUrl(url));

    // Fetch Dashboard Stats with Supabase Bearer token
    supabase.auth.getSession().then(({ data: { session } }) => {
      const headers = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      fetch(`${SUPERADMIN_API_URL}/api/v1/b2b/dashboard`, { headers })
        .then((res) => res.json())
        .then((data) => {
          if (data.status === 'success' && data.data) {
            setStats([
              { id: '1', title: 'Total Companies', value: '1', icon: '🏢' },
              { id: '2', title: 'Pipelines Built', value: data.data.pipelines_built?.toString() || '0', icon: '✅' },
              { id: '3', title: 'Links Generated', value: data.data.links_generated?.toString() || '0', icon: '⚡' },
              { id: '4', title: 'Verified', value: data.data.verifications_completed?.toString() || '0', icon: '🔍' },
            ]);
          }
        })
        .catch((err) => console.log('Stats fetch skipped (local backend offline)'));
    });

    // Fetch Services (Products)
    fetch(`${SUPERADMIN_API_URL}/api/v1/b2b/verification-services`)
      .then((res) => res.json())
      .then((data) => {
        if (data.status === 'success' && data.data) {
          setProducts(
            data.data.map((service) => ({
              id: service.id,
              name: service.name,
              users: 0,
            }))
          );
        }
      })
      .catch((err) => console.log('Services fetch skipped (local backend offline)'));

    return () => {
      authListener?.subscription?.unsubscribe();
      linkSub?.remove?.();
    };
  }, []);

  const triggerCopyToast = (text) => {
    setCopyToast(text);
    setTimeout(() => setCopyToast(''), 3000);
  };

  const copyText = (val, successLabel = 'Copied to clipboard!') => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(val);
    }
    triggerCopyToast(successLabel);
  };

  // Issue Key Handler
  const handleIssueKey = () => {
    setIssueError('');
    if (!targetEmail || !targetEmail.includes('@')) {
      setIssueError('Please enter a valid email address for the new employee.');
      return;
    }

    setIssueLoading(true);
    try {
      const createdKey = issueAccessKey({
        targetEmail: targetEmail.trim(),
        createdByEmail: currentUser?.email || 'Administrator',
        note: keyNote.trim() || 'Superadmin Portal Authorization',
        role: keyRole,
      });

      setIssuedModalData(createdKey);
      setTargetEmail('');
      setKeyNote('');
      refreshAccessData();
    } catch (err) {
      setIssueError(err.message || 'Failed to issue access key.');
    } finally {
      setIssueLoading(false);
    }
  };

  const handleRevokeKey = (keyId) => {
    try {
      revokeAccessKey(keyId, currentUser?.email || 'Administrator');
      refreshAccessData();
      triggerCopyToast('Access key revoked.');
    } catch (err) {
      alert(err.message || 'Could not revoke key.');
    }
  };

  const handleRevokeSuperadmin = (adminEmail) => {
    try {
      revokeSuperadminAccess(adminEmail, currentUser?.email || 'Administrator');
      refreshAccessData();
      triggerCopyToast(`Revoked Superadmin access for ${adminEmail}.`);
    } catch (err) {
      alert(err.message || 'Could not revoke superadmin.');
    }
  };

  const openProduct = (file) => {
    Linking.openURL('http://localhost:5174/' + file);
  };

  // --- Render Dashboard Tab ---
  const renderDashboard = () => (
    <>
      <Text style={styles.sectionTitle}>Platform Overview</Text>
      <View style={styles.statsContainer}>
        {stats.map((item) => (
          <View key={item.id} style={[styles.statCard, { width: isWeb ? '23%' : '48%' }]}>
            <View style={styles.statIconContainer}>
              <Text style={styles.statIcon}>{item.icon}</Text>
            </View>
            <Text style={styles.statValue}>{item.value}</Text>
            <Text style={styles.statTitle}>{item.title}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.detailsContainer, { flexDirection: isWeb ? 'row' : 'column' }]}>
        {/* Companies List */}
        <View style={[styles.card, { flex: isWeb ? 2 : 1, marginRight: isWeb ? 16 : 0, marginBottom: isWeb ? 0 : 16 }]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Recent Client Companies</Text>
            <TouchableOpacity>
              <Text style={styles.linkText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableCol, { flex: 2 }]}>Company</Text>
            <Text style={styles.tableCol}>Pipelines</Text>
            <Text style={styles.tableCol}>Links</Text>
            <Text style={styles.tableCol}>Verified</Text>
            <Text style={styles.tableCol}>Status</Text>
          </View>
          {companies.length > 0 ? (
            companies.map((company) => (
              <View style={styles.tableRow} key={company.id}>
                <Text style={[styles.tableCell, styles.cellMain, { flex: 2 }]}>{company.name}</Text>
                <Text style={styles.tableCell}>{company.pipelines_built}</Text>
                <Text style={styles.tableCell}>{company.links_generated}</Text>
                <Text style={styles.tableCell}>{company.verifications_completed}</Text>
                <View style={styles.statusBadge(company.status)}>
                  <Text style={styles.statusText(company.status)}>{company.status || 'Active'}</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>Verifyyy Internal Sandbox Org</Text>
              <Text style={styles.emptyStateSubtext}>Status: Active • Client Portal: http://localhost:8082</Text>
            </View>
          )}
        </View>

        {/* Products List */}
        <View style={[styles.card, { flex: 1 }]}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Service Utilization</Text>
          </View>
          {products.length > 0 ? (
            products.map((product) => (
              <View style={styles.productRow} key={product.id}>
                <View style={styles.productIconContainer}>
                  <Text style={styles.productIcon}>📦</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productUsers}>{product.users}% usage</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={{ gap: 12 }}>
              <View style={styles.productRow}>
                <View style={styles.productIconContainer}><Text style={styles.productIcon}>📷</Text></View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>Aadhaar & PAN OCR Match</Text>
                  <Text style={styles.productUsers}>Active Module • Engine 5001</Text>
                </View>
              </View>
              <View style={styles.productRow}>
                <View style={styles.productIconContainer}><Text style={styles.productIcon}>👁️</Text></View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>Eye Tracking Liveness</Text>
                  <Text style={styles.productUsers}>Active Module • Gateway 5174</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </View>
    </>
  );

  // --- Render Our Products Tab ---
  const renderOurProducts = () => (
    <View>
      <Text style={styles.sectionTitle}>Our Verifyyy Modules</Text>
      <Text style={{ color: COLORS.textMuted, marginBottom: 24 }}>
        Explore the core verification products we offer to clients.
      </Text>

      <View style={{ flexDirection: isWeb ? 'row' : 'column', gap: 24 }}>
        <View style={styles.productCard}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>📷</Text>
          <Text style={styles.productCardTitle}>Aadhaar / PAN OCR & Face Match</Text>
          <Text style={styles.productCardDesc}>
            Cross-verify Aadhaar or PAN card identity documents with a live face capture & ArcFace liveness check.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => openProduct('demo_ocr_face.html')}>
            <Text style={styles.btnText}>View Module</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.productCard}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>👁️</Text>
          <Text style={styles.productCardTitle}>Eye Tracking</Text>
          <Text style={styles.productCardDesc}>Advanced liveness detection tracking eye movement.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openProduct('demo_eye_tracking.html')}>
            <Text style={styles.btnText}>View Module</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.productCard}>
          <Text style={{ fontSize: 40, marginBottom: 16 }}>🎙️</Text>
          <Text style={styles.productCardTitle}>Audio Liveness</Text>
          <Text style={styles.productCardDesc}>Verify presence through voice prompt challenges.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openProduct('demo_audio_liveness.html')}>
            <Text style={styles.btnText}>View Module</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  // --- Render Superadmin Access Management Tab ---
  const renderSuperadminAccess = () => {
    const pendingKeys = accessKeysList.filter((k) => k.status === 'PENDING');
    const activeAdmins = authorizedAdmins.filter((a) => a.status === 'ACTIVE');

    return (
      <View style={styles.accessViewContainer}>
        {/* Banner */}
        <View style={styles.accessBanner}>
          <View style={styles.accessBannerHeader}>
            <View style={styles.accessBannerShield}>
              <Text style={{ fontSize: 24 }}>🛡️</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={styles.accessBannerTitle}>Superadmin Access &amp; Personnel Control</Text>
                <View style={styles.accessGateTag}>
                  <Text style={styles.accessGateTagText}>RESTRICTED ACCESS ACTIVE</Text>
                </View>
              </View>
              <Text style={styles.accessBannerSubtitle}>
                Only verified users who receive and accept an Access Key bound to their email ID can log into this portal.
              </Text>
            </View>
          </View>
        </View>

        {/* Security Summary Cards */}
        <View style={styles.accessStatsRow}>
          <View style={[styles.accessStatCard, { width: isWeb ? '23%' : '48%' }]}>
            <Text style={styles.accessStatVal}>{accessSummary.activeSuperadmins}</Text>
            <Text style={styles.accessStatLabel}>Active Superadmins</Text>
            <View style={styles.badgePillActive}>
              <Text style={styles.badgePillActiveText}>Cleared 🟢</Text>
            </View>
          </View>
          <View style={[styles.accessStatCard, { width: isWeb ? '23%' : '48%' }]}>
            <Text style={styles.accessStatVal}>{accessSummary.pendingKeys}</Text>
            <Text style={styles.accessStatLabel}>Pending Keys</Text>
            <View style={styles.badgePillPending}>
              <Text style={styles.badgePillPendingText}>Awaiting Acceptance 🟡</Text>
            </View>
          </View>
          <View style={[styles.accessStatCard, { width: isWeb ? '23%' : '48%' }]}>
            <Text style={styles.accessStatVal}>{accessSummary.acceptedKeys}</Text>
            <Text style={styles.accessStatLabel}>Redeemed Keys</Text>
            <View style={styles.badgePillSuccess}>
              <Text style={styles.badgePillSuccessText}>Accepted ✓</Text>
            </View>
          </View>
          <View style={[styles.accessStatCard, { width: isWeb ? '23%' : '48%' }]}>
            <Text style={[styles.accessStatVal, { fontSize: 20, color: COLORS.primary }]}>Zero Trust</Text>
            <Text style={styles.accessStatLabel}>Clearance Gate</Text>
            <View style={styles.badgePillStrict}>
              <Text style={styles.badgePillStrictText}>Strict Mode 🔒</Text>
            </View>
          </View>
        </View>

        {/* Form: Issue Access Key to New Employee */}
        <View style={styles.accessCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Share Access Key with New Employee</Text>
              <Text style={styles.cardSubtitle}>
                Generate an authorization key for a new team member. The key is cryptographically bound to their email ID.
              </Text>
            </View>
          </View>

          {issueError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{issueError}</Text>
            </View>
          ) : null}

          <View style={{ flexDirection: isWeb ? 'row' : 'column', gap: 16, alignItems: 'flex-start' }}>
            <View style={{ flex: 2, width: '100%' }}>
              <Text style={styles.fieldLabel}>New Employee Email Address *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="colleague@gmail.com"
                placeholderTextColor={COLORS.textMuted}
                value={targetEmail}
                onChangeText={(val) => {
                  setTargetEmail(val);
                  setIssueError('');
                }}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={{ flex: 1.5, width: '100%' }}>
              <Text style={styles.fieldLabel}>Department / Purpose</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g. Identity Operations, Reviewer"
                placeholderTextColor={COLORS.textMuted}
                value={keyNote}
                onChangeText={setKeyNote}
              />
            </View>

            <View style={{ width: isWeb ? 'auto' : '100%', marginTop: isWeb ? 22 : 0 }}>
              <TouchableOpacity
                style={[styles.primaryActionBtn, issueLoading && { opacity: 0.6 }]}
                onPress={handleIssueKey}
                disabled={issueLoading}
              >
                {issueLoading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.primaryActionBtnText}>🔑 Generate &amp; Share Key</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Section: Pending Access Keys */}
        <View style={styles.accessCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Pending Invitations (Awaiting Acceptance)</Text>
              <Text style={styles.cardSubtitle}>
                These keys have been generated and shared. The employee must enter their key upon login to activate access.
              </Text>
            </View>
            <View style={styles.counterBadge}>
              <Text style={styles.counterBadgeText}>{pendingKeys.length} Pending</Text>
            </View>
          </View>

          {pendingKeys.length > 0 ? (
            <View style={styles.tableWrapper}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.colHeader, { flex: 2 }]}>Invited Email</Text>
                <Text style={[styles.colHeader, { flex: 2.2 }]}>Access Key</Text>
                <Text style={[styles.colHeader, { flex: 1.5 }]}>Issued By</Text>
                <Text style={[styles.colHeader, { flex: 1.2 }]}>Date</Text>
                <Text style={[styles.colHeader, { flex: 1 }]}>Status</Text>
                <Text style={[styles.colHeader, { flex: 1.5, textAlign: 'right' }]}>Actions</Text>
              </View>

              {pendingKeys.map((key) => (
                <View style={styles.tableRow} key={key.id}>
                  <Text style={[styles.tableCellText, { flex: 2, fontWeight: '700' }]}>{key.targetEmail}</Text>
                  <View style={{ flex: 2.2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.monoKeyText}>{key.accessKey}</Text>
                    <TouchableOpacity
                      onPress={() => copyText(key.accessKey, `Copied key: ${key.accessKey}`)}
                      style={styles.inlineCopyBtn}
                    >
                      <Text style={styles.inlineCopyBtnText}>📋</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.tableCellText, { flex: 1.5, color: COLORS.textMuted }]}>{key.createdBy}</Text>
                  <Text style={[styles.tableCellText, { flex: 1.2, fontSize: 12, color: COLORS.textMuted }]}>
                    {new Date(key.createdAt).toLocaleDateString()}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgePending}>
                      <Text style={styles.badgePendingText}>PENDING</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1.5, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                    <TouchableOpacity
                      style={styles.actionBtnSmall}
                      onPress={() => {
                        const msg = `Hi! You have been granted Superadmin access to Verifyyy (http://localhost:8081). Enter this Access Key: ${key.accessKey} for your email (${key.targetEmail}) to accept.`;
                        copyText(msg, 'Invitation message copied!');
                      }}
                    >
                      <Text style={styles.actionBtnSmallText}>Copy Invite</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.revokeBtnSmall}
                      onPress={() => handleRevokeKey(key.id)}
                    >
                      <Text style={styles.revokeBtnSmallText}>Revoke</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.emptyNotice}>
              <Text style={styles.emptyNoticeTitle}>No Pending Invitations</Text>
              <Text style={styles.emptyNoticeDesc}>
                All issued keys have been accepted by team members, or no invitations are currently open.
              </Text>
            </View>
          )}
        </View>

        {/* Section: Active Superadmin Personnel */}
        <View style={styles.accessCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Authorized Superadmin Personnel</Text>
              <Text style={styles.cardSubtitle}>
                These users hold active clearance and can log in via Password or Email OTP into the Superadmin dashboard.
              </Text>
            </View>
            <View style={styles.counterBadgeActive}>
              <Text style={styles.counterBadgeActiveText}>{activeAdmins.length} Active</Text>
            </View>
          </View>

          <View style={styles.tableWrapper}>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.colHeader, { flex: 2 }]}>Superadmin Email</Text>
              <Text style={[styles.colHeader, { flex: 1 }]}>Role</Text>
              <Text style={[styles.colHeader, { flex: 1 }]}>Status</Text>
              <Text style={[styles.colHeader, { flex: 1.5 }]}>Granted By</Text>
              <Text style={[styles.colHeader, { flex: 1.2 }]}>Activated At</Text>
              <Text style={[styles.colHeader, { flex: 1, textAlign: 'right' }]}>Actions</Text>
            </View>

            {activeAdmins.map((admin, idx) => {
              const isSelf = admin.email.toLowerCase() === currentUser?.email?.toLowerCase();

              return (
                <View style={styles.tableRow} key={idx}>
                  <View style={{ flex: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={styles.adminAvatarSmall}>
                      <Text style={styles.adminAvatarSmallText}>{admin.email.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View>
                      <Text style={[styles.tableCellText, { fontWeight: '700' }]}>{admin.email}</Text>
                      {isSelf && <Text style={styles.selfBadgeText}>(You)</Text>}
                    </View>
                  </View>
                  <Text style={[styles.tableCellText, { flex: 1, textTransform: 'capitalize' }]}>{admin.role}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={styles.badgeActive}>
                      <Text style={styles.badgeActiveText}>ACTIVE</Text>
                    </View>
                  </View>
                  <Text style={[styles.tableCellText, { flex: 1.5, color: COLORS.textMuted }]}>
                    {admin.addedBy || 'Verified'}
                  </Text>
                  <Text style={[styles.tableCellText, { flex: 1.2, fontSize: 12, color: COLORS.textMuted }]}>
                    {admin.addedAt ? new Date(admin.addedAt).toLocaleDateString() : 'Active'}
                  </Text>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    {isSelf ? (
                      <Text style={{ fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic' }}>Protected (You)</Text>
                    ) : (
                      <TouchableOpacity
                        style={styles.revokeBtnSmall}
                        onPress={() => handleRevokeSuperadmin(admin.email)}
                      >
                        <Text style={styles.revokeBtnSmallText}>Revoke Access</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Section: Audit Trail */}
        <View style={styles.accessCard}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.cardTitle}>Access Control Audit Log</Text>
              <Text style={styles.cardSubtitle}>
                Real-time security trail recording all access key generation, acceptance, and revocation activities.
              </Text>
            </View>
          </View>

          <View style={styles.auditList}>
            {auditLogsList.slice(0, 8).map((log) => (
              <View style={styles.auditItem} key={log.id}>
                <View style={styles.auditIcon}>
                  <Text style={{ fontSize: 14 }}>
                    {log.action.includes('ACCEPTED') ? '🟢' : log.action.includes('ISSUED') ? '🔑' : '🔒'}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                    <Text style={styles.auditAction}>{log.action.replace(/_/g, ' ')}</Text>
                    <Text style={styles.auditTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                  </View>
                  <Text style={styles.auditDetails}>{log.details}</Text>
                  <Text style={styles.auditActor}>
                    Actor: {log.actorEmail} • Target: {log.targetEmail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  };

  // --- Conditional Root View Rendering ---
  // 1. Unauthenticated -> SignInScreen
  if (!isAuthenticated) {
    return (
      <SignInScreen
        portalName="Verifyyy Superadmin"
        portalRole="superadmin"
        defaultEmail=""
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthenticated(true);
          const authorized = isSuperadminAuthorized(user?.email);
          if (authorized) {
            recordAuthorizedSuperadmin(user?.email, user?.id);
          }
          setIsAuthorized(authorized);
        }}
      />
    );
  }

  // 2. Authenticated BUT Not Authorized as Superadmin -> AccessRestrictedScreen
  if (isAuthenticated && !isAuthorized) {
    return (
      <AccessRestrictedScreen
        user={currentUser}
        onAccessGranted={() => {
          setIsAuthorized(true);
          refreshAccessData();
        }}
        onSignOut={async () => {
          try {
            await signOut();
          } catch (e) {
            console.warn('Sign out error:', e);
          }
          setIsAuthenticated(false);
          setIsAuthorized(false);
          setCurrentUser(null);
        }}
      />
    );
  }

  // 3. Authenticated AND Authorized -> Full Superadmin Management Portal
  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Floating Toast Notification */}
      {copyToast ? (
        <View style={styles.floatingToast}>
          <Text style={styles.floatingToastText}>✓ {copyToast}</Text>
        </View>
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={styles.headerLogo}>Verifyyy</Text>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>SUPERADMIN</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => setActiveTab('dashboard')} style={{ marginRight: 20 }}>
            <Text
              style={{
                color: activeTab === 'dashboard' ? '#ffffff' : '#cbd5e1',
                fontWeight: activeTab === 'dashboard' ? '700' : '500',
              }}
            >
              Dashboard
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('products')} style={{ marginRight: 20 }}>
            <Text
              style={{
                color: activeTab === 'products' ? '#ffffff' : '#cbd5e1',
                fontWeight: activeTab === 'products' ? '700' : '500',
              }}
            >
              Our Products
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setActiveTab('access')}
            style={[styles.accessTabBtn, activeTab === 'access' && styles.accessTabBtnActive]}
          >
            <Text style={{ marginRight: 6 }}>🛡️</Text>
            <Text
              style={{
                color: activeTab === 'access' ? '#0f766e' : '#ffffff',
                fontWeight: '700',
                fontSize: 13,
              }}
            >
              Superadmin Access
            </Text>
            {accessSummary.pendingKeys > 0 && (
              <View style={styles.pendingKeysPill}>
                <Text style={styles.pendingKeysPillText}>{accessSummary.pendingKeys}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileBtn}>
            <Text style={styles.profileBtnText}>
              {currentUser?.email ? currentUser.email.split('@')[0] : 'Admin'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              try {
                await signOut();
              } catch (e) {
                console.warn('Sign out error:', e);
              }
              setIsAuthenticated(false);
              setIsAuthorized(false);
              setCurrentUser(null);
            }}
            style={styles.signOutBtn}
          >
            <Text style={styles.signOutBtnText}>Sign Out ⎋</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'products' && renderOurProducts()}
        {activeTab === 'access' && renderSuperadminAccess()}
      </ScrollView>

      {/* Generated Access Key Success Modal */}
      <Modal visible={!!issuedModalData} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCardContainer}>
            <View style={styles.modalSuccessIcon}>
              <Text style={{ fontSize: 28 }}>🔑</Text>
            </View>
            <Text style={styles.modalHeaderTitle}>Access Key Generated!</Text>
            <Text style={styles.modalHeaderSubtitle}>
              Share this key with <Text style={{ fontWeight: '700', color: COLORS.textMain }}>{issuedModalData?.targetEmail}</Text>.
              They must enter this key when logging in to claim their Superadmin access.
            </Text>

            <View style={styles.keyDisplayCard}>
              <Text style={styles.keyDisplayLabel}>SUPERADMIN ACCESS KEY</Text>
              <Text style={styles.keyDisplayValue}>{issuedModalData?.accessKey}</Text>
              <TouchableOpacity
                style={styles.copyKeyBtn}
                onPress={() => copyText(issuedModalData?.accessKey, 'Access Key copied!')}
              >
                <Text style={styles.copyKeyBtnText}>📋 Copy Key</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.copyInvitationFullBtn}
              onPress={() => {
                const inviteMsg = `Hi! You have been granted Superadmin access to the Verifyyy Management Portal (http://localhost:8081). Log in with your email (${issuedModalData?.targetEmail}) and enter your Access Key: ${issuedModalData?.accessKey} to accept and activate your privileges.`;
                copyText(inviteMsg, 'Full invitation message copied!');
              }}
            >
              <Text style={styles.copyInvitationFullBtnText}>✉️ Copy Complete Invitation Message</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={() => setIssuedModalData(null)}
            >
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  floatingToast: {
    position: 'absolute',
    top: 24,
    alignSelf: 'center',
    zIndex: 99999,
    backgroundColor: '#ffffff',
    borderColor: COLORS.primary,
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  floatingToastText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 13,
  },
  header: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  headerLogo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
    marginRight: 10,
  },
  headerBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  headerBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  accessTabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginRight: 20,
  },
  accessTabBtnActive: {
    backgroundColor: '#ffffff',
  },
  pendingKeysPill: {
    backgroundColor: '#f59e0b',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginLeft: 6,
  },
  pendingKeysPillText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  profileBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
  },
  profileBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  signOutBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  signOutBtnText: {
    color: '#fca5a5',
    fontWeight: '700',
    fontSize: 12,
  },
  scrollContent: {
    padding: 24,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textMain,
    marginBottom: 16,
  },
  statsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  statCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statIcon: {
    fontSize: 24,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  statTitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  detailsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  cardSubtitle: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  linkText: {
    color: COLORS.primary,
    fontWeight: '600',
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 12,
    marginBottom: 12,
  },
  tableCol: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableCell: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textMain,
  },
  cellMain: {
    fontWeight: '600',
  },
  statusBadge: (status) => ({
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: status === 'Active' ? '#dcfce7' : '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  statusText: (status) => ({
    fontSize: 12,
    fontWeight: '600',
    color: status === 'Active' ? '#166534' : '#64748b',
  }),
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyStateText: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  emptyStateSubtext: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  productIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  productIcon: {
    fontSize: 24,
  },
  productInfo: {
    flex: 1,
  },
  productName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textMain,
    marginBottom: 4,
  },
  productUsers: {
    fontSize: 13,
    color: COLORS.textMuted,
  },
  productCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: COLORS.border,
    flex: 1,
    alignItems: 'center',
    textAlign: 'center',
  },
  productCardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textMain,
    marginBottom: 12,
  },
  productCardDesc: {
    fontSize: 14,
    color: COLORS.textMuted,
    marginBottom: 24,
    minHeight: 40,
  },
  btn: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    width: '100%',
  },
  btnText: {
    color: COLORS.primary,
    fontWeight: '700',
    textAlign: 'center',
  },

  // --- ACCESS CONTROL VIEW STYLES ---
  accessViewContainer: {
    gap: 20,
  },
  accessBanner: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 6,
    borderLeftColor: COLORS.primary,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  accessBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  accessBannerShield: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessBannerTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  accessBannerSubtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  accessGateTag: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  accessGateTagText: {
    fontFamily: FONT_FAMILY,
    color: '#047857',
    fontSize: 10,
    fontWeight: '800',
  },
  accessStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  accessStatCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  accessStatVal: {
    fontFamily: FONT_FAMILY,
    fontSize: 26,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  accessStatLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
    marginBottom: 8,
  },
  badgePillActive: {
    alignSelf: 'flex-start',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgePillActiveText: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: '700',
  },
  badgePillPending: {
    alignSelf: 'flex-start',
    backgroundColor: '#fffbeb',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgePillPendingText: {
    color: '#92400e',
    fontSize: 11,
    fontWeight: '700',
  },
  badgePillSuccess: {
    alignSelf: 'flex-start',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgePillSuccessText: {
    color: '#1e40af',
    fontSize: 11,
    fontWeight: '700',
  },
  badgePillStrict: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgePillStrictText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
  },
  accessCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  fieldLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMain,
    marginBottom: 6,
  },
  fieldInput: {
    fontFamily: FONT_FAMILY,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.textMain,
  },
  primaryActionBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionBtnText: {
    fontFamily: FONT_FAMILY,
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  counterBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterBadgeText: {
    fontFamily: FONT_FAMILY,
    color: '#92400e',
    fontSize: 12,
    fontWeight: '700',
  },
  counterBadgeActive: {
    backgroundColor: '#dcfce7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterBadgeActiveText: {
    fontFamily: FONT_FAMILY,
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  tableWrapper: {
    width: '100%',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 10,
    marginBottom: 8,
  },
  colHeader: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableCellText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMain,
  },
  monoKeyText: {
    fontFamily: Platform.select({ web: 'monospace, "Courier New"', default: undefined }),
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
    backgroundColor: '#f0fdfa',
    borderColor: '#ccfbf1',
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  inlineCopyBtn: {
    padding: 4,
  },
  inlineCopyBtnText: {
    fontSize: 14,
  },
  badgePending: {
    alignSelf: 'flex-start',
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgePendingText: {
    fontFamily: FONT_FAMILY,
    color: '#b45309',
    fontSize: 10,
    fontWeight: '800',
  },
  badgeActive: {
    alignSelf: 'flex-start',
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeActiveText: {
    fontFamily: FONT_FAMILY,
    color: '#065f46',
    fontSize: 10,
    fontWeight: '800',
  },
  actionBtnSmall: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  actionBtnSmallText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textMain,
  },
  revokeBtnSmall: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  revokeBtnSmallText: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    fontWeight: '700',
    color: '#dc2626',
  },
  adminAvatarSmall: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminAvatarSmallText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
  },
  selfBadgeText: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.primary,
    fontWeight: '700',
  },
  emptyNotice: {
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyNoticeTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  emptyNoticeDesc: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },
  auditList: {
    gap: 12,
  },
  auditItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  auditIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  auditAction: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  auditTime: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.textMuted,
  },
  auditDetails: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    color: COLORS.textMain,
    marginVertical: 2,
  },
  auditActor: {
    fontFamily: FONT_FAMILY,
    fontSize: 11,
    color: COLORS.textMuted,
  },
  errorBox: {
    backgroundColor: COLORS.dangerBg,
    borderColor: COLORS.dangerBorder,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 14,
  },
  errorText: {
    fontFamily: FONT_FAMILY,
    color: COLORS.danger,
    fontSize: 13,
  },

  // Modal Styles
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCardContainer: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 20,
  },
  modalSuccessIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalHeaderTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textMain,
    marginBottom: 6,
  },
  modalHeaderSubtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  keyDisplayCard: {
    width: '100%',
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  keyDisplayLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: 6,
  },
  keyDisplayValue: {
    fontFamily: Platform.select({ web: 'monospace, "Courier New"', default: undefined }),
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  copyKeyBtn: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  copyKeyBtnText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  copyInvitationFullBtn: {
    width: '100%',
    backgroundColor: '#f1f5f9',
    borderColor: '#cbd5e1',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  copyInvitationFullBtnText: {
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMain,
  },
  modalDoneBtn: {
    width: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalDoneBtnText: {
    fontFamily: FONT_FAMILY,
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
  },
});
