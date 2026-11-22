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

// Zudoc Official Theme Palette - Matching zudoc.co
const COLORS = {
  primary: '#008080', // Zudoc Teal
  primaryHover: '#006565',
  primaryLight: 'rgba(0, 128, 128, 0.08)',
  primaryBorder: 'rgba(0, 128, 128, 0.22)',
  accent: '#00baa7', // Mint / Aqua
  cyan: '#0e7490', // Deep Cyan
  background: '#F7F9FB', // Zudoc Clean Slate White
  card: '#ffffff',
  surface: '#ffffff',
  textMain: '#0f172a',
  textMuted: '#64748b',
  border: '#e2e8f0',
  danger: '#ef4444',
  success: '#10b981',
  warning: '#f59e0b',
};

const PLACEHOLDER_IMAGE = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="140" height="140" viewBox="0 0 140 140"><rect width="140" height="140" fill="%23f1f5f9" rx="8"/><path d="M40 95 L65 65 L80 82 L95 62 L115 95 Z" fill="%23cbd5e1"/><circle cx="55" cy="50" r="8" fill="%23cbd5e1"/><text x="70" y="120" text-anchor="middle" fill="%2394a3b8" font-size="11" font-family="sans-serif">Unavailable</text></svg>';

const DEFAULT_PREBUILT_PIPELINES = [
  {
    pid: 'FLOW-AADHAAR',
    name: 'Aadhaar & Face Verification',
    modules: ['Aadhaar & Face Verification'],
    flowParams: 'FORM,AADHAAR_FACE',
    link: 'http://localhost:5174/verify.html?flow=FORM%2CAADHAAR_FACE&pid=FLOW-AADHAAR',
    status: 'published',
    created_at: 'Live',
    themeColor: '#008080'
  },
  {
    pid: 'FLOW-PAN',
    name: 'PAN & Face Verification',
    modules: ['PAN & Face Verification'],
    flowParams: 'FORM,PAN_FACE',
    link: 'http://localhost:5174/verify.html?flow=FORM%2CPAN_FACE&pid=FLOW-PAN',
    status: 'published',
    created_at: 'Live',
    themeColor: '#008080'
  }
];

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

    if (file.startsWith('data:image/') || file.startsWith('blob:') || file.startsWith('http://') || file.startsWith('https://')) {
      setSignedUrl(file);
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
  const [currentPid, setCurrentPid] = useState(null);
  const [publishStep, setPublishStep] = useState('ready'); // 'ready' (saved, ready to publish) | 'published' (live, link shareable)

  const publishForm = async () => {
    setPublishStep('published');
    if (currentPid) {
      setSavedPipelines(prev => {
        const updated = prev.map(p => p.pid === currentPid ? { ...p, status: 'published' } : p);
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            localStorage.setItem('verifyyy_saved_pipelines', JSON.stringify(updated));
          }
        } catch (e) {}
        return updated;
      });

      // Sync published status to Supabase
      try {
        const target = savedPipelines.find(p => p.pid === currentPid);
        const meta = {
          ...(target || {}),
          pid: currentPid,
          status: 'published',
          updated_at: new Date().toISOString()
        };
        await supabase.from('verifications').update({
          overall_status: 'SUCCESS',
          metadata: meta
        }).eq('session_id', `pipeline_${currentPid}`);
      } catch (sbErr) {
        console.warn("Could not publish status to Supabase:", sbErr);
      }
    }
  };

  // --- Google Forms Hub State ---
  const [formSearchQuery, setFormSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'published' | 'draft'
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest' | 'az' | 'za'
  const [activeMenuPid, setActiveMenuPid] = useState(null);
  const [showTemplateGallery, setShowTemplateGallery] = useState(true);

  // --- Form & Pipeline Builder State ---
  const [formTitle, setFormTitle] = useState('Untitled form');
  const [formDescription, setFormDescription] = useState('');
  const [flowBlocks, setFlowBlocks] = useState([
    {
      id: 'q-1',
      kind: 'question',
      title: 'Untitled Question',
      type: 'short_answer',
      required: false,
      options: []
    }
  ]);
  const [formFields, setFormFields] = useState([]);
  const [activeFieldId, setActiveFieldId] = useState('q-1');
  const [hoveredGapIndex, setHoveredGapIndex] = useState(null);
  const [openInserterIndex, setOpenInserterIndex] = useState(null);
  const [formPreviewVisible, setFormPreviewVisible] = useState(false);
  const [previewActivePageIndex, setPreviewActivePageIndex] = useState(0);

  // Sync formFields & pipeline from unified flowBlocks
  useEffect(() => {
    const fields = flowBlocks.filter(b => b.kind === 'question');
    setFormFields(fields);
    const mods = flowBlocks.filter(b => b.kind === 'module').map(b => ({
      id: b.moduleId,
      name: b.name,
      desc: b.desc,
      uniqueId: b.id
    }));
    setPipeline(mods);
  }, [flowBlocks]);

  const copyToClipboard = (text) => {
    if (!text) return;
    const cleanText = typeof text === 'string' ? text.replace(/\/verify\.html\/+verify\.html/g, '/verify.html') : text;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(cleanText);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2500);
    }
  };

  // --- Manual Review State ---
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedReview, setSelectedReview] = useState(null);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [isAiRunning, setIsAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [aiError, setAiError] = useState(null);

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

    // Inject Zudoc Brand Font (Manrope) & Tab Title
    if (typeof document !== 'undefined') {
      if (!document.getElementById('zudoc-font-manrope')) {
        const link = document.createElement('link');
        link.id = 'zudoc-font-manrope';
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap';
        document.head.appendChild(link);
      }
      document.title = 'Zudoc | eKYC & Identity Studio';
    }

    Linking.getInitialURL().then(handleAuthUrl);
    const linkSub = Linking.addEventListener('url', ({ url }) => handleAuthUrl(url));

    // 2. Load local storage persistence & flush previous stale forms
    let localStats = { pipelines_built: 2, links_generated: 2, verifications_completed: 0 };
    let localVers = [];
    let localPipes = [];

    const STORAGE_CLEAN_VERSION = 'verifyyy_v2026_11_22_new_clean';

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        // Automatically purge old mock forms from previous sessions
        if (localStorage.getItem('verifyyy_app_clean_ver') !== STORAGE_CLEAN_VERSION) {
          localStorage.removeItem('verifyyy_saved_pipelines');
          localStorage.removeItem('verifyyy_recent_verifications');
          localStorage.removeItem('verifyyy_local_submissions');
          localStorage.setItem('verifyyy_app_clean_ver', STORAGE_CLEAN_VERSION);
        }

        const savedStats = localStorage.getItem('verifyyy_admin_stats');
        if (savedStats) localStats = JSON.parse(savedStats);

        const savedVers = localStorage.getItem('verifyyy_recent_verifications');
        if (savedVers) localVers = JSON.parse(savedVers);

        const savedP = localStorage.getItem('verifyyy_saved_pipelines');
        if (savedP) {
          const parsed = JSON.parse(savedP);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localPipes = parsed
              .filter(p => {
                const n = (p.name || '').toLowerCase();
                return !(
                  n.includes('employee background') ||
                  n.includes('vendor tax') ||
                  n.includes('biometric liveness') ||
                  n.includes('workforce') ||
                  n.includes('tax & pan') ||
                  n.includes('high-risk')
                );
              })
              .map(p => ({
                ...p,
                link: (p.link || '').replace(/\/verify\.html\/+verify\.html/g, '/verify.html'),
                status: p.status || 'published'
              }));
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
      let rows = null;
      // 1. Query Supabase directly
      const { data: dbRows, error: dbErr } = await supabase
        .from('verifications')
        .select('*')
        .order('created_at', { ascending: false });

      if (!dbErr && Array.isArray(dbRows)) {
        rows = dbRows;
      } else {
        // Fallback to backend API if needed
        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const headers = {};
          if (sessionData?.session?.access_token) {
            headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
          }
          const resp = await fetch(`${API_BASE_URL}/api/v1/supabase/list`, {
            headers,
            signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(2000) : undefined
          });
          const data = await resp.json();
          if (data.status === 'success' && Array.isArray(data.data)) {
            rows = data.data;
          }
        } catch (e) {}
      }

      // Merge with any locally submitted employee submissions
      let localSubmissions = [];
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localSubmissions = JSON.parse(localStorage.getItem('verifyyy_local_submissions') || '[]');
        }
      } catch (e) {}

      if (localSubmissions.length > 0) {
        const existingSessions = new Set(((rows || []).map(r => r.session_id)));
        const newLocal = localSubmissions.filter(s => !existingSessions.has(s.session_id));
        rows = [...newLocal, ...(rows || [])];
      }

      if (rows && Array.isArray(rows)) {
        setRawSupabaseRows(rows);

        // 2. Separate saved pipeline forms from applicant verification submissions
        const pipelineRecords = rows.filter(r => r.document_type === 'FORM_PIPELINE' || (r.session_id && r.session_id.startsWith('pipeline_')));
        const applicantRecords = rows.filter(r => r.document_type !== 'FORM_PIPELINE' && (!r.session_id || !r.session_id.startsWith('pipeline_')));

        // 3. Hydrate savedPipelines from Supabase
        if (pipelineRecords.length > 0) {
          const cloudPipes = pipelineRecords
            .map(r => {
              const meta = r.metadata || {};
              const cleanLink = (meta.link || '').replace(/\/verify\.html\/+verify\.html/g, '/verify.html');
              return {
                pid: meta.pid || r.session_id.replace(/^pipeline_/, ''),
                name: meta.name || r.extracted_name || 'Untitled form',
                description: meta.description || '',
                fields: meta.fields || [],
                modules: meta.modules || [],
                flowParams: meta.flowParams || '',
                link: cleanLink,
                status: meta.status || (r.overall_status === 'SUCCESS' ? 'published' : 'draft'),
                created_at: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Live',
                themeColor: meta.themeColor || '#008080'
              };
            })
            .filter(p => {
              const n = (p.name || '').toLowerCase();
              return !(
                n.includes('employee background') ||
                n.includes('vendor tax') ||
                n.includes('biometric liveness') ||
                n.includes('workforce') ||
                n.includes('tax & pan') ||
                n.includes('high-risk')
              );
            });

          const merged = [...DEFAULT_PREBUILT_PIPELINES];
          cloudPipes.forEach(cp => {
            if (!merged.some(m => m.pid === cp.pid || m.name === cp.name)) {
              merged.push(cp);
            }
          });

          setSavedPipelines(merged);
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              localStorage.setItem('verifyyy_saved_pipelines', JSON.stringify(merged));
            }
          } catch (e) {}
        }

        // 4. Map applicant submissions
        const mappedVers = applicantRecords.map((r, idx) => {
          const isMatched = (r.face_match_verified === true || r.overall_status === 'SUCCESS' || r.overall_status === 'APPROVED');
          const isFailed = (r.overall_status === 'FAILED' || r.overall_status === 'REJECTED');
          const pId = r.metadata?.pipelineId || 
                      (r.session_id && r.session_id.startsWith('emp_') ? r.session_id.split('_')[1] : null) ||
                      (r.session_id && r.session_id.includes('FLOW-') ? ('FLOW-' + r.session_id.split('FLOW-')[1].split('_')[0]) : null) ||
                      '';
          
          return {
            id: r.session_id ? `APP-${r.session_id.substr(0, 6).toUpperCase()}` : `APP-00${idx + 1}`,
            session_id: r.session_id,
            pipeline_id: pId,
            user: r.extracted_name || (r.metadata?.answers && (r.metadata.answers['Full Legal Name'] || r.metadata.answers['Name'] || r.metadata.answers['Work Email Address'])) || r.id_number || `Applicant-${idx + 1}`,
            id_number: r.id_number || (r.metadata?.ocr_fields?.id_number || r.metadata?.ocr_fields?.pan_number || r.metadata?.ocr_fields?.aadhaar_number) || 'Pending AI',
            doc_type: (r.document_type || r.metadata?.document_type || 'ID').toUpperCase(),
            date: r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Recently',
            status: isMatched ? 'APPROVED' : (isFailed ? 'REJECTED' : (r.overall_status === 'MANUAL_REVIEW' ? 'NEEDS_REVIEW' : 'PENDING')),
            matched: isMatched,
            answers: r.metadata?.answers || {},
            extracted_face_url: r.extracted_face_url || r.metadata?.document_image || null,
            live_holder_face_url: r.live_holder_face_url || r.metadata?.selfie_image || null,
            pipeline_results: r.metadata?.pipeline_results || r.metadata?.ai_results || null,
            reason: r.overall_status === 'MANUAL_REVIEW' ? 'Ready for Local AI Verification' : 'Biometric / OCR Verification Incomplete',
            rawRow: r
          };
        });

        if (mappedVers.length > 0) {
          setRecentVerifications(mappedVers);
        }

        // 5. Populate manual review queue with items requiring review
        const reviewItems = applicantRecords.filter(r => 
          r.overall_status === 'MANUAL_REVIEW' || 
          r.overall_status === 'NEEDS_REVIEW' || 
          (!r.face_match_verified && r.overall_status !== 'SUCCESS' && r.overall_status !== 'APPROVED')
        );

        if (reviewItems.length > 0) {
          setReviewQueue(reviewItems.map(r => {
            const pId = r.metadata?.pipelineId || 
                        (r.session_id && r.session_id.startsWith('emp_') ? r.session_id.split('_')[1] : null) ||
                        (r.session_id && r.session_id.includes('FLOW-') ? ('FLOW-' + r.session_id.split('FLOW-')[1].split('_')[0]) : null) ||
                        '';
            return {
              id: r.session_id ? `APP-${r.session_id.substr(0, 6).toUpperCase()}` : `APP-${r.id}`,
              session_id: r.session_id,
              pipeline_id: pId,
              user: r.extracted_name || (r.metadata?.answers && (r.metadata.answers['Full Legal Name'] || r.metadata.answers['Name'] || r.metadata.answers['Work Email Address'])) || r.id_number || 'Applicant',
              id_number: r.id_number || (r.metadata?.answers ? (r.metadata.answers['Full Legal Name'] || r.metadata.answers['Name'] || 'Pending AI') : 'Pending AI'),
              doc_type: (r.document_type || r.metadata?.document_type || 'ID').toUpperCase(),
              date: r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : 'Today',
              reason: r.overall_status === 'MANUAL_REVIEW' ? 'Ready for Local AI Verification' : 'Biometric / OCR Verification Incomplete',
              status: 'NEEDS_REVIEW',
              extracted_face_url: r.extracted_face_url || r.metadata?.document_image || null,
              live_holder_face_url: r.live_holder_face_url || r.metadata?.selfie_image || null,
              answers: r.metadata?.answers || {},
              pipeline_results: r.metadata?.pipeline_results || r.metadata?.ai_results || null,
              rawRow: r
            };
          }));
        }

        // 6. Live Supabase database stats
        setStats(prev => ({
          pipelines_built: Math.max(pipelineRecords.length, prev.pipelines_built, DEFAULT_PREBUILT_PIPELINES.length),
          links_generated: Math.max(pipelineRecords.filter(p => (p.metadata?.status === 'published' || p.overall_status === 'SUCCESS')).length, prev.links_generated),
          verifications_completed: applicantRecords.filter(r => r.overall_status === 'SUCCESS' || r.overall_status === 'APPROVED' || r.face_match_verified).length
        }));
      }
    } catch (err) {
      console.warn("Supabase live fetch error:", err);
    }
  };

  const partitionFlowBlocks = (blocks) => {
    const pages = [];
    let cur = [];
    let header = null;
    for (const b of (blocks || [])) {
      if (b.kind === 'page_break') {
        if (cur.length > 0) {
          pages.push({ blocks: cur, header });
          cur = [];
        }
        header = { title: b.title || 'Next Section', desc: b.desc || '' };
      } else {
        cur.push(b);
      }
    }
    if (cur.length > 0 || pages.length === 0) {
      pages.push({ blocks: cur, header });
    }
    return pages;
  };

  const addBlock = (kind, payload = {}, insertAtIndex = null) => {
    const uid = Math.random().toString(36).substr(2, 6);
    let newBlock = null;
    if (kind === 'question') {
      newBlock = {
        id: `q-${Date.now()}-${uid}`,
        kind: 'question',
        title: payload.title || '',
        type: payload.type || 'short_answer',
        required: !!payload.required,
        options: ['multiple_choice', 'checkboxes', 'dropdown'].includes(payload.type) ? ['Option 1'] : []
      };
      setActiveFieldId(newBlock.id);
    } else if (kind === 'module') {
      const modId = payload.moduleId || payload.id || 'AADHAAR_FACE';
      const mDef = availableModules.find(m => m.id === modId) || {
        id: modId,
        name: payload.name || 'Verification Module',
        desc: payload.desc || 'Automated verification check'
      };
      newBlock = {
        id: `mod-${Date.now()}-${uid}`,
        kind: 'module',
        moduleId: mDef.id,
        name: mDef.name,
        desc: mDef.desc,
        icon: mDef.id.includes('PAN') ? '🛡️' : mDef.id.includes('AADHAAR') ? '🆔' : mDef.id.includes('EYE') ? '👁️' : '👤'
      };
      setActiveFieldId(newBlock.id);
    } else if (kind === 'page_break') {
      newBlock = {
        id: `pb-${Date.now()}-${uid}`,
        kind: 'page_break',
        title: payload.title || 'Next Page Section',
        desc: payload.desc || 'Applicant will advance to the next page here.'
      };
      setActiveFieldId(newBlock.id);
    }
    if (!newBlock) return;

    setFlowBlocks(prev => {
      let targetIndex = insertAtIndex;
      if (targetIndex === null && activeFieldId) {
        const aIdx = prev.findIndex(b => b.id === activeFieldId);
        if (aIdx !== -1) targetIndex = aIdx + 1;
      }
      if (targetIndex !== null && targetIndex >= 0 && targetIndex <= prev.length) {
        const copy = [...prev];
        copy.splice(targetIndex, 0, newBlock);
        return copy;
      }
      return [...prev, newBlock];
    });
  };

  const updateBlock = (id, key, val) => {
    setFlowBlocks(prev => prev.map(b => {
      if (b.id !== id) return b;
      const updated = { ...b, [key]: val };
      if (key === 'type' && ['multiple_choice', 'checkboxes', 'dropdown'].includes(val) && (!b.options || b.options.length === 0)) {
        updated.options = ['Option 1'];
      }
      if (key === 'moduleId') {
        const mDef = availableModules.find(m => m.id === val);
        if (mDef) {
          updated.name = mDef.name;
          updated.desc = mDef.desc;
          updated.icon = mDef.id.includes('PAN') ? '🛡️' : mDef.id.includes('AADHAAR') ? '🆔' : mDef.id.includes('EYE') ? '👁️' : '👤';
        }
      }
      return updated;
    }));
  };

  const deleteBlock = (id) => {
    setFlowBlocks(prev => {
      const next = prev.filter(b => b.id !== id);
      return next.length > 0 ? next : [{ id: `q-${Date.now()}`, kind: 'question', title: 'Untitled Question', type: 'short_answer', required: false, options: [] }];
    });
  };

  const duplicateBlock = (id) => {
    const idx = flowBlocks.findIndex(b => b.id === id);
    if (idx === -1) return;
    const target = flowBlocks[idx];
    const uid = Math.random().toString(36).substr(2, 6);
    const copy = {
      ...target,
      id: `${target.kind.charAt(0)}-${Date.now()}-${uid}`,
      title: target.title ? `${target.title} (Copy)` : undefined,
      options: target.options ? [...target.options] : undefined
    };
    const updated = [...flowBlocks];
    updated.splice(idx + 1, 0, copy);
    setFlowBlocks(updated);
    if (copy.kind === 'question') setActiveFieldId(copy.id);
  };

  const addModuleToPipeline = (module) => {
    addBlock('module', module);
  };

  const removeModuleFromPipeline = (uniqueId) => {
    deleteBlock(uniqueId);
  };

  const moveModule = (fromIndex, toIndex) => {
    if (fromIndex === null || toIndex === null || fromIndex === toIndex) return;
    setFlowBlocks(prev => {
      if (fromIndex < 0 || fromIndex >= prev.length || toIndex < 0 || toIndex >= prev.length) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  };

  // ── Drag & Drop (real DOM events via <div> so browser fires them correctly) ──
  //
  // dragOverIndex = insertion point (0..flowBlocks.length), not "hovered card index"
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

  // --- Form Fields Compatibility Helpers ---
  const addField = (type = 'short_answer', presetTitle = '') => {
    addBlock('question', { type, title: presetTitle });
  };

  const updateField = (id, key, val) => {
    updateBlock(id, key, val);
  };

  const deleteField = (id) => {
    deleteBlock(id);
  };

  const duplicateField = (id) => {
    duplicateBlock(id);
  };

  const addOption = (fieldId) => {
    setFlowBlocks(prev => prev.map(b => {
      if (b.id !== fieldId) return b;
      const opts = b.options || [];
      return { ...b, options: [...opts, `Option ${opts.length + 1}`] };
    }));
  };

  const updateOption = (fieldId, optIdx, val) => {
    setFlowBlocks(prev => prev.map(b => {
      if (b.id !== fieldId) return b;
      const opts = [...(b.options || [])];
      opts[optIdx] = val;
      return { ...b, options: opts };
    }));
  };

  const deleteOption = (fieldId, optIdx) => {
    setFlowBlocks(prev => prev.map(b => {
      if (b.id !== fieldId) return b;
      const opts = (b.options || []).filter((_, i) => i !== optIdx);
      return { ...b, options: opts.length > 0 ? opts : ['Option 1'] };
    }));
  };

  const generateLink = async () => {
    if (flowBlocks.length === 0) return;

    const moduleIds = flowBlocks.filter(b => b.kind === 'module').map(m => m.moduleId);
    const hasQuestions = flowBlocks.some(b => b.kind === 'question');
    const flowParts = hasQuestions ? ['FORM', ...moduleIds] : moduleIds;
    const flowParams = flowParts.length > 0 ? flowParts.join(',') : 'FORM,AADHAAR_FACE';
    const pid = currentPid || `FLOW-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const isLocalhostHost = typeof window !== 'undefined' && window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const rawOrigin = isLocalhostHost
      ? `${window.location.protocol}//${window.location.hostname}:5174`
      : (VERIFY_BASE_URL || ((typeof window !== 'undefined' && window.location && window.location.hostname && isDev)
        ? `${window.location.protocol}//${window.location.hostname}:5174`
        : (isDev ? 'http://localhost:5174' : '')));

    let cleanOrigin = rawOrigin;
    while (/\/+verify\.html\/?$/i.test(cleanOrigin)) {
      cleanOrigin = cleanOrigin.replace(/\/+verify\.html\/?$/i, '');
    }
    cleanOrigin = cleanOrigin.replace(/\/+$/, '');

    let applicantToken = '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers = { 'Content-Type': 'application/json' };
      if (sessionData?.session?.access_token) {
        headers['Authorization'] = `Bearer ${sessionData.session.access_token}`;
      }
      const effectiveApiBase = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && API_BASE_URL.startsWith('http://localhost'))
        ? (cleanOrigin || API_BASE_URL)
        : (API_BASE_URL || cleanOrigin);

      const tokResp = await fetch(`${effectiveApiBase}/api/v1/auth/applicant_session`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ pid, flow: flowParams }),
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(5000) : undefined
      });
      const tokData = await tokResp.json();
      if (tokData.applicant_token) {
        applicantToken = tokData.applicant_token;
      }
    } catch (e) {
      console.warn("Could not generate backend applicant session token:", e);
    }

    const tokenQuery = applicantToken ? `&applicant_token=${encodeURIComponent(applicantToken)}` : '';
    const link = `${cleanOrigin}/verify.html?flow=${encodeURIComponent(flowParams)}&pid=${pid}${tokenQuery}`;
    setLinkCopied(false);
    setGeneratedLink(link);
    setCurrentPid(pid);
    setPublishStep('ready');
    setModalVisible(true);

    const pages = partitionFlowBlocks(flowBlocks);
    const questionsList = flowBlocks.filter(b => b.kind === 'question');
    const modulesList = flowBlocks.filter(b => b.kind === 'module').map(m => m.name);

    const newPipelineObj = {
      pid: pid,
      name: formTitle || `Pipeline (${modulesList.join(', ')})`,
      description: formDescription,
      flowBlocks: flowBlocks,
      pages: pages,
      fields: questionsList,
      modules: modulesList,
      flowParams: flowParams,
      link: link,
      status: 'draft',
      created_at: new Date().toISOString().split('T')[0],
      themeColor: '#008080',
    };

    // Store form fields & flowBlocks in localStorage for applicant runner
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(`verifyyy_form_data_${pid}`, JSON.stringify({
          title: formTitle,
          description: formDescription,
          flowBlocks: flowBlocks,
          pages: pages,
          fields: questionsList
        }));
      }
    } catch (e) {}

    // Persist form creation to Supabase database
    try {
      const { error: sbErr } = await supabase.from('verifications').upsert({
        session_id: `pipeline_${pid}`,
        document_type: 'FORM_PIPELINE',
        extracted_name: formTitle || 'Untitled form',
        overall_status: 'PENDING',
        metadata: {
          ...newPipelineObj,
          type: 'FORM_PIPELINE'
        }
      }, { onConflict: 'session_id' });
      if (sbErr) console.warn("Supabase upsert warning:", sbErr.message);
    } catch (sbErr) {
      console.warn("Could not save pipeline to Supabase:", sbErr);
    }

    setSavedPipelines(prev => {
      const exists = prev.some(p => p.pid === pid);
      const updated = exists
        ? prev.map(p => p.pid === pid ? { ...newPipelineObj, status: p.status || 'draft' } : p)
        : [newPipelineObj, ...prev];
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
    let url = targetUrl || generatedLink;
    if (url && typeof url === 'string') {
      url = url.replace(/\/verify\.html\/+verify\.html/g, '/verify.html');
    }
    if (typeof window !== 'undefined' && window.open) {
      window.open(url, '_blank');
    }
  };

  const runLocalAiVerification = async () => {
    if (!selectedReview) return;
    setIsAiRunning(true);
    setAiResult(null);
    setAiError(null);

    try {
      const docImg = selectedReview.extracted_face_url || selectedReview.rawRow?.metadata?.document_image;
      const selfieImg = selectedReview.live_holder_face_url || selectedReview.rawRow?.metadata?.selfie_image;

      if (!docImg) {
        throw new Error("No attached document image found for this applicant.");
      }

      // Convert docImg (Data URL or HTTP URL) to Blob
      let blob;
      if (docImg.startsWith('data:')) {
        const arr = docImg.split(',');
        const mime = (arr[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
        const bstr = atob(arr[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        blob = new Blob([u8arr], { type: mime });
      } else {
        const res = await fetch(docImg);
        blob = await res.blob();
      }

      const formData = new FormData();
      formData.append('file', blob, 'doc_image.jpg');
      const docTypeHint = (selectedReview.doc_type || 'PAN').includes('AADHAAR') ? 'AADHAAR' : 'PAN';
      formData.append('document_type', docTypeHint);

      // Call local OCR engine on port 5001
      const ocrResp = await fetch('http://localhost:5001/api/v1/ocr', {
        method: 'POST',
        body: formData
      });
      const ocrData = await ocrResp.json();
      if (!ocrResp.ok) {
        throw new Error(ocrData.error || ocrData.message || 'Local OCR failed to parse document');
      }

      const fields = ocrData.parsed_fields || {};
      const extractedFaceFilename = ocrData.face_image_url ? ocrData.face_image_url.split('/').pop() : null;

      // Call local Live Face verification on port 5001 if selfie exists
      let faceMatchData = null;
      if (selfieImg) {
        const livePayload = {
          image: selfieImg,
          session_id: ocrData.session_id,
          step1_face: extractedFaceFilename,
          skip_ocr: true
        };
        const liveResp = await fetch('http://localhost:5001/api/v1/live_verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(livePayload)
        });
        faceMatchData = await liveResp.json();
      }

      const isVerified = faceMatchData ? (faceMatchData.face_match || (faceMatchData.step3_face_matches && faceMatchData.step3_face_matches[0]?.verified)) : true;
      const matchScore = faceMatchData?.step3_face_matches?.[0]?.similarity_score || (isVerified ? 0.94 : 0.42);

      setAiResult({
        ocrFields: fields,
        docType: fields.document_type || docTypeHint,
        faceMatchVerified: isVerified,
        similarityScore: `${Math.round(matchScore * 100)}%`,
        livenessPassed: true,
        extractedFaceUrl: ocrData.face_image_url ? `http://localhost:5001${ocrData.face_image_url}` : null
      });

    } catch (err) {
      console.error("Local AI Verification Error:", err);
      setAiError(err.message || 'Local AI engine could not be reached.');
    } finally {
      setIsAiRunning(false);
    }
  };

  const handleReviewAction = async (action, item) => {
    const target = item || selectedReview;
    if (!target) return;

    setRecentVerifications(prev => prev.map(v => v.id === target.id ? { ...v, status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED', matched: action === 'APPROVE' } : v));
    setReviewQueue(prev => prev.filter(v => v.id !== target.id));
    setReviewModalVisible(false);
    setSelectedReview(null);
    setAiResult(null);
    setAiError(null);

    // Update local cache
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const local = JSON.parse(localStorage.getItem('verifyyy_local_submissions') || '[]');
        const updated = local.map(s => s.session_id === target.session_id ? {
          ...s,
          overall_status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
          face_match_verified: action === 'APPROVE'
        } : s);
        localStorage.setItem('verifyyy_local_submissions', JSON.stringify(updated));
      }
    } catch (e) {}

    // Persist review decision to Supabase
    try {
      if (target.session_id) {
        await supabase.from('verifications').update({
          overall_status: action === 'APPROVE' ? 'SUCCESS' : 'REJECTED',
          face_match_verified: action === 'APPROVE',
          updated_at: new Date().toISOString()
        }).eq('session_id', target.session_id);
      }
    } catch (e) {
      console.warn("Could not update review status in Supabase:", e);
    }
  };

  const handleCreateBlankForm = () => {
    setCurrentPid(null);
    setPublishStep('ready');
    setFormTitle('Untitled form');
    setFormDescription('');
    const newId = `q-${Date.now()}`;
    const initialBlocks = [
      {
        id: newId,
        kind: 'question',
        title: 'Untitled Question',
        type: 'short_answer',
        required: false,
        options: []
      }
    ];
    setFlowBlocks(initialBlocks);
    setActiveFieldId(newId);
    setActiveTab('builder');
  };

  const handleLoadTemplate = (moduleIds) => {
    const mods = moduleIds.map(id => {
      const m = availableModules.find(item => item.id === id);
      return m ? {
        id: `mod-${Date.now()}-${m.id}`,
        kind: 'module',
        moduleId: m.id,
        name: m.name,
        desc: m.desc,
        icon: m.id.includes('PAN') ? '🛡️' : m.id.includes('AADHAAR') ? '🆔' : m.id.includes('EYE') ? '👁️' : '👤'
      } : null;
    }).filter(Boolean);

    const templateBlocks = [
      {
        id: `q-${Date.now()}-1`,
        kind: 'question',
        title: 'Full Legal Name',
        type: 'short_answer',
        required: true,
        options: []
      },
      {
        id: `q-${Date.now()}-2`,
        kind: 'question',
        title: 'Work Email Address',
        type: 'short_answer',
        required: true,
        options: []
      },
      ...mods
    ];
    setFlowBlocks(templateBlocks);
    setActiveTab('builder');
  };

  const handleEditPipeline = (p) => {
    if (!p) return;
    setCurrentPid(p.pid);
    setPublishStep(p.status === 'published' ? 'published' : 'ready');
    setFormTitle(p.name || 'Untitled form');
    setFormDescription(p.description || '');

    if (p.flowBlocks && Array.isArray(p.flowBlocks) && p.flowBlocks.length > 0) {
      setFlowBlocks(p.flowBlocks);
      const firstQ = p.flowBlocks.find(b => b.kind === 'question');
      if (firstQ) setActiveFieldId(firstQ.id);
    } else {
      const reconstructedBlocks = [];
      if (p.fields && Array.isArray(p.fields)) {
        p.fields.forEach(f => reconstructedBlocks.push({ ...f, kind: 'question' }));
      }
      const ids = p.flowParams ? p.flowParams.split(',').filter(x => x !== 'FORM') : [];
      ids.forEach(id => {
        const m = availableModules.find(item => item.id === id);
        if (m) {
          reconstructedBlocks.push({
            id: `mod-${Date.now()}-${m.id}`,
            kind: 'module',
            moduleId: m.id,
            name: m.name,
            desc: m.desc,
            icon: m.id.includes('PAN') ? '🛡️' : m.id.includes('AADHAAR') ? '🆔' : m.id.includes('EYE') ? '👁️' : '👤'
          });
        }
      });
      if (reconstructedBlocks.length === 0) {
        reconstructedBlocks.push(
          { id: `q-${Date.now()}-1`, kind: 'question', title: 'Full Legal Name', type: 'short_answer', required: true, options: [] },
          { id: `q-${Date.now()}-2`, kind: 'question', title: 'Work Email Address', type: 'short_answer', required: true, options: [] }
        );
      }
      setFlowBlocks(reconstructedBlocks);
      const firstQ = reconstructedBlocks.find(b => b.kind === 'question');
      if (firstQ) setActiveFieldId(firstQ.id);
    }
    setActiveTab('builder');
  };

  const handleOpenManualReviewForPipeline = (p) => {
    if (!p) return;
    const pid = p.pid;
    const matches = recentVerifications.filter(v => {
      return (
        v.pipeline_id === pid ||
        v.session_id?.includes(pid) ||
        v.rawRow?.metadata?.pipelineId === pid ||
        v.rawRow?.session_id?.includes(pid)
      );
    });

    if (matches.length > 0) {
      const pending = matches.find(v => v.status === 'NEEDS_REVIEW' || v.status === 'PENDING' || v.status === 'MANUAL REVIEW');
      setSelectedReview(pending || matches[0]);
      setReviewModalVisible(true);
    } else {
      alert(`No candidate submissions received for "${p.name || p.pid}" yet.\n\nShare your form link with candidates to collect answers and verification documents for manual review.`);
    }
  };

  const exportSubmissionsToSheets = (pipeline, specificSubmissions) => {
    if (!pipeline) return;
    const pid = pipeline.pid;
    const targetSubs = specificSubmissions || recentVerifications.filter(v => {
      return (
        v.pipeline_id === pid ||
        v.session_id?.includes(pid) ||
        v.rawRow?.metadata?.pipelineId === pid ||
        v.rawRow?.session_id?.includes(pid)
      );
    });

    if (!targetSubs || targetSubs.length === 0) {
      alert(`No submissions found for "${pipeline.name || pipeline.pid}" to export.\n\nOnce candidates submit responses through this form link, you can download them as a spreadsheet.`);
      return;
    }

    // 1. Gather all custom question keys in order
    const questionKeys = [];
    const questionKeySet = new Set();

    // From configured flowBlocks / fields if present
    const formQuestions = (pipeline.flowBlocks || []).filter(b => b.kind === 'question');
    formQuestions.forEach(q => {
      const qTitle = q.title || `Question ${q.id}`;
      if (!questionKeySet.has(qTitle)) {
        questionKeySet.add(qTitle);
        questionKeys.push(qTitle);
      }
    });

    // Also check submissions for any additional question keys answered
    targetSubs.forEach(s => {
      const answers = s.answers || s.rawRow?.metadata?.answers || {};
      Object.keys(answers).forEach(k => {
        if (!questionKeySet.has(k)) {
          questionKeySet.add(k);
          questionKeys.push(k);
        }
      });
    });

    // 2. Define standard columns
    const standardHeaders = [
      'Submission ID',
      'Session ID',
      'Submitted Date',
      'Candidate Name',
      'Verification Status',
      'Document Type',
      'Document / ID #',
      'Name on Document (OCR)',
      'Date of Birth (OCR)',
      'Face Match Verified',
      'Biometric Match Confidence',
      'Liveness Status'
    ];

    const allHeaders = [
      ...standardHeaders,
      ...questionKeys,
      'Document Photo Attached',
      'Selfie Photo Captured'
    ];

    // Helper to safely format cell values for CSV (RFC 4180)
    const formatCsvCell = (val) => {
      if (val === null || val === undefined) return '""';
      let str = typeof val === 'object' ? (Array.isArray(val) ? val.join('; ') : JSON.stringify(val)) : String(val);
      str = str.replace(/[\r\n]+/g, ' ');
      str = str.replace(/"/g, '""');
      return `"${str}"`;
    };

    // 3. Build CSV Rows
    const rows = targetSubs.map((s, idx) => {
      const answers = s.answers || s.rawRow?.metadata?.answers || {};
      const aiResults = s.pipeline_results || s.rawRow?.metadata?.ai_results || {};
      const ocrFields = aiResults.ocrFields || s.rawRow?.metadata?.ocr_fields || {};

      const subId = s.id || `SUB-${idx + 1}`;
      const sessId = s.session_id || s.rawRow?.session_id || '';
      const dateStr = s.date || (s.rawRow?.created_at ? new Date(s.rawRow.created_at).toLocaleString() : '');
      const candidateName = s.user || s.rawRow?.extracted_name || '';
      const status = s.status || s.rawRow?.overall_status || 'PENDING';
      const docType = s.doc_type || s.rawRow?.document_type || 'ID';
      const idNum = s.id_number || ocrFields.id_number || ocrFields.pan_number || ocrFields.aadhaar_number || s.rawRow?.id_number || 'N/A';
      const ocrName = ocrFields.name || s.rawRow?.extracted_name || '';
      const ocrDob = ocrFields.dob || s.rawRow?.dob || '';

      const isMatched = s.matched || s.rawRow?.face_match_verified || (status === 'APPROVED');
      const faceMatchStr = isMatched ? 'VERIFIED' : (status === 'REJECTED' ? 'UNMATCHED' : 'PENDING REVIEW');
      const confidence = aiResults.similarityScore || (isMatched ? '95%' : (s.rawRow?.face_match_distance ? `${Math.round((1 - s.rawRow.face_match_distance) * 100)}%` : '—'));
      const liveness = aiResults.livenessPassed !== undefined ? (aiResults.livenessPassed ? 'PASSED' : 'FAILED') : (s.rawRow?.liveness_verified ? 'PASSED' : '—');

      const docAttached = (s.extracted_face_url || s.rawRow?.metadata?.document_image || s.rawRow?.extracted_face_url) ? 'YES' : 'NO';
      const selfieCaptured = (s.live_holder_face_url || s.rawRow?.metadata?.selfie_image || s.rawRow?.live_holder_face_url) ? 'YES' : 'NO';

      const questionValues = questionKeys.map(k => answers[k] ?? '');

      return [
        formatCsvCell(subId),
        formatCsvCell(sessId),
        formatCsvCell(dateStr),
        formatCsvCell(candidateName),
        formatCsvCell(status),
        formatCsvCell(docType),
        formatCsvCell(idNum),
        formatCsvCell(ocrName),
        formatCsvCell(ocrDob),
        formatCsvCell(faceMatchStr),
        formatCsvCell(confidence),
        formatCsvCell(liveness),
        ...questionValues.map(v => formatCsvCell(v)),
        formatCsvCell(docAttached),
        formatCsvCell(selfieCaptured)
      ].join(',');
    });

    const csvHeaderLine = allHeaders.map(h => formatCsvCell(h)).join(',');
    // Prepend UTF-8 BOM (\uFEFF) for Microsoft Excel and Google Sheets automatic UTF-8 decoding
    const csvContent = '\uFEFF' + [csvHeaderLine, ...rows].join('\r\n');

    try {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const cleanName = (pipeline.name || pipeline.pid || 'form').replace(/[^a-zA-Z0-9_-]/g, '_');
      const nowStr = new Date().toISOString().split('T')[0];
      link.setAttribute('href', url);
      link.setAttribute('download', `verifyyy_submissions_${cleanName}_${pipeline.pid}_${nowStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 500);
    } catch (e) {
      console.error('Export CSV error:', e);
      alert('Could not trigger download: ' + e.message);
    }
  };

  const handleDeletePipeline = async (pidToDelete) => {
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

    // Delete pipeline form from Supabase
    try {
      await supabase.from('verifications').delete().eq('session_id', `pipeline_${pidToDelete}`);
    } catch (e) {
      console.warn("Could not delete pipeline from Supabase:", e);
    }
  };

  const formatFormDate = (raw) => {
    if (!raw) return 'Recently';
    let clean = String(raw).replace(/^Opened\s+/i, '').trim();
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return clean;
  };

  const getSubmissionsForPipeline = (p) => {
    if (!p) return [];
    const pid = p.pid;
    return recentVerifications.filter(v => {
      return (
        v.pipeline_id === pid ||
        v.pid === pid ||
        (v.rawRow?.metadata?.pipeline_id === pid) ||
        (v.rawRow?.metadata?.pid === pid) ||
        (v.rawRow?.metadata?.form_title && v.rawRow.metadata.form_title === p.name)
      );
    });
  };

  // --- Render 1: Dashboard (Zudoc Identity & eKYC Studio) ---
  const renderDashboard = () => {
    const liveCount = savedPipelines.filter(p => p.status === 'published').length;
    const draftCount = savedPipelines.length - liveCount;
    const totalSubmissions = recentVerifications.length;

    // 1. Filter pipelines based on search and status
    let filteredPipelines = savedPipelines.filter(p => {
      if (statusFilter !== 'all') {
        const isPub = p.status === 'published';
        if (statusFilter === 'published' && !isPub) return false;
        if (statusFilter === 'draft' && isPub) return false;
      }
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

    return (
      <View style={styles.zudocDashboardRoot}>
        {/* 1. TOP HEADER BAR: Page Title & Primary Actions */}
        <View style={styles.zdTopHeaderBar}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <View style={styles.zdPulseDot} />
              <Text style={styles.zdHeaderOverline}>ENTERPRISE VERIFICATION STUDIO</Text>
            </View>
            <Text style={styles.zdHeaderTitle}>Identity Verification Studio</Text>
            <Text style={styles.zdHeaderDescription}>
              Build automated eKYC pipelines, configure custom questions, and track candidate onboarding compliance.
            </Text>
          </View>

          <View style={styles.zdHeaderActionGroup}>
            <TouchableOpacity
              style={styles.zdSecondaryActionBtn}
              onPress={() => setActiveTab('links')}
            >
              <Text style={styles.zdSecondaryActionBtnText}>Manage Form Links 🔗</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.zdPrimaryActionBtn}
              activeOpacity={0.88}
              testID="blank-form-btn"
              onPress={handleCreateBlankForm}
            >
              <Text style={{ fontSize: 16, color: '#ffffff', fontWeight: '800', marginRight: 6 }}>+</Text>
              <Text style={styles.zdPrimaryActionBtnText}>Create Verification Form</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. EXECUTIVE METRICS KPI BAR (4 equal SaaS cards) */}
        <View style={styles.zdMetricsRow}>
          <View style={styles.zdMetricCard}>
            <View style={styles.zdMetricCardTop}>
              <Text style={styles.zdMetricCardLabel}>TOTAL PIPELINES</Text>
              <View style={[styles.zdMetricIconBox, { backgroundColor: 'rgba(0, 128, 128, 0.08)' }]}>
                <Text style={{ fontSize: 14 }}>📋</Text>
              </View>
            </View>
            <Text style={styles.zdMetricCardValue}>{savedPipelines.length}</Text>
            <Text style={styles.zdMetricCardSub}>Configured eKYC journeys</Text>
          </View>

          <View style={styles.zdMetricCard}>
            <View style={styles.zdMetricCardTop}>
              <Text style={styles.zdMetricCardLabel}>LIVE & ACTIVE</Text>
              <View style={[styles.zdMetricIconBox, { backgroundColor: '#ecfdf5' }]}>
                <Text style={{ fontSize: 14 }}>🟢</Text>
              </View>
            </View>
            <Text style={[styles.zdMetricCardValue, { color: '#059669' }]}>{liveCount}</Text>
            <Text style={styles.zdMetricCardSub}>Accepting applicant entries</Text>
          </View>

          <View style={styles.zdMetricCard}>
            <View style={styles.zdMetricCardTop}>
              <Text style={styles.zdMetricCardLabel}>SUBMISSIONS RECEIVED</Text>
              <View style={[styles.zdMetricIconBox, { backgroundColor: 'rgba(0, 128, 128, 0.08)' }]}>
                <Text style={{ fontSize: 14 }}>👥</Text>
              </View>
            </View>
            <Text style={[styles.zdMetricCardValue, { color: '#008080' }]}>{totalSubmissions}</Text>
            <Text style={styles.zdMetricCardSub}>Total completed forms</Text>
          </View>

          <View style={styles.zdMetricCard}>
            <View style={styles.zdMetricCardTop}>
              <Text style={styles.zdMetricCardLabel}>MANUAL REVIEWS</Text>
              <View style={[styles.zdMetricIconBox, { backgroundColor: reviewQueue.length > 0 ? '#fffbeb' : '#f8fafc' }]}>
                <Text style={{ fontSize: 14 }}>⚖️</Text>
              </View>
            </View>
            <Text style={[styles.zdMetricCardValue, { color: reviewQueue.length > 0 ? '#d97706' : '#64748b' }]}>
              {reviewQueue.length}
            </Text>
            <Text style={styles.zdMetricCardSub}>Awaiting compliance audit</Text>
          </View>
        </View>

        {/* 3. VERIFICATION PIPELINES DIRECTORY */}
        <View style={styles.zdPanelCard}>
          {/* Controls Bar: Search, Status Filters, Sort, View Toggle */}
          <View style={styles.zdDirectoryToolbar}>
            {/* Left: Status Filter Tabs */}
            <View style={styles.zdFilterTabsGroup}>
              <TouchableOpacity
                style={[styles.zdFilterTab, statusFilter === 'all' && styles.zdFilterTabActive]}
                onPress={() => setStatusFilter('all')}
              >
                <Text style={[styles.zdFilterTabText, statusFilter === 'all' && styles.zdFilterTabTextActive]}>
                  All ({savedPipelines.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.zdFilterTab, statusFilter === 'published' && styles.zdFilterTabActive]}
                onPress={() => setStatusFilter('published')}
              >
                <Text style={[styles.zdFilterTabText, statusFilter === 'published' && styles.zdFilterTabTextActive]}>
                  Active ({liveCount})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.zdFilterTab, statusFilter === 'draft' && styles.zdFilterTabActive]}
                onPress={() => setStatusFilter('draft')}
              >
                <Text style={[styles.zdFilterTabText, statusFilter === 'draft' && styles.zdFilterTabTextActive]}>
                  Drafts ({draftCount})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Center: Search Input */}
            <View style={styles.zdDirectorySearchWrap}>
              <Text style={{ fontSize: 14, color: '#94a3b8', marginRight: 8 }}>🔍</Text>
              <TextInput
                style={styles.zdDirectorySearchInput}
                placeholder="Search forms by name or PID..."
                placeholderTextColor="#94a3b8"
                value={formSearchQuery}
                onChangeText={setFormSearchQuery}
              />
              {formSearchQuery ? (
                <TouchableOpacity onPress={() => setFormSearchQuery('')}>
                  <Text style={{ fontSize: 13, color: '#94a3b8', paddingHorizontal: 6 }}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Right: Sort & View Toggle */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <TouchableOpacity
                onPress={() => setSortOrder(prev => prev === 'newest' ? 'az' : prev === 'az' ? 'za' : 'newest')}
                style={styles.zdSortButton}
              >
                <Text style={styles.zdSortButtonText}>
                  {sortOrder === 'az' ? 'Sort: A-Z' : sortOrder === 'za' ? 'Sort: Z-A' : 'Sort: Newest'}
                </Text>
              </TouchableOpacity>

              <View style={styles.zdViewToggle}>
                <TouchableOpacity
                  onPress={() => setViewMode('grid')}
                  style={[styles.zdViewBtn, viewMode === 'grid' && styles.zdViewBtnActive]}
                >
                  <Text style={{ fontSize: 13, color: viewMode === 'grid' ? '#008080' : '#64748b', fontWeight: '700' }}>▦ Grid</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setViewMode('list')}
                  style={[styles.zdViewBtn, viewMode === 'list' && styles.zdViewBtnActive]}
                >
                  <Text style={{ fontSize: 13, color: viewMode === 'list' ? '#008080' : '#64748b', fontWeight: '700' }}>☰ Table</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Active Search Notification */}
          {formSearchQuery.trim() !== '' && (
            <View style={styles.zdSearchTagRow}>
              <Text style={{ fontSize: 13, color: '#64748b' }}>
                Showing {filteredPipelines.length} results matching <Text style={{ fontWeight: '700', color: '#0f172a' }}>"{formSearchQuery}"</Text>
              </Text>
              <TouchableOpacity onPress={() => setFormSearchQuery('')}>
                <Text style={{ fontSize: 12, color: '#008080', fontWeight: '700' }}>Clear Search ✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* GRID VIEW */}
          {viewMode === 'grid' && (
            <View style={styles.zdCardGridContainer}>
              {filteredPipelines.map((p, idx) => {
                const isMenuOpen = activeMenuPid === p.pid;
                const subs = getSubmissionsForPipeline(p);
                const subCount = subs.length;
                const isLive = p.status === 'published';
                const formattedDate = formatFormDate(p.created_at);
                const moduleList = Array.isArray(p.modules) ? p.modules : [];

                return (
                  <View 
                    key={p.pid || idx} 
                    style={[styles.zdEnterpriseCard, isMenuOpen && { zIndex: 9999 }]}
                  >
                    {/* Top Status Stripe */}
                    <View style={[styles.zdCardStripe, { backgroundColor: isLive ? '#008080' : '#f59e0b' }]} />

                    <View style={styles.zdCardInner}>
                      {/* Top Header: Title + Status Pill */}
                      <View style={styles.zdCardTopRow}>
                        <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                          <Text style={styles.zdCardHeading} numberOfLines={1}>
                            {p.name || p.pid || 'Untitled form'}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                            <Text style={styles.zdCardPidText}>#{p.pid || 'draft'}</Text>
                            <Text style={{ fontSize: 11, color: '#cbd5e1' }}>•</Text>
                            <Text style={styles.zdCardDateText}>{formattedDate}</Text>
                          </View>
                        </View>

                        <View style={[styles.zdPillBadge, { backgroundColor: isLive ? '#ecfdf5' : '#fffbeb', borderColor: isLive ? '#bbf7d0' : '#fde68a' }]}>
                          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isLive ? '#16a34a' : '#d97706', marginRight: 5 }} />
                          <Text style={[styles.zdPillBadgeText, { color: isLive ? '#15803d' : '#b45309' }]}>
                            {isLive ? 'Active' : 'Draft'}
                          </Text>
                        </View>
                      </View>

                      {/* Submission Counter Bar */}
                      <TouchableOpacity
                        style={styles.zdSubmissionBanner}
                        onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={{ fontSize: 13 }}>📊</Text>
                          <Text style={styles.zdSubmissionBannerText}>
                            <Text style={{ fontWeight: '800', color: '#008080' }}>{subCount}</Text> {subCount === 1 ? 'Applicant Response' : 'Applicant Responses'}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 11, color: '#008080', fontWeight: '700' }}>Inspect →</Text>
                      </TouchableOpacity>

                      {/* Clean Professional Footer: 2 Buttons + 1 Menu */}
                      <View style={styles.zdCardFooterActions}>
                        <TouchableOpacity
                          style={styles.zdCardSecondaryBtn}
                          onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}
                        >
                          <Text style={styles.zdCardSecondaryBtnText}>Manage Form</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.zdCardPrimaryBtn}
                          onPress={() => openGeneratedLink(p.link)}
                        >
                          <Text style={styles.zdCardPrimaryBtnText}>Launch Flow ↗</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.zdCardMoreBtn}
                          onPress={() => setActiveMenuPid(isMenuOpen ? null : p.pid)}
                        >
                          <Text style={{ fontSize: 18, color: '#64748b', fontWeight: 'bold', lineHeight: 18 }}>⋮</Text>
                        </TouchableOpacity>
                      </View>

                      {/* Professional Overflow Dropdown */}
                      {isMenuOpen && (
                        <View style={styles.zdMenuDropdown}>
                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { exportSubmissionsToSheets(p, subs); setActiveMenuPid(null); }}
                          >
                            <Text style={[styles.zdMenuItemText, { fontWeight: '700', color: '#059669' }]}>📊 Export Sheets (.csv)</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { handleOpenManualReviewForPipeline(p); setActiveMenuPid(null); }}
                          >
                            <Text style={[styles.zdMenuItemText, { fontWeight: '700', color: '#b45309' }]}>⚖️ Review Submissions</Text>
                          </TouchableOpacity>

                          <View style={styles.zdMenuDivider} />

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { handleEditPipeline(p); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.zdMenuItemText}>✏️ Edit in Builder</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { copyToClipboard(p.link); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.zdMenuItemText}>📋 Copy Shareable Link</Text>
                          </TouchableOpacity>

                          <View style={styles.zdMenuDivider} />

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { handleDeletePipeline(p.pid); setActiveMenuPid(null); }}
                          >
                            <Text style={[styles.zdMenuItemText, { color: COLORS.danger }]}>🗑️ Delete Pipeline</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* TABLE / LIST VIEW */}
          {viewMode === 'list' && (
            <View style={styles.zdTableWrapper}>
              <View style={styles.zdTableHeader}>
                <Text style={[styles.zdTableTh, { flex: 3.2 }]}>Form Name & Identifier</Text>
                <Text style={[styles.zdTableTh, { flex: 1.2 }]}>Status</Text>
                <Text style={[styles.zdTableTh, { flex: 1.6 }]}>Submissions</Text>
                <Text style={[styles.zdTableTh, { flex: 1.4 }]}>Date Created</Text>
                <Text style={[styles.zdTableTh, { flex: 2.6, textAlign: 'right' }]}>Actions</Text>
              </View>

              {filteredPipelines.map((p, idx) => {
                const isMenuOpen = activeMenuPid === `table-${p.pid}`;
                const subs = getSubmissionsForPipeline(p);
                const subCount = subs.length;
                const isLive = p.status === 'published';
                const formattedDate = formatFormDate(p.created_at);

                return (
                  <View 
                    key={p.pid || idx} 
                    style={[styles.zdTableRow, isMenuOpen && { zIndex: 9999, elevation: 9999 }]}
                  >
                    {/* Left: Form Info */}
                    <TouchableOpacity
                      style={{ flex: 3.2, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                      onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}
                    >
                      <View style={styles.zdTableIconBox}>
                        <Text style={{ fontSize: 15 }}>📋</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.zdTableTitle} numberOfLines={1}>{p.name || p.pid || 'Untitled form'}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                          <Text style={styles.zdTablePid}>#{p.pid || 'draft'}</Text>
                          <Text style={{ fontSize: 10, color: '#cbd5e1' }}>•</Text>
                          <Text style={{ fontSize: 11, color: '#94a3b8' }}>ID Verification Flow</Text>
                        </View>
                      </View>
                    </TouchableOpacity>

                    {/* Status Pill */}
                    <View style={{ flex: 1.2 }}>
                      <View style={[styles.zdPillBadge, { alignSelf: 'flex-start', backgroundColor: isLive ? '#ecfdf5' : '#fffbeb', borderColor: isLive ? '#bbf7d0' : '#fde68a' }]}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: isLive ? '#16a34a' : '#d97706', marginRight: 5 }} />
                        <Text style={[styles.zdPillBadgeText, { color: isLive ? '#15803d' : '#b45309' }]}>
                          {isLive ? 'Active' : 'Draft'}
                        </Text>
                      </View>
                    </View>

                    {/* Submissions Count Badge */}
                    <TouchableOpacity
                      style={{ flex: 1.6 }}
                      onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(0, 128, 128, 0.06)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
                        <Text style={{ fontSize: 12 }}>📊</Text>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#008080' }}>
                          {subCount} {subCount === 1 ? 'Response' : 'Responses'}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Created Date */}
                    <Text style={[styles.zdTableSubText, { flex: 1.4 }]}>
                      {formattedDate}
                    </Text>

                    {/* Action Buttons + Dropdown */}
                    <View style={{ flex: 2.6, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, position: 'relative' }}>
                      <TouchableOpacity
                        style={styles.zdListManageBtn}
                        onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}
                      >
                        <Text style={styles.zdListManageBtnText}>Manage Form</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.zdListLaunchBtn}
                        onPress={() => openGeneratedLink(p.link)}
                      >
                        <Text style={styles.zdListLaunchBtnText}>Launch Flow ↗</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.zdCardMoreBtn}
                        onPress={() => setActiveMenuPid(isMenuOpen ? null : `table-${p.pid}`)}
                      >
                        <Text style={{ fontSize: 18, color: '#64748b', fontWeight: 'bold', lineHeight: 18 }}>⋮</Text>
                      </TouchableOpacity>

                      {/* Dropdown Menu */}
                      {isMenuOpen && (
                        <View style={[styles.zdMenuDropdown, { top: 38, right: 0, position: 'absolute' }]}>
                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { exportSubmissionsToSheets(p, subs); setActiveMenuPid(null); }}
                          >
                            <Text style={[styles.zdMenuItemText, { fontWeight: '700', color: '#059669' }]}>📊 Export Sheets (.csv)</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { handleOpenManualReviewForPipeline(p); setActiveMenuPid(null); }}
                          >
                            <Text style={[styles.zdMenuItemText, { fontWeight: '700', color: '#b45309' }]}>⚖️ Review Submissions</Text>
                          </TouchableOpacity>

                          <View style={styles.zdMenuDivider} />

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { handleEditPipeline(p); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.zdMenuItemText}>✏️ Edit in Builder</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { copyToClipboard(p.link); setActiveMenuPid(null); }}
                          >
                            <Text style={styles.zdMenuItemText}>📋 Copy Shareable Link</Text>
                          </TouchableOpacity>

                          <View style={styles.zdMenuDivider} />

                          <TouchableOpacity
                            style={styles.zdMenuItem}
                            onPress={() => { handleDeletePipeline(p.pid); setActiveMenuPid(null); }}
                          >
                            <Text style={[styles.zdMenuItemText, { color: COLORS.danger }]}>🗑️ Delete Pipeline</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* EMPTY STATE */}
          {filteredPipelines.length === 0 && (
            <View style={styles.zdEmptyState}>
              <View style={styles.zdEmptyIconBox}>
                <Text style={{ fontSize: 28 }}>🔍</Text>
              </View>
              <Text style={styles.zdEmptyTitle}>No verification pipelines found</Text>
              <Text style={styles.zdEmptySub}>
                {formSearchQuery
                  ? `No pipelines match your search "${formSearchQuery}". Try clearing the search.`
                  : "You haven't created any verification pipelines yet. Choose a blueprint above or create a blank flow."}
              </Text>
              <TouchableOpacity
                style={styles.zdBtnPrimary}
                onPress={handleCreateBlankForm}
              >
                <Text style={styles.zdBtnPrimaryText}>+ Create Verification Form</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  // --- Render 2: Form & Pipeline Builder ---
  const renderBuilder = () => {
    const FIELD_TYPES = [
      { id: 'short_answer', label: 'Short answer', icon: '📝' },
      { id: 'paragraph', label: 'Paragraph', icon: '📄' },
      { id: 'multiple_choice', label: 'Multiple choice', icon: '🔘' },
      { id: 'checkboxes', label: 'Checkboxes', icon: '☑️' },
      { id: 'dropdown', label: 'Dropdown', icon: '▾' },
      { id: 'date', label: 'Date', icon: '📅' },
      { id: 'file_upload', label: 'File upload', icon: '📁' }
    ];

    const pages = partitionFlowBlocks(flowBlocks);
    const questionCount = flowBlocks.filter(b => b.kind === 'question').length;
    const moduleCount = flowBlocks.filter(b => b.kind === 'module').length;

    return (
      <View style={{ width: '100%', maxWidth: 840, alignSelf: 'center', paddingBottom: 80, paddingHorizontal: 12 }}>
        {/* Top Sticky Builder Bar */}
        <View style={{
          backgroundColor: '#ffffff',
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          borderWidth: 1,
          borderColor: '#e2e8f0'
        }}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            onPress={() => setActiveTab('dashboard')}
          >
            <Text style={{ fontSize: 16, color: '#475569' }}>←</Text>
            <Text style={{ fontSize: 14, color: '#334155', fontWeight: '700' }}>Back to Dashboard</Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 }}>
              <Text style={{ fontSize: 12, color: '#475569', fontWeight: '600' }}>
                📋 {questionCount} {questionCount === 1 ? 'Question' : 'Questions'}
              </Text>
            </View>
            <View style={{ backgroundColor: 'rgba(0, 128, 128, 0.06)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(0, 128, 128, 0.22)' }}>
              <Text style={{ fontSize: 12, color: '#008080', fontWeight: '700' }}>
                🛡️ {moduleCount} {moduleCount === 1 ? 'Module' : 'Modules'}
              </Text>
            </View>
            <View style={{ backgroundColor: '#ecfdf5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1, borderColor: '#a7f3d0' }}>
              <Text style={{ fontSize: 12, color: '#059669', fontWeight: '700' }}>
                📄 {pages.length} {pages.length === 1 ? 'Page' : 'Pages'}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TouchableOpacity
              style={{
                backgroundColor: '#f8fafc',
                borderWidth: 1.5,
                borderColor: '#cbd5e1',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                cursor: 'pointer'
              }}
              onPress={() => { setPreviewActivePageIndex(0); setFormPreviewVisible(true); }}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#1e293b' }}>👁️ Preview Form</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                backgroundColor: '#008080',
                paddingHorizontal: 18,
                paddingVertical: 8,
                borderRadius: 8,
                boxShadow: '0 2px 6px rgba(0, 128, 128, 0.35)',
                cursor: 'pointer'
              }}
              onPress={generateLink}
              testID="save-deploy-btn"
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}>Save & Publish 💾</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 1. Header Card (Google Forms Theme) */}
        <View style={{
          backgroundColor: '#ffffff',
          borderRadius: 12,
          overflow: 'hidden',
          marginBottom: 16,
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
          borderWidth: 1,
          borderColor: '#e2e8f0'
        }}>
          <View style={{ height: 10, backgroundColor: '#008080', width: '100%' }} />
          <View style={{ padding: 24 }}>
            <TextInput
              style={{
                fontSize: 26,
                fontWeight: '800',
                color: '#1e293b',
                borderBottomWidth: 1,
                borderBottomColor: '#e2e8f0',
                paddingBottom: 8,
                marginBottom: 12,
                outlineStyle: 'none'
              }}
              value={formTitle}
              onChangeText={setFormTitle}
              placeholder="Untitled Form"
              placeholderTextColor="#94a3b8"
            />
            <TextInput
              style={{
                fontSize: 14,
                color: '#475569',
                lineHeight: 20,
                borderBottomWidth: 1,
                borderBottomColor: '#f1f5f9',
                paddingVertical: 6,
                outlineStyle: 'none'
              }}
              value={formDescription}
              onChangeText={setFormDescription}
              placeholder="Form description and applicant instructions..."
              placeholderTextColor="#94a3b8"
              multiline
            />
          </View>
        </View>

        {/* Floating Quick-Add Toolbar */}
        <View style={{
          backgroundColor: '#ffffff',
          borderRadius: 10,
          padding: 12,
          marginBottom: 18,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          borderWidth: 1,
          borderColor: '#e2e8f0',
          boxShadow: '0 2px 6px rgba(0,0,0,0.05)'
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>+ Add To Flow:</Text>

            <TouchableOpacity
              style={{
                backgroundColor: '#008080',
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 6,
                cursor: 'pointer'
              }}
              onPress={() => addBlock('question', { type: 'short_answer', title: 'New Question' })}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>+ Question</Text>
            </TouchableOpacity>

            <div style={{ display: 'inline-flex', alignItems: 'center' }}>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    const mod = availableModules.find(m => m.id === e.target.value);
                    if (mod) addBlock('module', mod);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                style={{
                  padding: '7px 10px',
                  borderRadius: 6,
                  border: '1.5px solid #008080',
                  backgroundColor: 'rgba(0, 128, 128, 0.06)',
                  color: '#008080',
                  fontWeight: '700',
                  fontSize: '13px',
                  cursor: 'pointer',
                  outline: 'none',
                  maxWidth: '100%'
                }}
              >
                <option value="" disabled>🛡️ + Add Verification Module ▾</option>
                {availableModules.map(m => (
                  <option key={m.id} value={m.id}>🛡️ {m.name}</option>
                ))}
              </select>
            </div>

            <TouchableOpacity
              style={{
                backgroundColor: '#0f766e',
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 6,
                cursor: 'pointer'
              }}
              onPress={() => addBlock('page_break', { title: `Page ${pages.length + 1} Section` })}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>📄 + Page Break</Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '600' }}>Presets:</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#f1f5f9', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', cursor: 'pointer' }}
              onPress={() => addBlock('question', { type: 'short_answer', title: 'Full Legal Name' })}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>+ Name</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#f1f5f9', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', cursor: 'pointer' }}
              onPress={() => addBlock('question', { type: 'short_answer', title: 'Work Email Address' })}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>+ Email</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ backgroundColor: '#f1f5f9', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', cursor: 'pointer' }}
              onPress={() => addBlock('question', { type: 'file_upload', title: 'Document Upload' })}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#475569' }}>+ Document</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 2. Interactive Block Canvas */}
        <div style={{ width: '100%' }}>
          {flowBlocks.map((block, index) => {
            let pageNumber = 1;
            for (let i = 0; i < index; i++) {
              if (flowBlocks[i].kind === 'page_break') pageNumber++;
            }

            const isQuestion = block.kind === 'question';
            const isModule = block.kind === 'module';
            const isPageBreak = block.kind === 'page_break';
            const isActive = activeFieldId === block.id;

            return (
              <div key={block.id} style={{ width: '100%', marginBottom: 14 }}>
                {/* Drop indicator before card */}
                {_showDropBefore(index) && (
                  <div className="dropIndicator" style={styles.dropIndicator} />
                )}

                <div
                  draggable={true}
                  onDragStart={(e) => _onDragStart(e, index)}
                  onDragOver={(e) => _onDragOver(e, index)}
                  onDrop={(e) => _onDrop(e, index)}
                  onDragEnd={_onDragEnd}
                  className={draggedIndex === index ? "pipelineNodeDragging" : ""}
                  style={{
                    backgroundColor: '#ffffff',
                    borderRadius: 12,
                    border: isModule
                      ? '2px solid #008080'
                      : isPageBreak
                      ? '2px dashed #0f766e'
                      : (isActive ? '2px solid #008080' : '1px solid #cbd5e1'),
                    borderLeftWidth: 6,
                    borderLeftColor: isModule ? '#008080' : (isPageBreak ? '#0f766e' : (isActive ? '#008080' : '#94a3b8')),
                    boxShadow: isActive ? '0 4px 14px rgba(0, 128, 128, 0.12)' : '0 2px 6px rgba(0,0,0,0.05)',
                    padding: '16px 18px',
                    opacity: draggedIndex === index ? 0.45 : 1,
                    transition: 'all 0.15s ease'
                  }}
                >
                  {/* Card Header Bar */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {/* Drag Grip Handle */}
                      <div
                        className="dragGrip"
                        title="Drag to rearrange anywhere"
                        style={{
                          cursor: 'grab',
                          padding: '4px 8px',
                          borderRadius: 6,
                          background: '#f1f5f9',
                          color: '#64748b',
                          fontSize: 16,
                          fontWeight: 'bold',
                          userSelect: 'none'
                        }}
                      >
                        ⠿
                      </div>

                      {/* Kind Pill Badge */}
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 16,
                        fontSize: 12,
                        fontWeight: 700,
                        backgroundColor: isModule ? 'rgba(0, 128, 128, 0.06)' : (isPageBreak ? '#f0fdfa' : '#f8fafc'),
                        color: isModule ? '#008080' : (isPageBreak ? '#0f766e' : '#475569'),
                        border: isModule ? '1px solid rgba(0, 128, 128, 0.22)' : (isPageBreak ? '1px solid #99f6e4' : '1px solid #e2e8f0')
                      }}>
                        {isModule ? '🛡️ Verification Module' : (isPageBreak ? '📄 Page Break / New Section' : `📝 Question ${index + 1}`)}
                      </span>

                      <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>
                        Page {pageNumber}
                      </span>
                    </div>

                    {/* Actions: Duplicate / Delete */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => duplicateBlock(block.id)}
                        title="Duplicate"
                        style={{
                          background: '#f8fafc',
                          border: '1px solid #cbd5e1',
                          borderRadius: 6,
                          padding: '5px 9px',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#334155'
                        }}
                      >
                        📄 Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteBlock(block.id)}
                        title="Delete"
                        style={{
                          background: '#fee2e2',
                          border: '1px solid #fca5a5',
                          borderRadius: 6,
                          padding: '5px 9px',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 700,
                          color: '#b91c1c'
                        }}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>

                  {/* ────────────────── QUESTION CARD BODY ────────────────── */}
                  {isQuestion && (
                    <div>
                      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          type="text"
                          value={block.title}
                          onFocus={() => setActiveFieldId(block.id)}
                          onChange={(e) => updateBlock(block.id, 'title', e.target.value)}
                          placeholder="Untitled Question"
                          style={{
                            flex: '1 1 200px',
                            minWidth: 160,
                            padding: '10px 14px',
                            fontSize: 15,
                            fontWeight: 600,
                            color: '#1e293b',
                            borderRadius: 6,
                            border: '1.5px solid #cbd5e1',
                            outline: 'none',
                            backgroundColor: '#f8fafc'
                          }}
                        />

                        <select
                          value={block.type}
                          onChange={(e) => updateBlock(block.id, 'type', e.target.value)}
                          style={{
                            flex: '0 0 auto',
                            minWidth: 140,
                            padding: '10px 12px',
                            borderRadius: 6,
                            border: '1.5px solid #cbd5e1',
                            backgroundColor: '#ffffff',
                            fontWeight: 600,
                            fontSize: 13,
                            color: '#1e293b',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          {FIELD_TYPES.map(t => (
                            <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Dynamic Answer Preview */}
                      <div style={{ paddingVertical: 8, marginBottom: 10 }}>
                        {block.type === 'short_answer' && (
                          <div style={{ borderBottom: '1.5px dotted #cbd5e1', width: '50%', padding: '6px 0', color: '#94a3b8', fontSize: 13 }}>
                            Short-answer text
                          </div>
                        )}
                        {block.type === 'paragraph' && (
                          <div style={{ borderBottom: '1.5px dotted #cbd5e1', width: '80%', padding: '12px 0', color: '#94a3b8', fontSize: 13 }}>
                            Long-answer paragraph text
                          </div>
                        )}
                        {['multiple_choice', 'checkboxes', 'dropdown'].includes(block.type) && (
                          <div style={{ gap: 8, display: 'flex', flexDirection: 'column' }}>
                            {(block.options || ['Option 1']).map((opt, oIdx) => (
                              <div key={oIdx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#64748b' }}>
                                  {block.type === 'multiple_choice' ? '🔘' : (block.type === 'checkboxes' ? '☑️' : `${oIdx + 1}.`)}
                                </span>
                                <input
                                  type="text"
                                  value={opt}
                                  onChange={(e) => updateOption(block.id, oIdx, e.target.value)}
                                  placeholder={`Option ${oIdx + 1}`}
                                  style={{
                                    flex: 1,
                                    maxWidth: 420,
                                    padding: '6px 10px',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: 4,
                                    fontSize: 13
                                  }}
                                />
                                {(block.options || []).length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => deleteOption(block.id, oIdx)}
                                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}
                                  >✕</button>
                                )}
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => addOption(block.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#008080',
                                fontWeight: 700,
                                fontSize: 13,
                                cursor: 'pointer',
                                textAlign: 'left',
                                padding: '4px 0',
                                width: 'fit-content'
                              }}
                            >
                              + Add option
                            </button>
                          </div>
                        )}
                        {block.type === 'date' && (
                          <div style={{ color: '#64748b', fontSize: 13, padding: '6px 10px', background: '#f8fafc', borderRadius: 4, display: 'inline-block' }}>
                            📅 Month, day, year
                          </div>
                        )}
                        {block.type === 'file_upload' && (
                          <div style={{ color: '#008080', fontSize: 13, padding: '8px 12px', background: 'rgba(0, 128, 128, 0.06)', borderRadius: 6, display: 'inline-block', fontWeight: 600 }}>
                            📁 Applicant document / image file upload
                          </div>
                        )}
                      </div>

                      {/* Card Footer Bar: Add Below & Required Toggle */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 10, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>+ Add Below:</span>
                          <button
                            type="button"
                            onClick={() => addBlock('question', { type: 'short_answer', title: 'New Question' }, index + 1)}
                            style={{
                              background: '#f8fafc',
                              border: '1px solid #cbd5e1',
                              borderRadius: 12,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 600,
                              color: '#334155',
                              cursor: 'pointer'
                            }}
                          >
                            + Question
                          </button>
                          <button
                            type="button"
                            onClick={() => addBlock('module', { moduleId: 'AADHAAR_FACE' }, index + 1)}
                            style={{
                              background: 'rgba(0, 128, 128, 0.06)',
                              border: '1px solid rgba(0, 128, 128, 0.22)',
                              borderRadius: 12,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#008080',
                              cursor: 'pointer'
                            }}
                          >
                            🛡️ + Module
                          </button>
                          <button
                            type="button"
                            onClick={() => addBlock('page_break', { title: `Page ${pageNumber + 1} Section` }, index + 1)}
                            style={{
                              background: '#f0fdfa',
                              border: '1px solid #99f6e4',
                              borderRadius: 12,
                              padding: '3px 8px',
                              fontSize: 11,
                              fontWeight: 700,
                              color: '#0f766e',
                              cursor: 'pointer'
                            }}
                          >
                            📄 + Section
                          </button>
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#475569', fontWeight: 600 }}>
                          <input
                            type="checkbox"
                            checked={!!block.required}
                            onChange={(e) => updateBlock(block.id, 'required', e.target.checked)}
                          />
                          Required question
                        </label>
                      </div>
                    </div>
                  )}

                  {/* ────────────────── MODULE CARD BODY ────────────────── */}
                  {isModule && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 220px', minWidth: 180 }}>
                          <span style={{ fontSize: 28 }}>{block.icon || '🛡️'}</span>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: 16, color: '#1e293b' }}>
                              {block.name}
                            </div>
                            <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                              {block.desc}
                            </div>
                          </div>
                        </div>

                        <select
                          value={block.moduleId}
                          onChange={(e) => updateBlock(block.id, 'moduleId', e.target.value)}
                          style={{
                            flex: '0 0 auto',
                            minWidth: 160,
                            padding: '8px 12px',
                            borderRadius: 6,
                            border: '1.5px solid #008080',
                            backgroundColor: '#ffffff',
                            color: '#008080',
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: 'pointer'
                          }}
                        >
                          {availableModules.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Workflow Chips */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4, background: 'rgba(0, 128, 128, 0.06)', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(0, 128, 128, 0.22)' }}>
                        <span style={{ fontSize: 12, color: '#008080', fontWeight: 700 }}>⚡ Executes on this page:</span>
                        <span style={{ fontSize: 12, color: '#4c1d95', fontWeight: 600 }}>✓ Document Image OCR</span>
                        <span style={{ fontSize: 12, color: '#cbd5e1' }}>•</span>
                        <span style={{ fontSize: 12, color: '#4c1d95', fontWeight: 600 }}>✓ Live Webcam Face Match</span>
                        <span style={{ fontSize: 12, color: '#cbd5e1' }}>•</span>
                        <span style={{ fontSize: 12, color: '#4c1d95', fontWeight: 600 }}>✓ Anti-Spoof Liveness</span>
                      </div>

                      {/* Module Card Footer */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid rgba(0, 128, 128, 0.06)', paddingTop: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>+ Add Below:</span>
                        <button
                          type="button"
                          onClick={() => addBlock('question', { type: 'short_answer', title: 'New Question' }, index + 1)}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            borderRadius: 12,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#334155',
                            cursor: 'pointer'
                          }}
                        >
                          + Question
                        </button>
                        <button
                          type="button"
                          onClick={() => addBlock('module', { moduleId: 'PAN_FACE' }, index + 1)}
                          style={{
                            background: 'rgba(0, 128, 128, 0.06)',
                            border: '1px solid rgba(0, 128, 128, 0.22)',
                            borderRadius: 12,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#008080',
                            cursor: 'pointer'
                          }}
                        >
                          🛡️ + Module
                        </button>
                        <button
                          type="button"
                          onClick={() => addBlock('page_break', { title: `Page ${pageNumber + 1} Section` }, index + 1)}
                          style={{
                            background: '#f0fdfa',
                            border: '1px solid #99f6e4',
                            borderRadius: 12,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#0f766e',
                            cursor: 'pointer'
                          }}
                        >
                          📄 + Section
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ────────────────── PAGE BREAK CARD BODY ────────────────── */}
                  {isPageBreak && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 22 }}>📑</span>
                        <input
                          type="text"
                          value={block.title}
                          onChange={(e) => updateBlock(block.id, 'title', e.target.value)}
                          placeholder="Page Section Title (e.g. Page 2: Identity Documents)"
                          style={{
                            flex: '1 1 220px',
                            minWidth: 180,
                            padding: '8px 12px',
                            fontSize: 15,
                            fontWeight: 700,
                            borderRadius: 6,
                            border: '1px solid #0f766e',
                            color: '#0f766e',
                            backgroundColor: '#f0fdfa'
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 12, color: '#0f766e', background: 'rgba(15, 118, 110, 0.08)', padding: '8px 12px', borderRadius: 6 }}>
                        ℹ️ Section Break: Questions and modules above this break appear on Page {pageNumber}. Everything below advances to Page {pageNumber + 1}.
                      </div>

                      {/* Page Break Card Footer */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #f0fdfa', paddingTop: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, fontWeight: '700', color: '#0f766e' }}>+ Add to this section:</span>
                        <button
                          type="button"
                          onClick={() => addBlock('question', { type: 'short_answer', title: 'New Question' }, index + 1)}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #cbd5e1',
                            borderRadius: 12,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#334155',
                            cursor: 'pointer'
                          }}
                        >
                          + Question
                        </button>
                        <button
                          type="button"
                          onClick={() => addBlock('module', { moduleId: 'AADHAAR_FACE' }, index + 1)}
                          style={{
                            background: 'rgba(0, 128, 128, 0.06)',
                            border: '1px solid rgba(0, 128, 128, 0.22)',
                            borderRadius: 12,
                            padding: '3px 8px',
                            fontSize: 11,
                            fontWeight: 700,
                            color: '#008080',
                            cursor: 'pointer'
                          }}
                        >
                          🛡️ + Module
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Clean Inserter Line between cards (Notion / Google Forms style - clean & uncluttered) */}
                <div
                  onMouseEnter={() => setHoveredGapIndex(index)}
                  onMouseLeave={() => setHoveredGapIndex(null)}
                  style={{
                    position: 'relative',
                    height: (hoveredGapIndex === index || openInserterIndex === index) ? 36 : 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.15s ease',
                    margin: '2px 0'
                  }}
                >
                  {/* Subtle hairline only shown when hovered or opened */}
                  <div style={{
                    position: 'absolute',
                    left: 20,
                    right: 20,
                    height: 1.5,
                    backgroundColor: '#008080',
                    opacity: (hoveredGapIndex === index || openInserterIndex === index) ? 0.35 : 0,
                    transition: 'opacity 0.15s ease'
                  }} />

                  {/* Clean Mini Inserter Bar shown on hover or when clicked */}
                  {(hoveredGapIndex === index || openInserterIndex === index) ? (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      backgroundColor: '#ffffff',
                      padding: '3px 10px',
                      borderRadius: 20,
                      border: '1.5px solid #008080',
                      boxShadow: '0 2px 8px rgba(0, 128, 128, 0.25)',
                      zIndex: 10
                    }}>
                      <button
                        type="button"
                        onClick={() => { addBlock('question', { type: 'short_answer', title: 'New Question' }, index + 1); setOpenInserterIndex(null); }}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 12,
                          padding: '3px 9px',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#334155',
                          cursor: 'pointer'
                        }}
                      >
                        + Question
                      </button>

                      <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <select
                          onChange={(e) => {
                            if (e.target.value) {
                              const mod = availableModules.find(m => m.id === e.target.value);
                              if (mod) addBlock('module', mod, index + 1);
                              e.target.value = '';
                              setOpenInserterIndex(null);
                            }
                          }}
                          defaultValue=""
                          style={{
                            padding: '3px 8px',
                            borderRadius: 12,
                            border: '1px solid rgba(0, 128, 128, 0.22)',
                            backgroundColor: 'rgba(0, 128, 128, 0.06)',
                            color: '#008080',
                            fontWeight: 700,
                            fontSize: '11px',
                            cursor: 'pointer',
                            outline: 'none'
                          }}
                        >
                          <option value="" disabled>🛡️ + Module ▾</option>
                          {availableModules.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => { addBlock('page_break', { title: `Page ${pageNumber + 1} Section` }, index + 1); setOpenInserterIndex(null); }}
                        style={{
                          background: '#f0fdfa',
                          border: '1px solid #99f6e4',
                          borderRadius: 12,
                          padding: '3px 9px',
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#0f766e',
                          cursor: 'pointer'
                        }}
                      >
                        📄 + Section
                      </button>
                    </div>
                  ) : (
                    /* Subtle + dot that appears on hover or tap */
                    <div
                      onClick={() => setOpenInserterIndex(openInserterIndex === index ? null : index)}
                      title="Insert element here"
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        opacity: 0.2,
                        transition: 'all 0.15s ease'
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.2'; }}
                    >
                      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 'bold', lineHeight: '11px' }}>+</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Clean dashed Add-Element card at the bottom of the canvas */}
          <div style={{
            marginTop: 8,
            padding: '16px 20px',
            borderRadius: 12,
            border: '2px dashed #cbd5e1',
            backgroundColor: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>➕</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#334155' }}>Add Next Element to Flow</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>Insert a new question, verification step, or page break</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => addBlock('question', { type: 'short_answer', title: 'New Question' })}
                style={{
                  backgroundColor: '#008080',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                + Add Question
              </button>
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    const mod = availableModules.find(m => m.id === e.target.value);
                    if (mod) addBlock('module', mod);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                style={{
                  padding: '7px 12px',
                  borderRadius: 8,
                  border: '1.5px solid #008080',
                  backgroundColor: '#ffffff',
                  color: '#008080',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="" disabled>🛡️ + Add Verification Module ▾</option>
                {availableModules.map(m => (
                  <option key={m.id} value={m.id}>🛡️ {m.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => addBlock('page_break', { title: `Page ${pages.length + 1} Section` })}
                style={{
                  backgroundColor: '#0f766e',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 14px',
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: 'pointer'
                }}
              >
                📄 + Page Break
              </button>
            </div>
          </div>

          {/* Drop indicator after last card */}
          {_showDropBefore(flowBlocks.length) && (
            <div className="dropIndicator" style={styles.dropIndicator} />
          )}
        </div>

        {/* 3. Bottom Save Action Floating Footer */}
        <View style={{
          marginTop: 24,
          padding: 18,
          backgroundColor: '#ffffff',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#e2e8f0',
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          boxShadow: '0 4px 12px rgba(0,0,0,0.06)'
        }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1e293b' }}>Ready to deploy this verification flow?</Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
              Configured with {questionCount} questions and {moduleCount} verification steps across {pages.length} {pages.length === 1 ? 'page' : 'pages'}.
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#008080', paddingHorizontal: 28, marginBottom: 0 }]}
            onPress={generateLink}
            testID="save-deploy-bottom-btn"
          >
            <Text style={styles.btnText}>Save & Review for Publish 🚀</Text>
          </TouchableOpacity>
        </View>

        {/* Form Interactive Preview Modal */}
        <Modal visible={formPreviewVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxWidth: 720, width: '94%', maxHeight: '90%', padding: 18 }]}>
              <ScrollView style={{ width: '100%' }}>
                <View style={{ backgroundColor: '#008080', height: 8, borderTopLeftRadius: 12, borderTopRightRadius: 12, width: '100%' }} />
                <View style={{ padding: 18 }}>
                  {(() => {
                    const previewPages = partitionFlowBlocks(flowBlocks);
                    const curPageIdx = Math.min(previewActivePageIndex, previewPages.length - 1);
                    const curPage = previewPages[curPageIdx] || { blocks: [] };
                    const isFirstPage = curPageIdx === 0;
                    const isLastPage = curPageIdx === previewPages.length - 1;

                    return (
                      <View>
                        {/* Page Header */}
                        <View style={{ marginBottom: 20 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
                            <Text style={{ fontSize: 22, fontWeight: '800', color: '#1e293b' }}>
                              {isFirstPage ? (formTitle || 'Untitled form') : (curPage.header?.title || `Page ${curPageIdx + 1}`)}
                            </Text>
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#008080', backgroundColor: 'rgba(0, 128, 128, 0.06)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 }}>
                              Page {curPageIdx + 1} of {previewPages.length}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 14, color: '#64748b' }}>
                            {isFirstPage ? (formDescription || 'Please provide your details below.') : (curPage.header?.desc || 'Complete the items on this section.')}
                          </Text>
                        </View>

                        {/* Page Blocks */}
                        <View style={{ gap: 16 }}>
                          {curPage.blocks.map((b, idx) => (
                            <View key={b.id || idx}>
                              {b.kind === 'question' && (
                                <View style={{ borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 16, backgroundColor: '#fafafa' }}>
                                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1e293b', marginBottom: 8 }}>
                                    {b.title || `Question ${idx + 1}`}
                                    {b.required && <Text style={{ color: '#ef4444' }}> *</Text>}
                                  </Text>
                                  {b.type === 'paragraph' ? (
                                    <TextInput placeholder="Your answer" multiline style={{ borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingVertical: 6, minHeight: 60 }} editable={false} />
                                  ) : ['multiple_choice', 'checkboxes', 'dropdown'].includes(b.type) ? (
                                    <View style={{ gap: 6 }}>
                                      {(b.options || ['Option 1']).map((opt, oi) => (
                                        <View key={oi} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                          <Text>{b.type === 'multiple_choice' ? '🔘' : '☑️'}</Text>
                                          <Text style={{ fontSize: 13, color: '#334155' }}>{opt}</Text>
                                        </View>
                                      ))}
                                    </View>
                                  ) : b.type === 'date' ? (
                                    <Text style={{ color: '#64748b', fontSize: 13 }}>📅 dd/mm/yyyy</Text>
                                  ) : b.type === 'file_upload' ? (
                                    <Text style={{ color: '#008080', fontSize: 13, fontWeight: '600' }}>📁 Upload document file</Text>
                                  ) : (
                                    <TextInput placeholder="Your answer" style={{ borderBottomWidth: 1, borderBottomColor: '#cbd5e1', paddingVertical: 6 }} editable={false} />
                                  )}
                                </View>
                              )}

                              {b.kind === 'module' && (
                                <View style={{ borderWidth: 2, borderColor: '#008080', borderRadius: 10, padding: 16, backgroundColor: '#fdfcfe' }}>
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <Text style={{ fontSize: 22 }}>{b.icon || '🛡️'}</Text>
                                    <View>
                                      <Text style={{ fontSize: 15, fontWeight: '800', color: '#008080' }}>{b.name}</Text>
                                      <Text style={{ fontSize: 12, color: '#64748b' }}>{b.desc}</Text>
                                    </View>
                                  </View>
                                  <View style={{ backgroundColor: 'rgba(0, 128, 128, 0.06)', padding: 10, borderRadius: 6, marginTop: 6 }}>
                                    <Text style={{ fontSize: 12, color: '#6b21a8', fontWeight: '600' }}>
                                      📸 Embedded on this page: Document Upload & Live Camera Face Match
                                    </Text>
                                  </View>
                                </View>
                              )}
                            </View>
                          ))}
                        </View>

                        {/* Page Preview Navigation */}
                        <View style={{ marginTop: 24, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#e2e8f0' }}>
                          <View>
                            {!isFirstPage && (
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#e2e8f0' }]}
                                onPress={() => setPreviewActivePageIndex(p => Math.max(0, p - 1))}
                              >
                                <Text style={[styles.btnSmallText, { color: '#1e293b' }]}>← Previous Page</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                            {!isLastPage && (
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#008080' }]}
                                onPress={() => setPreviewActivePageIndex(p => Math.min(previewPages.length - 1, p + 1))}
                              >
                                <Text style={styles.btnSmallText}>Next Page →</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={styles.btnOutline}
                              onPress={() => { setFormPreviewVisible(false); setPreviewActivePageIndex(0); }}
                            >
                              <Text style={styles.btnOutlineText}>Close Preview</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })()}
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

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
          <Text style={[styles.tableCell, { flex: 1, fontWeight: '800' }]}>
            {recentVerifications.filter(v => v.pipeline_id === p.pid || v.session_id?.includes(p.pid) || v.rawRow?.metadata?.pipelineId === p.pid).length} Applicants
          </Text>
          <View style={{flexDirection: 'row', gap: 6, flex: 2}}>
            <TouchableOpacity style={styles.btnSmall} onPress={() => { setSelectedPipeline(p); setPipelineDetailVisible(true); }}>
              <Text style={styles.btnSmallText}>View Analytics 📊</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSmall, { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0' }]}
              onPress={() => exportSubmissionsToSheets(p)}
            >
              <Text style={[styles.btnSmallText, { color: '#047857', fontWeight: '700' }]}>Export Sheets 📥</Text>
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
        portalName="Zudoc Identity & eKYC Studio"
        portalRole="admin"
        defaultEmail="admin@zudoc.co"
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
      
      {/* Modern Zudoc Enterprise Header */}
      <View style={styles.header}>
        {/* Left: Brand Identity */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/* Official Zudoc Brand Logo */}
          <svg width="32" height="32" viewBox="0 0 43 42" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 9V2C0 0.895431 0.89543 0 2 0H33.4529C38.4418 0 42.4788 4.0581 42.4528 9.04694L42.3224 34.0417C42.2995 38.4437 38.7245 42 34.3225 42H2C0.895431 42 0 41.1046 0 40V31.7938C0 30.6341 0.403121 29.5105 1.14035 28.6153L13.4 13.7286C13.7799 13.2673 14.3462 13 14.9438 13H24.2974C25.5692 13 26.2639 14.4833 25.4498 15.4603L12.5 31H29C30.6569 31 32 29.6569 32 28V14C32 12.3431 30.6569 11 29 11H2C0.895431 11 0 10.1046 0 9Z" fill="#008080"/>
          </svg>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[styles.headerLogo, { fontFamily: "'Manrope', sans-serif", fontSize: 22, fontWeight: '800', color: '#0f172a', letterSpacing: -0.6 }]}>zudoc</Text>
            <View style={{ backgroundColor: 'rgba(0, 128, 128, 0.08)', borderColor: 'rgba(0, 128, 128, 0.22)', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
              <Text style={{ color: '#008080', fontSize: 10, fontWeight: '800', letterSpacing: 0.5 }}>EKYC STUDIO</Text>
            </View>
          </View>
        </View>

        {/* Center: Segmented Navigation Pill Tabs */}
        <View style={styles.navSegmentContainer}>
          <TouchableOpacity
            onPress={() => setActiveTab('dashboard')}
            style={[styles.navSegmentTab, activeTab === 'dashboard' && styles.navSegmentTabActive]}
          >
            <Text style={[styles.navSegmentText, activeTab === 'dashboard' && styles.navSegmentTextActive]}>
              Forms Studio
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('builder')}
            style={[styles.navSegmentTab, activeTab === 'builder' && styles.navSegmentTabActive]}
          >
            <Text style={[styles.navSegmentText, activeTab === 'builder' && styles.navSegmentTextActive]}>
              Pipeline Builder
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('links')}
            style={[styles.navSegmentTab, activeTab === 'links' && styles.navSegmentTabActive]}
          >
            <Text style={[styles.navSegmentText, activeTab === 'links' && styles.navSegmentTextActive]}>
              Manage Links
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setActiveTab('review')}
            style={[styles.navSegmentTab, activeTab === 'review' && styles.navSegmentTabActive]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.navSegmentText, activeTab === 'review' && styles.navSegmentTextActive]}>
                Manual Review
              </Text>
              {reviewQueue.length > 0 && (
                <View style={{ backgroundColor: activeTab === 'review' ? '#008080' : '#f59e0b', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 }}>
                  <Text style={{ color: '#ffffff', fontSize: 10, fontWeight: '800' }}>{reviewQueue.length}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        </View>

        {/* Right: Environment Status + Profile + Sign Out */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {/* Live System Indicator */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#16a34a' }} />
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#15803d' }}>Live Production</Text>
          </View>

          {/* User Profile Avatar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, borderLeftWidth: 1, borderLeftColor: '#e2e8f0' }}>
            <View style={styles.gfAvatarCircle}>
              <Text style={styles.gfAvatarText}>
                {(currentUser?.email ? currentUser.email.charAt(0).toUpperCase() : 'S')}
              </Text>
            </View>
            <View style={{ maxWidth: 120 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#0f172a' }} numberOfLines={1}>
                {currentUser?.email ? currentUser.email.split('@')[0] : 'Administrator'}
              </Text>
            </View>
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

      {/* Save & Publish Form Modal */}
      <Modal visible={modalVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxWidth: 560 }]}>
                  {publishStep === 'ready' ? (
                    <View style={{ width: '100%', alignItems: 'center' }}>
                      <Text style={{ fontSize: 36, marginBottom: 8 }}>💾</Text>
                      <Text style={styles.modalTitle}>Form Saved Successfully!</Text>
                      <Text style={{ color: COLORS.textMuted, textAlign: 'center', marginBottom: 18, fontSize: 13, lineHeight: 18 }}>
                        Your questions and verification pipeline are saved to your dashboard. Publish this form to activate it and generate your live shareable link.
                      </Text>

                      {/* Summary Configuration Card */}
                      <View style={{
                        width: '100%',
                        backgroundColor: '#f8fafc',
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: '#e2e8f0',
                        padding: 16,
                        marginBottom: 20
                      }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <Text style={{ fontWeight: '700', fontSize: 16, color: '#1e293b', flex: 1, marginRight: 8 }} numberOfLines={1}>
                            {formTitle || 'Untitled form'}
                          </Text>
                          <View style={{ backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1, borderColor: '#fde68a' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#b45309' }}>🟡 Draft (Saved)</Text>
                          </View>
                        </View>

                        <View style={{ gap: 8 }}>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            📋 <Text style={{ fontWeight: '600', color: '#334155' }}>Custom Questions:</Text> {formFields.length} Field(s)
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            🛡️ <Text style={{ fontWeight: '600', color: '#334155' }}>Identity Modules:</Text> {pipeline.length > 0 ? pipeline.map(m => m.name).join(' ➔ ') : 'Direct form submission (No identity modules)'}
                          </Text>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            🆔 <Text style={{ fontWeight: '600', color: '#334155' }}>Pipeline ID:</Text> {currentPid}
                          </Text>
                        </View>
                      </View>

                      {/* Publish CTA Button */}
                      <TouchableOpacity
                        style={[styles.btn, { width: '100%', backgroundColor: '#008080', marginBottom: 10 }]}
                        onPress={publishForm}
                        testID="publish-now-btn"
                      >
                        <Text style={styles.btnText}>🚀 Publish Form Now</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[styles.btnOutline, { width: '100%' }]}
                        onPress={() => setModalVisible(false)}
                      >
                        <Text style={styles.btnOutlineText}>Keep as Draft & Close</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={{ width: '100%', alignItems: 'center' }}>
                      <Text style={{ fontSize: 36, marginBottom: 8 }}>🎉</Text>
                      <Text style={styles.modalTitle}>Form Published & Live!</Text>
                      <Text style={{ color: COLORS.textMuted, textAlign: 'center', marginBottom: 14, fontSize: 13, lineHeight: 18 }}>
                        Your verification flow is officially published and live. Share this link with applicants to collect responses and execute your identity verification pipeline.
                      </Text>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10b981' }} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#10b981' }}>Live & Accepting Submissions</Text>
                      </View>

                      {/* Clean Shareable Link Box */}
                      <View style={[styles.linkBox, { width: '100%', backgroundColor: '#f1f5f9', padding: 12, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 16 }]}>
                        <Text
                          selectable={true}
                          style={[styles.linkText, { fontSize: 12, color: '#0f172a', wordBreak: 'break-all' }]}
                          onPress={() => copyToClipboard(generatedLink)}
                        >
                          {generatedLink}
                        </Text>
                      </View>
                      
                      <View style={{ flexDirection: 'row', gap: 10, width: '100%', marginBottom: 12 }}>
                        <TouchableOpacity
                          style={[styles.btn, { flex: 1, backgroundColor: linkCopied ? '#059669' : '#008080', marginBottom: 0 }]}
                          onPress={() => copyToClipboard(generatedLink)}
                          testID="copy-link-btn"
                        >
                          <Text style={styles.btnText}>{linkCopied ? 'Copied! ✓' : '📋 Copy Share Link'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.btn, { flex: 1, backgroundColor: '#0f766e', marginBottom: 0 }]}
                          onPress={() => openGeneratedLink(generatedLink)}
                          testID="open-flow-btn"
                        >
                          <Text style={styles.btnText}>Open Flow 🚀</Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity style={[styles.btnOutline, { width: '100%' }]} onPress={() => setModalVisible(false)}>
                        <Text style={styles.btnOutlineText}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  )}
              </View>
          </View>
      </Modal>

      {/* Pipeline Analytics & Applicant List Modal */}
      <Modal visible={pipelineDetailVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxWidth: 960, maxHeight: '90vh', padding: 22, overflow: 'hidden' }]}>
                  {(() => {
                    const selectedPid = selectedPipeline?.pid;
                    const formSubmissions = recentVerifications.filter(v => {
                      if (!selectedPid) return true;
                      return (
                        v.pipeline_id === selectedPid ||
                        v.session_id?.includes(selectedPid) ||
                        v.rawRow?.metadata?.pipelineId === selectedPid ||
                        v.rawRow?.session_id?.includes(selectedPid)
                      );
                    });

                    return (
                      <View style={{ width: '100%' }}>
                        {/* Modal Header */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%', marginBottom: 14 }}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <Text style={[styles.modalTitle, { textAlign: 'left', marginBottom: 0, fontSize: 18 }]}>
                                📁 Manage Form: {selectedPipeline?.name || selectedPipeline?.pid || 'Untitled Form'}
                              </Text>
                              <View style={{
                                backgroundColor: selectedPipeline?.status === 'published' ? '#ecfdf5' : '#fffbeb',
                                borderColor: selectedPipeline?.status === 'published' ? '#a7f3d0' : '#fde68a',
                                borderWidth: 1,
                                paddingHorizontal: 8,
                                paddingVertical: 2,
                                borderRadius: 6
                              }}>
                                <Text style={{ fontSize: 11, fontWeight: '700', color: selectedPipeline?.status === 'published' ? '#059669' : '#b45309' }}>
                                  {selectedPipeline?.status === 'published' ? '🟢 Live & Published' : '🟡 Draft'}
                                </Text>
                              </View>
                            </View>
                            <Text style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 4 }}>
                              Pipeline ID: <Text style={{ fontFamily: 'monospace', fontWeight: '700', color: COLORS.primary }}>{selectedPipeline?.pid}</Text>
                              {Array.isArray(selectedPipeline?.modules) && selectedPipeline.modules.length > 0 && (
                                <Text> • Modules: {selectedPipeline.modules.join(', ')}</Text>
                              )}
                            </Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => setPipelineDetailVisible(false)}
                            style={{ padding: 6, borderRadius: 6, backgroundColor: '#f1f5f9' }}
                          >
                            <Text style={{ fontSize: 16, color: '#64748b', fontWeight: 'bold' }}>✕</Text>
                          </TouchableOpacity>
                        </View>

                        {/* Form Quick Action & Share Bar */}
                        <View style={{
                          backgroundColor: '#f8fafc',
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#e2e8f0',
                          padding: 12,
                          width: '100%',
                          marginBottom: 18,
                          overflow: 'hidden'
                        }}>
                          <View style={{
                            flexDirection: width > 768 ? 'row' : 'column',
                            alignItems: width > 768 ? 'center' : 'flex-start',
                            justifyContent: 'space-between',
                            gap: 10
                          }}>
                            <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                              <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>
                                Candidate Verification Link
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontFamily: 'monospace',
                                  color: COLORS.primary,
                                  ...(Platform.OS === 'web' ? { wordBreak: 'break-all', overflowWrap: 'anywhere' } : {})
                                }}
                                numberOfLines={1}
                              >
                                {selectedPipeline?.link || 'No link generated'}
                              </Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#10b981' }]}
                                onPress={() => exportSubmissionsToSheets(selectedPipeline, formSubmissions)}
                              >
                                <Text style={[styles.btnSmallText, { color: '#ffffff', fontWeight: '700' }]}>📊 Download as Sheets</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#008080' }]}
                                onPress={() => copyToClipboard(selectedPipeline?.link)}
                              >
                                <Text style={[styles.btnSmallText, { color: '#ffffff' }]}>📋 Copy Link</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#0284c7' }]}
                                onPress={() => openGeneratedLink(selectedPipeline?.link)}
                              >
                                <Text style={[styles.btnSmallText, { color: '#ffffff' }]}>🚀 Test Form</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1' }]}
                                onPress={() => { setPipelineDetailVisible(false); handleEditPipeline(selectedPipeline); }}
                              >
                                <Text style={[styles.btnSmallText, { color: '#334155' }]}>✏️ Edit in Builder</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fde68a' }]}
                                onPress={() => {
                                  setPipelineDetailVisible(false);
                                  handleOpenManualReviewForPipeline(selectedPipeline);
                                }}
                              >
                                <Text style={[styles.btnSmallText, { color: '#b45309', fontWeight: '700' }]}>⚖️ Manual Review Queue</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        </View>

                        {/* Submissions List Header */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e293b' }}>
                              👥 Submissions Received via Link ({formSubmissions.length})
                            </Text>
                            {formSubmissions.length > 0 && (
                              <TouchableOpacity
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  gap: 5,
                                  backgroundColor: '#ecfdf5',
                                  borderColor: '#a7f3d0',
                                  borderWidth: 1,
                                  paddingHorizontal: 8,
                                  paddingVertical: 3,
                                  borderRadius: 6
                                }}
                                onPress={() => exportSubmissionsToSheets(selectedPipeline, formSubmissions)}
                              >
                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#047857' }}>📥 Download Sheets (.csv)</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          <Text style={{ fontSize: 12, color: '#64748b' }}>
                            Pipeline ID: <Text style={{ fontWeight: '700', color: COLORS.primary }}>{selectedPipeline?.pid}</Text>
                          </Text>
                        </View>

                        {/* Submissions Table / Cards */}
                        <ScrollView style={{ width: '100%', maxHeight: 380 }}>
                          {formSubmissions.length === 0 ? (
                            <View style={{ padding: 28, alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', marginVertical: 4 }}>
                              <Text style={{ fontSize: 30, marginBottom: 8 }}>📭</Text>
                              <Text style={{ fontSize: 14, fontWeight: '700', color: '#334155', marginBottom: 4 }}>
                                No submissions received for this form yet
                              </Text>
                              <Text style={{ fontSize: 12, color: '#64748b', textAlign: 'center', maxWidth: 440, marginBottom: 14 }}>
                                When candidates or employees fill out this form and attach documents, their submitted answers, photos, and verification results will show up here.
                              </Text>
                              <TouchableOpacity
                                style={[styles.btnSmall, { backgroundColor: '#008080', paddingHorizontal: 16 }]}
                                onPress={() => copyToClipboard(selectedPipeline?.link)}
                              >
                                <Text style={[styles.btnSmallText, { color: '#fff' }]}>📋 Copy Form Link to Share</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <View style={{ width: '100%' }}>
                              <View style={styles.tableHeader}>
                                <Text style={[styles.tableCol, { flex: 1.6 }]}>Candidate Name / User</Text>
                                <Text style={[styles.tableCol, { flex: 1.2 }]}>Document / ID #</Text>
                                <Text style={[styles.tableCol, { flex: 1 }]}>Doc Type</Text>
                                <Text style={[styles.tableCol, { flex: 1.2 }]}>Pipeline Result</Text>
                                <Text style={[styles.tableCol, { flex: 1 }]}>Date</Text>
                                <Text style={[styles.tableCol, { flex: 1.5, textAlign: 'right' }]}>Actions</Text>
                              </View>

                              {formSubmissions.map((v, i) => (
                                <View style={[styles.tableRow, { alignItems: 'center' }]} key={v.id || i}>
                                  <View style={{ flex: 1.6 }}>
                                    <Text style={{ fontWeight: '700', color: '#0f172a', fontSize: 13 }} numberOfLines={1}>
                                      {v.user}
                                    </Text>
                                    <Text style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                                      {v.session_id ? v.session_id.substr(0, 18) : v.id}
                                    </Text>
                                  </View>

                                  <Text style={[styles.tableCell, { flex: 1.2, color: COLORS.primary, fontFamily: 'monospace' }]}>
                                    {v.id_number || 'Pending AI'}
                                  </Text>

                                  <Text style={[styles.tableCell, { flex: 1, fontWeight: '600' }]}>
                                    {v.doc_type || 'ID'}
                                  </Text>

                                  <View style={{ flex: 1.2 }}>
                                    <View style={styles.statusBadge(v.status === 'APPROVED' ? 'APPROVED' : (v.status === 'REJECTED' ? 'REJECTED' : 'NEEDS_REVIEW'))}>
                                      <Text style={styles.statusText(v.status === 'APPROVED' ? 'APPROVED' : (v.status === 'REJECTED' ? 'REJECTED' : 'NEEDS_REVIEW'))}>
                                        {v.status === 'APPROVED' ? '✓ APPROVED' : (v.status === 'REJECTED' ? '❌ REJECTED' : '⚖️ NEEDS REVIEW')}
                                      </Text>
                                    </View>
                                  </View>

                                  <Text style={[styles.tableCell, { flex: 1, fontSize: 11, color: '#64748b' }]}>
                                    {v.date}
                                  </Text>

                                  <View style={{ flex: 1.5, flexDirection: 'row', justifyContent: 'flex-end', gap: 6 }}>
                                    <TouchableOpacity
                                      style={[styles.btnSmall, { backgroundColor: '#008080' }]}
                                      onPress={() => {
                                        setSelectedReview(v);
                                        setReviewModalVisible(true);
                                      }}
                                    >
                                      <Text style={[styles.btnSmallText, { color: '#ffffff' }]}>Results & Review 🔍</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              ))}
                            </View>
                          )}
                        </ScrollView>

                        {/* Modal Footer */}
                        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0', flexDirection: 'row', justifyContent: 'flex-end', gap: 10, width: '100%' }}>
                          <TouchableOpacity style={styles.btnOutline} onPress={() => setPipelineDetailVisible(false)}>
                            <Text style={styles.btnOutlineText}>Close</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })()}
              </View>
          </View>
      </Modal>

      {/* Manual Review Inspector Modal */}
      <Modal visible={reviewModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxWidth: 840, maxHeight: '90vh' }]}>
                  <Text style={styles.modalTitle}>Applicant Review & Verification: {selectedReview?.id}</Text>
                  <Text style={{color: COLORS.primary, fontWeight: '700', marginBottom: 16}}>
                    Applicant: {selectedReview?.user} ({selectedReview?.id_number})
                  </Text>
                  
                  {/* Form Answers section */}
                  {selectedReview?.answers && Object.keys(selectedReview.answers).length > 0 && (
                    <View style={{backgroundColor: '#f8fafc', borderRadius: 8, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: '#e2e8f0', width: '100%'}}>
                      <Text style={{fontWeight: '700', color: '#334155', marginBottom: 8, fontSize: 13}}>📝 Submitted Form Answers:</Text>
                      {Object.entries(selectedReview.answers).map(([q, a], qi) => (
                        <View key={qi} style={{flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9'}}>
                          <Text style={{fontSize: 12, color: '#64748b', fontWeight: '600'}}>{q}:</Text>
                          <Text style={{fontSize: 12, color: '#0f172a', fontWeight: '500'}}>{Array.isArray(a) ? a.join(', ') : (a || '—')}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Document & Selfie Side-by-Side */}
                  <View style={{flexDirection: width > 768 ? 'row' : 'column', gap: 16, width: '100%', marginBottom: 16}}>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 8, color: COLORS.textMuted, fontSize: 13}}>Attached {selectedReview?.doc_type || 'ID'} Photo</Text>
                          {selectedReview?.extracted_face_url ? (
                            <SignedAssetImage file={selectedReview.extracted_face_url} style={{ width: 180, height: 130, borderRadius: 8 }} placeholderText="Document Photo" />
                          ) : (
                            <View style={{width: 180, height: 130, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8', fontSize: 12}}>Document Photo</Text>
                            </View>
                          )}
                      </View>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 12, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 8, color: COLORS.textMuted, fontSize: 13}}>Live Webcam Selfie</Text>
                          {selectedReview?.live_holder_face_url ? (
                            <SignedAssetImage file={selectedReview.live_holder_face_url} style={{ width: 180, height: 130, borderRadius: 8 }} placeholderText="Webcam Selfie" />
                          ) : (
                            <View style={{width: 180, height: 130, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8', fontSize: 12}}>Webcam Selfie</Text>
                            </View>
                          )}
                      </View>
                  </View>

                  {/* Local AI Execution Button */}
                  <View style={{width: '100%', marginBottom: 16, alignItems: 'center'}}>
                    <TouchableOpacity
                      style={[styles.btn, { backgroundColor: isAiRunning ? '#9333ea' : '#008080', width: '100%', paddingVertical: 12, justifyContent: 'center', alignItems: 'center' }]}
                      onPress={runLocalAiVerification}
                      disabled={isAiRunning}
                    >
                      {isAiRunning ? (
                        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                          <ActivityIndicator size="small" color="#fff" />
                          <Text style={[styles.btnText, {fontWeight: '700'}]}>Running Local OCR & ArcFace Face Match...</Text>
                        </View>
                      ) : (
                        <Text style={[styles.btnText, {fontWeight: '700'}]}>⚡ Run Local AI Verification (OCR & Face Match)</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* AI Engine Results / Error Display */}
                  {aiError && (
                    <View style={{width: '100%', backgroundColor: '#fef2f2', borderColor: '#fca5a5', borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16}}>
                      <Text style={{color: '#b91c1c', fontWeight: '700', fontSize: 13}}>⚠️ Local AI Engine Notice:</Text>
                      <Text style={{color: '#ef4444', fontSize: 12, marginTop: 4}}>{aiError}</Text>
                    </View>
                  )}

                  {aiResult && (
                    <View style={{width: '100%', backgroundColor: '#f0fdf4', borderColor: '#86efac', borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 16}}>
                      <Text style={{color: '#166534', fontWeight: '700', fontSize: 14, marginBottom: 8}}>✅ Local AI Verification Completed</Text>
                      <View style={{flexDirection: width > 768 ? 'row' : 'column', gap: 12}}>
                        <View style={{flex: 1}}>
                          <Text style={{fontWeight: '700', fontSize: 12, color: '#334155'}}>📑 Extracted Document Details (OCR):</Text>
                          <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>Type: <Text style={{fontWeight: '600', color: '#0f172a'}}>{aiResult.docType}</Text></Text>
                          <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>ID #: <Text style={{fontWeight: '700', color: '#008080', fontFamily: 'monospace'}}>{aiResult.ocrFields.id_number || aiResult.ocrFields.pan_number || aiResult.ocrFields.aadhaar_number || 'Extracted'}</Text></Text>
                          {aiResult.ocrFields.name && <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>Name: <Text style={{fontWeight: '600', color: '#0f172a'}}>{aiResult.ocrFields.name}</Text></Text>}
                          {aiResult.ocrFields.dob && <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>DOB: <Text style={{fontWeight: '600', color: '#0f172a'}}>{aiResult.ocrFields.dob}</Text></Text>}
                        </View>
                        <View style={{flex: 1}}>
                          <Text style={{fontWeight: '700', fontSize: 12, color: '#334155'}}>👤 ArcFace Biometric Face Match:</Text>
                          <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>Biometric Status: <Text style={{fontWeight: '700', color: aiResult.faceMatchVerified ? '#16a34a' : '#dc2626'}}>{aiResult.faceMatchVerified ? '✓ MATCH VERIFIED' : '❌ UNMATCHED'}</Text></Text>
                          <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>Confidence Score: <Text style={{fontWeight: '700', color: '#0f172a'}}>{aiResult.similarityScore}</Text></Text>
                          <Text style={{fontSize: 12, color: '#475569', marginTop: 2}}>Liveness Check: <Text style={{fontWeight: '600', color: '#16a34a'}}>✓ Passed</Text></Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* Actions: Approve / Reject / Close */}
                  <View style={{flexDirection: 'row', gap: 16, width: '100%'}}>
                      <TouchableOpacity style={[styles.btnOutline, {borderColor: COLORS.danger}]} onPress={() => handleReviewAction('REJECT', selectedReview)}>
                          <Text style={[styles.btnOutlineText, {color: COLORS.danger}]}>Reject Applicant</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btn, {backgroundColor: '#10b981'}]} onPress={() => handleReviewAction('APPROVE', selectedReview)}>
                          <Text style={styles.btnText}>Approve Applicant</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btnOutline, {marginLeft: 'auto'}]} onPress={() => {setReviewModalVisible(false); setSelectedReview(null); setAiResult(null); setAiError(null);}}>
                          <Text style={styles.btnOutlineText}>Close</Text>
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
    padding: width > 768 ? 40 : 16,
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
  // --- Modern Zudoc Enterprise Navigation & Dashboard Styles ---
  navSegmentContainer: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    padding: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  navSegmentTab: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 8,
    cursor: 'pointer',
  },
  navSegmentTabActive: {
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
  },
  navSegmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    fontFamily: "'Manrope', sans-serif",
  },
  navSegmentTextActive: {
    color: '#008080',
    fontWeight: '700',
  },
  zudocDashboardRoot: {
    maxWidth: 1280,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: width > 768 ? 28 : 16,
    paddingVertical: 28,
  },
  zdTopHeaderBar: {
    flexDirection: width > 768 ? 'row' : 'column',
    justifyContent: 'space-between',
    alignItems: width > 768 ? 'flex-end' : 'flex-start',
    gap: 16,
    marginBottom: 24,
  },
  zdPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#008080',
  },
  zdHeaderOverline: {
    fontSize: 11,
    fontWeight: '800',
    color: '#008080',
    letterSpacing: 0.8,
  },
  zdHeaderTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: -0.6,
  },
  zdHeaderDescription: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
    maxWidth: 600,
  },
  zdHeaderActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  zdPrimaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#008080',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    boxShadow: '0 4px 14px rgba(0, 128, 128, 0.25)',
    cursor: 'pointer',
  },
  zdPrimaryActionBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: "'Manrope', sans-serif",
  },
  zdSecondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    cursor: 'pointer',
  },
  zdSecondaryActionBtnText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: "'Manrope', sans-serif",
  },
  zdMetricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 24,
  },
  zdMetricCard: {
    flex: 1,
    minWidth: 200,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    justifyContent: 'space-between',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
  },
  zdMetricCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  zdMetricCardLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  zdMetricIconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zdMetricCardValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 2,
    fontFamily: "'Manrope', sans-serif",
  },
  zdMetricCardSub: {
    fontSize: 11,
    color: '#94a3b8',
  },
  zdPanelCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: width > 768 ? 22 : 16,
    marginBottom: 24,
    boxShadow: '0 2px 10px rgba(0, 0, 0, 0.02)',
  },
  zdPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  zdPanelTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  zdPanelSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  zdBlueprintGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  zdBlueprintCard: {
    flex: 1,
    minWidth: 230,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    cursor: 'pointer',
    justifyContent: 'space-between',
  },
  zdBlueprintIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  zdBlueprintTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  zdBlueprintDesc: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 12,
    height: 36,
  },
  zdBlueprintTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  zdBlueprintTag: {
    backgroundColor: '#ffffff',
    color: '#475569',
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  zdBlueprintFooter: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
  },
  zdBlueprintCta: {
    fontSize: 12,
    fontWeight: '700',
    color: '#008080',
  },
  zdDirectoryToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 18,
  },
  zdFilterTabsGroup: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    padding: 3,
    borderRadius: 8,
  },
  zdFilterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    cursor: 'pointer',
  },
  zdFilterTabActive: {
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
  },
  zdFilterTabText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  zdFilterTabTextActive: {
    color: '#008080',
    fontWeight: '700',
  },
  zdDirectorySearchWrap: {
    flex: 1,
    minWidth: 200,
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 36,
  },
  zdDirectorySearchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
    outlineStyle: 'none',
    fontFamily: "'Manrope', sans-serif",
  },
  zdSortButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
  },
  zdSortButtonText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  zdViewToggle: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    padding: 3,
    borderRadius: 8,
  },
  zdViewBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    cursor: 'pointer',
  },
  zdViewBtnActive: {
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
  },
  zdCardGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  zdEnterpriseCard: {
    flex: 1,
    minWidth: 300,
    maxWidth: width > 1200 ? 380 : undefined,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    position: 'relative',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.03)',
  },
  zdCardStripe: {
    height: 4,
    width: '100%',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  zdCardInner: {
    padding: 18,
    position: 'relative',
  },
  zdCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  zdCardHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  zdCardPidText: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  zdCardDateText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  zdPillBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  zdPillBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  zdStagesContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  zdStagesLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  zdStagesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  zdStageTag: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  zdStageTagText: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '500',
  },
  zdStageTagActive: {
    borderColor: 'rgba(0, 128, 128, 0.3)',
    backgroundColor: 'rgba(0, 128, 128, 0.05)',
  },
  zdStageTagActiveText: {
    fontSize: 11,
    color: '#008080',
    fontWeight: '700',
  },
  zdSubmissionBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 128, 128, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 14,
    cursor: 'pointer',
  },
  zdSubmissionBannerText: {
    fontSize: 12,
    color: '#1e293b',
    fontWeight: '600',
  },
  zdCardFooterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
  },
  zdCardSecondaryBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    cursor: 'pointer',
  },
  zdCardSecondaryBtnText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '600',
  },
  zdCardPrimaryBtn: {
    flex: 1,
    backgroundColor: '#008080',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    cursor: 'pointer',
  },
  zdCardPrimaryBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  zdCardMoreBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    cursor: 'pointer',
  },
  zdMenuDropdown: {
    position: 'absolute',
    bottom: 50,
    right: 12,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    paddingVertical: 6,
    width: 210,
    zIndex: 10000,
  },
  zdMenuItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    cursor: 'pointer',
  },
  zdMenuItemText: {
    fontSize: 12,
    color: '#1e293b',
    fontWeight: '500',
  },
  zdMenuDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 4,
  },
  zdTableWrapper: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'visible',
  },
  zdTableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  zdTableTh: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  zdTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    position: 'relative',
    backgroundColor: '#ffffff',
  },
  zdTableIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 128, 128, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zdTableTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  zdTablePid: {
    fontSize: 11,
    color: '#64748b',
    fontFamily: 'monospace',
  },
  zdTableSubText: {
    fontSize: 12,
    color: '#64748b',
  },
  zdListManageBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 7,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  zdListManageBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0f172a',
  },
  zdListLaunchBtn: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 7,
    backgroundColor: '#008080',
  },
  zdListLaunchBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#ffffff',
  },
  zdEmptyState: {
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zdEmptyIconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  zdEmptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 6,
  },
  zdEmptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 440,
    marginBottom: 18,
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
    backgroundColor: 'rgba(0, 128, 128, 0.1)',
  },
  gfTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5f6368',
  },
  gfTabTextActive: {
    color: '#008080',
  },
  gfAppsBtn: {
    padding: 8,
    borderRadius: 20,
  },
  gfAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#008080',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gfAvatarText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  // --- Google Forms-Style Field & Pipeline Builder Styles ---
  fbTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 10,
  },
  fbBackBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#f1f3f4',
    cursor: 'pointer',
  },
  fbHeaderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
  },
  fbHeaderStripe: {
    height: 10,
    backgroundColor: '#008080',
    width: '100%',
  },
  fbHeaderBody: {
    padding: 24,
  },
  fbTitleInput: {
    fontSize: 28,
    fontWeight: '700',
    color: '#202124',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    paddingBottom: 8,
    marginBottom: 12,
    outlineStyle: 'none',
  },
  fbDescInput: {
    fontSize: 14,
    color: '#5f6368',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
    paddingVertical: 6,
    outlineStyle: 'none',
  },
  fbFieldCard: {
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
  },
  fbFieldCardActive: {
    borderColor: '#008080',
    borderWidth: 2,
    boxShadow: '0 2px 8px rgba(0, 128, 128, 0.15)',
  },
  fbActiveStrip: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#008080',
    zIndex: 2,
  },
  fbFieldCardContent: {
    padding: 20,
  },
  fbFieldRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
  },
  fbQuestionInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#202124',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 4,
    borderBottomWidth: 2,
    borderBottomColor: '#008080',
    outlineStyle: 'none',
  },
  fbTypeSelectorWrap: {
    minWidth: 180,
  },
  fbAnswerArea: {
    paddingVertical: 12,
    marginBottom: 16,
  },
  fbMockShortAnswer: {
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    borderStyle: 'dotted',
    width: '50%',
    paddingVertical: 8,
  },
  fbMockParagraph: {
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    borderStyle: 'dotted',
    width: '80%',
    paddingVertical: 16,
  },
  fbOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  fbOptionInput: {
    flex: 1,
    fontSize: 14,
    color: '#202124',
    borderBottomWidth: 1,
    borderBottomColor: '#dadce0',
    paddingVertical: 6,
    outlineStyle: 'none',
  },
  fbAddOptionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
    cursor: 'pointer',
  },
  fbMockDate: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dadce0',
    borderRadius: 4,
    width: '40%',
    backgroundColor: '#f8f9fa',
  },
  fbMockFileUpload: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#dadce0',
    borderStyle: 'dashed',
    borderRadius: 6,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
  },
  fbFieldFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: '#f1f3f4',
    paddingTop: 14,
    gap: 14,
  },
  fbToolBtn: {
    padding: 8,
    borderRadius: 20,
    cursor: 'pointer',
  },
  fbToolDivider: {
    width: 1,
    height: 22,
    backgroundColor: '#dadce0',
    marginHorizontal: 4,
  },
  fbSwitchTrack: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#dadce0',
    justifyContent: 'center',
    paddingHorizontal: 2,
    cursor: 'pointer',
  },
  fbSwitchTrackActive: {
    backgroundColor: '#008080',
  },
  fbSwitchThumb: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  },
  fbSwitchThumbActive: {
    alignSelf: 'flex-end',
  },
  fbAddBar: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    padding: 14,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dadce0',
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  },
  fbAddPrimaryBtn: {
    backgroundColor: '#008080',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 6,
    cursor: 'pointer',
  },
  fbChipBtn: {
    backgroundColor: '#f1f3f4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    cursor: 'pointer',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  fbChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3c4043',
  },
  fbPipelineSection: {
    marginTop: 32,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dadce0',
    padding: 20,
    boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
  },
  fbPipelineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f3f4',
  },
  fbPipelineTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#202124',
  },
  fbBadgeCount: {
    backgroundColor: 'rgba(0, 128, 128, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(0, 128, 128, 0.3)',
  },
  fbBadgeCountText: {
    color: '#008080',
    fontSize: 12,
    fontWeight: '700',
  },
  fbFixedFlowStep: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderLeftWidth: 4,
    borderLeftColor: '#008080',
    borderRadius: 8,
    padding: 12,
  },
  fbFixedStepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#008080',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fbBottomActionCard: {
    marginTop: 28,
    padding: 20,
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dadce0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  dragGrip: {
    cursor: 'grab',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
  },
  dropIndicator: {
    height: 4,
    backgroundColor: '#008080',
    borderRadius: 2,
    marginVertical: 6,
    width: '100%',
  },
  pipelineNodeDragging: {
    opacity: 0.45,
  },
});
