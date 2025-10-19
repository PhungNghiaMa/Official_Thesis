// src/game_logic/index.js

import "../../main.css";

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import FirstPersonPlayer from './control';
import ThirdPersonPlayer from "./ThirdPersonPlayer.js";
import AnnotationDiv from "./annotationDiv";
import { displayUploadModal, initUploadModal , Mapping_PictureFrame_ImageMesh , DisplayImageOnDiv} from "./utils";
import { GetRoomAsset } from "./services";
import { Museum } from "./constants";
import { Capsule, DRACOLoader} from "three/examples/jsm/Addons.js";
import RaycasterManager from "./raycaster.js"
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { KTX2Loader } from "three/examples/jsm/Addons.js";
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
// import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Sphere } from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { initRecastIfNeeded  , getNavQuery , LoadExternalNavMesh } from "./recastNav.js";
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { updateCrowd , addAgent, initCrowd, setAgentTarget, startAgentTour , updateAgentTours , stopAgentTour  } from "./CrowdManager.js";
import { createAnimController } from "./createAnimationController.js";
import { addThirdPersonToCrowd } from './CrowdManager.js';



THREE.Cache.enabled = true; // Enable caching for better performance

// --- Global variables for the game, now scoped within this module ---
const clock = new THREE.Clock();
const scene = new THREE.Scene();

let menuOpen = false;
let currentMuseumId = Museum.ART_GALLERY;

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
let cameraCollider = new Sphere(new THREE.Vector3(), 0.35)

// Floor instance 
let floorMesh = null, maxArea = 0, fallbackY = Infinity, fallbackX = 0, fallbackZ = 0, floorBoxMaxY = null, count = 0;

// Progress loading instance 
let currentProgress = 0;
let targetProgress = 0;

// Light instance
let ambientLight , hemiLight , spot1 , spot2 , sun;

// instance for post-processing
let composer , outlinePass , renderPass;
let currentlyHoveredObject = null;

// put these once near your input setup in index.js
let camYaw = 0;
let camPitch = 0;

// NPC instance 
let museumNPC = null;


// AssetDataMap to store and quickly extract data for each image mesh to use in room tour mode
export const AssetDataMap = new Map()

// Instance of navmesh building 
let navQuery = null;
let navMesh = null;
let crowd = null;
const npcAgents = [];

const navInputSet = new Set();   // meshes to feed into recast (floor + obstacles)
const bvhMeshList = [];          // meshes used for BVH raycasts (ground snap + capsule checks)
const navInputMeshes = [];   // meshes we will pass to recast
let  pictureFramesArray = [];

// PINATA URL 
const PINATA_URL = import.meta.env.MODE === "production"
    ? import.meta.env.VITE_PINATA_PRIVATE_GATEWAY // Use VITE_ prefix
    : import.meta.env.VITE_PINATA_PRIVATE_GATEWAY;     // Use VITE_ prefix


// Container instance 
let loadingManager = document.getElementById('loading-container');
let loaderContainer = document.getElementById('loader-container');
let backgroundPositionX;
// THREE loading managers
const LoadingManager = new THREE.LoadingManager();

LoadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
    console.log(`Started loading: ${url}. Loaded ${itemsLoaded} of ${itemsTotal} files.`);
    loadingManager.style.display = 'flex';
    loadingManager.style.opacity = '1';
    loadingManager.style.backgroundColor = 'black';

    const loader = document.getElementById('loader-container');
    if (loader) loader.style.setProperty('--fill', '100%'); // start empty
};

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

LoadingManager.onError = (url) => {
    console.error(`There was an error loading: ${url}`);
};


const doorState = {
    Door001: false,
    Door002: false
}
let interactedDoor;
export const FrameToImageMeshMap = {};

const ModelPaths = {
    [Museum.ART_GALLERY]: "optimizedModel/optimizeModel_19.glb",
    [Museum.LOUVRE]: "art_hallway/VIRTUAL_ART_GALLERY_3.gltf",
}
let raycasterManager = null
let imageMeshesArray = [];
let doorBoundingBox = null;
let hasEnteredNewScene = false;
let tourTargetsMap = new Map();

// DOM Elements
let container, cssRenderer, css3dRenderer, renderer, camera;

// Animation frame request ID to stop/start the loop
let animationFrameId = null;


function onWindowResize() {
    if (!container || !camera || !renderer || !cssRenderer || !css3dRenderer) return;

    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    // camera.position.set(0,0,0);

    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(new THREE.Color("#f0f0f0"), 1); // Color and full opacity
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    css3dRenderer.setSize(container.clientWidth, container.clientHeight);
    if (composer) composer.setSize(container.clientWidth, container.clientHeight);
    if (outlinePass) outlinePass.setSize(container.clientWidth, container.clientHeight);
}

function hideAnnotations() {
    Object.values(annotationMesh).forEach(({ label }) => {
        if (label && label.element) label.element.style.opacity = "0";
    });
}

function showAnnotations() {
    Object.values(annotationMesh).forEach(({ label }) => {
        if (label && label.element) label.element.style.opacity = "100";
    });
}

// Audio instance 
export const audioCache = new Map();
export const audioRawCache = new Map();       // CID -> ArrayBuffer (raw)
let audioContext = null;
let currentSourceNode = null; // Keep track of the currently playing source for potential stopping

