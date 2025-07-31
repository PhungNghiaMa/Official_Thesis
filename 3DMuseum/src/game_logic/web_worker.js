/* eslint-disable no-restricted-globals */
// --- THIS FILE RUNS INSIDE A MODULE WORKER -----------------------------

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Create WebGL renderer for KTX2Loader
const canvas = new OffscreenCanvas(1, 1);
const renderer = new THREE.WebGLRenderer({ canvas });

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Initialize KTX2Loader
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath('/basis/');
ktx2Loader.detectSupport(renderer);
gltfLoader.setKTX2Loader(ktx2Loader);
const backendUrl = import.meta.env.MODE === "production"
? import.meta.env.VITE_PROD_BACKEND_URL
: import.meta.env.VITE_BACKEND_URL;

// ─────────────────────────────────────────────────────────────────────────
self.onmessage = async (event) => {
  const { type, modelPath, roomId } = event.data;
  console.log('[Worker] Received message:', { type, modelPath, roomId });
  if (type !== 'loadModel') return;

  try {
    // Load the GLTF (heavy I/O happens here, in the worker)
    const gltf = await gltfLoader.loadAsync(modelPath);

    gltf.scene.traverse((child) =>{
      if (child.isMesh && !child.name) {
        child.name = child.userData.originalName || `Unnamed_${child.uuid}`;
      }
    })

    //  Do CPU‑heavy traversal & math here (still in the worker)
    const data = analyseScene(gltf.scene);

    // Fetch room asset data in the background
    let roomAssets = [];
    console.log('[Worker] backendUrl:', backendUrl, 'roomId:', roomId);
    if (backendUrl && roomId !== undefined && roomId !== null) {
      try {
        const assetUrl = `${backendUrl}/list/${roomId}`;
        console.log('[Worker] Fetching URL:', assetUrl);
        const response = await fetch(assetUrl);
        roomAssets = await response.json();
        if (!roomAssets || !Array.isArray(roomAssets)) {
          console.warn('[Worker] Invalid asset data format:', roomAssets);
        }
      } catch (e) {
        console.error('[Worker] Fetch error:', e);
        roomAssets = [];
      }
    } else {
      console.warn('[Worker] backendUrl or roomId missing, skipping asset fetch.');
    }

    // 4️⃣  Send only serialisable data back to the main thread
    self.postMessage({ type: 'modelProcessed', data, roomAssets });

  } catch (err) {
    console.error('An error occurred while loading the model:', err);
    console.error('[model‑worker] ', err);
    self.postMessage({
      type: 'error',
      message: err?.message || 'Unknown error occurred'
    });
  }
};


// ─────────────────────────────────────────────────────────────────────────
function analyseScene(scene) {
  const box     = new THREE.Box3();
  const size    = new THREE.Vector3();
  const center  = new THREE.Vector3();
  const pos     = new THREE.Vector3();

  let floorBoxMaxY = null;
  let floorMesh = null;
  let maxArea      = 0;
  const pictureFrames = [];
  const imageMeshes   = [];
  let doorBox         = null;
  const fallback = { x: 0, y: Infinity, z: 0 };

  scene.updateMatrixWorld(true);

  scene.traverse((child) => {
    if (!child.isMesh) return;

    console.table({ MeshName: child.name });

    child.updateMatrixWorld(true);  // Ensure child's world matrix is up to date
    child.getWorldPosition(pos);

    // Track lowest point for fallback
    if (pos.y < fallback.y) {
        fallback.x = pos.x;
        fallback.y = pos.y;
        fallback.z = pos.z;
    }

    if (/^Picture_Frame\d+$/i.test(child.name)) pictureFrames.push(child.name);
    if (/^ImageMesh\d+$/i.test(child.name))     imageMeshes.push(child.name);

    if (child.name.toLowerCase().includes('floor')) {
      box.setFromObject(child);
      box.getSize(size);
      const area = size.x * size.z;
      if (area > maxArea) {
        maxArea = area;
        floorBoxMaxY = box.max.y;
        floorMesh = {
          box: box.clone(),
          center: box.getCenter(center).clone(),
          name: child.name
        }
        // console.log('Found floor mesh:', child.name, 'with area:', area);
      }
    }

    if (child.parent?.name === 'Door') {
      box.setFromObject(child);
      doorBox = { min: box.min.toArray(), max: box.max.toArray() };
    }
  });

  const playerStart = {x: 0 , y: 0 , z: 0}
  if (floorMesh) {
    playerStart.x = floorMesh.center.x;
    playerStart.y = (floorBoxMaxY ?? floorMesh.center.y) + 1;
    playerStart.z = floorMesh.center.z;
  } else {
    playerStart.x = fallback.x;
    playerStart.y = (fallback.y === Infinity ? 1 : fallback.y) + 0.1;
    playerStart.z = fallback.z;
    console.warn("No floor mesh found, using lowest mesh position as fallback.");
  }
  return {
    playerStartPos     : playerStart,
    fallbackPos        : [fallback.x, fallback.y, fallback.z],
    floorBoxMaxY       : floorBoxMaxY,
    pictureFramesData  : pictureFrames,
    imageMeshesData    : imageMeshes,
    doorBoundingBoxData: doorBox,
    model: "WebWorker Model",
  };
}