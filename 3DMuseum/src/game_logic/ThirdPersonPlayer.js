import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import {MeshBVH } from 'three-mesh-bvh';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationMixer } from 'three';


const GRAVITY = 30;

export default class ThirdPersonPlayer {
  constructor(camera, scene, container, playerCollider, characterModel) {
    this.camera = camera;
    this.scene = scene;
    this.container = container;

    this.playerVelocity = new THREE.Vector3();
    this.playerDirection = new THREE.Vector3();
    this.playerOnFloor = false;
    this.gravity = GRAVITY;
    this.turnRateDegree = 70;
    this.turnRate = THREE.MathUtils.degToRad(this.turnRateDegree); ;

    this._cameraSnapped = false;

    this.playerCollider = playerCollider ?? new Capsule(
      new THREE.Vector3(0, 0.0, 0),
      new THREE.Vector3(0, 1.0, 0),
      0.35
    );
    this._smoothedPlayerPosition = new THREE.Vector3().copy(this.playerCollider.end);

    this.bvhMeshes = [];
    this.bvhHelpers = [];
    this.bvhReady = false;

    this.model = characterModel ?? null;
    this.mixer = null;
    this.idleAction = null;
    this.walkAction = null;
    this.currentAction = null;
    this.footOffset = 0;

    // Animation instance 
    this.walkForwardAction = null;
    this.turnLeftAction = null;
    this.turnRightAction = null;
    this.runForwardAction = null;


    this.input = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };
    this.tempQuaternion = new THREE.Quaternion();

