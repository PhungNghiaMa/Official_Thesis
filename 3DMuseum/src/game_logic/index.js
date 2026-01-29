// This file contains the main game logic for the 3D museum application, 
// including scene setup, player controls, audio management, and asset handling.
// This is the main entry point for the game logic module and orchestrates various components

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import FirstPersonPlayer from './control';
import ThirdPersonPlayer from "./ThirdPersonPlayer.js";
import AnnotationDiv from "./annotationDiv";
import { displayUploadModal, initUploadModal , Mapping_PictureFrame_ImageMesh , DisplayImageOnDiv, setGameScene} from "./utils";
import { GetRoomAsset , GenAI } from "./services";
import { Museum } from "./constants";
import { Capsule, DRACOLoader} from "three/examples/jsm/Addons.js";
import RaycasterManager from "./raycaster.js"
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { KTX2Loader } from "three/examples/jsm/Addons.js";
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

// Use this if you want to load HDR environment map through .hdr file
// import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js'; 
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { acceleratedRaycast } from "three-mesh-bvh";
if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { initRecastIfNeeded  , getNavQuery , LoadExternalNavMesh , buildNavMeshFromMeshes } from "./recastNav.js";
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { updateCrowd , addAgent, initCrowd, setAgentTarget, startAgentTour , updateAgentTours , stopAgentTour , addThirdPersonToCrowd, getAgents  } from "./CrowdManager.js";
import { createAnimController } from "./createAnimationController.js";
import Hls from 'hls.js';


THREE.Cache.enabled = true; // Enable caching for better performance

// --- Global variables for the game, now scoped within this module ---
const clock = new THREE.Clock();
let scene = new THREE.Scene();

let menuOpen = false;
let currentMuseumId = Museum.ROOM1;

// Loader animation instance
let backgroundPositionX = null;

const STEPS_PER_FRAME = 2; // Number of physics steps per frame
let fpView, tpView; // Instance of FirstPersonPlayer and ThirdPersonPlayer
let playerCollider;
let activePlayer = 'tp';
let annotationMesh = {};

let isDoorOpen = false;
let animation = null;
let mixer = null;
let hasLoadPlayer = false;
let physiscsReady = false;
let physicsTimeAccumulator = 0;
let currentScene = null;

// Third person character model instance
let character = null;
let characterModelReady = false
let characterModel = null;
let characterGLTF = null;
let tpViewExisted = null;
let tpViewLoadLate = false;

// Floor instance 
let floorMesh = null, maxArea = 0, fallbackY = Infinity, fallbackX = 0, fallbackZ = 0, floorBoxMaxY = null;

// Door instance 
let interactedDoor;

// HTML instance 
const pictureTitlte = document.getElementById('picture-title')


// Progress loading instance 
let currentProgress = 0;
let targetProgress = 0;

// Light instance
let ambientLight , hemiLight , spot1 , spot2 , sun;

// instance for post-processing
let composer , outlinePass;

let camYaw = 0;
let camPitch = 0;

// NPC instance 
let agent = null;
window.THREE = THREE; // expose for debugging
window.getAgents = getAgents();

// This is an object (map) use to contain the mapping between PictureFrame mesh 
// and corresponding ImageMesh mesh
export const FrameToImageMeshMap = {};

// Audio instance 
export const  audioCache = new Map();
export const audioRawCache = new Map();       // CID -> ArrayBuffer (raw)
let audioContext = null;
let currentSourceNode = null; // Keep track of the currently playing source for potential stopping
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
window.audioCtx = audioCtx

// Keep references for updates
const spatialSources = new Map(); // key: meshName -> { panner, source, video }
const listener = audioCtx.listener;

// Globale variable for checking host / non-host in multiplayer mode
export let isHost = false;


// AssetDataMap to store and quickly extract data for each image mesh to use in room tour mode
export const AssetDataMap = new Map()

// Instance of navmesh building 
let navQuery = null;
let navMesh = null;
let crowd = null;
export const npcAgents = [];

const bvhMeshList = [];          // meshes used for BVH raycasts (ground snap + capsule checks)
const navInputMeshes = [];   // meshes we will pass to recast
let  pictureFramesArray = [];
let count = 0;

// PINATA URL 
const PINATA_URL = import.meta.env.MODE === "production"
    ? import.meta.env.VITE_PINATA_PRIVATE_GATEWAY 
    : import.meta.env.VITE_PINATA_PRIVATE_GATEWAY;     

// Multiplayer instances
const remotePlayers = new Map();   

// This just for testing. This is global variable that can test from the console on browswer
// Later on when set up final version , please delete this variable and all the set up in functions
// track scheduled retries so we don't schedule multiple timers per peer 
// window.REMOTEPLAYERS = new Map();

const REMOTE_LOAD_RETRY = {}; // peerId -> timeoutId
const MAX_AVATAR_LOAD_ATTEMPTS = 4;
const AVATAR_RETRY_DELAY_MS = 5000; // 5s

// LOD instance ( LEVEL OF DETAIL )
const LOD_SETTINGS = {
  // The bias is a fractional number of levels to offset the chosen mipmap.
    HIGH: 0.0,    // Default quality (best).
    MEDIUM: 2.0,  // Slightly lower quality (skips first mipmap).
    LOW: 5.0,     // Much lower quality (skips first few mipmaps).
    
    // Performance Thresholds
    targetFPS: 180,                // Ideal frame rate
    minAcceptableFPS: 30,         // If FPS drops below this, we degrade quality.

    isLowMemory: (navigator.deviceMemory && navigator.deviceMemory <= 4),
    
    // Tracking Variables for FPS Calculation
    currentBias: 0.0,
    frames: 0,
    startTime: performance.now(),
    FPS_CHECK_INTERVAL_MS: 2000   // Check performance every 10 seconds
}

// Door State
const doorState = {
    Door001: false,
    Door002: false
}

// Container instance 
let loadingManager = document.getElementById('loading-container');

// THREE loading managers
const LoadingManager = new THREE.LoadingManager();

// Share instance for using in webRTC.js , avoid directly import cause circular import
export let _sharedRefs = {
    scene: null,
    navQuery: null,
    bvhMeshList: null,
    npcAgents: null, 
    tpView: null,
    getAgents: getAgents,
    updateCrowd: updateCrowd,
    addAgent: addAgent,
    initCrowd: initCrowd,
    setAgentTarget: setAgentTarget,
    startAgentTour: startAgentTour,
    updateAgentTours: updateAgentTours,
    stopAgentTour: stopAgentTour,
    addThirdPersonToCrowd: addThirdPersonToCrowd,
}

// Function to assign the global Refs
function setGlobalRefs(refs = {}) {
  _sharedRefs = Object.assign({}, _sharedRefs, refs || {});
  console.debug("[webRTC] setGlobalRefs called:", {
    hasScene: !!_sharedRefs.scene,
    hasNavQuery: !!_sharedRefs.navQuery,
    hasBVH: !!_sharedRefs.bvhMeshList,
    hasNPCs: !!_sharedRefs.npcAgents,
    hasTPView: !!_sharedRefs.tpView,
  });
  window.SCENE = _sharedRefs.scene || null;
}

// While loading to the scene , the onStart running to announce the file is correctly 
// kicked off and then start the loading-container to load the progress bar 
LoadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
    console.log(`Started loading: ${url}. Loaded ${itemsLoaded} of ${itemsTotal} files.`);
    loadingManager.style.display = 'flex';
    loadingManager.style.opacity = '1';
    loadingManager.style.backgroundColor = 'black';

    const loader = document.getElementById('loader-container');
    if (loader) loader.style.setProperty('--fill', '100%'); // start empty
};

// This onLoad is kicked off when the whole model file is finish loading 
// This function used to announce the loading finish and hide the loading-container 
LoadingManager.onLoad = () => {
    console.log('All resources loaded.');
        setTimeout(() => {
        loadingManager.style.opacity = '0';
        // After fading out, set display to none to remove it from layout flow.
        setTimeout(() => {
            loadingManager.style.display = 'none';
        }, 500);
    }, 2000); // 500ms delay to allow the animation to complete
};

// This onError is executed when there is an error related to load model 
LoadingManager.onError = (url) => {
    console.error(`There was an error loading: ${url}. Error: ${error}`);
};

// Definfe path to 3D model
const ModelPaths = {
    [Museum.ROOM1]: "optimizedModel/optimizeModel_38.glb",
    [Museum.ROOM2]: "optimizedModel/optimizeModel_NEW_5.glb",
}

let raycasterManager = null
let imageMeshesArray = []; // Used to store all the ImageMesh mesh
let doorBoundingBox = null;
let hasEnteredNewScene = false;
let tourTargetsMap = new Map(); // Key is PictureFrame name and Value is PictureFrame mesh

// DOM Elements
let container, cssRenderer, css3dRenderer, renderer, camera;

// Animation frame request ID to stop/start the loop
let animationFrameId = null;

// Synchronizes the 3D scene and all renderers with the current browser window dimensions.
function onWindowResize() {
    if (!container || !camera || !renderer || !cssRenderer || !css3dRenderer) return;

    // CAMERA RATIO: Adjust the Aspect Ratio (Width / Height) to prevent the image from looking squashed.
    camera.aspect = container.clientWidth / container.clientHeight;
    // RECALCULATE PROJECTION: Tell the camera to re-do its math based on the new aspect ratio.
    // camera.updateProjectionMatrix() is called when there is a change in aspect , field of view (fov) , near and far
    camera.updateProjectionMatrix();
    // camera.position.set(0,0,0);

    // MAIN RENDERER: Resize the canvas where the 3D objects are drawn.
    renderer.setSize(container.clientWidth, container.clientHeight);

    // BACKGROUND COLOR: Set the background to a light grey (#f0f0f0).
    renderer.setClearColor(new THREE.Color("#f0f0f0"), 1); // Color and full opacity

    // UI RENDERERS: Resize the layers that handle 2D labels and 3D web elements.
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    // css3dRenderer.setSize(container.clientWidth, container.clientHeight);

    // POST-PROCESSING: Adjust the size of GLow effect 
    if (composer) composer.setSize(container.clientWidth, container.clientHeight);
    if (outlinePass) outlinePass.setSize(container.clientWidth, container.clientHeight);
}

// Function to hide all label of the annotationMesh
function hideAnnotations() {
    Object.values(annotationMesh).forEach(({ label }) => {
        if (label && label.element) label.element.style.opacity = "0";
    });
}

// FLOW: 
// 1. Check: "Is the sound system already running?"

// 2. Verify: "Does this browser even support 3D sound?"

// 3. Start: "Turn on the audio processing engine."

// 4. Connect: "Prepare the engine to receive 3D coordinates from the camera later."

// Creates or retrieves the global AudioContext.
// Think of this as turning on the 'Sound Card' for web app.
// AudioContext acts as the master brain that calculates:
//Panning: Is the sound coming from the left speaker or the right speaker?
//Volume Decay: Is the sound quiet because the player is far away?
//The Math: When character move in the code, 
// An AudioListener is actually moving (which belongs to this AudioContext) through 3D space.
// The Coordination: The AudioContext takes the (X, Y, Z) coordinates of character and compares 
// them to the (X, Y, Z) coordinates of a sound source (like a TV or an NPC). It then performs a mathematical 
// "distance formula" calculation to determine how loud the sound should be in 
// player headphones.
function getAudioContext() {
  // If we already created an audio engine, 
  // just return the existing one. Don't create duplicates.
  if (audioContext === null) {
    // 1. Get the correct constructor: use the standard one, 
    //    or the vendor-prefixed one for older Safari/Chrome.
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

    // COMPATIBILITY CHECK: If the browser is very old and doesn't 
    // have either, show an error and stop.
    if (!AudioContextConstructor) {
        console.error("Web Audio API is not supported in this browser.");
        return null;
    }
    // 2. Instantiate the context using the constructor
    audioContext = new AudioContextConstructor();
    console.log("✅ AudioContext initialized.");
  }
  return audioContext;
}