function getAudioContext() {
    if (audioContext === null) {
        // 1. Get the correct constructor: use the standard one, 
        //    or the vendor-prefixed one for older Safari/Chrome.
        const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;

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

export async function prefetchAudio(audioCID) {
  if (!audioCID) return null;
  if (audioCache.has(audioCID) || audioRawCache.has(audioCID)) return; // already cached

  try {
    const url = `https://${PINATA_URL}${audioCID}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);

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
        console.log(`🎧 Audio pre-decoded for ${audioCID}`);
      } catch (err) {
        console.warn(`decodeAudioData failed for ${audioCID}`, err);
      }
    });

  } catch (error) {
    console.error(`❌ Error prefetching ${audioCID}:`, error);
  }
}

export async function playAudio(audioCID) {
  const context = getAudioContext();
  if (!context) return;

  if (currentSourceNode) {
    try { currentSourceNode.stop(); } catch {}
    currentSourceNode = null;
  }

  let buffer = audioCache.get(audioCID);
  if (!buffer) {
    const raw = audioRawCache.get(audioCID);
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
      console.warn(`Audio for CID ${audioCID} not prefetched.`);
      prefetchAudio(audioCID); // fallback fetch
      return;
    }
  }

  if (context.state !== "running") {
    await context.resume().catch(() => {});
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);

  source.onended = () => {
  try { source.disconnect(); } catch {}
    if (currentSourceNode === source) currentSourceNode = null;
    if (typeof onEnded === "function") {
      try { onEnded(); } catch (e) { console.warn("onEnded callback error", e); }
    }
  };
  source.start(0);
  currentSourceNode = source;
}

export function stopAudio() {
    if (currentSourceNode) {
        currentSourceNode.stop();
        currentSourceNode = null;
        console.log("Audio stopped.");
    }
}

document.addEventListener("click", () => {
    const context = getAudioContext();
    if (context && context.state !== 'running') {
        context.resume().then(() => {
            console.log("AudioContext resumed on user interaction.");
        }).catch(e => console.error("Error resuming AudioContext:", e));
    }
}, { once: true });




// NOTE: Make sure ktx2Loader and renderer are defined and accessible in the scope.
function setImageToMeshKTX2(scene, meshName, imgURL) { // Renamed imgUrl to imgURL for clarity

    // Use the KTX2Loader instance
    ktx2Loader.load(imgURL,
        (loadedTexture) => {
            // Most of these settings are managed by the KTX2Loader/Basis Transcoder, 
            // but we might keep some for safety or specific overrides.
            loadedTexture.needsUpdate = true;
            
            // KTX2 often handles its own colorspace and filtering internally based on the file.
            // You can remove most explicit texture properties (like flipY, filters, mipmaps).

            const material = new THREE.MeshStandardMaterial({
                map: loadedTexture,
                side: THREE.DoubleSide,
                roughness: 0.5,
                metalness: 0.0,
            });

            let mesh = scene.getObjectByName(meshName)
            if (mesh && mesh.isMesh) {
                // Safely dispose of the old material's texture to free memory
                if (mesh.material.map) {
                    mesh.material.map.dispose();
                }
                mesh.material.dispose();
                
                mesh.material = material;
                mesh.material.needsUpdate = true;
                // UV update is rarely needed here unless the geometry itself changed
            } else {
                console.warn(`Cannot find mesh for ${meshName}`)
            }
        },
        undefined, // Progress is optional
        (error) => {
            console.error('Error loading KTX2 texture:', error);
        }
    );
}



document.body.addEventListener("uploadevent", (event) => {
    const { asset_mesh_name, title, vietnamese_description, english_description, img_url } = event.detail;

    if (annotationMesh[asset_mesh_name]) {
        annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, vietnamese_description,english_description);
        annotationMesh[asset_mesh_name].title = title;
        annotationMesh[asset_mesh_name].viet_des = vietnamese_description;
        annotationMesh[asset_mesh_name].eng_des = english_description;
        setImageToMeshKTX2(currentScene,asset_mesh_name, img_url);
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

// Main model loader 
const loader = new GLTFLoader(LoadingManager).setPath('/assets/');
loader.setDRACOLoader(dracoLoader);
loader.setKTX2Loader(ktx2Loader);

// Character model loader 
const characterLoader = new GLTFLoader().setPath('/assets/');
characterLoader.setDRACOLoader(dracoLoader);
characterLoader.setKTX2Loader(ktx2Loader);



function clearSceneObjects(obj) {
    if (mixer) {
        mixer.stopAllAction();
        mixer = null;
    }
    while (obj.children.length > 0) {
        const child = obj.children[0];
        clearSceneObjects(child);
        obj.remove(child);
    }
    if (obj.geometry) obj.geometry.dispose();
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
}

function checkPlayerPosition() {
    if (doorBoundingBox && !hasEnteredNewScene && hasLoadPlayer) {
        const playerPosition = fpView.getPlayerPosition();
        if (doorBoundingBox.distanceToPoint(playerPosition) < 4 && doorState[interactedDoor]) {
            hasEnteredNewScene = true;
            const nextMuseum = currentMuseumId === Museum.ART_GALLERY ? Museum.LOUVRE : Museum.ART_GALLERY;
            setMuseumModel(nextMuseum);
        }
    }
}

// Material Tuning Function
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
    material.shadowSide = THREE.FrontSide;   // Fix shadow rendering
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

    // ✅ Important: use FrontSide (so walls don’t render inside)
    material.side = THREE.DoubleSide;

    // Update all maps
    const mapNames = ['map', 'emissiveMap', 'aoMap', 'metalnessMap', 'roughnessMap', 'normalMap', 'bumpMap'];
    for (const name of mapNames) {
        const texture = material[name];
        if (!texture) continue;

        if (name === 'map' || name === 'emissiveMap') {
            texture.colorSpace = THREE.SRGBColorSpace;
        } else {
            texture.colorSpace = THREE.LinearSRGBColorSpace;
        }

        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.minFilter = THREE.LinearMipMapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
    }

    if (material.normalMap && !material.normalScale) {
        material.normalScale = new THREE.Vector2(1, 1);
    }

    return material;
}


// ENSURE UV2 EXISTS FOR AO/LIGHTMAPS IF AO MAPS ARE PRESENT
function ensureUV2ForAO(geometry) {
  if (!geometry) return;
  if (!geometry.attributes.uv2 && geometry.attributes.uv) {
    geometry.setAttribute('uv2', new THREE.BufferAttribute(geometry.attributes.uv.array, 2));
    geometry.attributes.uv2.needsUpdate = true;
  }
}

// FUNCTION TO INIT NPC
function initNPC(scene, navQuery, bvhMeshes) {
  if (!navQuery) {
    console.warn("initNPC: Nav query not ready yet — NPC init may fail.");
  }

  // Clone base character model
  const npcModel = SkeletonUtils.clone(characterModel);
  npcModel.updateMatrixWorld(true);

  npcModel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (Array.isArray(child.material)) {
        child.material = child.material.map(tuneMaterial);
      } else {
        child.material = tuneMaterial(child.material);
      }
    }
  });

  if (characterGLTF) {
    // reuse the same animation controller as your TP player
    const npcAnimation = createAnimController(npcModel, characterGLTF);
    npcModel.userData.animationCtrl = npcAnimation;
  }

  // choose a starting position (example near player start)
  npcModel.position.set(0.5, 0, 0.5);
  scene.add(npcModel);

  // --- compute an automatic footOffset if not provided by your importer ---
  if (typeof npcModel.userData.footOffset !== 'number') {
    try {
      const bbox = new THREE.Box3().setFromObject(npcModel);
      // bbox.min.y is where the lowest vertex sits in world-space.
      // We want footOffset so model sits on top of ground when we set model.position.y = floorY + footOffset
      // If the model's root is at 0 then bbox.min.y is negative and -bbox.min.y gives the distance from root to foot.
      const modelMinY = bbox.min.y;
      npcModel.userData.footOffset = -modelMinY;
      console.debug('initNPC: auto footOffset computed:', npcModel.userData.footOffset);
    } catch (e) {
      npcModel.userData.footOffset = 0;
      console.warn('initNPC: failed to compute auto footOffset, using fallback 0', e);
    }
  }

  // --- initial vertical snap: prefer navmesh projection (so agent starts on navmesh) ---
  const footOffset = npcModel.userData?.footOffset ?? 0.0001;
  let snapped = false;
  let navY = null;
  let floorY = null;

  if (navQuery) {
    try {
      const np = navQuery.findClosestPoint({
        x: npcModel.position.x,
        y: npcModel.position.y + footOffset,
        z: npcModel.position.z,
      });
      if (np?.point) {
        navY = np.point.y;
        npcModel.position.y = np.point.y + footOffset + 1e-3;
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
        npcModel.position.clone().add(new THREE.Vector3(0, 2.0, 0)),
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
  console.debug('initNPC: navY, floorY, navMeshToFloorOffset', navY, floorY, npcModel.userData.navMeshToFloorOffset);

  // ✅ Register this NPC as a crowd agent
  const agent = addAgent(
    npcModel.position,
    {
      radius: 0.35,
      height: 2.0,
      maxAcceleration: 20.0,
      maxSpeed: 20.0,
      separationWeight: 0.2,
      collisionQueryRange: 1,
      pathOptimizationRange: 40,
    },
    { model: npcModel }
  );

  if (!agent) {
    console.error("initNPC: Failed to add NPC as crowd agent.");
    return null;
  }

  console.info("initNPC: NPC initialized as crowd agent", agent, "at", npcModel.position);

  return { model: npcModel, agent, walkSpeed: 2.6, runSpeed: 6.0, state: { mode: 'idle' }, requestedGait: null };
}

// index.js — replace setPlayerFollowTarget with the version below
function setPlayerFollowTarget(playerAgent, npc, navQuery) {
  if (!playerAgent || !npc || !npc.model || !npc.agent || !navQuery) return;

  // global bvhMeshList is used for obstacle checks
  const npcPos = npc.model.position.clone();

  // NPC forward & right (world-space, flattened Y)
  let forward = new THREE.Vector3(0, 0, 1);
  try {
    forward = npc.model.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  } catch (e) { forward.set(0, 0, 1); }

  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0,1,0)).normalize();

  // tuning: how far to the side and small back offset if needed
  const offsetSide = 0.7;   // try 0.6-0.9 for closer/further
  const offsetBack = 0.12;  // small backward so TP doesn't clip the NPC front

  // prefer existing followSide, fallback to 'right'
  const preferredSide = (tpView && tpView.followSide === 'left') ? -1 : 1;
  const candidatesOrder = [preferredSide, -preferredSide]; // try preferred first

  // compute NPC nav start for path checks
  const npcNavProj = navQuery.findClosestPoint({ x: npcPos.x, y: npcPos.y, z: npcPos.z });
  const startForPath = (npcNavProj && npcNavProj.point) ? npcNavProj.point : { x: npcPos.x, y: npcPos.y, z: npcPos.z };

  function candidateIsValid(candidateWorldPos) {
    // 1) snap to navmesh
    const proj = navQuery.findClosestPoint({ x: candidateWorldPos.x, y: candidateWorldPos.y + 1.0, z: candidateWorldPos.z });
    if (!proj?.point) return null;
    const navPt = proj.point;
    // 2) path check (short path from NPC to candidate)
    try {
      const pathRes = navQuery.computePath(startForPath, { x: navPt.x, y: navPt.y, z: navPt.z });
      if (!pathRes || !pathRes.success) return null;
    } catch (e) {
      return null;
    }
    // 3) BVH raycast: ensure there's no solid geometry blocking the straight line
    try {
      const dir = candidateWorldPos.clone().sub(npcPos).setY(0);
      const dist = dir.length();
      if (dist < 1e-4) return null;
      dir.normalize();
      const rayOrigin = npcPos.clone().add(new THREE.Vector3(0, 0.5, 0)); // ray from chest height
      const ray = new THREE.Raycaster(rayOrigin, dir, 0.02, dist - 0.05);
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
  const fanAngles = [Math.PI/6, -Math.PI/6, Math.PI/3, -Math.PI/3, Math.PI/2, -Math.PI/2];
  for (const a of fanAngles) {
    const rotated = forward.clone().applyAxisAngle(new THREE.Vector3(0,1,0), a);
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


// src/game_logic/index.js
async function loadModel() {

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
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.1;
    sun.shadow.camera.far  = 40;
    sun.shadow.camera.left   = -15;
    sun.shadow.camera.right  =  15;
    sun.shadow.camera.top    =  15;
    sun.shadow.camera.bottom = -15;
    sun.shadow.bias = -0.0002;
    sun.castShadow = true;
    scene.add(sun);
    scene.add(sun.target); 


// environment map
    const pmremGen = new THREE.PMREMGenerator(renderer);
    pmremGen.compileEquirectangularShader();
    new EXRLoader().load('/assets/HDRI_1.exr', (exrTex) => {
        const envMap = pmremGen.fromEquirectangular(exrTex).texture;
        scene.environment = envMap;
        scene.background = envMap; // optional
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

    scene.background = new THREE.Color("#f0f0f0"); // Set a neutral background color


    try {
        // --- PARALLEL LOADING ---
        // 1. Create a promise for the model load. loader.loadAsync is a built-in
        // promise-based version of loader.load that we can await.
        const loadModelPromise = new Promise((resolve, reject) => {
        // Use the GLTFLoader instance from your game logic.
            loader.load(
                ModelPaths[currentMuseumId],
                (gltf) => {
                    // Set target to 100 and start animation
                    targetProgress = 100;
                    animateProgress();
                    resolve(gltf);
                },
                (xhr) => {
                    // This callback fires multiple times as the file loads.
                    if (xhr.lengthComputable && xhr.total > 0) {
                        // Cap the visual progress at 90% while the file is transferring.
                        targetProgress = (xhr.loaded / xhr.total) * 100;
                        // Adjust the horizontal background position for a wave effect
                        backgroundPositionX = Math.sin(xhr.loaded * 0.05) * 5; 
                        // Kick off or continue the animation loop.
                        animateProgress();
                    }
                },
                (err) => reject(err)
            );
        });


        // 2. Create a promise for the API call.
        const getAssetsPromise =  GetRoomAsset(currentMuseumId);



        // 3. Load third view character
        const loadModelCharacterPromise = characterLoader.loadAsync('optimizedModel/ANIMATED_1.glb');
        // Try to load the characterModel in background, but don't block scene loading on it.
        loadModelCharacterPromise.then((gltf) => {
            characterGLTF = gltf;
            characterModel = gltf.scene;
            characterModelReady = true;
            if(tpView){
                tpViewExisted = true;
                tpViewLoadLate = false;
                tpView.handleAnimation(characterModel, characterGLTF);
                console.info("Finish handle character model using handleAnimation() function in ThirdPersonPlayer.js")
            }else{
                tpViewExisted = false;
                tpViewLoadLate = true;
                // Store to call in the activateThirdPerson()
                character = {model: characterModel, gltf: characterGLTF}
            }
        }).catch((error) => {
            console.error('Error loading character model:', error);
        });

        // 3. Wait for BOTH promises to complete simultaneously.
        // const [gltf, items] = await Promise.all([loadModelPromise , getAssetsPromise]);
        const [gltf] = await Promise.all([loadModelPromise]);

        // // Clear map before use 
        // AssetDataMap.clear()
        // // Loop through each of items of items objects and then extract the data with the key is the image mesh name and value is corresponding for that 
        // // image mesh name
        // for (const item of items){
        //   AssetDataMap.set(item.asset_mesh_name , item)
        // }

        // let URL = "QmV55VNUfsGpCqv18Ak2B2VMHRxpaeupFedBMBJQVZ61zq"
        // await prefetchAudio(URL)
        // playAudio(URL)


        // --- SCENE SETUP (executes after all assets are downloaded) ---
        scene.add(gltf.scene);
        gltf.scene.updateMatrixWorld(true);
        currentScene = gltf.scene;
        animation = gltf.animations;
        mixer = new THREE.AnimationMixer(gltf.scene);


        if(characterModel){
            characterModel.traverse((child) => {
                if(!child.isMesh) return;
                if (child.isMesh){
                    child.castShadow = true;
                    child.material = tuneMaterial(child.material)
                }else{
                    child.castShadow = false;
                    child.receiveShadow = false;
                }
            });
        }

        gltf.scene.traverse((child) => {
          // if(!child.isMesh) return;
          if (child.name.endsWith('_NPC_Target')) {
            // console.warn(child.name);
            let frameName = child.name.replace('_NPC_Target', '');
            // console.warn("Initial frame name: ", frameName)
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
            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            console.log('Found TourTarget:', child.name, '=> maps to', frameName);
          }
            
            child.updateMatrixWorld(true);
            bvhMeshList.push(child);

            child.receiveShadow = true;
            child.updateMatrixWorld(true);

            if (Array.isArray(child.material)) {
                child.material = child.material.map(tuneMaterial);
            } else {
                child.material = tuneMaterial(child.material); 
            }

            ensureUV2ForAO(child.geometry);

            if(child.userData && child.userData.navWalkable || child.userData.navObstacle){
                navInputMeshes.push(child);
            }

            if (child.isObject3D) {
              console.log("Found an empty object of type Object3D:", child.name);
            }

            if (child.isMesh) {
                console.log('CHILD MESH NAME:', child.name);
                child.userData.navWalkable = false;
                child.userData.navObstacle = true;

                if (child.name.toLowerCase().includes("floor")) {
                    child.userData.navWalkable = true;
                    child.userData.navObstacle = false;
                } else {
                    // By default, every other mesh is considered an obstacle.
                    child.userData.navWalkable = false;
                    child.userData.navObstacle = true;
                }

                // Second, now that properties are set, check if it should be part of the navmesh.
                if (child.userData.navWalkable || child.userData.navObstacle) {
                    navInputMeshes.push(child);
                }
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
                    console.log("Floor bbox: ", child.geometry.boundingBox)
                    // console.log("FLOOR POSITION IS: ",child.position.x, child.position.y, child.position.z)
                    const box = new THREE.Box3().setFromObject(child);
                    const size = box.getSize(new THREE.Vector3());
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

                if (child.name.toLowerCase().includes("pictureframe")){
                  if (child.name === "PictureFrame003"){
                    child.material = new THREE.MeshBasicMaterial({color : "green" , wireframe: true})
                  }
                  pictureFramesArray.push(child);
                }

                if (/^ImageMesh\d+$/.test(child.name)) {
                  if (child.name === "ImageMesh004"){
                    child.material = new THREE.MeshBasicMaterial({color : "red", wireframe: true})
                  }
                    imageMeshesArray.push(child);
                    const imagePlane = child;
                    if (imagePlane.geometry?.attributes.uv) imagePlane.geometry.attributes.uv.needsUpdate = true;
                    
                    const box = new THREE.Box3().setFromObject(imagePlane);
                    const center = box.getCenter(new THREE.Vector3());
                    const annotationDiv = new AnnotationDiv(count++, imagePlane);
                    const label = new CSS2DObject(annotationDiv.getElement());
                    label.position.copy(center);
                    scene.add(label);
                    annotationMesh[imagePlane.name] = { label, annotationDiv, mesh: imagePlane };
                    // Attach to DOM so it can be seen
                    annotationDiv.onAnnotationClick = () => displayUploadModal(1/1, { roomID: currentMuseumId, asset_mesh_name: imagePlane.name });
                }

            }
        });
        // DEBUG PRINT PICTURE FRAME OBJECTS
        // pictureFramesArray.forEach(child =>{
        //   console.warn("PICTURE FRAME: ", child.name)
        // })

        // imageMeshesArray.forEach(child =>{
        //   console.warn("IMAGE MESH: ", child.name);
        // })

        // initialize recast (WASM) if needed
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

        // After get navmesh , immediately call initCrowd() function to init Crowd so this can add the agent to this crowd
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
        // tpView.buildBVH(gltf.scene);
        tpView.buildBVHFromMeshes(bvhMeshList)
        physiscsReady = true;
        hasLoadPlayer = true;
        if (!navQuery){
            console.warn("Nav query is not exist yet. museumNPC init may be fail");
        }else{
            console.info("Nav query exist already")
            console.log("Nav query: ", navQuery)
        }
        // Call initNPC function to init NPC 
        const npcEntry = initNPC(scene, navQuery, bvhMeshList);
       
        if (npcEntry){
          npcEntry.state = {mode: 'idle'};
          npcAgents.push(npcEntry);
        }else {
          console.warn('initNPC failed - no entry created');
        }

        // --- POPULATE SCENE WITH DATA ---
        (Array.isArray(items) ? items : []).forEach(item => {
            console.warn(item)
            if (!item) return;
            const { asset_mesh_name, asset_cid, webp_cid , title, viet_des, en_des , viet_audio_cid , eng_audio_cid  } = item;
            if (annotationMesh[asset_mesh_name]) {
                annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, viet_des, en_des , viet_audio_cid , eng_audio_cid);

                setImageToMeshKTX2(currentScene, asset_mesh_name, `https://${PINATA_URL}${asset_cid}`);
            }
        });

        hasEnteredNewScene = false;
        document.getElementById('loading-container').style.display = 'none';

    } catch (error) {
        console.error('An error occurred while loading the model or assets:', error);
        document.getElementById('loading-container').style.display = 'none';
    }
}

