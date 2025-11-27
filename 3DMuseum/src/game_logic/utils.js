import { UploadItem , StartWebSocket , SubscribeChannel} from "./services";
import * as THREE from "three";
import { audioCache } from "./index.js";

const uploadModal = document.getElementById("upload-modal");
const uploadContainer = document.getElementById('upload-container');
const uploadInput = document.getElementById('upload-input');
const uploadText = document.getElementById('upload-text');
const uploadPreview = document.getElementById('upload-preview');
const uploadTitle = document.getElementById("upload-title");
const uploadEnDes = document.getElementById("upload-english-description");
const uploadVietDes = document.getElementById("upload-vietnamese-description");
const uploadSpinner = document.getElementById("upload-spinner");
const uploadSubmit = document.getElementById("upload-btn");
// const toastAlert = document.getElementById("toast-alert");
const FirstIMGCol = document.getElementById('FirstIMGCol');
const TitleContainer = document.getElementById('TitleContainer');
const BottomContainer = document.getElementById('BottomContainer');
const CancelBtnContainer = document.getElementById('CancelBtnContainer');
const ImageShowContainer = document.getElementById('ImageShowContainer'); // Get the main container



// toastAlert.style.display = "none";
let file = null;
let uploadProperties = {
    roomID: 0,
    asset_mesh_name: null
};
let gameScene = null;
let assetProgressState = new Map();



export function toastMessage(message) {
    toastAlert.style.display = "flex";
    toastAlert.textContent = message;
    setTimeout(() => { toastAlert.style.display = "none" }, 3000);
}

export function closeUploadModal() {
    uploadModal.style.display = "none";
    uploadPreview.src = '';
    uploadPreview.style.display = 'none';
    uploadText.style.display = 'flex';
    uploadInput.value = null;
    uploadTitle.value = "";
    uploadEnDes.value = "";
    uploadVietDes.value = "";
}

export function displayUploadModal(_aspectRatio, uploadProps) {
    uploadModal.style.display = "block";
    uploadProperties = uploadProps;
    console.log("upload properties: ", uploadProps);


    // Ensure websocket running and subscribe to room channel so we receive progress updates 
    StartWebSocket();
    // Subscribe the room asset is the 
    if (uploadProps?.roomID) {
        const roomCh = `room:${uploadProps.roomID}`;
        SubscribeChannel(roomCh);
    }

}

// --- Upload progress dashboard setup ---
function ensureDashboard() {
  uploadModal.style.display = "none";
  let dash = document.getElementById("upload-dashboard");
  if (!dash) {
    dash = document.createElement("div");
    dash.id = "upload-dashboard";
    dash.style.position = "fixed";
    dash.style.bottom = "10px";
    dash.style.right = "10px";
    dash.style.width = "320px";
    dash.style.maxHeight = "400px";
    dash.style.overflowY = "auto";
    dash.style.background = "#1e1e1e";
    dash.style.color = "#fff";
    dash.style.padding = "10px";
    dash.style.borderRadius = "10px";
    dash.style.fontSize = "13px";
    dash.style.zIndex = "9999";
    dash.style.boxShadow = "0 2px 10px rgba(0,0,0,0.4)";
    document.body.appendChild(dash);
  }
  return dash;
}

function getOrCreateAssetCard(cid, assetTitle) {
  const dash = ensureDashboard();
  let card = document.getElementById(`asset-card-${cid}`);
  
  // Initialize state if not present
  if (!assetProgressState.has(cid)) {
    assetProgressState.set(cid, {
        overallProgress: 0,
        image: { stage: 'Awaiting', status: 'pending', progress: 0, message: '' },
        tts_en: { stage: 'Awaiting', status: 'pending', progress: 0, message: '' },
        tts_vi: { stage: 'Awaiting', status: 'pending', progress: 0, message: '' },
    });
  }

  if (!card) {
    card = document.createElement("div");
    card.id = `asset-card-${cid}`;
    card.style.marginBottom = "10px";
    card.style.border = "1px solid #333";
    card.style.padding = "10px";
    card.style.borderRadius = "8px";
    card.style.background = "#2a2a2a";
    card.style.transition = "opacity 0.5s ease-out";
    
    // Initial card structure
    card.innerHTML = `
      <div style="font-weight:bold; margin-bottom:6px; color:#4caf50;">Asset: ${assetTitle || cid}</div>
      
      <!-- Overall Progress Bar -->
      <div style="font-size:11px; margin-bottom:4px; color:#aaa;">Overall Progress: <span id="asset-stage-msg-${cid}">Starting...</span></div>
      <div style="background:#444; border-radius:5px; height:10px; overflow:hidden; margin-bottom:10px;">
        <div id="asset-progress-${cid}" style="height:10px; width:0%; background:#4caf50; transition:width 0.3s;"></div>
      </div>

      <!-- Sub-task Statuses -->
      <div style="margin-bottom:4px; font-weight:600; color:#ddd;">Asset Generation Status:</div>
      <div id="sub-task-container-${cid}">
        ${createSubTaskRow(cid, 'image', 'Image Upload (KTX2/WebP)')}
        ${createSubTaskRow(cid, 'tts_en', 'Audio (English)')}
        ${createSubTaskRow(cid, 'tts_vi', 'Audio (Vietnamese)')}
      </div>
    `;
    dash.prepend(card);
  }
  return card;
}

