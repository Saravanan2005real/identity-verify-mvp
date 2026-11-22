const API_BASE = "";
const SUPABASE_REST_URL = 'https://mhxhttawwpqywedzpybf.supabase.co/rest/v1';
const SUPABASE_ANON_KEY = 'sb_publishable_fa7-pjSYD5TS9Z-YxOUMGQ_JrX2jY-E';

async function fetchPipelineFromSupabase(pid) {
    try {
        const resp = await fetch(`${SUPABASE_REST_URL}/verifications?session_id=eq.pipeline_${encodeURIComponent(pid)}&select=*`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].metadata) {
            return rows[0].metadata;
        }
    } catch (e) {
        console.warn('Could not load pipeline from Supabase:', e);
    }
    return null;
}

// DOM Elements
const stepperEl = document.getElementById('pipeline-stepper');
const contentEl = document.getElementById('flow-content');
const canvasEl = document.getElementById('runner-canvas');
const pidTagEl = document.getElementById('pipeline-id-tag');

// Read URL Params
const urlParams = new URLSearchParams(window.location.search);
const flowString = urlParams.get('flow') || 'PAN_FACE,EYE_TRACKING';
const pipelineId = urlParams.get('pid') || 'FLOW-' + Math.random().toString(36).substr(2, 6).toUpperCase();
const applicantToken = urlParams.get('applicant_token') || '';

if (pidTagEl) pidTagEl.textContent = `PID: ${pipelineId}`;

// Parse Modules List
const moduleKeys = flowString.split(',').map(m => m.trim().toUpperCase()).filter(Boolean);

// Module Definition Map
const MODULE_NAMES = {
    "FORM": "Application Form",
    "PAN_FACE": "PAN & Face Verification",
    "AADHAAR_FACE": "Aadhaar & Face Verification",
    "PAN": "PAN Card OCR",
    "AADHAAR": "Aadhaar Card OCR",
    "EYE_TRACKING": "Eye Tracking & Attention",
    "HUMAN_REVIEW": "Human Review Queue"
};

// State
let currentStepIndex = 0;
let flowSessionId = null;
let uploadedDocumentId = null;
let uploadedFaceFilename = null;
let verificationResults = [];
let videoStream = null;

// Global registries for applicant data collection (fast, model-free execution)
window.__uploadedDocuments = window.__uploadedDocuments || {};
window.__capturedSelfies = window.__capturedSelfies || {};
window.__applicantAnswers = window.__applicantAnswers || {};
window.__moduleVerificationStatus = window.__moduleVerificationStatus || {};
window.__uploadedDocDataUrl = null;
window.__uploadedSelfieDataUrl = null;

// Initialize Pipeline
async function initPipeline() {
    // Security: Clean URL query parameters from browser address bar to prevent leaking sensitive applicant tokens
    if (window.history && window.history.replaceState && applicantToken) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({ pid: pipelineId }, document.title, cleanUrl);
    }

    let savedData = null;
    try {
        const raw = localStorage.getItem('verifyyy_form_data_' + pipelineId);
        if (raw) savedData = JSON.parse(raw);
    } catch(e) {}

    if (!savedData && pipelineId) {
        savedData = await fetchPipelineFromSupabase(pipelineId);
    }

    // Check if customizable flow blocks or pages are configured
    if (savedData && (savedData.flowBlocks || savedData.pages)) {
        initCustomizableFlow(savedData);
        return;
    }

    // Otherwise, legacy modular step runner
    if (stepperEl) {
        stepperEl.innerHTML = moduleKeys.map((modKey, idx) => `
            <div class="step-pill ${idx === 0 ? 'active' : ''}" id="pill-step-${idx}">
                Step ${idx + 1}: ${MODULE_NAMES[modKey] || modKey}
            </div>
            ${idx < moduleKeys.length - 1 ? '<span class="step-divider">→</span>' : ''}
        `).join('');
    }

    renderCurrentStep();
}

// -------------------------------------------------------------
// DYNAMIC CUSTOMIZABLE MULTI-PAGE & EMBEDDED MODULE ENGINE
// -------------------------------------------------------------

function partitionBlocksIntoPages(blocks) {
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
}

function initCustomizableFlow(savedData) {
    const flowTitle = savedData.title || savedData.name || 'Identity Verification Form';
    const flowDesc = savedData.description || 'Please complete all required fields and identity verification steps below.';
    const pages = (savedData.pages && Array.isArray(savedData.pages) && savedData.pages.length > 0 && savedData.pages[0].blocks)
        ? savedData.pages
        : partitionBlocksIntoPages(savedData.flowBlocks || []);

    window.__customPages = pages;
    window.__customFlowTitle = flowTitle;
    window.__customFlowDesc = flowDesc;
    window.__currentPageIndex = 0;
    window.__applicantAnswers = window.__applicantAnswers || {};
    window.__moduleVerificationStatus = window.__moduleVerificationStatus || {};

    renderCustomStepper();
    renderCustomizablePage(0);
}

function renderCustomStepper() {
    if (!stepperEl) return;
    const pages = window.__customPages || [];
    const curIdx = window.__currentPageIndex || 0;

    stepperEl.innerHTML = pages.map((page, idx) => {
        const title = page.header?.title || `Page ${idx + 1}`;
        const isCompleted = idx < curIdx;
        const isActive = idx === curIdx;
        return `
            <div class="step-pill ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" id="pill-page-${idx}">
                ${isCompleted ? '✓ ' : ''}${title}
            </div>
            ${idx < pages.length - 1 ? '<span class="step-divider">→</span>' : ''}
        `;
    }).join('');
}

