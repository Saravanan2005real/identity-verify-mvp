import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys for persisting active clearance and invitations
const STORAGE_KEYS = {
  AUTHORIZED_SUPERADMINS: 'verifyyy_superadmin_authorized_users',
  ACCESS_KEYS: 'verifyyy_superadmin_access_keys',
  AUDIT_LOGS: 'verifyyy_superadmin_audit_logs',
};

/**
 * Retrieve configured allowed corporate domains for Superadmin access.
 * e.g., EXPO_PUBLIC_SUPERADMIN_ALLOWED_DOMAINS="zudoc.com" (comma-separated if multiple)
 * When empty or not set: any valid email authenticated via Supabase Email OTP (e.g. Gmail) is accepted.
 * When set: ONLY emails ending with that domain (e.g. @zudoc.com) are permitted.
 */
export function getAllowedSuperadminDomains() {
  try {
    const raw = process.env.EXPO_PUBLIC_SUPERADMIN_ALLOWED_DOMAINS || '';
    return raw
      .split(',')
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Validate an email address against the corporate domain policy.
 * @param {string} email
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function validateEmailDomainPolicy(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return { allowed: false, reason: 'Please enter a valid email address.' };
  }
  const cleanEmail = email.trim().toLowerCase();
  const domain = cleanEmail.split('@')[1];
  const allowedDomains = getAllowedSuperadminDomains();

  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    return {
      allowed: false,
      reason: `Access restricted: Superadmin accounts must belong to @${allowedDomains.join(' or @')}.`,
    };
  }

  return { allowed: true };
}

// Helper to safely access browser localStorage
function getLocalItem(key) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch (e) {
    console.warn(`[accessControl] getLocalItem failed for ${key}:`, e);
  }
  return null;
}

function setLocalItem(key, value) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch (e) {
    console.warn(`[accessControl] setLocalItem failed for ${key}:`, e);
  }
}

// In-memory cache for synchronous checks
let _authorizedCache = null;
let _keysCache = null;
let _auditCache = null;

// Initialize state
function initCaches() {
  if (_authorizedCache === null) {
    const rawAuth = getLocalItem(STORAGE_KEYS.AUTHORIZED_SUPERADMINS);
    if (rawAuth) {
      try {
        _authorizedCache = JSON.parse(rawAuth);
      } catch (e) {
        _authorizedCache = [];
      }
    } else {
      _authorizedCache = [];
      setLocalItem(STORAGE_KEYS.AUTHORIZED_SUPERADMINS, JSON.stringify(_authorizedCache));
    }
  }

  if (_keysCache === null) {
    const rawKeys = getLocalItem(STORAGE_KEYS.ACCESS_KEYS);
    if (rawKeys) {
      try {
        _keysCache = JSON.parse(rawKeys);
      } catch (e) {
        _keysCache = [];
      }
    } else {
      _keysCache = [];
      setLocalItem(STORAGE_KEYS.ACCESS_KEYS, JSON.stringify(_keysCache));
    }
  }

  if (_auditCache === null) {
    const rawAudit = getLocalItem(STORAGE_KEYS.AUDIT_LOGS);
    if (rawAudit) {
      try {
        _auditCache = JSON.parse(rawAudit);
      } catch (e) {
        _auditCache = [];
      }
    } else {
      _auditCache = [
        {
          id: 'log_seed',
          timestamp: new Date().toISOString(),
          action: 'ACCESS_CONTROL_INITIALIZED',
          actorEmail: 'System',
          targetEmail: 'Superadmin Portal',
          details: 'Supabase Email OTP Authentication active.',
        },
      ];
      setLocalItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(_auditCache));
    }
  }
}

// Ensure caches initialized
initCaches();

function persistAll() {
  if (_authorizedCache) {
    setLocalItem(STORAGE_KEYS.AUTHORIZED_SUPERADMINS, JSON.stringify(_authorizedCache));
    AsyncStorage.setItem(STORAGE_KEYS.AUTHORIZED_SUPERADMINS, JSON.stringify(_authorizedCache)).catch(() => {});
  }
  if (_keysCache) {
    setLocalItem(STORAGE_KEYS.ACCESS_KEYS, JSON.stringify(_keysCache));
    AsyncStorage.setItem(STORAGE_KEYS.ACCESS_KEYS, JSON.stringify(_keysCache)).catch(() => {});
  }
  if (_auditCache) {
    setLocalItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(_auditCache));
    AsyncStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(_auditCache)).catch(() => {});
  }
}

/**
 * Check if a given email is authorized to access the Superadmin portal.
 * @param {string} email
 * @returns {boolean}
 */
export function isSuperadminAuthorized(email) {
  if (!email || typeof email !== 'string') return false;
  initCaches();
  const cleanEmail = email.trim().toLowerCase();

  // 1. Corporate domain validation (e.g. @zudoc.com)
  const domainValidation = validateEmailDomainPolicy(cleanEmail);
  if (!domainValidation.allowed) {
    return false;
  }

  // 2. Check if the account has been explicitly revoked
  const existing = _authorizedCache.find(
    (item) => item.email.toLowerCase() === cleanEmail
  );
  if (existing) {
    return existing.status === 'ACTIVE';
  }

  // 3. For newly authenticated Supabase users that satisfy domain policy
  return true;
}