// Fetching audio data from Pinata to audioRawCache then store to
// the audioCache with audioCache is map with key is CID and the value is 
// the audio which already decoded and ready to play
export async function prefetchAudio(audioCID) {
  if (!audioCID) return null;
  // audioRawCache : Store raw sound data get from network. Data format is ArrayBuffer. The
  // data is blob of bytes
  // audioCache: Store decoded sound data as AudioBuffer , which can be efficiently playback by browser
  // and this audioCache is store for long-term so it ready to play at any time without decoding anymore
  if (audioCache.has(audioCID) || audioRawCache.has(audioCID)){
    return;
  } 

  try {
    // Fetching audio from pinata
    const url = `https://${PINATA_URL}${audioCID}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    // Store the fetching audio as array buffer to the audioRawCache 
    const arrayBuf = await response.arrayBuffer();
    audioRawCache.set(audioCID, arrayBuf);

    // Schedule lazy decode (off the main loop)
    requestIdleCallback(async () => {
      try {
        const context = getAudioContext();
        if (!context || audioCache.has(audioCID)) return;
        const buffer = await context.decodeAudioData(arrayBuf.slice(0)); // copy for safety
        audioCache.set(audioCID, buffer);
        audioRawCache.delete(audioCID); // free raw buffer
        console.log(`Audio pre-decoded for ${audioCID}`);
      } catch (err) {
        console.warn(`decodeAudioData failed for ${audioCID}`, err);
      }
    });
    console.log("Finish fetching audio from Pinata for asset: ", audioCID);

  } catch (error) {
    console.error(`Error prefetching ${audioCID}:`, error);
  }
}

export async function playAudio(audioCID) {
  const context = getAudioContext();
  if (!context) return;
  // If there is any sound is playing (track by currentSourceNode) then 
  // stop playing sound
  if (currentSourceNode) {
    try { currentSourceNode.stop(); } catch {}
    currentSourceNode = null;
  }

  // Get decoded audio buffer from the audioCache with corresponding CID
  let buffer = audioCache.get(audioCID);
  // In case decoded audio buffer not yet existed , try to decode the raw audio buffer
  // to the decoded audio buffer to use
  if (!buffer) {
    // Give a second try to prefetchAudio again
    await prefetchAudio(audioCID);
    buffer = audioCache.get(audioCID);
    if (!buffer){
      const raw = audioRawCache.get(audioCID);
      // Check if the audioRawCache has store the raw buffer corresponding to the audioCID
      // If yes , use this raw audio buffer to decode to use 
      // Else call the prefetchAudio() to fetch the raw audio buffer from Pinata and store 
      // to raw audioRawCache then use this raw audio buffer and decode to use 
      if (raw) {
        try {
          buffer = await context.decodeAudioData(raw.slice(0));
          audioCache.set(audioCID, buffer);
          audioRawCache.delete(audioCID);
        } catch (err) {
          console.error(`decodeAudioData failed for ${audioCID}`, err);
          return;
        }
      } else {
        console.warn(`Audio for CID ${audioCID} not prefetched. Wait for prefetch one more time`);
        return;
      }
    }
  }

  // Check if the context is in not running state and wait to activate the context again 
  // so that sound can play normally , prevent playback failure
  // The default state is 'suspended' and this require and interacction between player and the program like 
  // click or pressing to play a sound
  if (context.state !== "running") {
    await context.resume().catch((err) => {console.error("Error resuming AudioContext:", err)});
  }

  const source = context.createBufferSource();
  source.buffer = buffer; // Link the decode audio buffer to the audio source
  // Source is connected to the context.destination which is typically
  // the player's speaker
  source.connect(context.destination); 

  // If sound finish playback , try to disconnect source to free up resources and clear
  // the currentSounceNode to indicate no sound is current playing
  source.onended = () => {
  try { source.disconnect(); } catch {}
    if (currentSourceNode === source) currentSourceNode = null;
    if (typeof onEnded === "function") {
      try { onEnded(); } catch (e) { console.warn("onEnded callback error", e); }
    }
  };

  // source.start() play the decoded audio buffer , which mean it play audio
  // start() take three arguments are: starts(when, offset, duration)
  // pass 0 to the first arguments tell the source to play sound immediately
  // 1. when: the time since now that audio should be played
  // 2. offset: where within the audio clip start playing , E.g: offset = 10 means the 
  // audio should skip the first 10 seconds of the audio and play the last buffers after the
  // first 10 second. 
  //  3. duration: This tell the browswer how long to play the sound
  source.start(0);

  // Assign the currentSourceNode = source to indicate there is sound is playing
  currentSourceNode = source;
}

// This function used to stop playing audio
export function stopAudio() {
    if (currentSourceNode) {
        currentSourceNode.stop();
        currentSourceNode = null;
        console.log("Audio stopped.");
    }
}

// Wait the player to click for the first time to activate the context use for
// playing audio
document.addEventListener("click", () => {
    const context = getAudioContext();
    window.context = context;
    if (context && context.state !== 'running') {
        context.resume().then(() => {
            console.log("AudioContext resumed on user interaction.");
        }).catch(e => console.error("Error resuming AudioContext:", e));
    }
}, { once: true });

  // Helper to convert any URL (KTX2 or Image) to a hidden Blob URL
async function getBlobURL(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Network response was not ok");
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      console.error(`Failed to mask URL: ${url}`, e);
      return url; // If fetch fails, return original as last resort
    }
  };


// NOTE: Make sure ktx2Loader and renderer are defined and accessible in the scope.
// This function is used to set image to ImageMesh mesh
// The image is first try to load the KTX2 to the ImageMesh by using imgURL
// If loading the KTX2 fail then try to load the webP to ImageMesh by using fallbackImageURL
async function setImageToMesh(scene, meshName, imgURL, fallbackImgURL) {
  const textureLoader = new THREE.TextureLoader();

  const applyTexture = (texture) => {
    let mesh = scene.getObjectByName(meshName);
    if (mesh && mesh.isMesh) {
      // Cleanup: Revoke old blob URLs to prevent memory leaks
      if (mesh.material.map && mesh.material.map.image?.src?.startsWith('blob:')) {
        URL.revokeObjectURL(mesh.material.map.image.src);
      }
      if (mesh.material.map) mesh.material.map.dispose();
      if (mesh.material.dispose) mesh.material.dispose();

      // --- DYNAMIC FACE DETECTION ---
      const cameraPosition = new THREE.Vector3();
      camera.getWorldPosition(cameraPosition);
      const meshPosition = new THREE.Vector3();
      mesh.getWorldPosition(meshPosition);
      const vecToCamera = cameraPosition.sub(meshPosition).normalize();
      const meshNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      const dot = meshNormal.dot(vecToCamera);
      let sideToRender = (dot < 0) ? THREE.BackSide : THREE.FrontSide;

      if (meshName === "ImageMesh001") sideToRender = THREE.BackSide;

      mesh.material = new THREE.MeshStandardMaterial({
        map: texture,
        side: sideToRender,
        roughness: 1.0,
        metalness: 0.2,
      });
      mesh.material.needsUpdate = true;
    }
  };

  // --- EXECUTION ---
  
  // 1. Mask the KTX2 URL
  const maskedKTX2 = await getBlobURL(imgURL);

  ktx2Loader.load(
    maskedKTX2,
    (loadedTexture) => {
      console.log(`Success: KTX2 loaded via Blob for ${meshName}`);
      applyTexture(loadedTexture);
    },
    undefined,
    async (error) => {
      console.warn(`KTX2 failed for ${meshName}. Trying masked fallback...`);
      
      // 2. Mask the Fallback URL
      if (fallbackImgURL) {
        const maskedFallback = await getBlobURL(fallbackImgURL);
        textureLoader.load(
          maskedFallback,
          (fallbackTexture) => {
            fallbackTexture.flipY = false;
            applyTexture(fallbackTexture);
            URL.revokeObjectURL(maskedFallback);
          
          }
        );
      }
    }
  );
}

// Completely stops and deletes a video stream to free up memory and internet bandwidth.
async function destroyVideoAndHls(hls, video) {
  try {
    // 1. HLS CLEANUP: HLS.js is the "engine" that handles streaming pieces of video.
    if (hls) {
      // Stop downloading new data from the internet
      try { hls.stopLoad(); } catch (e) {}
      // Disconnect the engine from the <video> tag
      try { hls.detachMedia(); } catch (e) {}
      // Delete the engine instance from memory
      try { hls.destroy(); } catch (e) {}
    }
  } catch (e) {
    console.warn('Error while destroying Hls:', e);
  }

  // 2. VIDEO ELEMENT CLEANUP: The actual HTML5 <video> tag.
  if (video) {
    try {
      video.pause(); // Immediately stop playback sound/visuals
      // 3. MEDIA SOURCE CLEANUP: Just pausing isn't enough. 
      // We must strip the source URL so the browser stops buffering.
      if (video.src) {
        try { video.removeAttribute('src'); } catch (e) {}
      }

      // 4. RESET: Calling .load() after removing the 'src' forces the 
      // browser to flush the video buffer out of the RAM.
      try { video.load(); } catch (e) {}

      // 5. DOM CLEANUP: Remove the invisible video tag from the website's HTML structure.
      if (video.parentNode) video.parentNode.removeChild(video);
    } catch (e) {
      console.warn('Error cleaning video element:', e);
    }
  }
}

// This event is kicked off when:
// 1. The player close the browser tab or window 
// 2. Reload the page
// 3. Click the back/forward buttons 
// 4. Navigate to different website 
// This function is used to totally stop the audio , avoid the audio still play after
// close the tab ; Avoid memory leakage (remove the video decoders and buffers still 
// remain in the memory) ; And save bandwidth (browser not load the video buffers anymore in background)
window.addEventListener('beforeunload', () => {
  if (mesh.userData?.hls || mesh.userData?.videoElement) {
    destroyVideoAndHls(mesh.userData.hls, mesh.userData.videoElement);
  }
});

// Function to set HLS video to mesh 
function setVideoToMeshHLS(scene, meshName, hlsURL) {
  // 1. Find the corresponding mesh by mesh name
  const mesh = scene.getObjectByName(meshName);
  if (!mesh || !mesh.isMesh) {
    console.warn(`❌ Cannot find mesh for ${meshName}`);
    return;
  }

  if(mesh.material) {
    // Dispose old material and texture if they exist
    if (mesh.material.map) {
      mesh.material.map.dispose();
    }
    mesh.material.dispose();
  }

  // 2. CLEANUP: Destroy old HLS instance and video if they exist on this mesh
  if (mesh.userData.hlsInstance) {
    console.log("Cleaning up old HLS instance for:", meshName);
    try {
      // Direct destruction: The mesh 'owns' this instance in its memory (userData).
      mesh.userData.hlsInstance.destroy();
    } catch (e) {
      console.warn("Error destroying old HLS:", e);
    }
    // Set it to null immediately so the next line of code knows the 'slot' is empty.
    mesh.userData.hlsInstance = null;
  }
  
  if (mesh.userData.videoElement) {
    console.log("Removing old video element for:", meshName);
    try {
      const oldVideo = mesh.userData.videoElement;
      oldVideo.pause();
      oldVideo.removeAttribute('src'); // Detach source
      oldVideo.load(); // Force unload
      oldVideo.remove(); // Remove from DOM (though it wasn't attached, good practice)
    } catch (e) {
      console.warn("Error cleaning video element:", e);
    }
    // Disconnect the reference so the Garbage Collector can delete it from RAM.
    mesh.userData.videoElement = null;
  }

  // 3. Create new video element
  const video = document.createElement('video');
  video.autoplay = false; // We control play manually
  video.pause();
  // Needed for spatial audio , set muted so that audio data 
  // can be received by Three.js to handle spatial sound
  video.muted = false; 
  // Good for background videos
  video.loop = true;   
  // Crucial for mobile (iOS). Prevents the iPhone from forcing the video into 
  // "Full Screen Mode" and breaking the 3D view
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.style.display = 'none';

  
  // Store reference for later cleanup
  mesh.userData.videoElement = video;

  // console.log("🎬 HLS URL Base:", hlsURL);

  let hls;
  let masterURL = hlsURL + "/master.m3u8";
  let streamURL = hlsURL + "/stream.m3u8";

  // Sets up the Adaptive Streaming (HLS) for a video texture on a 3D Mesh.
  if (Hls.isSupported()) {
    const hlsConfig = {
      startLevel: 0, // Fast load: starts with the lowest resolution (blurry) and gets clearer later.
      autoStartLoad: true, // Start downloading segments immediately.
      capLevelToPlayerSize: true, // Performance: Don't download 4K video if the 3D screen is tiny.
      lowLatencyMode: false,
      maxBufferLength: 30, // Keep 30 seconds of video ready in memory.
      maxMaxBufferLength: 60,
      maxBufferHole: 0.5,        // GAP REPAIR: If 0.5s of video is missing, skip it instead of freezing.
      nudgeOffset: 0.1,          // If stuck, "push" the video forward by 0.1s.
      nudgeMaxRetry: 10,
      // Multi-threading: Move heavy math to a background process 
      // so the 3D world stays smooth (60fps).
      enableWorker: true,        
    };

    // Load set up to HLS object
    hls = new Hls(hlsConfig);
    mesh.userData.hlsInstance = hls; // Store for cleanup

  
    hls.loadSource(masterURL); // Point to video file
    hls.attachMedia(video); // Connect the HLS logic to the HTML video tag.

    // EVENT: When the video info is ready.
    hls.on(Hls.Events.MANIFEST_PARSED, function() {
      console.log("✅ Manifest parsed, starting playback");
      // Only try to play once manifest is ready
      video.play().catch(e => console.warn("Autoplay prevented:", e));
    });

    hls.on(Hls.Events.ERROR, function (event, data) {
      // Filter out non-fatal buffer errors that hls.js can often recover from automatically
      if (data.details === 'bufferSeekOverHole' || data.details === 'bufferStalledError') {
         console.warn(`⚠️ HLS Buffer Warning: ${data.details}. Attempting auto-recovery.`);
         return; 
      }
      // Handle fatal errors , if the .m3u8 store in Pinata is not master.m3u8 , try to load fallback 
      // file with name is stream.m3u8
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.warn("HLS Network error, trying to recover...");
            // 2. Internet failed: Try to reload the URL.
            if (data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR || data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
                // Try reloading the stream URL on network errors
                if (hls.url != streamURL) {
                  hls.loadSource(streamURL);
                  hls.startLoad();
                }else{
                  console.error("❌ Failed to load HLS stream after master. Destroying instance.");
                }     
            }else{
              hls.startLoad(); // Retry other network errors
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // 3. Decoding failed: The browser got confused by the video data. Fix it.
            console.warn("HLS Media error, trying to recover...");
            hls.recoverMediaError();
            break;
          default:
            // 4. Critical failure: Kill the engine to prevent a memory leak.
            console.error("❌ Unrecoverable HLS error, destroying instance.");
            hls.destroy();
            break;
        }
      }
    });

  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // SAFARI FALLBACK: iPhones/Macs have HLS built-in, so they don't need the HLS.js library.
    video.src = masterURL;
    video.play().catch(e => console.warn("Native play error:", e));
  } else {
    console.error('❌ HLS not supported');
    return;
  }

  // 4. Texture & Material Setup (Only once video has data)
  const onCanPlay = () => {
    console.log("📺 Video has enough data to render texture");
    
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBAFormat; // Use RGBA for safety
    videoTexture.colorSpace = THREE.SRGBColorSpace; // Match renderer setup

    // --- MIRROR Y LOGIC START ---
    // Flip the texture vertically
    videoTexture.wrapS = THREE.RepeatWrapping;
    videoTexture.wrapT = THREE.RepeatWrapping;
    videoTexture.repeat.set(1, -1); // 1 on X (normal), -1 on Y (mirrored)
    videoTexture.offset.set(0, 1);  // Shift the offset so the flipped image aligns with the mesh

    const material = new THREE.MeshBasicMaterial({ map: videoTexture });

    // Clean up old material properties
    if (mesh.material) {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
    }

    mesh.material = material;
    mesh.material.needsUpdate = true;

    // 5. Spatial Audio Setup
    if (!spatialSources.has(meshName)) {
      // Ensure AudioContext is running
      if (audioCtx.state === 'suspended') {
          audioCtx.resume();
      }

      const source = audioCtx.createMediaElementSource(video);
      const panner = audioCtx.createPanner();
      const gain = audioCtx.createGain();

      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 2.0;
      panner.maxDistance = 10.0;
      panner.rolloffFactor = 0.5;
      panner.coneInnerAngle = 360;

      source.connect(panner);
      panner.connect(gain);
      gain.connect(audioCtx.destination);

      // Set initial position
      const pos = mesh.position;
      panner.setPosition(pos.x, pos.y, pos.z);

      spatialSources.set(meshName, { source, panner, gain, video, mesh });
    }
  };

  // Use 'loadedmetadata' or 'canplay' instead of 'canplaythrough' for faster feedback
  video.addEventListener('canplay', onCanPlay, { once: true });
}

// Listen for custom upload events to update annotations
document.body.addEventListener("uploadevent", (event) => {
    const { asset_mesh_name, title, vietnamese_description, english_description, webpCID , assetCID , viet_audio_cid , eng_audio_cid , category } = event.detail;
    
    if (annotationMesh[asset_mesh_name]) {
        annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, vietnamese_description,english_description);
        annotationMesh[asset_mesh_name].title = title;
        annotationMesh[asset_mesh_name].viet_des = vietnamese_description;
        annotationMesh[asset_mesh_name].eng_des = english_description;
        const systemLanguage = localStorage.getItem('language');

        if (category === 'image'){
          annotationMesh[asset_mesh_name].mesh.userData.category = 'Image';
          annotationMesh[asset_mesh_name].mesh.userData.imageSRC = `https://${PINATA_URL}${webpCID}`;
        }else if (category === 'video'){
          annotationMesh[asset_mesh_name].mesh.userData.category = 'Video';
          annotationMesh[asset_mesh_name].mesh.userData.videoSRC = `https://${PINATA_URL}${assetCID}/master.m3u8`;
          annotationMesh[asset_mesh_name].mesh.userData.backup_videoSRC = `https://${PINATA_URL}${assetCID}/stream.m3u8`;
        }
        if (systemLanguage === 'vi'){
          prefetchAudio(viet_audio_cid);
        }else if (systemLanguage === 'en'){
          prefetchAudio(eng_audio_cid);
        }
    }
});

renderer = new THREE.WebGLRenderer({ antialias: true, alpha:true, powerPreference: 'high-performance'});

// DRACO LOADER + KTX2 LOADER 
// Initialize DracoLoader for geometry compression
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');
dracoLoader.setDecoderConfig({ type: 'wasm' });
dracoLoader.preload();

// Initialize KTX2Loader for compressed textures
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('/basis/');
ktx2Loader.detectSupport(renderer);

// Initialize geometric LOD for reduce draw calls 
const lod = new THREE.LOD();
scene.add(lod);

// Main model loader 
const loader = new GLTFLoader(LoadingManager).setPath('/assets/');
loader.setDRACOLoader(dracoLoader);
loader.setKTX2Loader(ktx2Loader);

// Character model loader 
const characterLoader = new GLTFLoader().setPath('/assets/');
characterLoader.setDRACOLoader(dracoLoader);
characterLoader.setKTX2Loader(ktx2Loader);

/**
 * @param {number|null} measuredMbps - The result from measureBandwidth()
 */
function updateDynamicLOD(measuredMbps = null) {
  if (measuredMbps === null) return;
  const mbps = measuredMbps / 1000;
  console.log(`Measured Speed: ${mbps.toFixed(2)} Mbps`);

  // Define speed brackets (Standard for 3D web apps)
  const SPEED_THRESHOLDS = {
    LOW: 10,    // Below 10Mbps (Slow 4G/Weak WiFi)
    MEDIUM: 30, // 10-30Mbps
    HIGH: 50    // Above 50Mbps (Fiber/5G)
  };

  let recommendedBias;

  if (mbps < SPEED_THRESHOLDS.LOW) {
    recommendedBias = LOD_SETTINGS.LOW;
  } else if (mbps < SPEED_THRESHOLDS.HIGH) {
    recommendedBias = LOD_SETTINGS.MEDIUM; 
  } else {
    recommendedBias = LOD_SETTINGS.HIGH;
  }

  // Only update if the new measurement is lower than current setting 
  // (to prevent "flickering" quality if speed fluctuates)
  if (recommendedBias < LOD_SETTINGS.currentBias) {
    console.warn("Downgrading LOD due to measured network speed.");
    LOD_SETTINGS.currentBias = recommendedBias;
  }
  applyTextureLOD(recommendedBias);
}

// applyTextureLODInitial use to set up the material at the initial loadtime 
function applyTextureLOD(mipMapBias) {
    if (!scene || !renderer) return;

    scene.traverse((object) => {
        if (object.isMesh) {
            const material = object.material;
            const materials = Array.isArray(material) ? material : [material];

            materials.forEach(mat => {
                if (mat.map && mat.map.isTexture) {
                    // Just change the bias. This is cheap and happens in the shader/sampler.
                    if (mat.map.mipMapBias !== mipMapBias) {
                        mat.map.mipMapBias = mipMapBias;
                    }
                }
            });
        }
    });
}

// Function to check FPS and adjust LOD accordingly
function checkAndAdjustLOD(currentFPS) {
  let newBias = LOD_SETTINGS.currentBias;
  const BIAS_STEP = 0.5;
  
  // Hysteresis buffers:
  // Drop quality if FPS is consistently bad (< 45)
  // Only improve quality if FPS is consistently great (> 58), not just "okay"
  const UPGRADE_THRESHOLD = 58; 
  const DOWNGRADE_THRESHOLD = 45;

  if (currentFPS < DOWNGRADE_THRESHOLD) {
    // Performance is bad -> Increase bias (blurrier textures, faster render)
    newBias += BIAS_STEP;
  } else if (currentFPS > UPGRADE_THRESHOLD) {
    // Performance is great -> Decrease bias (sharper textures)
    newBias -= BIAS_STEP;
  }

  // Clamp bias between High Quality (0.0) and Low Quality (3.0 or higher)
  newBias = Math.max(0.0, Math.min(newBias, 4.0));

  // Only apply if changed
  if (newBias !== LOD_SETTINGS.currentBias) {
    LOD_SETTINGS.currentBias = newBias;
    applyTextureLOD(newBias);
  }
}

function clearSceneObjects(obj) {
    if (mixer) {
        mixer.stopAllAction();
        mixer = null;
    }
    count = 0;

    if (obj.userData) {
      delete obj.userData.animCtrl;
      delete obj.userData.mixer;
      delete obj.userData.npc;
    }


    if (raycasterManager) raycasterManager.dispose();
    // Iterate backwards to safely remove children
    for (let i = obj.children.length - 1; i >= 0; i--) {
        const child = obj.children[i];
        clearSceneObjects(child);
        obj.remove(child);
    }

    if (obj.geometry) obj.geometry.dispose()    

    if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach(material => {
            if (material) {
                if (material.map) material.map.dispose();
                material.dispose();
            }
        });
    }
    for (const key in doorState){
        doorState[key] = false;
    }
    physiscsReady = false;
    imageMeshesArray = [];
    pictureFramesArray = [];
    currentScene = null;
    playerCollider = null;
    navQuery = null;
    navMesh = null;
    crowd = null;
    fallbackY = Infinity;
    floorMesh = null;
}

function checkPlayerPosition() {
    if (doorBoundingBox && !hasEnteredNewScene && hasLoadPlayer) {
        const playerPosition = fpView.getPlayerPosition();
        if (doorBoundingBox.distanceToPoint(playerPosition) < 4 && doorState[interactedDoor]) {
            hasEnteredNewScene = true;
            const nextMuseum = currentMuseumId === Museum.ROOM1 ? Museum.ROOM2 : Museum.ROOM1;
            setMuseumModel(nextMuseum);
        }
    }
}

