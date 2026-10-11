import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Dimensions, Modal, Image } from 'react-native';

const { width } = Dimensions.get('window');

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

export default function App() {
  const isWeb = width > 768;
  const [activeTab, setActiveTab] = useState('dashboard');

  // --- Dashboard State ---
  const [stats, setStats] = useState({ pipelines_built: 0, links_generated: 0, verifications_completed: 0 });
  const [recentVerifications, setRecentVerifications] = useState([]);
  const [rawSupabaseRows, setRawSupabaseRows] = useState([]);

  // --- Pipeline Builder & Manage Links State ---
  const [availableModules, setAvailableModules] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [savedPipelines, setSavedPipelines] = useState([]);
  const [selectedPipeline, setSelectedPipeline] = useState(null);
  const [pipelineDetailVisible, setPipelineDetailVisible] = useState(false);
  
  const [generatedLink, setGeneratedLink] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  // --- Manual Review State ---
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedReview, setSelectedReview] = useState(null);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  useEffect(() => {
    // 1. Load local storage persistence first
    let localStats = { pipelines_built: 0, links_generated: 0, verifications_completed: 0 };
    let localVers = [];
    let localPipes = [];

    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const savedStats = localStorage.getItem('verifyyy_admin_stats');
        if (savedStats) localStats = JSON.parse(savedStats);

        const savedVers = localStorage.getItem('verifyyy_recent_verifications');
        if (savedVers) localVers = JSON.parse(savedVers);

        const savedP = localStorage.getItem('verifyyy_saved_pipelines');
        if (savedP) localPipes = JSON.parse(savedP);
      }
    } catch (e) {
      console.warn("Could not load from localStorage:", e);
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
  }, []);

  const fetchSupabaseData = async () => {
    try {
      const resp = await fetch('http://localhost:5001/api/v1/supabase/list');
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
            extracted_face_url: r.extracted_face_url ? `http://localhost:5001${r.extracted_face_url}` : null,
            live_holder_face_url: r.live_holder_face_url ? `http://localhost:5001${r.live_holder_face_url}` : null,
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

  const generateLink = () => {
    if (pipeline.length === 0) return;

    const flowParams = pipeline.map(m => m.id).join(',');
    const pid = `FLOW-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const origin = (typeof window !== 'undefined' && window.location && window.location.hostname)
      ? `${window.location.protocol}//${window.location.hostname}:5174`
      : 'http://localhost:5174';

    const link = `${origin}/verify.html?flow=${encodeURIComponent(flowParams)}&pid=${pid}`;
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

  // --- Render 1: Dashboard ---
  const renderDashboard = () => (
    <>
        <View style={styles.hero}>
            <Text style={styles.heroTitle}>Company Dashboard</Text>
            <Text style={styles.heroSubtitle}>Track your verifications, links generated, and pipeline usage in real time.</Text>
        </View>
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

        <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Recent Applicants & Live Verifications</Text>
            </View>
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
                <Text style={{textAlign: 'center', marginTop: 20, color: COLORS.textMuted}}>No recent verifications found.</Text>
            )}
        </View>
    </>
  );

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
            <Text style={styles.cardTitle}>Your Pipeline Canvas</Text>
            
            <View style={styles.pipelineCanvas}>
                {pipeline.length === 0 ? (
                    <View style={styles.canvasEmpty}>
                        <Text style={{color: COLORS.textMuted, textAlign: 'center'}}>Your pipeline is empty.</Text>
                        <Text style={{color: COLORS.textMuted, textAlign: 'center', fontSize: 12, marginTop: 4}}>Add modules from the left panel.</Text>
                    </View>
                ) : (
                    pipeline.map((mod, index) => (
                        <View key={mod.uniqueId} style={{alignItems: 'center'}}>
                            <View style={styles.pipelineNode}>
                                <Text style={styles.pipelineNodeText}>{mod.name}</Text>
                                <TouchableOpacity onPress={() => removeModuleFromPipeline(mod.uniqueId)}>
                                    <Text style={{color: COLORS.danger, fontSize: 18, fontWeight: 'bold'}}>×</Text>
                                </TouchableOpacity>
                            </View>
                            {index < pipeline.length - 1 && (
                                <View style={styles.pipelineConnector} />
                            )}
                        </View>
                    ))
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

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerLogo}>Verifyyy Admin</Text>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
           <TouchableOpacity onPress={() => setActiveTab('dashboard')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'dashboard' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>Dashboard</Text>
           </TouchableOpacity>
           <TouchableOpacity onPress={() => setActiveTab('builder')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'builder' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>Pipeline Builder</Text>
           </TouchableOpacity>
           <TouchableOpacity onPress={() => setActiveTab('links')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'links' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>Manage Links</Text>
           </TouchableOpacity>
           <TouchableOpacity onPress={() => setActiveTab('review')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'review' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>
                 Manual Review {reviewQueue.length > 0 ? `(${reviewQueue.length})` : ''}
               </Text>
           </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
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
                  <TouchableOpacity onPress={() => openGeneratedLink()} style={styles.linkBox}>
                      <Text style={{color: COLORS.primary, fontFamily: 'monospace', textAlign: 'center', textDecorationLine: 'underline'}}>{generatedLink}</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={[styles.btn, {marginBottom: 12, backgroundColor: '#0f766e'}]} onPress={() => openGeneratedLink()}>
                      <Text style={styles.btnText}>Open & Test Verification Flow 🚀</Text>
                  </TouchableOpacity>

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
                      Detailed applicant tracking for link: <Text style={{fontFamily: 'monospace', color: COLORS.primary}}>{selectedPipeline?.link}</Text>
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
                            <Image source={{ uri: selectedReview.extracted_face_url }} style={{ width: 140, height: 140, borderRadius: 8 }} />
                          ) : (
                            <View style={{width: 140, height: 140, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8'}}>Document Face</Text>
                            </View>
                          )}
                      </View>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 12, color: COLORS.textMuted}}>Live Captured Selfie</Text>
                          {selectedReview?.live_holder_face_url ? (
                            <Image source={{ uri: selectedReview.live_holder_face_url }} style={{ width: 140, height: 140, borderRadius: 8 }} />
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
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 48,
    paddingBottom: 20,
    elevation: 4,
  },
  headerLogo: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
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
      minHeight: 320,
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: COLORS.border,
      borderRadius: 16,
      padding: 32,
      backgroundColor: 'rgba(248, 250, 252, 0.5)',
      alignItems: 'center',
      justifyContent: 'center',
  },
  canvasEmpty: {
      alignItems: 'center',
  },
  pipelineNode: {
      backgroundColor: '#fff',
      borderWidth: 1,
      borderColor: COLORS.primaryLight,
      paddingHorizontal: 24,
      paddingVertical: 16,
      borderRadius: 12,
      minWidth: 250,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      elevation: 2,
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
      padding: 40,
      width: '90%',
      maxWidth: 500,
      alignItems: 'center',
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
      padding: 16,
      borderRadius: 12,
      width: '100%',
      marginBottom: 24,
      alignItems: 'center',
  },
});
