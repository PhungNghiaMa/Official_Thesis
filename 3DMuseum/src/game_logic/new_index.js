// src/game_logic/index.js

import "../../main.css";

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import FirstPersonPlayer from './control';
import AnnotationDiv from "./annotationDiv";
import { displayUploadModal, initUploadModal, Mapping_PictureFrame_ImageMesh, DisplayImageOnDiv } from "./utils";
import { GetRoomAsset } from "./services";
import { Museum } from "./constants";
import { Capsule, DRACOLoader } from "three/examples/jsm/Addons.js";
import RaycasterManager from "./raycaster.js";
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { KTX2Loader } from "three/examples/jsm/Addons.js";

THREE.Cache.enabled = true;

// -------------------------------
// Globals
// -------------------------------
let container, scene, camera;
let usingComposer = false;
const renderer = new THREE.WebGLRenderer({ antialias: true });


const nodes = { imageMeshes: [], frames: [], doors: [] };
let hasVisibleLabels = false;
let fpView;

const modelCache = new Map();
const scheduleIdle = (cb) => ('requestIdleCallback' in window) ? requestIdleCallback(cb) : setTimeout(cb, 0);
const clock = new THREE.Clock();
let accumulator = 0;

// Define the museum models and their paths
const ModelPaths = {
    [Museum.ART_GALLERY]: "optimizedModel/optimizeModel_8.glb",
    [Museum.LOUVRE]: "art_hallway/VIRTUAL_ART_GALLERY_3.gltf",
}

// -------------------------------
// Utility functions
// -------------------------------
function getModelPath(museumId) {
  return `/assets/${ModelPaths[museumId] || ModelPaths[Museum.ART_GALLERY]}`;
}

// -------------------------------
// Texture Loading Queue
// -------------------------------
class TextureQueue {
  constructor(max = 3) {
    this.max = max;
    this.inflight = 0;
    this.q = [];
    this.loader = new THREE.ImageBitmapLoader();
    this.loader.setOptions({ imageOrientation: 'flipY' });
  }
  load(url) {
    return new Promise((res, rej) => {
      const run = () => {
        this.inflight++;
        this.loader.load(url, (bmp) => {
          const tex = new THREE.Texture(bmp);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.needsUpdate = true;
          this.inflight--; this._drain(); res(tex);
        }, undefined, (e) => { this.inflight--; this._drain(); rej(e); });
      };
      this.q.push(run);
      this._drain();
    });
  }
  _drain() {
    while (this.inflight < this.max && this.q.length) this.q.shift()();
  }
}
const textureQueue = new TextureQueue(3);

async function setImageToMesh(mesh, url) {
  try {
    const tex = await textureQueue.load(url);
    mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  } catch (e) {
    console.warn('Image load failed', url, e);
  }
}

// -------------------------------
// Postprocessing (on-demand)
// -------------------------------
function ensureComposer() {
  if (composer) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  outlinePass = new OutlinePass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    scene, camera
  );
  outlinePass.edgeStrength = 3;
  outlinePass.edgeGlow = 0.6;
  outlinePass.edgeThickness = 2.0;
  outlinePass.pulsePeriod = 2;
  composer.addPass(outlinePass);
}

export function setOutlined(objects) {
  if (!objects || objects.length === 0) {
    usingComposer = false;
    if (outlinePass) outlinePass.selectedObjects = [];
    return;
  }
  ensureComposer();
  outlinePass.selectedObjects = objects;
  usingComposer = true;
}

// -------------------------------
// Idle batching for bounds + labels
// -------------------------------
function batchComputeBounds(objects, batchSize = 30) {
  let i = 0;
  function step() {
    const end = Math.min(i + batchSize, objects.length);
    for (; i < end; i++) {
      const obj = objects[i];
      obj.geometry?.computeBoundingBox?.();
      obj.userData.worldBox = new THREE.Box3().setFromObject(obj);
    }
    if (i < objects.length) requestAnimationFrame(step);
  }
  step();
}

function createLabelsIncremental(images, batchSize = 10) {
  let i = 0;
  function step() {
    const end = Math.min(i + batchSize, images.length);
    for (; i < end; i++) {
      const mesh = images[i];
      if (mesh.userData.label) continue;
      const label = new CSS2DObject(AnnotationDiv(/* props */));
      label.visible = false;
      mesh.add(label);
      mesh.userData.label = label;
    }
    if (i < images.length) scheduleIdle(step);
  }
  step();
}

function showNearbyLabels(origin, radius = 6) {
  hasVisibleLabels = false;
  const tmp = new THREE.Vector3();
  for (const mesh of nodes.imageMeshes) {
    const visible = origin.distanceTo(mesh.getWorldPosition(tmp)) < radius;
    if (mesh.userData.label) mesh.userData.label.visible = visible;
    if (visible) hasVisibleLabels = true;
  }
}

