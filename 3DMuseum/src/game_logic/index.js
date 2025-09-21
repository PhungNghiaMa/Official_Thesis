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
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';
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
let characterModelReady = false;
let character = null;
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

// TESTING NAVMESH OBJECT
let Wall001 = null;

// Instance of navmesh building 
let navQuery = null;
let navMesh = null;
let crowd = null;
const npcAgents = [];

const navInputSet = new Set();   // meshes to feed into recast (floor + obstacles)
const bvhMeshList = [];          // meshes used for BVH raycasts (ground snap + capsule checks)
const navInputMeshes = [];   // meshes we will pass to recast
let  pictureFramesArray = [];


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
const FrameToImageMeshMap = {};

const ModelPaths = {
    [Museum.ART_GALLERY]: "optimizedModel/optimizeModel_12.glb",
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


function setImageToMesh(scene,meshName, imgUrl) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(imgUrl,
        (loadedTexture) => {
            loadedTexture.flipY = false;
            loadedTexture.colorSpace = THREE.SRGBColorSpace;
            loadedTexture.minFilter = THREE.LinearMipMapLinearFilter; // Use mipmaps for better quality
            loadedTexture.magFilter = THREE.LinearMipmapLinearFilter;
            loadedTexture.generateMipmaps = true;
            loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
            loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
            loadedTexture.needsUpdate = true;
            loadedTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

            const material = new THREE.MeshStandardMaterial({
                map: loadedTexture,
                side: THREE.DoubleSide,
                roughness: 0.5,  // adjust to taste
                metalness: 0.0,  // usually 0 for paintings/paper
            });


            let mesh = scene.getObjectByName(meshName)
            if (mesh && mesh.isMesh){
                mesh.material = material;
                mesh.material.needsUpdate = true;
                if (mesh.geometry?.attributes.uv) {
                    mesh.geometry.attributes.uv.needsUpdate = true;
                }
            }else{
                console.warn(`Cannot find mesh for ${meshName}`)
            }
        },
        undefined,
        (error) => {
            console.error('Error loading texture:', error);
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
        setImageToMesh(currentScene,asset_mesh_name, img_url);
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
      radius: 0.1,
      height: 2.0,
      maxAcceleration: 14.0,
      maxSpeed: 10.0,
      separationWeight: 0.0,
      collisionQueryRange: 0.0,
      pathOptimizationRange: 0.35 * 30.0,
    },
    { model: npcModel }
  );

  if (!agent) {
    console.error("initNPC: Failed to add NPC as crowd agent.");
    return null;
  }

  console.info("initNPC: NPC initialized as crowd agent", agent, "at", npcModel.position);

  return { model: npcModel, agent, walkSpeed: 2.4, runSpeed: 6.0, state: { mode: 'idle' }, requestedGait: null };
}

// FUNCTION TO MAKE THIRD PERSON PLAYER AGENT FOLLOW NPC IN ROOM TOUR 
function setPlayerFollowTarget(playerAgent, npc, navQuery) {
  // Follow *behind* the NPC (not to its right). Keep calls minimal while NPC is moving.
  if (!playerAgent || !npc || !npc.model || !npc.agent) return;

  // get NPC world position
  const npcPos = npc.model.position.clone();

  // get NPC forward direction (world), put player behind it
  let forward = new THREE.Vector3(0, 0, 1);
  try {
    forward = npc.model.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  } catch (e) {
    forward.set(0, 0, 1);
  }

  // Check NPC velocity — only request movement while NPC is visibly moving
  let vel = null;
  try { vel = (typeof npc.agent.velocity === 'function') ? npc.agent.velocity() : npc.agent.velocity; } catch (e) { vel = null; }
  const speed = vel ? Math.sqrt((vel.x ?? 0) ** 2 + (vel.z ?? 0) ** 2) : 0;

  // If NPC is nearly stopped, clear player's move target so the TP agent doesn't keep nudging
  if (speed < 0.02) {
    try {
      if (typeof playerAgent.resetMoveTarget === 'function') playerAgent.resetMoveTarget();
    } catch (e) {}
    return;
  }

   // 1. Calculate the NPC's "right" vector using a cross product
  const upVector = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, upVector).normalize();

  // 2. Determine which side to be on (left or right)
  const sideMultiplier = (tpView.followSide === 'left') ? -1 : 1;

  // 3. Define the offsets
  const offsetSide = 0.5; // meters to the side (tweak this value)
  const offsetBack = 0.0; // meters behind (tweak this value)

  // 4. Calculate the total offset vector
  const sideOffsetVector = right.clone().multiplyScalar(offsetSide * sideMultiplier);
  const backOffsetVector = forward.clone().multiplyScalar(-offsetBack);
  const totalOffset = sideOffsetVector.add(backOffsetVector);

  // 5. Calculate the final target position for the player
  const playerTargetPos = npcPos.clone().add(totalOffset);


  // set the player agent's target via your navQuery/pathing helper
  if (navQuery && typeof setAgentTarget === 'function') {
    setAgentTarget(playerAgent, playerTargetPos, navQuery, { entry: null, requestedGait: (speed > 2.5 ? 'run' : 'walk') });
  }
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

// Robust helper: returns a navmesh point (object {x,y,z}) in front of a wall or null
// in index.js, replace the old findReachableNavPointNearMesh with this new one