function checkCurrentPosition() {
  let playerPosition = null;
  let playerQuaternion = null;
  let player = null;
  const video = document.getElementsByName("video")
  video.autoplay = false;

  if (activePlayer === 'tp' && tpView) {
    player = tpView
    playerPosition = tpView.getPlayerPosition();
    playerQuaternion = tpView.getPlayerQuaternion();
  } else if (activePlayer === 'fp' && fpView) {
    player = fpView
    playerPosition = fpView.getPlayerPosition();
    playerQuaternion = fpView.getPlayerQuaternion();
  }

  if (playerPosition && playerQuaternion) {
    listener.setPosition(playerPosition.x, playerPosition.y, playerPosition.z);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(playerQuaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(playerQuaternion);

    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

const lastAudioPos = new THREE.Vector3();
const lastAudioQuat = new THREE.Quaternion();

// This function is used to update spatial audio 
function updateSpatialAudio(scene) {
  // Check if camera moved enough to warrant an update
  if (camera.position.distanceToSquared(lastAudioPos) < 0.01 && 
      camera.quaternion.angleTo(lastAudioQuat) < 0.01) {
      return; 
  }

  // Update cache
  lastAudioPos.copy(camera.position);
  lastAudioQuat.copy(camera.quaternion);

  // Update listener (player position)
  checkCurrentPosition();

  // Define the distance at which audio should start playing
  const AUDIO_PLAY_DISTANCE = 5.0; // meters

  // Iterate through all spatial sources
  for (const [meshName, node] of spatialSources.entries()) {
    // Destructure 'video' from the node
    const { panner, mesh, video } = node; 
    if (!mesh) continue;

    const pos = mesh.position;
    panner.setPosition(pos.x, pos.y, pos.z);

    // Orientation logic
    if (mesh.rotation) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      panner.setOrientation(fwd.x, fwd.y, fwd.z);
    }

    // --- 🔊 DISTANCE CHECK LOGIC ---
    const lastExitTimes = {}; 

    if (video) {
      const distance = camera.position.distanceTo(pos);
      const meshID = mesh.uuid; // Use unique ID for the mesh

      if (distance <= AUDIO_PLAY_DISTANCE) {
          if (video.paused) {
              // Check how long they have been gone
              const timeSinceExit = (Date.now() - (lastExitTimes[meshID] || 0)) / 1000; // seconds
              
              // If they were gone for more than 5 seconds, restart. 
              // Otherwise, just continue.
              if (timeSinceExit > 5.0) {
                  video.currentTime = 0;
              }
              
              video.play().catch(e => {});
          }
      } else {
          if (!video.paused) {
              video.pause();
              // Record exactly when they left
              lastExitTimes[meshID] = Date.now();
          }
      }
    }
  }
}

function updatePropVisibility() {
    // Only run this check every 30 frames (0.5 seconds)
    if (LOD_SETTINGS.frames % 30 !== 0) return;

    const maxDistSq = 8 * 8; // 40 meters squared

    // Iterate over detailed objects (pictureFramesArray)
    for (const frame of pictureFramesArray) {
        const distSq = frame.position.distanceToSquared(camera.position);
        
        // If FPS is struggling (<45), hide distant frames aggressively
        const effectiveDist = LOD_SETTINGS.currentBias > LOD_SETTINGS.MEDIUM ? 2 * 2 : maxDistSq;
        
        frame.visible = distSq < effectiveDist;
    }
}

// applyTextureLODInitial use to set up the material at the initial loadtime 
function applyTextureLODInitial(material , mipMapBias){
  if (!material || !renderer || !renderer.capabilities) return;
  if (material.map && material.map.isTexture) {
    // Check if the texture is a KTX2/compressed texture (by format)
    if (material.map) {
        material.map.mipMapBias = mipMapBias;
        
        // Also adjust anisotropy (texture filtering quality)
        // Lower bias for high quality, higher bias for performance
        material.map.anisotropy = (mipMapBias > 0) ? 4 : renderer.capabilities.getMaxAnisotropy();
        material.map.needsUpdate = true;
    }
  }
}

function tuneMaterial(material) {
    if (!material) return null; 

    // --- Force upgrade non-PBR materials (MeshBasic, Lambert, etc.) ---
    if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) {
        material = new THREE.MeshStandardMaterial({
            map: material.map || null,
            color: (material.color && material.color.clone()) || new THREE.Color(0xffffff),
            roughness: 1.0,
            metalness: 0.0,
            transparent: !!material.transparent,
            opacity: material.opacity !== undefined ? material.opacity : 1.0,
        });
    }

    // --- Ensure shadows are enabled ---
    material.shadowSide = THREE.FrontSide;
    material.needsUpdate = true;

    // Clamp safe values
    if (material.roughness !== undefined) {
        material.roughness = Math.min(Math.max(material.roughness, 0.0), 1.0);
    }
    if (material.metalness !== undefined) {
        material.metalness = Math.min(Math.max(material.metalness, 0.0), 1.0);
    }

    // Scene environment reflection
    if ('envMapIntensity' in material) {
        material.envMapIntensity = 0.5;
    }

    // ✅ Important: use DoubleSide for user models/art (FrontSide is only needed for the shadow fix above)
    material.side = THREE.DoubleSide;

    // Update all maps
    const mapNames = ['map', 'emissiveMap', 'aoMap', 'metalnessMap', 'roughnessMap', 'normalMap', 'bumpMap'];
    
    // --- LOD INTEGRATION START ---
    const currentBias = LOD_SETTINGS ? LOD_SETTINGS.currentBias : LOD_SETTINGS.MEDIUM;
    const anisotropy = (currentBias > 0) ? 4 : renderer.capabilities.getMaxAnisotropy();
    // --- LOD INTEGRATION END ---

    for (const name of mapNames) {
        const texture = material[name];
        if (!texture) continue;

        if (name === 'map' || name === 'emissiveMap') {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else {
            texture.colorSpace = THREE.LinearSRGBColorSpace;
        }

        // --- DYNAMIC LOD/PERFORMANCE APPLICATION ---
        // Apply the dynamic mipmap bias based on current FPS/network conditions
        if (texture.isTexture) {
          texture.mipMapBias = LOD_SETTINGS.currentBias;
          texture.anisotropy = Math.min(4,renderer.capabilities.getMaxAnisotropy());
        }
        // -------------------------------------------

        texture.minFilter = THREE.LinearMipMapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
    }

    if (material.normalMap && !material.normalScale) {
        material.normalScale = new THREE.Vector2(1, 1);
    }

    applyTextureLODInitial(material , currentBias);

    return material;
}

// ENSURE UV2 EXISTS FOR AO/LIGHTMAPS IF AO MAPS ARE PRESENT
// In 3D graphics, a mesh can have multiple sets of coordinates (UVs) that tell textures 
// how to wrap around the object.
// UV1 (uv): Used for the main color/diffuse texture.
// UV2 (uv2): Used by Three.js specifically for Shadow Maps and Ambient Occlusion textures.
function ensureUV2ForAO(geometry) {
  if (!geometry) return;
  if (!geometry.attributes.uv2 && geometry.attributes.uv) {
    geometry.setAttribute('uv2', geometry.attributes.uv);
  }
}

// This function is used to init NPC
// navQuery is the search engine of the walkable floor detect by the navmesh
export function initNPC(scene, navQuery, bvhMeshes) {
  // If the navQuery is not find , raise warning to warn the NPC maybe cannot move correctly
  if (!navQuery) {
    console.warn("initNPC: Nav query not ready yet — NPC init may fail.");
  }

  // Clone base character model
  // SkeletonUtils allow to clone both the model and create the bone of character itself
  // so that the animation of this npcModel is seperate from the origin model
  const npcModel = SkeletonUtils.clone(characterModel);

  // Create debug wire frame material to debug the NPC
  const debugWireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00, // Bright green so it's highly visible
      wireframe: true
  });

  // Traverse through the NPC model to apply the wireframe texture
  // npcModel.traverse((child) => {
  //   if (child.isMesh) {
  //     child.castShadow = true;
  //     child.receiveShadow = true;
  //     if (Array.isArray(child.material)) {
  //       child.material = child.material.map(() => debugWireframeMaterial);
  //     } else {
  //       // child.material = tuneMaterial(child.material);
  //       child.material = debugWireframeMaterial;
  //     }
  //   }
  // });

  // If the model which npcModel choose to clone is ready and finish load 
  if (characterGLTF) {
    // reuse the same animation controller as TP player
    const npcAnimation = createAnimController(npcModel, characterGLTF);
    npcModel.animationCtrl = npcAnimation;
    npcModel.userData.animCtrl = npcAnimation;
    npcModel.animCtrl = npcAnimation;
    // Activate the idel animation immediately 
    if (npcAnimation && npcAnimation.idleAction) {
      npcAnimation.idleAction.play();
    }
  
    // when creating NPC model (host side)
    // ensure name is unique, e.g. 'NPC_tour_1' or use timestamp
    npcModel.name = `NPC_tour_${Date.now().toString(36).slice(-6)}`;
    // npcModel.userData.tourId =  npcModel.name;
  }

  // Spawn the npcModel at a position with the coordination
  // x: 0.5 
  // y: 0
  // z: 0.5
  npcModel.position.set(0.5, 0, 0.5);

  // Add npcModel to scene
  scene.add(npcModel);

  // --- compute an automatic footOffset if not provided by importer ---
  if (typeof npcModel.userData.footOffset !== 'number') {
    try {
      // bbox is bounding box, this will try to create smallest box that npcModel can 
      // fit inside
      const bbox = new THREE.Box3().setFromObject(npcModel);
      // bbox.min.y is where the lowest vertex sits in world-space or the absolute lowest point of the character (the sole of the shoes)
      // We want footOffset so model sits on top of ground when we set model.position.y = floorY + footOffset
      // If the model's root is at 0 then bbox.min.y is negative and -bbox.min.y gives the distance from root to foot.
      // Most model has the anchor point at the center is (0,0,0) , this point normally stay at the waist (eo) of character
      // Thefore we need to increase the vertical position (y value) to a value is - (modelMinY) , which
      // give us positive value and thefore the whole model is increase and foot can touch the floor. 
      const modelMinY = bbox.min.y;
      // the modelMinY always has minus Y value so that we minus this to get the positive 
      // y coordinate value to add up and increase the position of the waist of character model
      // to higher position , which leads to the y coordinate of the foot increase as well and can touch
      // the floor
      npcModel.userData.footOffset = -modelMinY;
      // console.debug('initNPC: auto footOffset computed:', npcModel.userData.footOffset);
    } catch (e) {
      npcModel.userData.footOffset = 0;
      // console.warn('initNPC: failed to compute auto footOffset, using fallback 0', e);
    }
  }

  // --- initial vertical snap: prefer navmesh projection (so agent starts on navmesh) ---
  const footOffset = npcModel.userData?.footOffset ?? 0.0001;
  let snapped = false;
  let navY = null;
  let floorY = null;

  if (navQuery) {
    try {
      // Ask the navmesh about the neaerest walkable position
      const np = navQuery.findClosestPoint({
        x: npcModel.position.x,
        // By adding footOffset, the program correctly tell the 
        // navquery to exactly find the walkable path on the floor
        // This y is not apply to the npcModel , just used to find 
        // walkable path on the floor
        y: npcModel.position.y + footOffset, // check near the feet , this act as floor height
        z: npcModel.position.z,
      });
      if (np?.point) {
        navY = np.point.y;
        npcModel.position.y = np.point.y + footOffset + 1e-3; // put the npcModel immediately stay on the floor 
        snapped = true;
      }
    } catch (e) {
      console.warn("initNPC: navQuery.findClosestPoint failed:", e);
    }
  }

  // Also do a BVH down-ray now to get the ground Y (so we can compute nav→floor offset)
  if (bvhMeshes?.length) {
    try {
      const downRay = new THREE.Raycaster(
        // Starting point of the laser beam is set up to 1m (the add function)
        // By raising the laser to 1 , this can help avoid the laser near the feet 
        // which might be touching floor already and the lasert start inside the floor 
        // so that the result is fail to detect floor correctly
        npcModel.position.clone().add(new THREE.Vector3(0, 1.0, 0)),
        // y has value of -1 here mean that it will start to shoot a line straght down
        // from 1 meter about NPC to detect the floor
        new THREE.Vector3(0, -1, 0)
      );
      const hits = downRay.intersectObjects(bvhMeshes, true);
      if (hits.length > 0) {
        floorY = hits[0].point.y;
        // If we didn't snap via navQuery above, snap now to BVH hit
        if (!snapped) npcModel.position.y = floorY + footOffset + 1e-3;
      }
    } catch (e) {
      console.warn('initNPC: BVH down-ray failed:', e);
    }
  }

  // store the difference floorY - navY (fallback) so we can use it if per-frame BVH ray misses
  npcModel.userData.navMeshToFloorOffset = (typeof floorY === 'number' && typeof navY === 'number') ? (floorY - navY) : 0;
  // console.debug('initNPC: navY, floorY, navMeshToFloorOffset', navY, floorY, npcModel.userData.navMeshToFloorOffset);

  // Register this NPC as a crowd agent
  try {
    // Try to find an existing agent already tied to this model (prevents duplicates)
    if (typeof getAgents === "function") {
      // 2. GET LIST: Get a list of every AI agent currently active in the room.
      const agentsMap = getAgents();
      if (agentsMap && typeof agentsMap.values === "function") {
        // 3. LOOP: Look at every active agent one by one.
        for (const val of agentsMap.values()) {
          // 4. FIND THE OWNER: Each agent usually has a reference to the 3D model it controls.
          // This line looks into the 'backpack' (userData) to find the model.
          const candidateModel = (val && val.userData && val.userData.model) ? val.userData.model : (val && val.model) ? val.model : null;
          if (candidateModel === npcModel) {
            // 6. REUSE: Instead of making a new brain, just grab the existing one.
            agent = (val && val.agent) ? val.agent : (val && val.agentIndex != null ? val : null);
            // console.debug("initNPC: found existing crowd agent for model, skipping addAgent");
            break;
          }
        }
      }
    }
  } catch (e) {
    console.warn("initNPC: getAgents probe failed:", e);
  }

  // Only add an agent if one wasn't found
  if (!agent) {
    if (typeof addAgent !== "function") {
      console.error("initNPC: addAgent() not available to register NPC as crowd agent.");
      return null;
    }

    // 2. NETWORK SYNC SETUP: Clear any external position/rotation data.
    // This ensures the AI starts fresh and isn't being 'pulled' by old data from a server.
    npcModel.userData.externalPos = null ;
    npcModel.userData.externalQuat = null;

    // 3. REGISTRATION: This creates the actual 'Agent' (the AI logic).
    agent = addAgent(
      npcModel.position,
      {
        // PHYSICAL BOUNDS
        radius: 0.35,
        height: 2.0,
        // MOVEMENT PHYSICS
        maxAcceleration: 20.0,
        maxSpeed: 20.0,
        // STEERING LOGIC
        separationWeight: 0, // How much it tries to stay away from others
        collisionQueryRange: 0.5, // How far ahead it looks for obstacles.
        pathOptimizationRange: 90, // How far it looks to 'smooth out' its walking path.
      },
      { model: npcModel , remoteControlled: false}
    );
  }

  // if agent created/obtained, ensure the agent and model are mutually linked
  if (!agent) {
    console.error("initNPC: Failed to add NPC as crowd agent.");
    return null;
  }

  try {
    // Some crowd implementations use agent.userData, some attach metadata on Map value.
    agent.userData = agent.userData || {};
    agent.userData.model = npcModel;

    // Also ensure the map entry has userData 
    try {
      // 1. SYSTEM SYNC: Verify the crowd manager is accessible
      if (typeof getAgents === "function") {
        const agentsMap = getAgents();
        if (agentsMap && typeof agentsMap.values === "function") {
          // 2. SEARCH: Find the specific entry in the crowd system for corresponding agent to this NPC
          for (const val of agentsMap.values()) {
            if (val && (val.agent === agent || val.agent?.agentIndex === agent.agentIndex)) {
              val.userData = val.userData || {};
              val.userData.model = npcModel;
              break;
            }
          }
        }
      }
    } catch (_) { /* non-fatal */ }

    // guarantee model auto-update so position changes from code are visible immediately
    npcModel.matrixAutoUpdate = true;
  } catch (e) {
    console.warn("initNPC: linking agent <-> model failed:", e);
  }

  console.info("initNPC: NPC initialized as crowd agent", agent, "at", npcModel.position);


  return { model: npcModel, agent, walkSpeed: 2.6, runSpeed: 6.0, state: { mode: 'idle' }, requestedGait: null };
}

// This function set player follow the NPC in the room tour mode
function setPlayerFollowTarget(playerAgent, npc, navQuery) {
  if (!playerAgent || !npc || !npc.model || !npc.agent || !navQuery) return;

 // First try to clone the NPC model position
  const npcPos = npc.model.position.clone();

  // NPC forward & right (world-space, flattened Y)
  // forward mean that Z move into the screen and . In Three.js , even though 
  // the convention state that the Z should have the value of -1 to point inward the screen
  // which mean that it move far from camera but when the model is exported from Blender , the 
  // Z is export as position Z , therefore the forward vector has Z is 1 rather than -1. At this time
  // we directly tell the character nove in direction its nose is pointing
  let forward = new THREE.Vector3(0, 0, 1);
  try {
    // Re-defined the forward vector so that the player can correctly move forward
    // First we copy the npc.model.position to a new THREE.Vector3() object 
    // Then we set this Y coordinate to 0 , the reason is when we move , we just move 
    // forward , we do not want eacch time it move , the Y will move 
    // as well. For example if npc.model.position is (0.5 , 0.5 , 0.5) then without set Y to 0 , 
    // each time we move forward , this will immediately increase Y to 0.5 and make the character
    // move up by 0.5  

    // The normalize() function is used to normalize the speed of the character 
    // By normalize() the vector , we try to convert the vector to the unit vector ,
    // mean that vector length is always equal 1 and therefore the movement speed of 
    // the character will never too fast or too low due to the position change when it moving
    forward = npc.model.getWorldDirection(new THREE.Vector3()).setY(0).normalize();

    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  } catch (e) { forward.set(0, 0, 1); }

  // Define the vector to move right 
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();

  // tuning: how far to the side and small back offset if needed
  const offsetSide = 1.0;   // Try 0.6-0.9 for closer/further
  const offsetBack = 0.12;  // small backward so TP doesn't clip the NPC front

  // prefer existing followSide, fallback to 'right'
  const preferredSide = (tpView && tpView.followSide === 'left') ? -1 : 1;
  const candidatesOrder = [preferredSide, -preferredSide]; // try preferred first

  // compute NPC nav start for path checks
  const npcNavProj = navQuery.findClosestPoint({ x: npcPos.x, y: npcPos.y, z: npcPos.z });
  const startForPath = (npcNavProj && npcNavProj.point) ? npcNavProj.point : { x: npcPos.x, y: npcPos.y, z: npcPos.z };

  // This function is to validate if there is a valid path to the destination
  function candidateIsValid(candidateWorldPos) {
    // 1) Find the closest point from the candidateWorldPos, which is the destination
    const proj = navQuery.findClosestPoint({ x: candidateWorldPos.x, y: candidateWorldPos.y + 1.0, z: candidateWorldPos.z });
    if (!proj?.point) return null;
    const navPt = proj.point;

    // 2) Path check (short path from NPC to candidate)
    // This checking process is to ensure there is a real valid path 
    // from the current desitnation of character to the destination
    // The reason we need the computePath() is to avoid the character try 
    // move inside wall or obstacles. If there is no valid path from the current position 
    // of the character (player agent) then try to return and prevent weird moving from playerAgent
    try {
      const pathRes = navQuery.computePath(startForPath, { x: navPt.x, y: navPt.y, z: navPt.z });
      if (!pathRes || !pathRes.success) return null;
    } catch (e) {
      return null;
    }
    
    // 3) BVH raycast: ensure there's no solid geometry blocking the straight line
    try {
      // Find the moving direction ( forward / backward )
      // In math: TARGET - START = DIRECTION
      // setY(0) so that we just care about the horizontal obstacles , which is the real 
      // obstacle the agent may encounter while moving in defined path
      const dir = candidateWorldPos.clone().sub(npcPos).setY(0);

      // By calculate dist , we are measuring the distance between the 
      // playerAgent to the npc position
      const dist = dir.length();
      // If the dist very small mean that the playerAgent already reach the destination beside the 
      // NPC. We return immediately
      if (dist < 1e-4) return null;

      // Try to normalize the dir vector 
      dir.normalize();

      // By shooting a ray from the npc waist / knee , we use this to determine 
      // if there is any obstacles on the path to the destination 
      const rayOrigin = npcPos.clone().add(new THREE.Vector3(0, 1.0, 0)); // ray from knee / waist height

      // CONFIGURE : 
      // 1. 0.02 is near , mean that laser starts 2cm away from the NPC. This prevents laser from
      //  hitting NPC's own body
      // 2. dist - 0.05 is far, mean that laser will stop 5cm before the target, this prevents laser
      // from hitting a wall that the target point is right next to 
      const ray = new THREE.Raycaster(rayOrigin, dir, 0.05, dist - 0.1);
      const hits = ray.intersectObjects(bvhMeshList, true);
      if (hits.length > 0) {
        // blocked by geometry
        return null;
      }
    } catch (e) {
      // ignore ray errors, prefer path success
    }
    return navPt; // valid nav point
  }

  // Try preferred side then the other side
  for (const mult of candidatesOrder) {
    const cand = npcPos.clone()
      .add(right.clone().multiplyScalar(offsetSide * mult))
      .add(forward.clone().multiplyScalar(-offsetBack));
    const validNavPt = candidateIsValid(cand);
    if (validNavPt) {
      // set player's crowd-agent to that nav point
      setAgentTarget(playerAgent, validNavPt, navQuery, { entry: null, requestedGait: 'walk' });
      // update tpView.followSide properly so later decisions prefer this side
      if (tpView) tpView.followSide = (mult === -1 ? 'left' : 'right');
      return;
    }
  }

  // Fan fallback: sample a few angles around NPC to find any reachable side near-by
  // This code is intelligence search for the stop position of the playerAgent when follow NPC 
  // This is backup code for the above for loop , the purpose is to find a position that playerAgent 
  // can stand in the case scene has complicated corner and it fail to find the validate point to stand 
  // with the prefered offsetBack and offsetSide 
  // Define possible rotate angles
  const fanAngles = [Math.PI/6, -Math.PI/6, Math.PI/4, -Math.PI/4, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2];
  for (const a of fanAngles) {
    // First this take direction of NPC is facing using forward.clone() then rotate an angle "a" degress
    // on the Y axis by calling the applyAxisAngle(new THREE.Vector(0,1,0) , a)
    const rotated = forward.clone().applyAxisAngle(new THREE.Vector3(0,1,0), a);

    // Define the candidate coordinate , the position that playerAgent want to stand 
    const cand = npcPos.clone().add(rotated.multiplyScalar(offsetSide));
    const validNavPt = candidateIsValid(cand);
    if (validNavPt) {
      setAgentTarget(playerAgent, validNavPt, navQuery, { entry: null, requestedGait: 'walk' });
      // set followSide relative to right vector sign
      if (tpView) {
        const rel = Math.sign(right.dot(cand.clone().sub(npcPos)));
        tpView.followSide = (rel < 0 ? 'left' : 'right');
      }
      return;
    }
  }

  // final fallback: keep the TP agent very close to the NPC (snap to NPC nav point)
  try {
    const npcPt = navQuery.findClosestPoint({ x: npcPos.x, y: npcPos.y + 1.0, z: npcPos.z });
    if (npcPt?.point) setAgentTarget(playerAgent, npcPt, navQuery, { entry: null, requestedGait: 'walk' });
  } catch (e) {}
}

