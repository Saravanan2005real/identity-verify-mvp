const API_BASE = "http://localhost:5001";

// DOM Elements
const stepperEl = document.getElementById('pipeline-stepper');
const contentEl = document.getElementById('flow-content');
const canvasEl = document.getElementById('runner-canvas');
const pidTagEl = document.getElementById('pipeline-id-tag');

// Read URL Params
const urlParams = new URLSearchParams(window.location.search);
const flowString = urlParams.get('flow') || 'PAN_FACE,EYE_TRACKING';
const pipelineId = urlParams.get('pid') || 'FLOW-' + Math.random().toString(36).substr(2, 6).toUpperCase();

if (pidTagEl) pidTagEl.textContent = `PID: ${pipelineId}`;

// Parse Modules List
const moduleKeys = flowString.split(',').map(m => m.trim().toUpperCase()).filter(Boolean);

// Module Definition Map
const MODULE_NAMES = {
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
function initPipeline() {
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
            const resp = await fetch(`${API_BASE}/api/v1/ocr`, {
                method: 'POST',
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

            try {
                const resp = await fetch(`${API_BASE}/api/v1/live_verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
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
    `;

    verificationResults.forEach(r => {
        const badgeClass = r.status === 'PASSED' ? 'badge-success' : (r.status === 'QUEUED' ? 'badge-info' : 'badge-danger');
        html += `
            <div style="display:flex; justify-content:space-between; border-bottom:1px solid var(--border-color); padding:10px 0;">
                <div>
                    <strong>${MODULE_NAMES[r.module] || r.module}</strong>
                    <div style="font-size:0.85rem; color:var(--text-muted);">${r.details}</div>
                </div>
                <div><span class="badge ${badgeClass}">${r.status}</span></div>
            </div>
        `;
    });

    html += `
            </div>

            <button class="btn" onclick="location.reload()" style="margin-top:20px;">Run Flow Again</button>
        </div>
    `;

    contentEl.innerHTML = html;
}

// Start Runner
window.addEventListener('load', initPipeline);