/** Helper to generate the HTML for a single sub-task row */
function createSubTaskRow(cid, taskKey, taskLabel) {
    return `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <div style="font-size:12px; color:#ccc;">${taskLabel}:</div>
            <div id="task-status-${cid}-${taskKey}" style="font-size:11px; font-weight:600; color:#ffc107;">Awaiting</div>
        </div>
        <div style="background:#333; border-radius:3px; height:4px; overflow:hidden; margin-bottom:8px;">
            <div id="task-progress-${cid}-${taskKey}" style="height:4px; width:0%; background:#1e88e5; transition:width 0.3s;"></div>
        </div>
    `;
}

/** Helper to update a specific sub-task row's status and progress */
function updateSubTask(cid, taskKey, status, progress, message) {
  if (!taskKey) return;
  const card = document.getElementById(`asset-card-${cid}`);
  if (!card) return;

  if (!card && assetProgressState.lastPendingCid && cid !== assetProgressState.lastPendingCid) {
      cid = assetProgressState.lastPendingCid;
  }

  const statusElem = card.querySelector(`#task-status-${cid}-${taskKey}`);
  const progressElem = card.querySelector(`#task-progress-${cid}-${taskKey}`);

  if (statusElem) {
      statusElem.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      statusElem.style.color = 
          status === 'completed' ? '#00c853' : 
          status === 'failed' ? '#f44336' : 
          status === 'starting' || status === 'processing' || status === 'uploading' ? '#ffc107' : '#aaa';
  }

  if (progressElem) {
      progressElem.style.width = `${progress}%`;
      progressElem.style.background = 
          status === 'completed' ? '#00c853' : 
          status === 'failed' ? '#f44336' : 
          '#1e88e5';
  }
  
  // Update global state
  // if (assetProgressState.has(cid)) {
  //     const state = assetProgressState.get(cid);
  //     state[taskKey] = { stage: taskKey, status, progress, message };
  //     assetProgressState.set(cid, state);
  // }
}


