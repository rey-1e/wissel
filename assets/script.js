const socialPresets = {
    "Instagram": { "Profile": [320, 320], "Post (Sq)": [1080, 1080], "Post (Port)": [1080, 1350], "Story": [1080, 1920] },
    "Facebook": { "Profile": [170, 170], "Cover": [851, 315], "Post": [1200, 630] },
    "Twitter/X": { "Profile": [400, 400], "Header": [1500, 500], "Post": [1200, 675] },
    "YouTube": { "Profile": [800, 800], "Banner": [2560, 1440], "Thumb": [1280, 720] },
    "LinkedIn": { "Profile": [400, 400], "Banner": [1584, 396], "Post": [1200, 627] }
};

let currentFiles = [];
let currentMode = 'px';
let activeFileId = null;
let outputFolder = '';
let lastOutputFolder = ''; 

window.addEventListener('pywebviewready', () => {
    pywebview.api.get_initial_file().then((data) => {
        if (data && data.length > 0) loadFiles(data);
    });
});

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initDragAndDrop();
});

function initUI() {
    initSocialMediaControls();
    initExportFormatOptions();
    
    document.getElementById('browseFolderBtn').addEventListener('click', browseOutputFolder);
    document.getElementById('replaceOriginal').addEventListener('change', toggleOutputFolder);
    document.getElementById('processBtn').addEventListener('click', initiateProcess); 
    document.getElementById('confirmBtnAction').addEventListener('click', executeProcess); 
    document.getElementById('openFolderBtn').addEventListener('click', openLastFolder);

    document.getElementById('scaleSlider').addEventListener('input', (e) => {
        document.getElementById('scaleVal').textContent = e.target.value;
        document.getElementById('scaleText').textContent = e.target.value;
    });

    document.getElementById('qualitySlider').addEventListener('input', (e) => {
        document.getElementById('qualityVal').textContent = e.target.value + '%';
    });

    const lockRatio = document.getElementById('lockRatio');
    const widthInput = document.getElementById('widthInput');
    const heightInput = document.getElementById('heightInput');

    widthInput.addEventListener('input', () => {
        const val = parseInt(widthInput.value);
        if (lockRatio.checked && currentFiles.length === 1 && currentFiles[0].ratio && !isNaN(val)) {
            const h = Math.round(val / currentFiles[0].ratio);
            if(h > 0) heightInput.value = h;
        }
    });

    heightInput.addEventListener('input', () => {
        const val = parseInt(heightInput.value);
        if (lockRatio.checked && currentFiles.length === 1 && currentFiles[0].ratio && !isNaN(val)) {
            const w = Math.round(val * currentFiles[0].ratio);
            if(w > 0) widthInput.value = w;
        }
    });

    setupBgFillControls('bgFillCheckPx', 'fillControlsPx', 'bgFillContainer');
    setupBgFillControls('bgFillCheck', null, null); 
}

function initDragAndDrop() {
    const dropZone = document.querySelector('.workboard');
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {e.preventDefault(); e.stopPropagation();}, false);
    });
    dropZone.addEventListener('dragenter', () => dropZone.style.boxShadow = 'inset 0 0 0 2px var(--accent)');
    dropZone.addEventListener('dragleave', () => dropZone.style.boxShadow = 'none');
    dropZone.addEventListener('drop', (e) => {
        dropZone.style.boxShadow = 'none';
        const files = e.dataTransfer.files;
        handleFiles(files);
    });
}

function handleFiles(files) {
    if(!files || files.length === 0) return;
    const filePromises = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.heic')) continue;
        const p = new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve({ name: file.name, data: reader.result });
            reader.onerror = error => reject(error);
        });
        filePromises.push(p);
    }
    Promise.all(filePromises).then(results => {
        if(results.length > 0) {
            pywebview.api.handle_dropped_files(results).then(data => {
                if (data && data.length > 0) loadFiles(data);
            });
        }
    });
}