// This function is used to create loading progress animatino
function animateProgress() {
  if (currentProgress < targetProgress) {
    // Maximum speed per frame (e.g. ~0.5% per frame at 60fps = ~30%/s)
    const maxStep = 0.2;

    // Difference between target and current
    const diff = targetProgress - currentProgress;

    // Step is either easing or capped speed
    const step = Math.min(diff * 0.05, maxStep);

    currentProgress += step;

    const loaderElement = document.getElementById('loader-container');
    const percentageElement = document.getElementById('loader-percentage');

    const fill = 100 - currentProgress;

    if (loaderElement) {
      loaderElement.style.setProperty('--fill', `${fill}%`);
    }
    if (percentageElement) {
      percentageElement.textContent = `${Math.round(currentProgress)}%`;
    }

    requestAnimationFrame(animateProgress);
  } else {
    // Snap exactly when reached
    currentProgress = targetProgress;
    const loaderElement = document.getElementById('loader-container');
    const percentageElement = document.getElementById('loader-percentage');
    const fill = 100 - targetProgress;

    if (loaderElement) {
      loaderElement.style.setProperty('--fill', `${fill}%`);
    }
    if (percentageElement) {
      percentageElement.textContent = `${Math.round(targetProgress)}%`;
    }
  }
}

// --------- helper: compute nav path length (meters) ----------
function computeNavPathLength(navQuery, startPoint, endPoint) {
  if (!navQuery || !startPoint || !endPoint) return 0;
  try {
    const res = navQuery.computePath(startPoint, endPoint);
    if (!res || !res.success || !res.path || res.path.length < 2) return 0;
    // path entries can be {x,y,z} objects or arrays
    const pts = res.path.map(p => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i-1]);
    return len;
  } catch (e) {
    console.warn('computeNavPathLength failed:', e);
    return 0;
  }
}


function measureBandwidth(enlapsedTime , totalBytes){
  const totalLoadTime = enlapsedTime / 1000 // Convert from ms to s
  const bandWidth = (totalBytes / 1048576) * 8 / totalLoadTime // 1MByte = 1024 * 1024 Bytes ; 1Byte = 8bits
  return bandWidth;
}

// This function is used to loadModel 
async function loadModel() {
  // Clear all the instance and free up memory before load model
  // This is good if we want to switch to new model
  if (fpView) {
      hasLoadPlayer = false;
      fpView.dispose();
      fpView = null;
  }
  annotationMesh = {};
  clearSceneObjects(scene);

  // softer, not washing out shadows
  ambientLight = new THREE.AmbientLight(0xf0f0f0, 0.2);
  scene.add(ambientLight);

  // hemisphere for ambient sky/ground tint
  hemiLight = new THREE.HemisphereLight(0xf0f0f0, 0xf4e7a4, 0.6);
  hemiLight.color.setHSL(0.138, 0.78, 0.92);    
  hemiLight.position.set(0, 20, 0);
  scene.add(hemiLight);

  // Shadow-casting sun
  sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(6, 10, 6);
  sun.shadow.mapSize.set(2048,2048);
  sun.castShadow = true;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far  = 40;
  sun.shadow.camera.left   = -30;
  sun.shadow.camera.right  =  30;
  sun.shadow.camera.top    =  30;
  sun.shadow.camera.bottom = -30;
  // This push the shadow a little bit far away from the surface which 
  // receive shadow so it not create weird black stripes on the surface
  sun.shadow.bias = 0.001
  // Ask the computer not recalculate the shadow for each frame until there is requirement
  // due to the high GPU resource waste, this force GPU always calculate new shadow
  // each frame and therfore increase the workload of GPU and cause lag 
  // This force the renderer engine to compute the shadow correctly once time when scene
  // is load and then remember to the cache so it can reduce the GPU load when re-calculate the
  // shadow again 
  renderer.shadowMap.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target); 


  // Apply environment map so that the texture reflection 
  // lool more real 
  // PMREM stands for Prefiltered Mipmapped Radiance Environment Map 
  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();
  new EXRLoader().load('/assets/HDRI_1.exr', (exrTex) => {
      const envMap = pmremGen.fromEquirectangular(exrTex).texture;
      scene.environment = envMap;
      // scene.background = envMap; // optional
      // Due to the large size of EXR file, we need to need to remove it 
      // after the scene already apply this EXR so that it not waste RAM
      exrTex.dispose();
      pmremGen.dispose();
  });

    // const pmremGen = new THREE.PMREMGenerator(renderer);
    // pmremGen.compileEquirectangularShader();

    // new RGBELoader().load('/assets/HDRI_3.hdr', (hdrTex) => {
    // const envMap = pmremGen.fromEquirectangular(hdrTex).texture;
    // scene.environment = envMap;
    // scene.background = envMap; // optional
    // hdrTex.dispose();
    // pmremGen.dispose();
    // });

    // scene.background = new THREE.Color("#f0f0f0"); // Set a neutral background color


  try {
    // MEASURE BANDWIDTH
    let  startTime = new Date().getTime();
    let totalLoadedBytes = 0;

    // --- CONCURRENCY LOADING ---
    // Due to the single-threaded of JS, we just can load the model in concurrent way 
    // but not really parrallel, however, this still good because we can make use of the 
    // concurrent load to optimize the speed of model loading and using Promise.all also 
    // allow us to prevent the game load wrong ( like lack character model / fail fetching 
    // assets ) since Promise.all can handle this case if any part of Promise fail to load 

    // 1. Create a promise for the model load. To make use the power of Promise 
    // which allow concurrently load , we will use loadAsync 
    const loadModelPromise = new Promise((resolve, reject) => {
    // Use the GLTFLoader instance from game logic.
        loader.load(
            ModelPaths[currentMuseumId],
            (gltf) => {                    
                // Set target to 100 and start animation
                targetProgress = 100;
                animateProgress();
                resolve(gltf);
                const endTime = performance.now();
                const elapsed = endTime - startTime;
                // Calculate real speed
                const currentSpeed = measureBandwidth(elapsed, totalLoadedBytes);
                
                // Dynamically adjust LOD for the rest of the session
                updateDynamicLOD(currentSpeed);
            },
            (xhr) => {
                // This callback fires multiple times as the file loads.
                if (xhr.lengthComputable && xhr.total > 0) {
                    totalLoadedBytes = xhr.total;
                    // Cap the visual progress at 90% while the file is transferring.
                    targetProgress = (xhr.loaded / totalLoadedBytes) * 100;
                    // Adjust the horizontal background position for a wave effect
                    backgroundPositionX = Math.sin(xhr.loaded * 0.05) * 5; 
                    // Kick off or continue the animation loop.
                    animateProgress();
                }
            },
            (err) => console.error("Get error while loading museum model: ", err)
        );
    });


    // 2. Create a promise for the API call to fetch all assets (images / videos)
    const getAssetsPromise =  GetRoomAsset(currentMuseumId);

    // 3. Load third view character using loadAsync to make use of concurrently load 
    // characteristic of Promise
    const loadModelCharacterPromise = characterLoader.loadAsync('optimizedModel/ANIMATED_1.glb');

    // 3. Wait for BOTH promises to complete simultaneously.
    const [gltf, items , char_gltf] = await Promise.all([loadModelPromise , getAssetsPromise , loadModelCharacterPromise]);

    // Assign gltf file for character 
    characterGLTF = char_gltf;
    characterModel = char_gltf.scene;
    characterModelReady = true;

    if (tpView) {
        tpViewExisted = true;
        tpViewLoadLate = false;
        tpView.handleAnimation(characterModel, characterGLTF);
        console.info("Finish handling character model.");
    } else {
        tpViewExisted = false;
        tpViewLoadLate = true;
        character = { model: characterModel, gltf: characterGLTF };
    }

    // Clear map before use 
    AssetDataMap.clear()
    // Loop through each of items of items objects and then extract the data with 
    // the key is the image mesh name and value is corresponding asset for that image mesh
    for (const item of items){
      AssetDataMap.set(item.asset_mesh_name , item)
    }

    // let URL = "QmV55VNUfsGpCqv18Ak2B2VMHRxpaeupFedBMBJQVZ61zq"
    // await prefetchAudio(URL)
    // playAudio(URL)


    // --- SCENE SETUP (executes after all assets are downloaded) ---
    // Add gltf.scene to the scene so the museum model is rendered
    scene.add(gltf.scene);
    currentScene = gltf.scene;
    animation = gltf.animations;
    // Create new mixer instanc, which support for playing animation in scence
    mixer = new THREE.AnimationMixer(gltf.scene);

    // Apply texture tune to character model 
    // Set up character model so that it can cast shadow ( display shadow on the floor and
    // other mesh )

    if(characterModel){
        characterModel.traverse((child) => {
        child.castShadow = true;
        if (child.isMesh){
          child.material = tuneMaterial(child.material)
          // 1. Remove 'color' attribute if the material doesn't use vertex colors
          // This saves GPU memory if the GLTF exported with colors but not use them.
          if (child.geometry.attributes.color && !child.material.vertexColors) {
              child.geometry.deleteAttribute('color');
          }
          if (child.geometry.attributes.tangent && !child.material.normalMap) {
            child.geometry.deleteAttribute('tangent');
          }
          // Remove normals if the material doesn't respond to light
          if (child.geometry.attributes.normal && child.material.isMeshBasicMaterial) {
              child.geometry.deleteAttribute('normal');
          }
        }else{
          return;
        }
      });
    }
    /**
     * PROCESS SCENE GEOMETRY
     * 1. Identify NPC Tour Targets via naming convention (_NPC_Target).
     * 2. Setup Physics & Navigation: Build BVH list and define NavMesh Walkable/Obstacle areas.
     * 3. Optimize Geometry: Delete unused vertex colors/tangents and compute bounding boxes.
     * 4. Material Tuning: Apply custom shaders/textures and ensure UV2 for Ambient Occlusion.
     * 5. Feature Detection: Identify floor for fallback positioning and picture frames for interactive tours.
     * 6. UI Interaction: Attach CSS2D annotations/labels to ImageMeshes for user interaction.
    */
    gltf.scene.traverse((child) => {

      // Update matrix world 
      child.updateMatrixWorld(true);

      // Mapping the Plain axe ( Tour target ) with corresponding Picture Frame 
      if (child.name.endsWith('_NPC_Target')) {
        let frameName = child.name.replace('_NPC_Target', '');
        // Use a specific regex to handle the CubeXXX001 case
        const match = frameName.match(/^(PictureFrame)(\d{3})$/);
        // If a match is found, reformat the name
        if (match) {
            // console.log(`frameName: ${frameName} - Match: ${!!match}`)
            console.log(`${match[1]} - ${match[2]}`)
            const base = match[1]; // 'Cube'
            const num = match[2]; // 1
            frameName = `${base}${num}`;
        }
        tourTargetsMap.set(frameName, child);
        // debug: print so we know the empties were found
        // const worldPos = new THREE.Vector3();
        // child.getWorldPosition(worldPos);
        // console.log('Found TourTarget:', child.name, '=> maps to', frameName);
      }
       
      // Set child to receive shadow from other objects
      child.receiveShadow = true;
      
      // This check for the material of child and then tune the material 
      // The array is used here to check if one child have multiple materials
      // E.g: A "House" mesh where the "Window" part and the "Brick" part are different materials 
      // but part of the same object.
      if (Array.isArray(child.material)) {
          child.material = child.material.map(tuneMaterial);
      } else {
          child.material = tuneMaterial(child.material); 
      }

      // Check UV2 for child. This is neccessary because THREE.js MeshStandardMaterial
      // is hard-coded to look for an attribute named uv2 to render aoMap (shadow texture)
      // If the model is exported with aomap but explicitly not create second UV channel, the 
      // shadows simply wont't appear or material will look broken
      ensureUV2ForAO(child.geometry);

      // Debug function to print out the plain axes (destination for NPC in room tour mode)
      // if (child.isObject3D) {
      //   console.log("Found an empty object of type Object3D:", child.name);
      // }


      // Check if child is mesh
      if (child.isMesh) {
        bvhMeshList.push(child);
        // Setup the metadata for video texture handling
        child.userData.hlsInstance = null; // initialize hlsInstance to null
        child.userData.videoElement = null; // initialize videoElement to null

        console.log('CHILD MESH NAME:', child.name);
        child.userData.navWalkable = false;
        child.userData.navObstacle = true;

        // 1. Remove 'color' attribute if the material doesn't use vertex colors
        // This saves GPU memory if the GLTF exported with colors but not use them.
        if (child.geometry.attributes.color && !child.material.vertexColors) {
            child.geometry.deleteAttribute('color');
        }

        // 2. Remove 'tangent' attribute if not using normal maps that require them
        // angents are extra mathematical vectors stored in every vertex. They are used 
        // only for "Normal Maps" (the textures that make flat surfaces look bumpy)
        // Tangents take up a significant amount of Video RAM (VRAM). Deleting them for simple walls 
        // or floors that don't need bumps can reduce the memory footprint of model by 10–20%.
        if (child.geometry.attributes.tangent && !child.material.normalMap) {
            child.geometry.deleteAttribute('tangent');
        }

        // Remove normals if the material doesn't respond to light
        if (child.geometry.attributes.normal && child.material.isMeshBasicMaterial) {
            child.geometry.deleteAttribute('normal');
        }


        // 3. Ensure bounds are computed once
        if (!child.geometry.boundingSphere) {
            child.geometry.computeBoundingSphere();
        }

        if (!child.geometry.boundingBox) {
            child.geometry.computeBoundingBox();
        }

        // if (child.name.toLowerCase().includes("floor")) {
        //     child.userData.navWalkable = true;
        //     child.userData.navObstacle = false;
        // } else {
        //     // By default, every other mesh is considered an obstacle.
        //     child.userData.navWalkable = false;
        //     child.userData.navObstacle = true;
        // }

        // // Second, now that properties are set, check if it should be part of the navmesh.
        // if (child.userData.navWalkable || child.userData.navObstacle) {
        //     navInputMeshes.push(child);
        // }
        // --- END OF CORRECTED LOGIC ---

        // DEBUG FUNCTION
        const pos = new THREE.Vector3();
        child.getWorldPosition(pos);
        child.receiveShadow = true;
        if (pos.y < fallbackY) {
            fallbackY = pos.y;
            fallbackX = pos.x;
            fallbackZ = pos.z;
        }


        if (child.name.toLowerCase().includes("floor")) {
            child.receiveShadow = true;
            child.userData.navWalkable = true;
            child.userData.navObstacle = false;
            // Create a bounding box surround the child
            const box = new THREE.Box3().setFromObject(child);
            // Extract size of box surround the floor mesh
            const size = box.getSize(new THREE.Vector3());
            // Calculate area of rectangle side cover the floor
            const area = size.x * size.z;
            if (area > maxArea) {
                maxArea = area;
                floorMesh = { box, center: box.getCenter(new THREE.Vector3()) };
                floorBoxMaxY = box.max.y;
            }
        }

        // if (child.parent?.name === "Door") {
        //     doorBoundingBox = new THREE.Box3().setFromObject(child);
        // }
        
        // if (child.name === "Handle") {
        //     child.material = new THREE.MeshStandardMaterial({ color: 0xF4EBC7, metalness: 1.0, roughness: 0.2 });
        // }

        // Check if the objects name is pictureframe then push the mesh to the pictureFramesArray
        if (child.name.toLowerCase().includes("pictureframe")){
          pictureFramesArray.push(child);
        }

        // Check if the child is ImageMesh mesh
        if (/^ImageMesh\d+$/.test(child.name)) {
          // Debug
          // if (child.name === "ImageMesh004"){
          //   child.material = new THREE.MeshBasicMaterial({color : "red", wireframe: true})
          // }

          // Push mesh to the imageMeshArray
          imageMeshesArray.push(child);
          const imagePlane = child;
          // Create a bounding box surround the imagePlane
          const box = new THREE.Box3().setFromObject(imagePlane);
          // Get the center of bouding box
          const center = box.getCenter(new THREE.Vector3());
          // Init a new annotationDiv objects
          const annotationDiv = new AnnotationDiv(count,imagePlane);
          // Create a corresponding label to attach to the image mesh
          const label = new CSS2DObject(annotationDiv.getElement());
          // Make the label stay at the center of the ImageMesh mesh
          label.position.copy(center);
          // Add the label to the scene
          scene.add(label); 
          count++;
          // Assing the information to corresponding annotationMesh map 
          // with key is the ImageMesh child name and corresponding data 
          annotationMesh[imagePlane.name] = { label, annotationDiv, mesh: imagePlane };
          // Attach to DOM so it can be seen
          annotationDiv.onClick = () => displayUploadModal(1/1, { roomID: currentMuseumId, asset_mesh_name: imagePlane.name });
        }
      }
      // If child is walkable then push to the navInputMeshes
      if(child.userData && child.userData.navWalkable || child.userData.navObstacle){
          navInputMeshes.push(child);
      }
    });

    // Visualize tour target 
    visualizeAllNPCTargets();
    // Hide the label of annotation
    hideAnnotations();

    
    await initRecastIfNeeded();

    console.log("START LOADING EXTERNAL NAVMESH")
    const ExternalNavMeshURL = './assets/navmesh/new_nav_mesh.bin'
    const navMeshResult = await LoadExternalNavMesh(scene , ExternalNavMeshURL );
    if (!navMeshResult) {
        console.warn("LoadExternalNavMesh returned nothing!");
    } else if (navMeshResult.success) {
        console.log("Successfully load external navmesh!");
        navMesh = navMeshResult.navMesh;
        navQuery = navMeshResult.navQuery;
    } else {
        console.warn("Failed to load external navmesh!");
    }

    // After get navmesh , immediately call initCrowd() function to 
    // init Crowd so this can add the agent to this crowd
    if (navMesh){
        crowd = initCrowd(navMesh , 2 , 0.5);
    }else{
        console.warning("Fail to create Detour Crowd !");
    }


    // set up PictureFrame so it can be interact with the player
    raycasterManager.setPictureFrames(pictureFramesArray);
    Mapping_PictureFrame_ImageMesh(FrameToImageMeshMap, pictureFramesArray, imageMeshesArray);
    
    // --- PLAYER SETUP ---
    let playerStart = { x: 0, y: 0, z: 0 };
    if (floorMesh) {
        playerStart = { x: floorMesh.center.x, y: (floorBoxMaxY ?? floorMesh.center.y), z: floorMesh.center.z };
    } else {
        playerStart = { x: fallbackX, y: (fallbackY === Infinity ? 1 : fallbackY) - 0.1, z: fallbackZ };
        console.warn("No floor mesh found, using lowest mesh position as fallback.");
    }

      // --- PLAYER SETUP (capsule aligned so feet are on the floor) ---
      const RADIUS = 0.35;
      const TOTAL_HEIGHT = 1.8;           // desired overall capsule height
      const SEGMENT = TOTAL_HEIGHT - 2*RADIUS; // the inner line segment length

      const startY = playerStart.y + RADIUS + 0.02; // bottom sphere center
      const endY   = startY + SEGMENT;              // top sphere center

      playerCollider = new Capsule(
      new THREE.Vector3(playerStart.x, startY, playerStart.z),
      new THREE.Vector3(playerStart.x, endY,   playerStart.z),
      RADIUS
      );


      // INIT FIRST VIEW PLAYER
      activateFirstPerson();
      fpView = new FirstPersonPlayer(camera, scene, playerCollider);
      fpView.buildBVHFromMeshes(bvhMeshList);

      // INIT THIRD VIEW PLAYER
      tpView = new ThirdPersonPlayer(camera, scene, playerCollider, characterModel);
      tpViewExisted = true;
      tpViewLoadLate = true;
      tpView._cameraSnapped = false;
      if (window._IS_HOST === true){
        tpView.isHost = true;
        tpView.remoteControlled = false;
      }else{
        tpView.isHost = false;
        tpView.remoteControlled = true;
      }
      tpView.buildBVHFromMeshes(bvhMeshList)
      physiscsReady = true;
      hasLoadPlayer = true;
      if (!navQuery){
          console.warn("Nav query is not exist yet. museumNPC init may be fail");
      }else{
          console.info("Nav query exist already")
          // console.log("Nav query: ", navQuery)
      }
      // Call initNPC function to init NPC 
      const npcEntry = initNPC(scene, navQuery, bvhMeshList);
      
      if (npcEntry){
        npcEntry.state = {mode: 'idle'};
        npcAgents.push(npcEntry);
      }else {
        console.warn('initNPC failed - no entry created');
      }

      if (scene && navQuery && bvhMeshList && bvhMeshList.length > 0 && npcAgents){
        setGlobalRefs({
          scene: scene,
          navQuery: navQuery,
          bvhMeshList: bvhMeshList,
          npcAgents: npcAgents,
          tpView: tpView,
        })
      }

      // --- POPULATE SCENE WITH DATA ---
      (Array.isArray(items) ? items : []).forEach(item => {
          console.warn(item)
          if (!item) return;
          const { asset_mesh_name, asset_cid, webp_cid , title, viet_des, en_des , viet_audio_cid , eng_audio_cid , category } = item;
          const systemLanguage = localStorage.getItem('language');
          const audio_cid = (systemLanguage === 'vi') ? viet_audio_cid : eng_audio_cid;
          if (audio_cid) {
              // Wrap in setTimeout(0) to ensure the loop finishes 
              // before any network logic starts
              setTimeout(async () => {
                await prefetchAudio(audio_cid);
              }, 0);
          }
          if (annotationMesh[asset_mesh_name]) {
              annotationMesh[asset_mesh_name].mesh.userData.imageSRC = `https://${PINATA_URL}${webp_cid}`;
              annotationMesh[asset_mesh_name].mesh.userData.videoSRC = `https://${PINATA_URL}${asset_cid}/master.m3u8`;
              annotationMesh[asset_mesh_name].mesh.userData.backup_videoSRC = `https://${PINATA_URL}${asset_cid}/stream.m3u8`;
              annotationMesh[asset_mesh_name].mesh.userData.category = category;
              annotationMesh[asset_mesh_name].title = title;
              annotationMesh[asset_mesh_name].imageSRC = webp_cid;
              annotationMesh[asset_mesh_name].viet_des = viet_des;
              annotationMesh[asset_mesh_name].en_des = en_des;
              annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, viet_des, en_des , viet_audio_cid , eng_audio_cid);
              if (category === "Image"){
                setImageToMesh(currentScene, asset_mesh_name, `https://${PINATA_URL}${asset_cid}`, `https://${PINATA_URL}${webp_cid}`);
              }else if (category === "Video"){
                setVideoToMeshHLS(currentScene, asset_mesh_name, `https://${PINATA_URL}${asset_cid}`);
              }
              
          }
      });

      hasEnteredNewScene = false;
      document.getElementById('loading-container').style.display = 'none';

  } catch (error) {
      console.error('An error occurred while loading the model or assets:', error);
      document.getElementById('loading-container').style.display = 'none';
  }
}