function showCompletionAnimation(card) {
  card.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:60px;">
      <div class="checkmark-circle" style="
        width:40px; height:40px; border-radius:50%; background:#4caf50;
        display:flex; align-items:center; justify-content:center;
        position:relative; animation: popIn 0.3s ease-out;">
        <svg viewBox="0 0 52 52" style="width:26px; height:26px;">
          <path d="M14 27 l7 7 l16 -16" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <animate attributeName="stroke-dasharray" from="0,50" to="50,0" dur="0.4s" fill="freeze" />
          </path>
        </svg>
      </div>
    </div>
  `;
  // remove after 1 second
  setTimeout(() => {
    card.style.opacity = "0";
    setTimeout(() => card.remove(), 500);
  }, 1000);
}

// Listen to progress messages from backend
// Listen to progress messages from backend
window.addEventListener("ws:upload-progress", (e) => {
  const msg = e.detail;

  if (msg.type === "upload") {
    console.log("🖼️ Image pipeline update detected:", msg.stage, msg.status, msg.progress);
  } else if (msg.type === "tts") {
    console.log("🎵 Audio pipeline update detected:", msg.language, msg.status, msg.progress);
  }


  // DEBUG
  console.log("RAW WEBSOCKET MESSAGE:", msg);
    // 🔍 Debug trace to confirm message flow
  // console.groupCollapsed(`[UI] Received ws:upload-progress (${msg.type || "unknown"})`);
  // console.log("Stage:", msg.stage);
  // console.log("Status:", msg.status);
  // console.log("Progress:", msg.progress);
  // console.log("Asset CID:", msg.asset_cid);
  // console.log("Full message:", msg);
  // console.groupEnd();

  // --- STEP 1: Resolve CID correctly ---
  let cid = msg.asset_cid || msg.cid || "pending";

  // 🔹 Auto-link pending card to real CID when known
  if (cid && cid !== "pending" && assetProgressState.lastPendingCid && cid !== assetProgressState.lastPendingCid) {
    const pendingId = assetProgressState.lastPendingCid;
    const oldCard = document.getElementById(`asset-card-${pendingId}`);
    if (oldCard) {
      // Rename card + internal element IDs
      oldCard.id = `asset-card-${cid}`;
      oldCard.querySelectorAll("[id]").forEach((el) => {
        el.id = el.id.replace(pendingId, cid);
      });

      // Move existing progress state
      const state = assetProgressState.get(pendingId);
      if (state) {
        assetProgressState.delete(pendingId);
        assetProgressState.set(cid, state);
      }

      assetProgressState.lastPendingCid = cid;
      console.log(`✅ Renamed pending card ${pendingId} → ${cid}`);
    }
  }

  // 🔹 Fallback to last pending if still "pending"
  if (!cid || cid === "pending" || cid === "unknown") {
    cid = assetProgressState.lastPendingCid;
  }
  if (!cid) return;

  // --- STEP 2: Identify task type ---
  let taskKey = "";
  if (
    ["upload", "convert", "database", "pipeline"].includes(msg.type) ||
    (msg.stage && /(upload|convert|database|webp)/i.test(msg.stage))
  ) {
    taskKey = "image";
  } else if (msg.type === "tts" || (msg.stage && msg.stage.startsWith("tts"))) {
    taskKey = msg.language === "en" ? "tts_en" : "tts_vi";
  }

  // --- STEP 3: Create or get the card ---
  const cardTitle = uploadTitle?.value || "New Asset";
  const card = getOrCreateAssetCard(cid, cardTitle);
  const progressElem = card.querySelector(`#asset-progress-${cid}`);
  const stageMsgElem = card.querySelector(`#asset-stage-msg-${cid}`);

  // --- STEP 4: Update sub-task progress ---
  const progress = msg.progress ?? 0;
  const status = msg.status || "processing";
  const message = msg.message || "";

  updateSubTask(cid, taskKey, status, progress, message);


  // --- STEP 5: Update STATE and Compute Overall Progress ---
  if (assetProgressState.has(cid)) {
    const state = assetProgressState.get(cid);

    // 1. Update the state map FIRST
    if (taskKey === "image") {
      // ⬇️ --- START FIX 1 --- ⬇️
        // ONLY update the state's main progress from pipeline steps (starting, completed, failed).
        // The real-time "uploading" messages should NOT affect the overall state,
        // as they only apply to the sub-task bar (which STEP 4 already updated).
        if (status !== "uploading") {
            state.image.progress = progress;
        }
        // Always update status and message
        state.image.status = status;
        state.image.message = message;
    } else if (taskKey === "tts_en") {
        state.tts_en.progress = progress;
        state.tts_en.status = status;
        state.tts_en.message = message;
    } else if (taskKey === "tts_vi") {
        state.tts_vi.progress = progress;
        state.tts_vi.status = status;
        state.tts_vi.message = message;
    }

    // 2. Recalculate weighted average EVERY time
    const imgProg = state.image.progress || 0;
    const enProg = state.tts_en.progress || 0;
    const viProg = state.tts_vi.progress || 0;

    // Weighting: Image pipeline is 95%, TTS is 5%
    const totalProgress = (imgProg * 0.95) + (((enProg + viProg) / 2) * 0.05);
    
    state.overallProgress = Math.min(100, totalProgress);
    assetProgressState.set(cid, state);

    // 3. Update the Overall UI
    if (progressElem) {
        progressElem.style.width = `${state.overallProgress}%`;
    }
    if (stageMsgElem) {
        // Use the message from the most recent task
        stageMsgElem.textContent = message; 
    }

  } // --- End of STEP 5

  // ... (rest of function, STEP 6 and 7, are fine) ...

  // --- STEP 6: Completion handler ---
  if (msg.status === "completed") {
    // if (msg.stage === "pipeline") {
    //   // Entire pipeline complete (image + scheduling TTS)
    //   showCompletionAnimation(card);
    //   return;
    // }

    // If TTS individual job completes, check if all done
    const st = assetProgressState.get(cid);
    if (st && st.tts_en.status === "completed" && st.tts_vi.status === "completed" && st.image.status === "completed") {
      if (progressElem) progressElem.style.width = "100%";
      if (stageMsgElem) stageMsgElem.textContent = "All tasks complete.";
      showCompletionAnimation(card);
    }
  }

  // --- STEP 7: Failure handler ---
  if (msg.status === "failed") {
    if (progressElem) progressElem.style.background = "#f44336";
    if (stageMsgElem) stageMsgElem.textContent = `Failed: ${msg.message}`;
    setTimeout(() => {
      card.style.opacity = "0";
      setTimeout(() => card.remove(), 500);
    }, 4000);
  }
});



