# Client Admin Portal (`admin/frontend`)

The **Client Admin Portal** is an enterprise-grade React Native Web application built with Expo. It provides business operators and compliance officers with a unified control center for building custom eKYC pipelines, issuing tokenized applicant verification links, reviewing verification sessions, and performing manual audits with side-by-side face comparisons.

---

## Key Features

- **Supabase Authentication**:
  - Direct Email & Password sign-up and sign-in.
  - 6-digit passwordless Email OTP verification.
  - Google OAuth 2.0 Single Sign-On (SSO) with PKCE and browser redirect handling (`verifyyy://auth/callback`).
  - Automatic session restoration with Supabase JWT persistence.
- **Visual No-Code Pipeline Builder**:
  - Drag-and-drop assembly of verification recipes.
  - Supported modules: Aadhaar OCR, PAN OCR, Live Face Match, WebGazer Eye Tracking, and Manual Compliance Officer Review.
- **Instant Tokenized Link Generator**:
  - One-click applicant URL generation with parameterized query arguments:
    `/verify.html?pid=FLOW-XXXXXX&flow=AADHAAR_FACE,EYE_TRACKING`
  - Integration with the backend Applicant Session Token API (`/api/v1/auth/applicant_session`) for cryptographically signed, expiring applicant sessions.
- **Real-Time Audit Queue**:
  - Live data stream synced directly with Supabase PostgreSQL (`verifications` table).
  - Search and filter by Session ID, ID number, and verification status (`SUCCESS`, `MANUAL_REVIEW`, `REJECTED`).
- **Side-by-Side Biometric Audit Modal**:
  - Side-by-side inspection comparing extracted ID document photo crops against live webcam selfies.
  - Displays SFace 128-D cosine distance, ArcFace confidence, and OCR extracted fields.
  - One-click compliance officer decision: Approve or Reject.

---

## Technology Stack

- **Framework**: React Native for Web (React Native 0.76+ / Expo SDK 52)
- **Styling**: Native StyleSheet with a clean light theme (Indigo & Slate color palette)
- **Authentication & Backend**: `@supabase/supabase-js` v2
- **Icons**: `@expo/vector-icons` (Ionicons)
- **Deep Linking**: `expo-linking` with `verifyyy` URI scheme

---

## Project Structure

```
admin/frontend/
├── assets/                  # Icons and splash screen assets
├── lib/
│   └── supabase.js          # Supabase client initialization & session storage
├── src/
│   └── services/
│       ├── auth.js          # Email, password, and OTP authentication service
│       └── googleAuth.js    # Google OAuth 2.0 flow with PKCE
├── App.js                   # Pipeline builder, audit queue, review modal & link generator
├── SignInScreen.js          # Modern Supabase authentication UI
├── app.json                 # Expo application configuration & deep link scheme
├── index.js                 # React Native Web root entrypoint
├── package.json             # NPM dependencies and scripts
└── package-lock.json
```

---

## Environment Variables

Configure environment variables in the project root `.env` or pass them directly to the build process:

```ini
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

> **Note**: Both keys use the `EXPO_PUBLIC_` prefix to ensure Expo embeds them safely into the client bundle at build time.

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Web Development Server (Port 8082)
```bash
npx expo start --web --port 8082
```
or:
```bash
npm run web
```

The portal will be accessible at: **`http://localhost:8082`**

### 3. Production Build
To export a static web build for hosting on Vercel, Netlify, or S3:
```bash
npx expo export --platform web
```
The static artifacts will be generated in `dist/`.
