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


THREE.Cache.enabled = true; // Enable caching for better performance

// --- Global variables for the game, now scoped within this module ---
const clock = new THREE.Clock();
const scene = new THREE.Scene();

let menuOpen = false;
let currentMuseumId = Museum.ART_GALLERY;

const STEPS_PER_FRAME = 5; // Number of physics steps per frame
let fpView, tpView; // Instance of FirstPersonPlayer and ThirdPersonPlayer
let playerCollider;
let activePlayer = 'tp';
let annotationMesh = {};

let isDoorOpen = false;
let animation = null;
let mixer = null;
let hasLoadPlayer = false;
let physiscsReady = false;
let currentScene = null;

let characterModelReady = false;

// Third person character model instance
let characterModel = null;
// Light instance
let ambientLight , hemiLight , spot1 , spot2 , spotLight;

// instance for post-processing
let composer , outlinePass , renderPass;
let currentlyHoveredObject = null;

// THREE loading managers
const LoadingManager = new THREE.LoadingManager();

LoadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
    console.log(`Started loading: ${url}. Loaded ${itemsLoaded} of ${itemsTotal} files.`);
    document.getElementById('loading-container').style.display = 'flex';
    document.getElementById('progress').style.width = '0%';
};

LoadingManager.onLoad = () => {
    console.log('All resources loaded.');
    document.getElementById('loading-container').style.display = 'none';
};

LoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const progress = (itemsLoaded / itemsTotal) * 100
    console.log(`Loading file: ${url}. Loaded ${itemsLoaded} of ${itemsTotal} files. (${progress.toFixed(2)}%)`);
    document.getElementById('progress').style.width = progress + '%';
}

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
    [Museum.ART_GALLERY]: "optimizedModel/optimizeModel_8.glb",
    [Museum.LOUVRE]: "art_hallway/VIRTUAL_ART_GALLERY_3.gltf",
}
let raycasterManager = null
let pictureFramesArray = []
let imageMeshesArray = []
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
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