// -------------------------------
// Adaptive physics
// -------------------------------
function updatePhysics(dt) {
  accumulator += dt;
  const h = 1 / 60;
  const maxSubsteps = (accumulator > 1 / 45) ? 3 : 2;
  let n = 0;
  while (accumulator >= h && n < maxSubsteps) {
    fpView?.update(h);
    accumulator -= h; n++;
  }
}

// -------------------------------
// Cached model loading
// -------------------------------
async function loadModelCached(key, loadFn) {
  if (modelCache.has(key)) return modelCache.get(key);
  const p = loadFn().then(gltf => gltf);
  modelCache.set(key, p);
  return p;
}

// -------------------------------
// Main init function
// -------------------------------
export async function initializeGame(containerId = 'model-container') {
  container = document.getElementById(containerId);
  if (!container) {
    console.error(`Game container with ID '${containerId}' not found.`);
    return;
  }

  // Scene setup
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);

  // const renderer = new THREE.WebGLRenderer({ antialias: true });
  const MAX_PR = 2.0;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PR));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const cssRenderer = new CSS2DRenderer();
  cssRenderer.domElement.style.position = 'absolute';
  cssRenderer.domElement.style.top = '0';
  cssRenderer.setSize(container.clientWidth, container.clientHeight);
  container.style.display = 'block';
  container.appendChild(cssRenderer.domElement);

  // Loaders
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('/draco/');
  dracoLoader.setDecoderConfig({ type: 'wasm' });
  dracoLoader.preload();

  const ktx2Loader = new KTX2Loader()
    .setTranscoderPath('/basis/')
    .detectSupport(renderer);

  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  loader.setKTX2Loader(ktx2Loader);

  const currentMuseumId = Museum.ART_GALLERY;

  // Load model but start render loop immediately
  loadModelCached(currentMuseumId, () => loader.loadAsync(getModelPath(currentMuseumId)))
    .then(gltf => {
      scene.add(gltf.scene);

      // Classify meshes
      gltf.scene.traverse(child => {
        if (!child.isMesh) return;
        if (/^ImageMesh\d+$/.test(child.name)) nodes.imageMeshes.push(child);
        else if (/^PictureFrame\d+$/.test(child.name)) nodes.frames.push(child);
        else if (/^Door/i.test(child.name)) nodes.doors.push(child);
      });

      // Init collision + player
      camera.position.set(0, 0, 0);
      const capsule = new Capsule(0.5, 1.6, 0.2);
      fpView = new FirstPersonPlayer(camera, scene, container);
      fpView.loadOctaTree(scene);

      // Schedule background tasks
      scheduleIdle(() => batchComputeBounds([...nodes.imageMeshes, ...nodes.frames]));
      scheduleIdle(() => createLabelsIncremental(nodes.imageMeshes));
      scheduleIdle(() => renderer.compile(scene, camera));
      scheduleIdle(() => {
        const other = (currentMuseumId === Museum.ART_GALLERY) ? Museum.LOUVRE : Museum.ART_GALLERY;
        loadModelCached(other, () => loader.loadAsync(getModelPath(other)));
      });

      // Asset images from backend (non-blocking)
      scheduleIdle(async () => {
        try {
          const assets = await GetRoomAsset(currentMuseumId);
          for (const a of assets) {
            scheduleIdle(() => {
              const mesh = scene.getObjectByName(a.asset_mesh_name);
              if (mesh) setImageToMesh(mesh, a.image_url);
            });
          }
        } catch (err) {
          console.warn("Asset fetch failed", err);
        }
      });

      // Raycaster
      const raycasterManager = new RaycasterManager(camera, scene, renderer.domElement, {
        doorNames: nodes.doors.map(d => d.name),
        onDoorClick: (door) => {
          console.log("Door clicked:", door.name);
        },
        onClickPictureFrame: (frameName) => {
          console.log("Picture frame clicked:", frameName);
          const mesh = scene.getObjectByName(frameName);
          if (mesh) {
            const imgUrl = Mapping_PictureFrame_ImageMesh[frameName];
            if (imgUrl) DisplayImageOnDiv(mesh, imgUrl);
          }
        }
      });
      raycasterManager.setPictureFrames(nodes.frames);
    });

  // Start rendering immediately
  animate();
}

// -------------------------------
// Main render loop
// -------------------------------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  updatePhysics(dt);
  showNearbyLabels(fpView?.position ?? camera.position);

  if (usingComposer) composer.render();
  else renderer.render(scene, camera);
  if (hasVisibleLabels) cssRenderer.render(scene, camera);
}

// -------------------------------
// Resize handler
// -------------------------------
let resizeRaf = null;
function onWindowResize() {
  if (!resizeRaf) return;
  resizeRaf = requestAnimationFrame(() => {
    resizeRaf = null;
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const MAX_PR = 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PR));
    renderer.setSize(w, h, false);
    if (composer) composer.setSize(w, h);
    cssRenderer.setSize(w, h);
  });
}
window.addEventListener('resize', onWindowResize);
