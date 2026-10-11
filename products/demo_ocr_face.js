const API_BASE = "http://localhost:5001";
const videoEl = document.getElementById('live-id-webcam');
const canvasEl = document.getElementById('live-id-canvas');
const btnCapture = document.getElementById('btn-capture-live-id');
const btnRetry = document.getElementById('btn-retry');
const tickEl = document.getElementById('live-id-tick');
const resultPanel = document.getElementById('result-panel');
const spinner = document.getElementById('loading-spinner');

// Step 1 Elements
const btnProcessUpload = document.getElementById('btn-process-upload');
const docUpload = document.getElementById('doc-upload');
const uploadSpinner = document.getElementById('upload-spinner');
const uploadResults = document.getElementById('upload-results');
const step2Section = document.getElementById('step2-live-section');

// Global State
let uploadedDocumentId = null;
let uploadedFaceFilename = null;
let currentSessionId = null;

// Start Camera — request HD resolution for better OCR accuracy
async function startCamera() {
    try {
        if (videoEl.srcObject && videoEl.srcObject.active) {
            await videoEl.play().catch(err => console.warn('Camera play deferred:', err));
            return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
            audio: false,
        });
        videoEl.srcObject = stream;
        await videoEl.play().catch(err => console.warn('Camera play deferred:', err));
    } catch (err) {
        console.error('Camera access denied:', err);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            videoEl.srcObject = stream;
            await videoEl.play().catch(err => console.warn('Fallback camera play deferred:', err));
        } catch(err2) {
            console.error('Fallback camera access failed:', err2);
        }
    }
}

// Grab Frame — use high quality JPEG for OCR
function grabFrameDataUrl() {
    canvasEl.width = videoEl.videoWidth || 640;
    canvasEl.height = videoEl.videoHeight || 480;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    return canvasEl.toDataURL('image/jpeg', 0.95);
}

