import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 30;

// Movement tuning
const FP_BASE_SPEED = 10;        // walk speed
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
    this.turnRate = THREE.MathUtils.degToRad(90);

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

    // agents & room tour
    this.followAgent = null;
    this.isTouring = false;
  }

  setYaw(yaw){
    this.yaw = yaw;
  }

  setPitch(pitch){
    this.pitch = pitch;
  }

  buildBVHFromMeshes(meshes) {
    this.bvhMeshes = [];
    meshes.forEach((c) => {
      if (!c.isMesh || !c.geometry) return;
      c.updateMatrixWorld(true);
      if (!c.geometry.boundsTree) {
        c.geometry.boundsTree = new MeshBVH(c.geometry, { maxLeafTris: 10 });
      }
      c.userData.worldBox = new THREE.Box3().setFromObject(c);
      c.userData.invWorld = c.matrixWorld.clone().invert();
      this.bvhMeshes.push(c);
    });
    this.bvhReady = true;
  }

  onKeyDown(e) {
    const isInput = e.target.closest('input, textarea, select, [contenteditable="true"]');
    if (isInput) return; // <-- NEW: Stop processing if an input field has focus
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

  // add inside the class
  resetControls() {
    this.input.forward = this.input.backward =
    this.input.left    = this.input.right =
    this.input.run     = false;
    this.playerVelocity.set(0, 0, 0);
    this.playerOnFloor = true;
  }


  update(frameDelta, yawFromMouse = null, pitchFromMouse = null) {
    if (!this.bvhReady) return;

    frameDelta = Math.min(frameDelta, MAX_ACCUM);
    
    if (this.isTouring && this.followAgent) {
        const npcEntry = this.followAgent;
        if (!npcEntry.model || !npcEntry.agent) return;

        let finalNpcPos = new THREE.Vector3();

        try {
            // ✅ LAG & JITTER FIX: This is the definitive solution.
            // 1. Get the SMOOTH, interpolated position from the navigation agent for X and Z.
            const agentData = (typeof npcEntry.agent.interpolatedPosition === 'function')
                ? npcEntry.agent.interpolatedPosition()
                : npcEntry.agent.position();
            
            // 2. Get the STABLE, floor-snapped position from the visible model for Y.
            const modelY = npcEntry.model.position.y;

            // 3. Combine them into a single, perfect source of truth.
            finalNpcPos.set(
                agentData.x ?? agentData[0],
                modelY, // Using the model's Y prevents jitter.
                agentData.z ?? agentData[2] // Using the agent's X/Z prevents lag.
            );

        } catch (e) {
            // Fallback to model position if agent fails for any reason.
            npcEntry.model.getWorldPosition(finalNpcPos);
        }

        const FOLLOW_DISTANCE = 2.5;
        const EYE_HEIGHT = 1.7;

        // --- Camera smoothing / follow tuning (module-level) ---
        const CAMERA_SMOOTHING_TIME = 0.5; // seconds to "approach" the target (smaller = snappier)
        const CAMERA_ELEVATION_MULT = 1.08; // slight lift so camera is above NPC head

        // persistent smoothing state on `this` so it's preserved across frames (do not recreate each frame)
        if (!this.cameraSmoothState) {
          this.cameraSmoothState = {
            lastTime: (typeof performance !== "undefined") ? performance.now() / 1000 : Date.now() / 1000,
            lastPos: new THREE.Vector3(),
            lastQuat: new THREE.Quaternion(),
            lastLook: new THREE.Vector3(),
            movingTimer: 0,
            stoppedTimer: 0
          };
        }
        const cameraSmoothState = this.cameraSmoothState;

        // --- robust world-forward and movement direction preference ---
        // We prefer the agent movement direction when moving so the camera remains *behind*
        // the NPC (relative to motion). If agent is stationary, fall back to model forward.
        const npcForward = new THREE.Vector3(0, 0, -1);
        try {
          const q = new THREE.Quaternion();
          npcEntry.model.getWorldQuaternion(q);
          npcForward.set(0, 0, -1).applyQuaternion(q);
          npcForward.y = 0;
          if (npcForward.lengthSq() < 1e-6) npcForward.set(0, 0, -1);
          npcForward.normalize();
        } catch (e) {
          npcForward.set(0, 0, -1);
        }

        // compute movement direction from agent velocity (if available)
        const moveDir = new THREE.Vector3();
        let moveSpeed = 0;
        try {
          const vel = npcEntry.agent?.velocity ?? (typeof npcEntry.agent.getVelocity === 'function' ? npcEntry.agent.getVelocity() : null);
          if (vel) {
            // velocity might be a Vector3-like or plain object
            const vx = vel.x ?? vel[0] ?? 0;
            const vz = vel.z ?? vel[2] ?? 0;
            moveDir.set(vx, 0, vz);
            moveSpeed = moveDir.length();
            if (moveSpeed > 1e-6) moveDir.normalize();
          }
        } catch (e) {
          moveDir.set(0, 0, 0);
          moveSpeed = 0;
        }

        // choose preferred forward: movement direction when moving, otherwise model-forward
        const preferredForward = (moveSpeed > 0.05) ? moveDir.clone() : npcForward.clone();

        // ------------- compute desired camera position & look target -------------
        const desiredPos = new THREE.Vector3();
        const desiredLook = new THREE.Vector3();

        // baseline: camera behind NPC head (use negative of preferredForward to sit behind)
        const headPos = finalNpcPos.clone().add(new THREE.Vector3(0, EYE_HEIGHT, 0));
        const behindOffset = preferredForward.clone().multiplyScalar(FOLLOW_DISTANCE);
        // fallback if preferredForward is degenerate
        if (behindOffset.lengthSq() < 1e-6) behindOffset.set(0, 0, -FOLLOW_DISTANCE);
        desiredPos.copy(headPos).add(behindOffset);

        // If at a picture: compute third-person "behind NPC, looking at picture center (level)" view
        if (npcEntry.state?.atDestination && npcEntry.state.currentPictureMesh) {
          const pic = npcEntry.state.currentPictureMesh;
          try { pic.updateMatrixWorld(true); } catch (e) {}

          // robust world-space picture center
          const picCenter = new THREE.Vector3();
          try { pic.getWorldPosition(picCenter); } catch {
            const box = new THREE.Box3().setFromObject(pic);
            box.getCenter(picCenter);
          }

          // horizontal direction from NPC to the picture (used to position the camera behind the NPC
          // relative to the picture, so the camera faces the picture straight-on)
          const toPic = picCenter.clone().sub(finalNpcPos);
          toPic.y = 0;
          if (toPic.lengthSq() < 1e-6) toPic.set(0, 0, 1);
          toPic.normalize();

          // Camera should sit behind NPC relative to the picture:
          const camOffset = toPic.clone().multiplyScalar(-FOLLOW_DISTANCE);
          desiredPos.copy(finalNpcPos)
            .add(new THREE.Vector3(0, EYE_HEIGHT * CAMERA_ELEVATION_MULT, 0))
            .add(camOffset);

          // Look at the picture center but keep camera level with desiredPos Y to avoid vertical tilt
          desiredLook.copy(picCenter);
          desiredLook.y = desiredPos.y;
        }

        // ------------------ smoothing (exponential lerp by wall-clock dt) ------------------
        const now_t = (typeof performance !== "undefined") ? performance.now() / 1000 : Date.now() / 1000;
        const dt = Math.max(0.0001, now_t - (cameraSmoothState.lastTime || now_t));
        cameraSmoothState.lastTime = now_t;

        // detect motion and adapt smoothing (faster when moving, slower when idle)
        let isMoving = false;
        try {
          const vel = npcEntry.agent?.velocity ?? (typeof npcEntry.agent.getVelocity === 'function' ? npcEntry.agent.getVelocity() : null);
          if (vel) {
            const speed = (typeof vel.lengthSq === 'function') ? Math.sqrt(vel.lengthSq()) : (vel.x ? Math.hypot(vel.x, vel.y ?? 0, vel.z) : 0);
            isMoving = speed > 0.05;
          }
        } catch (e) { isMoving = false; }

        // timers for easing
        if (isMoving) {
          cameraSmoothState.movingTimer += dt;
          cameraSmoothState.stoppedTimer = 0;
        } else {
          cameraSmoothState.stoppedTimer += dt;
          cameraSmoothState.movingTimer = 0;
        }

        // smoothing time constant (tau) adapts with movement; when idle we want slower -> larger tau
        const BASE_TAU = CAMERA_SMOOTHING_TIME;
        const moveBlend = Math.min(1, cameraSmoothState.movingTimer / 0.8);
        const stopBlend = Math.min(1, cameraSmoothState.stoppedTimer / 0.8);
        const anticipation = isMoving ? moveBlend : stopBlend;
        const tau = THREE.MathUtils.lerp(BASE_TAU * 2.5, BASE_TAU * 0.6, anticipation);
        const alpha = 1 - Math.exp(-dt / Math.max(1e-6, tau));

        // init persistent state on first frame
        if (cameraSmoothState.lastPos.lengthSq() === 0) cameraSmoothState.lastPos.copy(desiredPos);
        if (cameraSmoothState.lastQuat.w === 0) {
          const initQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(cameraSmoothState.lastPos, desiredLook, this.camera.up));
          cameraSmoothState.lastQuat.copy(initQuat);
        }
        if (cameraSmoothState.lastLook.lengthSq() === 0) cameraSmoothState.lastLook.copy(desiredLook);

        // lerp camera position
        cameraSmoothState.lastPos.lerp(desiredPos, alpha);
        cameraSmoothState.lastLook.lerp(desiredLook, alpha);

        // compute target quaternion looking from the smoothed position to the smoothed look target
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().lookAt(cameraSmoothState.lastPos, cameraSmoothState.lastLook, this.camera.up)
        );

        // slerp rate: make rotation a bit slower than position for cinematic feel
        const slerpRate = THREE.MathUtils.lerp(0.04, 0.14, anticipation);
        cameraSmoothState.lastQuat.slerp(targetQuat, slerpRate);

        // apply to camera
        this.camera.position.copy(cameraSmoothState.lastPos);
        this.camera.quaternion.copy(cameraSmoothState.lastQuat);

        // done: keep first-person logic from running
    }
   
      // Original physics step logic for manual player control

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

  setFollowAgent(npcEntry) {
    this.followAgent = npcEntry;
    this.isTouring = true;

    // Sync collider immediately to NPC position
    if (npcEntry?.model) {
      const pos = new THREE.Vector3();
      npcEntry.model.getWorldPosition(pos);

      this.playerCollider.start.copy(pos).add(new THREE.Vector3(0, 0.2, 0));
      this.playerCollider.end.copy(pos).add(new THREE.Vector3(0, 1.6, 0));
    }

    // Reset velocity to avoid drifting
    this.playerVelocity.set(0, 0, 0);
  }


  stopFollowAgent(){
    this.followAgent = null;
    this.isTouring = false;
  }

}