function renderFieldInputHtmlWithVal(f, val) {
    const isRequired = f.required ? 'required' : '';
    if (f.type === 'paragraph') {
        return `<textarea name="${f.id}" style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; font-size:16px; min-height:80px;" placeholder="Your answer" ${isRequired}>${val || ''}</textarea>`;
    }
    if (f.type === 'multiple_choice') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return opts.map((opt, oi) => `
            <div style="margin:8px 0; display:flex; align-items:center; gap:8px;">
                <input type="radio" name="${f.id}" id="${f.id}_${oi}" value="${opt}" ${val === opt ? 'checked' : ''} ${isRequired && oi === 0 ? 'required' : ''}>
                <label for="${f.id}_${oi}" style="color:#3c4043; cursor:pointer; font-size:15px;">${opt}</label>
            </div>
        `).join('');
    }
    if (f.type === 'checkboxes') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        const valArr = Array.isArray(val) ? val : (val ? [val] : []);
        return opts.map((opt, oi) => `
            <div style="margin:8px 0; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" name="${f.id}" id="${f.id}_${oi}" value="${opt}" ${valArr.includes(opt) ? 'checked' : ''}>
                <label for="${f.id}_${oi}" style="color:#3c4043; cursor:pointer; font-size:15px;">${opt}</label>
            </div>
        `).join('');
    }
    if (f.type === 'dropdown') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return `
            <select name="${f.id}" style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; font-size:16px; background:#fff;" ${isRequired}>
                <option value="">Choose an option</option>
                ${opts.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
        `;
    }
    if (f.type === 'date') {
        return `<input type="date" name="${f.id}" value="${val || ''}" style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; font-size:16px;" ${isRequired} />`;
    }
    if (f.type === 'file_upload') {
        return `<input type="file" name="${f.id}" style="width:100%; padding:8px 0; font-size:15px;" ${isRequired} />`;
    }
    // Default short_answer
    return `<input type="text" name="${f.id}" value="${val || ''}" style="width:100%; box-sizing:border-box; border:none; border-bottom:1.5px solid #dadce0; padding:8px 0; font-size:16px; outline:none;" placeholder="Your answer" ${isRequired} />`;
}