/**
 * Record and activate a verified Supabase user as an active Superadmin.
 * @param {string} email
 * @param {string} [userId]
 */
export function recordAuthorizedSuperadmin(email, userId = null) {
  if (!email || typeof email !== 'string') return;
  initCaches();
  const cleanEmail = email.trim().toLowerCase();

  const domainValidation = validateEmailDomainPolicy(cleanEmail);
  if (!domainValidation.allowed) return;

  const existingIdx = _authorizedCache.findIndex(
    (u) => u.email.toLowerCase() === cleanEmail
  );

  const adminEntry = {
    email: cleanEmail,
    role: 'superadmin',
    status: 'ACTIVE',
    addedBy: 'Supabase Verified OTP',
    addedAt: new Date().toISOString(),
    accessKeyUsed: 'VERIFIED-OTP-AUTH',
    userId: userId,
  };

  if (existingIdx >= 0) {
    if (_authorizedCache[existingIdx].status !== 'REVOKED') {
      _authorizedCache[existingIdx].status = 'ACTIVE';
      _authorizedCache[existingIdx].userId = userId || _authorizedCache[existingIdx].userId;
    }
  } else {
    _authorizedCache.unshift(adminEntry);
    _auditCache.unshift({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      action: 'SUPERADMIN_INITIALIZED',
      actorEmail: cleanEmail,
      targetEmail: cleanEmail,
      details: 'Superadmin account verified and activated via Supabase Email OTP.',
    });
  }

  persistAll();
}

/**
 * Get all authorized superadmins
 */
export function getAuthorizedSuperadmins() {
  initCaches();
  return [..._authorizedCache];
}

/**
 * Get all access keys / invitations
 */
export function getAccessKeys() {
  initCaches();
  return [..._keysCache];
}

/**
 * Get access audit logs
 */
export function getAccessAuditLogs() {
  initCaches();
  return [..._auditCache];
}

/**
 * Generate a random cryptographically formatted Access Key:
 * e.g., SA-KEY-A48F-9C21-6D4E-8B3A
 */
export function generateRandomAccessKey() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excluding ambiguous chars like 0, O, 1, I
  const segment = (len) => {
    let res = '';
    for (let i = 0; i < len; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  };
  return `SA-KEY-${segment(4)}-${segment(4)}-${segment(4)}-${segment(4)}`;
}

/**
 * Create and issue a new Access Key for a target employee email
 * @param {Object} params
 * @param {string} params.targetEmail
 * @param {string} params.createdByEmail
 * @param {string} [params.note]
 * @param {string} [params.role]
 * @returns {Object} created key entry
 */