    // Helper variables for collision detection
    this.tempBox = new THREE.Box3();
    this.tempMat = new THREE.Matrix4();
    this.tempSegment = new THREE.Line3();
    this.tempVector = new THREE.Vector3();
  }

  // -------------------------------------------------------------------------

  /** Build BVH from loaded scene (same usage as in FirstPersonPlayer) */
  buildBVH(scene) {
    this.bvhMeshes = [];
    scene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.updateMatrixWorld(true);
        child.geometry.boundsTree = new MeshBVH(child.geometry, { maxLeafTris: 10 });
        this.bvhMeshes.push(child);
      }
    });
    this.bvhReady = true;
  }


  loadModel(url, DracoLoader, KTX2Loader , renderer) {
    const loader = new GLTFLoader();
    loader.setDRACOLoader(DracoLoader);
    loader.setKTX2Loader(KTX2Loader);

    loader.load(url, (gltf) => {
      this.model = gltf.scene;
      this.model.traverse((child) => {
        if (child.isMesh){
          child.castShadow = true;
          child.receiveShadow = true;
        } 
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          child.material.map.colorSpace = THREE.SRGBColorSpace;
          child.material.map.needsUpdate = true;
        }
      });
      this.scene.add(this.model);

      // compute "feet" offset so feet sit on capsule bottom
      this.model.updateWorldMatrix(true, true);
      const bbox = new THREE.Box3().setFromObject(this.model);
      this.footOffset = -bbox.min.y;

      // animations
      this.mixer = new AnimationMixer(this.model);
      if (gltf.animations && gltf.animations.length > 0) {
        const gltfAnimation = gltf.animations.filter(a => a.name != 'TPose')[0];
        if (gltfAnimation) {
          this.walkAction = this.mixer.clipAction(gltfAnimation);
          this.walkAction.play();
          this.walkAction.paused = true;
          this.currentAction = this.walkAction;
        }
      }
    });
  }

  /**
   * Clamp camera position using BVH sphere sweep + raycast fallback + inside containment
   */
  clampCameraPosition(origin, desired, radius, minDist) {
    if (!this.bvhReady || !this.bvhMeshes?.length) return desired.clone();

    let result = desired.clone();

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry?.boundsTree;
      if (!bvh) continue;

      // world -> local
      this.tempMat.copy(mesh.matrixWorld).invert();
      const originLocal = origin.clone().applyMatrix4(this.tempMat);
      const endLocal = result.clone().applyMatrix4(this.tempMat);

      this.tempSegment.start.copy(originLocal);
      this.tempSegment.end.copy(endLocal);
      this.tempBox.makeEmpty();
      this.tempBox.expandByPoint(this.tempSegment.start);
      this.tempBox.expandByPoint(this.tempSegment.end);
      this.tempBox.min.addScalar(-radius);
      this.tempBox.max.addScalar(radius);

      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this.tempBox),
        intersectsTriangle: (tri) => {
          const triPoint = new THREE.Vector3();
          const segPoint = new THREE.Vector3();
          const dist = tri.closestPointToSegment(this.tempSegment, triPoint, segPoint);
          if (dist < radius) {
            const depth = radius - dist;
            const pushDir = segPoint.clone().sub(triPoint);
            let len = pushDir.length();

            if (len < 1e-6) {
              pushDir.copy(this.tempSegment.end).sub(this.tempSegment.start);
              len = pushDir.length();
              if (len < 1e-6) {
                pushDir.set(0, 1, 0);
                len = 1.0;
              }
            }

            pushDir.multiplyScalar(1 / len);
            this.tempSegment.end.addScaledVector(pushDir, depth + 1e-4);
          }
        }
      });

      // Enforce min separation
      const dirLocal = this.tempSegment.end.clone().sub(this.tempSegment.start);
      const lenLocal = dirLocal.length();
      if (lenLocal < minDist) {
        if (lenLocal > 1e-6) dirLocal.multiplyScalar(minDist / lenLocal);
        else dirLocal.set(0, 0, minDist);
        this.tempSegment.end.copy(this.tempSegment.start).add(dirLocal);
      }

      // back to world
      result.copy(this.tempSegment.end).applyMatrix4(mesh.matrixWorld);
    }

    // --- Raycast safety (origin -> camera) ---
    {
      const dir = result.clone().sub(origin);
      const dist = dir.length();
      if (dist > 1e-6) {
        dir.normalize();
        const raycaster = new THREE.Raycaster(origin, dir, 0, dist);
        const hits = raycaster.intersectObjects(this.bvhMeshes, true);
        if (hits.length > 0) {
          const safeDist = Math.max(minDist, hits[0].distance - 0.05);
          result = origin.clone().add(dir.multiplyScalar(safeDist));
        }
      }
    }

    // --- Extra containment (camera -> origin) ---
    {
      const dirBack = origin.clone().sub(result);
      const distBack = dirBack.length();
      if (distBack > 1e-6) {
        dirBack.normalize();
        const raycasterBack = new THREE.Raycaster(result, dirBack, 0, distBack);
        const hitsBack = raycasterBack.intersectObjects(this.bvhMeshes, true);
        if (hitsBack.length > 0) {
          const safe = hitsBack[0].distance - 0.05;
          result = result.clone().add(dirBack.multiplyScalar(safe));
        }
      }
    }

    return result;
  }

  getForwardVector() {
    if (this.model) {
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion);
      f.y = 0;
      return f.normalize();
    }
    const v = new THREE.Vector3();
    this.camera.getWorldDirection(v);
    v.y = 0;
    return v.normalize();
  }

  getSideVector() {
    const f = this.getForwardVector();
    const s = new THREE.Vector3().copy(f).cross(new THREE.Vector3(0, 1, 0)).normalize();
    return s;
  }

  playAction(action) {
    if (action && this.currentAction !== action) {
      if (this.currentAction) {
        this.currentAction.crossFadeTo(action, 0.2, false);
      }
      action.reset().play();
      this.currentAction = action;
    }
  }

  onKeyDown(event) {
    switch (event.code) {
      case 'KeyW': this.input.forward = true; break;
      case 'KeyS': this.input.backward = true; break;
      case 'KeyA': this.input.left = true; break;
      case 'KeyD': this.input.right = true; break;
      case 'ShiftLeft': this.input.run = true; break;
      case 'ShiftRight': this.input.run = true; break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW': this.input.forward = false; break;
      case 'KeyS': this.input.backward = false; break;
      case 'KeyA': this.input.left = false; break;
      case 'KeyD': this.input.right = false; break;
      case 'ShiftLeft': this.input.run = false; break;
      case 'ShiftRight': this.input.run = false; break;
    }
  }

  // -------------------------------------------------------------------------

  // In ThirdPersonPlayer.js
  update(delta, cameraYaw) {
    if (!this.model || !this.playerCollider) return;

    // ===== Input (WASD) relative to camera YAW =====
    const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cameraYaw);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQuat).setY(0).normalize();
    const right   = new THREE.Vector3(1, 0, 0).applyQuaternion(yawQuat).setY(0).normalize();

    const moveDir = new THREE.Vector3();
    if (this.input.forward)  moveDir.add(forward);
    if (this.input.backward) moveDir.sub(forward);
    if (this.input.left)     moveDir.sub(right);
    if (this.input.right)    moveDir.add(right);
    moveDir.normalize();

    // ===== Physics integration (stable) =====
    // gravity
    if (!this.playerOnFloor) {
      this.playerVelocity.y -= this.gravity * delta;
    } else {
      this.playerVelocity.y = Math.max(0, this.playerVelocity.y);
    }

    // horizontal acceleration from input
    const accel = (this.playerOnFloor ? 20 : 8);
    if (moveDir.lengthSq() > 0) {
      this.playerVelocity.addScaledVector(moveDir, accel * delta);
    }

    // damping (more on ground)
    const damp = Math.exp(-(this.playerOnFloor ? 10 : 0.4) * delta);
    this.playerVelocity.x *= damp;
    this.playerVelocity.z *= damp;

    // integrate capsule
    const deltaPos = this.playerVelocity.clone().multiplyScalar(delta);
    this.playerCollider.translate(deltaPos);

    // ===== Capsule vs BVH collision =====
    this.playerOnFloor = false;

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry?.boundsTree;
      if (!bvh) continue;

      // world -> local
      this.tempMat.copy(mesh.matrixWorld).invert();
      const start = this.playerCollider.start.clone().applyMatrix4(this.tempMat);
      const end   = this.playerCollider.end.clone().applyMatrix4(this.tempMat);

      this.tempSegment.start.copy(start);
      this.tempSegment.end.copy(end);

      // fat AABB around segment
      this.tempBox.makeEmpty();
      this.tempBox.expandByPoint(this.tempSegment.start);
      this.tempBox.expandByPoint(this.tempSegment.end);
      this.tempBox.min.addScalar(-this.playerCollider.radius);
      this.tempBox.max.addScalar(this.playerCollider.radius);

      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this.tempBox),
        intersectsTriangle: (tri) => {
          const triPoint = new THREE.Vector3();
          const capPoint = new THREE.Vector3();
          const dist = tri.closestPointToSegment(this.tempSegment, triPoint, capPoint);

          if (dist < this.playerCollider.radius) {
            const depth = this.playerCollider.radius - dist;
            const pushDir = capPoint.sub(triPoint);

            if (pushDir.lengthSq() > 1e-12) {
              pushDir.normalize().multiplyScalar(depth + 1e-4);
              this.tempSegment.start.add(pushDir);
              this.tempSegment.end.add(pushDir);
              if (pushDir.y > 0.1) this.playerOnFloor = true;
            } else {
              // fallback: push along triangle normal
              const n = new THREE.Vector3();
              tri.getNormal(n);
              n.multiplyScalar(depth + 1e-4);
              this.tempSegment.start.add(n);
              this.tempSegment.end.add(n);
              if (n.y > 0.1) this.playerOnFloor = true;
            }
          }
        }
      });

      // local -> world (apply correction)
      this.playerCollider.start.copy(this.tempSegment.start).applyMatrix4(mesh.matrixWorld);
      this.playerCollider.end.copy(this.tempSegment.end).applyMatrix4(mesh.matrixWorld);
    }

    // ===== Update model transform =====
    // place model so feet touch capsule bottom
    this.model.position.set(
      this.playerCollider.end.x,
      this.playerCollider.start.y + this.footOffset,
      this.playerCollider.end.z
    );

    // rotate model toward movement
    const move2D = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
    if (move2D.lengthSq() > 1e-6) {
      const targetAngle = Math.atan2(move2D.x, move2D.z);
      this.tempQuaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), targetAngle);
      this.model.quaternion.rotateTowards(this.tempQuaternion, this.turnRate * delta);
    }

    // simple walk/idle using one clip (pause when not moving)
    if (this.walkAction) {
      this.walkAction.paused = move2D.length() <= 0.02;
    }

    // (optional) update mixer here, OR in animate(); don’t do both
    // if (this.mixer) this.mixer.update(delta);
  }


}
