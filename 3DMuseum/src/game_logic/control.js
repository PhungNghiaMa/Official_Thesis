import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 30;

// Movement tuning
const FP_BASE_SPEED = 9;        // walk speed
const FP_AIR_BASE_SPEED = 3.5;  // air control speed
const FP_RUN_MULTIPLIER = 2.0;  // run multiplier
const FP_BACKWARD_MULT = 0.6;   // backward slower

// Damping
const FP_DAMPING_GROUND = 8;
const FP_DAMPING_AIR = 0.4;

// Steering
const STEER_SPEED = 6.0;

// Physics timestep
const PHYSICS_DT = 1 / 60;
const MAX_ACCUM = 0.25;

// Camera smoothing
const LERP_POS = 0.05;   // like TP
const SLERP_ROT = 0.04;

export default class FirstPersonPlayer {
  constructor(camera, scene, playerCollider) {
    this.camera = camera;
    this.scene = scene;

    // orientation
    this.baseYaw = 0;
    this.yawOffset = 0;
    this.targetYawOffset = 0;
    this.pitch = 0;
    this.turnRate = THREE.MathUtils.degToRad(60);

    // collider
    const start = new THREE.Vector3(0, 1.0, 0);
    this.playerCollider = playerCollider ?? new Capsule(
      start.clone(),
      start.clone().add(new THREE.Vector3(0, 1.0, 0)),
      0.35
    );

    this.playerVelocity = new THREE.Vector3();
    this.playerOnFloor = false;

    this.input = { forward: false, backward: false, left: false, right: false, run: false };

    this.bvhMeshes = [];
    this.bvhReady = false;

    this._accumulator = 0;
    this._cameraSnapped = false;

    this._capsuleBox = new THREE.Box3();
    this._tmpMin = new THREE.Vector3();
    this._tmpMax = new THREE.Vector3();


    // temps
    this._forward = new THREE.Vector3();
    this._tempBox = new THREE.Box3();
    this._tempMat = new THREE.Matrix4();
    this._tempSegment = new THREE.Line3();
    this._triPoint = new THREE.Vector3();
    this._capPoint = new THREE.Vector3();
    this._quatPitch = new THREE.Quaternion();
    this._horizVel = new THREE.Vector3();
    this._orientQuat = new THREE.Quaternion();
  }

  buildBVH(target) {
    const meshes = [];
    target.traverse(c => {
      if (c.isMesh && c.geometry) {
        if (!c.geometry.boundsTree) {
          c.updateMatrixWorld(true);
          c.geometry.boundsTree = new MeshBVH(c.geometry, { maxLeafTris: 10 });
        }
        c.userData.worldBox = new THREE.Box3().setFromObject(c);
        c.userData.invWorld = c.matrixWorld.clone().invert();
        meshes.push(c);
      }
    });
    this.bvhMeshes = meshes;
    this.bvhReady = true;
  }

  onKeyDown(e) {
    if (e.code === 'KeyW') this.input.forward = true;
    if (e.code === 'KeyS') this.input.backward = true;
    if (e.code === 'KeyA') this.input.left = true;
    if (e.code === 'KeyD') this.input.right = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.input.run = true;
  }

  onKeyUp(e) {
    if (e.code === 'KeyW') this.input.forward = false;
    if (e.code === 'KeyS') this.input.backward = false;
    if (e.code === 'KeyA') this.input.left = false;
    if (e.code === 'KeyD') this.input.right = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.input.run = false;
  }

  setYaw(y) { this.baseYaw = y; this.yawOffset = 0; this.targetYawOffset = 0; }
  setPitch(p){ this.pitch = THREE.MathUtils.clamp(p, -1.2, 0.8); }