function setupBgFillControls(checkboxId, controlsId, containerId) {
    const cb = document.getElementById(checkboxId);
    if(!cb) return;
    const toggle = () => {
        if(containerId) {
            const container = document.getElementById(containerId);
            if(cb.checked) container.classList.add('bg-fill-active');
            else container.classList.remove('bg-fill-active');
        }
        const parent = cb.closest('.bg-fill-box');
        const radios = parent.querySelectorAll('input[type="radio"]');
        const colorIn = parent.querySelector('input[type="color"]');
        radios.forEach(r => r.disabled = !cb.checked);
        const colorRadio = parent.querySelector('input[id*="fillColorRadio"]');
        if(colorRadio && colorRadio.checked && cb.checked) {
            if(colorIn) colorIn.disabled = false;
        } else {
            if(colorIn) colorIn.disabled = true;
        }
    };
    cb.addEventListener('change', toggle);
    const parent = cb.closest('.bg-fill-box');
    const radios = parent.querySelectorAll('input[type="radio"]');
    radios.forEach(r => r.addEventListener('change', toggle));
    const colorIn = parent.querySelector('input[type="color"]');
    const hexDisplay = parent.querySelector('span[id*="colorHex"]');
    if(colorIn && hexDisplay) {
        colorIn.addEventListener('input', (e) => hexDisplay.textContent = e.target.value.toUpperCase());
    }
}

function browseFile() {
    pywebview.api.browse_image().then((data) => {
        if (data && data.length > 0) loadFiles(data);
    });
}

function browseOutputFolder() {
    pywebview.api.browse_folder().then((path) => {
        if (path) {
            outputFolder = path;
            document.getElementById('outputFolder').value = path;
        }
    });
}

function toggleOutputFolder() {
    const replace = document.getElementById('replaceOriginal').checked;
    const outputFolderInput = document.getElementById('outputFolder');
    const browseBtn = document.getElementById('browseFolderBtn');
    outputFolderInput.disabled = replace;
    browseBtn.disabled = replace;
    if (replace) {
        outputFolderInput.parentElement.style.opacity = '0.5';
        outputFolderInput.value = "";
    } else {
        outputFolderInput.parentElement.style.opacity = '1';
        outputFolderInput.value = outputFolder || "Default: Same folder as source";
    }
}

function loadFiles(fileData) {
    const files = Array.isArray(fileData) ? fileData : [fileData];
    files.forEach(file => {
        const newFile = {
            id: file.id, path: file.path, name: file.name, data: file.data, 
            width: 0, height: 0, ratio: 0
        };
        currentFiles.push(newFile);
        createImageTile(newFile);
    });
    updateUI();
}

function createImageTile(file) {
    const grid = document.getElementById('image-grid');
    const tile = document.createElement('div');
    tile.className = 'image-tile';
    tile.id = file.id;
    const imgObj = new Image();
    imgObj.onload = () => {
        const f = currentFiles.find(x => x.id === file.id);
        if(f) {
            f.width = imgObj.naturalWidth;
            f.height = imgObj.naturalHeight;
            f.ratio = f.width / f.height;
            if(currentFiles.length === 1) {
                document.getElementById('widthInput').value = f.width;
                document.getElementById('heightInput').value = f.height;
            }
        }
    };
    imgObj.src = file.data;
    tile.onclick = () => openMiniEditor(file.id);
    
    // UPDATED HTML FOR TILE: Using SVG icons instead of <i> tags
    tile.innerHTML = `
        <img src="${file.data}" alt="${file.name}">
        <div class="tile-filename">${file.name}</div>
        <div class="tile-overlay">
            <div class="tile-actions">
                <button class="icon-btn" onclick="event.stopPropagation(); openMiniEditor('${file.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.13 1L6 16a2 2 0 0 0 2 2h15"></path><path d="M1 6.13L16 6a2 2 0 0 1 2 2v15"></path></svg>
                </button>
                <button class="icon-btn" onclick="event.stopPropagation(); deleteImage('${file.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        </div>
    `;
    grid.appendChild(tile);
}

function deleteImage(fileId) {
    currentFiles = currentFiles.filter(f => f.id !== fileId);
    const el = document.getElementById(fileId);
    if(el) el.remove();
    updateUI();
}