// CSS animation for checkmark pop-in
const effect = document.createElement("style");
effect.textContent = `
@keyframes popIn {
  0% { transform: scale(0); opacity: 0; }
  80% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); }
}
`;
document.head.appendChild(effect);



export function initUploadModal(ktx2Loader) {
    console.log("init");
    const closeBtn = document.getElementById("upload-close");
    closeBtn.addEventListener("click", closeUploadModal);

    const openInput = () =>{
        uploadInput.click();
    } 

    const fileChange = (event) => {
        file = event.target.files[0];
        handleFile(file);
    };

    const submitCallback = () => {
        const { roomID , asset_mesh_name } = uploadProperties;
        // ⬇️ --- START FIX --- ⬇️
        // SUBSCRIBE FIRST!
        // Subscribe to the room channel *before* making the API call.
        // This ensures we catch all 'type: "upload"' messages from the start.
        SubscribeChannel(`room:${roomID}`);
        if (!file) return toastMessage("Select an image.");

        // uploadSpinner.style.display = 'block';
        // uploadSubmit.disabled = true;
        // Display dashboard
        const pendingCID = "pending-" + Date.now();
        getOrCreateAssetCard(pendingCID, uploadTitle.value || "New Asset");
        ensureDashboard();
        assetProgressState.lastPendingCid = pendingCID;



      UploadItem(file, asset_mesh_name, uploadTitle.value, uploadVietDes.value, uploadEnDes.value, roomID)
      .then((response) => {

        console.warn("RESPONSE: ", response);
        const realCID = response?.asset_cid;
        if (realCID) {
            SubscribeChannel(`asset:${realCID}`);
        }
        SubscribeChannel(`room:${roomID}`)
        const webpCID = response?.webp_cid;
        const pendingCID = assetProgressState.lastPendingCid;


        // update map first
        if (assetProgressState.has(pendingCID)) {
          const state = assetProgressState.get(pendingCID);
          assetProgressState.delete(pendingCID);
          assetProgressState.set(realCID, state);
        }


        const uploadEvent = new CustomEvent("uploadevent", {
          detail: {
            ...uploadProperties,
            title: uploadTitle.value,
            vietnamese_description: uploadVietDes.value,
            english_description: uploadEnDes.value,
            img_url: URL.createObjectURL(file),
          },
        });
        document.body.dispatchEvent(uploadEvent);

        if (response.success) closeUploadModal();

        updatePictureFrameTexture(ktx2Loader, asset_mesh_name, realCID, webpCID);
      })
      .catch((err) => {
        console.error("Upload failed:", err);
        uploadSpinner.style.display = "none";
        uploadSubmit.disabled = false;
      });
    };

    uploadContainer.addEventListener('click', openInput);
    uploadInput.addEventListener('change', fileChange);
    uploadSubmit.addEventListener("click", submitCallback);

    uploadContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadContainer.classList.add('dragover');
    });
    uploadContainer.addEventListener('dragleave', () => {
        uploadContainer.classList.remove('dragover');
    });
    uploadContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadContainer.classList.remove('dragover');
        file = e.dataTransfer.files[0];
        handleFile(file);
    });

    uploadModal.style.display = "none";

}


function handleFile(file) {
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp' || file.type === 'video/mp4' || file.type === 'video/quicktime' || file.type === 'video/webm' || file.type === 'video/avi')) {
        const reader = new FileReader();
        reader.onload = function (e) {
            uploadPreview.src = e.target.result;
            uploadPreview.style.display = 'block';
            uploadText.style.display = 'none';
        };
        reader.readAsDataURL(file);
    } else {
        alert('Please upload a PNG / JPG / WebP image.');
    }
}