renderer = new THREE.WebGLRenderer({ antialias: true});

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
    if (!material) return; 

    if (!(material instanceof THREE.MeshStandardMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) {
        let upgradedMaterial = new THREE.MeshStandardMaterial({
            map: material.map || null,
            color: (material.color && material.color.clone()) || new THREE.Color(0xffffff),
            roughness: 1.0, // Adjust roughness for better appearance
            metalness: 0.0, // Set metalness to 0
            // keep transparency settings if needed
            transparent: !!material.transparent,
            opacity: material.opacity !== undefined ? material.opacity : 1.0,
        })
        material = upgradedMaterial;
    }

    // Clamp physically-based ranges ( avoid mistakes like roughness > 1 or metalness < 0 )
    if (material.roughness !== undefined) {
        material.roughness = 1.0;
    }
    if (material.metalness !== undefined) {
        material.metalness = 0.0;
    }

    // Make reflection from scene.environment visible ( tweak for better reflections )
    // has no effect on MeshBasicMaterial or MeshLambertMaterial
    if ('envMapIntensity' in material) {
        material.envMapIntensity = 0.5; // Adjust to taste, 0.5 is a good starting point
    }

    material.side = THREE.DoubleSide; // Ensure all materials are front-facing

    if (material.map) {
        material.map.colorSpace = THREE.SRGBColorSpace;
        material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        material.map.minFilter = THREE.LinearMipMapLinearFilter;
        material.map.magFilter = THREE.LinearMipMapLinearFilter;
        material.map.needsUpdate = true;
    }

    const mapNames = ['map', 'emissiveMap', 'aoMap', 'metalnessMap', 'roughnessMap', 'normalMap', 'bumpMap'];
    for (const name of mapNames){
        const texture = material[name];
        if (!texture) continue;

        // Color space: ONLY color/emissive are sRGB; the rest are linear
        if (name === 'emissiveMap') {
            texture.colorSpace = THREE.SRGBColorSpace;
        }
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.minFilter = THREE.NearestMipMapNearestFilter; // Use mipmaps for better quality
        texture.magFilter = THREE.NearestMipMapLinearFilter;
        texture.needsUpdate = true; // Ensure the texture is updated
    }

    if(material.normalMap && !material.normalScale){
        material.normalScale = new THREE.Vector2(1, 1); // Ensure normal maps are applied correctly
    }

    material.needsUpdate = true; // Ensure the material is updated
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


// src/game_logic/index.js
async function loadModel() {
    document.getElementById('loading-container').style.display = 'flex';
    document.getElementById('progress').style.width = '0%';

    if (fpView) {
        hasLoadPlayer = false;
        fpView.dispose();
        fpView = null;
    }
    annotationMesh = {};
    clearSceneObjects(scene);

    // softer, not washing out shadows
    ambientLight = new THREE.AmbientLight(0xf0f0f0, 0.6);
    scene.add(ambientLight);

    // hemisphere for ambient sky/ground tint
    hemiLight = new THREE.HemisphereLight(0xf0f0f0, 0xf4e7a4, 0.6);
    hemiLight.color.setHSL(0.138, 0.78, 0.92);    
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);


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
        const loadModelPromise = loader.loadAsync(ModelPaths[currentMuseumId]);

        // 2. Create a promise for the API call.
        const getAssetsPromise = GetRoomAsset(currentMuseumId);

        // 3. Load third view character
        // const loadModelCharacterPromise = characterLoader.loadAsync('optimizedModel/ANIMATED.glb');
        // // Try to load the characterModel in background, but don't block scene loading on it.
        // loadModelCharacterPromise.then((gltf) => {
        //     characterModel = gltf.scene;
        //     characterModelReady = true;
        // }).catch((error) => {
        //     console.error('Error loading character model:', error);
        // });

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

        gltf.scene.traverse((child) => {
            if(!child.isMesh) return;

            child.receiveShadow = true;
            child.updateMatrixWorld(true);

            if (Array.isArray(child.material)) {
                child.material = child.material.map(tuneMaterial);
            } else {
                child.material = tuneMaterial(child.material); 
            }

            ensureUV2ForAO(child.geometry);

            if (child.isMesh) {
                const pos = new THREE.Vector3();
                child.getWorldPosition(pos);
                child.castShadow = true;
                child.receiveShadow = true;



                if (pos.y < fallbackY) {
                    fallbackY = pos.y;
                    fallbackX = pos.x;
                    fallbackZ = pos.z;
                }

                if (/^Picture_Frame\d+$/.test(child.name)) {
                    pictureFramesArray.push(child);
                }

                if (child.name.toLowerCase().includes("floor")) {
                    child.material.side = THREE.DoubleSide; // Ensure floor is double-sided
                    child.material.roughness = 0.8; // Adjust roughness for better appearance
                    child.material.metalness = 0.0; // Set metalness to 0
                    
                    console.log("FLOOR POSITION IS: ",child.position.x, child.position.y, child.position.z)
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
        playerCollider = new Capsule(
            new THREE.Vector3(playerStart.x, playerStart.y, playerStart.z),
            new THREE.Vector3(playerStart.x, playerStart.y + 1.8 - 0.35, playerStart.z),
            0.35
        );

        // INIT FIRST VIEW PLAYER
        // activateFirstPerson();
        // fpView = new FirstPersonPlayer(camera, scene, container, playerCollider);
        // fpView.buildBVH(gltf.scene);

        // INIT THIRD VIEW PLAYER

        tpView = new ThirdPersonPlayer(camera, scene, container, playerCollider);
        tpView._cameraSnapped = false;
        tpView.buildBVH(gltf.scene);
        activateThirdPerson();
        


        physiscsReady = true;
        hasLoadPlayer = true;
        
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

// put these once near your input setup in index.js
let camYaw = 0;
let camPitch = 0;

// pointer lock mouse look (example — adapt to your app)
window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) {
    camYaw   -= e.movementX * 0.002;  // sensitivity X
    camPitch -= e.movementY * 0.002;  // sensitivity Y
    camPitch = Math.max(-1.2, Math.min(0.8, camPitch)); // clamp pitch
  }
});

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  const frameDelta = Math.min(0.05, clock.getDelta());
  const stepDelta  = frameDelta / STEPS_PER_FRAME;

  // --- Third Person Player update ---
  if (physiscsReady && activePlayer === 'tp' && tpView) {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      // ✅ pass camYaw into the player (don’t read globals inside the class)
      tpView.update(stepDelta, camYaw);
    }

    // --- CAMERA FOLLOW (AAA: independent yaw/pitch) ---
    // Inside the animate() function
// --- CAMERA FOLLOW ---
    // --- CAMERA FOLLOW ---
    // --- CAMERA FOLLOW ---
    if (tpView.playerCollider && tpView.model && tpView.bvhMeshes?.length > 0) {
        const lookAtPoint = tpView.playerCollider.end.clone().add(new THREE.Vector3(0, 0.5, 0));

        // build camera quaternion from yaw/pitch (independent of character)
        // ✅ follow player orientation instead of global camYaw
        const playerQuat = tpView.model.quaternion.clone();

        // add pitch if you want mouse pitch control
        const pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), camPitch);
        playerQuat.multiply(pitchQuat);

        // ideal camera offset (behind player)
        const idealOffset = new THREE.Vector3(0, 0.0, -2.5).applyQuaternion(playerQuat);

        const idealPos = lookAtPoint.clone().add(idealOffset);

        let finalPos = idealPos.clone();
        
        // Create a ray from the 'lookAtPoint' towards the 'idealPos'
        const raycaster = new THREE.Raycaster(lookAtPoint, idealOffset.clone().normalize());
        raycaster.far = idealOffset.length();
        
        // Check for intersections with the environment meshes
        const intersects = raycaster.intersectObjects(tpView.bvhMeshes, true);
        
        if (intersects.length > 0) {
            // If an intersection is found, place the camera just before the hit point
            // You can add a small offset to prevent clipping
            finalPos.copy(intersects[0].point);
            finalPos.add(raycaster.ray.direction.clone().multiplyScalar(-0.3)); // Pull back slightly
        }

        // smooth follow
        // smooth follow
        const lerp = 0.05;
        if (!tpView._cameraSnapped) {
            camera.position.copy(finalPos);
            tpView._cameraSnapped = true;
        } else {
            camera.position.lerp(finalPos, lerp);
        }

        // ✅ FIX: Smoothly interpolate the camera's rotation
        const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().lookAt(camera.position, lookAtPoint, camera.up)
        );
        camera.quaternion.slerp(targetQuaternion, lerp);
    }
  }

  // --- First Person Player update ---
  if (physiscsReady && activePlayer === 'fp' && fpView) {
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      fpView.update(stepDelta);
    }
  }

  // --- Update animation mixers once per frame ---
  if (tpView?.mixer) tpView.mixer.update(frameDelta);
  if (mixer) mixer.update(frameDelta);

  checkPlayerPosition();

  if (composer) composer.render();
  if (cssRenderer) cssRenderer.render(scene, camera);
  if (css3dRenderer) css3dRenderer.render(scene, camera);
}








// ──────────── switching function ────────────
function activateThirdPerson() {
  if (!tpView.model) {
    tpView.loadModel('./assets/optimizedModel/ANIMATED_1.glb', dracoLoader, ktx2Loader, renderer);
  }
  activePlayer = 'tp';
}

function activateFirstPerson() {
  activePlayer = 'fp';
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

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap; // Use soft shadows
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
    outlinePass.clear = false;              // don’t clear the whole buffer
    outlinePass.clearAlpha = 0;             // transparent, not black
    composer.addPass(outlinePass);

    composer.addPass(new OutputPass());

  
    window.addEventListener('resize', onWindowResize);

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

        onHoverPictureFrame: (object, isHovering) => {}
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