function updateUI() {
    const fileCount = currentFiles.length;
    const sidebarTitle = document.getElementById('sidebar-title');
    const fileName = document.getElementById('fileName');
    const processBtn = document.getElementById('processBtn');
    const placeholder = document.getElementById('placeholderText');
    if (fileCount > 0) {
        sidebarTitle.textContent = "Editor Active";
        fileName.textContent = `${fileCount} image${fileCount > 1 ? 's' : ''}`;
        processBtn.disabled = false;
        placeholder.style.display = 'none';
        if(fileCount > 1) {
            document.getElementById('widthInput').placeholder = "Multiple";
            document.getElementById('widthInput').value = "";
            document.getElementById('heightInput').placeholder = "Multiple";
            document.getElementById('heightInput').value = "";
        }
    } else {
        sidebarTitle.textContent = 'Editor';
        fileName.textContent = 'No images selected';
        processBtn.disabled = true;
        placeholder.style.display = 'block';
    }
}

function openMiniEditor(fileId) {
    activeFileId = fileId;
    const file = currentFiles.find(f => f.id === fileId);
    if(file) {
        document.getElementById('mini-editor-image').src = file.data;
        document.getElementById('mini-editor-modal').style.display = 'flex';
    }
}
function closeMiniEditor() {
    activeFileId = null;
    document.getElementById('mini-editor-modal').style.display = 'none';
}

function transformImage(transformType) {
    if (!activeFileId) return;
    const file = currentFiles.find(f => f.id === activeFileId);
    pywebview.api.transform_image({ id: file.id, transforms: [transformType] }).then(response => {
        if (response.success) {
            file.data = response.data;
            document.getElementById('mini-editor-image').src = response.data;
            const tileImg = document.querySelector(`#${file.id} img`);
            if(tileImg) tileImg.src = response.data;
            const img = new Image();
            img.onload = () => {
                file.width = img.naturalWidth;
                file.height = img.naturalHeight;
                file.ratio = file.width / file.height;
                if(currentFiles.length === 1) {
                    document.getElementById('widthInput').value = file.width;
                    document.getElementById('heightInput').value = file.height;
                }
            };
            img.src = response.data;
        } else {
            alert("Error: " + response.message);
        }
    });
}