// utils.js

// Replace your current Mapping_PictureFrame_ImageMesh with this version.
export function Mapping_PictureFrame_ImageMesh(FrameToImageMeshMap, pictureFramesArray, imageMeshesArray) {
  // Defensive copy of image meshes we can assign
  let availableImageMeshes = [...imageMeshesArray];

  // Temporary vectors to avoid allocations in loops
  const framePos = new THREE.Vector3();
  const imgPos = new THREE.Vector3();

  // Debug: print arrays BEFORE mapping so you can inspect exporter order
  console.warn('--- Mapping debug: BEFORE mapping ---');
  for (const f of pictureFramesArray) {
    f.getWorldPosition(framePos);
    // console.warn(`Frame: ${f.name} worldPos: ${framePos.x.toFixed(3)}, ${framePos.y.toFixed(3)}, ${framePos.z.toFixed(3)}`);
  }
  for (const m of imageMeshesArray) {
    m.getWorldPosition(imgPos);
    // console.warn(`ImageMesh: ${m.name} worldPos: ${imgPos.x.toFixed(3)}, ${imgPos.y.toFixed(3)}, ${imgPos.z.toFixed(3)}`);
  }
  console.warn('--- End debug ---');

  // Sort frames left -> right by world X (if your gallery layout is horizontal).
  // If your layout runs on Z-axis instead, change to comparing .z instead.
  pictureFramesArray.sort((a, b) => {
    a.getWorldPosition(framePos);
    b.getWorldPosition(imgPos); // reuse imgPos as temp
    return framePos.x - imgPos.x;
  });

  // Also sort available images left -> right to give consistent baseline (not required
  // for the nearest-neighbour but makes behavior deterministic).
  availableImageMeshes.sort((a,b) => {
    a.getWorldPosition(framePos);
    b.getWorldPosition(imgPos);
    return framePos.x - imgPos.x;
  });

  for (const frame of pictureFramesArray) {
    frame.getWorldPosition(framePos);

    let closest = null;
    let closestIndex = -1;
    let minDistance = Infinity;

    // find nearest unassigned image mesh (one-to-one)
    for (let i = 0; i < availableImageMeshes.length; i++) {
      const img = availableImageMeshes[i];
      img.getWorldPosition(imgPos);
      const d = framePos.distanceTo(imgPos);
      if (d < minDistance) {
        minDistance = d;
        closest = img;
        closestIndex = i;
      }
    }

    if (closest) {
      FrameToImageMeshMap[frame.name] = closest.name;
      // remove assigned image so it won't be chosen again
      availableImageMeshes.splice(closestIndex, 1);

      // log mapping and positions for verification
      closest.getWorldPosition(imgPos);
    //   console.warn(`Picture Frame: ${frame.name} (${framePos.x.toFixed(3)}, ${framePos.z.toFixed(3)}) -> ImageMesh: ${closest.name} (${imgPos.x.toFixed(3)}, ${imgPos.z.toFixed(3)}) dist=${minDistance.toFixed(3)}`);
    } else {
      FrameToImageMeshMap[frame.name] = null;
      console.warn(`Picture Frame: ${frame.name} -> (NO MATCH)`);
    }
  }

  // Final mapping log
//   console.warn('Final FrameToImageMeshMap:', JSON.stringify(FrameToImageMeshMap, null, 2));
}


export function DisplayImageOnDiv(imageURL, title, vietnamese_description, english_description) {
    if (!FirstIMGCol || !TitleContainer || !BottomContainer || !ImageShowContainer) {
        console.error("Missing target DOM elements. Check your HTML structure.");
        return;
    }

    const language = localStorage.getItem('language');
    const description = language === 'vi' ? vietnamese_description : english_description;

    // Clear previous content
    FirstIMGCol.innerHTML = '';
    TitleContainer.innerHTML = '';
    BottomContainer.innerHTML = '';

    // Create image element
    const imgElement = document.createElement('img');
    imgElement.src = imageURL;
    imgElement.alt = title || 'Artwork';
    imgElement.style.width = '100%';
    imgElement.style.height = '100%';
    imgElement.style.objectFit = 'contain';
    FirstIMGCol.appendChild(imgElement);

    // Insert title
    TitleContainer.innerHTML = `
        <div class="Title text-xl font-semibold w-full text-center my-2">${title}</div>
    `;

    // Insert description
    BottomContainer.innerHTML = `
        <div class="Description text-md font-normal w-full px-5">${description}</div>
    `;

    // Show container
    ImageShowContainer.style.display = "flex";
    // Make sure event listener only binds once
    CancelBtnContainer.onclick = () => {
        ImageShowContainer.style.display = 'none';
    };
}

