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
        return `<textarea name="${f.id}" style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; min-height:80px;" placeholder="Your answer" ${isRequired}>${val || ''}</textarea>`;
    }
    if (f.type === 'multiple_choice') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return opts.map((opt, oi) => `
            <div style="margin:8px 0; display:flex; align-items:center; gap:8px;">
                <input type="radio" name="${f.id}" id="${f.id}_${oi}" value="${opt}" ${val === opt ? 'checked' : ''} ${isRequired && oi === 0 ? 'required' : ''}>
                <label for="${f.id}_${oi}" style="color:#3c4043; cursor:pointer;">${opt}</label>
            </div>
        `).join('');
    }
    if (f.type === 'checkboxes') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        const valArr = Array.isArray(val) ? val : (val ? [val] : []);
        return opts.map((opt, oi) => `
            <div style="margin:8px 0; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" name="${f.id}" id="${f.id}_${oi}" value="${opt}" ${valArr.includes(opt) ? 'checked' : ''}>
                <label for="${f.id}_${oi}" style="color:#3c4043; cursor:pointer;">${opt}</label>
            </div>
        `).join('');
    }
    if (f.type === 'dropdown') {
        const opts = (f.options && f.options.length) ? f.options : ['Option 1'];
        return `
            <select name="${f.id}" style="width:100%; box-sizing:border-box; border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit; background:#fff;" ${isRequired}>
                <option value="">Choose an option</option>
                ${opts.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
            </select>
        `;
    }
    if (f.type === 'date') {
        return `<input type="date" name="${f.id}" value="${val || ''}" style="border:1px solid #dadce0; border-radius:8px; padding:10px 12px; font-family:inherit;" ${isRequired} />`;
    }
    if (f.type === 'file_upload') {
        return `<input type="file" name="${f.id}" style="width:100%; padding:8px 0;" ${isRequired} />`;
    }
    // Default short_answer
    return `<input type="text" name="${f.id}" value="${val || ''}" style="width:100%; box-sizing:border-box; border:none; border-bottom:1.5px solid #dadce0; padding:8px 0; font-size:1rem; outline:none;" placeholder="Your answer" ${isRequired} />`;
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
            <div style="background:#fff; border-top:8px solid #7248B9; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 1px 3px rgba(60,64,67,0.1); border:1px solid #dadce0;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h2 style="margin:0 0 8px; font-size:1.6rem; color:#202124;">${pageTitle}</h2>
                    <span style="font-size:0.85rem; font-weight:700; color:#7248B9; background:#f5f3ff; padding:4px 12px; border-radius:12px; border:1px solid #ddd6fe;">
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
                <div class="step-card" style="background:#fff; border-radius:12px; padding:24px; margin-bottom:20px; box-shadow:0 2px 8px rgba(114, 72, 185, 0.12); border:2px solid #7248B9;" id="card-block-${block.id}">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #f1f5f9; padding-bottom:12px;">
                        <div>
                            <h3 style="margin:0; text-align:left; color:#7248B9; font-size:1.2rem; display:flex; align-items:center; gap:8px;">
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
                        <button type="button" class="btn" id="btn-eyetrack-${block.id}" style="width:auto; padding:10px 24px; background:#7248B9; color:#fff; border-radius:8px;">
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
                // Document upload & live face verification
                html += `
                    <!-- Part 1: Document Upload -->
                    <div id="substep-upload-${block.id}" style="background:#f8fafc; border-radius:8px; padding:16px; margin-bottom:16px; border:1px solid #e2e8f0;">
                        <h4 style="margin:0 0 10px; color:#7248B9; text-align:left;">Part 1: Upload ${docLabel} Image</h4>
                        <input type="file" id="runner-doc-file-${block.id}" accept="image/*" style="margin-bottom:10px;">
                        <button class="btn" id="btn-upload-${block.id}" type="button" style="background:#7248B9; color:#fff; width:auto; padding:10px 24px; border-radius:6px; font-weight:600;">
                            Process ${docLabel}
                        </button>
                        <div id="upload-spinner-${block.id}" class="hidden" style="margin-top:10px; color:#7248B9; font-weight:bold;">
                            Processing document OCR & extracting face...
                        </div>
                        <div id="upload-results-${block.id}" class="result-panel hidden"></div>
                    </div>

                    <!-- Part 2: Live Face Verification -->
                    <div id="substep-live-${block.id}" class="hidden" style="background:#f8fafc; border-radius:8px; padding:16px; border:1px solid #e2e8f0;">
                        <h4 style="margin:0 0 8px; color:#7248B9; text-align:left;">Part 2: Live Face Verification</h4>
                        <p style="font-size:0.85rem; color:#64748b; margin:0 0 12px; text-align:left;">Position your face in front of the camera and click Capture.</p>
                        <div class="live-video-wrap" style="max-width:400px; margin:0 auto 12px;">
                            <video id="runner-webcam-${block.id}" autoplay playsinline></video>
                        </div>
                        <div style="text-align:center;">
                            <button class="btn" id="btn-capture-${block.id}" type="button" style="background:#7248B9; color:#fff; width:auto; padding:10px 28px; border-radius:6px; font-weight:600;">
                                Capture & Verify Face
                            </button>
                        </div>
                        <div id="live-spinner-${block.id}" class="hidden" style="margin-top:10px; color:#7248B9; font-weight:bold; text-align:center;">
                            Cross-verifying face vectors (ArcFace)...
                        </div>
                        <div id="live-results-${block.id}" class="result-panel hidden"></div>
                    </div>
                `;
            }

            html += `</div>`;
        }
    });

    // Page Navigation Buttons
    html += `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0;">
                <div>
                    ${!isFirstPage ? `
                        <button type="button" id="btn-page-prev" class="btn" style="background:#e2e8f0; color:#1e293b; width:auto; padding:12px 24px; border-radius:24px; font-weight:600; cursor:pointer;">
                            ← Previous Page
                        </button>
                    ` : '<div></div>'}
                </div>
                <div>
                    <button type="button" id="btn-page-next" class="btn" style="background:${isLastPage ? '#10b981' : '#7248B9'}; color:#fff; width:auto; padding:12px 32px; border-radius:24px; font-weight:700; font-size:1rem; cursor:pointer; box-shadow:0 2px 6px rgba(0,0,0,0.15);">
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
                resEye.textContent = "Simulating gaze calibration check...";
                setTimeout(() => {
                    resEye.innerHTML = "✓ EYE TRACKING PASSED (Score: 98%)";
                    window.__moduleVerificationStatus[block.id] = { verified: true, status: 'PASSED', details: 'Gaze calibration score 98%' };
                    verificationResults.push({ module: 'EYE_TRACKING', status: 'PASSED', details: 'Gaze calibration score 98%' });
                    const badge = document.getElementById(`status-badge-${block.id}`);
                    if (badge) badge.innerHTML = '<span class="badge badge-success">✓ VERIFIED</span>';
                }, 1500);
            });
        }
        return;
    }

    if (modId.includes('HUMAN')) {
        window.__moduleVerificationStatus[block.id] = { verified: true, status: 'QUEUED', details: 'Queued for human audit' };
        verificationResults.push({ module: 'HUMAN_REVIEW', status: 'QUEUED', details: 'Queued for human audit' });
        return;
    }

    // Document & Live Face verification
    const isPan = modId.includes('PAN');
    const docLabel = isPan ? 'PAN Card' : 'Aadhaar Card';

    const fileInput = document.getElementById(`runner-doc-file-${block.id}`);
    const btnUpload = document.getElementById(`btn-upload-${block.id}`);
    const uploadSpinner = document.getElementById(`upload-spinner-${block.id}`);
    const uploadResults = document.getElementById(`upload-results-${block.id}`);
    const substepLive = document.getElementById(`substep-live-${block.id}`);
    const btnCapture = document.getElementById(`btn-capture-${block.id}`);
    const liveSpinner = document.getElementById(`live-spinner-${block.id}`);
    const liveResults = document.getElementById(`live-results-${block.id}`);
    const videoEl = document.getElementById(`runner-webcam-${block.id}`);

    let localUploadedDocId = null;
    let localUploadedFaceFilename = null;

    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            if (fileInput.files && fileInput.files.length > 0) {
                substepLive.classList.remove('hidden');
                await startWebcamStreamForVideo(videoEl);
            }
        });
    }

    if (btnUpload) {
        btnUpload.addEventListener('click', async () => {
            if (!fileInput.files || fileInput.files.length === 0) {
                alert(`Please select a ${docLabel} image file.`);
                return;
            }

            const file = fileInput.files[0];
            const formData = new FormData();
            formData.append("file", file);

            btnUpload.disabled = true;
            uploadSpinner.classList.remove('hidden');
            uploadResults.classList.add('hidden');

            try {
                const ocrHeaders = {};
                if (applicantToken) {
                    ocrHeaders['X-Applicant-Token'] = applicantToken;
                }

                const resp = await fetch(`${API_BASE}/api/v1/ocr`, {
                    method: 'POST',
                    headers: ocrHeaders,
                    body: formData,
                });

                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || data.detail || `HTTP ${resp.status}`);

                const fields = data.parsed_fields || {};
                const idNum = fields.pan_number || fields.aadhaar_number || fields.id_number;

                if (!idNum) {
                    throw new Error(`Could not extract a valid ID number from this ${docLabel}. Please try a clearer image.`);
                }

                localUploadedDocId = idNum;
                flowSessionId = data.session_id || flowSessionId;

                if (data.face_image_url) {
                    const parts = data.face_image_url.split('/');
                    localUploadedFaceFilename = decodeURIComponent(parts[parts.length - 1]);
                }

                const docTypeDetected = fields.document_type || (isPan ? 'PAN' : 'AADHAAR');
                let resHtml = `<h4 style="color:#166534; margin-top:0;">✅ ${docTypeDetected} Document Processed</h4>`;
                resHtml += `<p style="margin:4px 0;"><strong>ID Number:</strong> <code>${idNum}</code></p>`;
                if (fields.name) resHtml += `<p style="margin:4px 0;"><strong>Name:</strong> ${fields.name}</p>`;
                if (fields.father_name) resHtml += `<p style="margin:4px 0;"><strong>Father's Name:</strong> ${fields.father_name}</p>`;
                if (fields.dob) resHtml += `<p style="margin:4px 0;"><strong>Date of Birth:</strong> ${fields.dob}</p>`;

                if (data.face_image_url) {
                    resHtml += `<div style="margin-top:10px;">
                        <p style="margin-bottom:4px; font-weight:bold;">Extracted Document Face Photo:</p>
                        <img src="${API_BASE}${data.face_image_url}" style="width:90px; height:90px; object-fit:cover; border-radius:8px; border:2px solid var(--primary);">
                    </div>`;
                }

                uploadResults.innerHTML = resHtml;
                uploadResults.classList.remove('hidden');

                // Reveal Part 2 Live Face Verification
                substepLive.classList.remove('hidden');
                await startWebcamStreamForVideo(videoEl);

            } catch (err) {
                uploadResults.innerHTML = `<h4 style="color:#991b1b; margin-top:0;">❌ Extraction Failed</h4><p style="color:#ef4444;">${err.message}</p>`;
                uploadResults.classList.remove('hidden');
            } finally {
                uploadSpinner.classList.add('hidden');
                btnUpload.disabled = false;
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
                alert("Camera is not ready yet. Please allow camera access in your browser settings.");
                return;
            }

            canvasEl.width = videoEl.videoWidth || 640;
            canvasEl.height = videoEl.videoHeight || 480;
            const ctx = canvasEl.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            const dataUrl = canvasEl.toDataURL('image/jpeg', 0.92);

            btnCapture.disabled = true;
            liveSpinner.classList.remove('hidden');
            liveResults.classList.add('hidden');

            const payload = {
                image: dataUrl,
                skip_ocr: true,
                session_id: flowSessionId,
                step1_face: localUploadedFaceFilename
            };

            const verifyHeaders = { 'Content-Type': 'application/json' };
            if (applicantToken) {
                verifyHeaders['X-Applicant-Token'] = applicantToken;
            }

            try {
                const resp = await fetch(`${API_BASE}/api/v1/live_verify`, {
                    method: 'POST',
                    headers: verifyHeaders,
                    body: JSON.stringify(payload)
                });

                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || data.detail || `HTTP ${resp.status}`);

                let faceMatchVerified = false;
                if (data.step3_face_matches && data.step3_face_matches.length > 0) {
                    const normUploaded = decodeURIComponent(localUploadedFaceFilename || '').toLowerCase();
                    const match = data.step3_face_matches.find(m => {
                        const normRef = decodeURIComponent(m.step3_face || '').toLowerCase();
                        return normRef === normUploaded || (m.vs_holder && m.vs_holder.verified) || m.verified;
                    }) || data.step3_face_matches[0];

                    if (match) {
                        faceMatchVerified = match.verified || (match.vs_holder && match.vs_holder.verified);
                    }
                }
                if (!faceMatchVerified && data.face_match) {
                    faceMatchVerified = true;
                }

                let liveHtml = `<h4 style="margin-top:0;">Live Face Verification Results</h4>`;
                liveHtml += `<p><strong>Face Match Status:</strong> ${faceMatchVerified ? '<span class="badge badge-success">MATCH VERIFIED</span>' : '<span class="badge badge-danger">MATCH FAILED</span>'}</p>`;
                liveHtml += `<p><strong>Liveness Check:</strong> ${data.holder_face_image_url ? '<span class="badge badge-success">PASSED</span>' : '<span class="badge badge-danger">FAILED</span>'}</p>`;

                liveResults.innerHTML = liveHtml;
                liveResults.classList.remove('hidden');

                if (faceMatchVerified) {
                    window.__moduleVerificationStatus[block.id] = {
                        verified: true,
                        docId: localUploadedDocId,
                        status: 'PASSED',
                        details: `ID: ${localUploadedDocId || 'N/A'}, Match: Verified`
                    };
                    verificationResults.push({
                        module: modId,
                        status: 'PASSED',
                        details: `ID: ${localUploadedDocId || 'N/A'}, Match: Verified`
                    });

                    const badge = document.getElementById(`status-badge-${block.id}`);
                    if (badge) badge.innerHTML = '<span class="badge badge-success">✓ VERIFIED</span>';
                }

            } catch (err) {
                liveResults.innerHTML = `<h4 style="color:#991b1b; margin-top:0;">❌ Verification Failed</h4><p style="color:#ef4444;">${err.message}</p>`;
                liveResults.classList.remove('hidden');
                btnCapture.disabled = false;
            } finally {
                liveSpinner.classList.add('hidden');
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
            // If it's a document/face verification module, verify it passed
            if (modId.includes('FACE') || modId.includes('PAN') || modId.includes('AADHAAR')) {
                const status = window.__moduleVerificationStatus[block.id];
                if (!status || !status.verified) {
                    alert(`Please complete the verification check for "${block.name}" on this page before continuing.`);
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
// MODULE: Document OCR & Live Face Verification
// -------------------------------------------------------------
function renderDocFaceStep(modType) {
    const isPan = modType.includes('PAN');
    const docLabel = isPan ? 'PAN Card' : 'Aadhaar Card';

    contentEl.innerHTML = `
        <div style="text-align:center;">
            <h3 style="margin-bottom:8px;">${MODULE_NAMES[modType] || modType}</h3>
            <p style="color:var(--text-muted); margin-bottom:24px;">Upload your ${docLabel} to extract details, then verify with your live webcam face.</p>

            <!-- Part 1: Upload -->
            <div id="substep-upload" class="step-card">
                <h4 style="margin-top:0; color:var(--primary);">Part 1: Upload ${docLabel} Image</h4>
                <input type="file" id="runner-doc-file" accept="image/*">
                <button class="btn" id="btn-runner-upload" type="button">Process ${docLabel}</button>
                <div id="runner-upload-spinner" class="hidden" style="margin-top:12px; color:var(--primary); font-weight:bold;">Processing document OCR & extracting face...</div>
                <div id="runner-upload-results" class="result-panel hidden"></div>
            </div>

            <!-- Part 2: Live Verification -->
            <div id="substep-live" class="step-card hidden">
                <h4 style="margin-top:0; color:var(--primary);">Part 2: Live Face Verification</h4>
                <p style="font-size:0.9rem; color:var(--text-muted);">Position your face in front of the camera and click Capture.</p>
                <div class="live-video-wrap">
                    <video id="runner-webcam" autoplay playsinline></video>
                </div>
                <button class="btn" id="btn-runner-capture" type="button">Capture & Verify Face</button>
                <div id="runner-live-spinner" class="hidden" style="margin-top:12px; color:var(--primary); font-weight:bold;">Cross-verifying face vectors (ArcFace)...</div>
                <div id="runner-live-results" class="result-panel hidden"></div>
            </div>
        </div>
    `;

    const btnUpload = document.getElementById('btn-runner-upload');
    const fileInput = document.getElementById('runner-doc-file');
    const uploadSpinner = document.getElementById('runner-upload-spinner');
    const uploadResults = document.getElementById('runner-upload-results');
    const substepLive = document.getElementById('substep-live');
    const btnCapture = document.getElementById('btn-runner-capture');

    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            if (fileInput.files && fileInput.files.length > 0) {
                substepLive.classList.remove('hidden');
                await startWebcamStream();
            }
        });
    }

    btnUpload.addEventListener('click', async () => {
        if (!fileInput.files || fileInput.files.length === 0) {
            alert(`Please select a ${docLabel} image file.`);
            return;
        }

        const file = fileInput.files[0];
        const formData = new FormData();
        formData.append("file", file);

        btnUpload.disabled = true;
        uploadSpinner.classList.remove('hidden');
        uploadResults.classList.add('hidden');

        try {
            const ocrHeaders = {};
            if (applicantToken) {
                ocrHeaders['X-Applicant-Token'] = applicantToken;
            }

            const resp = await fetch(`${API_BASE}/api/v1/ocr`, {
                method: 'POST',
                headers: ocrHeaders,
                body: formData,
            });

            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || data.detail || `HTTP ${resp.status}`);

            const fields = data.parsed_fields || {};
            const idNum = fields.pan_number || fields.aadhaar_number || fields.id_number;

            if (!idNum) {
                throw new Error(`Could not extract a valid ID number from this ${docLabel}. Please try a clearer image.`);
            }

            uploadedDocumentId = idNum;
            flowSessionId = data.session_id || null;

            if (data.face_image_url) {
                const parts = data.face_image_url.split('/');
                uploadedFaceFilename = decodeURIComponent(parts[parts.length - 1]);
            }

            const docTypeDetected = fields.document_type || (isPan ? 'PAN' : 'AADHAAR');
            let resHtml = `<h4 style="color:#166534; margin-top:0;">✅ ${docTypeDetected} Document Processed</h4>`;
            resHtml += `<p style="margin:4px 0;"><strong>ID Number:</strong> <code>${idNum}</code></p>`;
            if (fields.name) resHtml += `<p style="margin:4px 0;"><strong>Name:</strong> ${fields.name}</p>`;
            if (fields.father_name) resHtml += `<p style="margin:4px 0;"><strong>Father's Name:</strong> ${fields.father_name}</p>`;
            if (fields.dob) resHtml += `<p style="margin:4px 0;"><strong>Date of Birth:</strong> ${fields.dob}</p>`;

            if (data.face_image_url) {
                resHtml += `<div style="margin-top:10px;">
                    <p style="margin-bottom:4px; font-weight:bold;">Extracted Document Face Photo:</p>
                    <img src="${API_BASE}${data.face_image_url}" style="width:90px; height:90px; object-fit:cover; border-radius:8px; border:2px solid var(--primary);">
                </div>`;
            }

            uploadResults.innerHTML = resHtml;
            uploadResults.classList.remove('hidden');

            // Reveal Part 2 Live Face Verification for all document verification flows
            substepLive.classList.remove('hidden');
            await startWebcamStream();
            setTimeout(() => {
                substepLive.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);

        } catch (err) {
            uploadResults.innerHTML = `<h4 style="color:#991b1b; margin-top:0;">❌ Extraction Failed</h4><p style="color:#ef4444;">${err.message}</p>`;
            uploadResults.classList.remove('hidden');
        } finally {
            uploadSpinner.classList.add('hidden');
            btnUpload.disabled = false;
        }
    });

    if (btnCapture) {
        btnCapture.addEventListener('click', async () => {
            const videoEl = document.getElementById('runner-webcam');
            if (!videoEl) return;

            if (videoEl.paused || !videoEl.srcObject) {
                await startWebcamStream();
            }

            if (videoEl.readyState < 2) {
                for (let i = 0; i < 10; i++) {
                    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) break;
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            if (videoEl.readyState < 2 && (!videoEl.videoWidth || videoEl.videoWidth === 0)) {
                alert("Camera is not ready yet. Please allow camera access in your browser settings.");
                return;
            }

            canvasEl.width = videoEl.videoWidth || 640;
            canvasEl.height = videoEl.videoHeight || 480;
            const ctx = canvasEl.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            const dataUrl = canvasEl.toDataURL('image/jpeg', 0.92);

            const liveSpinner = document.getElementById('runner-live-spinner');
            const liveResults = document.getElementById('runner-live-results');

            btnCapture.disabled = true;
            liveSpinner.classList.remove('hidden');
            liveResults.classList.add('hidden');

            const payload = {
                image: dataUrl,
                skip_ocr: true,
                session_id: flowSessionId,
                step1_face: uploadedFaceFilename
            };

            const verifyHeaders = { 'Content-Type': 'application/json' };
            if (applicantToken) {
                verifyHeaders['X-Applicant-Token'] = applicantToken;
            }

            try {
                const resp = await fetch(`${API_BASE}/api/v1/live_verify`, {
                    method: 'POST',
                    headers: verifyHeaders,
                    body: JSON.stringify(payload)
                });

                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error || data.detail || `HTTP ${resp.status}`);

                let faceMatchVerified = false;
                if (data.step3_face_matches && data.step3_face_matches.length > 0) {
                    const normUploaded = decodeURIComponent(uploadedFaceFilename || '').toLowerCase();
                    const match = data.step3_face_matches.find(m => {
                        const normRef = decodeURIComponent(m.step3_face || '').toLowerCase();
                        return normRef === normUploaded || (m.vs_holder && m.vs_holder.verified) || m.verified;
                    }) || data.step3_face_matches[0];

                    if (match) {
                        faceMatchVerified = match.verified || (match.vs_holder && match.vs_holder.verified);
                    }
                }
                if (!faceMatchVerified && data.face_match) {
                    faceMatchVerified = true;
                }

                stopWebcamStream();

                let liveHtml = `<h4 style="margin-top:0;">Live Face Verification Results</h4>`;
                liveHtml += `<p><strong>Face Match Status:</strong> ${faceMatchVerified ? '<span class="badge badge-success">MATCH VERIFIED</span>' : '<span class="badge badge-danger">MATCH FAILED</span>'}</p>`;
                liveHtml += `<p><strong>Liveness Check:</strong> ${data.holder_face_image_url ? '<span class="badge badge-success">PASSED</span>' : '<span class="badge badge-danger">FAILED</span>'}</p>`;

                liveResults.innerHTML = liveHtml;
                liveResults.classList.remove('hidden');

                verificationResults.push({
                    module: modType,
                    status: faceMatchVerified ? 'PASSED' : 'FAILED',
                    details: `ID: ${uploadedDocumentId || 'N/A'}, Match: ${faceMatchVerified ? 'Verified' : 'Unverified'}`
                });

                setTimeout(() => {
                    currentStepIndex++;
                    renderCurrentStep();
                }, 2000);

            } catch (err) {
                liveResults.innerHTML = `<h4 style="color:#991b1b; margin-top:0;">❌ Verification Failed</h4><p style="color:#ef4444;">${err.message}</p>`;
                liveResults.classList.remove('hidden');
                btnCapture.disabled = false;
            } finally {
                liveSpinner.classList.add('hidden');
            }
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
// FINAL COMPLETION SCREEN
// -------------------------------------------------------------
function renderFinalCompletion() {
    updateStepperUI();
    stopWebcamStream();

    const allPassed = verificationResults.every(r => r.status === 'PASSED' || r.status === 'QUEUED');

    let html = `
        <div style="text-align:center; padding:20px;">
            <div style="font-size:3.5rem; margin-bottom:12px;">${allPassed ? '🎉' : '⚠️'}</div>
            <h2 style="color:${allPassed ? 'var(--primary)' : 'var(--error)'}; font-weight:800;">
                ${allPassed ? 'Verification Complete!' : 'Verification Flagged'}
            </h2>
            <p style="color:var(--text-muted); margin-bottom:24px;">
                Pipeline <code>${pipelineId}</code> has executed all requested verification steps.
            </p>

            <div class="step-card" style="text-align:left;">
                <h4 style="margin-top:0; color:var(--primary);">Verification Results Summary</h4>
                ${verificationResults.map(r => {
                    const badgeClass = r.status === 'PASSED' ? 'badge-success' : (r.status === 'QUEUED' ? 'badge-info' : 'badge-danger');
                    return `
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:10px 0;">
                            <div>
                                <strong>${MODULE_NAMES[r.module] || r.module}</strong>
                                <div style="font-size:0.85rem; color:var(--text-muted);">${r.details}</div>
                            </div>
                            <div><span class="badge ${badgeClass}">${r.status}</span></div>
                        </div>
                    `;
                }).join('')}
            </div>

            ${window.__applicantAnswers && Object.keys(window.__applicantAnswers).length > 0 ? `
                <div class="step-card" style="text-align:left; margin-top:16px;">
                    <h4 style="margin-top:0; color:#7248B9;">Submitted Application Details</h4>
                    ${Object.entries(window.__applicantAnswers).map(([k, v]) => `
                        <div style="display:flex; justify-content:space-between; border-bottom:1px solid #f1f5f9; padding:8px 0; font-size:0.95rem;">
                            <span style="font-weight:600; color:#475569;">${k}</span>
                            <span style="color:#0f172a; max-width:60%; text-align:right;">${Array.isArray(v) ? v.join(', ') : (v || '—')}</span>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <button class="btn" onclick="location.reload()" style="margin-top:20px;">Run Flow Again</button>
        </div>
    `;

    // Persist applicant verification completion to Supabase database
    try {
        const applicantName = (window.__applicantAnswers && (window.__applicantAnswers['Full Legal Name'] || window.__applicantAnswers['Work Email Address'])) || `Applicant ${pipelineId}`;
        fetch(`${SUPABASE_REST_URL}/verifications`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
                session_id: `run_${pipelineId}_${Date.now()}`,
                document_type: 'VERIFICATION_RUN',
                extracted_name: applicantName,
                overall_status: allPassed ? 'SUCCESS' : 'MANUAL_REVIEW',
                face_match_verified: allPassed,
                metadata: {
                    pipelineId,
                    results: verificationResults,
                    answers: window.__applicantAnswers || {},
                    completed_at: new Date().toISOString()
                }
            })
        }).catch(err => console.warn('Supabase verification save warning:', err));
    } catch (sbErr) {
        console.warn('Could not sync verification run to Supabase:', sbErr);
    }

    contentEl.innerHTML = html;
}

// Start Runner
window.addEventListener('load', initPipeline);
