// control.js
// FirstPersonPlayer: TP-like turning, BVH building, mouse yaw/pitch support.

import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

// use accelerated raycast if three-mesh-bvh present
if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 30;

export default class FirstPersonPlayer {
  /**
   * constructor(camera, scene, playerCollider)
   * - camera: THREE.Camera
   * - scene: THREE.Scene (optional; used for traversal if you call buildBVH(scene))
   * - playerCollider: THREE.Capsule-like object { start: Vector3, end: Vector3, radius: number }
   */
  constructor(camera, scene, playerCollider) {
    this.camera = camera;
    this.scene = scene;
    this.turnRateDegree = 90;
    this.turnRate = THREE.MathUtils.degToRad(this.turnRateDegree); // rad/sec

    // Defensive default capsule (if none provided)
    const start = new THREE.Vector3(0, 1.0, 0);
    this.playerCollider = playerCollider ?? new Capsule(
      start.clone(),
      start.clone().add(new THREE.Vector3(0, 1.0, 0)),
      0.35
    );

    // quick defensive checks
    if (!this.playerCollider ||
        !this.playerCollider.start ||
        !this.playerCollider.end ||
        typeof this.playerCollider.radius !== 'number') {
      console.error('FirstPersonPlayer: invalid playerCollider. Expected Capsule-like object. Received:', this.playerCollider);
      // avoid throwing so the app can still run; but later calls will fail noisily if collider is bad
    }

    // physics / movement
    this.playerVelocity = new THREE.Vector3();
    this.playerOnFloor = false;
    this.gravity = GRAVITY;

    // input state (controlled via onKeyDown/onKeyUp externally or internal listeners)
    this.input = { forward: false, backward: false, left: false, right: false, run: false };

    // orientation
    this.yaw = 0;   // radians
    this.pitch = 0; // radians (for camera only)

    // BVH meshes and ready flag
    this.bvhMeshes = [];
    this.bvhReady = false;

    // reusable temps
    this._tempBox = new THREE.Box3();
    this._tempMat = new THREE.Matrix4();
    this._tempSegment = new THREE.Line3();
    this._triPoint = new THREE.Vector3();
    this._capPoint = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._qYaw = new THREE.Quaternion();
    this._qPitch = new THREE.Quaternion();

    // NOTE: some projects call onKeyDown/onKeyUp from index.js global handlers.
    // If you want control.js to self-handle keyboard, uncomment initInput().
    // this.initInput();
  }

  // optional: attach built-in listeners (commented out by default)
  initInput() {
    this._down = (e) => this.onKeyDown(e);
    this._up = (e) => this.onKeyUp(e);
    document.addEventListener('keydown', this._down);
    document.addEventListener('keyup', this._up);
  }

  disposeInput() {
    if (this._down) document.removeEventListener('keydown', this._down);
    if (this._up) document.removeEventListener('keyup', this._up);
  }

