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
import { Capsule, DRACOLoader, Wireframe} from "three/examples/jsm/Addons.js";
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
import { initRecastIfNeeded , buildNavMeshFromMeshes , getNavQuery , getNavHelper } from "./recastNav.js";
import NPCGuide from "./NPCGuide.js";
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { addAgent, initCrowd, updateCrowd, getAgents, setAgentTarget } from './CrowdManager.js';
import * as CrowdManager from './CrowdManager.js';




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

let navQuery = null;
const navInputSet = new Set();   // meshes to feed into recast (floor + obstacles)
const bvhMeshList = [];          // meshes used for BVH raycasts (ground snap + capsule checks)
const navInputMeshes = [];   // meshes we will pass to recast


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
    [Museum.ART_GALLERY]: "optimizedModel/optimizeModel_9.glb",
    [Museum.LOUVRE]: "art_hallway/VIRTUAL_ART_GALLERY_3.gltf",
}
let raycasterManager = null
let pictureFramesArray = []
let imageMeshesArray = []
let doorBoundingBox = null;
let hasEnteredNewScene = false;

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

        // function initNPC(scene, navQuery, bvhMeshes) {

        //     if (!navQuery){
        //         console.log("Nav query is not exist yet. museumNPC init may be fail");
        //     }
        //     const loader = new GLTFLoader();
        //     // loader.load('/models/npc.glb', (gltf) => {
        //         const npcModel = SkeletonUtils.clone(characterModel);

        //         // ensure model world matrix is updated
        //         npcModel.updateMatrixWorld(true);
        //           npcModel.traverse((child) => {
        //             if (child.isMesh) {
        //             child.castShadow = true;
        //             child.receiveShadow = true;
        //             // optional: re-tune material if you have tuneMaterial helper
        //             if (Array.isArray(child.material)) child.material = child.material.map(tuneMaterial);
        //             else child.material = tuneMaterial(child.material);
        //             }
        //         });


        //         // choose a starting position (example near player start)
        //         npcModel.position.set(0.5, 0, 0.5);
        //         scene.add(npcModel);

        //         if (characterGLTF){
        //             console.info("characterGLTF exist already");
        //         }else{
        //             console.warn("characterGLTF not exist yet. museumNPC init may be fail")
        //         }

        //         // create NPCGuide (this handles animation, floor snap, obstacle detection)
        //         museumNPC = new NPCGuide({
        //             scene,
        //             navQuery: navQuery ? navQuery : null,
        //             model: npcModel,
        //             gltf: characterGLTF,
        //             bvhMeshes: bvhMeshes,             // your navmesh or floor/obstacle meshes
        //             walkSpeed: 1.2,
        //             runSpeed: 2.4,
        //             turnSpeed: 6.0,
        //             heightOffset: 1.0,
        //             arrivalRadius: 0.15,
        //             useCapsuleCollision: false,  // turn true if you want capsule sweep
        //         });

        //         museumNPC.getAnimation();
            
        //         if (museumNPC.computeFootOffset) museumNPC.computeFootOffset();


        //         // after NPCGuide computes its foot offset, do an initial downward snap
        //         // const downRay = new THREE.Raycaster(
        //         // npcModel.position.clone().add(new THREE.Vector3(0, 1, 0)),
        //         // new THREE.Vector3(0, -1, 0)
        //         // );
        //         // const hits = downRay.intersectObjects(bvhMeshes, true);
        //         // if (hits.length > 0) {
        //         // const footOffset = npcModel.userData?.footOffset ?? 0.01;
        //         // npcModel.position.y = hits[0].point.y + footOffset + 1e-3;
        //         // }
        //         // initial vertical snap: prefer navmesh projection
        //         const footOffset = npcModel.userData?.footOffset ?? 0.01;
        //         let snapped = false;
        //         if (navQuery) {
        //         try {
        //             const np = navQuery.findClosestPoint({ x: npcModel.position.x, y: npcModel.position.y + 1.0, z: npcModel.position.z });
        //             if (np && np.point) {
        //             npcModel.position.y = np.point.y + footOffset + 1e-3;
        //             snapped = true;
        //             }
        //         } catch (e) {
        //             console.warn('initNPC: navQuery.findClosestPoint failed:', e);
        //         }
        //         }
        //         if (!snapped && bvhMeshes?.length) {
        //         const downRay = new THREE.Raycaster(npcModel.position.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0));
        //         const hits = downRay.intersectObjects(bvhMeshes, true);
        //         if (hits.length > 0) {
        //             npcModel.position.y = hits[0].point.y + footOffset + 1e-3;
        //         }
        //         }


        //         console.info('NPC initialized at', npcModel.position);
        //     // });
        // }