async function setMuseumModel(modelId) {
    currentMuseumId = modelId;
    bvhMeshList.length = 0;
    await loadModel();
}

function initMenu() {
    const menuContainer = document.getElementById("menu-container");
    if (!menuContainer) return;

    document.getElementById("menu-close").addEventListener("click", closeMenu);

    
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            menuOpen ? closeMenu() : openMenu();
        }
    });
}

function openMenu(){
    menuOpen = true;
    const menuContainer = document.getElementById("menu-container");
    if (menuContainer) menuContainer.style.display = "flex";
}

function closeMenu(){
    menuOpen = false;
    const menuContainer = document.getElementById("menu-container");
if (menuContainer) menuContainer.style.display = "none";
}

// pointer lock mouse look (example — adapt to app)
window.addEventListener('mousemove', (e) => {
  // Only rotate the camera if the mouse is "captured" by the browser
  if (document.pointerLockElement) {

    // movement X is horizontal mousemove
    // Substract it from camYaw to rotate camera around the Up axis to the right 
    // In a 3D coordinate system (Y-Up), clockwise rotation usually decreases the angle value 
    // (or follows the "Right-Hand Rule" where thumb points down).
    camYaw   -= e.movementX * 0.005;  // sensitivity X

    // movement Y is vertical mousemove
    // In browser default Y is point downward so that if we want the mouse move to the top 
    // then we must subtract Y (Y have negative value - which defined by browswer) to get 
    // positive Y value so that it can move up 
    camPitch -= e.movementY * 0.005;  // sensitivity Y

    // Clamp the Pitch (Look Up/Down) so the player can't flip 
    // their head upside down or break their neck.
    // -1.2 radians is roughly 70 degrees down, 0.8 is roughly 45 degrees up.
    camPitch = Math.max(-1.2, Math.min(0.8, camPitch)); // clamp pitch
  }
});

// This function is used for create Spatial Audio Synchronization
// It ensures the sound play in program (the AudioListener) are 
// perfectly aligned with the the visible area that camera (THREE.Camera) in the scene 
// can view 
function updateAudioListener(camera) {
  if (!window.audioCtx || !camera) return;
  const listener = window.audioCtx.listener;
  // Take camera position and map to the AudioContext's listener
  // setValueAtTime ensure if there is a sudden camera position change 
  // The sound play / stop smoothly 
  const pos = camera.position;
  listener.positionX.setValueAtTime(pos.x, window.audioCtx.currentTime);
  listener.positionY.setValueAtTime(pos.y, window.audioCtx.currentTime);
  listener.positionZ.setValueAtTime(pos.z, window.audioCtx.currentTime);

  /**
   * 1. Calculate the 'Forward' direction in World Space.
   * By default, a Three.js camera looks down the negative Z-axis (0, 0, -1).
   * We take this local "nose" direction and multiply it by the camera's current 
   * rotation (quaternion). This tells the Audio Listener exactly which way 
   * character's face is pointing in the room so it can pan sounds to the left or right ear.
  */
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  /**
   * 2. Calculate the 'Up' direction in World Space.
   * We take the default 'Up' vector (0, 1, 0) and apply the camera's rotation.
   * This is crucial for "Roll." It tells the Audio Listener if character's head is 
   * tilted (xoay). Without this, if character tilted his head 90 degrees, the audio 
   * wouldn't correctly flip between player's ears.
 */
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  listener.forwardX.setValueAtTime(forward.x, window.audioCtx.currentTime);
  listener.forwardY.setValueAtTime(forward.y, window.audioCtx.currentTime);
  listener.forwardZ.setValueAtTime(forward.z, window.audioCtx.currentTime);
  listener.upX.setValueAtTime(up.x, window.audioCtx.currentTime);
  listener.upY.setValueAtTime(up.y, window.audioCtx.currentTime);
  listener.upZ.setValueAtTime(up.z, window.audioCtx.currentTime);
}

// This is the main function use to update the scene drawing 
// update animation in the scene
function animate() {
  // Start render on canvas
  animationFrameId = requestAnimationFrame(animate);

  // -- PERFORMANCE OPTIMIZATION -- //\

  // Shadow throttling - If the condition match , it immediately update the shadowMap 
  // which used for display shadow in the scene so this can dynamically tune the graphic
  // to suitable even with weak device 
  if (LOD_SETTINGS.frames % 2 === 0) {
    renderer.shadowMap.needsUpdate = true;
  }

  // If the player click to the scene to see the video, it detect and immediately stop
  // render the scene so that the CPU / GPU workload reduce , fetching video to play will be
  // much more smooth 
  if (window.isPaused3D) return;
  
  // Render CSS3DRender
  // if (css3dRenderer) css3dRenderer.render(scene, camera);

  const now = performance.now();
  let prevFPS = 0;

  // --- LOD Performance Monitoring ---
  LOD_SETTINGS.frames++;
  if (now - LOD_SETTINGS.startTime >= LOD_SETTINGS.FPS_CHECK_INTERVAL_MS) {
      const currentFPS = LOD_SETTINGS.frames / ((now - LOD_SETTINGS.startTime) / 1000);
      if (currentFPS > currentFPS + 1 || currentFPS < currentFPS - 1 || currentFPS === prevFPS){
        prevFPS = currentFPS;
        LOD_SETTINGS.frames = 0;
        LOD_SETTINGS.startTime = now;
        return;
      }
      checkAndAdjustLOD(currentFPS); // Call the dynamic adjustment function
      prevFPS = currentFPS;
      // Reset counters
      LOD_SETTINGS.frames = 0;
      LOD_SETTINGS.startTime = now;
  }
  // Update property visibility dynamcally to reduce the bandwidth and GPU load 
  // updatePropVisibility();

  // Update spatial audio for the whole scene
  updateSpatialAudio(scene);


  // render CSS2D (labels)
  if (cssRenderer) cssRenderer.render(scene, camera);
  
  // Extract the min value of the frameDelta
  const frameDelta = Math.min(0.05, clock.getDelta());
  physicsTimeAccumulator += frameDelta;


  // update remote players (multiplayer)
  if (typeof window.updateRemotePlayers === "function") {
    try { window.updateRemotePlayers(frameDelta); } catch(e){ console.warn("updateRemotePlayers failed", e); }
  }

  // Peformance guard, this ensure GPU do no unnecessary math when there are nothing to highlight in the scene
  if (outlinePass) {
    // Check if selectedObjects arrays exists and has item
    // If it is undefined set to 0
    const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
    // This is "kill switch". If no objects are selected, the pass is disabled
    outlinePass.enabled = hasTargets;
  }

  // ---------------- CROWD UPDATE ----------------
  const FIXED_CROWD_DT = Math.max(1/30 , 1/180);
  updateCrowd(FIXED_CROWD_DT, frameDelta, 2);
  updateAgentTours(navQuery ?? getNavQuery());

  // ---------------- NPC SYNC ----------------
  const NPC_ROT_LERP_SPEED = 12.0;
  const NPC_ARRIVAL_DIST = 0.08;
  const NPC_MIXER_DISTANCE = 60;

  for (const entry of npcAgents) {
    const agent = entry.agent;
    const model = entry.model;
    if (!agent || !model) continue;

    const ud = entry.userData || (agent && agent.userData) || (model && model.userData);
    if (ud && ud.remoteControlled) {
        // This agent is controlled by host data.
        // Its animation and mixer updates are handled
        // inside updateCrowd(). Skip local sync.
        continue; // Skip to the next agent
    }

    // Calculate the distance from camera to character (player) model 
    const distToCam = camera.position.distanceTo(model.position);

    // --- OPTIMIZATION: LOGIC CULLING ---
    // If far away, only update physics/logic every 3 frames
    if (distToCam > 10 && (LOD_SETTINGS.frames) % 3 !== 0) {
        // Interpolate visually to keep it smooth, but skip the heavy math
        continue; 
    }

    entry.state = entry.state || { mode: 'idle', requestedGait: null };

    const anim = model.userData?.animCtrl ?? model.userData?.animationCtrl ?? null;

    if (anim && anim.mixer) {
        if (distToCam < NPC_MIXER_DISTANCE) {
             // Full update for close NPCs
             anim.mixer.update(frameDelta);
        } else if (distToCam < NPC_MIXER_DISTANCE * 1.5) {
             // Half-rate update for medium distance (saves CPU)
             if (LOD_SETTINGS.frames % 2 === 0) anim.mixer.update(frameDelta * 2);
        }
    }
    

    // --- agent position ---
    // 1. Coordinate Acquisition & Safety
    // The block ensures a valid position is retrieved from the NPC agent, 
    // supporting multiple data structures and library types.
    let apos;
    try {
      // try to get the smooth position first (interpolatedPosition)
      // If this position is not exist then try to extract raw position
      apos = agent.interpolatedPosition ?? (typeof agent.position === 'function' ? agent.position() : agent.position);
    } catch (e) {
      apos = (typeof agent.position === 'function' ? agent.position() : agent.position);
    }
    if (!apos) continue;

    // Normalize position into a Three.js Vector3, handling both object (x,y,z) and array format.
    const agentPos = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);

    // Check for custom vertical offsets defined in the model metadata.
    const footOffset = typeof model.userData?.footOffset === 'number' ? model.userData.footOffset : 0;

    // 2. Vertical Alignment & BVH Snapping
    // This section handles the "snapping" of the character to the floor 
    // geometry to prevent floating or sinking.
    let targetPos = new THREE.Vector3(agentPos.x, agentPos.y, agentPos.z);
    let snappedToBVH = false;

    // DEBUG: log positions for first NPC only (turn on/off quickly)
    // if (typeof window.DEBUG_NPC_POSITIONS === 'undefined') window.DEBUG_NPC_POSITIONS = false;
    // if (window.DEBUG_NPC_POSITIONS && npcAgents.indexOf(entry) === 0) {
    //   let rawPos = null;
    //   try { rawPos = (typeof agent.position === 'function' ? agent.position() : agent.position); } catch (e) {}
    //   let interp = null;
    //   try { interp = (typeof agent.interpolatedPosition === 'function' ? agent.interpolatedPosition() : agent.interpolatedPosition); } catch(e){}
    // }

    // If a BVH (Bounding Volume Hierarchy) mesh list exists, perform a downward raycast.
    // This calculates the exact Y-coordinate of the floor surface directly beneath the agent.
    if (bvhMeshList && bvhMeshList.length) {
      try {
        const downOrigin = new THREE.Vector3(agentPos.x, agentPos.y + 1.0, agentPos.z);
        const downRay = new THREE.Raycaster(downOrigin, new THREE.Vector3(0, -1, 0));
        const hits = downRay.intersectObjects(bvhMeshList, true);
        if (hits && hits.length) {
          targetPos.y = hits[0].point.y;
          snappedToBVH = true;
        }
      } catch (e) {}
    }

    // Fallback logic: if no floor hit is found, use the NavMesh height plus a predefined offset.
    if (!snappedToBVH) {
      const navToFloor = (model.userData && typeof model.userData.navMeshToFloorOffset === 'number') ? model.userData.navMeshToFloorOffset : 0;
      targetPos.y = agentPos.y + navToFloor;
    }

    // Apply final foot offset to ensure the model sits correctly on the surface.
    targetPos.y += footOffset;

    // 3. Frame-Independent Smoothing
    // Instead of snapping the model to the target, the code uses exponential smoothing to
    // maintain fluid motion during frame rate fluctuations.

    // Calculate a smoothing factor (alpha) based on a fixed responsiveness value and time delta.
    const responsiveness = 5.0; // bigger = snappier, smaller = smoother
    const alpha = 1 - Math.exp(-responsiveness * frameDelta);

    // Smooth X/Z instead of snapping: gives smooth motion regardless of frame jitter
    // Interpolate the model's position toward the target coordinates.
  // This eliminates visual "jitter" in the X, Y, and Z axes.
    model.position.x += (targetPos.x - model.position.x) * alpha;
    model.position.z += (targetPos.z - model.position.z) * alpha;
    // Smooth Y as well (ensures no vertical popping)
    model.position.y += (targetPos.y - model.position.y) * alpha;

    // --- arrival handling ---
    // 4. Arrival Logic & State Transitions
    // Detects if the NPC has reached its destination to switch the state to "Idle."

    // Determine if the agent is within the arrival threshold of its current target.
    let targetObj = null;
    try { targetObj = (typeof agent.target === 'function') ? agent.target() : agent.target; } catch (e) {}
    let reached = false;
    if (targetObj && (('x' in targetObj) || Array.isArray(targetObj))) {
      const tx = targetObj.x ?? targetObj[0];
      const tz = targetObj.z ?? targetObj[2];
      const tvec = new THREE.Vector3(tx, agentPos.y, tz);
      if (agentPos.distanceTo(tvec) <= NPC_ARRIVAL_DIST) reached = true;
    }

    // Logic to execute upon reaching a target: stop movement and cross-fade to idle animation.
    if (reached) {
      try { if (typeof agent.resetMoveTarget === 'function') agent.resetMoveTarget(); } catch (e) {}
      model.position.copy(targetPos);

      if (anim && anim.idleAction) {
        if (anim.currentAction && anim.currentAction !== anim.idleAction) {
          anim.currentAction.crossFadeTo(anim.idleAction, 1, true);
        }
        anim.idleAction.reset().play();
        anim.currentAction = anim.idleAction;
        anim.currentAction.timeScale = 1.0;
      }

      if (tpView && tpView.isTouring){
        tpView.isViewingPicture = true;
      }

      if (entry.state.tourFacingQuat) {
        // Smoothly snap or slerp to face the painting upon arrival
        model.quaternion.copy(entry.state.tourFacingQuat);
      }

      entry.state.requestedGait = null;
      entry.state.mode = 'idle';
      // Skip further movement logic for this frame.
      continue;
    }

    // 5. Movement Velocity & Rotation
    // Calculates the desired speed and rotates the character to face the direction of movement.

    // Determine current speed requirements based on whether the NPC should walk or run.
    const gaitWanted = entry.state.requestedGait ?? entry.state.mode;
    const desiredGaitSpeed = (gaitWanted === 'run')
      ? (entry.runSpeed ?? 2.0)
      : (entry.walkSpeed ?? 2.0);

    // Update internal agent parameters if the AI library supports dynamic speed adjustment.
    try {
      if (typeof agent.updateParameters === 'function') {
        agent.updateParameters({
          maxSpeed: desiredGaitSpeed,
          maxAcceleration: 10.0,
        });
      }
    } catch (e) {}

    // Calculate current velocity and speed for animation scaling.
    let vel = null;
    try { vel = (typeof agent.velocity === 'function') ? agent.velocity() : agent.velocity; } catch (e) {}
    const vx = (vel?.x ?? vel?.[0]) ?? 0;
    const vz = (vel?.z ?? vel?.[2]) ?? 0;
    const speed = Math.sqrt(vx * vx + vz * vz);

    // Handle rotation: either lock the rotation for a "viewing" event or rotate toward movement 
    // velocity.
    const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

    if (entry.state?.preventRotationUntil && entry.state.preventRotationUntil > nowSec) {
      if (entry.state.tourFacingQuat && model) {
        model.quaternion.copy(entry.state.tourFacingQuat);
      }
    } else {
      // Use Slerp (Spherical Linear Interpolation) to smoothly turn the character toward its heading.
      if (speed > 1e-4) {
        const desiredDir = new THREE.Vector3(vx, 0, vz).normalize();
        const targetYaw = Math.atan2(desiredDir.x, desiredDir.z);
        const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
        model.quaternion.slerp(tq, Math.min(1, NPC_ROT_LERP_SPEED * frameDelta));
      }
    }

    // --- animation ---
    //6. Dynamic Animation Controller
    //Manages state-based transitions (Walk, Run, Idle) and synchronizes playback speed
    //  with movement velocity.
    if (anim) {
      let nextAction = null;
      // Select the appropriate animation clip based on the current movement mode.
      if (gaitWanted === 'run' && anim.runningAction) nextAction = anim.runningAction;
      else if (gaitWanted === 'walk' && anim.walkAction) nextAction = anim.walkAction;
      else if (anim.idleAction) nextAction = anim.idleAction;
      // Perform a smooth cross-fade transition if the animation state has changed.
      if (nextAction && anim.currentAction !== nextAction) {
        if (anim.currentAction) {
          anim.currentAction.crossFadeTo(nextAction, 1, true);
        }
        nextAction.reset().play();
        anim.currentAction = nextAction;
      }

      if (anim.currentAction) {
        // Adjust animation timeScale to match movement speed, preventing "foot sliding" artifacts.
        const targetScale = THREE.MathUtils.clamp(speed / desiredGaitSpeed, 1, 2);
        anim.currentAction.timeScale = THREE.MathUtils.lerp(anim.currentAction.timeScale ?? targetScale, targetScale, 0.1);
      }
    }
  }


  // ---------------- TP VIEW ----------------
  // Check if physics, player mode, and tour data are initialized.
  if (physiscsReady && activePlayer === 'tp' && tpView) {
    // --- Step 1: Update the Crowd Agent's Target (if touring) ---
    // Update the destination for the Crowd Agent if the tour is active.
    if (tpView.isTouring && tpView.crowdAgent && npcAgents.length > 0) {
      const npcEntry = npcAgents[0]; // Reference the primary tour guide NPC.

      // Determine if the guide has reached its stop and is currently idle.
      const atDest = !!(npcEntry?.state?.mode === 'idle' && npcEntry?.state?.atDestination);

      // Command the player's crowd agent to move toward the guide NPC's position.
      if (npcEntry && npcEntry.model && tpView && tpView.crowdAgent) {
        setPlayerFollowTarget(tpView.crowdAgent, npcEntry, navQuery);
      }
    }

    // --- Step 2: Update the Player's Visual Model ---
    // Synchronize the 3D model with the underlying physics/agent data.
    // If in room tour mode , use updateFollow or syncFromCrowd as fallback function to follow NPC
    if (tpView.isTouring) {
      if (typeof tpView.updateFollow === 'function') {
        tpView.updateFollow(frameDelta);
      } else {
        tpView.syncFromCrowd();
      }
    } 
    // Else if in normal mode use update function
    else {
      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        tpView.update(frameDelta * 0.5);
      }
    }

    // --- Step 3: Camera update ---

    // 1. TOUR STOP CAMERA
    if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
      const npcEntry = npcAgents[0]; // Reference to NPC agent 
      
      // The point the camera is interested in on the player (center mass)
      // Define the "look-at" point (the center of the player's body, 0.5m above the ground).
      const playerLookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end)
        .clone().add(new THREE.Vector3(0, 0.5, 0));
      
        // Define condition when tour is stop before each picture
      const isAtTourStop =  !tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.isViewingPicture;

      if (isAtTourStop) {
        // ====================================================================
        // ✅ NEW LOGIC: When at a tour stop, keep the player in view but look at the picture.
        // ====================================================================
        try {
          const pic = npcEntry.state.currentPictureMesh;
          pic.updateMatrixWorld(true);

          // 1. Get the picture's world position (the absolute thing we want to look at).
          const pictureTarget = new THREE.Vector3();
          pic.getWorldPosition(pictureTarget); // Ensure picture coordinate are correctly updated

          // 2. Position the camera BEHIND the PLAYER, facing the picture.

          // This keeps the player in the frame.
          // TARGET: Player position
          // START: Picture 
          // DIRECTION = TARGET - START
          const directionFromPicToPlayer = playerLookAtPoint.clone().sub(pictureTarget).normalize();
          const cameraDistance = 3.0; // How far the camera should be from the player
          
          // Place the camera behind the player along the line from the picture.
          const cameraTargetPosition = playerLookAtPoint.clone().add(directionFromPicToPlayer.multiplyScalar(cameraDistance));
          cameraTargetPosition.y = playerLookAtPoint.y + 1.0 ; // Adjust height for a better view

          // 3. Smoothly move the camera to the target position and look at the picture.
          const lerpFactor = 0.12;
          camera.position.lerp(cameraTargetPosition, lerpFactor);
          
          // 5. Slerp (Spherical Interpolation) to smoothly turn the camera toward the painting.
          const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(camera.position, pictureTarget.normalize(), camera.up)
          );
          camera.quaternion.slerp(targetQuaternion, lerpFactor);

        } catch (e) {
          console.warn('Tour camera snap failed, falling back to normal follow.', e);
        }

      } 
      else {
        //  STANDARD LOGIC: When moving, use the normal follow-cam.
        // This logic is correct for following the player.

        // DEFAULT: Position camera behind the player relative to their rotation.
        let cameraLookTarget = playerLookAtPoint.clone();

        const idealOffset = new THREE.Vector3(0, 1.2, -3.0).applyQuaternion(tpView.model.quaternion);
        const idealPos = playerLookAtPoint.clone().add(idealOffset);
        let finalPos = idealPos.clone();

        // Camera collision logic
        // Use the camera FOV and near-plane math to determine the camera's physical "size".
        const fovRadians = THREE.MathUtils.degToRad(camera.fov);
        const near = camera.near;
        const halfHeight = Math.tan(fovRadians * 0.5) * near;
        const halfWidth = halfHeight * camera.aspect;
        const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

        // Raycast from the player to the ideal camera position to detect walls.
        const raycaster = new THREE.Raycaster(playerLookAtPoint, idealOffset.clone().normalize(), 1e-3, idealOffset.length());
        const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);

        //  If a wall is hit, move the camera in front of the wall to prevent clipping.
        if (intersects.length > 0) {
          // Modify from camRadius + 0.05 to camRadius + 0.35
          finalPos.copy(intersects[0].point).sub(raycaster.ray.direction.clone().multiplyScalar(camRadius + 0.35));
        }
        
        // --- Final Camera Smoothing ---
        if (tpView.isTouring && tpView.isViewingPicture){
          // Instant snap if viewing a picture to prevent "swinging" cameras.
          tpView._cameraSnapped = false;
          camera.position.copy(finalPos);
          camera.lookAt(cameraLookTarget);
          return;
        }else{
          // Smooth follow position
          const lerp = 0.05;
          if (!tpView._cameraSnapped) {
            camera.position.copy(finalPos);
            tpView._cameraSnapped = true;
          } else {
            camera.position.lerp(finalPos, lerp);
          }

          // Smooth follow orientation
          const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(camera.position, cameraLookTarget, camera.up)
          );
          camera.quaternion.slerp(targetQuaternion, 0.05);
          }
      }
    }
  }

  // ---------------- FP VIEW ----------------
  // Check if physics and first-person view are active.
  if (physiscsReady && activePlayer === 'fp' && fpView) {
    // Execute movement updates multiple times per frame (STEPS_PER_FRAME).
    // This increases physics precision and prevents the player from clipping through walls.
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      fpView.update(frameDelta, camYaw, camPitch);
    }

    // 2. NPC Position Extraction
    // To follow a guide, the code must first find exactly where the guide is. It prioritizes "interpolated" 
    // data to prevent the guide from looking jittery.
    if (fpView.isTouring && fpView.followAgent) {
      const npcEntry = fpView.followAgent;
      // Prefer the agent's interpolated position when available (most accurate)
      let npcPosVec = null;
      if (npcEntry.agent) {
        try {
          // Priority 1: Use interpolatedPosition (the smooth calculated path).
          // Priority 2: Use raw position (the current teleported coordinate).
          const apos = (typeof npcEntry.agent.interpolatedPosition === 'function')
            ? npcEntry.agent.interpolatedPosition()
            : (typeof npcEntry.agent.position === 'function' ? npcEntry.agent.position() : npcEntry.agent.position);

           // Update the 3D model to match this agent coordinate. 
          if (apos && model) {
            model.position.set(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
          }
          npcPosVec = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
        } catch (e) { npcPosVec = null; }
      }

      // Fallback: If agent data is missing, get the world position directly from the 3D model.
      if (!npcPosVec && npcEntry.model) {
        npcPosVec = new THREE.Vector3();
        npcEntry.model.getWorldPosition(npcPosVec);
      }

      // 3. Determining Direction (Heading)
      // The camera needs to know which way the guide is facing to sit "behind" them.
      if (npcPosVec) {
        const forward = new THREE.Vector3();
        if (npcEntry.model) {
          // Priority 1: Get the direction the 3D model is actually facing.
          npcEntry.model.getWorldDirection(forward);
          forward.y = 0;
          if (forward.lengthSq() < 1e-6) forward.set(0,0,1);
          forward.normalize();
        } else if (npcEntry.agent) {
          // Priority 2: Use the agent's velocity vector to determine direction.
          try {
            const vel = (typeof npcEntry.agent.velocity === 'function') ? npcEntry.agent.velocity() : npcEntry.agent.velocity;
            forward.set((vel?.x ?? vel?.[0]) ?? 0, 0, (vel?.z ?? vel?.[2]) ?? 0);
            if (forward.lengthSq() < 1e-6) forward.set(0,0,1);
            else forward.normalize();
          } catch (e) { forward.set(0,0,1); }
        } else {
          forward.set(0,0,1);
        }

        // 4. Camera Positioning & Smoothing
        // The camera is placed 2 meters behind the guide’s head and uses interpolation to follow.
        // Calculate the 'Ideal' camera position:
        // 1. Start at the NPC position.
        // 2. Add 1.6m height (average human eye level).
        // 3. Move 2 meters backward relative to the 'forward' direction.
        const camPos = npcPosVec.clone()
          .add(new THREE.Vector3(0, 1.6, 0)) // eye height
          .add(forward.clone().multiplyScalar(-2.0)); // 2m behind

        // Lerp (Linear Interpolation) for movement: 
      // This creates a 'lazy' camera effect that follows smoothly rather than snapping.
        fpView.camera.position.lerp(camPos, 0.12);

        // Keep the camera looking at the back of the NPC's head.
        fpView.camera.lookAt(npcPosVec.clone().add(new THREE.Vector3(0, 1.6, 0)));
      }
    }
  }

  // ---------------- MIXERS ----------------
  if (mixer) mixer.update(frameDelta);
  if (tpView?.mixer) tpView.mixer.update(frameDelta);

  // ---------------- UPDATE MULTIPLAYERS ---------------
  // Update all remote players (from webrtc_game.js)
  // keep remote avatars in-sync (safe even if webRTC not loaded)
  if (typeof updateRemotePlayers === "function") {
    try { updateRemotePlayers(frameDelta); } catch (e) { console.warn("updateRemotePlayers failed", e); }
  }
  updateAudioListener(camera)
  lod.update(camera);
  // checkPlayerPosition();
  if (outlinePass && outlinePass.enabled && outlinePass.selectedObjects.length > 0) {
    composer.render();
  } else {
      // Faster standard render when no outline is visible
      renderer.render(scene, camera);
  }
}