function setResizeMode(mode, btn) {
    currentMode = mode;
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.resize-view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${mode}`).classList.add('active');
}

function initSocialMediaControls() {
    const platformSelect = document.getElementById('platformSelect');
    const presetSelect = document.getElementById('presetSelect');
    if(!platformSelect) return; 
    platformSelect.innerHTML = '';
    for (const platform in socialPresets) {
        let opt = document.createElement('option');
        opt.value = platform;
        opt.innerText = platform;
        platformSelect.appendChild(opt);
    }
    function updatePresets() {
        const platform = platformSelect.value;
        const presets = socialPresets[platform];
        presetSelect.innerHTML = '';
        if(presets) {
            for (const presetName in presets) {
                let opt = document.createElement('option');
                opt.value = presetName;
                opt.innerText = presetName;
                presetSelect.appendChild(opt);
            }
        }
        updateSocialDimensions();
    }
    function updateSocialDimensions() {
        const platform = platformSelect.value;
        const preset = presetSelect.value;
        if(socialPresets[platform] && socialPresets[platform][preset]) {
            const dims = socialPresets[platform][preset];
            document.getElementById('socialWidth').value = dims[0];
            document.getElementById('socialHeight').value = dims[1];
        }
    }
    platformSelect.addEventListener('change', updatePresets);
    presetSelect.addEventListener('change', updateSocialDimensions);
    updatePresets();
}

function initExportFormatOptions() {
    const formats = ["JPG", "PNG", "WEBP", "BMP", "GIF", "TIFF", "PDF", "ICO"];
    const select = document.getElementById('exportFormat');
    select.innerHTML = '';
    formats.forEach(format => {
        const option = document.createElement('option');
        option.value = format;
        option.textContent = format;
        select.appendChild(option);
    });
}

function buildOps(file) {
    const ops = { bg_fill: { enabled: false } };
    if (currentMode === 'px') {
        ops.resize = {
            width: parseInt(document.getElementById('widthInput').value) || file.width,
            height: parseInt(document.getElementById('heightInput').value) || file.height
        };
        if (document.getElementById('bgFillCheckPx').checked) {
            ops.bg_fill = {
                enabled: true,
                transparent: document.getElementById('fillTransRadioPx').checked,
                color: document.getElementById('fillColorInputPx').value
            };
        }
    } else if (currentMode === 'pct') {
        const scale = parseInt(document.getElementById('scaleSlider').value) / 100;
        ops.resize = {
            width: Math.round(file.width * scale),
            height: Math.round(file.height * scale)
        };
    } else if (currentMode === 'social') {
        ops.resize = {
            width: parseInt(document.getElementById('socialWidth').value),
            height: parseInt(document.getElementById('socialHeight').value)
        };
        if (document.getElementById('bgFillCheck').checked) {
            ops.bg_fill = {
                enabled: true,
                transparent: document.getElementById('fillTransRadio').checked,
                color: document.getElementById('fillColorInput').value
            };
        }
    }
    ops.format = document.getElementById('exportFormat').value;
    ops.quality = parseInt(document.getElementById('qualitySlider').value);
    ops.resample_mode = document.getElementById('resampleMode').value;
    const sizeLimit = parseInt(document.getElementById('targetSize').value);
    if(sizeLimit > 0) ops.target_size_kb = sizeLimit;
    return ops;
}

function initiateProcess() {
    if (currentFiles.length === 0) return;
    const replace = document.getElementById('replaceOriginal').checked;
    
    // Safety Check: Confirm overwrite
    if (replace) {
        document.getElementById('confirm-modal').style.display = 'flex';
    } else {
        executeProcess();
    }
}

async function executeProcess() {
    document.getElementById('confirm-modal').style.display = 'none';
    
    const replace = document.getElementById('replaceOriginal').checked;
    let destinationFolder = null;
    
    if (!replace) {
        destinationFolder = outputFolder;
    }

    // Show Progress Modal
    document.getElementById('progress-modal').style.display = 'flex';
    document.getElementById('progress-bar-fill').style.width = '0%';
    document.getElementById('progress-text').innerText = 'Initializing...';
    document.getElementById('processBtn').disabled = true;

    const batchList = currentFiles.map(file => {
        return {
            id: file.id,
            name: file.name
        };
    });

    const sampleOps = buildOps(currentFiles[0]); 
    
    pywebview.api.process_batch({
        files: batchList,
        ops: sampleOps,
        destinationFolder: destinationFolder,
        replace: replace
    });
}

function cancelProcessing() {
    pywebview.api.cancel_processing();
    document.getElementById('progress-text').innerText = 'Cancelling...';
}

function updateProgress(percent, filename) {
    document.getElementById('progress-bar-fill').style.width = percent + '%';
    document.getElementById('progress-text').innerText = `Processing: ${filename}`;
}

function processingComplete(report) {
    document.getElementById('progress-modal').style.display = 'none';
    document.getElementById('processBtn').disabled = false;

    // Store folder for opening later
    lastOutputFolder = report.output_dir;

    // Show Report
    const summary = document.getElementById('results-summary');
    const list = document.getElementById('error-list');
    
    if (report.cancelled) {
         summary.innerText = "Processing Cancelled";
         summary.style.color = "#ffa94d";
    } else {
        summary.innerText = `Completed. Success: ${report.success}, Failed: ${report.failed}`;
        summary.style.color = report.failed > 0 ? '#ff6b6b' : '#51cf66';
    }
    
    list.innerHTML = '';
    if (report.failed > 0) {
        report.errors.forEach(err => {
            const div = document.createElement('div');
            div.className = 'error-item';
            div.innerText = err;
            list.appendChild(div);
        });
    } else if (report.success > 0 && !report.cancelled) {
        const div = document.createElement('div');
        div.style.color = "var(--text-sub)";
        div.style.fontSize = "14px";
        div.innerText = "All images exported successfully.";
        list.appendChild(div);
    }
    
    document.getElementById('results-modal').style.display = 'flex';
}

function openLastFolder() {
    if (lastOutputFolder) {
        pywebview.api.open_file_explorer(lastOutputFolder);
    }
}

function installContextMenu() {
    pywebview.api.install_context_menu().then(res => alert(res.message));
}