// Robust helper: returns a navmesh point (object {x,y,z}) in front of a mesh
function findReachableNavPointNearMesh(targetMesh, opts = {}) {
  // NEW: Added localForwardVector option
  const { desiredDistance = 1.5, maxSearch = 4.0, step = 0.2, fanSteps = 16, localForwardVector = null } = opts;
  const nq = getNavQuery();
  if (!nq) {
    console.warn('findReachableNavPointNearMesh: navQuery missing');
    return null;
  }
  if (!museumNPC || !museumNPC.model) {
    console.warn('findReachableNavPointNearMesh: museumNPC not ready');
    return null;
  }
  if (!targetMesh) return null;

  const npcWorld = museumNPC.model.position.clone();
  const npcProjRes = nq.findClosestPoint(npcWorld);
  if (!npcProjRes?.point) {
    console.warn('findReachableNavPointNearMesh: NPC projection failed', npcWorld);
    return null;
  }
  const startNav = new THREE.Vector3(npcProjRes.point.x, npcProjRes.point.y, npcProjRes.point.z);

  const meshWorld = new THREE.Vector3();
  targetMesh.getWorldPosition(meshWorld);
  const floorY = startNav.y;
  const base = new THREE.Vector3(meshWorld.x, floorY, meshWorld.z);
  
  let dir = new THREE.Vector3();

  // =========================================================================
  // ✅ STRATEGY 1 (BEST): Use the provided local forward vector. This is reliable.
  // =========================================================================
  if (localForwardVector && localForwardVector.isVector3) {
      const q = targetMesh.getWorldQuaternion(new THREE.Quaternion());
      dir.copy(localForwardVector).applyQuaternion(q);
      dir.y = 0;
      dir.normalize();
  } else {
  // =========================================================================
  // ⚠️ STRATEGY 2 (FALLBACK): Calculate direction from mesh towards the NPC.
  // =========================================================================
      dir.subVectors(npcWorld, base);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) {
        dir.set(0, 0, 1); // Failsafe if NPC is on top of target
      }
      dir.normalize();
  }

  // (The rest of the function remains the same)
  const startForPath = { x: startNav.x, y: startNav.y, z: startNav.z };
  function checkCandidate(candidateVec3) {
    const proj = nq.findClosestPoint({ x: candidateVec3.x, y: candidateVec3.y, z: candidateVec3.z });
    if (!proj?.point) return null;
    const navPt = new THREE.Vector3(proj.point.x, proj.point.y, proj.point.z);

    // const maxSnapDist = Math.max(0.8, step * 3);
    const maxSnapDist = 2
    if (navPt.distanceTo(candidateVec3) > maxSnapDist) return null;

    const pathRes = nq.computePath(startForPath, { x: navPt.x, y: navPt.y, z: navPt.z });
    if (!pathRes || !pathRes.success || !pathRes.path || pathRes.path.length === 0) return null;

    return { x: navPt.x, y: navPt.y, z: navPt.z };
  }

  for (let d = desiredDistance; d >= 0; d -= step) {
    const cand = base.clone().add(dir.clone().multiplyScalar(d));
    const ok = checkCandidate(cand);
    if (ok) return ok;
  }

  for (let d = desiredDistance + step; d <= maxSearch; d += step) {
    const cand = base.clone().add(dir.clone().multiplyScalar(d));
    const ok = checkCandidate(cand);
    if (ok) return ok;
  }
  
  // (Fan sampling and final fallback remain the same)
  for (let i = 0; i < fanSteps; i++) {
    const angle = (i / fanSteps) * Math.PI * 2;
    const rotated = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    for (let d = step; d <= maxSearch; d += step) {
      const cand = base.clone().add(rotated.clone().multiplyScalar(d));
      const ok = checkCandidate(cand);
      if (ok) return ok;
    }
  }

  const last = nq.findClosestPoint({ x: base.x, y: base.y, z: base.z });
  if (last?.point) return { x: last.point.x, y: last.point.y, z: last.point.z };

  return null;
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

    // TRY TO LOAD EXTERNAL NAVMESH 



    // // main gallery lights
    // spot1 = new THREE.SpotLight(0xffffff, 20);
    // spot1.position.set(6, 8, 6);
    // spot1.angle = Math.PI / 8;
    // spot1.penumbra = 0.4;
    // spot1.decay = 2;
    // spot1.distance = 30;
    // spot1.castShadow = true;
    // spot1.shadow.bias = -0.0001;
    // spot1.shadow.camera.near = 0.1;
    // spot1.shadow.camera.far  = 40;
    // spot1.shadow.mapSize.set(2048, 2048);
    // scene.add(spot1);

    // spot2 = new THREE.SpotLight(0xffffff, 15);
    // spot2.position.set(-6, 8, -6);
    // spot2.angle = Math.PI / 8;
    // spot2.penumbra = 0.4;
    // spot2.decay = 2;
    // spot2.distance = 30;
    // spot2.castShadow = true;
    // spot2.shadow.camera.near = 0.1;
    // spot2.shadow.camera.far  = 40;
    // spot2.shadow.mapSize.set(2048, 2048);
    // spot2.shadow.bias = -0.0001;
    // scene.add(spot2);


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
        const getAssetsPromise = GetRoomAsset(currentMuseumId);

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
        // const [gltf, items] = await Promise.all([loadModelPromise, getAssetsPromise]);
        const [gltf, items] = await Promise.all([loadModelPromise]);


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

        let index = 0;

        gltf.scene.traverse((child) => {
            // if(!child.isMesh) return;
          if (child.name.startsWith('TourTarget_')) {
            let frameName = child.name.replace('TourTarget_', '');
            // Use a specific regex to handle the CubeXXX001 case
            const match = frameName.match(/^(Cube\d{3})(\d{3,})$/);
            // If a match is found, reformat the name
            if (match) {
                const base = match[1]; // 'Cube046'
                const num = parseInt(match[2], 10); // 1
                frameName = `${base}_${num}`;
            }
            tourTargetsMap.set(frameName, child);
            // debug: print so we know the empties were found
            const worldPos = new THREE.Vector3();
            child.getWorldPosition(worldPos);
            console.log('Found TourTarget:', child.name, '=> maps to', frameName, 'worldPos', worldPos);
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

            if (child.isObject3D && child.name.startsWith('TourTarget_')) {
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
                // if (child.name.includes("Cube024")){
                //     const debugMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 , wireframe: true });
                //     child.material = debugMaterial;
                // }
                const pos = new THREE.Vector3();
                child.getWorldPosition(pos);
                child.receiveShadow = true;
                if (pos.y < fallbackY) {
                    fallbackY = pos.y;
                    fallbackX = pos.x;
                    fallbackZ = pos.z;
                }

                if (child.name === "Wall001"){
                    child.receiveShadow = true;
                    Wall001 = child;
                    Wall001.material = new THREE.MeshStandardMaterial({ color: 0x00ff00 , wireframe: false });
                    console.log("Wall001 position is: ", Wall001.position)
                }

                if (/^Picture_Frame\d+$/.test(child.name)) {
                    pictureFramesArray.push(child);
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

                if (child.parent?.name === "Door") {
                    doorBoundingBox = new THREE.Box3().setFromObject(child);
                }
                
                if (child.name === "Handle") {
                    child.material = new THREE.MeshStandardMaterial({ color: 0xF4EBC7, metalness: 1.0, roughness: 0.2 });
                }

                if (/^ImageMesh\d+$/.test(child.name)) {
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
                    annotationDiv.onAnnotationClick = () => displayUploadModal(1/1, { roomID: currentMuseumId, asset_mesh_name: imagePlane.name });
                }

                if (child.name.includes('Cube046')) {
                    pictureFramesArray.push(child);
                }
            }
        });

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
        const nearestPoint = navQuery.findClosestPoint({ x: 0.5, y: 0, z: 0.5 });
        console.log('nearestPoint:', nearestPoint);

        console.log("navMesh.raw exist: ", !!navMesh.raw);
        console.log("navMesh.raw : ", navMesh.raw);
        console.log("Crowd poly count:", navMesh.getPolyCount ? navMesh.getPolyCount() : "no getPolyCount()");




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
            if (!item) return;
            const { asset_mesh_name, asset_cid, title, viet_des, en_des } = item;
            if (annotationMesh[asset_mesh_name]) {
                annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, viet_des, en_des);
                setImageToMesh(currentScene, asset_mesh_name, `https://gateway.pinata.cloud/ipfs/${asset_cid}`);
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



// function animate() {
//   animationFrameId = requestAnimationFrame(animate);

//   const frameDelta = Math.min(0.05, clock.getDelta());
//   physicsTimeAccumulator += frameDelta;
//   const FIXED_TIMESTEP = 1/60; // Run physics at a steady 60Hz

//   if (outlinePass) {
//     const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
//     outlinePass.enabled = hasTargets;
//   }

  
//   if (physiscsReady && activePlayer === 'tp' && tpView) {
    
//     // --- Step 1: Update the Crowd Agent's Target (if touring) ---
//     // This part tells the invisible navigation agent where to go.
//     if (tpView.isTouring && tpView.crowdAgent && npcAgents.length > 0) {
//       const npcEntry = npcAgents[0];
//       const atDest = !!(npcEntry?.state?.mode === 'idle' && npcEntry?.state?.atDestination);
      
//       if (!atDest && npcEntry?.model) {
//         // If the NPC is moving, tell the player's agent to follow it.
//         setPlayerFollowTarget(tpView.crowdAgent, npcEntry, navQuery);
//       } else if (tpView.crowdAgent) {
//         // If the NPC has arrived, tell the player's agent to stop moving
//         // by setting its target to its current position.
//         setAgentTarget(tpView.crowdAgent, tpView.crowdAgent.position, navQuery);
//       }
//     }

//     // --- Step 2: Update the Player's Visual Model and Physics ---
//     // This is the critical change. We now choose the update method based on the mode.
//     if (tpView.isTouring) {
//       // **TOUR MODE**: The visual model follows the crowd agent.
//       // `updateFollow` handles syncing position, rotation, and animation from the agent.
//       if (typeof tpView.updateFollow === 'function') {
//         tpView.updateFollow(frameDelta);
//       } else {
//         // Fallback in case updateFollow is not defined.
//         tpView.syncFromCrowd();
//       }
//     } else {
//       // **MANUAL MODE**: The visual model is controlled by keyboard input and standard physics.
//       for (let i = 0; i < STEPS_PER_FRAME; i++) {
//         tpView.update(frameDelta);
//       }
//     }

//     // --- Step 3: Update Camera ---
//     // This camera logic is fine and can remain as it is. It correctly handles
//     // looking at the tour target when the NPC is idle.
//     if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
//       const npcEntry = npcAgents[0]; // Re-get for camera logic
//       const lookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end).clone().add(new THREE.Vector3(0, 0.5, 0));
//       let cameraLookTarget = lookAtPoint.clone();

//       if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
//         const pic = npcEntry.state.currentPictureMesh;
//         pic.updateMatrixWorld(true);
//         const picPos = new THREE.Vector3();
//         pic.getWorldPosition(picPos);
//         cameraLookTarget.copy(picPos);
//       }

//       let idealOffset;
//       if (tpView.isTouring) {
//         idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(tpView.model.quaternion);
//       } else {
//         const playerQuat = (tpView.tempQuaternion ?? tpView.model.quaternion).clone();
//         const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camPitch);
//         playerQuat.multiply(pitchQuat);
//         idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(playerQuat);
//       }
//       const idealPos = lookAtPoint.clone().add(idealOffset);
//       let finalPos = idealPos.clone();

//       const fovRadians = THREE.MathUtils.degToRad(camera.fov);
//       const near = camera.near;
//       const halfHeight = Math.tan(fovRadians * 0.5) * near;
//       const halfWidth  = halfHeight * camera.aspect;
//       const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

//       cameraCollider.center.copy(finalPos);
//       cameraCollider.radius = camRadius;

//       const raycaster = new THREE.Raycaster(lookAtPoint, idealOffset.clone().normalize());
//       raycaster.near = 1e-14;
//       raycaster.far = idealOffset.length();
//       const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);

//       if (intersects.length > 0) {
//         const hitPoint = intersects[0].point;
//         finalPos.copy(hitPoint).sub(raycaster.ray.direction.clone().multiplyScalar(camRadius + 0.05));
//         cameraCollider.center.copy(finalPos);
//       }

//       const lerp = 0.05;
//       if (!tpView._cameraSnapped) {
//         camera.position.copy(finalPos);
//         tpView._cameraSnapped = true;
//       } else {
//         camera.position.lerp(finalPos, lerp);
//       }

//       const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
//         new THREE.Matrix4().lookAt(camera.position, cameraLookTarget, camera.up)
//       );
//       camera.quaternion.slerp(targetQuaternion, 0.05);
//     }
//     if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
//         const npcEntry = npcAgents[0];
//         const lookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end).clone().add(new THREE.Vector3(0, 0.5, 0));
//         let cameraLookTarget = lookAtPoint.clone();

//         // **FIX**: Force camera to snap when at a destination
//         if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
//             const pic = npcEntry.state.currentPictureMesh;
//             pic.updateMatrixWorld(true);
//             const picPos = new THREE.Vector3();
//             pic.getWorldPosition(picPos);
//             cameraLookTarget.copy(picPos);

//             // Directly set the camera's position and look-at target.
//             // This overrides all smoothing and guarantees a perfect view.
//             const fixedCameraPosition = picPos.clone().add(new THREE.Vector3(0, 1.5, 3)); 
//             camera.position.copy(fixedCameraPosition);
//             camera.lookAt(picPos);
            
//             // This is crucial: stop further logic for this frame to avoid conflicts
//             return;
//         }

//         // The following logic will only execute when not at a tour stop
//         const idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(tpView.model.quaternion);
//         const idealPos = lookAtPoint.clone().add(idealOffset);
//         let finalPos = idealPos.clone();

//         // ... (rest of camera collision logic)
        
//         // --- Smooth follow (position) ---
//         const lerp = 0.05;
//         if (!tpView._cameraSnapped) {
//             camera.position.copy(finalPos);
//             tpView._cameraSnapped = true;
//         } else {
//             camera.position.lerp(finalPos, lerp);
//         }

//         // --- Smooth look (orientation) ---
//         const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
//             new THREE.Matrix4().lookAt(camera.position, cameraLookTarget, camera.up)
//         );
//         camera.quaternion.slerp(targetQuaternion, 0.05);
//     }
//   }

//   // ---------------- FP VIEW ----------------
//   if (physiscsReady && activePlayer === 'fp' && fpView) {
//     for (let i = 0; i < STEPS_PER_FRAME; i++) {
//       fpView.update(frameDelta , camYaw, camPitch);
//     }
//   }

//   // ---------------- CROWD UPDATE ----------------
//   const FIXED_CROWD_DT = 1 / 60;
//   const MAX_CROWD_SUBSTEPS = 10;
//   updateCrowd(FIXED_CROWD_DT, frameDelta, MAX_CROWD_SUBSTEPS);
//   updateAgentTours(navQuery ?? getNavQuery());

//   // ---------------- NPC SYNC ----------------
//   const NPC_ROT_LERP_SPEED = 8.0;
//   const NPC_ARRIVAL_DIST = 0.08;
//   const NPC_MIXER_DISTANCE = 60;
//   const NPC_VERTICAL_SMOOTH = 0.6;

//   for (const entry of npcAgents) {
//     const agent = entry.agent;
//     const model = entry.model;
//     if (!agent || !model) continue;

//     entry.state = entry.state || { mode: 'idle', requestedGait: null };

//     // animation controller
//     const anim = model.userData?.animCtrl ?? model.userData?.animationCtrl;
//     if (anim && anim.mixer && camera.position.distanceTo(model.position) < NPC_MIXER_DISTANCE) {
//       anim.mixer.update(frameDelta * 0.9);
//     }

//     // --- agent position ---
//     let apos;
//     try { apos = agent.interpolatedPosition ?? (typeof agent.position === 'function' ? agent.position() : agent.position); }
//     catch (e) { apos = (typeof agent.position === 'function' ? agent.position() : agent.position); }
//     if (!apos) continue;

//     const agentPos = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
//     const footOffset = typeof model.userData?.footOffset === 'number' ? model.userData.footOffset : 0;

//     let targetPos = new THREE.Vector3(agentPos.x, agentPos.y, agentPos.z);
//     let snappedToBVH = false;

//     if (bvhMeshList && bvhMeshList.length) {
//       try {
//         const downOrigin = new THREE.Vector3(agentPos.x, agentPos.y + 2.0, agentPos.z);
//         const downRay = new THREE.Raycaster(downOrigin, new THREE.Vector3(0, -1, 0));
//         const hits = downRay.intersectObjects(bvhMeshList, true);
//         if (hits && hits.length) {
//           targetPos.y = hits[0].point.y;
//           snappedToBVH = true;
//         }
//       } catch (e) {}
//     }
//     if (!snappedToBVH) {
//       const navToFloor = (model.userData && typeof model.userData.navMeshToFloorOffset === 'number') ? model.userData.navMeshToFloorOffset : 0;
//       targetPos.y = agentPos.y + navToFloor;
//     }
//     targetPos.y += footOffset;

//     // smooth vertical
//     model.position.x = targetPos.x;
//     model.position.z = targetPos.z;
//     model.position.y = THREE.MathUtils.lerp(model.position.y, targetPos.y, NPC_VERTICAL_SMOOTH);

//     // --- arrival handling ---
//     let targetObj = null;
//     try { targetObj = (typeof agent.target === 'function') ? agent.target() : agent.target; } catch (e) { targetObj = null; }

//     let reached = false;
//     if (targetObj && (('x' in targetObj) || Array.isArray(targetObj))) {
//       const tx = targetObj.x ?? targetObj[0];
//       const tz = targetObj.z ?? targetObj[2];
//       const tvec = new THREE.Vector3(tx, agentPos.y, tz);
//       if (agentPos.distanceTo(tvec) <= NPC_ARRIVAL_DIST) reached = true;
//     }

//     if (reached) {
//       try { if (typeof agent.resetMoveTarget === 'function') agent.resetMoveTarget(); } catch (e) {}
//       model.position.copy(targetPos);

//       if (anim && anim.idleAction) {
//         if (anim.currentAction && anim.currentAction !== anim.idleAction) {
//           anim.currentAction.crossFadeTo(anim.idleAction, 0.5, false);
//         }
//         anim.idleAction.reset().play();
//         anim.currentAction = anim.idleAction;
//         anim.currentAction.timeScale = 1.0;
//       }

//       entry.state.requestedGait = null;
//       entry.state.mode = 'idle';
//       continue;
//     }

//     const gaitWanted = entry.state.requestedGait ?? entry.state.mode;
//     const desiredGaitSpeed = (gaitWanted === 'run')
//       ? (entry.runSpeed ?? 6.0)
//       : (entry.walkSpeed ?? 1.6);

//     try {
//       if (typeof agent.updateParameters === 'function') {
//         agent.updateParameters({
//           maxSpeed: desiredGaitSpeed,
//           maxAcceleration: 30.0,
//         });
//       }
//     } catch (e) {}

//     // --- velocity & rotation ---
//     let vel = null;
//     try { vel = (typeof agent.velocity === 'function') ? agent.velocity() : agent.velocity; } catch (e) { vel = null; }
//     const vx = (vel?.x ?? vel?.[0]) ?? 0;
//     const vz = (vel?.z ?? vel?.[2]) ?? 0;
//     const speed = Math.sqrt(vx*vx + vz*vz);

//     const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

//     if (entry.state?.preventRotationUntil && entry.state.preventRotationUntil > nowSec) {
//       if (entry.state.tourFacingQuat && model) {
//         model.quaternion.copy(entry.state.tourFacingQuat);
//       }
//     } else {
//       if (speed > 1e-4) {
//         const desiredDir = new THREE.Vector3(vx, 0, vz).normalize();
//         const targetYaw = Math.atan2(desiredDir.x, desiredDir.z);
//         const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
//         model.quaternion.slerp(tq, Math.min(1, NPC_ROT_LERP_SPEED * frameDelta));
//       }
//     }

//     // --- animation ---
//     if (anim) {
//       let nextAction = null;
//       if (gaitWanted === 'run' && anim.runningAction) nextAction = anim.runningAction;
//       else if (gaitWanted === 'walk' && anim.walkAction) nextAction = anim.walkAction;
//       else if (anim.idleAction) nextAction = anim.idleAction;

//       if (nextAction && anim.currentAction !== nextAction) {
//         if (anim.currentAction) {
//           anim.currentAction.crossFadeTo(nextAction, 0.5, true);
//         }
//         nextAction.reset().play();
//         anim.currentAction = nextAction;
//       }

//       if (anim.currentAction) {
//         const denom = desiredGaitSpeed;
//         const targetTimeScale = speed / denom;
//         const clamped = THREE.MathUtils.clamp(targetTimeScale, 0.6, 1.4);
//         anim.currentAction.timeScale = THREE.MathUtils.lerp(anim.currentAction.timeScale ?? 1.0, clamped, 0.25);
//       }
//     }
//   }

//   // ---------------- MIXERS ----------------
//   if (mixer) mixer.update(frameDelta);
//   if (tpView?.mixer) tpView.mixer.update(frameDelta * 0.9);

//   checkPlayerPosition();
//   composer.render();
// }

// function animate() {
//   animationFrameId = requestAnimationFrame(animate);

//   const frameDelta = Math.min(0.05, clock.getDelta());
//   physicsTimeAccumulator += frameDelta;
//   const FIXED_TIMESTEP = 1 / 60;

//   if (outlinePass) {
//     const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
//     outlinePass.enabled = hasTargets;
//   }

//   // ---------------- TP VIEW ----------------
//   if (physiscsReady && activePlayer === 'tp' && tpView) {
//     // --- Step 1: Update the Crowd Agent's Target (if touring) ---
//     if (tpView.isTouring && tpView.crowdAgent && npcAgents.length > 0) {
//       const npcEntry = npcAgents[0];
//       const atDest = !!(npcEntry?.state?.mode === 'idle' && npcEntry?.state?.atDestination);

//       if (!atDest && npcEntry?.model) {
//         setPlayerFollowTarget(tpView.crowdAgent, npcEntry, navQuery);
//       } else if (tpView.crowdAgent) {
//         setAgentTarget(tpView.crowdAgent, tpView.crowdAgent.position, navQuery);
//       }
//     }

//     // --- Step 2: Update the Player's Visual Model ---
//     if (tpView.isTouring) {
//       if (typeof tpView.updateFollow === 'function') {
//         tpView.updateFollow(frameDelta);
//       } else {
//         tpView.syncFromCrowd();
//       }
//     } else {
//       for (let i = 0; i < STEPS_PER_FRAME; i++) {
//         tpView.update(frameDelta);
//       }
//     }

//     // --- Step 3: Camera update ---
//     if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
//       const npcEntry = npcAgents[0];
//       const lookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end)
//         .clone().add(new THREE.Vector3(0, 0.5, 0));
//       let cameraLookTarget = lookAtPoint.clone();

//       // --- Special case: touring at destination ---
//       // if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
//       //   const pic = npcEntry.state.currentPictureMesh;
//       //   pic.updateMatrixWorld(true);
//       //   const picPos = new THREE.Vector3();
//       //   pic.getWorldPosition(picPos);

//       //   // Snap camera to face picture directly (no skew)
//       //   camera.position.copy(lookAtPoint.clone().add(new THREE.Vector3(0, 1.5, -3)));
//       //   camera.lookAt(picPos);
//       //   return; // stop here for this frame
//       // }

//       // Replace your existing "touring at destination" special-case with this:

//     // --- Special case: touring at destination (stable, world-locked camera) ---
//     if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
//       const entry = npcEntry;
//       const pic = entry.state.currentPictureMesh;

//       try {
//         // get stable picture world position
//         pic.updateMatrixWorld(true);
//         const picPos = new THREE.Vector3();
//         pic.getWorldPosition(picPos);

//         // compute picture forward (world -Z for the mesh) -> direction the picture "faces"
//         const picForward = new THREE.Vector3();
//         pic.getWorldDirection(picForward); // returns -Z axis in world space
//         // Many meshes face +Z; getWorldDirection gives the direction -Z points *from the camera viewpoint*.
//         // If your pictures are oriented differently, you may invert this vector (picForward.multiplyScalar(-1))
//         // Here we'll assume picForward points out from the front of the picture; if it seems backwards invert it.
//         // Ensure it's horizontal (no pitch) so camera stays level
//         picForward.y = 0;
//         if (picForward.lengthSq() < 1e-6) {
//           picForward.set(0, 0, -1); // fallback forward
//         } else {
//           picForward.normalize();
//         }

//         // desired camera offset: distance away from wall + height above picture center
//         const DIST = 3.0;      // horizontal distance from picture plane
//         const HEIGHT = 1.5;    // vertical offset above picture center
//         // place camera in front of the picture along its forward direction
//         const camPosWorld = picPos.clone().add(picForward.clone().multiplyScalar(-DIST));
//         camPosWorld.y += HEIGHT;

//         // snap camera immediately
//         camera.position.copy(camPosWorld);
//         camera.lookAt(picPos);

//         // ensure we don't run collision/smoothing for the duration of the hold:
//         // store a lock + release time on the entry.state so other code can respect it
//         const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;
//         const hold = (npcEntry.tour && npcEntry.tour.holdTime) ? npcEntry.tour.holdTime : (TOUR_DEFAULT?.holdTime ?? 3.0);
//         if (!entry.state) entry.state = {};
//         entry.state.cameraLocked = true;
//         entry.state.cameraLockedUntil = nowSec + hold;

//         // Also copy the tourFacingQuat if available so NPC & camera orientation align
//         if (entry.state.tourFacingQuat) {
//           // optionally use it to orient camera smoothly around yaw while keeping pitch fixed
//           // but we already snapped looking at picPos, so this is optional:
//           // camera.quaternion.copy(entry.state.tourFacingQuat);
//         }

//         // short-circuit remaining camera logic for this frame so no further lerp/slerp runs
//         return;
//       } catch (e) {
//         // if anything fails, fall back to regular camera behavior (do nothing special)
//         console.warn('tour camera snap failed', e);
//       }
//     }


//       // --- Normal follow (with collision) ---
//       let idealOffset;
//       if (tpView.isTouring) {
//         idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(tpView.model.quaternion);
//       } else {
//         const playerQuat = (tpView.tempQuaternion ?? tpView.model.quaternion).clone();
//         const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camPitch);
//         playerQuat.multiply(pitchQuat);
//         idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(playerQuat);
//       }
//       const idealPos = lookAtPoint.clone().add(idealOffset);
//       let finalPos = idealPos.clone();

//       // Camera collision
//       const fovRadians = THREE.MathUtils.degToRad(camera.fov);
//       const near = camera.near;
//       const halfHeight = Math.tan(fovRadians * 0.5) * near;
//       const halfWidth = halfHeight * camera.aspect;
//       const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

//       cameraCollider.center.copy(finalPos);
//       cameraCollider.radius = camRadius;

//       const raycaster = new THREE.Raycaster(lookAtPoint, idealOffset.clone().normalize());
//       raycaster.near = 1e-14;
//       raycaster.far = idealOffset.length();
//       const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);

//       if (intersects.length > 0) {
//         const hitPoint = intersects[0].point;
//         finalPos.copy(hitPoint).sub(raycaster.ray.direction.clone().multiplyScalar(camRadius + 0.05));
//         cameraCollider.center.copy(finalPos);
//       }

//       // Smooth follow
//       const lerp = 0.05;
//       if (!tpView._cameraSnapped) {
//         camera.position.copy(finalPos);
//         tpView._cameraSnapped = true;
//       } else {
//         camera.position.lerp(finalPos, lerp);
//       }

//       // Smooth orientation
//       const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
//         new THREE.Matrix4().lookAt(camera.position, cameraLookTarget, camera.up)
//       );
//       camera.quaternion.slerp(targetQuaternion, 0.05);
//     }
//   }

//   // ---------------- FP VIEW ----------------
//   if (physiscsReady && activePlayer === 'fp' && fpView) {
//     for (let i = 0; i < STEPS_PER_FRAME; i++) {
//       fpView.update(frameDelta, camYaw, camPitch);
//     }
//   }

//   // ---------------- CROWD UPDATE ----------------
//   const FIXED_CROWD_DT = 1 / 60;
//   const MAX_CROWD_SUBSTEPS = 10;
//   updateCrowd(FIXED_CROWD_DT, frameDelta, MAX_CROWD_SUBSTEPS);
//   updateAgentTours(navQuery ?? getNavQuery());

//   // ---------------- NPC SYNC ----------------
//   const NPC_ROT_LERP_SPEED = 8.0;
//   const NPC_ARRIVAL_DIST = 0.08;
//   const NPC_MIXER_DISTANCE = 60;
//   const NPC_VERTICAL_SMOOTH = 0.6;

//   for (const entry of npcAgents) {
//     const agent = entry.agent;
//     const model = entry.model;
//     if (!agent || !model) continue;

//     entry.state = entry.state || { mode: 'idle', requestedGait: null };

//     const anim = model.userData?.animCtrl ?? model.userData?.animationCtrl;
//     if (anim && anim.mixer && camera.position.distanceTo(model.position) < NPC_MIXER_DISTANCE) {
//       anim.mixer.update(frameDelta * 0.9);
//     }

//     // --- agent position ---
//     let apos;
//     try {
//       apos = agent.interpolatedPosition ?? (typeof agent.position === 'function' ? agent.position() : agent.position);
//     } catch (e) {
//       apos = (typeof agent.position === 'function' ? agent.position() : agent.position);
//     }
//     if (!apos) continue;

//     const agentPos = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
//     const footOffset = typeof model.userData?.footOffset === 'number' ? model.userData.footOffset : 0;

//     let targetPos = new THREE.Vector3(agentPos.x, agentPos.y, agentPos.z);
//     let snappedToBVH = false;

//     if (bvhMeshList && bvhMeshList.length) {
//       try {
//         const downOrigin = new THREE.Vector3(agentPos.x, agentPos.y + 2.0, agentPos.z);
//         const downRay = new THREE.Raycaster(downOrigin, new THREE.Vector3(0, -1, 0));
//         const hits = downRay.intersectObjects(bvhMeshList, true);
//         if (hits && hits.length) {
//           targetPos.y = hits[0].point.y;
//           snappedToBVH = true;
//         }
//       } catch (e) {}
//     }
//     if (!snappedToBVH) {
//       const navToFloor = (model.userData && typeof model.userData.navMeshToFloorOffset === 'number') ? model.userData.navMeshToFloorOffset : 0;
//       targetPos.y = agentPos.y + navToFloor;
//     }
//     targetPos.y += footOffset;

//     model.position.x = targetPos.x;
//     model.position.z = targetPos.z;
//     model.position.y = THREE.MathUtils.lerp(model.position.y, targetPos.y, NPC_VERTICAL_SMOOTH);

//     // --- arrival handling ---
//     let targetObj = null;
//     try { targetObj = (typeof agent.target === 'function') ? agent.target() : agent.target; } catch (e) {}
//     let reached = false;
//     if (targetObj && (('x' in targetObj) || Array.isArray(targetObj))) {
//       const tx = targetObj.x ?? targetObj[0];
//       const tz = targetObj.z ?? targetObj[2];
//       const tvec = new THREE.Vector3(tx, agentPos.y, tz);
//       if (agentPos.distanceTo(tvec) <= NPC_ARRIVAL_DIST) reached = true;
//     }

//     if (reached) {
//       try { if (typeof agent.resetMoveTarget === 'function') agent.resetMoveTarget(); } catch (e) {}
//       model.position.copy(targetPos);

//       if (anim && anim.idleAction) {
//         if (anim.currentAction && anim.currentAction !== anim.idleAction) {
//           anim.currentAction.crossFadeTo(anim.idleAction, 0.5, false);
//         }
//         anim.idleAction.reset().play();
//         anim.currentAction = anim.idleAction;
//         anim.currentAction.timeScale = 1.0;
//       }

//       entry.state.requestedGait = null;
//       entry.state.mode = 'idle';
//       continue;
//     }

//     const gaitWanted = entry.state.requestedGait ?? entry.state.mode;
//     const desiredGaitSpeed = (gaitWanted === 'run')
//       ? (entry.runSpeed ?? 6.0)
//       : (entry.walkSpeed ?? 1.6);

//     try {
//       if (typeof agent.updateParameters === 'function') {
//         agent.updateParameters({
//           maxSpeed: desiredGaitSpeed,
//           maxAcceleration: 30.0,
//         });
//       }
//     } catch (e) {}

//     let vel = null;
//     try { vel = (typeof agent.velocity === 'function') ? agent.velocity() : agent.velocity; } catch (e) {}
//     const vx = (vel?.x ?? vel?.[0]) ?? 0;
//     const vz = (vel?.z ?? vel?.[2]) ?? 0;
//     const speed = Math.sqrt(vx * vx + vz * vz);

//     const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

//     if (entry.state?.preventRotationUntil && entry.state.preventRotationUntil > nowSec) {
//       if (entry.state.tourFacingQuat && model) {
//         model.quaternion.copy(entry.state.tourFacingQuat);
//       }
//     } else {
//       if (speed > 1e-4) {
//         const desiredDir = new THREE.Vector3(vx, 0, vz).normalize();
//         const targetYaw = Math.atan2(desiredDir.x, desiredDir.z);
//         const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
//         model.quaternion.slerp(tq, Math.min(1, NPC_ROT_LERP_SPEED * frameDelta));
//       }
//     }

//     // --- animation ---
//     if (anim) {
//       let nextAction = null;
//       if (gaitWanted === 'run' && anim.runningAction) nextAction = anim.runningAction;
//       else if (gaitWanted === 'walk' && anim.walkAction) nextAction = anim.walkAction;
//       else if (anim.idleAction) nextAction = anim.idleAction;

//       if (nextAction && anim.currentAction !== nextAction) {
//         if (anim.currentAction) {
//           anim.currentAction.crossFadeTo(nextAction, 0.5, true);
//         }
//         nextAction.reset().play();
//         anim.currentAction = nextAction;
//       }

//       if (anim.currentAction) {
//         const denom = desiredGaitSpeed;
//         const targetTimeScale = speed / denom;
//         const clamped = THREE.MathUtils.clamp(targetTimeScale, 0.6, 1.4);
//         anim.currentAction.timeScale = THREE.MathUtils.lerp(anim.currentAction.timeScale ?? 1.0, clamped, 0.25);
//       }
//     }
//   }

//   // ---------------- MIXERS ----------------
//   if (mixer) mixer.update(frameDelta);
//   if (tpView?.mixer) tpView.mixer.update(frameDelta * 0.9);

//   checkPlayerPosition();
//   composer.render();
// }

// function animate() {
//   animationFrameId = requestAnimationFrame(animate);

//   const frameDelta = Math.min(0.05, clock.getDelta());
//   physicsTimeAccumulator += frameDelta;
//   const FIXED_TIMESTEP = 1 / 60;

//   if (outlinePass) {
//     const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
//     outlinePass.enabled = hasTargets;
//   }

//   // ---------------- TP VIEW ----------------
//   if (physiscsReady && activePlayer === 'tp' && tpView) {
//     // --- Step 1: Update the Crowd Agent's Target (if touring) ---
//     if (tpView.isTouring && tpView.crowdAgent && npcAgents.length > 0) {
//       const npcEntry = npcAgents[0];
//       const atDest = !!(npcEntry?.state?.mode === 'idle' && npcEntry?.state?.atDestination);

//       if (!atDest && npcEntry?.model) {
//         // follow the NPC's tour
//         setPlayerFollowTarget(tpView.crowdAgent, npcEntry, navQuery);
//       } else if (tpView.crowdAgent) {
//         // NPC arrived: cancel player's move target rather than create a new static point
//         try {
//           if (typeof tpView.crowdAgent.resetMoveTarget === 'function') {
//             tpView.crowdAgent.resetMoveTarget();
//           } else {
//             setAgentTarget(tpView.crowdAgent, tpView.crowdAgent.position, navQuery);
//           }
//         } catch (e) { /* ignore */ }
//       }
//     }

//     // --- Step 2: Update the Player's Visual Model ---
//     if (tpView.isTouring) {
//       if (typeof tpView.updateFollow === 'function') {
//         try { tpView.updateFollow(frameDelta); } catch (e) { try { tpView.syncFromCrowd(); } catch (ee) {} }
//       } else {
//         try { tpView.syncFromCrowd(); } catch (e) {}
//       }
//     } else {
//       for (let i = 0; i < STEPS_PER_FRAME; i++) {
//         try { tpView.update(frameDelta); } catch (e) { /* ignore per-step errors */ }
//       }
//     }

//     // --- Step 3: Camera update (single consolidated block) ---
//     if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
//       const npcEntry = npcAgents[0];
//       const lookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end)
//         .clone().add(new THREE.Vector3(0, 0.5, 0));
//       let cameraLookTarget = lookAtPoint.clone();

//       // compute camRadius (used for collision margin and snap-time raycast)
//       const fovRadians = THREE.MathUtils.degToRad(camera.fov);
//       const near = camera.near;
//       const halfHeight = Math.tan(fovRadians * 0.5) * near;
//       const halfWidth = halfHeight * camera.aspect;
//       const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

//       // --- CAMERA LOCK UNLOCK CHECK ---
//       if (npcEntry && npcEntry.state?.cameraLocked) {
//         const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;
//         if (npcEntry.state.cameraLockedUntil && npcEntry.state.cameraLockedUntil > nowSec) {
//           // STILL LOCKED: forcibly restore stored pose every frame (prevents any drift)
//           const pose = npcEntry.state.cameraLockedPose;
//           if (pose?.pos && pose?.quat) {
//             camera.position.copy(pose.pos);
//             camera.quaternion.copy(pose.quat);
//             // ensure snapped flag so we don't interpolate on unlock
//             tpView._cameraSnapped = true;
//           }
//           // skip normal camera processing for this frame (we have restored the exact pose)
//         } else {
//           // LOCK EXPIRED: clear lock and allow normal processing next frames
//           npcEntry.state.cameraLocked = false;
//           npcEntry.state.cameraLockedUntil = null;
//           tpView._cameraSnapped = false;
//         }
//       } else {
//         // If we're not locked, either snap now (if we've just arrived) or run normal camera logic
//         if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
//           // --- SNAP-AND-LOCK (single-time, collision-aware) ---
//           const entry = npcEntry;
//           const pic = entry.state.currentPictureMesh;
//           try {
//             pic.updateMatrixWorld(true);
//             const picPos = new THREE.Vector3();
//             pic.getWorldPosition(picPos);

//             // picture forward (world -Z of mesh). If it's backwards for your assets,
//             // invert with picForward.multiplyScalar(-1)
//             const picForward = new THREE.Vector3();
//             pic.getWorldDirection(picForward);
//             picForward.y = 0;
//             picForward.multiplyScalar(-1); // assume we want to face the front of the picture
//             if (picForward.lengthSq() < 1e-6) picForward.set(0, 0, -1);
//             else picForward.normalize();

//             // framing params (tweak as needed)
//             const DIST = 3.0;
//             const HEIGHT = 1.5;

//             // ideal camera world position in front of picture
//             let camPosWorld = picPos.clone().add(picForward.clone().multiplyScalar(-DIST));
//             camPosWorld.y += HEIGHT;

//             // Single-time collision check from picture toward cam pos (push camera forward if blocked)
//             try {
//               const dir = camPosWorld.clone().sub(picPos);
//               const dirLen = dir.length();
//               if (dirLen > 1e-4) {
//                 const dirNorm = dir.clone().normalize();
//                 const snapRay = new THREE.Raycaster(picPos, dirNorm, 1e-8, dirLen);
//                 const hits = snapRay.intersectObjects(tpView.bvhMeshes, true);
//                 if (hits && hits.length > 0) {
//                   const hp = hits[0].point;
//                   camPosWorld.copy(hp).sub(dirNorm.clone().multiplyScalar(camRadius + 0.05));
//                 }
//               }
//             } catch (e) {
//               // if raycast fails, ignore and use camPosWorld as-is
//             }

//             // snap camera to computed world pose and compute quaternion via lookAt
//             camera.position.copy(camPosWorld);
//             camera.lookAt(picPos);
//             const lockedQuat = camera.quaternion.clone();

//             // store locked pose so we can reapply it exactly each frame
//             if (!entry.state) entry.state = {};
//             entry.state.cameraLockedPose = {
//               pos: camPosWorld.clone(),
//               quat: lockedQuat.clone()
//             };

//             // set lock duration
//             const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;
//             const hold = (entry.tour && entry.tour.holdTime) ? entry.tour.holdTime : (TOUR_DEFAULT?.holdTime ?? 3.0);
//             entry.state.cameraLocked = true;
//             entry.state.cameraLockedUntil = nowSec + hold;

//             // mark snapped so smoothing won't jump on unlock
//             tpView._cameraSnapped = true;
//           } catch (e) {
//             console.warn('tour camera snap failed', e);
//             // fallback to normal camera behavior below
//           }
//         } else {
//           // --- Normal follow (with collision + smoothing) ---
//           if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
//             try {
//               const pic = npcEntry.state.currentPictureMesh;
//               pic.updateMatrixWorld(true);
//               const picPos2 = new THREE.Vector3();
//               pic.getWorldPosition(picPos2);
//               cameraLookTarget.copy(picPos2);
//             } catch (e) {}
//           }

//           // compute ideal offset based on player orientation (touring uses model quaternion)
//           let idealOffset;
//           if (tpView.isTouring) {
//             idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(tpView.model.quaternion);
//           } else {
//             const playerQuat = (tpView.tempQuaternion ?? tpView.model.quaternion).clone();
//             const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camPitch);
//             playerQuat.multiply(pitchQuat);
//             idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(playerQuat);
//           }

//           const idealPos = lookAtPoint.clone().add(idealOffset);
//           let finalPos = idealPos.clone();

//           // camera collision as sphere
//           const rayDir = idealOffset.clone().normalize();
//           const rayDist = idealOffset.length();
//           const raycaster = new THREE.Raycaster(lookAtPoint, rayDir);
//           raycaster.near = 1e-14;
//           raycaster.far = rayDist;

//           const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);
//           if (intersects.length > 0) {
//             const hitPoint = intersects[0].point;
//             finalPos.copy(hitPoint).sub(rayDir.clone().multiplyScalar(camRadius + 0.05));
//           }

//           // Smooth follow
//           const lerp = 0.05;
//           if (!tpView._cameraSnapped) {
//             camera.position.copy(finalPos);
//             tpView._cameraSnapped = true;
//           } else {
//             camera.position.lerp(finalPos, lerp);
//           }

//           // Smooth look
//           const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
//             new THREE.Matrix4().lookAt(camera.position, cameraLookTarget, camera.up)
//           );
//           camera.quaternion.slerp(targetQuaternion, 0.05);
//         }
//       }
//     }
//   }

//   // ---------------- FP VIEW ----------------
//   if (physiscsReady && activePlayer === 'fp' && fpView) {
//     for (let i = 0; i < STEPS_PER_FRAME; i++) {
//       fpView.update(frameDelta, camYaw, camPitch);
//     }
//   }

//   // ---------------- CROWD UPDATE ----------------
//   const FIXED_CROWD_DT = 1 / 60;
//   const MAX_CROWD_SUBSTEPS = 10;
//   updateCrowd(FIXED_CROWD_DT, frameDelta, MAX_CROWD_SUBSTEPS);
//   updateAgentTours(navQuery ?? getNavQuery());

//   // ---------------- NPC SYNC ----------------
//   const NPC_ROT_LERP_SPEED = 8.0;
//   const NPC_ARRIVAL_DIST = 0.08;
//   const NPC_MIXER_DISTANCE = 60;
//   const NPC_VERTICAL_SMOOTH = 0.6;

//   for (const entry of npcAgents) {
//     const agent = entry.agent;
//     const model = entry.model;
//     if (!agent || !model) continue;

//     entry.state = entry.state || { mode: 'idle', requestedGait: null };

//     const anim = model.userData?.animCtrl ?? model.userData?.animationCtrl;
//     if (anim && anim.mixer && camera.position.distanceTo(model.position) < NPC_MIXER_DISTANCE) {
//       anim.mixer.update(frameDelta * 0.9);
//     }

//     // --- agent position ---
//     let apos;
//     try {
//       apos = agent.interpolatedPosition ?? (typeof agent.position === 'function' ? agent.position() : agent.position);
//     } catch (e) {
//       apos = (typeof agent.position === 'function' ? agent.position() : agent.position);
//     }
//     if (!apos) continue;

//     const agentPos = new THREE.Vector3(apos.x ?? apos[0], apos.y ?? apos[1], apos.z ?? apos[2]);
//     const footOffset = typeof model.userData?.footOffset === 'number' ? model.userData.footOffset : 0;

//     let targetPos = new THREE.Vector3(agentPos.x, agentPos.y, agentPos.z);
//     let snappedToBVH = false;

//     if (bvhMeshList && bvhMeshList.length) {
//       try {
//         const downOrigin = new THREE.Vector3(agentPos.x, agentPos.y + 2.0, agentPos.z);
//         const downRay = new THREE.Raycaster(downOrigin, new THREE.Vector3(0, -1, 0));
//         const hits = downRay.intersectObjects(bvhMeshList, true);
//         if (hits && hits.length) {
//           targetPos.y = hits[0].point.y;
//           snappedToBVH = true;
//         }
//       } catch (e) {}
//     }
//     if (!snappedToBVH) {
//       const navToFloor = (model.userData && typeof model.userData.navMeshToFloorOffset === 'number') ? model.userData.navMeshToFloorOffset : 0;
//       targetPos.y = agentPos.y + navToFloor;
//     }
//     targetPos.y += footOffset;

//     model.position.x = targetPos.x;
//     model.position.z = targetPos.z;
//     model.position.y = THREE.MathUtils.lerp(model.position.y, targetPos.y, NPC_VERTICAL_SMOOTH);

//     // --- arrival handling ---
//     let targetObj = null;
//     try { targetObj = (typeof agent.target === 'function') ? agent.target() : agent.target; } catch (e) {}
//     let reached = false;
//     if (targetObj && (('x' in targetObj) || Array.isArray(targetObj))) {
//       const tx = targetObj.x ?? targetObj[0];
//       const tz = targetObj.z ?? targetObj[2];
//       const tvec = new THREE.Vector3(tx, agentPos.y, tz);
//       if (agentPos.distanceTo(tvec) <= NPC_ARRIVAL_DIST) reached = true;
//     }

//     if (reached) {
//       try { if (typeof agent.resetMoveTarget === 'function') agent.resetMoveTarget(); } catch (e) {}
//       model.position.copy(targetPos);

//       if (anim && anim.idleAction) {
//         if (anim.currentAction && anim.currentAction !== anim.idleAction) {
//           anim.currentAction.crossFadeTo(anim.idleAction, 0.5, false);
//         }
//         anim.idleAction.reset().play();
//         anim.currentAction = anim.idleAction;
//         anim.currentAction.timeScale = 1.0;
//       }

//       entry.state.requestedGait = null;
//       entry.state.mode = 'idle';
//       continue;
//     }

//     const gaitWanted = entry.state.requestedGait ?? entry.state.mode;
//     const desiredGaitSpeed = (gaitWanted === 'run')
//       ? (entry.runSpeed ?? 6.0)
//       : (entry.walkSpeed ?? 1.6);

//     try {
//       if (typeof agent.updateParameters === 'function') {
//         agent.updateParameters({
//           maxSpeed: desiredGaitSpeed,
//           maxAcceleration: 30.0,
//         });
//       }
//     } catch (e) {}

//     let vel = null;
//     try { vel = (typeof agent.velocity === 'function') ? agent.velocity() : agent.velocity; } catch (e) {}
//     const vx = (vel?.x ?? vel?.[0]) ?? 0;
//     const vz = (vel?.z ?? vel?.[2]) ?? 0;
//     const speed = Math.sqrt(vx * vx + vz * vz);

//     const nowSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

//     if (entry.state?.preventRotationUntil && entry.state.preventRotationUntil > nowSec) {
//       if (entry.state.tourFacingQuat && model) {
//         model.quaternion.copy(entry.state.tourFacingQuat);
//       }
//     } else {
//       if (speed > 1e-4) {
//         const desiredDir = new THREE.Vector3(vx, 0, vz).normalize();
//         const targetYaw = Math.atan2(desiredDir.x, desiredDir.z);
//         const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
//         model.quaternion.slerp(tq, Math.min(1, NPC_ROT_LERP_SPEED * frameDelta));
//       }
//     }

//     // --- animation ---
//     if (anim) {
//       let nextAction = null;
//       if (gaitWanted === 'run' && anim.runningAction) nextAction = anim.runningAction;
//       else if (gaitWanted === 'walk' && anim.walkAction) nextAction = anim.walkAction;
//       else if (anim.idleAction) nextAction = anim.idleAction;

//       if (nextAction && anim.currentAction !== nextAction) {
//         if (anim.currentAction) {
//           anim.currentAction.crossFadeTo(nextAction, 0.5, true);
//         }
//         nextAction.reset().play();
//         anim.currentAction = nextAction;
//       }

//       if (anim.currentAction) {
//         const denom = desiredGaitSpeed;
//         const targetTimeScale = speed / denom;
//         const clamped = THREE.MathUtils.clamp(targetTimeScale, 0.6, 1.4);
//         anim.currentAction.timeScale = THREE.MathUtils.lerp(anim.currentAction.timeScale ?? 1.0, clamped, 0.25);
//       }
//     }
//   }

//   // ---------------- MIXERS ----------------
//   if (mixer) mixer.update(frameDelta);
//   if (tpView?.mixer) tpView.mixer.update(frameDelta * 0.9);

//   checkPlayerPosition();
//   composer.render();
// }

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  const frameDelta = Math.min(0.05, clock.getDelta());
  physicsTimeAccumulator += frameDelta;
  const FIXED_TIMESTEP = 1 / 60;

  if (outlinePass) {
    const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
    outlinePass.enabled = hasTargets;
  }

  // ---------------- TP VIEW ----------------
  if (physiscsReady && activePlayer === 'tp' && tpView) {
    // --- Step 1: Update the Crowd Agent's Target (if touring) ---
    if (tpView.isTouring && tpView.crowdAgent && npcAgents.length > 0) {
      const npcEntry = npcAgents[0];
      const atDest = !!(npcEntry?.state?.mode === 'idle' && npcEntry?.state?.atDestination);

      if (!atDest && npcEntry?.model) {
        setPlayerFollowTarget(tpView.crowdAgent, npcEntry, navQuery);
      } else if (tpView.crowdAgent) {
        setAgentTarget(tpView.crowdAgent, tpView.crowdAgent.position, navQuery);
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
      const lookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end)
        .clone().add(new THREE.Vector3(0, 0.5, 0));
      let cameraLookTarget = lookAtPoint.clone();

      // --- Special case: touring at destination (stable, world-locked camera) ---
      if (tpView.isTouring && npcEntry && npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
        const entry = npcEntry;
        const pic = entry.state.currentPictureMesh;

        try {
          pic.updateMatrixWorld(true);

          // --- Get picture center ---
          const picPos = new THREE.Vector3();
          pic.getWorldPosition(picPos);

          // --- Get picture forward direction ---
          const picForward = new THREE.Vector3();
          pic.getWorldDirection(picForward); // -Z by default in Three.js

          // If picture faces the wrong way (into the wall), flip
          const camTest = picPos.clone().add(picForward.clone().multiplyScalar(0.5));
          if (camTest.distanceTo(camera.position) < picPos.distanceTo(camera.position)) {
            picForward.multiplyScalar(-1);
          }

          // Keep forward horizontal
          picForward.y = 0;
          if (picForward.lengthSq() < 1e-6) {
            picForward.set(0, 0, -1);
          } else {
            picForward.normalize();
          }

          // --- Compute camera placement ---
          const DIST   = 3.0;   // distance in front of picture
          const HEIGHT = 1.5;   // vertical lift
          const camPosWorld = picPos.clone().add(picForward.clone().multiplyScalar(-DIST));
          camPosWorld.y += HEIGHT;

          // Snap camera immediately
          camera.position.copy(camPosWorld);
          camera.lookAt(picPos);

          // --- Lock camera until hold time expires ---
          const nowSec = (typeof performance !== 'undefined')
            ? performance.now() / 1000
            : Date.now() / 1000;
          const hold = (npcEntry.tour && npcEntry.tour.holdTime)
            ? npcEntry.tour.holdTime
            : (TOUR_DEFAULT?.holdTime ?? 3.0);

          if (!entry.state) entry.state = {};
          entry.state.cameraLocked = true;
          entry.state.cameraLockedUntil = nowSec + hold;

          return; // short-circuit other camera logic
        } catch (e) {
          console.warn('tour camera snap failed', e);
        }
      }

      // --- Normal follow (with collision) ---
      let idealOffset;
      if (tpView.isTouring) {
        idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(tpView.model.quaternion);
      } else {
        const playerQuat = (tpView.tempQuaternion ?? tpView.model.quaternion).clone();
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camPitch);
        playerQuat.multiply(pitchQuat);
        idealOffset = new THREE.Vector3(0, 0, -3.0).applyQuaternion(playerQuat);
      }
      const idealPos = lookAtPoint.clone().add(idealOffset);
      let finalPos = idealPos.clone();

      // Camera collision
      const fovRadians = THREE.MathUtils.degToRad(camera.fov);
      const near = camera.near;
      const halfHeight = Math.tan(fovRadians * 0.5) * near;
      const halfWidth = halfHeight * camera.aspect;
      const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

      cameraCollider.center.copy(finalPos);
      cameraCollider.radius = camRadius;

      const raycaster = new THREE.Raycaster(lookAtPoint, idealOffset.clone().normalize());
      raycaster.near = 1e-14;
      raycaster.far = idealOffset.length();
      const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);

      if (intersects.length > 0) {
        const hitPoint = intersects[0].point;
        finalPos.copy(hitPoint).sub(raycaster.ray.direction.clone().multiplyScalar(camRadius + 0.05));
        cameraCollider.center.copy(finalPos);
      }

      // Smooth follow
      const lerp = 0.05;
      if (!tpView._cameraSnapped) {
        camera.position.copy(finalPos);
        tpView._cameraSnapped = true;
      } else {
        camera.position.lerp(finalPos, lerp);
      }

      // Smooth orientation
      const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(camera.position, cameraLookTarget, camera.up)
      );
      camera.quaternion.slerp(targetQuaternion, 0.05);
    }
  }

  // ---------------- FP VIEW ----------------
  if (physiscsReady && activePlayer === 'fp' && fpView) {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      fpView.update(frameDelta, camYaw, camPitch);
    }
  }

  // ---------------- CROWD UPDATE ----------------
  const FIXED_CROWD_DT = 1 / 60;
  const MAX_CROWD_SUBSTEPS = 10;
  updateCrowd(FIXED_CROWD_DT, frameDelta, MAX_CROWD_SUBSTEPS);
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
      anim.mixer.update(frameDelta * 0.9);
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

    model.position.x = targetPos.x;
    model.position.z = targetPos.z;
    model.position.y = THREE.MathUtils.lerp(model.position.y, targetPos.y, NPC_VERTICAL_SMOOTH);

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
          anim.currentAction.crossFadeTo(anim.idleAction, 0.5, false);
        }
        anim.idleAction.reset().play();
        anim.currentAction = anim.idleAction;
        anim.currentAction.timeScale = 1.0;
      }

      entry.state.requestedGait = null;
      entry.state.mode = 'idle';
      continue;
    }

    const gaitWanted = entry.state.requestedGait ?? entry.state.mode;
    const desiredGaitSpeed = (gaitWanted === 'run')
      ? (entry.runSpeed ?? 6.0)
      : (entry.walkSpeed ?? 1.6);

    try {
      if (typeof agent.updateParameters === 'function') {
        agent.updateParameters({
          maxSpeed: desiredGaitSpeed,
          maxAcceleration: 30.0,
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
          anim.currentAction.crossFadeTo(nextAction, 0.5, true);
        }
        nextAction.reset().play();
        anim.currentAction = nextAction;
      }

      if (anim.currentAction) {
        const denom = desiredGaitSpeed;
        const targetTimeScale = speed / denom;
        const clamped = THREE.MathUtils.clamp(targetTimeScale, 0.6, 1.4);
        anim.currentAction.timeScale = THREE.MathUtils.lerp(anim.currentAction.timeScale ?? 1.0, clamped, 0.25);
      }
    }
  }

  // ---------------- MIXERS ----------------
  if (mixer) mixer.update(frameDelta);
  if (tpView?.mixer) tpView.mixer.update(frameDelta * 0.9);

  checkPlayerPosition();
  composer.render();
}