// Smooth animation loop
// function initNPC(scene, navQuery, bvhMeshes) {
//     const npcModel = SkeletonUtils.clone(characterModel);

//     npcModel.traverse((child) => {
//         if (child.isMesh) {
//             child.castShadow = true;
//             child.receiveShadow = true;
//             if (Array.isArray(child.material)) child.material = child.material.map(tuneMaterial);
//             else child.material = tuneMaterial(child.material);
//         }
//     });

//     const startPosition = new THREE.Vector3(0.5, 0, 0.5);
    
//     // Find the closest valid navmesh point to our desired start
//     const { point: navStartPoint } = navQuery.findClosestPoint(startPosition);
//     if (navStartPoint) {
//       npcModel.position.copy(navStartPoint);
//     } else {
//       npcModel.position.copy(startPosition);
//       console.warn('NPC start position is not on the navmesh.');
//     }
    
//     scene.add(npcModel);

//     // This is a simplified animation controller, reusing your ThirdPersonPlayer class
//     // for its animation logic ONLY. We won't use its physics or movement.
//     const animCtrl = new ThirdPersonPlayer(null, scene, null, npcModel);
//     animCtrl.handleAnimation(npcModel, characterGLTF);

//     // Add an agent to the crowd simulation
//     if (npcModel){
//         museumNPC = {
//             model: npcModel,
//             animCtrl: null,
//             agentId: null, // Initialize agentId to null
//             // setDestination: (destination) => {
//             //     // Your custom setDestination logic here
//             //     // This is where you would call CrowdManager.setAgentTarget
//             // }
//         };
//         console.info("NPC MODEL IS PUT AT: ",npcModel.position ?? "Cannot get npcModel postition");
//         const animCtrl = new ThirdPersonPlayer(null, scene , null , npcModel);
//         const agentId = CrowdManager.addAgent(
//             navStartPoint,
//             {
//                 radius: 0.35,
//                 height: 1.8,
//                 maxSpeed: 1.5, // walking speed
//             },
//             { model: npcModel, animCtrl: animCtrl } // Pass our objects as user data
//         );
//         console.log('Agent ID in index.js:', agentId);
//         if (agentId !== null && agentId > -1 ) {
//             // Store our complete NPC object
//             museumNPC = {
//                 model: npcModel,
//                 animCtrl: animCtrl,
//                 agentId: agentId,

//             };
//             console.info('NPC initialized with Detour Crowd Agent ID:', agentId);
//         } else {
//             console.error('Failed to initialize NPC agent in crowd.');
//             return;
//         }
//     }
// }

// src/game_logic/index.js

// function initNPC(scene, navQuery, bvhMeshes) {
//     const npcModel = SkeletonUtils.clone(characterModel);

//     npcModel.traverse((child) => {
//         if (child.isMesh) {
//             child.castShadow = true;
//             child.receiveShadow = true;
//             if (Array.isArray(child.material)) child.material = child.material.map(tuneMaterial);
//             else child.material = tuneMaterial(child.material);
//         }
//     });

//     const desiredStartPosition = new THREE.Vector3(0.5, 0, 0.5);
    
//     // --- DEBUG & VALIDATION START ---
//     console.log('Attempting to find navmesh point near:', desiredStartPosition);
//     const closestNavPointResult = navQuery.findClosestPoint(desiredStartPosition);
//     const navStartPoint = closestNavPointResult ? closestNavPointResult.point : null;

//     if (navStartPoint) {
//         const distance = desiredStartPosition.distanceTo(new THREE.Vector3(navStartPoint.x, navStartPoint.y, navStartPoint.z));
//         console.log('Found closest navmesh point at:', navStartPoint, `(Distance: ${distance.toFixed(2)})`);

//         // A large distance suggests the desired start point is very far from the navmesh
//         if (distance > 2.0) { // 2 meters is a reasonable threshold
//             console.warn('WARNING: The desired NPC start position is very far from the actual navmesh. Check your model floor position and the spawn point.');
//         }

//         npcModel.position.set(navStartPoint.x, navStartPoint.y, navStartPoint.z);