function setMuseumModel(modelId) {
    currentMuseumId = modelId;
    loadModel();
}

function initMenu() {
    const menuContainer = document.getElementById("menu-container");
    if (!menuContainer) return;

    document.getElementById("menu-close").addEventListener("click", closeMenu);

    const menuList = document.getElementById("menu-selection-list");
    if (menuList) {
        menuList.innerHTML = '';
        const listItem1 = document.createElement("div");
        listItem1.textContent = "Room1";
        listItem1.className = "menu-item";
        listItem1.addEventListener("click", () => {
            setMuseumModel(Museum.ART_GALLERY);
            closeMenu();
        });

        const listItem2 = document.createElement("div");
        listItem2.textContent = "Room2";
        listItem2.className = "menu-item";
        listItem2.addEventListener("click", () => {
            setMuseumModel(Museum.LOUVRE);
            closeMenu();
        });

        menuList.append(listItem1, listItem2);
    }
    
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

// pointer lock mouse look (example — adapt to your app)
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) {
    camYaw   -= e.movementX * 0.005;  // sensitivity X
    camPitch -= e.movementY * 0.005;  // sensitivity Y
    camPitch = Math.max(-1.2, Math.min(0.8, camPitch)); // clamp pitch
  }
});


function animate() {
  animationFrameId = requestAnimationFrame(animate);

    // render CSS3D (if you use it)
  if (css3dRenderer) css3dRenderer.render(scene, camera);

  // render CSS2D (labels)
  if (cssRenderer) cssRenderer.render(scene, camera);

  const frameDelta = Math.min(0.05, clock.getDelta());
  physicsTimeAccumulator += frameDelta;
  const FIXED_TIMESTEP = 1 / 60;

  if (outlinePass) {
    const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
    outlinePass.enabled = hasTargets;
  }

  // ---------------- CROWD UPDATE ----------------
  const FIXED_CROWD_DT = 1 / 60;
  const MAX_CROWD_SUBSTEPS = 10;
  updateCrowd(FIXED_CROWD_DT, frameDelta, 2);
  updateAgentTours(navQuery ?? getNavQuery());

  // ---------------- NPC SYNC ----------------
  const NPC_ROT_LERP_SPEED = 8.0;
  const NPC_ARRIVAL_DIST = 0.08;
  const NPC_MIXER_DISTANCE = 60;
  const NPC_VERTICAL_SMOOTH = 0.6;

  for (const entry of npcAgents) {
    const agent = entry.agent;
    const model = entry.model;
    if (!agent || !model) continue;

    entry.state = entry.state || { mode: 'idle', requestedGait: null };

    const anim = model.userData?.animCtrl ?? model.userData?.animationCtrl;
    if (anim && anim.mixer && camera.position.distanceTo(model.position) < NPC_MIXER_DISTANCE) {
      anim.mixer.update(frameDelta );
    }

    // --- agent position ---
    let apos;
    try {
      apos = agent.interpolatedPosition ?? (typeof agent.position === 'function' ? agent.position() : agent.position);
    } catch (e) {
      apos = (typeof agent.position === 'function' ? agent.position() : agent.position);
    }
    if (!apos) continue;

    const agentPos = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
    const footOffset = typeof model.userData?.footOffset === 'number' ? model.userData.footOffset : 0;

    let targetPos = new THREE.Vector3(agentPos.x, agentPos.y, agentPos.z);
    let snappedToBVH = false;

    // DEBUG: log positions for first NPC only (turn on/off quickly)
    if (typeof window.DEBUG_NPC_POSITIONS === 'undefined') window.DEBUG_NPC_POSITIONS = false;
    if (window.DEBUG_NPC_POSITIONS && npcAgents.indexOf(entry) === 0) {
      let rawPos = null;
      try { rawPos = (typeof agent.position === 'function' ? agent.position() : agent.position); } catch (e) {}
      let interp = null;
      try { interp = (typeof agent.interpolatedPosition === 'function' ? agent.interpolatedPosition() : agent.interpolatedPosition); } catch(e){}
      console.log('[NPC DEBUG] modelPos=', model.position.toArray().map(n=>n.toFixed(3)),
                  ' interp=', interp ? [interp.x ?? interp[0], interp.y ?? interp[1], interp.z ?? interp[2]].map(n=>n.toFixed(3)) : 'null',
                  ' raw=', rawPos ? [rawPos.x ?? rawPos[0], rawPos.y ?? rawPos[1], rawPos.z ?? rawPos[2]].map(n=>n.toFixed(3)) : 'null');
    }


    if (bvhMeshList && bvhMeshList.length) {
      try {
        const downOrigin = new THREE.Vector3(agentPos.x, agentPos.y + 2.0, agentPos.z);
        const downRay = new THREE.Raycaster(downOrigin, new THREE.Vector3(0, -1, 0));
        const hits = downRay.intersectObjects(bvhMeshList, true);
        if (hits && hits.length) {
          targetPos.y = hits[0].point.y;
          snappedToBVH = true;
        }
      } catch (e) {}
    }
    if (!snappedToBVH) {
      const navToFloor = (model.userData && typeof model.userData.navMeshToFloorOffset === 'number') ? model.userData.navMeshToFloorOffset : 0;
      targetPos.y = agentPos.y + navToFloor;
    }
    targetPos.y += footOffset;

    const responsiveness = 10.0; // bigger = snappier, smaller = smoother
    const alpha = 1 - Math.exp(-responsiveness * frameDelta);

    // Smooth X/Z instead of snapping: gives smooth motion regardless of frame jitter
    model.position.x += (targetPos.x - model.position.x) * alpha;
    model.position.z += (targetPos.z - model.position.z) * alpha;
    // Smooth Y as well (ensures no vertical popping)
    model.position.y += (targetPos.y - model.position.y) * alpha;

    // --- arrival handling ---
    let targetObj = null;
    try { targetObj = (typeof agent.target === 'function') ? agent.target() : agent.target; } catch (e) {}
    let reached = false;
    if (targetObj && (('x' in targetObj) || Array.isArray(targetObj))) {
      const tx = targetObj.x ?? targetObj[0];
      const tz = targetObj.z ?? targetObj[2];
      const tvec = new THREE.Vector3(tx, agentPos.y, tz);
      if (agentPos.distanceTo(tvec) <= NPC_ARRIVAL_DIST) reached = true;
    }

    if (reached) {
      try { if (typeof agent.resetMoveTarget === 'function') agent.resetMoveTarget(); } catch (e) {}
      model.position.copy(targetPos);

      if (anim && anim.idleAction) {
        if (anim.currentAction && anim.currentAction !== anim.idleAction) {
          anim.currentAction.crossFadeTo(anim.idleAction, 1, true);
        }
        anim.idleAction.reset().play();
        anim.currentAction = anim.idleAction;
        anim.currentAction.timeScale = 0.8;
      }

      if (tpView && tpView.isTouring){
        tpView.isViewingPicture = true;
      }

      entry.state.requestedGait = null;
      entry.state.mode = 'idle';
      continue;
    }

    const gaitWanted = entry.state.requestedGait ?? entry.state.mode;
    const desiredGaitSpeed = (gaitWanted === 'run')
      ? (entry.runSpeed ?? 6.0)
      : (entry.walkSpeed ?? 2);

    try {
      if (typeof agent.updateParameters === 'function') {
        agent.updateParameters({
          maxSpeed: desiredGaitSpeed,
          maxAcceleration: 10.0,
        });
      }
    } catch (e) {}

    let vel = null;
    try { vel = (typeof agent.velocity === 'function') ? agent.velocity() : agent.velocity; } catch (e) {}
    const vx = (vel?.x ?? vel?.[0]) ?? 0;
    const vz = (vel?.z ?? vel?.[2]) ?? 0;
    const speed = Math.sqrt(vx * vx + vz * vz);

    const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

    if (entry.state?.preventRotationUntil && entry.state.preventRotationUntil > nowSec) {
      if (entry.state.tourFacingQuat && model) {
        model.quaternion.copy(entry.state.tourFacingQuat);
      }
    } else {
      if (speed > 1e-4) {
        const desiredDir = new THREE.Vector3(vx, 0, vz).normalize();
        const targetYaw = Math.atan2(desiredDir.x, desiredDir.z);
        const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
        model.quaternion.slerp(tq, Math.min(1, NPC_ROT_LERP_SPEED * frameDelta));
      }
    }

    // --- animation ---
    if (anim) {
      let nextAction = null;
      if (gaitWanted === 'run' && anim.runningAction) nextAction = anim.runningAction;
      else if (gaitWanted === 'walk' && anim.walkAction) nextAction = anim.walkAction;
      else if (anim.idleAction) nextAction = anim.idleAction;

      if (nextAction && anim.currentAction !== nextAction) {
        if (anim.currentAction) {
          anim.currentAction.crossFadeTo(nextAction, 1, true);
        }
        nextAction.reset().play();
        anim.currentAction = nextAction;
      }

      if (anim.currentAction) {
        const targetScale = THREE.MathUtils.clamp(speed / desiredGaitSpeed, 1, 2);
        anim.currentAction.timeScale = THREE.MathUtils.lerp(anim.currentAction.timeScale ?? targetScale, targetScale, 0.1);
      }
    }
  }


  // ---------------- TP VIEW ----------------
  if (physiscsReady && activePlayer === 'tp' && tpView) {
    // --- Step 1: Update the Crowd Agent's Target (if touring) ---
    if (tpView.isTouring && tpView.crowdAgent && npcAgents.length > 0) {
      const npcEntry = npcAgents[0];
      const atDest = !!(npcEntry?.state?.mode === 'idle' && npcEntry?.state?.atDestination);

      if (npcEntry && npcEntry.model && tpView && tpView.crowdAgent) {
        setPlayerFollowTarget(tpView.crowdAgent, npcEntry, navQuery);
      }
    }

    // --- Step 2: Update the Player's Visual Model ---
    if (tpView.isTouring) {
      if (typeof tpView.updateFollow === 'function') {
        tpView.updateFollow(frameDelta);
      } else {
        tpView.syncFromCrowd();
      }
    } else {
      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        tpView.update(frameDelta);
      }
    }

    // --- Step 3: Camera update ---
    if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
      const npcEntry = npcAgents[0];
      
      // The point the camera is interested in on the player (center mass)
      const playerLookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end)
        .clone().add(new THREE.Vector3(0, 0.5, 0));
      
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
          pic.getWorldPosition(pictureTarget);

          // 2. Position the camera BEHIND the PLAYER, facing the picture.
          // This keeps the player in the frame.
          const directionFromPicToPlayer = playerLookAtPoint.clone().sub(pictureTarget).normalize();
          const cameraDistance = 3.0; // How far the camera should be from the player
          
          // Place the camera behind the player along the line from the picture.
          const cameraTargetPosition = playerLookAtPoint.clone().add(directionFromPicToPlayer.multiplyScalar(cameraDistance));
          cameraTargetPosition.y = playerLookAtPoint.y + 0.8; // Adjust height for a better view

          // 3. Smoothly move the camera to the target position and look at the picture.
          const lerpFactor = 0.05;
          camera.position.lerp(cameraTargetPosition, lerpFactor);
          
          const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(camera.position, pictureTarget.normalize(), camera.up)
          );
          camera.quaternion.slerp(targetQuaternion, lerpFactor);

        } catch (e) {
          console.warn('Tour camera snap failed, falling back to normal follow.', e);
        }

      } 
      else {
        // ====================================================================
        // ✅ STANDARD LOGIC: When moving, use the normal follow-cam.
        // This logic is correct for following the player.
        // ====================================================================
        let cameraLookTarget = playerLookAtPoint.clone();

        const idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(tpView.model.quaternion);
        const idealPos = playerLookAtPoint.clone().add(idealOffset);
        let finalPos = idealPos.clone();

        // Camera collision logic (unchanged)
        const fovRadians = THREE.MathUtils.degToRad(camera.fov);
        const near = camera.near;
        const halfHeight = Math.tan(fovRadians * 0.5) * near;
        const halfWidth = halfHeight * camera.aspect;
        const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);
        const raycaster = new THREE.Raycaster(playerLookAtPoint, idealOffset.clone().normalize(), 1e-14, idealOffset.length());
        const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);
        if (intersects.length > 0) {
          finalPos.copy(intersects[0].point).sub(raycaster.ray.direction.clone().multiplyScalar(camRadius + 0.05));
        }
        
        if (tpView.isTouring && tpView.isViewingPicture){
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
  if (physiscsReady && activePlayer === 'fp' && fpView) {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      fpView.update(frameDelta, camYaw, camPitch);
    }
    if (fpView.isTouring && fpView.followAgent) {
      const npcEntry = fpView.followAgent;
      // Prefer the agent's interpolated position when available (most accurate)
      let npcPosVec = null;
      if (npcEntry.agent) {
        try {
          const apos = (typeof npcEntry.agent.interpolatedPosition === 'function')
            ? npcEntry.agent.interpolatedPosition()
            : (typeof npcEntry.agent.position === 'function' ? npcEntry.agent.position() : npcEntry.agent.position);
          if (apos && model) {
            model.position.set(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
          }
          npcPosVec = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
        } catch (e) { npcPosVec = null; }
      }
      if (!npcPosVec && npcEntry.model) {
        npcPosVec = new THREE.Vector3();
        npcEntry.model.getWorldPosition(npcPosVec);
      }

      if (npcPosVec) {
        const forward = new THREE.Vector3();
        if (npcEntry.model) {
          npcEntry.model.getWorldDirection(forward);
          forward.y = 0;
          if (forward.lengthSq() < 1e-6) forward.set(0,0,1);
          forward.normalize();
        } else if (npcEntry.agent) {
          try {
            const vel = (typeof npcEntry.agent.velocity === 'function') ? npcEntry.agent.velocity() : npcEntry.agent.velocity;
            forward.set((vel?.x ?? vel?.[0]) ?? 0, 0, (vel?.z ?? vel?.[2]) ?? 0);
            if (forward.lengthSq() < 1e-6) forward.set(0,0,1);
            else forward.normalize();
          } catch (e) { forward.set(0,0,1); }
        } else {
          forward.set(0,0,1);
        }

        const camPos = npcPosVec.clone()
          .add(new THREE.Vector3(0, 1.6, 0)) // eye height
          .add(forward.clone().multiplyScalar(-2.0)); // 2m behind

        fpView.camera.position.lerp(camPos, 0.12);
        fpView.camera.lookAt(npcPosVec.clone().add(new THREE.Vector3(0, 1.6, 0)));
      }
    }
  }

  // ---------------- MIXERS ----------------
  if (mixer) mixer.update(frameDelta);
  if (tpView?.mixer) tpView.mixer.update(frameDelta);

  checkPlayerPosition();
  composer.render();
}