function activateThirdPerson() {
  activePlayer = 'tp';

  if (tpViewLoadLate) {
    // TP not yet created → build it now
    if (!tpViewExisted && character) {
      tpView = new ThirdPersonPlayer(camera, scene, playerCollider, character.model);
    //   tpView.buildBVH(currentScene);
      tpView.buildBVHFromMeshes(bvhMeshList);
      tpView.handleAnimation(character.model, character.gltf);

      // 🔹 snap smoothing state immediately
      if (tpView.playerCollider) {
        tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
      }
      if (tpView.tempQuaternion && tpView.model) {
        tpView.tempQuaternion.copy(tpView.model.quaternion);
      }
      tpView._cameraSnapped = false;

      scene.add(tpView.model);
      tpViewExisted = true;
      tpViewLoadLate = false;
    } 
    else if (tpViewExisted && character) {
      // reattach if model exists
      if (!tpView.model) {
        tpView.attachModel(character.model);
      }
      tpView.handleAnimation(character.model, character.gltf);

      // 🔹 snap smoothing state
      if (tpView.playerCollider) {
        tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
      }
      if (tpView.tempQuaternion && tpView.model) {
        tpView.tempQuaternion.copy(tpView.model.quaternion);
      }
      tpView._cameraSnapped = false;

      scene.add(tpView.model);
      tpViewLoadLate = false;
    } 
    else {
      console.info("Not finish load Character Model yet! Reactivating, please wait ...");
      setTimeout(activateThirdPerson, 1000);
      tpViewExisted = false;
      tpViewLoadLate = false;
    }
  } 
  else if (!tpViewLoadLate && tpViewExisted) {
    // 🔹 Reset movement/input so no auto-walk carries over
    tpView.resetControls();

    // 🔹 Align facing with current FP yaw
    tpView.faceYaw(camYaw);

    // 🔹 Snap smoothing state so model + camera align immediately
    if (tpView.playerCollider) {
      tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
    }
    if (tpView.tempQuaternion && tpView.model) {
      tpView.tempQuaternion.copy(tpView.model.quaternion);
    }
    tpView._cameraSnapped = false;

    scene.add(tpView.model);
    tpView.model.visible = true;
  }
}