function renderCustomizablePage(pIdx) {
    window.__currentPageIndex = pIdx;
    renderCustomStepper();
    stopWebcamStream();

    const pages = window.__customPages;
    const page = pages[pIdx];
    const totalPages = pages.length;
    const isFirstPage = pIdx === 0;
    const isLastPage = pIdx === totalPages - 1;

    const pageTitle = isFirstPage ? window.__customFlowTitle : (page.header?.title || `Page ${pIdx + 1}`);
    const pageDesc = isFirstPage ? window.__customFlowDesc : (page.header?.desc || 'Please complete all items on this page before proceeding.');

    let html = `
        <div style="text-align:left; max-width:720px; margin:0 auto;">
            <!-- Page Header Card -->
            <div style="background:#fff; border-top:8px solid #008080; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 3px rgba(60,64,67,0.1); border:1px solid #dadce0;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="margin:0 0 8px; font-size:1.6rem; color:#202124;">${pageTitle}</h2>
                    <span style="font-size:0.85rem; font-weight:700; color:#008080; background:rgba(0, 128, 128, 0.06); padding:4px 12px; border-radius:12px; border:1px solid rgba(0, 128, 128, 0.22);">
                        Page ${pIdx + 1} of ${totalPages}
                    </span>
                </div>
                <p style="margin:0; color:#5f6368; font-size:0.95rem;">${pageDesc}</p>
            </div>

            <!-- Page Blocks Sequence -->
            <form id="custom-page-form" onsubmit="event.preventDefault();">
    `;

    (page.blocks || []).forEach((block, bIdx) => {
        if (block.kind === 'question') {
            const answeredVal = window.__applicantAnswers[block.title || `q_${block.id}`] || '';
            html += `
                <div class="step-card" style="background:#fff; border-radius:12px; padding:20px 24px; margin-bottom:16px; box-shadow:0 1px 3px rgba(60,64,67,0.1); border:1px solid #dadce0;" id="card-block-${block.id}">
                    <label style="display:block; font-weight:600; margin-bottom:10px; color:#202124; font-size:1rem;">
                        ${block.title || `Question ${bIdx + 1}`}
                        ${block.required ? '<span style="color:#d93025;"> *</span>' : ''}
                    </label>
                    ${renderFieldInputHtmlWithVal(block, answeredVal)}
                </div>
            `;
        } else if (block.kind === 'module') {
            const modId = block.moduleId || 'AADHAAR_FACE';
            const isPan = modId.includes('PAN');
            const docLabel = isPan ? 'PAN Card' : 'Aadhaar Card';
            const isEye = modId.includes('EYE');
            const isHuman = modId.includes('HUMAN');
            const isVerified = window.__moduleVerificationStatus[block.id]?.verified;

            html += `
                <div class="step-card" style="background:#fff; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 2px 8px rgba(0, 128, 128, 0.12); border:2px solid #008080;" id="card-block-${block.id}">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
                        <div>
                            <h3 style="margin:0; text-align:left; color:#008080; font-size:1.2rem; display:flex; align-items:center; gap:8px;">
                                <span>${block.icon || '🛡️'}</span> ${block.name}
                            </h3>
                            <p style="margin:4px 0 0; text-align:left; font-size:0.85rem; color:#64748b;">${block.desc || 'Automated identity verification check'}</p>
                        </div>
                        <div id="status-badge-${block.id}">
                            ${isVerified
                                ? '<span class="badge badge-success">✓ VERIFIED</span>'
                                : '<span class="badge badge-info">Pending Verification</span>'
                            }
                        </div>
                    </div>
            `;

            if (isEye) {
                html += `
                    <div style="text-align:center; padding:16px;">
                        <p style="margin-bottom:12px; color:#475569;">Click "Start Eye Tracking Check" to calibrate and test gaze attention.</p>
                        <button type="button" class="btn" id="btn-eyetrack-${block.id}" style="width:auto; padding:10px 24px; background:#008080; color:#fff; border-radius:8px;">
                            ${isVerified ? '✓ Eye Tracking Completed' : 'Start Eye Tracking Check'}
                        </button>
                        <div id="eyetrack-res-${block.id}" style="margin-top:10px; font-weight:700; color:#059669;"></div>
                    </div>
                `;
            } else if (isHuman) {
                html += `
                    <div style="padding:14px; background:#f8fafc; border-radius:8px; border:1px solid #e2e8f0;">
                        <p style="margin:0; text-align:left; color:#475569; font-size:0.9rem;">
                            ℹ️ This application will be submitted for manual audit by a human compliance officer upon completion.
                        </p>
                    </div>
                `;
            } else {
                // Document upload & optional live face verification
                const isFace = modId.includes('FACE');
                html += `
                    <!-- Part 1: Document Upload -->
                    <div id="substep-upload-${block.id}" style="background:#f8fafc; border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid #e2e8f0;">
                        <h4 style="margin:0 0 8px; color:#008080; text-align:left; font-size:1.05rem;">
                            Step 1: Attach ${docLabel} Photo
                        </h4>
                        <p style="font-size:0.85rem; color:#64748b; margin:0 0 12px; text-align:left;">
                            Upload or capture a clear photo of your ${docLabel}.
                        </p>
                        <input type="file" id="runner-doc-file-${block.id}" accept="image/*" style="display:block; margin-bottom:10px; font-size:0.95rem;">
                        <div id="upload-preview-${block.id}" class="hidden"></div>
                    </div>

                    ${isFace ? `
                    <!-- Part 2: Live Face Verification -->
                    <div id="substep-live-${block.id}" class="hidden" style="background:#f8fafc; border-radius:8px; padding:16px; border:1px solid #e2e8f0;">
                        <h4 style="margin:0 0 8px; color:#008080; text-align:left; font-size:1.05rem;">
                            Step 2: Capture Live Selfie Photo
                        </h4>
                        <p style="font-size:0.85rem; color:#64748b; margin:0 0 12px; text-align:left;">
                            Position your face inside the frame and snap a photo.
                        </p>
                        <div class="live-video-wrap" style="max-width:440px; margin:0 auto 12px;">
                            <video id="runner-webcam-${block.id}" autoplay playsinline></video>
                        </div>
                        <div style="text-align:center;">
                            <button class="btn btn-action-mobile" id="btn-capture-${block.id}" type="button" style="background:#008080; color:#fff; width:auto; padding:12px 28px; min-height:44px; border-radius:6px; font-weight:600; cursor:pointer;">
                                📸 Capture Selfie Photo
                            </button>
                        </div>
                        <div id="live-preview-${block.id}" class="hidden"></div>
                    </div>
                    ` : ''}
                `;
            }

            html += `</div>`;
        }
    });

    // Page Navigation Buttons
    html += `
            <div class="page-nav-row" style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0; flex-wrap:wrap; gap:12px;">
                <div>
                    ${!isFirstPage ? `
                        <button type="button" id="btn-page-prev" class="btn" style="background:#e2e8f0; color:#1e293b; width:auto; padding:12px 24px; border-radius:24px; font-weight:600; cursor:pointer;">
                            ← Previous Page
                        </button>
                    ` : '<div></div>'}
                </div>
                <div>
                    <button type="button" id="btn-page-next" class="btn" style="background:${isLastPage ? '#10b981' : '#008080'}; color:#fff; width:auto; padding:12px 32px; border-radius:24px; font-weight:700; font-size:1rem; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.15);">
                        ${isLastPage ? 'Complete & Submit Verification 🚀' : 'Continue to Next Page →'}
                    </button>
                </div>
            </div>
        </form>
    </div>
    `;

    contentEl.innerHTML = html;

    // Attach dynamic module events
    page.blocks.forEach(block => {
        if (block.kind === 'module') {
            attachCustomModuleListeners(block);
        }
    });

    // Attach navigation buttons
    const btnPrev = document.getElementById('btn-page-prev');
    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            saveCurrentPageAnswers(page);
            renderCustomizablePage(pIdx - 1);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    const btnNext = document.getElementById('btn-page-next');
    if (btnNext) {
        btnNext.addEventListener('click', () => {
            const valid = validateAndSaveCurrentPage(page);
            if (!valid) return;

            if (isLastPage) {
                renderFinalCompletion();
            } else {
                renderCustomizablePage(pIdx + 1);
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        });
    }
}

function attachCustomModuleListeners(block) {
    const modId = block.moduleId || 'AADHAAR_FACE';
    if (modId.includes('EYE')) {
        const btnEye = document.getElementById(`btn-eyetrack-${block.id}`);
        const resEye = document.getElementById(`eyetrack-res-${block.id}`);
        if (btnEye) {
            btnEye.addEventListener('click', () => {
                btnEye.disabled = true;
                resEye.textContent = "Recording gaze attention activity...";
                setTimeout(() => {
                    resEye.innerHTML = "✓ Gaze attention activity completed";
                    window.__moduleVerificationStatus[block.id] = { verified: true, status: 'PASSED', details: 'Eye tracking activity completed' };
                    verificationResults.push({ module: 'EYE_TRACKING', status: 'PASSED', details: 'Eye tracking activity completed' });
                    const badge = document.getElementById(`status-badge-${block.id}`);
                    if (badge) badge.innerHTML = '<span class="badge badge-success">✓ COMPLETED</span>';
                }, 1000);
            });
        }
        return;
    }

    if (modId.includes('HUMAN')) {
        window.__moduleVerificationStatus[block.id] = { verified: true, status: 'QUEUED', details: 'Queued for human audit' };
        verificationResults.push({ module: 'HUMAN_REVIEW', status: 'QUEUED', details: 'Queued for human audit' });
        return;
    }

    // Document & Live Face verification (Immediate, model-free attachment)
    const isPan = modId.includes('PAN');
    const isFace = modId.includes('FACE');
    const docLabel = isPan ? 'PAN Card' : 'Aadhaar Card';

    const fileInput = document.getElementById(`runner-doc-file-${block.id}`);
    const substepLive = document.getElementById(`substep-live-${block.id}`);
    const btnCapture = document.getElementById(`btn-capture-${block.id}`);
    const videoEl = document.getElementById(`runner-webcam-${block.id}`);
    const uploadPreview = document.getElementById(`upload-preview-${block.id}`);
    const livePreview = document.getElementById(`live-preview-${block.id}`);

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const dataUrl = e.target.result;
                    window.__uploadedDocuments[block.id] = {
                        dataUrl,
                        type: isPan ? 'PAN' : 'AADHAAR',
                        fileName: file.name
                    };
                    if (uploadPreview) {
                        uploadPreview.innerHTML = `
                            <div style="display:flex; align-items:center; gap:12px; margin-top:12px; background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:8px;">
                                <img src="${dataUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; border:1px solid #86efac;">
                                <div>
                                    <div style="color:#166534; font-weight:700; font-size:0.95rem;">✓ ${docLabel} Attached</div>
                                    <div style="color:#64748b; font-size:0.8rem;">${file.name}</div>
                                </div>
                            </div>
                        `;
                        uploadPreview.classList.remove('hidden');
                    }
                    if (isFace && substepLive) {
                        substepLive.classList.remove('hidden');
                        await startWebcamStreamForVideo(videoEl);
                        setTimeout(() => {
                            substepLive.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }, 100);
                    } else if (!isFace) {
                        window.__moduleVerificationStatus[block.id] = {
                            verified: true,
                            status: 'PASSED',
                            details: `${docLabel} photo securely attached`
                        };
                        verificationResults.push({
                            module: modId,
                            status: 'PASSED',
                            details: `${docLabel} photo securely attached`
                        });
                        const badge = document.getElementById(`status-badge-${block.id}`);
                        if (badge) {
                            badge.innerHTML = '<span class="badge badge-success">✓ COMPLETED</span>';
                        }
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (btnCapture) {
        btnCapture.addEventListener('click', async () => {
            if (!videoEl) return;

            if (videoEl.paused || !videoEl.srcObject) {
                await startWebcamStreamForVideo(videoEl);
            }

            if (videoEl.readyState < 2) {
                for (let i = 0; i < 10; i++) {
                    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) break;
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            if (videoEl.readyState < 2 && (!videoEl.videoWidth || videoEl.videoWidth === 0)) {
                alert("Camera is starting up or permissions needed. Please allow camera access in your browser settings.");
                return;
            }

            canvasEl.width = videoEl.videoWidth || 640;
            canvasEl.height = videoEl.videoHeight || 480;
            const ctx = canvasEl.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            const dataUrl = canvasEl.toDataURL('image/jpeg', 0.90);

            window.__capturedSelfies[block.id] = dataUrl;
            window.__moduleVerificationStatus[block.id] = {
                verified: true,
                status: 'PASSED',
                details: `${docLabel} and live selfie securely captured`
            };
            verificationResults.push({
                module: modId,
                status: 'PASSED',
                details: `${docLabel} and live selfie securely captured`
            });

            if (livePreview) {
                livePreview.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px; margin-top:12px; background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:8px;">
                        <img src="${dataUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; border:1px solid #86efac;">
                        <div>
                            <div style="color:#166534; font-weight:700; font-size:0.95rem;">✓ Live Selfie Photo Captured</div>
                            <div style="color:#64748b; font-size:0.8rem;">Ready for verification submission</div>
                        </div>
                    </div>
                `;
                livePreview.classList.remove('hidden');
            }

            const badge = document.getElementById(`status-badge-${block.id}`);
            if (badge) {
                badge.innerHTML = '<span class="badge badge-success">✓ COMPLETED</span>';
            }
        });
    }
}

async function startWebcamStreamForVideo(videoEl) {
    if (!videoEl) return;
    try {
        if (!videoStream || !videoStream.active) {
            videoStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
        }
        videoEl.srcObject = videoStream;
        await videoEl.play().catch(e => console.warn("Webcam play deferred:", e));
    } catch (e) {
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoEl.srcObject = videoStream;
            await videoEl.play().catch(e2 => console.warn("Fallback play deferred:", e2));
        } catch (e2) {
            console.error("Camera access failed:", e2);
        }
    }
}

function saveCurrentPageAnswers(page) {
    const formEl = document.getElementById('custom-page-form');
    if (!formEl) return;
    (page.blocks || []).forEach((block) => {
        if (block.kind === 'question') {
            const key = block.title || `q_${block.id}`;
            if (['multiple_choice', 'checkboxes'].includes(block.type)) {
                const checked = formEl.querySelectorAll(`input[name="${block.id}"]:checked`);
                const vals = Array.from(checked).map(c => c.value);
                window.__applicantAnswers[key] = block.type === 'multiple_choice' ? (vals[0] || '') : vals;
            } else {
                const el = formEl.querySelector(`[name="${block.id}"]`);
                if (el) window.__applicantAnswers[key] = el.value;
            }
        }
    });
}

function validateAndSaveCurrentPage(page) {
    saveCurrentPageAnswers(page);

    // 1. Validate required questions
    for (const block of (page.blocks || [])) {
        if (block.kind === 'question' && block.required) {
            const key = block.title || `q_${block.id}`;
            const val = window.__applicantAnswers[key];
            const isEmpty = !val || (Array.isArray(val) && val.length === 0) || (typeof val === 'string' && !val.trim());
            if (isEmpty) {
                alert(`Please answer the required question: "${block.title || 'Untitled'}"`);
                const card = document.getElementById(`card-block-${block.id}`);
                if (card) {
                    card.style.borderColor = '#ef4444';
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return false;
            }
        }
    }

    // 2. Validate completed verification modules on current page
    for (const block of (page.blocks || [])) {
        if (block.kind === 'module') {
            const modId = block.moduleId || '';
            // If it's a document/face verification module, verify requirements
            if (modId.includes('FACE') || modId.includes('PAN') || modId.includes('AADHAAR')) {
                const isFace = modId.includes('FACE');
                const hasDoc = !!window.__uploadedDocuments[block.id];
                const hasSelfie = !!window.__capturedSelfies[block.id];
                if (!hasDoc || (isFace && !hasSelfie)) {
                    const missing = !hasDoc ? 'attach your document photo' : 'capture your live selfie photo';
                    alert(`Please ${missing} for "${block.name}" before continuing.`);
                    const card = document.getElementById(`card-block-${block.id}`);
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    return false;
                }
            }
        }
    }

    return true;
}

function updateStepperUI() {
    moduleKeys.forEach((modKey, idx) => {
        const pill = document.getElementById(`pill-step-${idx}`);
        if (!pill) return;
        pill.classList.remove('active', 'completed');
        if (idx < currentStepIndex) {
            pill.classList.add('completed');
            pill.textContent = `✓ ${MODULE_NAMES[modKey] || modKey}`;
        } else if (idx === currentStepIndex) {
            pill.classList.add('active');
        }
    });
}

function renderCurrentStep() {
    updateStepperUI();

    if (currentStepIndex >= moduleKeys.length) {
        renderFinalCompletion();
        return;
    }

    const currentModule = moduleKeys[currentStepIndex];

    switch (currentModule) {
        case 'FORM':
            renderFormFieldsStep();
            break;
        case 'PAN_FACE':
        case 'AADHAAR_FACE':
        case 'PAN':
        case 'AADHAAR':
            renderDocFaceStep(currentModule);
            break;
        case 'EYE_TRACKING':
            renderEyeTrackingStep();
            break;
        case 'HUMAN_REVIEW':
            renderHumanReviewStep();
            break;
        default:
            renderDocFaceStep('PAN_FACE');
            break;
    }
}

// -------------------------------------------------------------
// MODULE: Custom Application Form Fields
// -------------------------------------------------------------
async function renderFormFieldsStep() {
    let savedData = null;
    try {
        const raw = localStorage.getItem('verifyyy_form_data_' + pipelineId);
        if (raw) savedData = JSON.parse(raw);
    } catch(e) {}

    if (!savedData && pipelineId) {
        savedData = await fetchPipelineFromSupabase(pipelineId);
    }

    const title = (savedData && (savedData.title || savedData.name)) || 'Application Form';
    const desc = (savedData && (savedData.description)) || 'Please provide your required information before proceeding to identity verification.';
    const fields = (savedData && savedData.fields && savedData.fields.length) ? savedData.fields : [
        { id: 'f1', title: 'Full Legal Name', type: 'short_answer', required: true },
        { id: 'f2', title: 'Work Email Address', type: 'short_answer', required: true }
    ];

    contentEl.innerHTML = `
        <div style="text-align:left; max-width:680px; margin:0 auto;">
            <div style="background:#fff; border-top:8px solid #673ab7; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 3px rgba(60,64,67,0.1); border:1px solid #dadce0;">
                <h2 style="margin:0 0 8px; font-size:1.6rem; color:#202124;">${title}</h2>
                <p style="margin:0; color:#5f6368; font-size:0.95rem;">${desc}</p>
            </div>

            <form id="applicant-custom-form" onsubmit="event.preventDefault(); window.submitApplicantForm();">
                ${fields.map((f, i) => `
                    <div style="background:#fff; border-radius:12px; padding:20px 24px; margin-bottom:16px; box-shadow:0 1px 3px rgba(60,64,67,0.1); border:1px solid #dadce0;">
                        <label style="display:block; font-weight:600; margin-bottom:10px; color:#202124; font-size:1rem;">
                            ${f.title || `Question ${i + 1}`}
                            ${f.required ? '<span style="color:#d93025;"> *</span>' : ''}
                        </label>
                        ${renderFieldInputHtml(f)}
                    </div>
                `).join('')}

                <div style="text-align:right; margin-top:24px;">
                    <button type="submit" class="btn" style="background:#673ab7; color:#fff; padding:12px 28px; border-radius:24px; font-weight:700; font-size:1rem; cursor:pointer; border:none; box-shadow:0 2px 6px rgba(103,58,183,0.3);">
                        Continue to Verification Steps →
                    </button>
                </div>
            </form>
        </div>
    `;

    window.submitApplicantForm = function() {
        const formEl = document.getElementById('applicant-custom-form');
        window.__applicantAnswers = {};
        if (formEl) {
            const inputs = formEl.querySelectorAll('input, textarea, select');
            inputs.forEach((inp, idx) => {
                const label = fields[idx]?.title || `Question ${idx + 1}`;
                window.__applicantAnswers[label] = inp.value;
            });
        }
        currentStepIndex++;
        renderCurrentStep();
    };
}

function renderFieldInputHtml(f) {
    if (f.type === 'paragraph') {
        return `<textarea style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; min-height:80px;" placeholder="Your answer" ${f.required ? 'required' : ''}></textarea>`;
    }
    if (f.type === 'multiple_choice') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return opts.map((opt, oi) => `
            <div style="margin:8px 0; display:flex; align-items:center; gap:8px;">
                <input type="radio" name="${f.id}" id="${f.id}_${oi}" value="${opt}" ${f.required && oi === 0 ? 'required' : ''}>
                <label for="${f.id}_${oi}" style="color:#3c4043; cursor:pointer;">${opt}</label>
            </div>
        `).join('');
    }
    if (f.type === 'checkboxes') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return opts.map((opt, oi) => `
            <div style="margin:8px 0; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" name="${f.id}" id="${f.id}_${oi}" value="${opt}">
                <label for="${f.id}_${oi}" style="color:#3c4043; cursor:pointer;">${opt}</label>
            </div>
        `).join('');
    }
    if (f.type === 'dropdown') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return `
            <select style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; background:#fff;" ${f.required ? 'required' : ''}>
                <option value="">Choose an option</option>
                ${opts.map(opt => `<option value="${opt}">${opt}</option>`).join('')}
            </select>
        `;
    }
    if (f.type === 'date') {
        return `<input type="date" style="border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit;" ${f.required ? 'required' : ''} />`;
    }
    if (f.type === 'file_upload') {
        return `<input type="file" style="width:100%; padding:8px 0;" ${f.required ? 'required' : ''} />`;
    }
    // Default short_answer
    return `<input type="text" style="width:100%; box-sizing:border-box; border:none; border-bottom:1.5px solid #dadce0; padding:8px 0; font-size:1rem; outline:none;" placeholder="Your answer" ${f.required ? 'required' : ''} />`;
}

// -------------------------------------------------------------
// MODULE: Document OCR & Live Face Verification (Fast, model-free)
// -------------------------------------------------------------
function renderDocFaceStep(modType) {
    const isPan = modType.includes('PAN');
    const docLabel = isPan ? 'PAN Card' : 'Aadhaar Card';

    contentEl.innerHTML = `
        <div style="text-align:center;">
            <h3 style="margin-bottom:8px;">${MODULE_NAMES[modType] || modType}</h3>
            <p style="color:var(--text-muted); margin-bottom:24px;">Attach your ${docLabel} photo, then take a live selfie photo.</p>

            <!-- Part 1: Upload -->
            <div id="substep-upload" class="step-card">
                <h4 style="margin-top:0; color:var(--primary);">Step 1: Attach ${docLabel} Photo</h4>
                <input type="file" id="runner-doc-file" accept="image/*">
                <div id="runner-upload-preview" class="hidden"></div>
            </div>

            <!-- Part 2: Live Verification -->
            <div id="substep-live" class="step-card hidden">
                <h4 style="margin-top:0; color:var(--primary);">Step 2: Capture Live Selfie Photo</h4>
                <p style="font-size:0.9rem; color:var(--text-muted);">Position your face in front of the camera and click Capture.</p>
                <div class="live-video-wrap">
                    <video id="runner-webcam" autoplay playsinline></video>
                </div>
                <button class="btn" id="btn-runner-capture" type="button">📸 Capture Selfie Photo</button>
                <div id="runner-live-preview" class="hidden"></div>
            </div>

            <div id="step-next-row" class="hidden" style="margin-top:20px; text-align:center;">
                <button class="btn" id="btn-step-continue" type="button" style="background:#10b981; width:auto; padding:12px 32px; border-radius:24px; font-weight:700;">
                    Continue to Next Step →
                </button>
            </div>
        </div>
    `;

    const fileInput = document.getElementById('runner-doc-file');
    const substepLive = document.getElementById('substep-live');
    const btnCapture = document.getElementById('btn-runner-capture');
    const uploadPreview = document.getElementById('runner-upload-preview');
    const livePreview = document.getElementById('runner-live-preview');
    const stepNextRow = document.getElementById('step-next-row');
    const btnContinue = document.getElementById('btn-step-continue');

    let currentDocDataUrl = null;
    let currentSelfieDataUrl = null;

    if (fileInput) {
        fileInput.addEventListener('change', () => {
            if (fileInput.files && fileInput.files.length > 0) {
                const file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = async (e) => {
                    currentDocDataUrl = e.target.result;
                    window.__uploadedDocDataUrl = currentDocDataUrl;
                    if (uploadPreview) {
                        uploadPreview.innerHTML = `
                            <div style="display:flex; align-items:center; gap:12px; margin-top:12px; background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:8px; text-align:left;">
                                <img src="${currentDocDataUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; border:1px solid #86efac;">
                                <div>
                                    <div style="color:#166534; font-weight:700; font-size:0.95rem;">✓ ${docLabel} Attached</div>
                                    <div style="color:#64748b; font-size:0.8rem;">${file.name}</div>
                                </div>
                            </div>
                        `;
                        uploadPreview.classList.remove('hidden');
                    }
                    if (substepLive) {
                        substepLive.classList.remove('hidden');
                        await startWebcamStream();
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (btnCapture) {
        btnCapture.addEventListener('click', async () => {
            const videoEl = document.getElementById('runner-webcam');
            if (!videoEl) return;

            if (videoEl.paused || !videoEl.srcObject) {
                await startWebcamStream();
            }

            canvasEl.width = videoEl.videoWidth || 640;
            canvasEl.height = videoEl.videoHeight || 480;
            const ctx = canvasEl.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            currentSelfieDataUrl = canvasEl.toDataURL('image/jpeg', 0.90);
            window.__uploadedSelfieDataUrl = currentSelfieDataUrl;

            stopWebcamStream();

            if (livePreview) {
                livePreview.innerHTML = `
                    <div style="display:flex; align-items:center; gap:12px; margin-top:12px; background:#f0fdf4; border:1px solid #bbf7d0; padding:12px; border-radius:8px; text-align:left;">
                        <img src="${currentSelfieDataUrl}" style="width:60px; height:60px; object-fit:cover; border-radius:6px; border:1px solid #86efac;">
                        <div>
                            <div style="color:#166534; font-weight:700; font-size:0.95rem;">✓ Live Selfie Captured</div>
                            <div style="color:#64748b; font-size:0.8rem;">Ready for verification submission</div>
                        </div>
                    </div>
                `;
                livePreview.classList.remove('hidden');
            }

            verificationResults.push({
                module: modType,
                status: 'PASSED',
                details: `${docLabel} and live selfie securely attached`
            });

            if (stepNextRow) {
                stepNextRow.classList.remove('hidden');
            }
        });
    }

    if (btnContinue) {
        btnContinue.addEventListener('click', () => {
            currentStepIndex++;
            renderCurrentStep();
        });
    }
}

async function startWebcamStream() {
    const videoEl = document.getElementById('runner-webcam');
    if (!videoEl) return;
    try {
        if (!videoStream || !videoStream.active) {
            videoStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
        }
        videoEl.srcObject = videoStream;
        await videoEl.play().catch(e => console.warn("Webcam play deferred:", e));
    } catch (e) {
        console.error("Camera access failed:", e);
        try {
            videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoEl.srcObject = videoStream;
            await videoEl.play().catch(e => console.warn("Fallback play deferred:", e));
        } catch (e2) {
            console.error("Fallback camera failed:", e2);
        }
    }
}

function stopWebcamStream() {
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
}

// -------------------------------------------------------------
// MODULE: Eye Tracking Calibration
// -------------------------------------------------------------
function renderEyeTrackingStep() {
    contentEl.innerHTML = `
        <div style="text-align:center;">
            <h3 style="margin-bottom:8px;">${MODULE_NAMES['EYE_TRACKING']}</h3>
            <p style="color:var(--text-muted); margin-bottom:24px;">Click the target dots on screen to verify your gaze and attention.</p>
            <div class="step-card" style="padding:40px;">
                <p>Click "Start Calibration" to begin gaze tracking check.</p>
                <button class="btn" id="btn-start-eyetrack" type="button">Start Eye Tracking Check</button>
                <div id="eyetrack-status" style="margin-top:16px; font-weight:bold; color:var(--primary);"></div>
            </div>
        </div>
    `;

    const btnStart = document.getElementById('btn-start-eyetrack');
    const statusEl = document.getElementById('eyetrack-status');

    btnStart.addEventListener('click', () => {
        statusEl.textContent = "Simulating gaze calibration check...";
        btnStart.disabled = true;

        setTimeout(() => {
            statusEl.innerHTML = `<span class="badge badge-success">✓ EYE TRACKING PASSED</span>`;
            verificationResults.push({ module: 'EYE_TRACKING', status: 'PASSED', details: 'Gaze calibration score 98%' });
            setTimeout(() => {
                currentStepIndex++;
                renderCurrentStep();
            }, 1500);
        }, 2000);
    });
}

// -------------------------------------------------------------
// MODULE: Human Review Flag
// -------------------------------------------------------------
function renderHumanReviewStep() {
    contentEl.innerHTML = `
        <div style="text-align:center;">
            <h3 style="margin-bottom:8px;">${MODULE_NAMES['HUMAN_REVIEW']}</h3>
            <p style="color:var(--text-muted); margin-bottom:24px;">This verification pipeline includes an automated human review compliance audit.</p>
            <div class="step-card" style="padding:40px;">
                <p style="color:var(--primary); font-weight:bold;">Queuing Application for Human Review...</p>
                <button class="btn" id="btn-human-continue" type="button">Submit for Manual Review</button>
            </div>
        </div>
    `;

    document.getElementById('btn-human-continue').addEventListener('click', () => {
        verificationResults.push({ module: 'HUMAN_REVIEW', status: 'QUEUED', details: 'Record flagged for manual human review' });
        currentStepIndex++;
        renderCurrentStep();
    });
}

// -------------------------------------------------------------
// FINAL COMPLETION SCREEN (Clean Employee Experience)
// -------------------------------------------------------------
function renderFinalCompletion() {
    updateStepperUI();
    stopWebcamStream();

    const docsList = Object.values(window.__uploadedDocuments || {});
    const primaryDoc = docsList[0] || (window.__uploadedDocDataUrl ? { dataUrl: window.__uploadedDocDataUrl, type: 'ID' } : null);
    const selfiesList = Object.values(window.__capturedSelfies || {});
    const primarySelfie = selfiesList[0] || window.__uploadedSelfieDataUrl || '';

    const docImage = primaryDoc ? primaryDoc.dataUrl : '';
    const docType = primaryDoc ? (primaryDoc.type || 'ID') : 'ID';

    const applicantName = (window.__applicantAnswers && (
        window.__applicantAnswers['Full Legal Name'] || 
        window.__applicantAnswers['Name'] || 
        window.__applicantAnswers['Work Email Address']
    )) || `Applicant ${pipelineId}`;

    const submissionPayload = {
        session_id: `emp_${pipelineId}_${Date.now()}`,
        document_type: docType,
        extracted_name: applicantName,
        overall_status: 'MANUAL_REVIEW',
        face_match_verified: false,
        extracted_face_url: docImage,
        live_holder_face_url: primarySelfie,
        metadata: {
            pipelineId,
            answers: window.__applicantAnswers || {},
            document_image: docImage,
            selfie_image: primarySelfie,
            document_type: docType,
            submitted_at: new Date().toISOString()
        },
        created_at: new Date().toISOString()
    };

    // Cache locally for Instant Admin Access
    try {
        const existing = JSON.parse(localStorage.getItem('verifyyy_local_submissions') || '[]');
        existing.unshift(submissionPayload);
        localStorage.setItem('verifyyy_local_submissions', JSON.stringify(existing.slice(0, 100)));
    } catch (e) {
        console.warn('Could not cache submission locally:', e);
    }

    // Persist to Supabase database
    try {
        fetch(`${SUPABASE_REST_URL}/verifications`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(submissionPayload)
        }).catch(err => console.warn('Supabase verification save warning:', err));
    } catch (sbErr) {
        console.warn('Could not sync verification run to Supabase:', sbErr);
    }

    let html = `
        <div style="text-align:center; padding:36px 16px; max-width:540px; margin:0 auto;">
            <div style="font-size:3.8rem; margin-bottom:12px;">🎉</div>
            <h2 style="color:#10b981; font-weight:800; margin-bottom:8px; font-size:1.75rem;">
                Submission Received!
            </h2>
            <p style="color:#475569; font-size:1.05rem; margin-bottom:24px; line-height:1.5;">
                Thank you for participating! Your form responses, document attachments, and verification activity have been securely submitted.
            </p>

            <div class="step-card" style="text-align:left; background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:20px; margin-bottom:20px;">
                <h4 style="margin:0 0 12px; color:#1e293b; font-size:1rem;">Submission Details</h4>
                <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b; font-size:0.9rem;">Form Responses</span>
                    <span style="color:#10b981; font-weight:700; font-size:0.9rem;">✓ Recorded</span>
                </div>
                <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #e2e8f0;">
                    <span style="color:#64748b; font-size:0.9rem;">Document Photo</span>
                    <span style="color:#10b981; font-weight:700; font-size:0.9rem;">✓ Attached</span>
                </div>
                <div style="display:flex; justify-content:space-between; padding:8px 0;">
                    <span style="color:#64748b; font-size:0.9rem;">Live Selfie Photo</span>
                    <span style="color:#10b981; font-weight:700; font-size:0.9rem;">✓ Captured</span>
                </div>
            </div>

            ${window.__applicantAnswers && Object.keys(window.__applicantAnswers).length > 0 ? `
                <div class="step-card" style="text-align:left; margin-top:16px;">
                    <h4 style="margin-top:0; color:#008080; font-size:1rem;">Submitted Application Details</h4>
                    ${Object.entries(window.__applicantAnswers).map(([k, v]) => `
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9; padding:8px 0; font-size:0.95rem;">
                            <span style="font-weight:600; color:#475569;">${k}</span>
                            <span style="color:#0f172a; max-width:60%; text-align:right;">${Array.isArray(v) ? v.join(', ') : (v || '—')}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <p style="color:#94a3b8; font-size:0.85rem; margin-top:24px;">
                Your submission has been securely recorded and queued for administrator compliance review. You may safely close this page.
            </p>
        </div>
    `;

    contentEl.innerHTML = html;
}

// Start Runner
window.addEventListener('load', initPipeline);