// -------------------------------------------------------------
// STEP 1: Process Uploaded Document
// -------------------------------------------------------------
async function processUploadedDocument() {
    if (!docUpload.files || docUpload.files.length === 0) {
        alert("Please select a document image first.");
        return;
    }

    const file = docUpload.files[0];
    const formData = new FormData();
    formData.append("file", file);

    btnProcessUpload.disabled = true;
    uploadSpinner.classList.remove('hidden');
    uploadResults.classList.add('hidden');
    
    // Reset state
    uploadedDocumentId = null;
    uploadedFaceFilename = null;
    currentSessionId = null;
    step2Section.style.opacity = '0.4';
    step2Section.style.pointerEvents = 'none';

    try {
        const resp = await fetch(`${API_BASE}/api/v1/ocr`, {
            method: 'POST',
            body: formData,
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
        }

        const fields = data.parsed_fields || {};
        const idNum = fields.aadhaar_number || fields.pan_number || fields.id_number || fields.dl_number;
        
        if (!idNum) {
            throw new Error("Could not extract a valid ID number from this document. Please try a clearer image.");
        }

        // Store state for step 2 cross-verification
        uploadedDocumentId = idNum;
        currentSessionId = data.session_id || null;
        if (data.face_image_url) {
            const parts = data.face_image_url.split('/');
            uploadedFaceFilename = decodeURIComponent(parts[parts.length - 1]);
        }

        // Render Step 1 Results
        const docType = fields.document_type || (fields.pan_number ? "PAN" : (fields.aadhaar_number ? "AADHAAR" : "ID Document"));
        let html = `<h4>✅ ${docType} Processed Successfully</h4>`;
        html += `<p><strong>Document Type:</strong> <span class="badge badge-success">${docType}</span></p>`;
        html += `<p><strong>Extracted ID Number:</strong> <code>${idNum}</code></p>`;
        if (fields.name) html += `<p><strong>Name:</strong> ${fields.name}</p>`;
        if (fields.father_name) html += `<p><strong>Father's Name:</strong> ${fields.father_name}</p>`;
        if (fields.dob) html += `<p><strong>Date of Birth:</strong> ${fields.dob}</p>`;
        
        if (data.supabase_sync) {
            const sb = data.supabase_sync;
            const sbBadge = sb.synced 
                ? '<span class="badge badge-success">SYNCED TO SUPABASE</span>' 
                : `<span class="badge badge-danger">LOCAL VERIFICATION ONLY</span> (${sb.message || 'Credentials not set'})`;
            html += `<p style="margin-top: 8px;"><strong>Supabase Sync:</strong> ${sbBadge}</p>`;
        }

        if (data.face_image_url) {
            html += `<div style="margin-top: 12px;">
                <p style="margin-bottom: 4px;"><strong>Extracted Face (${docType} Photo):</strong></p>
                <img src="${API_BASE}${data.face_image_url}" alt="Extracted ID Face" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; border: 2px solid var(--border-color);">
            </div>`;
        } else {
            html += `<p style="color:#ef4444; margin-top: 12px;"><strong>Warning:</strong> No face photo was extracted from this ${docType} card. Face match in Step 2 will not be possible.</p>`;
        }

        uploadResults.innerHTML = html;
        uploadResults.classList.remove('hidden');

        // Enable Step 2 & Auto-start camera & Smooth scroll
        step2Section.style.opacity = '1';
        step2Section.style.pointerEvents = 'auto';
        await startCamera();
        setTimeout(() => {
            step2Section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);

    } catch (error) {
        uploadResults.innerHTML = `
            <h4>❌ Upload Processing Failed</h4>
            <p style="color: #ef4444;">${error.message}</p>
        `;
        uploadResults.classList.remove('hidden');
    } finally {
        uploadSpinner.classList.add('hidden');
        btnProcessUpload.disabled = false;
    }
}

// -------------------------------------------------------------
// STEP 2: Capture and Cross Verify Live ID
// -------------------------------------------------------------
async function captureAndVerifyLiveId() {
    if (!videoEl) {
        alert('Camera element not found.');
        return;
    }

    if (videoEl.paused || !videoEl.srcObject) {
        await startCamera();
    }

    if (videoEl.readyState < 2) {
        for (let i = 0; i < 10; i++) {
            if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) break;
            await new Promise(r => setTimeout(r, 100));
        }
    }

    if (videoEl.readyState < 2 && (!videoEl.videoWidth || videoEl.videoWidth === 0)) {
        alert('Camera is not ready yet. Allow camera access and try again.');
        return;
    }

    btnCapture.disabled = true;
    tickEl.classList.remove('hidden');
    spinner.classList.remove('hidden');
    resultPanel.classList.add('hidden');
    btnRetry.classList.add('hidden');

    const dataUrl = grabFrameDataUrl();
    const payload = { 
        image: dataUrl,
        skip_ocr: true,
        session_id: currentSessionId
    };
    
    // Inject the uploaded face for cross verification
    if (uploadedFaceFilename) {
        payload.step1_face = uploadedFaceFilename;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/v1/live_verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await resp.json();

        if (!resp.ok) {
            throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
        }

        renderResult(data);

    } catch (error) {
        resultPanel.innerHTML = `
            <h4>❌ Detection Failed</h4>
            <p style="color: #ef4444;">${error.message}</p>
        `;
        resultPanel.classList.remove('hidden');
    } finally {
        spinner.classList.add('hidden');
        btnRetry.classList.remove('hidden');
    }
}

function renderResult(data) {
    let html = '';

    // --- Section 1: Face Match Cross Verification ---
    const holderDetected = !!data.holder_face_image_url;
    html += `<h4>Live Verification Results</h4>`;

    // Find the cross verification against the uploaded step1 face
    let fmStep1 = null;
    if (data.step3_face_matches && data.step3_face_matches.length > 0) {
        const normUploaded = decodeURIComponent(uploadedFaceFilename || '').toLowerCase();
        const match = data.step3_face_matches.find(m => {
            const normRef = decodeURIComponent(m.step3_face || '').toLowerCase();
            return normRef === normUploaded || (m.vs_holder && m.vs_holder.verified) || m.verified;
        }) || data.step3_face_matches[0];

        if (match) {
            fmStep1 = match.vs_holder || match;
        }
    }

    if (fmStep1) {
        // This checks the uploaded step1 face vs live holder
        const matchBadge = fmStep1.verified
            ? '<span class="badge badge-success">MATCH PASSED</span>'
            : '<span class="badge badge-danger">MATCH FAILED</span>';
        html += `<p style="font-size: 1.05rem;"><strong>Face Verification (Live ↔ Uploaded):</strong> ${matchBadge}</p>`;
        if (fmStep1.distance != null) {
            html += `<p style="color:#888; font-size: 0.85rem; margin-top: -4px; margin-bottom: 12px;">Distance: ${fmStep1.distance.toFixed(3)} / Threshold: ${fmStep1.threshold.toFixed(3)}</p>`;
        }
    } else {
        html += `<p><strong>Face Verification:</strong> <span class="badge badge-danger">NOT TESTED</span> (Missing face in upload or live feed)</p>`;
    }

    // --- Section 2: Extraction Details ---
    html += `<h4>Live Frame Details</h4>`;
    
    const faceStatus = holderDetected
        ? '<span class="badge badge-success">LIVE PERSON DETECTED</span>'
        : '<span class="badge badge-danger">NO PERSON DETECTED</span>';
    html += `<p>Liveness Check: ${faceStatus}</p>`;

    // Face images
    if (data.holder_face_image_url || uploadedFaceFilename) {
        html += `<div class="face-images" style="margin-top: 12px;">`;
        if (uploadedFaceFilename) {
            html += `<div><img src="${API_BASE}/ocr_uploads/${uploadedFaceFilename}" alt="Extracted ID Face" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; border: 2px solid var(--border-color);"><br><small>Extracted ID Face</small></div>`;
        }
        if (data.holder_face_image_url) {
            html += `<div><img src="${API_BASE}${data.holder_face_image_url}" alt="Holder Face" style="width: 100px; height: 100px; object-fit: cover; border-radius: 8px; border: 2px solid var(--border-color);"><br><small>Live Webcam Face</small></div>`;
        }
        html += `</div>`;
    }

    // Overall status
    html += `<hr style="margin: 20px 0; border: 0; border-top: 1px solid rgba(0,0,0,0.1);">`;
    const overallValid = holderDetected && fmStep1 && fmStep1.verified;
    
    const overallBadge = overallValid
        ? '<span class="badge badge-success">VERIFICATION SUCCESSFUL</span>'
        : '<span class="badge badge-danger">VERIFICATION FAILED</span>';
    html += `<p style="font-size: 1.1rem; font-weight: bold;">Final Verdict: ${overallBadge}</p>`;

    if (data.supabase_sync) {
        const sb = data.supabase_sync;
        const sbBadge = sb.synced 
            ? '<span class="badge badge-success">RECORD SYNCED TO SUPABASE</span>' 
            : `<span class="badge badge-danger">LOCAL VERIFICATION COMPLETE</span> (${sb.message || 'Supabase unconfigured'})`;
        html += `<p style="margin-top: 12px; font-size: 0.9rem;"><strong>Supabase Record Status:</strong> ${sbBadge}</p>`;
    }

    resultPanel.innerHTML = html;
    resultPanel.classList.remove('hidden');
}

btnProcessUpload.addEventListener('click', processUploadedDocument);
btnCapture.addEventListener('click', captureAndVerifyLiveId);
if (docUpload) {
    docUpload.addEventListener('change', async () => {
        if (docUpload.files && docUpload.files.length > 0) {
            step2Section.style.opacity = '1';
            step2Section.style.pointerEvents = 'auto';
            await startCamera();
        }
    });
}
btnRetry.addEventListener('click', () => {
    tickEl.classList.add('hidden');
    resultPanel.classList.add('hidden');
    btnRetry.classList.add('hidden');
    btnCapture.disabled = false;
});

// -------------------------------------------------------------
// STEP 3: Supabase GET Record Fetch
// -------------------------------------------------------------
const btnFetchSupabase = document.getElementById('btn-fetch-supabase');
const supabaseLookupInput = document.getElementById('supabase-lookup-id');
const supabaseFetchSpinner = document.getElementById('supabase-fetch-spinner');
const supabaseFetchResults = document.getElementById('supabase-fetch-results');

async function fetchSupabaseRecord() {
    const queryId = (supabaseLookupInput.value || currentSessionId || uploadedDocumentId || '').trim();
    if (!queryId) {
        alert("Please enter a Session ID or Document ID# to fetch.");
        return;
    }

    btnFetchSupabase.disabled = true;
    supabaseFetchSpinner.classList.remove('hidden');
    supabaseFetchResults.classList.add('hidden');

    try {
        const resp = await fetch(`${API_BASE}/api/v1/supabase/get/${encodeURIComponent(queryId)}`);
        const result = await resp.json();

        if (!resp.ok) {
            throw new Error(result.message || `HTTP ${resp.status}`);
        }

        if (result.status === "unconfigured") {
            supabaseFetchResults.innerHTML = `
                <h4>⚠️ Supabase Credentials Unconfigured</h4>
                <p style="color: var(--text-muted);">Local system verification is fully active. To query live Supabase DB records, set valid <code>SUPABASE_URL</code> and <code>SUPABASE_KEY</code> in your <code>.env</code> file.</p>
            `;
        } else if (result.data) {
            const row = result.data;
            let html = `<h4>📦 Supabase Record Found</h4>`;
            html += `<p><strong>Session ID:</strong> <code>${row.session_id || 'N/A'}</code></p>`;
            if (row.id_number) html += `<p><strong>ID Number:</strong> ${row.id_number}</p>`;
            if (row.extracted_name) html += `<p><strong>Extracted Name:</strong> ${row.extracted_name}</p>`;
            if (row.document_type) html += `<p><strong>Document Type:</strong> ${row.document_type}</p>`;
            html += `<p><strong>Face Match Status:</strong> ${row.face_match_verified ? '<span class="badge badge-success">MATCH VERIFIED</span>' : '<span class="badge badge-danger">UNVERIFIED / FAILED</span>'}</p>`;
            html += `<p><strong>Liveness Check:</strong> ${row.liveness_verified ? '<span class="badge badge-success">PASSED</span>' : '<span class="badge badge-danger">FAILED</span>'}</p>`;
            html += `<p><strong>Overall Status:</strong> <span class="badge badge-success">${row.overall_status || 'UNKNOWN'}</span></p>`;
            html += `<p style="font-size:0.8rem; color:#888; margin-top:8px;">Created At: ${row.created_at || 'N/A'}</p>`;
            
            supabaseFetchResults.innerHTML = html;
        } else {
            supabaseFetchResults.innerHTML = `
                <h4>ℹ️ No Supabase Record Found</h4>
                <p style="color: var(--text-muted);">No matching record found in Supabase table for <code>${queryId}</code>.</p>
            `;
        }
        supabaseFetchResults.classList.remove('hidden');
    } catch (err) {
        supabaseFetchResults.innerHTML = `
            <h4>❌ Query Error</h4>
            <p style="color: #ef4444;">${err.message}</p>
        `;
        supabaseFetchResults.classList.remove('hidden');
    } finally {
        supabaseFetchSpinner.classList.add('hidden');
        btnFetchSupabase.disabled = false;
    }
}

if (btnFetchSupabase) {
    btnFetchSupabase.addEventListener('click', fetchSupabaseRecord);
}

// Init
window.addEventListener('load', startCamera);