  update(frameDelta, yawFromMouse = null, pitchFromMouse = null) {
    if (!this.bvhReady) return;

    frameDelta = Math.min(frameDelta, MAX_ACCUM);

    if (yawFromMouse !== null) this.baseYaw = yawFromMouse;
    if (pitchFromMouse !== null) this.setPitch(pitchFromMouse);

    this._accumulator += frameDelta;
    while (this._accumulator >= PHYSICS_DT) {
      this._physicsStep(PHYSICS_DT);
      this._accumulator -= PHYSICS_DT;
    }

    // --- Camera smoothing with arc-like motion ---
    const head = this.playerCollider.end;

    // Offset camera slightly behind head, creates arc swing
    const camOffset = new THREE.Vector3(0, 0.1, -0.2).applyQuaternion(this._orientQuat);
    const finalPos = head.clone().add(camOffset);

    if (!this._cameraSnapped) {
      this.camera.position.copy(finalPos);
      this._cameraSnapped = true;
    } else {
      this.camera.position.lerp(finalPos, LERP_POS);
    }

    // smooth look direction
    const lookAtPoint = head.clone().add(new THREE.Vector3(0, 0.1, 1).applyQuaternion(this._orientQuat));
    const targetQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(this.camera.position, lookAtPoint, this.camera.up)
    );
    this.camera.quaternion.slerp(targetQuaternion, SLERP_ROT);
  }

  _physicsStep(dt) {
    // yaw offset turning
    let turnDelta = 0;
    if (this.input.left)  turnDelta += this.turnRate * dt;
    if (this.input.right) turnDelta -= this.turnRate * dt;
    this.targetYawOffset += turnDelta;

    // smooth yaw offset
    const yawAlpha = 1 - Math.exp(-10 * dt);
    this.yawOffset = THREE.MathUtils.lerp(this.yawOffset, this.targetYawOffset, yawAlpha);

    const yaw = this.baseYaw + this.yawOffset;
    this._orientQuat.setFromAxisAngle(new THREE.Vector3(0,1,0), yaw);

    // gravity & damping
    if (!this.playerOnFloor) {
      this.playerVelocity.y -= GRAVITY * dt;
      this.playerVelocity.multiplyScalar(Math.exp(-FP_DAMPING_AIR * dt));
    } else {
      this.playerVelocity.y = Math.min(0, this.playerVelocity.y);
      this.playerVelocity.multiplyScalar(Math.exp(-FP_DAMPING_GROUND * dt));
    }

    // input forces
    const baseSpeed = this.playerOnFloor ? FP_BASE_SPEED : FP_AIR_BASE_SPEED;
    const finalSpeed = this.input.run ? baseSpeed * FP_RUN_MULTIPLIER : baseSpeed;
    const speedDelta = finalSpeed * dt;

    // ✅ fixed forward direction (W forward, S backward)
    this._forward.set(0, 0, 1).applyQuaternion(this._orientQuat).setY(0).normalize();

    if (this.input.forward)  this.playerVelocity.addScaledVector(this._forward, speedDelta);
    if (this.input.backward) this.playerVelocity.addScaledVector(this._forward, -speedDelta * FP_BACKWARD_MULT);

    // steering
    this._horizVel.set(this.playerVelocity.x, 0, this.playerVelocity.z);
    const speedHoriz = this._horizVel.length();
    if (speedHoriz > 1e-5) {
      const currentDir = this._horizVel.clone().divideScalar(speedHoriz);
      const steerAlpha = 1 - Math.exp(-STEER_SPEED * dt);
      currentDir.lerp(this._forward, steerAlpha).normalize();
      this._horizVel.copy(currentDir).multiplyScalar(speedHoriz);
      this.playerVelocity.x = this._horizVel.x;
      this.playerVelocity.z = this._horizVel.z;
    }

    // integrate
    const deltaPos = this.playerVelocity.clone().multiplyScalar(dt);
    this.playerCollider.translate(deltaPos);

    // collisions
    this.playerOnFloor = false;

    // capsule world AABB
    this._tmpMin.set(
      Math.min(this.playerCollider.start.x, this.playerCollider.end.x) - this.playerCollider.radius,
      Math.min(this.playerCollider.start.y, this.playerCollider.end.y) - this.playerCollider.radius,
      Math.min(this.playerCollider.start.z, this.playerCollider.end.z) - this.playerCollider.radius
    );
    this._tmpMax.set(
      Math.max(this.playerCollider.start.x, this.playerCollider.end.x) + this.playerCollider.radius,
      Math.max(this.playerCollider.start.y, this.playerCollider.end.y) + this.playerCollider.radius,
      Math.max(this.playerCollider.start.z, this.playerCollider.end.z) + this.playerCollider.radius
    );
    this._capsuleBox.set(this._tmpMin, this._tmpMax);

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry.boundsTree;
      if (!bvh) continue;
      if (mesh.userData?.worldBox && !mesh.userData.worldBox.intersectsBox(this._capsuleBox)) continue;

      this._tempMat.copy(mesh.userData.invWorld);
      this._tempSegment.start.copy(this.playerCollider.start).applyMatrix4(this._tempMat);
      this._tempSegment.end.copy(this.playerCollider.end).applyMatrix4(this._tempMat);

      this._tempBox.makeEmpty();
      this._tempBox.expandByPoint(this._tempSegment.start);
      this._tempBox.expandByPoint(this._tempSegment.end);
      this._tempBox.min.addScalar(-this.playerCollider.radius);
      this._tempBox.max.addScalar(this.playerCollider.radius);

      bvh.shapecast({
        intersectsBounds: box => box.intersectsBox(this._tempBox),
        intersectsTriangle: tri => {
          const dist = tri.closestPointToSegment(this._tempSegment, this._triPoint, this._capPoint);
          if (dist < this.playerCollider.radius) {
            const depth = this.playerCollider.radius - dist;
            const pushDir = this._capPoint.sub(this._triPoint).normalize();
            this._tempSegment.start.addScaledVector(pushDir, depth);
            this._tempSegment.end.addScaledVector(pushDir, depth);
            if (pushDir.y > 0.1) this.playerOnFloor = true;
          }
        }
      });

      this.playerCollider.start.copy(this._tempSegment.start).applyMatrix4(mesh.matrixWorld);
      this.playerCollider.end.copy(this._tempSegment.end).applyMatrix4(mesh.matrixWorld);
    }
  }

  getPlayerPosition() {
    return this.playerCollider?.end?.clone() ?? new THREE.Vector3();
  }

  dispose() {
    this.bvhMeshes = null;
  }
}
