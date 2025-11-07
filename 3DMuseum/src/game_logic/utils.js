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
    // StartWebSocket();
    // // Subscribe the room asset is the 
    // if (uploadProps?.roomID) {
    //     const roomCh = `room:${uploadProps.roomID}`;
    //     SubscribeChannel(roomCh);
    // }

}

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
        if (!file) return toastMessage("Select an image.");

        uploadSpinner.style.display = 'block';
        uploadSubmit.disabled = true;

        const { roomID , asset_mesh_name } = uploadProperties;


        UploadItem(file, asset_mesh_name , uploadTitle.value, uploadVietDes.value, uploadEnDes.value, roomID)
            .then((res) => {
                uploadSpinner.style.display = 'none';
                uploadSubmit.disabled = false;

                // if server returns asset_cid, auto-subscribe to detailed asset channel
                // if (res && res.asset_cid) {
                //     SubscribeChannel(`asset:${res.asset_cid}`);
                // }

                const uploadEvent = new CustomEvent("uploadevent", {
                    detail: {
                        ...uploadProperties,
                        title: uploadTitle.value,
                        vietnamese_description: uploadVietDes.value,
                        english_description: uploadEnDes.value,
                        img_url: URL.createObjectURL(file)
                    }
                });

                document.body.dispatchEvent(uploadEvent);

                if (res.success) closeUploadModal();
                // --- HOT UPDATE CALL ---
                // response.data should contain the key mapping information
                const {asset_cid , webp_cid} = res;
                const meshName = uploadProperties.asset_mesh_name;
                updatePictureFrameTexture(ktx2Loader , meshName , asset_cid, webp_cid);
            })
            .catch((error) => {
                console.log("error 2: ", error);
                // toastMessage(error.message || error.toString());
                uploadSpinner.style.display = 'none';
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
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webP')) {
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