//     } else {
//         console.error('CRITICAL: navQuery.findClosestPoint failed. Could not find any point on the navmesh. NPC will not have pathfinding.');
//         // Place the model anyway for visual debugging, but don't try to create a crowd agent.
//         npcModel.position.copy(desiredStartPosition);
//         scene.add(npcModel);
//         return; // Exit the function since we can't proceed
//     }
//     // --- DEBUG & VALIDATION END ---
    
//     scene.add(npcModel);

//     // Add an agent to the crowd simulation
//     const animCtrl = new ThirdPersonPlayer(null, scene, null, npcModel);
    
//     const agentParams = {
//         radius: 0.35,
//         height: 1.8,
//         maxSpeed: 1.5,
//         maxAcceleration: 4.0,
//         separationWeight: 2.0
//     };

//     // IMPORTANT: Pass the validated navStartPoint to the CrowdManager
//     const agentId = CrowdManager.addAgent(navStartPoint, agentParams, { model: npcModel, animCtrl: animCtrl });
    
//     if (agentId !== null && agentId > -1) {
//         museumNPC = {
//             model: npcModel,
//             animCtrl: animCtrl,
//             agentId: agentId,
//         };
//         console.info('✅ NPC initialized successfully with Detour Crowd Agent ID:', agentId);
//     } else {
//         console.error('Failed to initialize NPC agent in crowd. The validated start point was likely still invalid for the crowd system.');
//         // The NPC model is in the scene, but it won't be able to move.
//     }
// }

// src/game_logic/index.js