  // --- BVH builder: pass scene, root object, or array of meshes ---
  buildBVH(target) {
    const meshes = [];

    const collect = (obj) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        obj.forEach(collect);
        return;
      }
      if (obj.isMesh) {
        if (obj.geometry && obj.geometry.attributes && obj.geometry.attributes.position) {
          meshes.push(obj);
        }
        return;
      }
      if (obj.isObject3D) {
        obj.traverse((c) => {
          if (c.isMesh && c.geometry && c.geometry.attributes && c.geometry.attributes.position) {
            meshes.push(c);
          }
        });
      }
    };

    collect(target);

    for (const mesh of meshes) {
      const geom = mesh.geometry;
      if (!geom) continue;

      // ensure indexed geometry (MeshBVH requires an index)
      if (!geom.index) {
        const pos = geom.attributes.position;
        if (!pos || (pos.count % 3) !== 0) {
          // skip if not triangle list
          console.warn('FirstPersonPlayer.buildBVH: geometry not triangle-list; skipping', mesh);
          continue;
        }
        const triCount = pos.count / 3;
        const IndexArray = pos.count > 65535 ? Uint32Array : Uint16Array;
        const idx = new IndexArray(triCount * 3);
        for (let i = 0; i < triCount * 3; i++) idx[i] = i;
        geom.setIndex(new THREE.BufferAttribute(idx, 1));
      }

      if (!geom.boundsTree) {
        try {
          geom.boundsTree = new MeshBVH(geom, { lazyGeneration: false });
        } catch (err) {
          console.error('FirstPersonPlayer.buildBVH: MeshBVH build failed for mesh', mesh, err);
        }
      }
    }

    this.bvhMeshes = meshes;
    this.bvhReady = true;
    return meshes;
  }

  setBVHMeshes(meshes) {
    this.bvhMeshes = Array.isArray(meshes) ? meshes : [meshes];
    this.bvhReady = true;
  }

  // optional helper used in index.js (you reference player position)
  getPlayerPosition() {
    return this.playerCollider?.end?.clone?.() ?? new THREE.Vector3();
  }

  // basic keyboard handlers (index.js already calls these — fine)
  onKeyDown(event) {
    switch (event.code) {
      case 'KeyW': this.input.forward = true; break;
      case 'KeyS': this.input.backward = true; break;
      case 'KeyA': this.input.left = true; break;
      case 'KeyD': this.input.right = true; break;
      case 'ShiftLeft':
      case 'ShiftRight': this.input.run = true; break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW': this.input.forward = false; break;
      case 'KeyS': this.input.backward = false; break;
      case 'KeyA': this.input.left = false; break;
      case 'KeyD': this.input.right = false; break;
      case 'ShiftLeft':
      case 'ShiftRight': this.input.run = false; break;
    }
  }

  /**
   * update(delta, yawFromMouse = null, pitchFromMouse = null)
   * - delta: seconds (stepDelta from index.js)
   * - yawFromMouse, pitchFromMouse: optional radians from your pointer-lock handler (e.g., camYaw/camPitch)
   *
   * Behavior: mouse override takes precedence (if not null), keys still nudge rotation
   * Movement is forward/back relative to "yaw". Speeds match ThirdPersonPlayer (base 15 running 2.5).
   */
  update(delta, yawFromMouse = null, pitchFromMouse = null) {
    if (!this.bvhReady) return;

    // apply optional mouse yaw/pitch first (so mouse fully controls view)
    if (yawFromMouse !== null) this.yaw = yawFromMouse;
    if (pitchFromMouse !== null) this.pitch = THREE.MathUtils.clamp(pitchFromMouse, -1.2, 0.8);

    // keys still nudge yaw (so A/D + mouse both work)
    if (this.input.left) this.yaw += this.turnRate * delta;
    if (this.input.right) this.yaw -= this.turnRate * delta;

    // gravity + damping
    if (!this.playerOnFloor) {
      this.playerVelocity.y -= this.gravity * delta;
      this.playerVelocity.multiplyScalar(Math.exp(-0.4 * delta));
    } else {
      // keep vertical non-negative when on floor
      this.playerVelocity.y = Math.max(0, this.playerVelocity.y);
      this.playerVelocity.multiplyScalar(Math.exp(-8 * delta));
    }

    // movement: match ThirdPersonPlayer's baseline
    const baseSpeed = this.playerOnFloor ? 15 : 8;
    const finalSpeed = this.input.run ? baseSpeed * 2.5 : baseSpeed;
    const speedDelta = delta * finalSpeed;

    // forward direction from yaw (Z-forward convention)
    this._forward.set(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).setY(0).normalize();

    if (this.input.forward) this.playerVelocity.addScaledVector(this._forward, speedDelta);
    if (this.input.backward) this.playerVelocity.addScaledVector(this._forward, -speedDelta * 0.6);

    // integrate position (velocity is in units consistent with how TP uses them)
    const deltaPos = this.playerVelocity.clone().multiplyScalar(delta);
    // move capsule by updating start/end
    this.playerCollider.start.add(deltaPos);
    this.playerCollider.end.add(deltaPos);

    // --- collisions (local-space shapecast like ThirdPersonPlayer) ---
    this.playerOnFloor = false;

    const tempBox = this._tempBox;
    const tempMat = this._tempMat;
    const tempSegment = this._tempSegment;
    const triPoint = this._triPoint;
    const capPoint = this._capPoint;

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry.boundsTree;
      if (!bvh) continue;

      // transform capsule to mesh local space
      tempMat.copy(mesh.matrixWorld).invert();
      tempSegment.copy(this.playerCollider);
      tempSegment.start.applyMatrix4(tempMat);
      tempSegment.end.applyMatrix4(tempMat);

      tempBox.makeEmpty();
      tempBox.expandByPoint(tempSegment.start);
      tempBox.expandByPoint(tempSegment.end);
      tempBox.min.addScalar(-this.playerCollider.radius);
      tempBox.max.addScalar(+this.playerCollider.radius);

      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(tempBox),
        intersectsTriangle: (tri) => {
          const dist = tri.closestPointToSegment(tempSegment, triPoint, capPoint);
          if (dist < this.playerCollider.radius) {
            const depth = this.playerCollider.radius - dist;
            const pushDir = capPoint.sub(triPoint).normalize();
            tempSegment.start.addScaledVector(pushDir, depth);
            tempSegment.end.addScaledVector(pushDir, depth);
            if (pushDir.y > 0.1) this.playerOnFloor = true;
          }
        }
      });

      // write resolved capsule back to world space
      this.playerCollider.start.copy(tempSegment.start).applyMatrix4(mesh.matrixWorld);
      this.playerCollider.end.copy(tempSegment.end).applyMatrix4(mesh.matrixWorld);
    }

    // update camera to capsule head
    if (this.playerCollider && this.playerCollider.end) {
      this.camera.position.copy(this.playerCollider.end);
    }

    // camera orientation from yaw and pitch
    this._qYaw.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this._qPitch.setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch);
    this.camera.quaternion.copy(this._qYaw).multiply(this._qPitch);
  }
}