function activateFirstPerson() {
  if (tpView && tpView.model) {
    const e = new THREE.Euler().setFromQuaternion(tpView.model.quaternion, 'YXZ');
    camYaw = e.y;
    camPitch = 0;
    if (fpView) {
      fpView.resetControls();      // 🔹 stop stale movement
      if (fpView._smoothedPlayerPosition && fpView.playerCollider) {
        fpView._smoothedPlayerPosition.copy(fpView.playerCollider.end);
      }
      if (typeof fpView.tempQuaternion !== 'undefined' && fpView.model) {
        fpView.tempQuaternion.copy(fpView.model.quaternion || new THREE.Quaternion());
      }
      fpView.setYaw(camYaw);
      fpView.setPitch(camPitch);
      fpView._cameraSnapped = false; // 🔹 snap camera next frame
    }
  }
  activePlayer = 'fp';
  if (tpView?.model){
    scene.remove(tpView.model);
    tpView.model.visible = false;
  } 
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
    outlinePass.renderToScreen = true;      // if it's the last pass
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
        if (event.code === 'KeyV'){
            // active toogle to switch between first and third view
            activePlayer === 'fp' ? activateThirdPerson() : activateFirstPerson();
        }

        // Toogle automatic agent room tour
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
              stopAgentTour(npc);
              npc.state.touring = false;
              tpView.isTouring = false;

              // stop TP crowd agent & visual following
              if (tpView) {
                try {
                  if (typeof tpView.stopFollowAgent === 'function'){
                    tpView.stopFollowAgent();
                    tpView.isTouring = false;
                    npc.state.touring = false;
                  }
                } catch (e) {
                  console.warn('Error while stopping TP follow agent:', e);
                }

                try {
                  if (tpView.crowdAgent) {
                    // prefer using CrowdManager.removeAgent if available, otherwise call crowd.removeAgent
                    if (typeof removeAgent === 'function') {
                      removeAgent(tpView.crowdAgent);
                    } else if (crowd && typeof crowd.removeAgent === 'function') {
                      crowd.removeAgent(tpView.crowdAgent);
                    }
                  }
                } catch (e) {
                  console.warn('Failed to remove TP crowd agent cleanly:', e);
                }
                tpView.crowdAgent = null;
              }
              console.info('Stopped museum tour for NPC + TP');
            } else {
              // --- START TOUR ---
              startAgentTour(npc, pictureFramesArray, navQ, {
                loop: false,
                holdTime: 3.0,
                desiredDistance: 1.2,
                gait: 'walk',
                targetsMap: tourTargetsMap
              });
              npc.state = npc.state || {};
              npc.state.touring = true;
              tpView.isTouring = true;
              console.info('Started museum tour for NPC (I pressed)');

              // --- ADD TP TO CROWD ---
              if (tpView && crowd) {
                activateThirdPerson();
                const followSide = Math.random() < 0.5 ? -1 : 1; // random left/right
                console.log(`TP will follow on the ${followSide === -1 ? 'left' : 'right'} side of NPC`);

                if (!tpView.crowdAgent) {
                  // addThirdPersonToCrowd should set tpView.crowdAgent to a resolved agent object when possible
                  const agentResult = addThirdPersonToCrowd(scene, crowd, tpView);
                  console.log('TP crowd agent creation returned:', agentResult);

                  // If addThirdPersonToCrowd returned a numeric id and tpView.crowdAgent is still falsy,
                  // try resolving the agent object from the crowd API so tpView.syncFromCrowd/updateFollow can call .position()
                  if (!tpView.crowdAgent && typeof agentResult === 'number' && crowd && typeof crowd.getAgent === 'function') {
                    try {
                      const resolved = crowd.getAgent(agentResult);
                      if (resolved) {
                        tpView.setCrowdAgent(resolved);
                        console.log('Resolved TP crowd agent object from numeric id:', resolved);
                      } else {
                        console.warn('Could not resolve TP crowd agent object from id:', agentResult);
                      }
                    } catch (e) {
                      console.warn('Error resolving TP crowd agent from id:', e);
                    }
                  }
                }

                // make TP share the same target as NPC (initial)
                try {
                  if (tpView.crowdAgent && npc.model && navQ && typeof setAgentTarget === 'function') {
                    const npcPos = npc.model.position;
                    setAgentTarget(tpView.crowdAgent, { x: npcPos.x, y: npcPos.y, z: npcPos.z }, navQ, { entry: null, requestedGait: 'walk' });
                  } else {
                    // fallback: attempt crowd.requestMoveTarget if no setAgentTarget helper
                    if (tpView.crowdAgent && npc.model && crowd && typeof crowd.requestMoveTarget === 'function') {
                      try {
                        const npcPos = npc.model.position;
                        crowd.requestMoveTarget(tpView.crowdAgent, { x: npcPos.x, y: npcPos.y, z: npcPos.z });
                      } catch (e) {
                        console.warn('Fallback crowd.requestMoveTarget failed:', e);
                      }
                    }
                  }
                } catch (e) {
                  console.warn('Failed to set initial TP agent target:', e);
                }

                // start the TP visual follow (so the visible model & camera follow the agent)
                try {
                  if (typeof tpView.startFollowAgent === 'function') {
                    tpView.startFollowAgent(npc, { offsetBehind: 1, smoothing: 0.12, heightOffset: 0.0, side: followSide });
                  } else {
                    console.warn('tpView.startFollowAgent not available');
                  }
                } catch (e) {
                  console.warn('Error calling tpView.startFollowAgent:', e);
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
            const RUN_DISTANCE_THRESHOLD = 10.0; // tweak this threshold

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