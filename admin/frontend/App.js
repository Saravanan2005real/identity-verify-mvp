import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Dimensions, Modal, Image, ActivityIndicator, Platform, TextInput } from 'react-native';
import SignInScreen from './SignInScreen';
import * as Linking from 'expo-linking';
import { supabase } from './lib/supabase';
import { signOut } from './src/services/auth';

const { width } = Dimensions.get('window');

const isDev = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_BASE_URL || (isDev ? 'http://localhost:5001' : '')
).replace(/\/+$/, '');

const VERIFY_BASE_URL = (
  process.env.EXPO_PUBLIC_VERIFY_BASE_URL || (isDev ? 'http://localhost:5174' : '')
).replace(/\/+$/, '');

const COLORS = {
  primary: '#0f766e', 
  primaryLight: 'rgba(45, 212, 191, 0.15)',
  background: '#f8fafc', 
  card: '#ffffff',
  textMain: '#0f172a',
  textMuted: '#64748b',
  border: 'rgba(203, 213, 225, 0.5)',
  danger: '#ef4444',
  success: '#10b981',
};

const PLACEHOLDER_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140"><rect width="140" height="140" fill="%23f1f5f9" rx="8"/><path d="M40 95 L65 65 L80 82 L95 62 L115 95 Z" fill="%23cbd5e1"/><circle cx="55" cy="50" r="8" fill="%23cbd5e1"/><text x="70" y="120" text-anchor="middle" fill="%2394a3b8" font-size="11" font-family="sans-serif">Unavailable</text></svg>';

