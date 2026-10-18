/**
 * Verifyyy Enterprise Identity Platform - Email Authentication Engine
 * Pure Vanilla JavaScript Client Logic
 */

(function () {
    'use strict';

    // --- State Management ---
    const STATE = {
        authMode: 'password', // 'password' | 'otp'
        selectedPortal: 'admin', // 'admin' | 'superadmin' | 'runner'
        targetEmail: '',
        failedAttempts: 0,
        isLockedOut: false,
        resendInterval: null,
        rateLimitInterval: null,
        currentOtpCode: '928371', // Demo runtime OTP
    };

    // Portal Destination URLs
    const PORTAL_URLS = {
        admin: 'http://localhost:8082',
        superadmin: 'http://localhost:8081',
        runner: 'verify.html'
    };

    // --- DOM Elements ---
    const DOM = {
        html: document.documentElement,
        themeToggleBtn: document.getElementById('theme-toggle-btn'),
        demoCredentialsBtn: document.getElementById('demo-credentials-btn'),
        drawerDemo: document.getElementById('drawer-demo-accounts'),
        btnCloseDrawer: document.getElementById('btn-close-drawer'),

        // Headings
        formHeading: document.getElementById('form-heading'),
        formSubheading: document.getElementById('form-subheading'),

        // Portal Selector
        portalPills: document.querySelectorAll('.portal-pill'),

        // Auth Tabs
        tabPassword: document.getElementById('tab-password'),
        tabOtp: document.getElementById('tab-otp'),
        formPassword: document.getElementById('form-password-signin'),
        formOtp: document.getElementById('form-otp-signin'),

        // Alert Banner
        globalAlert: document.getElementById('global-alert-banner'),
        alertMsg: document.getElementById('alert-message-text'),
        alertDismissBtn: document.getElementById('alert-dismiss-btn'),
        capsLockBanner: document.getElementById('caps-lock-banner'),

        // Password Mode Elements
        inputEmailPassword: document.getElementById('input-email-password'),
        emailValidIcon: document.getElementById('email-valid-icon'),
        emailErrorMsg: document.getElementById('email-error-msg'),
        domainTags: document.querySelectorAll('.domain-tag'),
        inputPassword: document.getElementById('input-password'),
        togglePasswordBtn: document.getElementById('toggle-password-btn'),
        eyeShow: document.querySelector('.eye-show'),
        eyeHide: document.querySelector('.eye-hide'),
        passwordErrorMsg: document.getElementById('password-error-msg'),
        passwordStrengthBox: document.getElementById('password-strength-box'),
        strengthMeterFill: document.getElementById('strength-meter-fill'),
        strengthRatingText: document.getElementById('strength-rating-text'),
        ruleLength: document.getElementById('rule-length'),
        ruleUpper: document.getElementById('rule-upper'),
        ruleNum: document.getElementById('rule-num'),
        ruleSpec: document.getElementById('rule-spec'),
        rememberMeCheckbox: document.getElementById('remember-me-checkbox'),
        btnSubmitPassword: document.getElementById('btn-submit-password'),
        spinnerPassword: document.getElementById('spinner-password'),

        // Forgot Password Modal
        forgotPasswordLink: document.getElementById('forgot-password-link'),
        modalForgotPassword: document.getElementById('modal-forgot-password'),
        btnCloseFpModal: document.getElementById('btn-close-fp-modal'),
        fpInputEmail: document.getElementById('fp-input-email'),
        fpErrorMsg: document.getElementById('fp-error-msg'),
        btnSendResetLink: document.getElementById('btn-send-reset-link'),
        spinnerFp: document.getElementById('spinner-fp'),
        fpFormView: document.getElementById('fp-form-view'),
        fpSuccessView: document.getElementById('fp-success-view'),
        fpSuccessEmail: document.getElementById('fp-success-email'),
        btnFpDone: document.getElementById('btn-fp-done'),

        // OTP Mode Elements
        otpStepRequest: document.getElementById('otp-step-request'),
        otpStepVerify: document.getElementById('otp-step-verify'),
        inputEmailOtp: document.getElementById('input-email-otp'),
        otpEmailErrorMsg: document.getElementById('otp-email-error-msg'),
        btnRequestOtp: document.getElementById('btn-request-otp'),
        spinnerOtpRequest: document.getElementById('spinner-otp-request'),
        otpTargetEmailDisplay: document.getElementById('otp-target-email-display'),
        btnEditOtpEmail: document.getElementById('btn-edit-otp-email'),
        otpInputs: document.querySelectorAll('.otp-box'),
        otpErrorMsg: document.getElementById('otp-error-msg'),
        resendTimerText: document.getElementById('resend-timer-text'),
        resendCountdown: document.getElementById('resend-countdown'),
        btnResendOtp: document.getElementById('btn-resend-otp'),
        btnVerifyOtp: document.getElementById('btn-verify-otp'),
        spinnerOtpVerify: document.getElementById('spinner-otp-verify'),

        // Rate Limit Box
        rateLimitBox: document.getElementById('rate-limit-box'),
        rateLimitTimer: document.getElementById('rate-limit-timer'),

        // Toast Container
        toastContainer: document.getElementById('toast-container'),
    };

    // --- Regular Expressions ---
    const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    // --- Initialization ---
    document.addEventListener('DOMContentLoaded', () => {
        initTheme();
        initSavedSession();
        bindEvents();
    });

    /**
     * Theme Initialization (Dark by default, remembers user preference)
     */
    function initTheme() {
        const savedTheme = localStorage.getItem('verifyyy_theme') || 'dark';
        DOM.html.setAttribute('data-theme', savedTheme);

        DOM.themeToggleBtn.addEventListener('click', () => {
            const currentTheme = DOM.html.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            DOM.html.setAttribute('data-theme', newTheme);
            localStorage.setItem('verifyyy_theme', newTheme);
            showToast(`Switched to ${newTheme} mode`, 'info', 2000);
        });
    }

    /**
     * Check if user previously saved "Remember Me" credentials
     */
    function initSavedSession() {
        const rememberedEmail = localStorage.getItem('verifyyy_remembered_email');
        const rememberedPortal = localStorage.getItem('verifyyy_portal');

        if (rememberedEmail) {
            DOM.inputEmailPassword.value = rememberedEmail;
            DOM.inputEmailOtp.value = rememberedEmail;
            DOM.rememberMeCheckbox.checked = true;
            validateEmailField(DOM.inputEmailPassword, DOM.emailErrorMsg, DOM.emailValidIcon);
        }

        if (rememberedPortal && PORTAL_URLS[rememberedPortal]) {
            setPortalSelection(rememberedPortal);
        }
    }

    /**
     * Bind all DOM Event Listeners
     */
    function bindEvents() {
        // 1. Portal Selector Tabs
        DOM.portalPills.forEach(pill => {
            pill.addEventListener('click', () => {
                const targetPortal = pill.getAttribute('data-portal');
                setPortalSelection(targetPortal);
            });
        });

        // 2. Auth Mode Switcher
        DOM.tabPassword.addEventListener('click', () => switchAuthMode('password'));
        DOM.tabOtp.addEventListener('click', () => switchAuthMode('otp'));

        // 3. Email Input Validation & Domain Quick Fill (Password Form)
        DOM.inputEmailPassword.addEventListener('input', () => {
            validateEmailField(DOM.inputEmailPassword, DOM.emailErrorMsg, DOM.emailValidIcon);
            hideAlert();
        });

        DOM.domainTags.forEach(tag => {
            tag.addEventListener('click', () => {
                const domain = tag.getAttribute('data-domain');
                applyDomainSuggestion(DOM.inputEmailPassword, domain);
                validateEmailField(DOM.inputEmailPassword, DOM.emailErrorMsg, DOM.emailValidIcon);
            });
        });

        // 4. Password Visibility & Strength Check
        DOM.togglePasswordBtn.addEventListener('click', togglePasswordVisibility);

        DOM.inputPassword.addEventListener('focus', () => {
            DOM.passwordStrengthBox.classList.remove('hidden');
        });

        DOM.inputPassword.addEventListener('input', () => {
            hideAlert();
            updatePasswordStrength(DOM.inputPassword.value);
            if (DOM.inputPassword.value.length >= 8) {
                DOM.passwordErrorMsg.classList.add('hidden');
                DOM.inputPassword.classList.remove('is-invalid');
            }
        });

        // Caps Lock Detection
        ['keydown', 'keyup'].forEach(eventType => {
            DOM.inputPassword.addEventListener(eventType, (e) => {
                if (e.getModifierState && e.getModifierState('CapsLock')) {
                    DOM.capsLockBanner.classList.remove('hidden');
                } else {
                    DOM.capsLockBanner.classList.add('hidden');
                }
            });
        });

        // 5. Password Sign-in Submission
        DOM.formPassword.addEventListener('submit', handlePasswordSubmit);

        // 6. Alert dismissal
        DOM.alertDismissBtn.addEventListener('click', hideAlert);

        // 7. Forgot Password Modal
        DOM.forgotPasswordLink.addEventListener('click', openForgotPasswordModal);
        DOM.btnCloseFpModal.addEventListener('click', closeForgotPasswordModal);
        DOM.modalForgotPassword.addEventListener('click', (e) => {
            if (e.target === DOM.modalForgotPassword) closeForgotPasswordModal();
        });
        DOM.btnSendResetLink.addEventListener('click', handleSendPasswordReset);
        DOM.btnFpDone.addEventListener('click', closeForgotPasswordModal);

        // 8. OTP Workflow Listeners
        DOM.inputEmailOtp.addEventListener('input', () => {
            DOM.otpEmailErrorMsg.classList.add('hidden');
            DOM.inputEmailOtp.classList.remove('is-invalid');
        });

        DOM.btnRequestOtp.addEventListener('click', handleRequestOtp);
        DOM.btnEditOtpEmail.addEventListener('click', backToOtpRequestStep);
        DOM.btnResendOtp.addEventListener('click', handleResendOtp);
        DOM.btnVerifyOtp.addEventListener('click', handleVerifyOtp);

        setupOtpInputBoxes();

        // 9. Demo Credentials Drawer
        DOM.demoCredentialsBtn.addEventListener('click', () => {
            DOM.drawerDemo.classList.remove('hidden');
        });
        DOM.btnCloseDrawer.addEventListener('click', () => {
            DOM.drawerDemo.classList.add('hidden');
        });
        DOM.drawerDemo.addEventListener('click', (e) => {
            if (e.target === DOM.drawerDemo) DOM.drawerDemo.classList.add('hidden');
        });

        // Demo profile selection buttons
        document.querySelectorAll('.demo-profile-card').forEach(card => {
            card.querySelector('.btn-use-cred').addEventListener('click', () => {
                const email = card.getAttribute('data-email');
                const pass = card.getAttribute('data-pass');
                const portal = card.getAttribute('data-portal');
                const testOtp = card.getAttribute('data-otp');

                populateCredentials(email, pass, portal, testOtp);
                DOM.drawerDemo.classList.add('hidden');
                showToast(`Loaded ${card.querySelector('.profile-role-tag').innerText} credentials`, 'success');
            });
        });
    }

    /**
     * Portal Selection Handler
     */
    function setPortalSelection(portalKey) {
        STATE.selectedPortal = portalKey;
        localStorage.setItem('verifyyy_portal', portalKey);

        DOM.portalPills.forEach(pill => {
            const isMatch = pill.getAttribute('data-portal') === portalKey;
            pill.classList.toggle('active', isMatch);
            pill.setAttribute('aria-checked', isMatch ? 'true' : 'false');
        });
    }

    /**
     * Switch Between Password Mode & Email OTP Mode
     */
    function switchAuthMode(mode) {
        STATE.authMode = mode;
        hideAlert();

        if (mode === 'password') {
            DOM.tabPassword.classList.add('active');
            DOM.tabPassword.setAttribute('aria-selected', 'true');
            DOM.tabOtp.classList.remove('active');
            DOM.tabOtp.setAttribute('aria-selected', 'false');

            DOM.formPassword.classList.remove('hidden');
            DOM.formOtp.classList.add('hidden');

            DOM.formHeading.innerText = 'Welcome Back';
            DOM.formSubheading.innerText = 'Sign in using your registered enterprise email address.';
        } else {
            DOM.tabOtp.classList.add('active');
            DOM.tabOtp.setAttribute('aria-selected', 'true');
            DOM.tabPassword.classList.remove('active');
            DOM.tabPassword.setAttribute('aria-selected', 'false');

            DOM.formPassword.classList.add('hidden');
            DOM.formOtp.classList.remove('hidden');

            DOM.formHeading.innerText = 'Passwordless Access';
            DOM.formSubheading.innerText = 'Authenticate instantly with a secure 6-digit code sent to your email.';
            
            // Sync email if entered in other tab
            if (DOM.inputEmailPassword.value.trim()) {
                DOM.inputEmailOtp.value = DOM.inputEmailPassword.value.trim();
            }
        }
    }

    /**
     * Real-time Email Format Validation
     */
    function validateEmailField(inputElement, errorElement, iconElement) {
        const val = inputElement.value.trim();
        if (!val) {
            inputElement.classList.remove('is-valid', 'is-invalid');
            if (errorElement) errorElement.classList.add('hidden');
            if (iconElement) iconElement.innerHTML = '';
            return false;
        }

        const isValid = EMAIL_REGEX.test(val);
        if (isValid) {
            inputElement.classList.remove('is-invalid');
            inputElement.classList.add('is-valid');
            if (errorElement) errorElement.classList.add('hidden');
            if (iconElement) {
                iconElement.innerHTML = '<span style="color:var(--success); font-weight:bold;">✓</span>';
            }
            return true;
        } else {
            inputElement.classList.remove('is-valid');
            inputElement.classList.add('is-invalid');
            if (errorElement) {
                errorElement.innerText = 'Please enter a valid email address (e.g., name@domain.com)';
                errorElement.classList.remove('hidden');
            }
            if (iconElement) {
                iconElement.innerHTML = '<span style="color:var(--danger); font-weight:bold;">✕</span>';
            }
            return false;
        }
    }

    /**
     * Quick Domain Fill Helper
     */
    function applyDomainSuggestion(inputElement, domain) {
        const val = inputElement.value.trim();
        if (val.includes('@')) {
            const prefix = val.split('@')[0];
            inputElement.value = prefix ? `${prefix}${domain}` : `officer${domain}`;
        } else if (val) {
            inputElement.value = `${val}${domain}`;
        } else {
            inputElement.value = `officer${domain}`;
        }
    }

    /**
     * Password Visibility Toggle
     */
    function togglePasswordVisibility() {
        const isPassword = DOM.inputPassword.getAttribute('type') === 'password';
        DOM.inputPassword.setAttribute('type', isPassword ? 'text' : 'password');
        DOM.eyeShow.classList.toggle('hidden', isPassword);
        DOM.eyeHide.classList.toggle('hidden', !isPassword);
    }

    /**
     * Dynamic Password Strength Calculation & Rule Visualizer
     */
    function updatePasswordStrength(password) {
        const hasLength = password.length >= 8;
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasNum = /[0-9]/.test(password);
        const hasSpec = /[^A-Za-z0-9]/.test(password);

        // Update checklist items
        DOM.ruleLength.classList.toggle('rule-pass', hasLength);
        DOM.ruleUpper.classList.toggle('rule-pass', hasUpper && hasLower);
        DOM.ruleNum.classList.toggle('rule-pass', hasNum);
        DOM.ruleSpec.classList.toggle('rule-pass', hasSpec);

        let score = 0;
        if (hasLength) score++;
        if (hasUpper && hasLower) score++;
        if (hasNum) score++;
        if (hasSpec) score++;

        if (password.length === 0) {
            DOM.strengthMeterFill.style.width = '0%';
            DOM.strengthRatingText.innerText = 'Empty';
            DOM.strengthRatingText.style.color = 'var(--text-muted)';
            return;
        }

        switch (score) {
            case 0:
            case 1:
                DOM.strengthMeterFill.style.width = '25%';
                DOM.strengthMeterFill.style.backgroundColor = 'var(--danger)';
                DOM.strengthRatingText.innerText = 'Weak';
                DOM.strengthRatingText.style.color = 'var(--danger)';
                break;
            case 2:
                DOM.strengthMeterFill.style.width = '50%';
                DOM.strengthMeterFill.style.backgroundColor = 'var(--warning)';
                DOM.strengthRatingText.innerText = 'Fair';
                DOM.strengthRatingText.style.color = 'var(--warning)';
                break;
            case 3:
                DOM.strengthMeterFill.style.width = '75%';
                DOM.strengthMeterFill.style.backgroundColor = 'var(--info)';
                DOM.strengthRatingText.innerText = 'Good';
                DOM.strengthRatingText.style.color = 'var(--info)';
                break;
            case 4:
                DOM.strengthMeterFill.style.width = '100%';
                DOM.strengthMeterFill.style.backgroundColor = 'var(--success)';
                DOM.strengthRatingText.innerText = 'Strong';
                DOM.strengthRatingText.style.color = 'var(--success)';
                break;
        }
    }

    /**
     * Handle Email + Password Submission
     */
    function handlePasswordSubmit(e) {
        e.preventDefault();

        if (STATE.isLockedOut) {
            showAlert('Sign-in is currently rate-limited. Please wait for the lockout timer to expire.');
            return;
        }

        const email = DOM.inputEmailPassword.value.trim();
        const password = DOM.inputPassword.value;

        let hasError = false;

        if (!validateEmailField(DOM.inputEmailPassword, DOM.emailErrorMsg, DOM.emailValidIcon)) {
            DOM.inputEmailPassword.focus();
            hasError = true;
        }

        if (!password || password.length < 6) {
            DOM.passwordErrorMsg.innerText = 'Password must be at least 6 characters.';
            DOM.passwordErrorMsg.classList.remove('hidden');
            DOM.inputPassword.classList.add('is-invalid');
            if (!hasError) DOM.inputPassword.focus();
            hasError = true;
        }

        if (hasError) return;

        // Perform Simulated Sign In with Feedback
        setLoading(DOM.btnSubmitPassword, DOM.spinnerPassword, true, 'Authenticating...');

        setTimeout(() => {
            setLoading(DOM.btnSubmitPassword, DOM.spinnerPassword, false, 'Sign In with Email');

            // Verification logic (Supports our demo credentials or valid format test)
            const isDemoAdmin = email === 'admin@verifyyy.ai' && password === 'VerifyMaster@2026';
            const isDemoSuper = email === 'superadmin@verifyyy.internal' && password === 'SuperSecure#992';
            const isDemoOfficer = email === 'officer@fintech-bank.com' && password === 'BankKYC2026!';
            const isValidGeneralTest = password.length >= 8 && email.includes('@');

            if (isDemoAdmin || isDemoSuper || isDemoOfficer || isValidGeneralTest) {
                // Success!
                handleAuthSuccess(email, 'password');
            } else {
                // Failed attempt
                handleAuthFailure('Incorrect password. For testing, use the "Demo Accounts" helper in the top right.');
            }
        }, 1200);
    }

    /**
     * Handle OTP Request
     */
    function handleRequestOtp() {
        const email = DOM.inputEmailOtp.value.trim();

        if (!EMAIL_REGEX.test(email)) {
            DOM.otpEmailErrorMsg.classList.remove('hidden');
            DOM.inputEmailOtp.classList.add('is-invalid');
            DOM.inputEmailOtp.focus();
            return;
        }

        STATE.targetEmail = email;
        setLoading(DOM.btnRequestOtp, DOM.spinnerOtpRequest, true, 'Generating Code...');

        setTimeout(() => {
            setLoading(DOM.btnRequestOtp, DOM.spinnerOtpRequest, false, 'Send Verification Code');

            // Switch to Step B
            DOM.otpStepRequest.classList.remove('active');
            DOM.otpStepRequest.classList.add('hidden');

            DOM.otpStepVerify.classList.remove('hidden');
            DOM.otpStepVerify.classList.add('active');

            DOM.otpTargetEmailDisplay.innerText = email;

            // Generate demo code & notify
            STATE.currentOtpCode = (email === 'admin@verifyyy.ai') ? '928371' : '123456';
            showToast(`Verification code sent! Test code is: ${STATE.currentOtpCode}`, 'info', 7000);

            // Focus first OTP box
            DOM.otpInputs[0].focus();
            startResendTimer(45);
        }, 900);
    }

    /**
     * Segmented 6-Box OTP Input Management
     */
    function setupOtpInputBoxes() {
        DOM.otpInputs.forEach((box, index) => {
            // Typing input
            box.addEventListener('input', (e) => {
                const val = e.target.value;
                DOM.otpErrorMsg.classList.add('hidden');

                if (val.length === 1) {
                    if (index < DOM.otpInputs.length - 1) {
                        DOM.otpInputs[index + 1].focus();
                    }
                }
            });

            // Backspace navigation
            box.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !box.value && index > 0) {
                    DOM.otpInputs[index - 1].focus();
                } else if (e.key === 'ArrowLeft' && index > 0) {
                    DOM.otpInputs[index - 1].focus();
                } else if (e.key === 'ArrowRight' && index < DOM.otpInputs.length - 1) {
                    DOM.otpInputs[index + 1].focus();
                }
            });

            // Paste full 6-digit code support
            box.addEventListener('paste', (e) => {
                e.preventDefault();
                const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
                const cleanDigits = pasteData.replace(/\D/g, '').slice(0, 6);

                if (cleanDigits.length > 0) {
                    cleanDigits.split('').forEach((char, i) => {
                        if (DOM.otpInputs[i]) {
                            DOM.otpInputs[i].value = char;
                        }
                    });

                    const nextIndex = Math.min(cleanDigits.length, DOM.otpInputs.length - 1);
                    DOM.otpInputs[nextIndex].focus();

                    if (cleanDigits.length === 6) {
                        // Auto trigger verification
                        handleVerifyOtp();
                    }
                }
            });
        });
    }

    /**
     * Return from OTP verification step back to entering email
     */
    function backToOtpRequestStep() {
        DOM.otpStepVerify.classList.remove('active');
        DOM.otpStepVerify.classList.add('hidden');

        DOM.otpStepRequest.classList.remove('hidden');
        DOM.otpStepRequest.classList.add('active');

        clearInterval(STATE.resendInterval);
    }

    /**
     * Start Resend OTP Countdown
     */
    function startResendTimer(seconds) {
        clearInterval(STATE.resendInterval);
        let timeLeft = seconds;

        DOM.resendTimerText.classList.remove('hidden');
        DOM.btnResendOtp.classList.add('hidden');

        DOM.resendCountdown.innerText = `00:${timeLeft < 10 ? '0' : ''}${timeLeft}`;

        STATE.resendInterval = setInterval(() => {
            timeLeft--;
            DOM.resendCountdown.innerText = `00:${timeLeft < 10 ? '0' : ''}${timeLeft}`;

            if (timeLeft <= 0) {
                clearInterval(STATE.resendInterval);
                DOM.resendTimerText.classList.add('hidden');
                DOM.btnResendOtp.classList.remove('hidden');
            }
        }, 1000);
    }

    /**
     * Resend OTP Action
     */
    function handleResendOtp() {
        showToast(`New verification code sent to ${STATE.targetEmail}. Code: ${STATE.currentOtpCode}`, 'info', 6000);
        startResendTimer(45);
    }

    /**
     * Handle OTP Verification Submission
     */
    function handleVerifyOtp() {
        let enteredOtp = '';
        DOM.otpInputs.forEach(input => enteredOtp += input.value.trim());

        if (enteredOtp.length < 6) {
            DOM.otpErrorMsg.innerText = 'Please enter all 6 digits of the verification code.';
            DOM.otpErrorMsg.classList.remove('hidden');
            return;
        }

        setLoading(DOM.btnVerifyOtp, DOM.spinnerOtpVerify, true, 'Validating Code...');

        setTimeout(() => {
            setLoading(DOM.btnVerifyOtp, DOM.spinnerOtpVerify, false, 'Verify & Sign In');

            if (enteredOtp === STATE.currentOtpCode || enteredOtp === '123456' || enteredOtp === '928371' || enteredOtp === '654321') {
                handleAuthSuccess(STATE.targetEmail, 'otp');
            } else {
                DOM.otpErrorMsg.innerText = `Invalid code. Try entering "${STATE.currentOtpCode}" for instant test verification.`;
                DOM.otpErrorMsg.classList.remove('hidden');
                DOM.otpInputs[0].focus();
                DOM.otpInputs.forEach(box => box.classList.add('is-invalid'));
                setTimeout(() => DOM.otpInputs.forEach(box => box.classList.remove('is-invalid')), 2000);
            }
        }, 1000);
    }

    /**
     * Authentication Success Pipeline
     */
    function handleAuthSuccess(email, method) {
        STATE.failedAttempts = 0;

        // Remember Me Persistence
        if (DOM.rememberMeCheckbox.checked) {
            localStorage.setItem('verifyyy_remembered_email', email);
        } else {
            localStorage.removeItem('verifyyy_remembered_email');
        }

        // Store Session Token
        const sessionPayload = {
            email: email,
            role: STATE.selectedPortal,
            authenticatedAt: new Date().toISOString(),
            method: method,
            token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.verifyyy.' + Math.random().toString(36).substring(2)
        };
        localStorage.setItem('verifyyy_auth_session', JSON.stringify(sessionPayload));

        const targetDestination = PORTAL_URLS[STATE.selectedPortal] || PORTAL_URLS.runner;

        showToast(`Authentication successful! Redirecting to ${STATE.selectedPortal.toUpperCase()} portal...`, 'success', 3000);

        setTimeout(() => {
            window.location.href = targetDestination;
        }, 1500);
    }

    /**
     * Authentication Failure & Rate Limiting Defense
     */
    function handleAuthFailure(message) {
        STATE.failedAttempts++;
        showAlert(message);

        if (STATE.failedAttempts >= 3) {
            triggerRateLimitLockout(30);
        }
    }

    /**
     * 30-Second Lockout After 3 Failed Attempts
     */
    function triggerRateLimitLockout(seconds) {
        STATE.isLockedOut = true;
        DOM.rateLimitBox.classList.remove('hidden');

        let remaining = seconds;
        DOM.rateLimitTimer.innerText = `00:${remaining < 10 ? '0' : ''}${remaining}`;

        clearInterval(STATE.rateLimitInterval);
        STATE.rateLimitInterval = setInterval(() => {
            remaining--;
            DOM.rateLimitTimer.innerText = `00:${remaining < 10 ? '0' : ''}${remaining}`;

            if (remaining <= 0) {
                clearInterval(STATE.rateLimitInterval);
                STATE.isLockedOut = false;
                STATE.failedAttempts = 0;
                DOM.rateLimitBox.classList.add('hidden');
                hideAlert();
                showToast('Lockout expired. You may now attempt signing in again.', 'info', 4000);
            }
        }, 1000);
    }

    /**
     * Forgot Password Flow
     */
    function openForgotPasswordModal() {
        DOM.modalForgotPassword.classList.remove('hidden');
        DOM.fpFormView.classList.remove('hidden');
        DOM.fpSuccessView.classList.add('hidden');
        DOM.fpErrorMsg.classList.add('hidden');

        const currentEmail = DOM.inputEmailPassword.value.trim();
        if (currentEmail) DOM.fpInputEmail.value = currentEmail;
        DOM.fpInputEmail.focus();
    }

    function closeForgotPasswordModal() {
        DOM.modalForgotPassword.classList.add('hidden');
    }

    function handleSendPasswordReset() {
        const email = DOM.fpInputEmail.value.trim();
        if (!EMAIL_REGEX.test(email)) {
            DOM.fpErrorMsg.classList.remove('hidden');
            DOM.fpInputEmail.focus();
            return;
        }

        setLoading(DOM.btnSendResetLink, DOM.spinnerFp, true, 'Dispatching Email...');

        setTimeout(() => {
            setLoading(DOM.btnSendResetLink, DOM.spinnerFp, false, 'Send Password Reset Link');
            DOM.fpFormView.classList.add('hidden');
            DOM.fpSuccessView.classList.remove('hidden');
            DOM.fpSuccessEmail.innerText = email;
            showToast(`Reset email dispatched to ${email}`, 'success');
        }, 1100);
    }

    /**
     * Auto-Populate Demo Credentials
     */
    function populateCredentials(email, password, portal, otp) {
        DOM.inputEmailPassword.value = email;
        DOM.inputPassword.value = password;
        DOM.inputEmailOtp.value = email;
        STATE.currentOtpCode = otp;

        setPortalSelection(portal);
        validateEmailField(DOM.inputEmailPassword, DOM.emailErrorMsg, DOM.emailValidIcon);
        updatePasswordStrength(password);
    }

    /**
     * Alert UI Helpers
     */
    function showAlert(msg) {
        DOM.alertMsg.innerText = msg;
        DOM.globalAlert.classList.remove('hidden');
    }

    function hideAlert() {
        DOM.globalAlert.classList.add('hidden');
    }

    /**
     * Button Loading State Helper
     */
    function setLoading(btn, spinner, isLoading, labelText) {
        btn.disabled = isLoading;
        if (spinner) spinner.classList.toggle('hidden', !isLoading);
        const textSpan = btn.querySelector('.btn-text');
        if (textSpan && labelText) textSpan.innerText = labelText;
    }

    /**
     * Toast Notifications Helper
     */
    function showToast(message, type = 'info', duration = 3500) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let icon = 'ℹ️';
        if (type === 'success') icon = '✓';
        if (type === 'error') icon = '✕';
        if (type === 'warning') icon = '⚠️';

        toast.innerHTML = `<span style="font-weight:bold;">${icon}</span> <span>${message}</span>`;
        DOM.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

})();
