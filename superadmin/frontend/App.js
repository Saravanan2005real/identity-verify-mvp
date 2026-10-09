import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, Text, View, ScrollView, TouchableOpacity, Dimensions, Linking } from 'react-native';

const { width } = Dimensions.get('window');

// Theme Colors for Verifyyy matching Customer Portal
const COLORS = {
  primary: '#0f766e', // teal-700
  primaryLight: 'rgba(45, 212, 191, 0.15)', // teal accent light
  background: '#f8fafc', // slate-50
  card: '#ffffff', // keeping solid white for RN
  textMain: '#0f172a', // slate-900
  textMuted: '#64748b', // slate-500
  border: 'rgba(203, 213, 225, 0.5)', // slate-300
};

export default function App() {
  const isWeb = width > 768; // Simple breakpoint for web layout

  const [stats, setStats] = React.useState([
    { id: '1', title: 'Total Companies', value: '0', icon: '🏢' },
    { id: '2', title: 'Active Clients', value: '0', icon: '✅' },
    { id: '3', title: 'Verified Today', value: '0', icon: '⚡' },
    { id: '4', title: 'Manual Review', value: '0', icon: '🔍' },
  ]);
  const [companies, setCompanies] = React.useState([]);
  const [products, setProducts] = React.useState([]);
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [activeModuleUrl, setActiveModuleUrl] = React.useState(null);

  React.useEffect(() => {
    // Fetch Dashboard Stats
    fetch('http://127.0.0.1:8000/api/v1/b2b/dashboard')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && data.data) {
           setStats([
             { id: '1', title: 'Total Companies', value: '1', icon: '🏢' }, // Using 1 since we fetched company_id=1
             { id: '2', title: 'Pipelines Built', value: data.data.pipelines_built?.toString() || '0', icon: '✅' },
             { id: '3', title: 'Links Generated', value: data.data.links_generated?.toString() || '0', icon: '⚡' },
             { id: '4', title: 'Verified', value: data.data.verifications_completed?.toString() || '0', icon: '🔍' },
           ]);
        }
      })
      .catch(err => console.error("Error fetching stats:", err));

    // Fetch Services (Products)
    fetch('http://127.0.0.1:8000/api/v1/b2b/verification-services')
      .then(res => res.json())
      .then(data => {
         if (data.status === 'success' && data.data) {
            setProducts(data.data.map(service => ({
               id: service.id,
               name: service.name,
               users: 0 // Default usage stat
            })));
         }
      })
      .catch(err => console.error("Error fetching services:", err));
  }, []);

  const renderStatCard = ({ item }) => (
    <View style={[styles.statCard, { width: isWeb ? '23%' : '48%' }]}>
      <View style={styles.statIconContainer}>
        <Text style={styles.statIcon}>{item.icon}</Text>
      </View>
      <Text style={styles.statValue}>{item.value}</Text>
      <Text style={styles.statTitle}>{item.title}</Text>
    </View>
  );

  const renderDashboard = () => (
    <>
        {/* Stats Section */}
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsContainer}>
          {stats.map(item => (
            <React.Fragment key={item.id}>{renderStatCard({ item })}</React.Fragment>
          ))}
        </View>

        {/* Details Section */}
        <View style={[styles.detailsContainer, { flexDirection: isWeb ? 'row' : 'column' }]}>
          
          {/* Companies List */}
          <View style={[styles.card, { flex: isWeb ? 2 : 1, marginRight: isWeb ? 16 : 0, marginBottom: isWeb ? 0 : 16 }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Recent Companies</Text>
              <TouchableOpacity><Text style={styles.linkText}>View All</Text></TouchableOpacity>
            </View>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableCol, { flex: 2 }]}>Company</Text>
              <Text style={styles.tableCol}>Pipelines</Text>
              <Text style={styles.tableCol}>Links</Text>
              <Text style={styles.tableCol}>Verified</Text>
              <Text style={styles.tableCol}>Status</Text>
            </View>
            {companies.map(company => (
              <View style={styles.tableRow} key={company.id}>
                <Text style={[styles.tableCell, styles.cellMain, { flex: 2 }]}>{company.name}</Text>
                <Text style={styles.tableCell}>{company.pipelines_built}</Text>
                <Text style={styles.tableCell}>{company.links_generated}</Text>
                <Text style={styles.tableCell}>{company.verifications_completed}</Text>
                <View style={styles.statusBadge(company.status)}>
                  <Text style={styles.statusText(company.status)}>{company.status || 'Active'}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Products List */}
          <View style={[styles.card, { flex: 1 }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Service Utilization</Text>
            </View>
            {products.map(product => (
              <View style={styles.productRow} key={product.id}>
                <View style={styles.productIconContainer}>
                  <Text style={styles.productIcon}>📦</Text>
                </View>
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{product.name}</Text>
                  <Text style={styles.productUsers}>{product.users}% usage</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
    </>
  );

  const openProduct = (file) => {
    // In local dev, just open the path or a dev server if hosted
    Linking.openURL('http://localhost:5174/' + file);
  };

  const renderOurProducts = () => (
    <View>
      <Text style={styles.sectionTitle}>Our Verifyyy Modules</Text>
      <Text style={{color: COLORS.textMuted, marginBottom: 24}}>Explore the core verification products we offer to clients.</Text>
      
      <View style={{flexDirection: isWeb ? 'row' : 'column', gap: 24}}>
        <View style={styles.productCard}>
          <Text style={{fontSize: 40, marginBottom: 16}}>📷</Text>
          <Text style={styles.productCardTitle}>OCR & Face Match</Text>
          <Text style={styles.productCardDesc}>Cross verify identity documents with a live face capture.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openProduct('demo_ocr_face.html')}>
            <Text style={styles.btnText}>View Module</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.productCard}>
          <Text style={{fontSize: 40, marginBottom: 16}}>👁️</Text>
          <Text style={styles.productCardTitle}>Eye Tracking</Text>
          <Text style={styles.productCardDesc}>Advanced liveness detection tracking eye movement.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openProduct('demo_eye_tracking.html')}>
            <Text style={styles.btnText}>View Module</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.productCard}>
          <Text style={{fontSize: 40, marginBottom: 16}}>🎙️</Text>
          <Text style={styles.productCardTitle}>Audio Liveness</Text>
          <Text style={styles.productCardDesc}>Verify presence through voice prompt challenges.</Text>
          <TouchableOpacity style={styles.btn} onPress={() => openProduct('demo_audio_liveness.html')}>
            <Text style={styles.btnText}>View Module</Text>
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
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text style={styles.headerLogo}>Verifyyy</Text>
            <Text style={styles.headerTitle}>Super Admin</Text>
        </View>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
           <TouchableOpacity onPress={() => setActiveTab('dashboard')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'dashboard' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>Dashboard</Text>
           </TouchableOpacity>
           <TouchableOpacity onPress={() => setActiveTab('products')} style={{marginRight: 20}}>
               <Text style={{color: activeTab === 'products' ? '#fff' : '#cbd5e1', fontWeight: '600'}}>Our Products</Text>
           </TouchableOpacity>
           <TouchableOpacity style={styles.profileBtn}>
             <Text style={styles.profileBtnText}>Admin</Text>
           </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'dashboard' ? renderDashboard() : renderOurProducts()}
      </ScrollView>
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
  },
  headerTitle: {
    fontSize: 18,
    color: '#e2e8f0',
    fontWeight: '500',
    display: width > 768 ? 'flex' : 'none',
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
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textMain,
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
  }
});

