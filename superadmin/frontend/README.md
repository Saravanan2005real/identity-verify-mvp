# Superadmin Portal Frontend (`superadmin/frontend`)

The **Superadmin Portal Frontend** is an enterprise-grade administrative control center built with React Native for Web and Expo SDK 52, designed with the official [Zudoc](https://www.zudoc.co/) enterprise design system (`#008080` teal, Manrope & Rival Sans typography). It provides master platform governance, multi-tenant B2B client workspace provisioning, live Supabase cloud telemetry, modular verification engine benchmarking, and zero-trust operator access control.

---

## Key Features

- **🎨 Zudoc Enterprise Theme & UI Architecture**:
  - Matches the visual identity and layout of the Client Admin Studio with signature teal branding, dark slate neutrals, crisp white cards, and segmented capsule navigation.
  - Live status pills (`Zero-Trust Active`), operator profile avatars, and single-click sign out.

- **🔒 Zero-Trust Corporate Identity Enforcement**:
  - Strictly restricts Superadmin access to corporate `@zudoc.co` personnel. Non-corporate email domains are barred from registration, magic link recovery, and portal access.
  - Two-step cryptographic onboarding: email link verification followed by secure password creation.
  - Duplicate registration prevention and account recovery magic links.

- **🔑 Cryptographic Access Key Engine (`SA-KEY-XXXX-XXXX-XXXX-XXXX`)**:
  - Generate single-use authorization keys bound cryptographically to corporate email addresses.
  - Personnel redeem keys to claim Superadmin privileges.
  - Real-time personnel registry with one-click revocation controls.

- **⚡ Live Supabase Production Telemetry**:
  - **Live Pipeline Counts**: Actual count of configured eKYC journeys stored in cloud Supabase.
  - **Live Verification Throughput**: Actual count of candidate identity checks processed across the platform.
  - **Live Document Distribution**: Document breakdown (Aadhaar vs PAN).
  - **Live Verification Stream**: Real-time table displaying candidate verification sessions from Supabase with extracted names, ID numbers, OCR confidence scores, and status badges.

- **🏢 Multi-Tenant Client Organization Directory**:
  - Provision and manage real enterprise client workspaces backed by database persistence.
  - Custom tier assignment (`Growth Trial`, `Scale Tier`, `Enterprise Dedicated`).
  - Direct launcher links to client admin portals (Port 8082).

- **📦 Verification Engines Catalog**:
  - Benchmark and test modular identity engines:
    - Document OCR & Face Match (Aadhaar & PAN)
    - WebGazer Eye Tracking Liveness (WebGL pupil tracking)
    - Audio Voice Challenge (Acoustic FFT & anti-deepfake)

- **🛡️ Compliance & Security Audit Trail**:
  - Immutable audit trail recording administrative actions, key generations, redemptions, and tenant onboardings with ISO timestamps.

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