async function activateThirdPerson() {
  activePlayer = 'tp';

  // --- Late-load initialization ---
  if (tpViewLoadLate) {
    console.log("TP VIEW IS LOAD LATE");

    if (!tpViewExisted && character) {
      tpView = new ThirdPersonPlayer(camera, scene, playerCollider, character.model);
      if(window._IS_HOST === true){
        tpView.isHost = true;
        tpView.remoteControlled = false;
      }else{
        tpView.isHost = false;
        tpView.remoteControlled = true;
      }
      tpView.buildBVHFromMeshes(bvhMeshList);
      tpView.handleAnimation(character.model, character.gltf);
      if (tpView.playerCollider) tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
      if (tpView.tempQuaternion && tpView.model) tpView.tempQuaternion.copy(tpView.model.quaternion);
      tpView._cameraSnapped = false;

      scene.add(tpView.model);
      tpViewExisted = true;
      tpViewLoadLate = false;
    } else if (tpViewExisted && character) {
      if (!tpView.model) tpView.attachModel(character.model);
      tpView.handleAnimation(character.model, character.gltf);
      if (tpView.playerCollider) tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
      if (tpView.tempQuaternion && tpView.model) tpView.tempQuaternion.copy(tpView.model.quaternion);
      tpView._cameraSnapped = false;

      scene.add(tpView.model);
      tpViewLoadLate = false;
    } else {
      console.info("Character not loaded yet — retrying...");
      setTimeout(activateThirdPerson, 1000);
      return;
    }
  }

  // --- Normal reactivation ---
  if (tpViewExisted && tpView) {
    tpView.resetControls();
    tpView.faceYaw(camYaw);
    if (tpView.playerCollider) tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
    if (tpView.tempQuaternion && tpView.model) tpView.tempQuaternion.copy(tpView.model.quaternion);
    tpView._cameraSnapped = false;
    scene.add(tpView.model);
    tpView.model.visible = true;
  }

  // --- Create or ensure TP agent exists ---
  if (tpView && tpView.model && !tpView.crowdAgent && crowd) {
    await addThirdPersonToCrowd(scene, crowd, tpView);
  }

  // --- If NPC is touring, start follow ---
  const tourNpc = npcAgents?.[0];
  if (tourNpc?.state?.touring) {
    const nq = getNavQuery() ?? navQuery;

    // align the TP agent to NPC immediately to avoid snapping
    try {
      const tgt = {
        x: tourNpc.model.position.x,
        y: tourNpc.model.position.y,
        z: tourNpc.model.position.z,
      };
      if (tpView?.crowdAgent?.teleport) tpView.crowdAgent.teleport(tgt);
      else if (tpView?.crowdAgent) tpView.crowdAgent.position = tgt;
    } catch (e) {
      console.debug("teleport failed", e);
    }

    // Start TP follow behavior
    if (tpView && typeof tpView.startFollowAgent === "function") {
      tpView.startFollowAgent(tourNpc, {
        offsetBehind: 0.5,
        smoothing: 0.12,
        heightOffset: 0.0,
        side: 1,
      });
      tpView.isTouring = true;
    }

    // Ensure crowd movement begins
    if (tpView?.crowdAgent && nq && typeof setPlayerFollowTarget === "function") {
      setPlayerFollowTarget(tpView.crowdAgent, tourNpc, nq);
    }

    // Stop FP follow (if any)
    if (fpView && typeof fpView.stopFollowAgent === "function") {
      try { fpView.stopFollowAgent(); } catch {}
    }

    console.debug("✅ Third-person follow started successfully (with async crowd registration).");
  }
}


function activateFirstPerson() {
  activePlayer = 'fp';

  // --- 1. ORIENTATION SYNCHRONIZATION ---
  // Extract the horizontal rotation (Yaw) from the Third-Person model.
  // This prevents the camera from "snapping" to a default direction upon switching.
  // Deactivate TP view
  if (tpView && tpView.model) {
    // Convert the model's rotation (Quaternion) into Euler angles to isolate the Y-axis (Yaw).
    const e = new THREE.Euler().setFromQuaternion(tpView.model.quaternion, 'YXZ');
    camYaw = e.y;
    camPitch = 0;
  }
  
  // --- 2. THIRD-PERSON CLEANUP ---
  // Remove the visible character model and stop all TP-specific logic.
  if (tpView && tpView.model) {
    scene.remove(tpView.model);
    tpView.model.visible = false;
    tpView.isTouring = false;
    // Terminate the TP camera follow behavior to prevent background processing
    if (typeof tpView.stopFollowAgent === 'function') {
      try { tpView.stopFollowAgent(); } catch {}
    }
  }

  // --- 3. FIRST-PERSON INITIALIZATION ---
  // Configure the First-Person view state to match the captured spatial data.
  if (fpView) {
    fpView.resetControls(); // Clear existing movement buffers

    // Synchronize the physics collider with the visual position
    if (fpView._smoothedPlayerPosition && fpView.playerCollider){
      fpView._smoothedPlayerPosition.copy(fpView.playerCollider.end);
    }
      

    // Preserve the current rotation state within the FP controller
    if (typeof fpView.tempQuaternion !== 'undefined' && fpView.model) {
      fpView.tempQuaternion.copy(fpView.model.quaternion || new THREE.Quaternion());
    }

    // Apply the captured Yaw and Pitch to the First-Person camera
    fpView.setYaw(camYaw);
    fpView.setPitch(camPitch);
    // Force the camera to re-calculate its position relative to the player
    fpView._cameraSnapped = false;
  }

  // --- 4. TOUR CONTINUITY ---
  // If the NPC is currently leading a tour, re-attach the First-Person camera 
  // to follow the NPC agent immediately.
  const tourNpc = npcAgents?.[0];
  if (tourNpc?.state?.touring && fpView) {
    try {
      // Re-initialize the follow logic using available FP controller methods
      if (typeof fpView.setFollowAgent === 'function') {
        fpView.setFollowAgent(tourNpc, playerCollider);
      } else if (typeof fpView.startFollowAgent === 'function') {
        // Apply smooth following parameters for a cinematic experience
        fpView.startFollowAgent(tourNpc, { offsetBehind: 0, smoothing: 0.1, heightOffset: 0 });
      }
      fpView.isTouring = true;
      console.debug('✅ First-person follow resumed.');
    } catch (e) {
      console.warn('activateFirstPerson: follow re-init failed', e);
    }
  }

  console.debug('Switched to First-person view.');
}


function computeFootOffsetForModel(model) {
  // returns positive number = distance from model origin to feet
  try {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    // If bbox is very tiny (unloaded), return null to indicate "not ready"
    const size = box.getSize(new THREE.Vector3());
    if (size.lengthSq() < 1e-6) return null;
    return -box.min.y; // distance from origin to bottom
  } catch (e) {
    return null;
  }
}


function createRemoteAvatarFromTemplate(peerId, attempts = 1) {
  if (!characterModelReady || !characterModel) {
    if (attempts < MAX_AVATAR_LOAD_ATTEMPTS && !REMOTE_LOAD_RETRY[peerId]) {
      console.warn(`[Avatar] Model not ready for peer ${peerId}. Retrying in ${AVATAR_RETRY_DELAY_MS/1000}s (Attempt ${attempts}).`);
      REMOTE_LOAD_RETRY[peerId] = setTimeout(() => {
        delete REMOTE_LOAD_RETRY[peerId];
        addRemotePlayer(peerId, attempts + 1);
      }, AVATAR_RETRY_DELAY_MS);
    } else if (attempts >= MAX_AVATAR_LOAD_ATTEMPTS) {
      console.error(`[Avatar] FATAL: Failed to load model for peer ${peerId} after ${attempts} attempts.`);
    }
    return null;
  }

  // clone skeleton-aware if SkeletonUtils available, else do a simple clone
  const src = characterModel;
  let clone;
  try {
    clone = (SkeletonUtils && typeof SkeletonUtils.clone === 'function')
      ? SkeletonUtils.clone(src)
      : src.clone(true);
  } catch (e) {
    console.warn('[Avatar] clone failed, falling back to simple clone', e);
    clone = src.clone(true);
  }

  clone.name = `RemotePlayer_${peerId}`;
  // default off-screen placement; real placement occurs when first network state arrives.
  clone.position.set(0, 0, 0);

  // Optional: disable frustum culling for remote players so they don't pop out
  clone.traverse((c) => { if (c.isMesh) c.frustumCulled = false; });

  scene.add(clone);
  // console.debug('[Avatar] created clone for', peerId, 'floorOffset=', floorOffset);
  return {clone};
}