export function getCachedAudioDuration(audioCID){
    if (!audioCID) return null;
    try{
        if (typeof audioCache !== undefined && audioCache instanceof Map){
            const buffer = audioCache.get(audioCID);
            if (buffer && typeof buffer.duration === 'number') return buffer.duration
        }
    }catch (error){
        console.error("Fail to get audio duration: ", error)
        return null;
    }
    return null;
}

export function setGameScene(scene) {
    gameScene = scene;
}

// Global Texture Loader (re-use the same loader instance)
const textureLoader = new THREE.TextureLoader();

/**
 * Hot-updates a picture frame mesh with a new image texture.
 * @param {string} meshName - The name of the Three.js mesh (picture frame).
 * @param {string} imageUrl - The URL of the newly uploaded image.
 */

export function updatePictureFrameTexture(ktx2Loader , meshName, ktx2CID, webpCID) {
    if (!gameScene) {
        console.error("Game scene not set. Cannot hot-update texture.");
        return;
    }

    // 1. Find the target mesh
    const targetMesh = gameScene.getObjectByName(meshName);

    if (!targetMesh || !targetMesh.isMesh) {
        console.warn(`Mesh or material not found for '${meshName}'. Cannot update texture.`);
        return;
    }
    
    // Helper to safely dispose the old texture and apply the new one
    const applyNewTexture = (newTexture, sourceFormat) => {
        newTexture.needsUpdate = true;
        // Ensure the material has a map property to update
        if (targetMesh.material) {
            // Dispose of the old texture to free up GPU memory
            if (targetMesh.material.map) targetMesh.material.map.dispose();
            targetMesh.material.dispose(); // Dispose the material

            const newMaterial = new THREE.MeshStandardMaterial({
                map: newTexture,
                side: THREE.DoubleSide,
                roughness: 0.5,
                metalness: 0.0,
            });
            
            // Apply the new texture
            targetMesh.material = newMaterial;
            // Signal Three.js that the material needs to be re-rendered
            targetMesh.material.needsUpdate = true;
            
            console.log(`✅ Hot-updated texture for mesh: ${meshName} (${sourceFormat})`);
        } else {
            console.error(`Target mesh ${meshName} material is missing a 'map' property to update.`);
            newTexture.dispose(); // Dispose if not used
        }
        if (window.composer){
            window.composer.render();
        }
    };


    // --- ATTEMPT 1: Load KTX2 ---
    const ktx2Url = `https://${window.PINATA_URL}${ktx2CID}`
    const fallbackUrl = `https://${window.PINATA_URL}${webpCID}`
    ktx2Loader.load(ktx2Url, 
        // KTX2 Success Callback
        (ktx2Texture) => {
            // KTX2Loader usually sets flipY and colorSpace correctly, but we ensure needsUpdate
            ktx2Texture.needsUpdate = true;
            applyNewTexture(ktx2Texture, 'KTX2');
        },
        // KTX2 Progress Callback (Optional)
        undefined, 
        // KTX2 Error Callback -> FALLBACK
        (ktx2Error) => {
            console.warn(`KTX2 load failed for ${meshName}. Error:`, ktx2Error);
            console.log("... Falling back to WebP/JPEG.");

            // --- ATTEMPT 2: Load Fallback Image (WebP/JPEG) ---
            textureLoader.load(fallbackUrl,
                // Fallback Success Callback
                (fallbackTexture) => {
                    // Standard image texture settings
                    fallbackTexture.colorSpace = THREE.SRGBColorSpace;
                    fallbackTexture.flipY = true;
                    applyNewTexture(fallbackTexture, 'Fallback WebP/JPEG');
                },
                // Fallback Progress Callback (Optional)
                undefined,
                // Fallback Error Callback
                (fallbackError) => {
                    console.error(`❌ Both KTX2 and Fallback loading failed for ${meshName}.`, fallbackError);
                }
            );
        }
    );
}
