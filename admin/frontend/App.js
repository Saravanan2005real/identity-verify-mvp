import { StatusBar } from 'expo-status-bar';
import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Dimensions, Modal } from 'react-native';

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
};

export default function App() {
  const isWeb = width > 768;
  const [activeTab, setActiveTab] = useState('dashboard');

  // --- Dashboard State ---
  const [stats, setStats] = useState({ pipelines_built: 0, links_generated: 0, verifications_completed: 0 });
  const [recentVerifications, setRecentVerifications] = useState([]);

  // --- Pipeline Builder State ---
  const [availableModules, setAvailableModules] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [generatedLink, setGeneratedLink] = useState('');
  const [modalVisible, setModalVisible] = useState(false);

  // --- Manual Review State ---
  const [reviewQueue, setReviewQueue] = useState([]);
  const [selectedReview, setSelectedReview] = useState(null);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  useEffect(() => {
    // Real product: Start with real, empty stats since no verifications exist yet
    setStats({
      pipelines_built: 0,
      links_generated: 0,
      verifications_completed: 0,
    });
    setRecentVerifications([]);

    // Hardcode the available modules for the pipeline builder so we don't need a database
    setAvailableModules([
      {"id": "AADHAAR", "name": "Aadhaar Verification", "desc": "Aadhaar Card Verification"},
      {"id": "PAN", "name": "PAN Verification", "desc": "PAN Card Verification"},
      {"id": "FACE_MATCH", "name": "Face Match", "desc": "Liveness & Face Match"},
      {"id": "LIVENESS", "name": "Liveness Check", "desc": "Liveness Check"},
      {"id": "HUMAN_REVIEW", "name": "Human Review", "desc": "Manual Human Review"}
    ]);

    // Mock data for Manual Review Queue
    setReviewQueue([
      { id: "APP-004", user: "michael.j@example.com", date: "2026-10-08", reason: "Low Confidence Face Match", status: "NEEDS_REVIEW" },
      { id: "APP-005", user: "sarah.w@example.com", date: "2026-10-08", reason: "Blurry Document (Aadhaar)", status: "NEEDS_REVIEW" },
    ]);
  }, []);

  const addModuleToPipeline = (module) => {
    setPipeline([...pipeline, { ...module, uniqueId: Math.random().toString(36).substr(2, 9) }]);
  };

  const removeModuleFromPipeline = (uniqueId) => {
    setPipeline(pipeline.filter(m => m.uniqueId !== uniqueId));
  };

  const generateLink = () => {
    // In a real app, send the pipeline array to the backend to create a VerificationProfile
    const link = `https://api.verifyyy.com/verify/${Math.random().toString(36).substr(2, 9)}`;
    setGeneratedLink(link);
    setModalVisible(true);
  };

  const renderDashboard = () => (
    <>
        <View style={styles.hero}>
            <Text style={styles.heroTitle}>Company Dashboard</Text>
            <Text style={styles.heroSubtitle}>Track your verifications, links generated, and pipeline usage.</Text>
        </View>
        <View style={styles.statsContainer}>
            <View style={styles.statCard}>
                <Text style={styles.statTitle}>Pipelines Built</Text>
                <Text style={styles.statValue}>{stats.pipelines_built}</Text>
            </View>
            <View style={styles.statCard}>
                <Text style={styles.statTitle}>Links Generated</Text>
                <Text style={styles.statValue}>{stats.links_generated}</Text>
            </View>
            <View style={styles.statCard}>
                <Text style={styles.statTitle}>Verified</Text>
                <Text style={styles.statValue}>{stats.verifications_completed}</Text>
            </View>
        </View>
        <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Recent Verifications</Text>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 1 }]}>Application ID</Text>
              <Text style={[styles.tableCol, { flex: 2 }]}>User</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Date</Text>
              <Text style={[styles.tableCol, { flex: 1 }]}>Status</Text>
            </View>
            {recentVerifications.map((v, i) => (
              <View style={styles.tableRow} key={i}>
                <Text style={[styles.tableCell, { flex: 1, fontWeight: '600' }]}>{v.id}</Text>
                <Text style={[styles.tableCell, { flex: 2 }]}>{v.user}</Text>
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

  const renderBuilder = () => (
    <View style={{ flexDirection: isWeb ? 'row' : 'column', gap: 32 }}>
        {/* Left Panel: Available Modules */}
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
            {availableModules.length === 0 && (
                <Text style={{textAlign: 'center', marginTop: 20, color: COLORS.textMuted}}>Loading modules...</Text>
            )}
        </View>

        {/* Right Panel: Pipeline Canvas */}
        <View style={[styles.card, { flex: 2 }]}>
            <Text style={styles.cardTitle}>Your Pipeline</Text>
            
            <View style={styles.pipelineCanvas}>
                {pipeline.length === 0 ? (
                    <View style={styles.canvasEmpty}>
                        <Text style={{color: COLORS.textMuted, textAlign: 'center'}}>Your pipeline is empty.</Text>
                        <Text style={{color: COLORS.textMuted, textAlign: 'center', fontSize: 12}}>Add modules from the left panel.</Text>
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
                    <Text style={styles.btnOutlineText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                    style={[styles.btn, pipeline.length === 0 && {opacity: 0.5}]} 
                    disabled={pipeline.length === 0}
                    onPress={generateLink}
                >
                    <Text style={styles.btnText}>Generate Link</Text>
                </TouchableOpacity>
            </View>
        </View>
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
           <TouchableOpacity onPress={() => setActiveTab('review')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'review' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>Manual Review</Text>
           </TouchableOpacity>
           <TouchableOpacity style={styles.profileBtn}>
             <Text style={styles.profileBtnText}>Logout</Text>
           </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'builder' && renderBuilder()}
          {activeTab === 'review' && renderReviewQueue()}
      </ScrollView>

      {/* Generated Link Modal */}
      <Modal visible={modalVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>Pipeline Ready!</Text>
                  <Text style={{color: COLORS.textMuted, textAlign: 'center', marginBottom: 20}}>
                      Your custom verification pipeline has been generated. Share this link to start verifying users.
                  </Text>
                  <View style={styles.linkBox}>
                      <Text style={{color: COLORS.primary, fontFamily: 'monospace'}}>{generatedLink}</Text>
                  </View>
                  <TouchableOpacity style={styles.btn} onPress={() => setModalVisible(false)}>
                      <Text style={styles.btnText}>Close</Text>
                  </TouchableOpacity>
              </View>
          </View>
      </Modal>

      {/* Manual Review Modal */}
      <Modal visible={reviewModalVisible} transparent={true} animationType="fade">
          <View style={styles.modalOverlay}>
              <View style={[styles.modalContent, { maxWidth: 800 }]}>
                  <Text style={styles.modalTitle}>Review Application: {selectedReview?.id}</Text>
                  <Text style={{color: COLORS.danger, fontWeight: '600', marginBottom: 20}}>Flagged for: {selectedReview?.reason}</Text>
                  
                  <View style={{flexDirection: width > 768 ? 'row' : 'column', gap: 24, width: '100%', marginBottom: 32}}>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 12, color: COLORS.textMuted}}>Extracted Document Face</Text>
                          <View style={{width: 150, height: 150, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8'}}>Mock Image</Text>
                          </View>
                      </View>
                      <View style={{flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 16, alignItems: 'center'}}>
                          <Text style={{fontWeight: '600', marginBottom: 12, color: COLORS.textMuted}}>Live Captured Face</Text>
                          <View style={{width: 150, height: 150, backgroundColor: '#e2e8f0', borderRadius: 8, justifyContent: 'center', alignItems: 'center'}}>
                              <Text style={{color: '#94a3b8'}}>Mock Image</Text>
                          </View>
                      </View>
                  </View>

                  <View style={{flexDirection: 'row', gap: 16}}>
                      <TouchableOpacity style={[styles.btnOutline, {borderColor: COLORS.danger}]} onPress={() => handleReviewAction('REJECT')}>
                          <Text style={[styles.btnOutlineText, {color: COLORS.danger}]}>Reject</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.btn, {backgroundColor: '#10b981'}]} onPress={() => handleReviewAction('APPROVE')}>
                          <Text style={styles.btnText}>Approve</Text>
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
  // Builder Styles
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
      minHeight: 400,
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
      shadowColor: COLORS.primary,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 12,
      elevation: 2,
  },
  pipelineNodeText: {
      fontWeight: '700',
      color: COLORS.primary,
  },
  pipelineConnector: {
      width: 2,
      height: 30,
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
      paddingHorizontal: 16,
      paddingVertical: 6,
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
