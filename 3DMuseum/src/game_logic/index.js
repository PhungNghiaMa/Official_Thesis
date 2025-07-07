// src/game_logic/index.js

import "../../game.css";

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import FirstPersonPlayer from './control';
import AnnotationDiv from "./annotationDiv";
import { displayUploadModal, initUploadModal , Mapping_PictureFrame_ImageMesh , DisplayImageOnDiv} from "./utils";
import { GetRoomAsset } from "./services";
import { Museum } from "./constants";
import { Capsule} from "three/examples/jsm/Addons.js";
import RaycasterManager from "./raycaster.js"
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';

// --- Global variables for the game, now scoped within this module ---
const clock = new THREE.Clock();
const scene = new THREE.Scene();

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
let currentlyHoveredObject = null;
const doorState = {
    Door001: false,
    Door002: false
}
let interactedDoor;
const FrameToImageMeshMap = {};

const ModelPaths = {
    [Museum.ART_GALLERY]: "art_gallery/VIRTUAL_ART_GALLERY_3.gltf",
    [Museum.LOUVRE]: "art_hallway/VIRTUAL_ART_GALLERY_1.gltf",
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

const loader = new GLTFLoader().setPath('/assets/');

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
    FrameToImageMeshMap = {};
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

    if (fpView) {
        hasLoadPlayer = false;
        fpView.dispose();
        fpView = null;
    }
    annotationMesh = {};
    clearSceneObjects(scene);

    const ambientLight = new THREE.AmbientLight("#FFFFFF", 4);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight("#FFFFFF", 2);
    scene.add(directionalLight);
    
    loader.load(
        ModelPaths[currentMuseumId],
        (gltf) => {
            scene.add(gltf.scene);
            gltf.scene.updateMatrixWorld(true);
            currentScene = gltf.scene
            animation = gltf.animations;
            mixer = new THREE.AnimationMixer(gltf.scene);

            let floorMesh = null, maxArea = 0, fallbackY = Infinity, fallbackX = 0, fallbackZ = 0, floorBoxMaxY = null, count = 0;

            gltf.scene.traverse((child) => {
                child.updateMatrixWorld(true);

                if (child.isMesh) {
                    console.log(child.name)
                    const pos = new THREE.Vector3();
                    child.getWorldPosition(pos);
                    const size = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());

                    if (pos.y < fallbackY) {
                        fallbackY = pos.y;
                        fallbackX = pos.x;
                        fallbackZ = pos.z;
                    }

                    if (/^Picture_Frame\d+$/.test(child.name)){
                        pictureFramesArray.push(child)
                    }

                    if (child.name.toLowerCase().includes("floor")) {
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
                        child.material = new THREE.MeshStandardMaterial({ color: 0xF4EBC7, metalness: 1, roughness: 5 });
                    }
                }

                if (child.isMesh && /^ImageMesh\d+$/.test(child.name)) {
                    imageMeshesArray.push(child)
                    const imagePlane = child;
                    const material = new THREE.MeshBasicMaterial({
                        color: 0xffffff,
                        side: THREE.DoubleSide,
                        map: null,
                    });
                    imagePlane.material = material;
                    imagePlane.material.needsUpdate = true;

                    if (imagePlane.geometry?.attributes.uv) {
                        imagePlane.geometry.attributes.uv.needsUpdate = true;
                    }

                    const box = new THREE.Box3().setFromObject(imagePlane);
                    const center = box.getCenter(new THREE.Vector3());

                    const annotationDiv = new AnnotationDiv(count, imagePlane);
                    count++;
                    const label = new CSS2DObject(annotationDiv.getElement());
                    label.position.copy(center);
                    scene.add(label);

                    annotationMesh[imagePlane.name] = { label, annotationDiv, mesh: imagePlane };

                    annotationDiv.onAnnotationClick = () => {
                        const aspectRatio = 1/1
                        displayUploadModal(aspectRatio, { roomID: currentMuseumId, asset_mesh_name: imagePlane.name });
                    };
                }
            });

            raycasterManager.setPictureFrames(pictureFramesArray)

            Mapping_PictureFrame_ImageMesh(FrameToImageMeshMap , pictureFramesArray , imageMeshesArray)

            let playerStart = { x: 0, y: 0, z: 0 };
            if (floorMesh) {
                playerStart.x = floorMesh.center.x;
                playerStart.y = (floorBoxMaxY ?? floorMesh.center.y) + 0.01;
                playerStart.z = floorMesh.center.z;
            } else {
                playerStart.x = fallbackX;
                playerStart.y = (fallbackY === Infinity ? 1 : fallbackY) + 0.1;
                playerStart.z = fallbackZ;
                console.warn("No floor mesh found, using lowest mesh position as fallback.");
            }

            const playerCollider = new Capsule(
                new THREE.Vector3(playerStart.x, playerStart.y, playerStart.z),
                new THREE.Vector3(playerStart.x, playerStart.y + 1.8 - 0.35, playerStart.z),
                0.35
            );


            fpView = new FirstPersonPlayer(camera, scene, container, playerCollider);
            fpView.loadOctaTree(gltf.scene);
            physiscsReady = true;
            hasLoadPlayer = true;
            
            document.getElementById('loading-container').style.display = 'none';

            GetRoomAsset(currentMuseumId).then(items => {
                (Array.isArray(items) ? items : []).forEach(item => {
                    if (!item) {
                        console.log("Cannot get item from API");
                        return;
                    }
                    const { asset_mesh_name, asset_cid, title, viet_des, en_des } = item;
                    if (annotationMesh[asset_mesh_name]) {
                        annotationMesh[asset_mesh_name].annotationDiv.setAnnotationDetails(title, viet_des, en_des);
                        setImageToMesh(currentScene, asset_mesh_name, `https://gateway.pinata.cloud/ipfs/${asset_cid}`);
                    }
                });
            }).catch(error => {
                console.error("Error fetching museum list:", error);
            });

            hasEnteredNewScene = false;
        },
        (xhr) => {
            const progress = xhr.total > 0 ? (xhr.loaded / xhr.total) * 100 : xhr.loaded / 60000;
            document.getElementById('progress').style.width = progress + '%';
        },
        (error) => {
            console.error('An error occurred while loading the model:', error);
            document.getElementById('loading-container').style.display = 'none';
        }
    );
}

// ... (rest of the functions: setMuseumModel, initMenu, openMenu, closeMenu are unchanged)
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
        listItem1.textContent = "Art Gallery";
        listItem1.className = "menu-item";
        listItem1.addEventListener("click", () => {
            setMuseumModel(Museum.ART_GALLERY);
            closeMenu();
        });

        const listItem2 = document.createElement("div");
        listItem2.textContent = "Louvre Art Museum";
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

    container.tabIndex = 0;
    setTimeout(() => container.focus(), 50);

    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene , camera);
    composer.addPass(renderPass);

    outlinePass = new OutlinePass(new THREE.Vector2(container.clientWidth, container.clientHeight), scene , camera);
    outlinePass.edgeStrength = 8;
    outlinePass.edgeGlow = 1;
    outlinePass.edgeThickness = 3.5;
    outlinePass.pulsePeriod = 2;
    outlinePass.visibleEdgeColor.set("#ffffff");
    outlinePass.hiddenEdgeColor.set("#ffffff");
    composer.addPass(outlinePass);

    // // Optional: FXAA
    // const fxaaPass = new ShaderPass(FXAAShader);
    // fxaaPass.material.uniforms['resolution'].value.set(1 / container.clientWidth*1.5, 1 / container.clientHeight*1.5);
    // composer.addPass(fxaaPass);

  

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