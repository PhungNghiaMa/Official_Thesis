// src/game_logic/index.js

import "../../game.css";

import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import FirstPersonPlayer from './control';
import AnnotationDiv from "./annotationDiv";
import { displayUploadModal, getMeshSizeInPixels, initUploadModal} from "./utils";
import { getMuseumList } from "./services";
import { Museum } from "./constants";
import { Capsule} from "three/examples/jsm/Addons.js";

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

const ModelPaths = {
    [Museum.ART_GALLERY]: "art_gallery/AnimateDoorModel.gltf",
    [Museum.LOUVRE]: "art_hallway/VIRTUAL_ART_GALLERY_1.gltf",
}



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

function setImageToMesh(mesh, imgUrl) {
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

            mesh.material = material;
            mesh.material.needsUpdate = true;

            if (mesh.geometry?.attributes.uv) {
                mesh.geometry.attributes.uv.needsUpdate = true;
            }
        },
        undefined,
        (error) => {
            console.error('Error loading texture:', error);
        }
    );
}

document.body.addEventListener("uploadevent", (event) => {
    const { img_id, title, description, img_url , name } = event.detail;

    if (annotationMesh[img_id]) {
        annotationMesh[img_id].annotationDiv.setAnnotationDetails(title, description, name);
        setImageToMesh(annotationMesh[img_id].mesh, img_url);
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
    isDoorOpen = false;
    physiscsReady = false;
}

function checkPlayerPosition() {
    if (doorBoundingBox && !hasEnteredNewScene && hasLoadPlayer) {
        const playerPosition = fpView.getPlayerPosition();
        if (doorBoundingBox.distanceToPoint(playerPosition) < 4 && isDoorOpen) {
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
    const directionalLight = new THREE.DirectionalLight("#EEB05A", 2);
    scene.add(directionalLight);
    
    loader.load(
        ModelPaths[currentMuseumId],
        (gltf) => {
            scene.add(gltf.scene);
            gltf.scene.updateMatrixWorld(true);

            animation = gltf.animations;
            mixer = new THREE.AnimationMixer(gltf.scene);

            let floorMesh = null, maxArea = 0, fallbackY = Infinity, fallbackX = 0, fallbackZ = 0, floorBoxMaxY = null, count = 0;

            gltf.scene.traverse((child) => {
                child.updateMatrixWorld(true);

                if (child.isMesh && (child.name.includes('LightProbe') || child.name.includes('ReflectionProbe') || child.name.includes('IrradianceProbe'))) {
                    console.warn(`Hiding likely helper object: ${child.name}`);
                    child.visible = false;
                    return; // Skip further processing for this object
                }
                // --- END OF NEW FIX ---


                if (child.isLight) {
                    child.visible = false;
                }

                if (child.isMesh) {
                    const pos = new THREE.Vector3();
                    child.getWorldPosition(pos);
                    const size = new THREE.Box3().setFromObject(child).getSize(new THREE.Vector3());

                    if (pos.y < fallbackY) {
                        fallbackY = pos.y;
                        fallbackX = pos.x;
                        fallbackZ = pos.z;
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

                    if (child.parent?.name === "Door001") {
                        doorBoundingBox = new THREE.Box3().setFromObject(child);
                    }
                    
                    if (child.name === "Handle002") {
                        child.material = new THREE.MeshPhongMaterial({ color: 0xF4EBC7, metalness: 1, roughness: 0.2 });
                    }
                }

                if (child.isMesh && /^ImageMesh\d+$/.test(child.name)) {
                    // ... (rest of the image mesh logic is unchanged)
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
                        const { width, height } = getMeshSizeInPixels(imagePlane, camera, renderer);
                        const aspectRatio = width / height
                        displayUploadModal(aspectRatio, { img_id: imagePlane.name, museum: currentMuseumId });
                    };
                }
            });

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
                new THREE.Vector3(playerStart.x, playerStart.y + 1.5 - 0.35, playerStart.z),
                0.35
            );


            fpView = new FirstPersonPlayer(camera, scene, container, playerCollider);
            fpView.loadOctaTree(gltf.scene);
            physiscsReady = true;
            hasLoadPlayer = true;
            
            document.getElementById('loading-container').style.display = 'none';

            getMuseumList(currentMuseumId).then( data => {
                data?.data?.forEach(item => {
                    const { img_id, title, description, img_cid, name } = item;
                    if (annotationMesh[img_id]) {
                        annotationMesh[img_id].annotationDiv.setAnnotationDetails(title, description, name);
                        setImageToMesh(annotationMesh[img_id].mesh, `https://gateway.pinata.cloud/ipfs/${img_cid}`);
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

    if (renderer) renderer.render(scene, camera);
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


    window.addEventListener('resize', onWindowResize);
    container.addEventListener("keydown", (e) => e.key === "Shift" && hideAnnotations());
    container.addEventListener("keyup", (e) => e.key === "Shift" && showAnnotations());
    container.addEventListener('click', (event) => {
        pointer.set((event.clientX / container.clientWidth) * 2 - 1, -(event.clientY / container.clientHeight) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(scene.children, true);

        if (intersects.length > 0) {
            let clickedObject = intersects[0].object;
            if (clickedObject.parent?.name === "Door001" && mixer && animation?.length > 0) {
                animation.forEach((clip) => {
                    if (["DoorAction.002", "HandleAction.002", "Latch.001Action.002"].includes(clip.name)) {
                        const action = mixer.clipAction(clip);
                        action.clampWhenFinished = true;
                        action.loop = THREE.LoopOnce;
                        action.timeScale = isDoorOpen ? -1 : 1;
                        if (isDoorOpen) action.time = action.getClip().duration;
                        action.reset().play();
                        isDoorOpen = !isDoorOpen;
                    }
                });
            }
        }
    });

    initUploadModal();
    initMenu();
    loadModel();

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