function initNPC(scene, navQuery, bvhMeshes) {
    const npcModel = SkeletonUtils.clone(characterModel);

    npcModel.traverse((child) => {
        if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            if (Array.isArray(child.material)) child.material = child.material.map(tuneMaterial);
            else child.material = tuneMaterial(child.material);
        }
    });

    const desiredStartPosition = new THREE.Vector3(0.5, 0.5, 0.5); // A little height helps
    const searchExtent = new THREE.Vector3(1, 1, 1); // Search 1 unit around the start pos

    // --- NEW, MORE ROBUST SPAWN LOGIC ---
    console.log('Attempting to find navmesh polygon near:', desiredStartPosition);
    const nearestPoly = navQuery.findNearestPoly(desiredStartPosition, searchExtent);
    
    // The center of the found polygon is a guaranteed safe spawn point.
    const navStartPoint = nearestPoly ? nearestPoly.center : null;

    if (!navStartPoint) {
        console.error('CRITICAL: Could not find any navmesh polygon near the start position. NPC cannot be created.');
        // Add model to scene for visual debugging, but exit function.
        npcModel.position.copy(desiredStartPosition);
        scene.add(npcModel);
        return; 
    }
    
    console.log('Found safe spawn point at polygon center:', navStartPoint);
    npcModel.position.set(navStartPoint.x, navStartPoint.y, navStartPoint.z);
    scene.add(npcModel);
    // --- END OF NEW SPAWN LOGIC ---

    const animCtrl = new ThirdPersonPlayer(null, scene, null, npcModel);
    
    const agentParams = {
        radius: 0.35,
        height: 1.8,
        maxSpeed: 1.5,
        maxAcceleration: 4.0,
        separationWeight: 2.0
    };

    const agentId = CrowdManager.addAgent(navStartPoint, agentParams, { model: npcModel, animCtrl: animCtrl });
    
    if (agentId !== null && agentId > -1) {
        museumNPC = {
            model: npcModel,
            animCtrl: animCtrl,
            agentId: agentId,
        };
        console.info('✅ NPC initialized successfully with Detour Crowd Agent ID:', agentId);
    } else {
        console.error('Failed to initialize NPC agent in crowd. This is unusual if a safe point was found.');
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
// Call this to order the NPC to go to the wall (will set destination to first valid nav point)
function goToMesh(mesh, options = {}) {
  const pt = findReachableNavPointNearMesh(mesh, options);
  if (pt) {
    museumNPC.setDestination(pt);
    console.info('museumNPC.setDestination ->', pt);
  } else {
    console.warn('goToMesh: no reachable nav point found near mesh', mesh);
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

        let floorMesh = null, maxArea = 0, fallbackY = Infinity, fallbackX = 0, fallbackZ = 0, floorBoxMaxY = null, count = 0;

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
            if(!child.isMesh) return;
            
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
            }
        });

        // initialize recast (WASM) if needed
        await initRecastIfNeeded();

        // const navMeshes = Array.from(navInputSet);
        const navMeshes = navInputMeshes;

        // DEBUG: show what meshes will be used for navmesh generation
        console.info('Nav input mesh count for navmesh build:', navMeshes.length);
        if (navMeshes.length > 0) {
        console.table('Nav input meshes:', navMeshes.map(m => m.name || m.uuid));
        const cfg = {
        cs: 0.05,   // 0.2 units per voxel in X/Z (fits ~135 cells across floor)
        ch: 0.05,   // 0.1 in Y (now extruded floor survives)
        walkableSlopeAngle: 60,
        walkableHeight: 2.0,
        walkableClimb: 0.0001,
        maxSlope: 2,
        upAxis: 1,
        walkableRadius: 0.35,
        maxEdgeLen: 20,
        maxSimplificationError: 1.3,
        minRegionArea: 8,
        mergeRegionArea: 5,
        maxVertsPerPoly: 6,
        detailSampleDist: 6,
        detailSampleMaxError: 1,
        };



        try {
            const { success, navMesh } = buildNavMeshFromMeshes(navMeshes, cfg , scene);
            if (!success) {
                console.warn('Failed to build navMesh from meshes - NPC path may not avoid props');
            } else {
                CrowdManager.initCrowd(navMesh, 2 , 0.35);
                console.info('NavMesh built successfully.');
            }
        } catch (e) {
            console.error('Error while building navmesh:', e);
        }
        } else {
            console.warn('No navMesh input meshes found - NPC path may not avoid props. Check naming or set userData.navObstacle on props');
        }

        const helper = getNavHelper();
        if (helper) {
            helper.visible = true;   // set to false in production
            console.info('Navmesh helper added. Visible = true');
        }


        raycasterManager.setPictureFrames(pictureFramesArray);
        Mapping_PictureFrame_ImageMesh(FrameToImageMeshMap, pictureFramesArray, imageMeshesArray);
        
        // --- PLAYER SETUP ---
        let playerStart = { x: 0, y: 0, z: 0 };
        if (floorMesh) {
            playerStart = { x: floorMesh.center.x, y: (floorBoxMaxY ?? floorMesh.center.y) + 0.01, z: floorMesh.center.z };
        } else {
            playerStart = { x: fallbackX, y: (fallbackY === Infinity ? 1 : fallbackY) + 0.1, z: fallbackZ };
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

        navQuery = getNavQuery();
        if (!navQuery){
            console.warn("Nav query is not exist yet. museumNPC init may be fail");
        }else{
            console.info("Nav query exist already")
            console.log("Nav query: ", navQuery)
        }
        initNPC(scene, navQuery, bvhMeshList);
        // console.log("ClosestPoint from navQuery to NPC position",navQuery.findClosestPoint(museumNPC.model.position));

        
        // Find a point IN FRONT of Wall001 for the NPC to move to
        // if (Wall001 && navQuery && museumNPC) {
        //     const wallPosition = new THREE.Vector3();
        //     Wall001.getWorldPosition(wallPosition);

        //     const wallQuaternion = new THREE.Quaternion();
        //     Wall001.getWorldQuaternion(wallQuaternion);

        //     // 💡 This vector represents the "front" direction of the wall in its own local space.
        //     // You may need to change this if the wall was modeled facing a different direction.
        //     // Common alternatives are (0, 0, -1), (1, 0, 0), etc.
        //     const forwardVector = new THREE.Vector3(-1, 0, 0); 

        //     // Rotate this local "front" vector by the wall's world rotation to get the world-space direction.
        //     forwardVector.applyQuaternion(wallQuaternion);
        //     forwardVector.y = 0; // We only care about horizontal direction
        //     forwardVector.normalize();

        //     // Define how far in front of the wall the NPC should stand.
        //     const offsetDistance = -12; // 1.5 meters

        //     // Calculate the target position by moving from the wall's position out by the offset.
        //     const targetPoint = wallPosition.clone().add(forwardVector.multiplyScalar(offsetDistance));

        //     console.info("Calculated NPC target point in front of wall:", targetPoint);

        //     // Now, find the closest point on the navmesh to this *new* target point.
        //     const closestNavPoint = navQuery.findClosestPoint(targetPoint);

        //     if (closestNavPoint && closestNavPoint.point) {
        //         museumNPC.setDestination(closestNavPoint.point);
        //         console.log("✅ NPC destination set to a safe point in front of the wall:", closestNavPoint.point);
        //     } else {
        //         console.warn("⚠️ Could not find a walkable point near the target position in front of Wall001.");
        //     }
        // }

        // call immediately after init or in console:
        // goToMesh(Wall001, {
        //     localForwardVector: new THREE.Vector3(1, 0, 0),
        //     desiredDistance: 12 // How far in front to stand
        // });





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


function animate() {
  animationFrameId = requestAnimationFrame(animate);


  const frameDelta = Math.min(0.05, clock.getDelta());
  physicsTimeAccumulator += frameDelta;
  const FIXED_TIMESTEP = 1/60; // Run physics at a steady 60Hz

  if (outlinePass) {
    const hasTargets = (outlinePass.selectedObjects?.length ?? 0) > 0;
    outlinePass.enabled = hasTargets;
  }

  CrowdManager.updateCrowd(frameDelta);

  const agents = CrowdManager.getAgents();
  agents.forEach(({model, animCtrl, agent}, agentId) =>{
    if (!agent){
        return;
    }
    model.position.copy(agent.position);
  })



  if (physiscsReady && activePlayer === 'tp' && tpView) {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      tpView.update(frameDelta);
    }

    if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
      const lookAtPoint = (tpView._smoothedPlayerPosition ?? tpView.playerCollider.end).clone().add(new THREE.Vector3(0, 0.5, 0));
      const playerQuat = (tpView.tempQuaternion ?? tpView.model.quaternion).clone();

      const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camPitch);
      playerQuat.multiply(pitchQuat);

      const idealOffset = new THREE.Vector3(0, 0.0, -2.5).applyQuaternion(playerQuat);
      const idealPos = lookAtPoint.clone().add(idealOffset);
      let finalPos = idealPos.clone();

      // --- CAMERA COLLISION AS SPHERE ---
      const fovRadians = THREE.MathUtils.degToRad(camera.fov);
      const near = camera.near;
      // approximate half-height of near plane
      const halfHeight = Math.tan(fovRadians * 0.5) * near;
      const halfWidth  = halfHeight * camera.aspect;
      // pick the diagonal as "radius" for safety
      const camRadius = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

      // store/adjust your global cameraCollider
      cameraCollider.center.copy(finalPos);
      cameraCollider.radius = camRadius;

      // Raycast with sphere check
      const raycaster = new THREE.Raycaster(lookAtPoint, idealOffset.clone().normalize());
      raycaster.near = 1e-14;
      raycaster.far = idealOffset.length();
      const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);

      if (intersects.length > 0) {
        const hitPoint = intersects[0].point;
        // push camera back by camRadius so its sphere doesn't clip
        finalPos.copy(hitPoint).sub(raycaster.ray.direction.clone().multiplyScalar(camRadius + 0.05));
        cameraCollider.center.copy(finalPos);
      }

      // smooth follow
      const lerp = 0.05;
      if (!tpView._cameraSnapped) {
        camera.position.copy(finalPos);
        tpView._cameraSnapped = true;
      } else {
        camera.position.lerp(finalPos, lerp);
      }

      // smooth look
      const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(camera.position, lookAtPoint, camera.up)
      );
      camera.quaternion.slerp(targetQuaternion, 0.05);
    }
  }

  if (physiscsReady && activePlayer === 'fp' && fpView) {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      fpView.update(frameDelta , camYaw, camPitch);
    }
  }


//   if (tpView?.mixer) tpView.mixer.update(FIXED_TIMESTEP);
  if (mixer) mixer.update(frameDelta);
  if (tpView?.mixer) tpView.mixer.update(frameDelta * 0.9);

  checkPlayerPosition();

    composer.render();
//   if (cssRenderer) cssRenderer.render(scene, camera);
//   if (css3dRenderer) css3dRenderer.render(scene, camera);
}


// ──────────── switching function ────────────
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
            const navQuery = getNavQuery();
            if (!navQuery) { // Check for the new npc object
                console.warn('NavMesh is not ready. Cannot find path.');
                return;
            }
            if (!museumNPC){
                console.warn('NPC is not ready. Cannot find path.');
                return;
            }

            const targetPoint = intersection.point;
            console.log("Click to point: ", targetPoint);
            // Use the CrowdManager to set the agent's destination
            CrowdManager.setAgentTarget(museumNPC.agentId, targetPoint, navQuery);
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