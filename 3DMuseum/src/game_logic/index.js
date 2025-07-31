import "../../game.css";

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import FirstPersonPlayer from './control';
import AnnotationDiv from "./annotationDiv";
import { displayUploadModal, initUploadModal , Mapping_PictureFrame_ImageMesh , DisplayImageOnDiv} from "./utils";
import { Museum } from "./constants";
import { Capsule } from "three/addons/math/Capsule.js";
import RaycasterManager from "./raycaster.js"
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/addons/postprocessing/OutlinePass.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// --- Global variables for the game, now scoped within this module ---
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const manager = new THREE.LoadingManager(); // Loading manager to handle loading progress

manager.onStart = function (url, itemsLoaded, itemsTotal) {
    console.log(`Started loading file: ${url}`);
    console.log(`Loaded ${itemsLoaded} of ${itemsTotal} files.`);
}

manager.onProgress = function (url, itemsLoaded, itemsTotal) {
    const progress = itemsTotal > 0 ? (itemsLoaded / itemsTotal) * 100 : (itemsLoaded / 60000) * 100;
    document.getElementById('progress').style.width = progress + '%';
}

manager.onLoad = function () {
    console.log('All assets loaded successfully.');
    document.getElementById('loading-container').style.display = 'none';
}
let menuOpen = false;
let currentMuseumId = Museum.ART_GALLERY;

const STEPS_PER_FRAME = 5;
let fpView;
let annotationMesh = {};

let isDoorOpen = false;
let animation = null;
let mixer = null;
let hasLoadPlayer = false;
let physiscsReady = false;
let currentScene = null

let composer , outlinePass , renderPass;
const doorState = {
    Door001: false,
    Door002: false
}
let interactedDoor;
const FrameToImageMeshMap = {};

