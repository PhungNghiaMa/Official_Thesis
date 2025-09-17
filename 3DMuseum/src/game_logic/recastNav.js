// recastNav.js
import * as THREE from 'three';
import { init, NavMeshQuery , NavMesh , importNavMesh } from 'recast-navigation';
import { threeToSoloNavMesh, NavMeshHelper } from '@recast-navigation/three';

let navMesh = null;
let navQuery = null;
let navHelper = null;

export async function initRecastIfNeeded() {
  if (!init.initialized) {
    await init();
  }
}

/**
 * Build navmesh from an array of THREE.Mesh.
 * If `scene` is provided, a NavMeshHelper will be added for debugging.
 */
export function buildNavMeshFromMeshes(meshes = [], config = {}, scene = null) {
  if (!Array.isArray(meshes) || meshes.length === 0) {
    console.warn('buildNavMeshFromMeshes: no meshes provided');
    return { success: false, error: 'no meshes' };
  }

  // Choose floor-like meshes by default
  const meshesToUse = meshes.filter(
    m =>
      m &&
      m.isMesh &&
      (
        m.userData?.navWalkable ||
        !m.userData?.navObstacle ||
        (m.name && m.name.toLowerCase().includes('floor'))
      )
  );

  if (meshesToUse.length === 0) {
    console.warn('buildNavMeshFromMeshes: no valid meshes were provided.');
    return { success: false, error: 'no meshes' };
  }

  console.info('NavMesh build will use the following meshes:');
  meshesToUse.forEach(m => console.info('  -', m.name || m.uuid));

    // 🔥 Bake each mesh by applying its world matrix
  const bakedMeshes = meshesToUse.map(mesh => {
    const geom = mesh.geometry.clone();
    geom.applyMatrix4(mesh.matrixWorld); // transform verts into world-space
    return new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ visible: false }));
  });

  // Directly generate navmesh from the provided meshes
  try {
    const { success, navMesh: nm } = threeToSoloNavMesh(bakedMeshes, config);
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
    }

    if (scene) {
      try {
        if (navHelper && navHelper.parent){
          navHelper.parent.remove(navHelper);
          navHelper = null;
        }

        // const navMeshMaterial = new THREE.MeshBasicMaterial({
        //   color: 0x00ff00, // Change this to the color you want (e.g., 0x0000ff for blue, 0xff0000 for red)
        //   wireframe: true,
        //   transparent: true,
        //   opacity: 0.5,
        // });
        // const helper = new NavMeshHelper(navMesh, { navMeshMaterial });

        // const nmMat = new THREE.MeshBasicMaterial({
        //   color: 0x00ff00,
        //   wireframe: true,
        //   transparent: true,
        //   opacity: 1,
        //   side: THREE.DoubleSide,
        //   polygonOffset: true,
        // });

        // navHelper = new NavMeshHelper(navMesh, { navMeshMaterial: nmMat });
        // scene.add(navHelper);
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

export async function LoadExternalNavMesh(scene, url) {
  try {
    console.log("START LOADING EXTERNAL NAVMESH:", url);

    const loader = new THREE.FileLoader();
    loader.setResponseType('arraybuffer');

    // ✅ loadAsync returns a promise
    const data = await loader.loadAsync(url);

    if (!data) {
      console.error("File loaded but data is empty/undefined");
      return { success: false, navMesh: null, navQuery: null };
    }
    console.log("Data loaded, length:", data.byteLength);

    const myUint8Array = new Uint8Array(data);
    console.log("MyUint8Array length:", myUint8Array.length);

    // Your custom import function (must return { navMesh })
    const { navMesh: nm } = importNavMesh(myUint8Array);

    if (!nm) {
      console.error('importNavMesh returned failure (no navmesh).');
      return { success: false, navMesh: null, navQuery: null };
    }

    navMesh = nm;
    console.log("NavMesh:", navMesh);

    // ✅ Create NavMeshQuery
    navQuery = new NavMeshQuery(navMesh);
    console.log("NavQuery:", navQuery);

    // Replace old helper
    if (navHelper && navHelper.parent) {
      navHelper.parent.remove(navHelper);
      navHelper = null;
    }
    // const helper = new NavMeshHelper(navMesh);
    // scene.add(helper);
    // navHelper = helper;

    console.log("NavMesh imported successfully!");
    return { success: true, navMesh, navQuery };

  } catch (err) {
    console.error('Exception while loading external navmesh:', err);
    return { success: false, navMesh: null, navQuery: null };
  }
}
