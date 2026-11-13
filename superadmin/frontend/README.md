# Superadmin Portal Frontend (`superadmin/frontend`)

The **Superadmin Portal Frontend** is a centralized administrative platform built with React Native for Web and Expo. Designed for system administrators, it provides platform-wide governance, client organization provisioning, B2B verification service catalog management, and high-level verification telemetry.

---

## Key Features

- **Master Authentication with Role Verification**:
  - Direct Email/Password login and 6-digit OTP authentication via Supabase Auth.
  - Google OAuth 2.0 Single Sign-On (SSO).
  - Role-Based Access Control (RBAC): Caller claims are validated against the `user_tenant_membership` table; non-superadmins are rejected.
- **Client Organization & Tenant Governance**:
  - View, onboard, and manage registered client companies (tenants).
  - Monitor tenant verification pipelines, subscription tiers, and API key states.
- **B2B Verification Service Catalog**:
  - Real-time catalog of available modular verification engines:
    - Universal Document OCR (Aadhaar & PAN)
    - Face Match & Biometric Anti-Spoofing (SFace ONNX & ArcFace)
    - Eye Tracking & Gaze Attention Analysis (WebGazer / FGI-Net)
    - Voice Liveness & Speech Challenge
- **System Telemetry & Health Monitoring**:
  - Live session statistics: Total Verifications, Approved Sessions, and Pending Reviews.
  - Health checks across microservice endpoints.

---

## Technology Stack

- **Framework**: React Native Web / Expo SDK 52
- **State & Cloud Auth**: `@supabase/supabase-js` v2
- **Icons**: `@expo/vector-icons` (Ionicons)
- **Deep Linking**: `expo-linking` (`verifyyy` URI scheme)

---

## Project Structure

```
superadmin/frontend/
├── assets/                  # Platform icons and branding assets
├── lib/
│   └── supabase.js          # Shared Supabase cloud client
├── src/
│   └── services/
│       ├── auth.js          # Email, password, and OTP authentication service
│       └── googleAuth.js    # Google OAuth 2.0 flow with deep linking
├── App.js                   # Master superadmin dashboard & tenant management
├── SignInScreen.js          # Superadmin authentication UI
├── app.json                 # Expo configuration
├── index.js                 # Application entrypoint
├── package.json             # NPM dependencies
└── package-lock.json
```

---

## Configuration & Environment Variables

Make sure the following variables are defined in the root `.env`:

```ini
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Web Server on Port 8081
```bash
npx expo start --web --port 8081
```
or:
```bash
npm run web
```

Open your browser at: **`http://localhost:8081`**

### 3. Static Export
```bash
npx expo export --platform web
```
Static files will be output to the `dist/` directory.