export function addRemotePlayer(peerId, attempts = 1) {
  if (!peerId) return null;
  if (remotePlayers.has(peerId)) return remotePlayers.get(peerId);

  const result = createRemoteAvatarFromTemplate(peerId, attempts);
  if (!result) return null;

  const model = result.clone;



  // compute floor offset
  let floorOffset = computeFootOffsetForModel(model);
  if (floorOffset == null) floorOffset = 0;
  console.debug(`[AvatarOffset] floorOffset for ${peerId}:`, floorOffset);

  // Create an AnimationMixer later when attach controller
  let mixer = null;
  let animCtrl = null; // controller returned by createAnimController

  // If there is a  loaded characterGLTF (clips etc.), create controller for this clone
  if (typeof characterGLTF !== "undefined" && characterGLTF) {
    try {
      animCtrl = createAnimController(model, characterGLTF);
      mixer = animCtrl.mixer;
      // start idle if available (createAnimController may already do this)
      if (animCtrl.idleAction) animCtrl.idleAction.play();
      model.userData.animCtrl = animCtrl;
    } catch (e) {
      console.warn("[RemotePlayer] createAnimController failed:", e);
      animCtrl = null;
      mixer = null;
    }
  } else {
    // characterGLTF not yet loaded - remote will remain t-pose until loaded
    console.warn("⚠️ characterGLTF not loaded yet — remote player will remain T-pose until loaded");
  }

  const player = {
    id: peerId,
    model,
    mixer,
    animCtrl,        // may be null until characterGLTF exists
    actions: {},     
    currentAction: "idle",
    // authoritative / last received
    targetPos: new THREE.Vector3(),
    targetQuat: new THREE.Quaternion(),
    // store previous target+time so we can compute speed on next update
    _prevTargetPos: null,
    _prevTime: null,
    lastUpdateTime: performance.now() / 1000,
    // interpolation state
    interpPos: new THREE.Vector3(),
    interpQuat: new THREE.Quaternion(),
    floorOffset,
    firstSet: false,
    lastRecvTs: null,

    setState(state) {
      // normalize
      const p = Array.isArray(state.p) ? { x: state.p[0], y: state.p[1], z: state.p[2] } : (state.p || { x: 0, y: 0, z: 0 });
      const q = Array.isArray(state.q) ? { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] } : (state.q || { x: 0, y: 0, z: 0, w: 1 });

      // store previous for speed calc
      if (this._prevTargetPos === null) {
        this._prevTargetPos = this.targetPos.clone();
        this._prevTime = this.lastUpdateTime || (performance.now() / 1000);
      }

      // update authoritative target
      this.targetPos.set(p.x, p.y, p.z);
      this.targetQuat.set(q.x, q.y, q.z, q.w);
      const now = performance.now() / 1000;
      const dt = Math.max(1e-6, now - (this._prevTime || now));

      // compute speed = distance / dt using previous target (if available)
      const dist = this._prevTargetPos ? this._prevTargetPos.distanceTo(this.targetPos) : 0;
      const speed = dist / dt;

      // compute yaw delta to detect left/right turning
      let left = false, right = false;
      try {
        const prevYaw = new THREE.Euler().setFromQuaternion(this._prevTargetPos ? this._prevTargetPosQuaternion || new THREE.Quaternion() : new THREE.Quaternion(), "YXZ").y;
      } catch (e) {
        // fallback: compute from _prev quaternion if available
      }

      // store current quaternion for next delta
      this._prevTargetPosQuaternion = this.targetQuat.clone();
      this._prevTargetPos.copy(this.targetPos);
      this._prevTime = now;
      this.lastUpdateTime = now;

      // Decide run vs walk thresholds (tune these)
      const WALK_THRESHOLD = 0.05; // m/s (very small movement = idle)
      const RUN_THRESHOLD = 8.0;   // m/s

      const run = speed >= RUN_THRESHOLD;
      const moving = speed >= WALK_THRESHOLD;

      // compute left/right via yaw delta (optional, tolerant threshold)
      // We'll compute yaw difference between prev and current quaternions if prev exists
      if (this._prevTargetPosQuaternion) {
        const prevEuler = new THREE.Euler().setFromQuaternion(this._prevTargetPosQuaternion, "YXZ");
        const curEuler = new THREE.Euler().setFromQuaternion(this.targetQuat, "YXZ");
        let yawDelta = curEuler.y - prevEuler.y;
        // normalize to [-PI,PI]
        while (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
        while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;
        const TURN_THRESHOLD = 0.15; // radians ~ 8.6 deg
        if (yawDelta > TURN_THRESHOLD) right = true;
        else if (yawDelta < -TURN_THRESHOLD) left = true;
      }

      // Apply animation state via animCtrl if present
      if (this.animCtrl && typeof this.animCtrl.setNPCAnimationState === "function") {
        try {
          this.animCtrl.setNPCAnimationState(speed, { left, right, moving, run });
        } catch (e) {
          // safe ignore
        }
      } else {
        // fallback: if user provided 'a' field, try to play that (existing code)
        if (state.a && typeof this.setAnimationState === "function") {
          try { this.setAnimationState(state.a); } catch (e) {}
        }
      }

      // place instantly to avoid popping; interpolation will smooth later
      this.interpPos.copy(this.targetPos);
      this.interpQuat.copy(this.targetQuat);
      this.model.position.set(this.interpPos.x, this.interpPos.y + (this.floorOffset || 0), this.interpPos.z);
      this.model.quaternion.copy(this.interpQuat);
      this.firstSet = true;
    },

    update(dt) {
      // interpolation and mixer update
      const posAlpha = 1 - Math.exp(-20 * dt);   // slightly faster follow for pos
      const rotAlpha = 1 - Math.exp(-6 * dt);    // slightly slower rotation smoothing
      this.interpPos.lerp(this.targetPos, posAlpha);
      this.interpQuat.slerp(this.targetQuat, 0.05);
      if (this.interpPos.y > 50) this.interpPos.y = 0; // clamp
      this.model.position.copy(this.interpPos).add(new THREE.Vector3(0, this.floorOffset || 0, 0));
      this.model.quaternion.copy(this.interpQuat);
      if (this.mixer) this.mixer.update(dt);
    }

  };

  remotePlayers.set(peerId, player);
  // window.REMOTEPLAYERS = remotePlayers; 
  console.warn('[RemotePlayer] addRemotePlayer', peerId);
  return player;
}


// expect THREE in scope, remotePlayers Map defined elsewhere
// remotePlayers is Map<string, { mesh, lastPos:THREE.Vector3, lastQuat:THREE.Quaternion, lastUpdateTime:number, mixer?:THREE.AnimationMixer }>
export function updateRemotePlayerState(peerId, state) {
  if (!peerId) return;

  const pData = Array.isArray(state.p)
    ? { x: state.p[0], y: state.p[1], z: state.p[2] }
    : (state.p || { x: 0, y: 0, z: 0 });
  const qData = Array.isArray(state.q)
    ? { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] }
    : (state.q || { x: 0, y: 0, z: 0, w: 1 });

  if (!remotePlayers.has(peerId)) addRemotePlayer(peerId);
  const entry = remotePlayers.get(peerId);
  if (!entry) return;

  // --- drop out-of-order packets using uint16 ts (wrap-aware) ---
  try {
    const incomingTs = state.ts ?? null;
    if (incomingTs !== null) {
      if (entry.lastRecvTs != null) {
        // compute diff in unsigned 16-bit space
        const diff = (incomingTs - entry.lastRecvTs + 65536) % 65536;
        // if diff == 0 => duplicate; if diff > 32767 => this packet is older (wrap-around)
        if (diff === 0 || diff > 32767) {
          return;
        }
      }
      entry.lastRecvTs = incomingTs;
    }
  } catch(e) {
    // non-fatal — continue if anything goes wrong
  }



  const prevPos = entry.targetPos.clone();
  const prevTime = entry.lastUpdateTime || (performance.now() / 1000);

  entry.targetPos.set(pData.x, pData.y, pData.z);
  entry.targetQuat.set(qData.x, qData.y, qData.z, qData.w);

  const isGuidedTour = !!(state.camLookAt && state.camPos);


    // If camera look direction is provided (from host), align model to face it
    // if (state.camLookAt && state.camPos) {
    //   try {

    //     const camPos = new THREE.Vector3(state.camPos.x, state.camPos.y, state.camPos.z);
    //     const camLook = new THREE.Vector3(state.camLookAt.x, state.camLookAt.y, state.camLookAt.z);
    //     const dir = camLook.clone().sub(camPos).normalize();

    //     // Build a rotation matrix using the direction and world up
    //     const up = new THREE.Vector3(0, 1, 0);
    //     const m = new THREE.Matrix4();
    //     m.lookAt(new THREE.Vector3(0, 0, 0), dir, up);

    //     // Convert to quaternion
    //     const lookQuat = new THREE.Quaternion().setFromRotationMatrix(m);
        
    //     // Apply — NOTE: many models face -Z, so rotate 180° if needed
    //     const correction = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
    //     lookQuat.multiply(correction);

    //     entry.targetQuat.copy(lookQuat);


    //     // entry.targetQuat.copy(lookQuat);
    //     // entry.model.quaternion.copy(lookQuat);
    //     // entry.model.quaternion.slerp(lookQuat, 0.12);

    //   } catch (e) {
    //     console.warn("[RemotePlayer] look-at alignment failed", e);
    //   }
    // }

  if (isGuidedTour) {
    try {
    const camPos = new THREE.Vector3(state.camPos.x, state.camPos.y, state.camPos.z);
    const camLook = new THREE.Vector3(state.camLookAt.x, state.camLookAt.y, state.camLookAt.z);
    const dir = camLook.clone().sub(camPos).normalize();

    // Build a rotation matrix using the direction and world up
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    m.lookAt(new THREE.Vector3(0, 0, 0), dir, up);

    // Convert to quaternion
    const lookQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    
    // Apply — NOTE: many models face -Z, so rotate 180° if needed
    const correction = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
    lookQuat.multiply(correction);

    // ⭐ THE FIX: OVERWRITE TARGET QUATERNION. The smoothing happens elsewhere.
    entry.targetQuat.copy(lookQuat); 

    } catch (e) {
    console.warn("[RemotePlayer] look-at alignment failed", e);
    }
  }

  const WALK_THRESHOLD = 0.3; // 0.3 m/s → idle→walk
  const RUN_THRESHOLD  = 8.0; // 3.0 m/s → walk→run

  const now = performance.now() / 1000;
  const dt = Math.max(1e-6, now - prevTime);
  const dist = prevPos.distanceTo(entry.targetPos);
  const speed = dist / dt; // m/s
  entry.lastUpdateTime = now;
  
  if (entry.mixer){
    entry.mixer.timeScale = 0.6;
  }

  const run = speed >= RUN_THRESHOLD;

  // ---------------------------
  // Corrected thresholds (match local player's)
  // ---------------------------


  // Optional: turning detection
  let left = false, right = false;
  if (entry._prevQuat) {
    const prevEuler = new THREE.Euler().setFromQuaternion(entry._prevQuat, "YXZ");
    const curEuler  = new THREE.Euler().setFromQuaternion(entry.targetQuat, "YXZ");
    let yawDelta = curEuler.y - prevEuler.y;
    while (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
    while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;
    const TURN_THRESHOLD = 0.15;
    if (yawDelta > TURN_THRESHOLD) right = true;
    else if (yawDelta < -TURN_THRESHOLD) left = true;
  }
  entry._prevQuat = entry.targetQuat.clone();

  // ---------------------------
  // Apply animation
  // ---------------------------
  if (entry.animCtrl && typeof entry.animCtrl.setNPCAnimationState === "function") {
    try {
      entry.animCtrl.setNPCAnimationState(speed - 0.3, { left, right, run });
    } catch (err) {
      console.warn("[RemotePlayer] animCtrl error:", err);
    }
  }

  // Update target pos/rot for interpolation
  entry.targetPos.set(pData.x, pData.y, pData.z);
  // entry.targetQuat.set(qData.x, qData.y, qData.z, qData.w);
  entry.lastUpdateTime = now;

  // --- Spatial audio: update remote sound position ---
  if (window.remoteAudioNodes && remoteAudioNodes.has(peerId)) {
    const node = remoteAudioNodes.get(peerId);
    if (node.panner && msg.p) {
      const [x, y, z] = msg.p; // assuming position is array [x,y,z]
      const t = window.audioCtx?.currentTime || 0;
      node.panner.positionX.setValueAtTime(x, t);
      node.panner.positionY.setValueAtTime(y, t);
      node.panner.positionZ.setValueAtTime(z, t);
    }
  }

}

export function removeRemotePlayer(peerId) {
  const p = remotePlayers.get(peerId);
  if (!p) return;
  try {
    scene.remove(p.model);
    // optionally dispose geometries / materials here to free memory
  } catch (e) { /* ignore */ }
  remotePlayers.delete(peerId);
  if (REMOTE_LOAD_RETRY[peerId]) {
    clearTimeout(REMOTE_LOAD_RETRY[peerId]);
    delete REMOTE_LOAD_RETRY[peerId];
  }
  // window.REMOTEPLAYERS = remotePlayers;
  console.warn('[RemotePlayer] removeRemotePlayer', peerId);
}

// Call this from  main animate loop in index.js:
export function updateRemotePlayers(dt) {
  for (const p of remotePlayers.values()){
    if (p.mixer) p.mixer.update(dt);
    p.update(dt);
  }
} 


export function getLocalPlayerState() {
  // Ensure tpView & model exist
  if (tpView && tpView.model && tpView.playerCollider) {

    
    // --- Position (feet on floor)
    const bottom = tpView.playerCollider.start
      ? tpView.playerCollider.start.y - (tpView.playerCollider.radius || 0)
      : tpView.model.position.y;
    const pos = tpView.model.position.clone();
    pos.y = bottom;

    // --- Rotation from model
    const quat = tpView.model.quaternion.clone();

    // --- Animation state
    let animState = "idle";
    if (tpView.isWalking) animState = "walk";
    else if (tpView.isRunning) animState = "run";

    // --- 🔴 Compute camera direction using player model orientation
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();
    const camPos = tpView.model.position.clone();
    const camLookAt = camPos.clone().add(forward);

    return {
      p: [pos.x, pos.y, pos.z],
      q: [quat.x, quat.y, quat.z, quat.w],
      a: animState,
      camPos: { x: camPos.x, y: camPos.y, z: camPos.z },
      camLookAt: { x: camLookAt.x, y: camLookAt.y, z: camLookAt.z }
    };
  }

  // fallback if model not yet loaded
  if (tpView && tpView.getCamera) {
    const camera = tpView.getCamera();
    if (camera) {
      const cp = camera.position;
      const cq = camera.quaternion;
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cq).normalize();
      const lookAt = cp.clone().add(forward);
      return {
        p: [cp.x, 0, cp.z],
        q: [cq.x, cq.y, cq.z, cq.w],
        camPos: { x: cp.x, y: cp.y, z: cp.z },
        camLookAt: { x: lookAt.x, y: lookAt.y, z: lookAt.z }
      };
    }
  }

  return { p: [0, 0, 0], q: [0, 0, 0, 1] };
}



export function getCurrentNPCState() {
  const NPC_MODEL = npcAgents?.[0]?.model ?? null;
  if (!NPC_MODEL) {
    console.warn("[Host] No NPC model found");
    return null;
  }

  // get camera lookat 
    // Host camera world position
  let camPos = null;
  let camLookAt = null;
  try {
    if (typeof camera !== 'undefined' && camera) {
      camPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };

      // compute a world-space lookAt point by projecting current view direction forward
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir); // normalized
      const lookDistance = 10.0; // meters ahead (tweakable)
      const lookPoint = camera.position.clone().addScaledVector(dir, lookDistance);
      camLookAt = { x: lookPoint.x, y: lookPoint.y, z: lookPoint.z };
    }
  } catch (e) {
    // ignore, optional camera info
  }

  return {
    p: { x: NPC_MODEL.position.x, y: NPC_MODEL.position.y, z: NPC_MODEL.position.z },
    q: { x: NPC_MODEL.quaternion.x, y: NPC_MODEL.quaternion.y, z: NPC_MODEL.quaternion.z, w: NPC_MODEL.quaternion.w },
    npcName: NPC_MODEL.name || "unknown",
    camPos,
    camLookAt
  };
}
window.NPC_MODEL = npcAgents && npcAgents.length > 0 ? npcAgents[0].model : null; // debug handle
window.AGENTS = npcAgents; // debug handle
window.NPC = npcAgents[0]; // debug handle
window.getCurrentNPCState = getCurrentNPCState; // debug handle



