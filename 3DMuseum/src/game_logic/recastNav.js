// recastNav.js
import * as THREE from 'three';
import { init, NavMeshQuery } from 'recast-navigation';
import { threeToSoloNavMesh, NavMeshHelper } from '@recast-navigation/three';
import { BufferGeometryUtils } from 'three/examples/jsm/Addons.js';

let navMesh = null;
let navQuery = null;
let navHelper = null;

export async function initRecastIfNeeded() {
  if (!init.initialized) {
    await init();
  }
}

/** Bake geometry positions into world-space (returns a THREE.BufferGeometry) */
function bakeGeometryToWorld(mesh) {
  const src = mesh.geometry;
  if (!src || !src.attributes || !src.attributes.position) {
    throw new Error(`mesh ${mesh.name || mesh.uuid} has no position attribute`);
  }
  mesh.updateMatrixWorld(true);

  const posAttr = src.attributes.position;
  const count = posAttr.count;
  const out = new Float32Array(count * 3);
  const v = new THREE.Vector3();
  const mat = mesh.matrixWorld;

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(posAttr, i).applyMatrix4(mat);
    out[i * 3] = v.x;
    out[i * 3 + 1] = v.y;
    out[i * 3 + 2] = v.z;
  }

  const outGeom = new THREE.BufferGeometry();
  outGeom.setAttribute('position', new THREE.BufferAttribute(out, 3));
  // copy index if exists (many exported floors are indexed)
  if (src.index) {
    outGeom.setIndex(src.index.clone());
  }
  return outGeom;
}

/**
 * Build navmesh from an array of THREE.Mesh.
 * If `scene` is provided, a NavMeshHelper will be added for debugging.
 *
 * Strategy:
 *  - Bake all meshes to world-space BufferGeometries
 *  - Merge into a single geometry
 *  - If merged bbox height is nearly zero, create a proxy box (thin slab) sized to cover the area
 *  - Call threeToSoloNavMesh with an array containing the final mesh(s)
 */
export function buildNavMeshFromMeshes(meshes = [], config = {}, scene = null) {
  if (!Array.isArray(meshes) || meshes.length === 0) {
    console.warn('buildNavMeshFromMeshes: no meshes provided');
    return { success: false, error: 'no meshes' };
  }

  // Bake each mesh into a world-space BufferGeometry
  const bakedGeoms = [];
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    try {
      const g = bakeGeometryToWorld(m);
      bakedGeoms.push(g);
      const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
      console.info(`  [nav-candidate] ${m.name || m.uuid} verts=${g.attributes.position.count} bboxY=[${box.min.y.toFixed(3)},${box.max.y.toFixed(3)}]`);
    } catch (err) {
      console.warn(`  skip mesh ${m.name || m.uuid} — bake failed:`, err && err.message ? err.message : err);
    }
  }

  if (bakedGeoms.length === 0) {
    console.warn('No valid baked geometries for navmesh.');
    return { success: false, error: 'no valid geometry' };
  }

  // Merge all baked geometries into one combined BufferGeometry
  let combined = null;
  try {
    combined = BufferGeometryUtils.mergeGeometries(bakedGeoms, true);
    if (!combined) throw new Error('mergeBufferGeometries returned null');
  } catch (err) {
    console.error('Failed to merge geometries for navmesh:', err);
    return { success: false, error: 'merge failed' };
  }

  // Make sure bounding box exists and compute size
  combined.computeBoundingBox();
  const bbox = combined.boundingBox;
  if (!bbox || bbox.isEmpty()) {
    console.error('Combined geometry has empty bounding box.');
    return { success: false, error: 'empty bbox' };
  }
  const size = new THREE.Vector3();
  bbox.getSize(size);
  console.info('NavMesh input bbox size:', size);

  // If the merged geometry is essentially flat (tiny height), create a proxy box (thin slab)
  const MIN_HEIGHT = 0.2; // minimal height in world units for robust voxelization
  let finalMeshes = [];

  if (size.y < MIN_HEIGHT) {
    console.warn(`Combined geometry is thin (height=${size.y.toFixed(4)}). Using proxy slab height=${MIN_HEIGHT}.`);
    const center = new THREE.Vector3();
    bbox.getCenter(center);

    // Slightly enlarge x/z to ensure coverage and avoid edge artifacts
    const padXZ = 0.02;
    const slabGeom = new THREE.BoxGeometry(size.x + padXZ, MIN_HEIGHT, size.z + padXZ);
    const slabMesh = new THREE.Mesh(slabGeom, new THREE.MeshBasicMaterial({ visible: false }));
    // position slab so its top is roughly near the original geometry's center
    slabMesh.position.set(center.x, bbox.min.y - MIN_HEIGHT / 2, center.z);
    slabMesh.updateMatrixWorld(true);

    finalMeshes.push(slabMesh);
  } else {
    // Create a mesh from combined geometry to pass to recast
    const combinedMesh = new THREE.Mesh(combined, new THREE.MeshBasicMaterial({ visible: false }));
    combinedMesh.updateMatrixWorld(true);
    finalMeshes.push(combinedMesh);
  }

  // Attempt to generate navmesh with threeToSoloNavMesh
  try {
    const { success, navMesh: nm } = threeToSoloNavMesh(finalMeshes, config);
    if (!success || !nm) {
      console.error('threeToSoloNavMesh returned failure (no navmesh).');
      return { success: false, error: 'threeToSoloNavMesh failed' };
    }

    navMesh = nm;
    try {
      navQuery = new NavMeshQuery(navMesh);
    } catch (e) {
      console.error('NavMeshQuery construction failed:', e);
      navQuery = null;
    }// replace the navHelper creation block in buildNavMeshFromMeshes
if (scene) {
  try {
    if (navHelper && navHelper.parent) navHelper.parent.remove(navHelper);

    // Material tuned to avoid z-fighting. Slightly offset polygons so helper renders cleanly.
    const nmMat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.30,
      side: THREE.DoubleSide
    });
    nmMat.polygonOffset = true;
    nmMat.polygonOffsetFactor = -1;   // push the navmesh polygons slightly toward camera depth
    nmMat.polygonOffsetUnits = -4;

    navHelper = new NavMeshHelper(navMesh, {
      navMeshMaterial: nmMat
    });
    scene.add(navHelper);
  } catch (err) {
    console.warn('Failed to create NavMeshHelper:', err);
  }
}


    // attach debug helper if scene provided
    if (scene) {
      try {
        if (navHelper && navHelper.parent) navHelper.parent.remove(navHelper);

        // Material tuned to avoid z-fighting. Slightly offset polygons so helper renders cleanly.
        const nmMat = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          transparent: true,
          opacity: 0.30,
          side: THREE.DoubleSide
        });
        nmMat.polygonOffset = true;
        nmMat.polygonOffsetFactor = -1;   // push the navmesh polygons slightly toward camera depth
        nmMat.polygonOffsetUnits = -4;

        navHelper = new NavMeshHelper(navMesh, {
          navMeshMaterial: nmMat
        });
        scene.add(navHelper);
      } catch (err) {
        console.warn('Failed to create NavMeshHelper:', err);
      }
    }

    console.info('Navmesh generation succeeded.');
    return { success: true, navMesh: navMesh };
  } catch (err) {
    console.error('Exception while calling threeToSoloNavMesh:', err);
    return { success: false, error: err && err.message ? err.message : String(err) };
  }
}

export function getNavQuery() {
  return navQuery;
}
export function getNavHelper() {
  return navHelper;
}