const ModelPaths = {
    [Museum.ART_GALLERY]: "optimizedModel/optimizeModel_2.glb",
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
    camera.position.set(0,0,0);

    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setClearColor(new THREE.Color("#f0f0f0"), 1); // Color and full opacity
    cssRenderer.setSize(container.clientWidth, container.clientHeight);
    css3dRenderer.setSize(container.clientWidth, container.clientHeight);
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

// Force-replace ImageMesh texture with KTX2Loader
function setKTX2TextureToMesh(scene, meshName, ktx2Url) {
    // Use the same manager and renderer as the main loader
    const ktx2Loader = new KTX2Loader(manager);
    ktx2Loader.setTranscoderPath('/basis/');
    ktx2Loader.detectSupport(renderer);

    ktx2Loader.load(ktx2Url, (texture) => {
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const mesh = scene.getObjectByName(meshName);
        if (mesh && mesh.isMesh) {
            mesh.material.map = texture;
            mesh.material.needsUpdate = true;
        } else {
            console.warn(`Cannot find mesh for ${meshName}`);
        }
    });
}

function setImageToMesh(scene,meshName, imgUrl) {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(imgUrl,
        (loadedTexture) => {
            loadedTexture.flipY = false;
            loadedTexture.colorSpace = THREE.SRGBColorSpace;
            loadedTexture.minFilter = THREE.LinearFilter;
            loadedTexture.magFilter = THREE.LinearFilter;
            loadedTexture.generateMipmaps = true;
            loadedTexture.wrapS = THREE.ClampToEdgeWrapping;
            loadedTexture.wrapT = THREE.ClampToEdgeWrapping;
            loadedTexture.needsUpdate = true;
            loadedTexture.encoding = THREE.sRGBEncoding;
            loadedTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

            const material = new THREE.MeshBasicMaterial({
                map: loadedTexture,
                side: THREE.DoubleSide,
            });

            let mesh = scene.getObjectByName(meshName)
            if (mesh && mesh.isMesh){
                mesh.material.map = loadedTexture;
                if (mesh.geometry?.attributes.uv) {
                    mesh.geometry.attributes.uv.needsUpdate = true;
                }
                mesh.material.needsUpdate = true;
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

// Init the loader 
const loader = new GLTFLoader(manager).setPath('/assets/');
loader.setCrossOrigin('anonymous');
loader.setMeshoptDecoder(MeshoptDecoder);



function clearSceneObjects(obj) {
    // ... (rest of the function is unchanged)
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
    annotationMesh = {};
    hasEnteredNewScene = false;
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

function loadModel() {
    document.getElementById('loading-container').style.display = 'flex';
    document.getElementById('progress').style.width = '0%';

    // Use preloaded metadata and room assets if available
    if(window.preloadMetadata && window.preloadRoomAssets) {
        console.log("Using preloaded metadata and room assets from worker");
        finalizeModelLoading(ModelPaths[currentMuseumId], window.preloadMetadata, window.preloadRoomAssets);
        window.preloadMetadata = null; // Clear after use
        window.preloadRoomAssets = null;
        return;
    }

    if(window.preloadMetadata && window.preloadRoomAssets){
        console.log("Using preloaded metadata and room assets from worker");
        finalizeModelLoading(ModelPaths[currentMuseumId], window.preloadMetadata, window.preloadRoomAssets);
        window.preloadMetadata = null; // Clear after use
        return;
    }

}

function finalizeModelLoading(modelPath, metadata , roomAssets) {
    loader.load(
        modelPath,
        (gltf) => {
             clearSceneObjects(scene);
            // Same logic as before, but reuse `metadata` to speed up logic
            scene.add(gltf.scene);
            gltf.scene.updateMatrixWorld(true);
            currentScene = gltf.scene;
            currentScene.updateMatrixWorld(true);
            animation = gltf.animations;
            mixer = new THREE.AnimationMixer(currentScene);
            annotationMesh = {};

            const ambientLight = new THREE.AmbientLight("#FFFFFF", 4);
            const directionalLight = new THREE.DirectionalLight("#FFFFFF", 2);
            scene.add(ambientLight, directionalLight);

            // SET UP CHARACTER POSITION AND CAMERA
            let playerStart;
            const [fallbackX, fallbackY, fallbackZ] = metadata.fallbackPos;
            // Use floorBoxMaxY if available, otherwise fallback
            let startY = metadata.floorBoxMaxY !== null && metadata.floorBoxMaxY !== undefined
                ? metadata.floorBoxMaxY + 0.01
                : (metadata.playerStartPos?.[1] ?? fallbackY + 0.1);
            let startX = metadata.playerStartPos?.[0] ?? fallbackX;
            let startZ = metadata.playerStartPos?.[2] ?? fallbackZ;
            playerStart = { x: startX, y: startY, z: startZ };

            const playerCollider = new Capsule(
                new THREE.Vector3(playerStart.x, playerStart.y, playerStart.z),
                new THREE.Vector3(playerStart.x, playerStart.y + 1.8 - 0.35, playerStart.z),
                0.35
            );

            fpView = new FirstPersonPlayer(camera, scene, container, playerCollider);
            const octreeLoaded = fpView.loadOctaTree(gltf.scene);
            if (!octreeLoaded) {
                console.error('Failed to load octree - check floor meshes');
                return;
            }
            // Traverse and setup image meshes, annotationDivs, etc. (as in original logic)
            let count = 0;
            currentScene.traverse((child) => {
                if (child.isMesh) {
                    child.updateMatrixWorld(true);  // Ensure each mesh's world matrix is up to date
                    if (/^ImageMesh\d+$/.test(child.name)) {
                        const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
                        child.material = material;
                        child.material.needsUpdate = true;

                    // Check for valid UVs or force assign custom UVs (e.g. simple square)
                    
                    const uvAttribute = new Float32Array([
                        0, 0,  // top-left
                        0, 1,  // top-right
                        1, 1,  // bottom-right
                        1, 0   // bottom-left
                    ]);

                        // Assume quad with 4 vertices (you may need to expand if yours use more)
                        child.geometry.setAttribute('uv', new THREE.BufferAttribute(uvAttribute, 2));
                        console.warn(`UVs reassigned manually for ${child.name}`);


                        const box = new THREE.Box3().setFromObject(child);
                        const center = new THREE.Vector3();
                        box.getCenter(center);

                        const annotationDiv = new AnnotationDiv(count++, child);
                        const label = new CSS2DObject(annotationDiv.getElement());
                        label.position.copy(center);
                        scene.add(label);
                        annotationMesh[child.name] = { label, annotationDiv, mesh: child };

                        annotationDiv.onAnnotationClick = () => {
                            const aspectRatio = 1 / 1;
                            displayUploadModal(aspectRatio, { roomID: currentMuseumId, asset_mesh_name: child.name });
                        };
                    }
                }
            });


            if (metadata.doorBoundingBoxData) {
                doorBoundingBox = new THREE.Box3(
                    new THREE.Vector3(...metadata.doorBoundingBoxData.min),
                    new THREE.Vector3(...metadata.doorBoundingBoxData.max)
                );
            }
            
            // Use PictureFrameMesh names from metadata to get actual PictureFrameMesh objects
            if (Array.isArray(metadata.pictureFramesData)) {
                metadata.pictureFramesData.forEach(FrameMeshName => {
                    const FrameMeshObj = currentScene.getObjectByName(FrameMeshName);
                    if (FrameMeshObj && FrameMeshObj.isMesh) {
                        pictureFramesArray.push(FrameMeshObj);
                    }
                });
            }
            // Use ImageMesh names from metadata to get actual ImageMesh objects
            if (Array.isArray(metadata.imageMeshesData)) {
                metadata.imageMeshesData.forEach(ImageMeshName => {
                    const ImageMeshObj = currentScene.getObjectByName(ImageMeshName);
                    if (ImageMeshObj && ImageMeshObj.isMesh) {
                        imageMeshesArray.push(ImageMeshObj);
                    }
                });
            }

            raycasterManager.setPictureFrames(pictureFramesArray);
            Mapping_PictureFrame_ImageMesh(FrameToImageMeshMap, pictureFramesArray, imageMeshesArray);

            physiscsReady = true;
            hasLoadPlayer = true;
            console.log('Physics initialized with position:', playerCollider.start, playerCollider.end);

            document.getElementById('loading-container').style.display = 'none';

            // Use roomAssets from worker for annotation and image assignment
            if (Array.isArray(roomAssets)) {
                roomAssets.forEach(item => {
                    const { asset_mesh_name, asset_cid, title, viet_des, en_des } = item;
                    if (annotationMesh[asset_mesh_name]) {
                        annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, viet_des, en_des);
                        setImageToMesh(currentScene, asset_mesh_name, `https://gateway.pinata.cloud/ipfs/${asset_cid}`);
                    }
                });
            }
        },
        undefined,
        (err) => {
            console.error("Error loading GLTF:", err);
            document.getElementById('loading-container').style.display = 'none';
        }
    );
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

function animate() {
    animationFrameId = requestAnimationFrame(animate);
    const deltaTime = Math.min(0.05, clock.getDelta()) / STEPS_PER_FRAME;

    if (physiscsReady && fpView) {
        for (let i = 0; i < STEPS_PER_FRAME; i++) {
            fpView.update(deltaTime);
        }
    }

    mixer?.update(deltaTime * 4);
    checkPlayerPosition();

    // RENDER THE SCENCE USING THE COMPOSER
    // composer.render();

    // if (renderer) renderer.render(scene, camera);
    if (composer) composer.render();
    if (cssRenderer) cssRenderer.render(scene, camera);
    if (css3dRenderer) css3dRenderer.render(scene, camera);
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

    renderer = new THREE.WebGLRenderer({ antialias: true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    // Initialize KTX2Loader and set it for GLTFLoader (after renderer is created)
    const ktx2Loader = new KTX2Loader(manager);
    ktx2Loader.setTranscoderPath('/basis/');
    ktx2Loader.detectSupport(renderer);
    loader.setKTX2Loader(ktx2Loader);

    container.tabIndex = 0;
    setTimeout(() => container.focus(), 50);

    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene , camera);
    composer.addPass(renderPass);

    outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene , camera);
    outlinePass.edgeStrength = 5;
    outlinePass.edgeGlow = 2;
    outlinePass.edgeThickness = 3;
    // outlinePass.pulsePeriod = 2;
    outlinePass.visibleEdgeColor.set("#ffffff");
    outlinePass.hiddenEdgeColor.set("#ffffff");
    composer.addPass(outlinePass);

  
    window.addEventListener('resize', onWindowResize);
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
            // console.log(`User clicked frame: ${frameName} → mapped to: ${imageMeshName}`);
            // console.log("Viet description: ", annotationMesh[imageMeshName].annotationDiv.getVietDes())
            // console.log("Eng description: ", annotationMesh[imageMeshName].annotationDiv.getEngDes())
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