export function initializeGame(targetContainerId = 'model-container') {
    container = document.getElementById(targetContainerId);
    if (!container) {
        console.error(`Game container with ID '${targetContainerId}' not found.`);
        return;
    }
    container.innerHTML = ''; 
    
    camera = new THREE.PerspectiveCamera(70, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ';

    cssRenderer = new CSS2DRenderer();
    cssRenderer.domElement.style.position = 'absolute';
    cssRenderer.domElement.style.top = '0';
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    container.style.display = 'block';
    container.appendChild(cssRenderer.domElement);

    // css3dRenderer = new CSS3DRenderer();
    // css3dRenderer.domElement.style.position = 'absolute';
    // css3dRenderer.domElement.style.top = '0';
    // css3dRenderer.setSize(container.clientWidth, container.clientHeight);
    // container.appendChild(css3dRenderer.domElement);

    // renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1)); // dynamic res clamp
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Use soft shadows
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color("#f0f0f0"), 1); // Set background color and opacity
    renderer.physicallyCorrectLights = true; // Enable physically correct lighting
    renderer.autoClear = false; // Allow multiple render passes


    // Append the renderer to the container
    container.appendChild(renderer.domElement);
    container.tabIndex = 0;
    setTimeout(() => container.focus(), 50);

    composer = new EffectComposer(renderer);
    window.composer = composer;


    const renderPass = new RenderPass(scene , camera);
    renderPass.clear = true; // ensure it clears before rendering
    renderPass.clearAlpha = 1; // set clear alpha to fully opaque
    composer.addPass(renderPass);

    outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene , camera);
    outlinePass.edgeStrength = 8;
    outlinePass.edgeGlow = 1;
    outlinePass.edgeThickness = 2;
    outlinePass.pulsePeriod = 2;
    outlinePass.visibleEdgeColor.set("#ffffff");
    outlinePass.hiddenEdgeColor.set("#ffffff");
    outlinePass.hiddenEdgeColor.multiplyScalar(1); // effectively transparent
    outlinePass.renderToScreen = false;      // if it's the last pass
    outlinePass.enabled = false;
    outlinePass.clear = false;              // don’t clear the whole buffer
    // outlinePass.clearAlpha = 0;             // transparent, not black
    composer.addPass(outlinePass);
    composer.addPass(new OutputPass());

    const clearAllInputs = () => {
        if (fpView) fpView.resetControls();
        if (tpView) tpView.resetControls();
    }


    window.addEventListener('resize', onWindowResize);

    window.addEventListener('blur', clearAllInputs);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearAllInputs();
    });
    document.addEventListener('pointerlockchange', () => {
        if (!document.pointerLockElement) clearAllInputs();
    });


    window.addEventListener('keydown', (event) => {
      // If modal is open and the user is NOT typing into a form control, block these game keys
      // NEW CHECK: Ignore event if an input element is focused ***
      const isInput = event.target.closest('input, textarea, select, [contenteditable="true"]');
      if (isInput) {
          return; // Exit the handler immediately if typing in a form field
      }

      if (event.code === 'KeyV'){
          // active toogle to switch between first and third view
          activePlayer === 'fp' ? activateThirdPerson() : activateFirstPerson();
          
      }

      // 'I' key to start/stop tour with first NPC
      if (event.code === 'KeyI') {
        const navQ = getNavQuery() ?? navQuery;
        if (!navQ) {
          console.warn('Cannot start tour: navQuery not ready');
        } else if (!npcAgents || npcAgents.length === 0) {
          console.warn('No NPCs available to tour with');
        } else {
          const npc = npcAgents[0];
          console.warn("NPC NAME GET INSIDE INDEX.JS IS: ", npc.model.name);
          if (!npc) return;

          if (npc.state?.touring) {
            // --- STOP TOUR ---
            console.log("Stopping tour...");
            stopAgentTour(npc);
            npc.state.touring = false;
            
            // Stop play audio
            
            stopAudio();
          try {
            const npcName = npc.model?.name || (npc.model?.userData && npc.model.userData.tourId) || null;
            if (typeof stopRoomTourBroadcast === 'function') {
              // change stopRoomTourBroadcast to accept npcName (see next section)
              stopRoomTourBroadcast(npcName);
            } else {
              // fallback: send vine-style if webRTC sendLocalState is available
              if (typeof sendLocalState === "function") {
                sendLocalState({ t: "tour", cmd: "stop", npcName, ts: Date.now() });
              }
            }
          } catch (e) { console.warn("tour stop broadcast failed:", e); }


            if (activePlayer === 'tp' && tpView && tpView.isTouring) {
              tpView.isTouring = false;
              if (typeof tpView.stopFollowAgent === 'function') {
                tpView.stopFollowAgent();
              }
            } else if (activePlayer === 'fp' && fpView && fpView.isTouring) {
              fpView.isTouring = false;
              if (typeof fpView.stopFollowAgent === 'function') {
                fpView.stopFollowAgent();
              }
            }
          } else {
              // --- START TOUR ---
              console.log("Starting tour...");
              npc.state = npc.state || {};
              npc.state.touring = true;

              startAgentTour(npc, pictureFramesArray, navQ, {
                loop: false,
                holdTime: 3.0,
                desiredDistance: 2.0,
                gait: 'walk',
                targetsMap: tourTargetsMap
              });

              if (window._IS_HOST && typeof window.hostStartTour === 'function') {
                console.log("Broadcasting Tour Invite...");
                window.hostStartTour(npc.model);
              }

              // --- Always prepare TP agent, even if not active now ---
              if (tpView && tpView.model) {
                if (crowd && !tpView.crowdAgent) {
                  addThirdPersonToCrowd(scene, crowd, tpView);
                }
                // Sync position so that when switching to TP later, it's aligned
                if (tpView.crowdAgent && npc.model) {
                  const npcPos = npc.model.position;
                  try {
                    if (typeof tpView.crowdAgent.teleport === 'function') {
                      tpView.crowdAgent.teleport({ x: npcPos.x, y: npcPos.y, z: npcPos.z });
                    } else {
                      tpView.crowdAgent.position = { x: npcPos.x, y: npcPos.y, z: npcPos.z };
                    }
                  } catch (e) {
                    console.warn("Failed to sync TP agent start:", e);
                  }
                }
              }

              if (activePlayer === 'tp' && tpView) {
                tpView.isTouring = true;
                if (typeof tpView.startFollowAgent === 'function') {
                  tpView.startFollowAgent(npc);
                }
              } else if (activePlayer === 'fp' && fpView) {
                fpView.isTouring = true;
                if (typeof fpView.setFollowAgent === 'function') {
                  fpView.setFollowAgent(npc);
                }
              }
            }
          }
      }
        if (activePlayer === 'fp' && fpView) {
          fpView.onKeyDown(event);
        } else if (activePlayer === 'tp' && tpView) {
            tpView.onKeyDown(event);
          }
        });

    window.addEventListener('keyup', (event) => {
        if (activePlayer === 'fp' && fpView) {
            fpView.onKeyUp(event);
        } else if (activePlayer === 'tp' && tpView) {
            tpView.onKeyUp(event);
        }
    });




    raycasterManager = new RaycasterManager(camera, scene, container, {
         doorNames: Object.keys(doorState),
         onHoverPictureFrame: () => {},
         onClickPictureFrame: (frameName) =>{
          console.warn("CALL onClickPictureFrame")
          let imageMeshName = null;
            if (/^ImageMesh(\d{3})$/.test(frameName)){
              imageMeshName = frameName;
            }else {
              imageMeshName = FrameToImageMeshMap[frameName];
            }
            console.debug("CLICKING ON FRAME: ", imageMeshName)
            const assetData = annotationMesh[imageMeshName]
            console.warn("ASSET DATA: ", assetData)
            if(!imageMeshName || !assetData){
                console.warn("No image mapped for: ", frameName)
                return;
            }
            let assetURL = '';
            if (assetData.mesh.userData.category === 'Image'){
              assetURL = assetData.mesh.userData.imageSRC || '';
            }else if (assetData.mesh.userData.category === 'Video'){
              assetURL = assetData.mesh.userData.videoSRC || assetData.mesh.userData.backup_videoSRC || ''
            }
            const {annotationDiv} = assetData;
            // const {annotationDiv} = assetData;
            console.log(`User clicked frame: ${frameName} → mapped to: ${imageMeshName}`);
            console.log("Viet description: ", annotationMesh[imageMeshName].annotationDiv.getVietDes())
            console.log("Eng description: ", annotationMesh[imageMeshName].annotationDiv.getEngDes())
            displayUploadModal(1/1, { roomID: currentMuseumId, asset_mesh_name: imageMeshName }, assetURL, annotationDiv);
         },
        onDoorClick: (clickedObject) => {
            const parentName = clickedObject.parent?.name;
            if (!parentName || !mixer || !animation?.length) return;

            // Check if this is a configured door
            if (!raycasterManager.doorNames.includes(parentName)) return;

            interactedDoor = parentName

            isDoorOpen = doorState[parentName]

            // Play door-related animations
            animation.forEach((clip) => {
            const validClips = ["DoorAction", "HandleAction", "Latch.001Action"];
            if (validClips.includes(clip.name)) {
                const action = mixer.clipAction(clip);
                action.clampWhenFinished = true;
                action.loop = THREE.LoopOnce;
                action.timeScale = isDoorOpen ? -1 : 1;
                if (isDoorOpen) action.time = action.getClip().duration;
                action.reset().play();
                doorState[parentName] = !isDoorOpen
            }
            });
        },

        // onHoverPictureFrame: (object, isHovering) => {}
        onNPCPathFollow: (intersection) => {
          if (tpView.isTouring || fpView.isTouring) return; // ignore clicks during tour mode
          if (!navQuery) {
            console.warn('NavMesh or NPC is not ready. Cannot find path.');
            return;
          }
          if (!npcAgents || npcAgents.length === 0) {
            console.warn('No NPC agents available yet.');
            return;
          }

          const npcEntry = npcAgents[0];
          if (!npcEntry || !npcEntry.agent || !npcEntry.model) {
            console.warn('NPC entry not ready.');
            return;
          }

          const targetPoint = intersection.point;
          const closest = navQuery.findClosestPoint({ x: targetPoint.x, y: targetPoint.y, z: targetPoint.z });
          if (!closest?.point) {
            console.warn('Clicked point not near navmesh (no closest).', targetPoint);
            return;
          }


          // compute path length just once at click time
          const npcPos = npcEntry.model.position.clone();
          // Set a threshold to indicate in which distance the picture frame should lighting 
          // and the interaction occur
          let faceDirection = null;

          
          let closestPicture = null;
          const AREA_RADIUS = 1.5; // The "slack" or area of circle (meters)
          let targetDest = new THREE.Vector3(closest.point.x, closest.point.y, closest.point.z);


          // 1. Identify if any picture is within range
          for (const [frameName, blenderTarget] of tourTargetsMap) {
              const targetWorldPos = new THREE.Vector3();
              blenderTarget.getWorldPosition(targetWorldPos);

              // Check distance between click point and the Blender target center
              const closestPointVec = new THREE.Vector3(closest.point.x, closest.point.y, closest.point.z);
              const distToCircle = closestPointVec.distanceTo(targetWorldPos);

              if (distToCircle <= AREA_RADIUS) {
                  // NPC IS IN THE CIRCLE AREA!
                  // Snap the destination to the EXACT center of the blender target
                  targetDest.copy(targetWorldPos);
                  
                  // Find the actual picture linked to this target
                  closestPicture = pictureFramesArray.find(p => p.name === frameName);
                  
                  if (closestPicture) {
                      // Calculate precise rotation from the CENTER of the circle
                      const dummy = new THREE.Object3D();
                      dummy.position.copy(targetWorldPos);
                      const lookAtPoint = new THREE.Vector3(
                          closestPicture.position.x,
                          targetWorldPos.y, 
                          closestPicture.position.z
                      );
                      dummy.lookAt(lookAtPoint);

                      faceDirection = dummy.quaternion.clone();
                      npcEntry.state.tourFacingQuat = faceDirection;
                      npcEntry.state.currentPictureMesh = closestPicture;

                      // Visual Feedback: Light up the ring
                      if (blenderTarget.userData.visualRing) {
                          blenderTarget.userData.visualRing.material.opacity = 1.0;
                      }
                      
                      showInquiryPanel(closestPicture);
                      break; // Stop searching once we found our circle
                  }
              }
          }

          if (!closestPicture) {
              hideInquiryPanel();
              npcEntry.state.tourFacingQuat = null;
          }


          const startRes = navQuery.findClosestPoint({ x: npcPos.x, y: npcPos.y + 1.0, z: npcPos.z });
          const startPoint = startRes?.point ?? { x: npcPos.x, y: npcPos.y, z: npcPos.z };
          const endPoint = closest.point;

          const pathLength = computeNavPathLength(navQuery, startPoint, endPoint);
          const RUN_DISTANCE_THRESHOLD = 6.0; // tweak this threshold

          npcEntry.state = npcEntry.state || {};
          npcEntry.state.requestedGait = (pathLength >= RUN_DISTANCE_THRESHOLD) ? 'run' : 'walk';
          // update physical speed so walk is actually slower
          if (npcEntry.state.requestedGait === 'run') {
            npcEntry.agent.updateParameters({ maxSpeed: npcEntry.runSpeed });
          } else {
            npcEntry.agent.updateParameters({ maxSpeed: npcEntry.walkSpeed });
          }
          npcEntry.state.requestedGaitDistance = pathLength;

          const dest = new THREE.Vector3(endPoint.x, endPoint.y, endPoint.z);
          console.info('Click → world:', targetPoint, ' → snapped to navmesh point:', dest, 'pathLen=', pathLength);

          // pass entry + gait state to setAgentTarget
          setAgentTarget(npcEntry.agent, dest, navQuery, {
            entry: npcEntry,
            requestedGait: npcEntry.state.requestedGait,
            pathLength,
            // When the agent reaches 'dest', it should rotate to this orientation
            arrivalQuaternion: faceDirection
          });
          npcEntry.state.tourFacingQuat = faceDirection;
        }
    });
    raycasterManager.setOutlinePass(outlinePass);

    // Listen for showImage event from choice buttons
    document.addEventListener('showImage', (e) => {
      const { assetURL, title, vietnamese_description, english_description } = e.detail;
      DisplayImageOnDiv(assetURL, title, vietnamese_description, english_description);
    });

    initUploadModal(ktx2Loader);
    initMenu();
    loadModel();
    setGameScene(scene);

    if (animationFrameId === null) {
        animate();
    }
}

// function togglePictureLight(picture, shouldEnable) {
//     // Check if a light already exists on this picture
//     let light = picture.getObjectByName("exhibitSpotlight");

//     if (shouldEnable) {
//         if (!light) {
//             // Create a warm museum-style spotlight
//             light = new THREE.SpotLight(0xfffaf0, 10, 5, Math.PI / 4, 0.5, 2);
//             light.name = "exhibitSpotlight";
            
//             // Position it 1m in front and 1m above the painting
//             light.position.set(0, 1, 1); 
//             light.target = picture;
            
//             picture.add(light);
//         }
//         light.visible = true;
//     } else {
//         if (light) light.visible = false;
//     }
// }

// 2. Show Inquiry Panel
// --- 1. Helper: Manage History in SessionStorage ---


// --- 2. Update showInquiryPanel ---

function saveMessageToSession(cid, message) {
    const history = getChatHistory(cid);
    history.push({ ...message, timestamp: Date.now() });
    sessionStorage.setItem(`chat_${cid}`, JSON.stringify(history));
    
    // Immediately refresh the UI if the panel is open
    renderChatHistory(cid);
}

function getChatHistory(cid) {
    const rawData = sessionStorage.getItem(`chat_${cid}`);
    return rawData ? JSON.parse(rawData) : [];
}

function renderChatHistory(cid) {
    const historyContainer = document.getElementById('chat-history');
    if (!historyContainer) return;

    const history = getChatHistory(cid);

    historyContainer.innerHTML = history.map(msg => `
        <div class="message ${msg.role}">
            <div class="bubble">${marked.parse(msg.text)}</div>
        </div>
    `).join('');

    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function showTypingIndicator() {
    const historyContainer = document.getElementById('chat-history');
    if (!historyContainer) return;

    // 1. Check if it already exists to avoid duplicates
    let indicator = document.getElementById('gemini-typing');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'gemini-typing';
        indicator.className = 'message gemini typing'; // Uses existing gemini styles
        
        indicator.innerHTML = `
            <div class="bubble">
                <span class="typing-text">Museum Assistant is analyzing...</span>
                <span class="dot-flashing"></span>
            </div>
        `;
        
        historyContainer.appendChild(indicator);
    }

    // 2. Scroll to the bottom so the user sees the "thinking" state
    historyContainer.scrollTop = historyContainer.scrollHeight;
}

function hideTypingIndicator() {
    const indicator = document.getElementById('gemini-typing');
    if (indicator) {
        indicator.remove(); // Completely remove from DOM
    }
}

window.showInquiryPanel = function(picture) {
    const panel = document.getElementById('museum-ui');
    const titleElement = document.getElementById('picture-title');
    const input = document.getElementById('user-inquiry');

    // 1. Map the Frame to the actual Image Mesh
    // Handle cases where 'picture' might be the wrapper object or the raw mesh
    const meshName = picture.isMesh ? picture.name : picture.mesh.name;
    const correspondingImageMesh = FrameToImageMeshMap[meshName];
    
    if (panel && correspondingImageMesh) {
        
        
        // 2. Set the UI Title
        titleElement.innerText = annotationMesh[correspondingImageMesh].title || "Unknown Artwork";
        window.description = annotationMesh[correspondingImageMesh].viet_des;
        input.value = ""; 

        // 3. Extract the webp_cid from userData
        const webp_cid = annotationMesh[correspondingImageMesh].imageSRC
        console.log("WEBP_CID IS: ", webp_cid)
        // 4. Load and show history for this specific image content
        // This calls the helper function that uses sessionStorage.getItem(`chat_${cid}`)
        renderChatHistory(webp_cid);
        
        // 5. Show the panel
        panel.classList.add('visible');
    } else {
        console.warn("[showInquiryPanel] Could not find mesh or annotation for:", picture.name);
    }
};

/**
 * Function to enlight the the circle at the destination in front of each picture frame 
 * so that player can easily move the NPC to in front of each picture easily
 */
function visualizeAllNPCTargets() {
    tourTargetsMap.forEach((targetObject, frameName) => {
        // 1. Get world position of the Blender 'Plain Axe'
        const worldPos = new THREE.Vector3();
        targetObject.getWorldPosition(worldPos);

        // 2. Create the Gemini-style ring
        const ringGeom = new THREE.RingGeometry(0.35, 0.4, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xfffff0, // Ivory
            transparent: true,
            opacity: 0.4, // Dimmer since they are always visible
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        
        // 3. Flatten and position
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(worldPos);
        ring.position.y += 0.02; // Prevents flickering (z-fighting)

        // 4. Add a subtle PointLight for each
        const pointLight = new THREE.PointLight(0xfffff0, 0.5, 2);
        pointLight.position.copy(worldPos);
        pointLight.position.y += 0.5;

        scene.add(ring);
        scene.add(pointLight);
        
        // Store the visual group in the object for easy access/highlighting
        targetObject.userData.visualRing = ring;
    });
}

// 3. Hide Inquiry Panel
window.autoScaleInput = function(element) {
    // Reset height to diminish if text is deleted
    element.style.height = 'auto';
    
    // Set new height based on scrollHeight (content height)
    // We limit it to 150px so it doesn't cover the whole screen
    // const newHeight = Math.min(element.scrollHeight, 150);
    element.style.height = element.scrollHeight + 'px';
}

// Update hideInquiryPanel to reset the height when closed
window.hideInquiryPanel = function() {
    const panel = document.getElementById('museum-ui');
    const input = document.getElementById('user-inquiry');
    if (panel) {
        panel.classList.remove('visible');
        // Reset height for next time
        if (input) input.style.height = 'auto';
    }
};



// 4. Handle Sending Data
async function handleSendInquiry() {
    const inquiryInput = document.getElementById('user-inquiry');
    const prompt = inquiryInput.value;
    const finalPrompt = prompt + "Base on the description of the artwork below and try to make the response relevant to the artwork. If you can find the related information then please add to the response.Here is the description:" + window.description;
    if (!finalPrompt.trim()) return;
    // 1. Identify which picture the NPC is currently at
    const npcEntry = npcAgents[0]; 
    const currentPicture = npcEntry?.state?.currentPictureMesh;
    if (!currentPicture) {
        console.error("No picture selected!");
        return;
    }

    let correspondingImageMesh = null;
    try {
        // Handle both raw meshes and wrapped objects
        const meshName = currentPicture.isMesh ? currentPicture.name : currentPicture.mesh.name;
        correspondingImageMesh = FrameToImageMeshMap[meshName];
    } catch (e) {
        console.error("[handleSendInquiry] Failed to find corresponding ImageMesh", e);
        return;
    }

    // GET THE CID: This is unique key for storage
    const webp_cid = annotationMesh[correspondingImageMesh].imageSRC;
    const playerID = sessionStorage.getItem("player_id") || "guest";

    // 2. Save User Message to Session History (Stored by CID)
    saveMessageToSession(webp_cid, { role: "user", text: prompt });

    // 3. UI Updates: Clear input and show "Museum Assistant is thinking..."
    inquiryInput.value = '';
    showTypingIndicator(webp_cid); 

    try {
        // 4. Call Backend (Passing the webp_cid to Go backend)
        const answer = await GenAI(webp_cid, finalPrompt, playerID);

        // 5. Save AI Response & Remove Typing Indicator
        hideTypingIndicator();
        saveMessageToSession(webp_cid, { role: "assistant", text: answer });
        
        console.log(`History for CID ${webp_cid}:`, getChatHistory(webp_cid));

    } catch (err) {
        hideTypingIndicator();
        console.error("Failed to get AI answer:", err);
        saveMessageToSession(webp_cid, { role: "assistant", text: "I'm sorry, I'm having trouble connecting to the museum archives." });
    }
}

document.getElementById('send-button').addEventListener('click', handleSendInquiry);

document.getElementById('user-inquiry').addEventListener('keydown', function(e) {
    // If Enter is pressed without Shift
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); // Prevent new line
        handleSendInquiry(); // Trigger send function
    }
});


// ... (stopGame function is unchanged)
export function stopGame() {
    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    clearSceneObjects(scene);
    renderer?.dispose();
    container?.remove();

}