function SignedAssetImage({ file, style, placeholderText }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;
    if (!file) {
      setSignedUrl(null);
      setLoading(false);
      return;
    }

    const fetchSignedUrl = async () => {
      setLoading(true);
      setHasError(false);
      try {
        const cleanFile = file.split('?')[0].split('/').pop();
        if (!cleanFile) {
          if (active) { setHasError(true); setLoading(false); }
          return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

        const res = await fetch(`${API_BASE_URL}/api/v1/assets/sign?file=${encodeURIComponent(cleanFile)}`, { headers });
        if (!active) return;

        if (res.status === 403 || res.status === 404 || !res.ok) {
          setHasError(true);
          setSignedUrl(PLACEHOLDER_IMAGE);
          setLoading(false);
          return;
        }

        const data = await res.json();
        const url = data.signed_url || data.url;
        if (url) {
          setSignedUrl(url.startsWith('http') ? url : `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`);
        } else {
          setHasError(true);
          setSignedUrl(PLACEHOLDER_IMAGE);
        }
      } catch (err) {
        if (active) {
          setHasError(true);
          setSignedUrl(PLACEHOLDER_IMAGE);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchSignedUrl();
    return () => { active = false; };
  }, [file]);

  if (loading) {
    return (
      <View style={[style, { backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="small" color="#0f766e" />
      </View>
    );
  }

  if (hasError || !signedUrl) {
    return (
      <Image
        source={{ uri: PLACEHOLDER_IMAGE }}
        style={style}
      />
    );
  }

  return (
    <Image
      source={{ uri: signedUrl }}
      style={style}
      onError={() => { setHasError(true); setSignedUrl(PLACEHOLDER_IMAGE); }}
    />
  );
}

export default function App() {
  const isWeb = width > 768;
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('dashboard');

  // --- Dashboard State ---
  const [stats, setStats] = useState({ pipelines_built: 0, links_generated: 0, verifications_completed: 0 });
  const [recentVerifications, setRecentVerifications] = useState([]);
  const [rawSupabaseRows, setRawSupabaseRows] = useState([]);

  // --- Pipeline Builder & Manage Links State ---
  const [availableModules, setAvailableModules] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  // Refs: keep sync copies so drop handler never reads stale closure values
  const draggedIndexRef = useRef(null);
  const dragOverIndexRef = useRef(null);
  const [savedPipelines, setSavedPipelines] = useState([]);
  const [selectedPipeline, setSelectedPipeline] = useState(null);
  const [pipelineDetailVisible, setPipelineDetailVisible] = useState(false);
  
  const [generatedLink, setGeneratedLink] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // --- Google Forms Hub State ---
  const [formSearchQuery, setFormSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'list'
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest' | 'az' | 'za'
  const [activeMenuPid, setActiveMenuPid] = useState(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(true);

  const copyToClipboard = (text) => {
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    }
  };

  // --- Manual Review State ---
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedReview, setSelectedReview] = useState(null);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  useEffect(() => {
    // 1. Supabase Session Detection
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setCurrentUser(session.user);
        setIsAuthenticated(true);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUser(session.user);
        setIsAuthenticated(true);
      } else {
        setCurrentUser(null);
        setIsAuthenticated(false);
      }
    });

    // Handle deep link authentication (e.g., verifyyy://auth/callback)
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

    // 2. Load local storage persistence
    let localStats = { pipelines_built: 4, links_generated: 4, verifications_completed: 0 };
    let localVers = [];
    let localPipes = [];

    const DEFAULT_PREBUILT_PIPELINES = [
      {
        pid: 'FLOW-ADH01',
        name: 'Aadhaar eKYC Onboarding',
        modules: ['Aadhaar & Face Verification', 'PAN Verification (OCR)'],
        flowParams: 'AADHAAR_FACE,PAN',
        link: 'http://localhost:5174/verify.html?flow=AADHAAR_FACE%2CPAN&pid=FLOW-ADH01',
        created_at: 'Opened 10:45 AM',
        themeColor: '#673ab7'
      },
      {
        pid: 'FLOW-EMP02',
        name: 'Employee Background Check',
        modules: ['Aadhaar & Face Verification', 'Eye Tracking & Attention'],
        flowParams: 'AADHAAR_FACE,EYE_TRACKING',
        link: 'http://localhost:5174/verify.html?flow=AADHAAR_FACE%2CEYE_TRACKING&pid=FLOW-EMP02',
        created_at: 'Opened Yesterday',
        themeColor: '#0f766e'
      },
      {
        pid: 'FLOW-TAX03',
        name: 'Vendor Tax & PAN Audit',
        modules: ['PAN Verification (OCR)', 'Human Review Queue'],
        flowParams: 'PAN,HUMAN_REVIEW',
        link: 'http://localhost:5174/verify.html?flow=PAN%2CHUMAN_REVIEW&pid=FLOW-TAX03',
        created_at: 'Opened Nov 12, 2026',
        themeColor: '#0284c7'
      },
      {
        pid: 'FLOW-BIO04',
        name: 'High-Risk Biometric Liveness',
        modules: ['PAN & Face Verification', 'Eye Tracking & Attention', 'Human Review Queue'],
        flowParams: 'PAN_FACE,EYE_TRACKING,HUMAN_REVIEW',
        link: 'http://localhost:5174/verify.html?flow=PAN_FACE%2CEYE_TRACKING%2CHUMAN_REVIEW&pid=FLOW-BIO04',
        created_at: 'Opened Nov 8, 2026',
        themeColor: '#d97706'
      }
    ];

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedStats = localStorage.getItem('verifyyy_admin_stats');
        if (savedStats) localStats = JSON.parse(savedStats);

        const savedVers = localStorage.getItem('verifyyy_recent_verifications');
        if (savedVers) localVers = JSON.parse(savedVers);

        const savedP = localStorage.getItem('verifyyy_saved_pipelines');
        if (savedP) {
          const parsed = JSON.parse(savedP);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localPipes = parsed;
          }
        }
      }
    } catch (e) {
      console.warn("Could not load from localStorage:", e);
    }

    if (!localPipes || localPipes.length === 0) {
      localPipes = DEFAULT_PREBUILT_PIPELINES;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('verifyyy_saved_pipelines', JSON.stringify(localPipes));
        }
      } catch (e) {}
    }

    setStats(localStats);
    setRecentVerifications(localVers);
    setSavedPipelines(localPipes);

    // 2. Fetch live verifications from Supabase API
    fetchSupabaseData();

    // Available modules for pipeline builder
    setAvailableModules([
      {"id": "AADHAAR_FACE", "name": "Aadhaar & Face Verification", "desc": "Combined Aadhaar Document OCR + Live Face Match & Liveness"},
      {"id": "PAN_FACE", "name": "PAN & Face Verification", "desc": "Combined PAN Card Document OCR + Live Face Match & Liveness"},
      {"id": "PAN", "name": "PAN Verification (OCR)", "desc": "PAN Card OCR Extraction & Verification"},
      {"id": "AADHAAR", "name": "Aadhaar Verification (OCR)", "desc": "Aadhaar Card OCR Extraction & Verification"},
      {"id": "EYE_TRACKING", "name": "Eye Tracking & Attention", "desc": "WebGazer eye tracking calibration"},
      {"id": "HUMAN_REVIEW", "name": "Human Review Queue", "desc": "Manual Human Review Audit Queue"}
    ]);

    return () => {
      authListener?.subscription?.unsubscribe();
      linkSub?.remove?.();
    };
  }, []);

  const fetchSupabaseData = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers = {};
      if (sessionData?.session?.access_token) {
        headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
      }

      const resp = await fetch(`${API_BASE_URL}/api/v1/supabase/list`, { headers });
      const data = await resp.json();
      if (data.status === 'success' && Array.isArray(data.data)) {
        const rows = data.data;
        setRawSupabaseRows(rows);

        const mappedVers = rows.map((r, idx) => {
          const isMatched = (r.face_match_verified === true || r.overall_status === 'SUCCESS');
          const isFailed = (r.overall_status === 'FAILED');
          
          return {
            id: r.session_id ? `APP-${r.session_id.substr(0, 6).toUpperCase()}` : `APP-00${idx + 1}`,
            session_id: r.session_id,
            user: r.extracted_name || r.id_number || `User-${idx + 1}`,
            id_number: r.id_number || 'N/A',
            doc_type: (r.document_type || 'ID').toUpperCase(),
            date: r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            status: isMatched ? 'APPROVED' : (isFailed ? 'REJECTED' : 'APPROVED'),
            matched: isMatched,
            extracted_face_url: r.extracted_face_url || null,
            live_holder_face_url: r.live_holder_face_url || null,
            rawRow: r
          };
        });

        setRecentVerifications(mappedVers);

        // Populate manual review queue with unmatched / flagged items
        const unmatchedItems = mappedVers.filter(v => !v.matched || v.rawRow.overall_status === 'NEEDS_REVIEW');
        setReviewQueue(unmatchedItems.length > 0 ? unmatchedItems : [
          { id: "APP-004", user: "michael.j@example.com", id_number: "8645 3432 5198", doc_type: "AADHAAR", date: "2026-10-08", reason: "Low Confidence Face Match", status: "NEEDS_REVIEW" },
          { id: "APP-005", user: "sarah.w@example.com", id_number: "TJZPS8325D", doc_type: "PAN", date: "2026-10-08", reason: "Unmatched Face Vectors", status: "NEEDS_REVIEW" },
        ]);

        const completedCount = rows.length;
        setStats(prev => {
          const updated = {
            ...prev,
            verifications_completed: Math.max(prev.verifications_completed, completedCount)
          };
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem('verifyyy_admin_stats', JSON.stringify(updated));
            }
          } catch (e) {}
          return updated;
        });
      }
    } catch (err) {
      console.warn("Supabase live fetch error:", err);
    }
  };

  const addModuleToPipeline = (module) => {
    setPipeline([...pipeline, { ...module, uniqueId: Math.random().toString(36).substr(2, 9) }]);
  };

  const removeModuleFromPipeline = (uniqueId) => {
    setPipeline(pipeline.filter(m => m.uniqueId !== uniqueId));
  };

  const moveModule = (fromIndex, toIndex) => {
    if (fromIndex === null || toIndex === null || fromIndex === toIndex) return;
    setPipeline(prev => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  // ── Drag & Drop (real DOM events via <div> so browser fires them correctly) ──
  //
  // dragOverIndex = insertion point (0..pipeline.length), not "hovered card index"
  //   inserting at 0 → before first card
  //   inserting at n → after last card
  //   top half of card i → insertAt = i  (before card i)
  //   bottom half of card i → insertAt = i+1 (after card i)

  const _onDragStart = (e, index) => {
    draggedIndexRef.current = index;
    dragOverIndexRef.current = null;
    setDraggedIndex(index);
    setDragOverIndex(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const _onDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Use currentTarget (the card div) for a stable bounding rect
    const rect = e.currentTarget.getBoundingClientRect();
    const insertAt = e.clientY < rect.top + rect.height / 2 ? index : index + 1;
    if (dragOverIndexRef.current !== insertAt) {
      dragOverIndexRef.current = insertAt;
      setDragOverIndex(insertAt);
    }
  };

  const _onDrop = (e, _index) => {
    e.preventDefault();
    const src = draggedIndexRef.current;
    const insertAt = dragOverIndexRef.current;
    draggedIndexRef.current = null;
    dragOverIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (src !== null && insertAt !== null) {
      // Adjust destination: after removal of src, indices after src shift down by 1
      const dest = insertAt > src ? insertAt - 1 : insertAt;
      if (dest !== src) moveModule(src, dest);
    }
  };

  const _onDragEnd = () => {
    draggedIndexRef.current = null;
    dragOverIndexRef.current = null;
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Helper: should we render the drop indicator before card at `index`?
  const _showDropBefore = (index) =>
    draggedIndex !== null &&
    dragOverIndex === index &&
    dragOverIndex !== draggedIndex &&
    dragOverIndex !== draggedIndex + 1;

  const generateLink = async () => {
    if (pipeline.length === 0) return;

    const flowParams = pipeline.map(m => m.id).join(',');
    const pid = `FLOW-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const origin = VERIFY_BASE_URL || ((typeof window !== 'undefined' && window.location && window.location.hostname && isDev)
      ? `${window.location.protocol}//${window.location.hostname}:5174`
      : (isDev ? 'http://localhost:5174' : ''));

    let applicantToken = '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (sessionData?.session?.access_token) {
        headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
      }
      const tokResp = await fetch(`${API_BASE_URL}/api/v1/auth/applicant_session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pid, flow: flowParams })
      });
      const tokData = await tokResp.json();
      if (tokData.applicant_token) {
        applicantToken = tokData.applicant_token;
      }
    } catch (e) {
      console.warn("Could not generate backend applicant session token:", e);
    }

    const tokenQuery = applicantToken ? `&applicant_token=${encodeURIComponent(applicantToken)}` : '';
    const link = `${origin}/verify.html?flow=${encodeURIComponent(flowParams)}&pid=${pid}${tokenQuery}`;
    setLinkCopied(false);
    setGeneratedLink(link);
    setModalVisible(true);

    const newPipelineObj = {
      pid: pid,
      name: `Pipeline (${pipeline.map(m => m.id).join(', ')})`,
      modules: pipeline.map(m => m.name),
      flowParams: flowParams,
      link: link,
      created_at: new Date().toISOString().split('T')[0],
    };

    setSavedPipelines(prev => {
      const updated = [newPipelineObj, ...prev];
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('verifyyy_saved_pipelines', JSON.stringify(updated));
        }
      } catch (e) {}
      return updated;
    });

    setStats(prev => {
      const updated = {
        ...prev,
        pipelines_built: prev.pipelines_built + 1,
        links_generated: prev.links_generated + 1
      };
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('verifyyy_admin_stats', JSON.stringify(updated));
        }
      } catch (e) {}
      return updated;
    });
  };

  const openGeneratedLink = (targetUrl) => {
    const url = targetUrl || generatedLink;
    if (typeof window !== 'undefined' && window.open) {
      window.open(url, '_blank');
    }
  };

  const handleReviewAction = (action, item) => {
    const target = item || selectedReview;
    if (!target) return;

    setRecentVerifications(prev => prev.map(v => v.id === target.id ? { ...v, status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED' } : v));
    setReviewQueue(prev => prev.filter(v => v.id !== target.id));
    setReviewModalVisible(false);
    setSelectedReview(null);
  };

  const handleCreateBlankForm = () => {
    setPipeline([]);
    setActiveTab('builder');
  };

  const handleLoadTemplate = (moduleIds) => {
    const mods = moduleIds.map(id => {
      const m = availableModules.find(item => item.id === id);
      return m ? { ...m, uniqueId: `${m.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}` } : null;
    }).filter(Boolean);
    setPipeline(mods);
    setActiveTab('builder');
  };

  const handleEditPipeline = (p) => {
    if (!p) return;
    const ids = p.flowParams ? p.flowParams.split(',') : [];
    const mods = ids.map(id => {
      const m = availableModules.find(item => item.id === id);
      return m ? { ...m, uniqueId: `${m.id}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}` } : null;
    }).filter(Boolean);
    setPipeline(mods);
    setActiveTab('builder');
  };

  const handleDeletePipeline = (pidToDelete) => {
    setSavedPipelines(prev => {
      const updated = prev.filter(item => item.pid !== pidToDelete);
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('verifyyy_saved_pipelines', JSON.stringify(updated));
        }
      } catch (e) {}
      return updated;
    });
    setActiveMenuPid(null);
  };

  // --- Render 1: Dashboard (Google Forms Hub) ---
  const renderDashboard = () => {
    // 1. Filter pipelines based on search
    let filteredPipelines = savedPipelines.filter(p => {
      if (!formSearchQuery.trim()) return true;
      const q = formSearchQuery.toLowerCase();
      const name = (p.name || '').toLowerCase();
      const pid = (p.pid || '').toLowerCase();
      return name.includes(q) || pid.includes(q);
    });

    // 2. Sort pipelines
    if (sortOrder === 'az') {
      filteredPipelines = [...filteredPipelines].sort((a, b) => (a.name || a.pid).localeCompare(b.name || b.pid));
    } else if (sortOrder === 'za') {
      filteredPipelines = [...filteredPipelines].sort((a, b) => (b.name || b.pid).localeCompare(a.name || a.pid));
    }

    const TEMPLATES = [
      {
        id: 'aadhaar_ekyc',
        title: 'Aadhaar eKYC',
        color: '#0284c7',
        modules: ['AADHAAR_FACE'],
        subtitle: 'Document OCR & Face'
      },
      {
        id: 'full_suite',
        title: 'Full eKYC Suite',
        color: '#7c3aed',
        modules: ['AADHAAR_FACE', 'PAN_FACE', 'EYE_TRACKING'],
        subtitle: 'Aadhaar, PAN & Biometric'
      },
      {
        id: 'pan_tax',
        title: 'PAN Card Tax ID',
        color: '#059669',
        modules: ['PAN'],
        subtitle: 'PAN OCR Extraction'
      },
      {
        id: 'passport_bio',
        title: 'Passport & Biometrics',
        color: '#ea580c',
        modules: ['AADHAAR_FACE', 'EYE_TRACKING'],
        subtitle: 'Passport & Eye Attention'
      },
      {
        id: 'employee_check',
        title: 'Employee Onboarding',
        color: '#4f46e5',
        modules: ['AADHAAR', 'PAN', 'HUMAN_REVIEW'],
        subtitle: 'Full Compliance Audit'
      }
    ];

    return (
      <View style={{ width: '100%' }}>
        {/* TOP SECTION: Start a new form (Google Forms grey background) */}
        <View style={styles.gfStartSection}>
          <View style={styles.gfSectionInner}>
            <View style={styles.gfSectionHeader}>
              <Text style={styles.gfSectionTitle}>Start a new form</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                <TouchableOpacity
                  onPress={() => setShowTemplateGallery(prev => !prev)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                >
                  <Text style={styles.gfTemplateGalleryBtn}>Template gallery</Text>
                  <Text style={{ fontSize: 13, color: '#5f6368' }}>{showTemplateGallery ? '⇅' : '⇄'}</Text>
                </TouchableOpacity>
                <Text style={{ fontSize: 18, color: '#5f6368', cursor: 'pointer' }}>⋮</Text>
              </View>
            </View>

            {showTemplateGallery && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.gfTemplateCardsRow}
              >
                {/* 1. Blank Form Card */}
                <TouchableOpacity
                  style={styles.gfTemplateCardWrapper}
                  activeOpacity={0.85}
                  onPress={handleCreateBlankForm}
                >
                  <View style={styles.gfBlankCard}>
                    {/* Google 4-color plus icon */}
                    <svg width="44" height="44" viewBox="0 0 44 44">
                      <path fill="#EA4335" d="M22 18v8h10a4 4 0 0 0 0-8H22z"/>
                      <path fill="#4285F4" d="M18 12a4 4 0 0 1 8 0v10h-8V12z"/>
                      <path fill="#FBBC05" d="M12 18a4 4 0 0 0 0 8h10v-8H12z"/>
                      <path fill="#34A853" d="M18 22h8v10a4 4 0 0 1-8 0V22z"/>
                    </svg>
                  </View>
                  <Text style={styles.gfTemplateTitle}>Blank form</Text>
                </TouchableOpacity>

                {/* 2-6. Pre-configured Templates */}
                {TEMPLATES.map(tpl => (
                  <TouchableOpacity
                    key={tpl.id}
                    style={styles.gfTemplateCardWrapper}
                    activeOpacity={0.85}
                    onPress={() => handleLoadTemplate(tpl.modules)}
                  >
                    <View style={styles.gfTemplateCard}>
                      {/* Top banner */}
                      <View style={[styles.gfTemplateBanner, { backgroundColor: tpl.color }]} />
                      {/* Miniature mockup body */}
                      <View style={styles.gfTemplateMockBody}>
                        <View style={[styles.gfMockTitleLine, { backgroundColor: tpl.color }]} />
                        <View style={styles.gfMockSubtitleLine} />
                        <View style={styles.gfMockQuestionBox}>
                          <View style={styles.gfMockQuestionHeader} />
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                            <View style={[styles.gfMockRadio, { borderColor: tpl.color }]} />
                            <View style={{ width: 40, height: 3, backgroundColor: '#cbd5e1', borderRadius: 2 }} />
                          </View>
                        </View>
                        <View style={styles.gfMockInputOutline} />
                      </View>
                    </View>
                    <Text style={styles.gfTemplateTitle} numberOfLines={1}>{tpl.title}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </View>

        {/* BOTTOM SECTION: Recent forms */}
        <View style={styles.gfRecentSection}>
          <View style={styles.gfSectionInner}>
            <View style={styles.gfSectionHeader}>
              <Text style={styles.gfSectionTitle}>Recent forms</Text>
              
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                {/* Owned by anyone dropdown */}
                <TouchableOpacity style={styles.gfFilterDropdown}>
                  <Text style={styles.gfFilterText}>Owned by anyone</Text>
                  <Text style={{ fontSize: 11, color: '#5f6368', marginLeft: 4 }}>▾</Text>
                </TouchableOpacity>

                {/* View Mode Toggle: Grid / List */}
                <View style={styles.gfViewToggleGroup}>
                  <TouchableOpacity
                    onPress={() => setViewMode('grid')}
                    style={[styles.gfToggleBtn, viewMode === 'grid' && styles.gfToggleBtnActive]}
                  >
                    <Text style={{ fontSize: 15, color: viewMode === 'grid' ? '#202124' : '#5f6368' }}>▦</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setViewMode('list')}
                    style={[styles.gfToggleBtn, viewMode === 'list' && styles.gfToggleBtnActive]}
                  >
                    <Text style={{ fontSize: 15, color: viewMode === 'list' ? '#202124' : '#5f6368' }}>☰</Text>
                  </TouchableOpacity>
                </View>

                {/* Sort Order Button */}
                <TouchableOpacity
                  onPress={() => setSortOrder(prev => prev === 'newest' ? 'az' : prev === 'az' ? 'za' : 'newest')}
                  style={styles.gfIconBtn}
                >
                  <Text style={{ fontSize: 13, color: '#5f6368', fontWeight: '700' }}>
                    {sortOrder === 'az' ? 'A-Z ↑' : sortOrder === 'za' ? 'Z-A ↓' : 'A-Z ⇅'}
                  </Text>
                </TouchableOpacity>

                {/* Folder Icon */}
                <TouchableOpacity style={styles.gfIconBtn}>
                  <Text style={{ fontSize: 16 }}>📁</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* If Search Active, show search feedback */}
            {formSearchQuery.trim() !== '' && (
              <View style={{ marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 13, color: '#5f6368' }}>
                  Showing {filteredPipelines.length} results for "{formSearchQuery}"
                </Text>
                <TouchableOpacity onPress={() => setFormSearchQuery('')}>
                  <Text style={{ fontSize: 12, color: COLORS.primary, fontWeight: '700' }}>Clear Search ✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Grid of Form Cards */}
            {viewMode === 'grid' && (
              <View style={styles.gfFormsGrid}>
                {filteredPipelines.map((p, idx) => {
                  const cardColor = p.themeColor || (idx % 4 === 0 ? '#673ab7' : idx % 4 === 1 ? '#0f766e' : idx % 4 === 2 ? '#0284c7' : '#d97706');
                  const isMenuOpen = activeMenuPid === p.pid;

                  return (
                    <View key={p.pid || idx} style={styles.gfFormCard}>
                      {/* Top Preview Banner (clickable -> opens test link or builder) */}
                      <TouchableOpacity
                        style={styles.gfCardPreview}
                        activeOpacity={0.85}
                        onPress={() => openGeneratedLink(p.link)}
                      >
                        {/* Accent Header Stripe */}
                        <View style={[styles.gfCardPreviewStripe, { backgroundColor: cardColor }]} />
                        {/* Mockup Form Paper */}
                        <View style={styles.gfMockPaper}>
                          <View style={[styles.gfMockPaperTitle, { backgroundColor: cardColor }]} />
                          <View style={styles.gfMockPaperSub} />
                          <View style={styles.gfMockPaperCard}>
                            <View style={styles.gfMockPaperFieldLine} />
                            <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 4 }}>
                              <View style={[styles.gfMockPaperRadioDot, { backgroundColor: cardColor }]} />
                              <View style={{ width: 45, height: 3, backgroundColor: '#cbd5e1', borderRadius: 2 }} />
                            </View>
                          </View>
                          <View style={styles.gfMockPaperInput} />
                        </View>

                        {/* Module count pill in preview */}
                        <View style={styles.gfCardModuleBadge}>
                          <Text style={styles.gfCardModuleBadgeText}>
                            {Array.isArray(p.modules) ? `${p.modules.length} Modules` : 'eKYC Flow'}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {/* Bottom Info Footer */}
                      <View style={styles.gfCardFooter}>
                        {/* Form Title */}
                        <TouchableOpacity onPress={() => openGeneratedLink(p.link)}>
                          <Text style={styles.gfCardTitle} numberOfLines={1}>
                            {p.name || p.pid || 'Untitled form'}
                          </Text>
                        </TouchableOpacity>

                        {/* Sub Row: Icon + Opened Date + 3-dots Menu */}
                        <View style={styles.gfCardSubRow}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                            {/* Purple Google Forms Icon */}
                            <svg width="16" height="16" viewBox="0 0 16 16">
                              <rect width="16" height="16" rx="3" fill="#7248B9"/>
                              <rect x="3.5" y="4.5" width="3" height="1.5" rx="0.75" fill="#ffffff"/>
                              <rect x="7.5" y="4.5" width="5" height="1.5" rx="0.75" fill="#ffffff"/>
                              <rect x="3.5" y="7.5" width="3" height="1.5" rx="0.75" fill="#ffffff"/>
                              <rect x="7.5" y="7.5" width="5" height="1.5" rx="0.75" fill="#ffffff"/>
                              <rect x="3.5" y="10.5" width="3" height="1.5" rx="0.75" fill="#ffffff"/>
                              <rect x="7.5" y="10.5" width="5" height="1.5" rx="0.75" fill="#ffffff"/>
                            </svg>
                            <Text style={{ fontSize: 11, color: '#5f6368' }}>👥</Text>
                            <Text style={styles.gfCardOpenedText} numberOfLines={1}>
                              {p.created_at ? (p.created_at.startsWith('Opened') ? p.created_at : `Opened ${p.created_at}`) : 'Opened recently'}
                            </Text>
                          </View>

                          {/* 3-dots Action Menu Button */}
                          <TouchableOpacity
                            style={styles.gfCardMenuBtn}
                            onPress={() => setActiveMenuPid(isMenuOpen ? null : p.pid)}
                          >
                            <Text style={{ fontSize: 18, color: '#5f6368', fontWeight: 'bold', lineHeight: 18 }}>⋮</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* Dropdown Menu Popup when 3-dots clicked */}
                      {isMenuOpen && (
                        <View style={styles.gfActionDropdown}>
                          <TouchableOpacity
                            style={styles.gfDropdownItem}
                            onPress={() => { openGeneratedLink(p.link); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.gfDropdownItemText}>🚀 Open / Test Form</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.gfDropdownItem}
                            onPress={() => { copyToClipboard(p.link); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.gfDropdownItemText}>📋 Copy Link</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.gfDropdownItem}
                            onPress={() => { handleEditPipeline(p); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.gfDropdownItemText}>✏️ Edit in Builder</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.gfDropdownItem}
                            onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.gfDropdownItemText}>📊 View Applicants & Stats</Text>
                          </TouchableOpacity>

                          <View style={{ height: 1, backgroundColor: '#f1f5f9', marginVertical: 4 }} />

                          <TouchableOpacity
                            style={styles.gfDropdownItem}
                            onPress={() => handleDeletePipeline(p.pid)}
                          >
                            <Text style={[styles.gfDropdownItemText, { color: COLORS.danger }]}>🗑️ Delete Form</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* List View */}
            {viewMode === 'list' && (
              <View style={styles.gfListViewContainer}>
                <View style={styles.gfListHeader}>
                  <Text style={[styles.gfListCol, { flex: 2.5 }]}>Name</Text>
                  <Text style={[styles.gfListCol, { flex: 2 }]}>Configured Modules</Text>
                  <Text style={[styles.gfListCol, { flex: 1.5 }]}>Last Opened</Text>
                  <Text style={[styles.gfListCol, { flex: 1.5, textAlign: 'right' }]}>Actions</Text>
                </View>

                {filteredPipelines.map((p, idx) => (
                  <View key={p.pid || idx} style={styles.gfListRow}>
                    <TouchableOpacity
                      style={{ flex: 2.5, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                      onPress={() => openGeneratedLink(p.link)}
                    >
                      <svg width="22" height="22" viewBox="0 0 22 22">
                        <rect width="22" height="22" rx="4" fill="#7248B9"/>
                        <rect x="5" y="6" width="4" height="2" rx="1" fill="#ffffff"/>
                        <rect x="10.5" y="6" width="6.5" height="2" rx="1" fill="#ffffff"/>
                        <rect x="5" y="10" width="4" height="2" rx="1" fill="#ffffff"/>
                        <rect x="10.5" y="10" width="6.5" height="2" rx="1" fill="#ffffff"/>
                        <rect x="5" y="14" width="4" height="2" rx="1" fill="#ffffff"/>
                        <rect x="10.5" y="14" width="6.5" height="2" rx="1" fill="#ffffff"/>
                      </svg>
                      <Text style={styles.gfListTitle} numberOfLines={1}>{p.name || p.pid}</Text>
                    </TouchableOpacity>

                    <Text style={[styles.gfListSubText, { flex: 2 }]} numberOfLines={1}>
                      {Array.isArray(p.modules) ? p.modules.join(', ') : p.name}
                    </Text>

                    <Text style={[styles.gfListSubText, { flex: 1.5 }]}>
                      {p.created_at || 'Recently'}
                    </Text>

                    <View style={{ flex: 1.5, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                      <TouchableOpacity style={styles.btnSmall} onPress={() => openGeneratedLink(p.link)}>
                        <Text style={styles.btnSmallText}>Test 🚀</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btnSmall, { backgroundColor: '#f1f5f9' }]} onPress={() => handleEditPipeline(p)}>
                        <Text style={[styles.btnSmallText, { color: COLORS.textMain }]}>Edit ✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btnSmall, { backgroundColor: '#f1f5f9' }]} onPress={() => copyToClipboard(p.link)}>
                        <Text style={[styles.btnSmallText, { color: COLORS.textMain }]}>Copy 📋</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {filteredPipelines.length === 0 && (
              <View style={styles.gfEmptyState}>
                <Text style={{ fontSize: 32, marginBottom: 12 }}>📄</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.textMain, marginBottom: 6 }}>
                  No verification forms found
                </Text>
                <Text style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 16 }}>
                  Click "Blank form" above to create and configure your first verification pipeline.
                </Text>
                <TouchableOpacity style={styles.btn} onPress={handleCreateBlankForm}>
                  <Text style={styles.btnText}>+ Create Blank Form</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* LIVE VERIFICATION APPLICANTS & USAGE SECTION */}
            <View style={[styles.card, { marginTop: 40 }]}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Live Verification Activity & Applicant Monitoring</Text>
                <Text style={{ color: COLORS.textMuted }}>
                  Track incoming submissions from your active verification forms in real time.
                </Text>
              </View>

              {/* Stats Counters */}
              <View style={styles.statsContainer}>
                <View style={styles.statCard}>
                  <Text style={styles.statTitle}>Pipelines Built</Text>
                  <Text style={styles.statValue}>{stats.pipelines_built || savedPipelines.length}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statTitle}>Links Generated</Text>
                  <Text style={styles.statValue}>{stats.links_generated || savedPipelines.length}</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statTitle}>Verifications Run</Text>
                  <Text style={styles.statValue}>{stats.verifications_completed || recentVerifications.length}</Text>
                </View>
              </View>

              {/* Applicants Table */}
              <View style={styles.tableHeader}>
                <Text style={[styles.tableCol, { flex: 1 }]}>Application ID</Text>
                <Text style={[styles.tableCol, { flex: 2 }]}>Applicant Name</Text>
                <Text style={[styles.tableCol, { flex: 1.5 }]}>ID / Document #</Text>
                <Text style={[styles.tableCol, { flex: 1 }]}>Date</Text>
                <Text style={[styles.tableCol, { flex: 1 }]}>Status</Text>
              </View>

              {recentVerifications.map((v, i) => (
                <View style={styles.tableRow} key={i}>
                  <Text style={[styles.tableCell, { flex: 1, fontWeight: '600', fontFamily: 'monospace' }]}>{v.id}</Text>
                  <Text style={[styles.tableCell, { flex: 2, fontWeight: '600' }]}>{v.user}</Text>
                  <Text style={[styles.tableCell, { flex: 1.5, color: COLORS.primary, fontFamily: 'monospace' }]}>{v.id_number}</Text>
                  <Text style={[styles.tableCell, { flex: 1 }]}>{v.date}</Text>
                  <View style={styles.statusBadge(v.status)}>
                    <Text style={styles.statusText(v.status)}>{v.status}</Text>
                  </View>
                </View>
              ))}

              {recentVerifications.length === 0 && (
                <Text style={{ textAlign: 'center', marginTop: 20, color: COLORS.textMuted }}>
                  No recent verifications found. Submissions from your forms will appear here.
                </Text>
              )}
            </View>

          </View>
        </View>
      </View>
    );
  };

  // --- Render 2: Pipeline Builder ---
  const renderBuilder = () => (
    <View style={{ flexDirection: isWeb ? 'row' : 'column', gap: 32 }}>
        <View style={[styles.card, { flex: 1 }]}>
            <Text style={styles.cardTitle}>Available Modules</Text>
            <Text style={{color: COLORS.textMuted, marginBottom: 20}}>Click to add to your pipeline.</Text>
            
            {availableModules.map(mod => (
                <TouchableOpacity key={mod.id} style={styles.moduleItem} onPress={() => addModuleToPipeline(mod)}>
                    <View style={{flex: 1}}>
                        <Text style={styles.moduleName}>{mod.name}</Text>
                        <Text style={styles.moduleDesc}>{mod.desc}</Text>
                    </View>
                    <Text style={{fontSize: 24, color: COLORS.primary}}>+</Text>
                </TouchableOpacity>
            ))}
        </View>

        <View style={[styles.card, { flex: 2 }]}>
            {/* Header */}
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16}}>
                <Text style={styles.cardTitle}>Your Pipeline Canvas</Text>
                {pipeline.length > 1 && (
                    <View style={{flexDirection: 'row', alignItems: 'center', gap: 6,
                        backgroundColor: 'rgba(45,212,191,0.1)', paddingHorizontal: 10,
                        paddingVertical: 4, borderRadius: 20}}>
                        <Text style={{fontSize: 12}}>✋</Text>
                        <Text style={{fontSize: 11, color: COLORS.primary, fontWeight: '600'}}>
                            Drag to reorder
                        </Text>
                    </View>
                )}
            </View>

            {/* Canvas area */}
            <View style={[
                styles.pipelineCanvas,
                draggedIndex !== null && {
                    borderColor: 'rgba(45,212,191,0.6)',
                    backgroundColor: 'rgba(240,253,250,0.9)',
                }
            ]}>
                {pipeline.length === 0 ? (
                    <View style={styles.canvasEmpty}>
                        <Text style={{fontSize: 32, marginBottom: 8}}>📋</Text>
                        <Text style={{color: COLORS.textMuted, textAlign: 'center', fontWeight: '600'}}>
                            Your pipeline is empty
                        </Text>
                        <Text style={{color: COLORS.textMuted, textAlign: 'center', fontSize: 12, marginTop: 4}}>
                            Click modules on the left to add them
                        </Text>
                    </View>
                ) : (
                    <div style={{ width: '100%' }}>
                        {/* Inject hover CSS once */}
                        <style>{`
                            .pipe-card { transition: box-shadow 0.15s ease, transform 0.1s ease, opacity 0.15s ease; }
                            .pipe-card:hover:not(.pipe-dragging) { box-shadow: 0 6px 20px rgba(15,118,110,0.15) !important; transform: translateY(-1px); }
                            .pipe-remove:hover { background: rgba(239,68,68,0.2) !important; transform: scale(1.1); }
                            .pipe-remove { transition: background 0.15s ease, transform 0.15s ease; }
                        `}</style>

                        {pipeline.map((mod, index) => (
                            <React.Fragment key={mod.uniqueId}>

                                {/* ── Drop indicator line before this card ── */}
                                {_showDropBefore(index) && (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        margin: '4px 0',
                                    }}>
                                        <div style={{ width: 8, height: 8, borderRadius: 4, background: '#0f766e', flexShrink: 0 }} />
                                        <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, #0f766e, #2dd4bf)', borderRadius: 1, boxShadow: '0 0 6px rgba(15,118,110,0.4)' }} />
                                        <div style={{ width: 8, height: 8, borderRadius: 4, background: '#2dd4bf', flexShrink: 0 }} />
                                    </div>
                                )}

                                {/* ── Draggable card ── */}
                                <div
                                    className={`pipe-card${draggedIndex === index ? ' pipe-dragging' : ''}`}
                                    draggable={true}
                                    onDragStart={(e) => _onDragStart(e, index)}
                                    onDragOver={(e) => _onDragOver(e, index)}
                                    onDrop={(e) => _onDrop(e, index)}
                                    onDragEnd={_onDragEnd}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 12,
                                        background: draggedIndex === index
                                            ? 'rgba(240,253,250,0.6)'
                                            : '#fff',
                                        opacity: draggedIndex === index ? 0.3 : 1,
                                        border: draggedIndex === index
                                            ? '2px dashed #2dd4bf'
                                            : '1.5px solid rgba(45,212,191,0.3)',
                                        borderLeft: draggedIndex === index
                                            ? '2px dashed #2dd4bf'
                                            : '4px solid #0f766e',
                                        borderRadius: 12,
                                        padding: '14px 16px 14px 12px',
                                        cursor: draggedIndex !== null ? 'grabbing' : 'grab',
                                        userSelect: 'none',
                                        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                                        boxSizing: 'border-box',
                                        width: '100%',
                                        marginBottom: 0,
                                    }}
                                >
                                    {/* ── 2×3 dot grip handle ── */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '4px 4px',
                                        gridTemplateRows: '4px 4px 4px',
                                        gap: 3,
                                        cursor: 'grab',
                                        flexShrink: 0,
                                        padding: '2px 4px',
                                        opacity: 0.35,
                                    }}>
                                        {[0,1,2,3,4,5].map(i => (
                                            <div key={i} style={{ width: 4, height: 4, borderRadius: 2, background: '#475569' }} />
                                        ))}
                                    </div>

                                    {/* ── Step badge (gradient circle) ── */}
                                    <div style={{
                                        minWidth: 30,
                                        height: 30,
                                        borderRadius: 15,
                                        background: 'linear-gradient(135deg, #0f766e 0%, #2dd4bf 100%)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                        boxShadow: '0 2px 6px rgba(15,118,110,0.3)',
                                    }}>
                                        <span style={{
                                            color: '#fff',
                                            fontSize: 12,
                                            fontWeight: 800,
                                            lineHeight: 1,
                                            fontFamily: 'system-ui, sans-serif',
                                        }}>{index + 1}</span>
                                    </div>

                                    {/* ── Module name + description ── */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontWeight: 700,
                                            color: '#0f172a',
                                            fontSize: 14,
                                            lineHeight: '20px',
                                            fontFamily: 'system-ui, -apple-system, sans-serif',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}>{mod.name}</div>
                                        {mod.desc && (
                                            <div style={{
                                                color: '#94a3b8',
                                                fontSize: 11,
                                                marginTop: 2,
                                                lineHeight: '16px',
                                                fontFamily: 'system-ui, -apple-system, sans-serif',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}>{mod.desc}</div>
                                        )}
                                    </div>

                                    {/* ── Remove button ── */}
                                    <button
                                        className="pipe-remove"
                                        onClick={(e) => { e.stopPropagation(); removeModuleFromPipeline(mod.uniqueId); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        style={{
                                            width: 30,
                                            height: 30,
                                            borderRadius: 15,
                                            border: 'none',
                                            background: 'rgba(239,68,68,0.08)',
                                            color: '#ef4444',
                                            fontSize: 20,
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            lineHeight: 1,
                                            paddingBottom: 1,
                                        }}
                                    >×</button>
                                </div>

                                {/* ── Flow arrow connector (only while NOT dragging) ── */}
                                {index < pipeline.length - 1 && draggedIndex === null && (
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '2px auto' }}>
                                        <div style={{ width: 2, height: 14, background: 'linear-gradient(to bottom, rgba(45,212,191,0.4), #0f766e)' }} />
                                        <div style={{
                                            width: 0, height: 0,
                                            borderLeft: '5px solid transparent',
                                            borderRight: '5px solid transparent',
                                            borderTop: '7px solid #0f766e',
                                        }} />
                                    </div>
                                )}

                            </React.Fragment>
                        ))}

                        {/* ── Drop indicator after the last card ── */}
                        {draggedIndex !== null &&
                         dragOverIndex === pipeline.length &&
                         dragOverIndex !== draggedIndex &&
                         dragOverIndex !== draggedIndex + 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0' }}>
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: '#0f766e', flexShrink: 0 }} />
                                <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg, #0f766e, #2dd4bf)', borderRadius: 1, boxShadow: '0 0 6px rgba(15,118,110,0.4)' }} />
                                <div style={{ width: 8, height: 8, borderRadius: 4, background: '#2dd4bf', flexShrink: 0 }} />
                            </div>
                        )}

                        {/* ── Invisible bottom drop zone (drop onto empty space below cards) ── */}
                        {draggedIndex !== null && (
                            <div
                                style={{ height: 32, width: '100%' }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    const dest = pipeline.length;
                                    if (dragOverIndexRef.current !== dest) {
                                        dragOverIndexRef.current = dest;
                                        setDragOverIndex(dest);
                                    }
                                }}
                                onDrop={(e) => _onDrop(e, pipeline.length - 1)}
                            />
                        )}
                    </div>
                )}
            </View>

            <View style={styles.actionArea}>
                <TouchableOpacity style={styles.btnOutline} onPress={() => setPipeline([])}>
                    <Text style={styles.btnOutlineText}>Clear Canvas</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.btn, pipeline.length === 0 && {opacity: 0.5}]} 
                    disabled={pipeline.length === 0}
                    onPress={generateLink}
                >
                    <Text style={styles.btnText}>Generate Verification Link 🚀</Text>
                </TouchableOpacity>
            </View>
        </View>
    </View>
  );

  // --- Render 3: Manage Links (Pipelines Manager) ---
  const renderManageLinks = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Manage Generated Pipeline Links</Text>
      <Text style={{color: COLORS.textMuted, marginBottom: 24}}>
        Click on any pipeline link to inspect applicant usage, PAN/Aadhaar details, and face match results.
      </Text>

      <View style={styles.tableHeader}>
        <Text style={[styles.tableCol, { flex: 1 }]}>Pipeline ID</Text>
        <Text style={[styles.tableCol, { flex: 2 }]}>Configured Modules</Text>
        <Text style={[styles.tableCol, { flex: 1 }]}>Applicants Count</Text>
        <Text style={[styles.tableCol, { flex: 1.5 }]}>Actions</Text>
      </View>

      {savedPipelines.map((p, idx) => (
        <View style={styles.tableRow} key={idx}>
          <Text style={[styles.tableCell, { flex: 1, fontWeight: '700', fontFamily: 'monospace', color: COLORS.primary }]}>{p.pid}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{Array.isArray(p.modules) ? p.modules.join(', ') : p.name}</Text>
          <Text style={[styles.tableCell, { flex: 1, fontWeight: '800' }]}>{recentVerifications.length} Applicants</Text>
          <View style={{flexDirection: 'row', gap: 8, flex: 1.5}}>
            <TouchableOpacity style={styles.btnSmall} onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}>
              <Text style={styles.btnSmallText}>View Analytics & Applicants 📊</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnSmall, {backgroundColor: '#f1f5f9'}]} onPress={() => openGeneratedLink(p.link)}>
              <Text style={[styles.btnSmallText, {color: COLORS.textMain}]}>Test Link 🚀</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {savedPipelines.length === 0 && (
        <View style={{padding: 30, alignItems: 'center'}}>
          <Text style={{color: COLORS.textMuted, marginBottom: 12}}>No generated pipelines yet.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => setActiveTab('builder')}>
            <Text style={styles.btnText}>Build Your First Pipeline</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // --- Render 4: Manual Review Queue ---
  const renderReviewQueue = () => (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Manual Human Review Queue</Text>
      <Text style={{color: COLORS.textMuted, marginBottom: 24}}>
        Applicants with unmatched face vectors or low confidence are automatically held here for admin manual review.
      </Text>

      <View style={styles.tableHeader}>
        <Text style={[styles.tableCol, { flex: 1 }]}>Application ID</Text>
        <Text style={[styles.tableCol, { flex: 2 }]}>User / Name</Text>
        <Text style={[styles.tableCol, { flex: 1.5 }]}>ID / Document #</Text>
        <Text style={[styles.tableCol, { flex: 1 }]}>Status</Text>
        <Text style={[styles.tableCol, { flex: 1 }]}>Action</Text>
      </View>

      {reviewQueue.map((item, idx) => (
        <View style={styles.tableRow} key={idx}>
          <Text style={[styles.tableCell, { flex: 1, fontWeight: '700', fontFamily: 'monospace' }]}>{item.id}</Text>
          <Text style={[styles.tableCell, { flex: 2 }]}>{item.user}</Text>
          <Text style={[styles.tableCell, { flex: 1.5, color: COLORS.primary, fontFamily: 'monospace' }]}>{item.id_number || 'N/A'}</Text>
          <View style={styles.statusBadge('NEEDS_REVIEW')}>
            <Text style={styles.statusText('NEEDS_REVIEW')}>NEEDS REVIEW</Text>
          </View>
          <View style={{flex: 1, alignItems: 'flex-end'}}>
            <TouchableOpacity style={styles.btnSmall} onPress={() => { setSelectedReview(item); setReviewModalVisible(true); }}>
              <Text style={styles.btnSmallText}>Review Face Match 🔍</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {reviewQueue.length === 0 && (
        <Text style={{textAlign: 'center', marginVertical: 30, color: COLORS.success, fontWeight: '700'}}>
          ✅ Manual review queue is clear! All applicants passed automated verification.
        </Text>
      )}
    </View>
  );

  if (!isAuthenticated) {
    return (
      <SignInScreen
        portalName="Verifyyy Client Admin"
        portalRole="admin"
        defaultEmail="admin@verifyyy.ai"
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Google Forms Styled Header */}
      <View style={styles.header}>
        {/* Left: Hamburger + Forms Document Logo + Title */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity style={styles.gfMenuBtn}>
            <Text style={{ fontSize: 20, color: '#5f6368', lineHeight: 20 }}>☰</Text>
          </TouchableOpacity>

          {/* Purple Forms Document Icon */}
          <svg width="36" height="36" viewBox="0 0 36 36">
            <rect width="36" height="36" rx="7" fill="#7248B9"/>
            <rect x="8" y="10" width="7" height="3" rx="1.5" fill="#ffffff"/>
            <rect x="18" y="10" width="10" height="3" rx="1.5" fill="#ffffff"/>
            <rect x="8" y="16" width="7" height="3" rx="1.5" fill="#ffffff"/>
            <rect x="18" y="16" width="10" height="3" rx="1.5" fill="#ffffff"/>
            <rect x="8" y="22" width="7" height="3" rx="1.5" fill="#ffffff"/>
            <rect x="18" y="22" width="10" height="3" rx="1.5" fill="#ffffff"/>
          </svg>

          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={styles.headerLogo}>Verifyyy Admin</Text>
            <Text style={{ fontSize: 20, color: '#5f6368', fontWeight: '400' }}>Forms</Text>
          </View>
        </View>

        {/* Center: Google Search Bar */}
        <View style={styles.gfSearchContainer}>
          <Text style={{ fontSize: 16, color: '#5f6368', marginRight: 10 }}>🔍</Text>
          <TextInput
            style={styles.gfSearchInput}
            placeholder="Search forms"
            placeholderTextColor="#5f6368"
            value={formSearchQuery}
            onChangeText={setFormSearchQuery}
          />
          {formSearchQuery ? (
            <TouchableOpacity onPress={() => setFormSearchQuery('')}>
              <Text style={{ fontSize: 14, color: '#5f6368', paddingHorizontal: 6 }}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Right: Navigation Tabs + Apps Icon + Avatar + Sign Out */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            onPress={() => setActiveTab('dashboard')}
            style={[styles.gfTabBtn, activeTab === 'dashboard' && styles.gfTabBtnActive]}
          >
            <Text style={[styles.gfTabText, activeTab === 'dashboard' && styles.gfTabTextActive]}>Dashboard</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('builder')}
            style={[styles.gfTabBtn, activeTab === 'builder' && styles.gfTabBtnActive]}
          >
            <Text style={[styles.gfTabText, activeTab === 'builder' && styles.gfTabTextActive]}>Pipeline Builder</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('links')}
            style={[styles.gfTabBtn, activeTab === 'links' && styles.gfTabBtnActive]}
          >
            <Text style={[styles.gfTabText, activeTab === 'links' && styles.gfTabTextActive]}>Manage Links</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('review')}
            style={[styles.gfTabBtn, activeTab === 'review' && styles.gfTabBtnActive]}
          >
            <Text style={[styles.gfTabText, activeTab === 'review' && styles.gfTabTextActive]}>
              Manual Review {reviewQueue.length > 0 ? `(${reviewQueue.length})` : ''}
            </Text>
          </TouchableOpacity>

          {/* 9 Dots Google Apps icon */}
          <TouchableOpacity style={styles.gfAppsBtn}>
            <Text style={{ fontSize: 18, color: '#5f6368', lineHeight: 18 }}>⠿</Text>
          </TouchableOpacity>

          {/* User Profile Avatar */}
          <View style={styles.gfAvatarCircle}>
            <Text style={styles.gfAvatarText}>
              {(currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'S')}
            </Text>
          </View>

          {/* Sign Out Button */}
          <TouchableOpacity 
            onPress={async () => {
              try {
                await signOut();
              } catch (e) {
                console.warn("Sign out error:", e);
              }
              setIsAuthenticated(false);
              setCurrentUser(null);
            }} 
            style={styles.signOutBtn}
          >
            <Text style={styles.signOutBtnText}>Sign Out ⎋</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={activeTab === 'dashboard' ? styles.gfDashboardScroll : styles.scrollContent}>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'builder' && renderBuilder()}
          {activeTab === 'links' && renderManageLinks()}
          {activeTab === 'review' && renderReviewQueue()}
      </ScrollView>

      {/* Generated Link Modal */}
      <Modal visible={modalVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>Pipeline Link Ready! 🎉</Text>
                  <Text style={{color: COLORS.textMuted, textAlign: 'center', marginBottom: 20}}>
                      Your custom verification flow link has been generated. Anyone opening this link will execute your configured pipeline steps in sequence.
                  </Text>
                  <View style={styles.linkBox}>
                      <Text
                        selectable={true}
                        style={styles.linkText}
                        onPress={() => copyToClipboard(generatedLink)}
                      >
                        {generatedLink}
                      </Text>
                  </View>
                  
                  <View style={{flexDirection: 'row', gap: 10, width: '100%', marginBottom: 12}}>
                      <TouchableOpacity
                        style={[styles.btn, {flex: 1, backgroundColor: linkCopied ? '#059669' : '#0f766e', marginBottom: 0}]}
                        onPress={() => copyToClipboard(generatedLink)}
                      >
                          <Text style={styles.btnText}>{linkCopied ? 'Copied! ✓' : '📋 Copy Link'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.btn, {flex: 1, backgroundColor: '#0f766e', marginBottom: 0}]}
                        onPress={() => openGeneratedLink()}
                      >
                          <Text style={styles.btnText}>Open Flow 🚀</Text>
                      </TouchableOpacity>
                  </View>

                  <TouchableOpacity style={styles.btnOutline} onPress={() => setModalVisible(false)}>
                      <Text style={styles.btnOutlineText}>Close</Text>
                  </TouchableOpacity>
              </View>
          </View>
      </Modal>

      {/* Pipeline Analytics & Applicant List Modal */}
      <Modal visible={pipelineDetailVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxWidth: 900 }]}>
                  <Text style={styles.modalTitle}>Pipeline Analytics: {selectedPipeline?.pid}</Text>
                  <Text style={{color: COLORS.textMuted, textAlign: 'center', marginBottom: 20}}>
                      Detailed applicant tracking for link: <Text style={{fontFamily: 'monospace', color: COLORS.primary, ...(Platform.OS === 'web' ? { wordBreak: 'break-all', overflowWrap: 'anywhere' } : {})}}>{selectedPipeline?.link}</Text>
                  </Text>

                  <View style={{width: '100%', marginBottom: 20}}>
                    <View style={styles.tableHeader}>
                      <Text style={[styles.tableCol, { flex: 1.5 }]}>Applicant Name</Text>
                      <Text style={[styles.tableCol, { flex: 1.5 }]}>Document / ID #</Text>
                      <Text style={[styles.tableCol, { flex: 1 }]}>Doc Type</Text>
                      <Text style={[styles.tableCol, { flex: 1 }]}>Face Match</Text>
                      <Text style={[styles.tableCol, { flex: 1 }]}>Date</Text>
                    </View>

                    {recentVerifications.map((v, i) => (
                      <View style={styles.tableRow} key={i}>
                        <Text style={[styles.tableCell, { flex: 1.5, fontWeight: '700' }]}>{v.user}</Text>
                        <Text style={[styles.tableCell, { flex: 1.5, color: COLORS.primary, fontFamily: 'monospace' }]}>{v.id_number}</Text>
                        <Text style={[styles.tableCell, { flex: 1, fontWeight: '600' }]}>{v.doc_type}</Text>
                        <View style={styles.statusBadge(v.matched ? 'APPROVED' : 'REJECTED')}>
                          <Text style={styles.statusText(v.matched ? 'APPROVED' : 'REJECTED')}>{v.matched ? 'MATCHED' : 'UNMATCHED'}</Text>
                        </View>
                        <Text style={[styles.tableCell, { flex: 1, textAlign: 'right' }]}>{v.date}</Text>
                      </View>
                    ))}
                  </View>

                  <TouchableOpacity style={styles.btnOutline} onPress={() => setPipelineDetailVisible(false)}>
                      <Text style={styles.btnOutlineText}>Close Inspector</Text>
                  </TouchableOpacity>
              </View>
          </View>
      </Modal>

      {/* Manual Review Inspector Modal */}
      <Modal visible={reviewModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxWidth: 800 }]}>
                  <Text style={styles.modalTitle}>Review Unmatched Applicant: {selectedReview?.id}</Text>
                  <Text style={{color: COLORS.danger, fontWeight: '600', marginBottom: 20}}>
                    Applicant: {selectedReview?.user} ({selectedReview?.id_number})
                  </Text>
                  
                  <View style={{flexDirection: width > 768 ? 'row' : 'column', gap: 24, width: '100%', marginBottom: 32}}>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 12, color: COLORS.textMuted}}>Extracted ID Photo ({selectedReview?.doc_type || 'ID'})</Text>
                          {selectedReview?.extracted_face_url ? (
                            <SignedAssetImage file={selectedReview.extracted_face_url} style={{ width: 140, height: 140, borderRadius: 8 }} placeholderText="Document Face" />
                          ) : (
                            <View style={{width: 140, height: 140, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8'}}>Document Face</Text>
                            </View>
                          )}
                      </View>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 12, color: COLORS.textMuted}}>Live Captured Selfie</Text>
                          {selectedReview?.live_holder_face_url ? (
                            <SignedAssetImage file={selectedReview.live_holder_face_url} style={{ width: 140, height: 140, borderRadius: 8 }} placeholderText="Webcam Selfie" />
                          ) : (
                            <View style={{width: 140, height: 140, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8'}}>Webcam Selfie</Text>
                            </View>
                          )}
                      </View>
                  </View>

                  <View style={{flexDirection: 'row', gap: 16, width: '100%'}}>
                      <TouchableOpacity style={[styles.btnOutline, {borderColor: COLORS.danger}]} onPress={() => handleReviewAction('REJECT', selectedReview)}>
                          <Text style={[styles.btnOutlineText, {color: COLORS.danger}]}>Reject Applicant</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btn, {backgroundColor: '#10b981'}]} onPress={() => handleReviewAction('APPROVE', selectedReview)}>
                          <Text style={styles.btnText}>Approve Applicant</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btnOutline, {marginLeft: 'auto'}]} onPress={() => {setReviewModalVisible(false); setSelectedReview(null);}}>
                          <Text style={styles.btnOutlineText}>Cancel</Text>
                      </TouchableOpacity>
                  </View>
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
  header: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
    elevation: 2,
    zIndex: 100,
  },
  headerLogo: {
    fontSize: 20,
    fontWeight: '700',
    color: '#202124',
    letterSpacing: -0.2,
  },
  profileBtn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  profileBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  scrollContent: {
    padding: 40,
    maxWidth: 1200,
    alignSelf: 'center',
    width: '100%',
  },
  hero: {
      marginBottom: 32,
  },
  heroTitle: {
      fontSize: 32,
      fontWeight: '800',
      color: COLORS.textMain,
      marginBottom: 8,
  },
  heroSubtitle: {
      fontSize: 16,
      color: COLORS.textMuted,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 40,
    flexWrap: 'wrap',
  },
  statCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 24,
    width: width > 768 ? '31%' : '100%',
    marginBottom: width > 768 ? 0 : 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statTitle: {
    fontSize: 14,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 36,
    fontWeight: '800',
    color: COLORS.primary,
    marginTop: 8,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textMain,
    marginBottom: 16,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 12,
    marginBottom: 12,
  },
  tableCol: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableCell: {
    fontSize: 14,
    color: COLORS.textMain,
  },
  statusBadge: (status) => ({
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: status === 'APPROVED' ? '#dcfce7' : status === 'REJECTED' ? '#fee2e2' : '#fef9c3',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  }),
  statusText: (status) => ({
    fontSize: 12,
    fontWeight: '700',
    color: status === 'APPROVED' ? '#166534' : status === 'REJECTED' ? '#991b1b' : '#854d0e',
  }),
  moduleItem: {
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: COLORS.border,
      padding: 16,
      borderRadius: 12,
      marginBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
  },
  moduleName: {
      fontWeight: '700',
      color: COLORS.textMain,
      marginBottom: 4,
  },
  moduleDesc: {
      fontSize: 12,
      color: COLORS.textMuted,
  },
  pipelineCanvas: {
      minHeight: 300,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: COLORS.border,
      borderRadius: 16,
      padding: 20,
      backgroundColor: 'rgba(248, 250, 252, 0.5)',
      alignItems: 'stretch',
      justifyContent: 'flex-start',
  },
  canvasEmpty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 260,
  },
  pipelineNodeDragging: {
      opacity: 0.3,
  },
  dropIndicator: {
      width: '100%',
      height: 3,
      borderRadius: 2,
      backgroundColor: COLORS.primary,
      marginVertical: 2,
  },
  dragGrip: {
      paddingHorizontal: 4,
      paddingVertical: 4,
  },
  dragGripDots: {
      fontSize: 16,
      color: '#c0ccd8',
  },
  stepBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: COLORS.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
  },
  stepBadgeText: {
      fontSize: 11,
      fontWeight: '800',
      color: COLORS.primary,
  },
  removeBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(239,68,68,0.08)',
  },
  removeBtnText: {
      color: COLORS.danger,
      fontSize: 18,
      fontWeight: 'bold',
  },
  pipelineNode: {
      backgroundColor: '#fff',
  },
  pipelineNodeText: {
      fontWeight: '700',
      color: COLORS.primary,
  },
  pipelineConnector: {
      width: 2,
      height: 24,
      backgroundColor: COLORS.primaryLight,
      marginVertical: 4,
  },
  actionArea: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 24,
      borderTopWidth: 1,
      borderTopColor: COLORS.border,
      paddingTop: 24,
  },
  btn: {
      backgroundColor: COLORS.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
  },
  btnText: {
      color: '#fff',
      fontWeight: '700',
      textAlign: 'center',
  },
  btnOutline: {
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: COLORS.border,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 24,
      marginRight: 12,
  },
  btnOutlineText: {
      color: COLORS.textMuted,
      fontWeight: '700',
  },
  btnSmall: {
      backgroundColor: COLORS.primaryLight,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
  },
  btnSmallText: {
      color: COLORS.primary,
      fontWeight: '700',
      fontSize: 12,
  },
  modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15, 23, 42, 0.4)',
      justifyContent: 'center',
      alignItems: 'center',
  },
  modalContent: {
      backgroundColor: '#fff',
      borderRadius: 24,
      padding: 32,
      width: '90%',
      maxWidth: 520,
      alignItems: 'center',
      overflow: 'hidden',
  },
  modalTitle: {
      fontSize: 24,
      fontWeight: '800',
      color: COLORS.textMain,
      marginBottom: 12,
  },
  linkBox: {
      backgroundColor: COLORS.background,
      borderWidth: 1,
      borderColor: COLORS.border,
      padding: 14,
      borderRadius: 12,
      width: '100%',
      maxWidth: '100%',
      marginBottom: 20,
      overflow: 'hidden',
  },
  linkText: {
      color: COLORS.primary,
      fontFamily: 'monospace',
      fontSize: 12,
      textAlign: 'left',
      lineHeight: 18,
      width: '100%',
      maxWidth: '100%',
      ...(Platform.OS === 'web' ? {
          wordBreak: 'break-all',
          overflowWrap: 'anywhere',
          whiteSpace: 'pre-wrap',
          userSelect: 'all',
          cursor: 'pointer',
      } : {}),
  },
  signOutBtn: {
      backgroundColor: 'rgba(239, 68, 68, 0.2)',
      borderWidth: 1,
      borderColor: 'rgba(239, 68, 68, 0.4)',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      marginLeft: 10,
  },
  signOutBtnText: {
      color: '#fca5a5',
      fontSize: 12,
      fontWeight: '700',
  },
  gfStartSection: {
    backgroundColor: '#f1f3f4',
    width: '100%',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
  },
  gfRecentSection: {
    backgroundColor: '#ffffff',
    width: '100%',
    paddingVertical: 24,
    minHeight: 500,
  },
  gfSectionInner: {
    maxWidth: 1140,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 24,
  },
  gfSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  gfSectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
    letterSpacing: 0.1,
  },
  gfTemplateGalleryBtn: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5f6368',
  },
  gfTemplateCardsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingVertical: 4,
  },
  gfTemplateCardWrapper: {
    alignItems: 'flex-start',
    width: 154,
  },
  gfBlankCard: {
    width: 154,
    height: 120,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(60,64,67,0.08)',
  },
  gfTemplateCard: {
    width: 154,
    height: 120,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    overflow: 'hidden',
    cursor: 'pointer',
    boxShadow: '0 1px 3px rgba(60,64,67,0.08)',
  },
  gfTemplateBanner: {
    height: 38,
    width: '100%',
  },
  gfTemplateMockBody: {
    padding: 10,
    flex: 1,
    justifyContent: 'space-between',
  },
  gfMockTitleLine: {
    height: 6,
    width: '60%',
    borderRadius: 3,
  },
  gfMockSubtitleLine: {
    height: 4,
    width: '40%',
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
  },
  gfMockQuestionBox: {
    backgroundColor: '#f8fafc',
    padding: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  gfMockQuestionHeader: {
    height: 4,
    width: '50%',
    backgroundColor: '#94a3b8',
    borderRadius: 2,
  },
  gfMockRadio: {
    width: 6,
    height: 6,
    borderRadius: 3,
    borderWidth: 1.5,
  },
  gfMockInputOutline: {
    height: 8,
    width: '80%',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  gfTemplateTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#202124',
    marginTop: 8,
    lineHeight: 18,
  },
  gfFilterDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dadce0',
  },
  gfFilterText: {
    fontSize: 13,
    color: '#3c4043',
    fontWeight: '500',
  },
  gfViewToggleGroup: {
    flexDirection: 'row',
    backgroundColor: '#f1f3f4',
    borderRadius: 6,
    padding: 2,
  },
  gfToggleBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  gfToggleBtnActive: {
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 2px rgba(60,64,67,0.15)',
  },
  gfIconBtn: {
    padding: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gfFormsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    marginTop: 8,
  },
  gfFormCard: {
    width: 210,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    backgroundColor: '#ffffff',
    overflow: 'visible',
    position: 'relative',
    boxShadow: '0 1px 3px rgba(60,64,67,0.1)',
  },
  gfCardPreview: {
    height: 140,
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    overflow: 'hidden',
    position: 'relative',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gfCardPreviewStripe: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 16,
  },
  gfMockPaper: {
    width: '75%',
    height: '75%',
    backgroundColor: '#ffffff',
    borderRadius: 4,
    marginTop: 10,
    padding: 8,
    boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
    justifyContent: 'space-between',
  },
  gfMockPaperTitle: {
    height: 6,
    width: '55%',
    borderRadius: 3,
  },
  gfMockPaperSub: {
    height: 4,
    width: '35%',
    backgroundColor: '#e2e8f0',
    borderRadius: 2,
  },
  gfMockPaperCard: {
    backgroundColor: '#f8fafc',
    padding: 4,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  gfMockPaperFieldLine: {
    height: 3,
    width: '60%',
    backgroundColor: '#94a3b8',
    borderRadius: 2,
  },
  gfMockPaperRadioDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  gfMockPaperInput: {
    height: 7,
    width: '70%',
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  gfCardModuleBadge: {
    position: 'absolute',
    bottom: 6,
    right: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  gfCardModuleBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
  },
  gfCardFooter: {
    padding: 12,
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  gfCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#202124',
    marginBottom: 6,
  },
  gfCardSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gfCardOpenedText: {
    fontSize: 11,
    color: '#5f6368',
    flex: 1,
  },
  gfCardMenuBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
    cursor: 'pointer',
  },
  gfActionDropdown: {
    position: 'absolute',
    top: 195,
    right: 8,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
    paddingVertical: 6,
    width: 200,
    zIndex: 9999,
  },
  gfDropdownItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    cursor: 'pointer',
  },
  gfDropdownItemText: {
    fontSize: 13,
    color: '#202124',
    fontWeight: '500',
  },
  gfListViewContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    marginTop: 8,
  },
  gfListHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    backgroundColor: '#f8f9fa',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  gfListCol: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5f6368',
    textTransform: 'uppercase',
  },
  gfListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  gfListTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#202124',
  },
  gfListSubText: {
    fontSize: 13,
    color: '#5f6368',
  },
  gfEmptyState: {
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gfDashboardScroll: {
    padding: 0,
    width: '100%',
  },
  gfMenuBtn: {
    padding: 8,
    borderRadius: 20,
    cursor: 'pointer',
  },
  gfSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f3f4',
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 44,
    flex: 1,
    maxWidth: 520,
    marginHorizontal: 16,
  },
  gfSearchInput: {
    flex: 1,
    fontSize: 15,
    color: '#202124',
    outlineStyle: 'none',
  },
  gfTabBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
  },
  gfTabBtnActive: {
    backgroundColor: 'rgba(114, 72, 185, 0.1)',
  },
  gfTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5f6368',
  },
  gfTabTextActive: {
    color: '#7248B9',
  },
  gfAppsBtn: {
    padding: 8,
    borderRadius: 20,
  },
  gfAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#7248B9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gfAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