async function activateThirdPerson() {
  activePlayer = 'tp';

  // --- Late-load initialization ---
  if (tpViewLoadLate) {
    console.log("TP VIEW IS LOAD LATE");

    if (!tpViewExisted && character) {
      tpView = new ThirdPersonPlayer(camera, scene, playerCollider, character.model);
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

  // Capture yaw from TP model for smooth rotation continuity
  if (tpView && tpView.model) {
    const e = new THREE.Euler().setFromQuaternion(tpView.model.quaternion, 'YXZ');
    camYaw = e.y;
    camPitch = 0;
  }

  // Deactivate TP view
  if (tpView && tpView.model) {
    scene.remove(tpView.model);
    tpView.model.visible = false;
    tpView.isTouring = false;
    if (typeof tpView.stopFollowAgent === 'function') {
      try { tpView.stopFollowAgent(); } catch {}
    }
  }

  // Reset FP view
  if (fpView) {
    fpView.resetControls();
    if (fpView._smoothedPlayerPosition && fpView.playerCollider)
      fpView._smoothedPlayerPosition.copy(fpView.playerCollider.end);

    if (typeof fpView.tempQuaternion !== 'undefined' && fpView.model) {
      fpView.tempQuaternion.copy(fpView.model.quaternion || new THREE.Quaternion());
    }

    fpView.setYaw(camYaw);
    fpView.setPitch(camPitch);
    fpView._cameraSnapped = false;
  }

  // Resume NPC follow if touring
  const tourNpc = npcAgents?.[0];
  if (tourNpc?.state?.touring && fpView) {
    try {
      if (typeof fpView.setFollowAgent === 'function') {
        fpView.setFollowAgent(tourNpc, playerCollider);
      } else if (typeof fpView.startFollowAgent === 'function') {
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

    css3dRenderer = new CSS3DRenderer();
    css3dRenderer.domElement.style.position = 'absolute';
    css3dRenderer.domElement.style.top = '0';
    css3dRenderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(css3dRenderer.domElement);

    // renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25)); // dynamic res clamp
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

    const renderPass = new RenderPass(scene , camera);
    renderPass.clear = true; // ensure it clears before rendering
    renderPass.clearAlpha = 1; // set clear alpha to fully opaque
    composer.addPass(renderPass);

    outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene , camera);
    outlinePass.edgeStrength = 8;
    outlinePass.edgeGlow = 1;
    outlinePass.edgeThickness = 3.5;
    outlinePass.pulsePeriod = 2;
    outlinePass.visibleEdgeColor.set("#ffffff");
    outlinePass.hiddenEdgeColor.set("#000000");
    outlinePass.hiddenEdgeColor.multiplyScalar(0); // effectively transparent
    outlinePass.renderToScreen = false;      // if it's the last pass
    outlinePass.enabled = false;
    outlinePass.clear = false;              // don’t clear the whole buffer
    outlinePass.clearAlpha = 0;             // transparent, not black
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
          if (!npc) return;

          if (npc.state?.touring) {
            // --- STOP TOUR ---
            console.log("Stopping tour...");
            stopAgentTour(npc);
            npc.state.touring = false;

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

    container.addEventListener("keydown", (e) => e.key === "Shift" && hideAnnotations());
    container.addEventListener("keyup", (e) => e.key === "Shift" && showAnnotations());

    raycasterManager = new RaycasterManager(camera, scene, container, {
         doorNames: Object.keys(doorState),
         onHoverPictureFrame: () => {},
         onClickPictureFrame: (frameName) =>{
            const imageMeshName = FrameToImageMeshMap[frameName];
            const imageData = annotationMesh[imageMeshName]

            if(!imageMeshName || !imageData){
                console.warn("No image mapped for: ", frameName)
                return;
            }

            const imageURL = imageData.mesh.material.map?.image?.src || '';
            const {annotationDiv} = imageData
            // const {annotationDiv} = imageData;
            console.log(`User clicked frame: ${frameName} → mapped to: ${imageMeshName}`);
            console.log("Viet description: ", annotationMesh[imageMeshName].annotationDiv.getVietDes())
            console.log("Eng description: ", annotationMesh[imageMeshName].annotationDiv.getEngDes())
            DisplayImageOnDiv(imageURL , annotationDiv.title , annotationDiv.vietnamese_description , annotationDiv.english_description)
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
              pathLength
            });
          }



    
        
    });
    raycasterManager.setOutlinePass(outlinePass);


    initUploadModal();
    initMenu();
    loadModel();
    // initPostProcessing();

    if (animationFrameId === null) {
        animate();
    }
}

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