export function issueAccessKey({ targetEmail, createdByEmail, note = '', role = 'superadmin' }) {
  initCaches();
  const cleanTargetEmail = (targetEmail || '').trim().toLowerCase();
  const cleanCreatedBy = (createdByEmail || 'Administrator').trim();

  if (!cleanTargetEmail || !cleanTargetEmail.includes('@')) {
    throw new Error('Please enter a valid work email address.');
  }

  // Check if user is already an active superadmin
  if (isSuperadminAuthorized(cleanTargetEmail)) {
    throw new Error(`User with email "${cleanTargetEmail}" already has active Superadmin access.`);
  }

  // Generate unique key
  let newKey = generateRandomAccessKey();
  while (_keysCache.some((k) => k.accessKey === newKey)) {
    newKey = generateRandomAccessKey();
  }

  const keyRecord = {
    id: `key_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    accessKey: newKey,
    targetEmail: cleanTargetEmail,
    role: role || 'superadmin',
    createdBy: cleanCreatedBy,
    note: note.trim() || 'Superadmin Portal Authorization',
    status: 'PENDING', // PENDING | ACCEPTED | REVOKED
    createdAt: new Date().toISOString(),
    acceptedAt: null,
    acceptedByUserId: null,
  };

  _keysCache.unshift(keyRecord);

  // Add audit log
  _auditCache.unshift({
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: 'ACCESS_KEY_ISSUED',
    actorEmail: cleanCreatedBy,
    targetEmail: cleanTargetEmail,
    details: `Issued Superadmin Access Key ${newKey} with role "${role}".`,
  });

  persistAll();
  return keyRecord;
}

/**
 * Validate an access key for a specific email
 * @param {string} email
 * @param {string} accessKey
 * @returns {{ valid: boolean, error?: string, keyRecord?: Object }}
 */
export function validateAccessKey(email, accessKey) {
  initCaches();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanKey = (accessKey || '').trim().toUpperCase();

  if (!cleanEmail) {
    return { valid: false, error: 'Please enter your work email address.' };
  }
  if (!cleanKey) {
    return { valid: false, error: 'Please enter the access key shared with you.' };
  }

  const keyRecord = _keysCache.find((k) => k.accessKey === cleanKey);

  if (!keyRecord) {
    return {
      valid: false,
      error: 'Invalid Access Key. Please check the key provided by your administrator.',
    };
  }

  if (keyRecord.status === 'REVOKED') {
    return {
      valid: false,
      error: 'This Access Key has been revoked by an administrator. Please request a new one.',
    };
  }

  if (keyRecord.status === 'ACCEPTED') {
    return {
      valid: false,
      error: 'This Access Key has already been accepted and redeemed.',
    };
  }

  if (keyRecord.targetEmail.toLowerCase() !== cleanEmail) {
    return {
      valid: false,
      error: `This Access Key was issued specifically for "${keyRecord.targetEmail}". Please sign in or redeem with that email address.`,
    };
  }

  return { valid: true, keyRecord };
}

/**
 * Accept and redeem an access key, granting the user full Superadmin access
 * @param {Object} params
 * @param {string} params.email
 * @param {string} params.accessKey
 * @param {string} [params.userId]
 * @returns {Object} result
 */
export function acceptAccessKey({ email, accessKey, userId = null }) {
  initCaches();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanKey = (accessKey || '').trim().toUpperCase();

  const validation = validateAccessKey(cleanEmail, cleanKey);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const keyRecord = validation.keyRecord;

  // Mark key as accepted
  keyRecord.status = 'ACCEPTED';
  keyRecord.acceptedAt = new Date().toISOString();
  keyRecord.acceptedByUserId = userId;

  // Add/Update user in authorized list
  const existingIdx = _authorizedCache.findIndex(
    (u) => u.email.toLowerCase() === cleanEmail
  );

  const adminEntry = {
    email: cleanEmail,
    role: keyRecord.role || 'superadmin',
    status: 'ACTIVE',
    addedBy: keyRecord.createdBy,
    addedAt: new Date().toISOString(),
    accessKeyUsed: cleanKey,
    userId: userId,
  };

  if (existingIdx >= 0) {
    _authorizedCache[existingIdx] = adminEntry;
  } else {
    _authorizedCache.unshift(adminEntry);
  }

  // Audit log
  _auditCache.unshift({
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: 'ACCESS_KEY_ACCEPTED',
    actorEmail: cleanEmail,
    targetEmail: cleanEmail,
    details: `Successfully accepted access key ${cleanKey}. Superadmin privileges granted.`,
  });

  persistAll();

  return {
    success: true,
    message: 'Superadmin privileges successfully activated!',
    superadmin: adminEntry,
  };
}

/**
 * Revoke a pending or existing access key
 * @param {string} keyIdOrKey
 * @param {string} actorEmail
 */
export function revokeAccessKey(keyIdOrKey, actorEmail = 'Administrator') {
  initCaches();
  const target = _keysCache.find(
    (k) => k.id === keyIdOrKey || k.accessKey === keyIdOrKey
  );

  if (!target) {
    throw new Error('Access Key not found.');
  }

  target.status = 'REVOKED';

  _auditCache.unshift({
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: 'ACCESS_KEY_REVOKED',
    actorEmail: actorEmail,
    targetEmail: target.targetEmail,
    details: `Revoked access key ${target.accessKey} for ${target.targetEmail}.`,
  });

  persistAll();
  return { success: true };
}

/**
 * Revoke an existing Superadmin's access
 * @param {string} targetEmail
 * @param {string} actorEmail
 */
export function revokeSuperadminAccess(targetEmail, actorEmail) {
  initCaches();
  const cleanTarget = (targetEmail || '').trim().toLowerCase();
  const cleanActor = (actorEmail || '').trim().toLowerCase();

  if (cleanTarget === cleanActor) {
    throw new Error('You cannot revoke your own Superadmin access.');
  }

  const existingIdx = _authorizedCache.findIndex(
    (u) => u.email.toLowerCase() === cleanTarget
  );

  if (existingIdx === -1) {
    throw new Error('Superadmin account not found.');
  }

  _authorizedCache[existingIdx].status = 'REVOKED';
  _authorizedCache[existingIdx].revokedAt = new Date().toISOString();
  _authorizedCache[existingIdx].revokedBy = cleanActor;

  _auditCache.unshift({
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    action: 'SUPERADMIN_ACCESS_REVOKED',
    actorEmail: cleanActor,
    targetEmail: cleanTarget,
    details: `Revoked Superadmin portal access for ${cleanTarget}.`,
  });

  persistAll();
  return { success: true };
}

/**
 * Summary stats for dashboard
 */
export function getAccessSummaryStats() {
  initCaches();
  const activeCount = _authorizedCache.filter((u) => u.status === 'ACTIVE').length;
  const pendingKeys = _keysCache.filter((k) => k.status === 'PENDING').length;
  const acceptedKeys = _keysCache.filter((k) => k.status === 'ACCEPTED').length;
  const revokedKeys = _keysCache.filter((k) => k.status === 'REVOKED').length;

  return {
    activeSuperadmins: activeCount,
    pendingKeys,
    acceptedKeys,
    revokedKeys,
  };
}
