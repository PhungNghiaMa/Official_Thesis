import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
// import { AnimationMixer } from 'three';
import { Sphere } from 'three';
import { createAnimController } from './createAnimationController';

if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 50;

export default class ThirdPersonPlayer {
  constructor(camera, scene, playerCollider, characterModel) {
    this.camera = camera;
    this.scene = scene;

    this.playerVelocity = new THREE.Vector3();
    this.playerOnFloor = false;
    this.gravity = GRAVITY;
    this.turnRateDegree = 40;
    this.turnRate = THREE.MathUtils.degToRad(this.turnRateDegree);
    this.cameraCollider = new Sphere(new THREE.Vector3(0,1,0), 0.35);

    this._capsuleWorldBox = new THREE.Box3();
    this._tmpMin = new THREE.Vector3();
    this._tmpMax = new THREE.Vector3();

    this.isRoomTourActive = false;
    this.crowdAgent = null;
    this.isNPC = false;

    // Start position inside building (adjust as needed)
    const start = new THREE.Vector3(0, 2, 0);
    this.playerCollider = playerCollider ?? new Capsule(
      start.clone(),
      start.clone().add(new THREE.Vector3(0, 1.0, 0)),
      0.35
    );

    this._smoothedPlayerPosition = new THREE.Vector3().copy(this.playerCollider.end);

    this.bvhMeshes = [];
    this.bvhReady = false;

    this.model = characterModel ?? null;
    this.mixer = null;
    this.idleAction = null;
    this.walkAction = null;
    this.leftTurnAction = null;
    this.rightTurnAction = null;
    this.runningAction = null;
    this.currentAction = null;
    this.footOffset = 0;

    this.input = { forward: false, backward: false, left: false, right: false, run:false };
    this.tempQuaternion = new THREE.Quaternion();    
    this.isTouring = false;
    this.followSide = 'right'; // 'left' or 'right';
    this.isViewingPicture = false;


    // helpers
    this.tempBox = new THREE.Box3();
    this.tempMat = new THREE.Matrix4();
    this.tempSegment = new THREE.Line3();
  }

  // Add inside ThirdPersonPlayer class
  buildBVHFromMeshes(meshes) {
    this.bvhMeshes = [];
    meshes.forEach((child) => {
      if (!child.isMesh || !child.geometry) return;
      child.updateMatrixWorld(true);
      if (!child.geometry.boundsTree) {
        child.geometry.boundsTree = new MeshBVH(child.geometry, { maxLeafTris: 10 });
      }
      child.userData.worldBox = new THREE.Box3().setFromObject(child);
      child.userData.invWorld = child.matrixWorld.clone().invert();
      this.bvhMeshes.push(child);
    });
    this.bvhReady = true;
  }

  setIsNPC(){
    this.isNPC = true;
  }


  resetControls() {
    this.input.forward = this.input.backward =
    this.input.left    = this.input.right =
    this.input.run     = false;
    this.playerVelocity.set(0, 0, 0);
    this.playerOnFloor = true; // optional, helps settle instantly
  }

  faceYaw(yaw) {
    if (!this.model) return;
    this.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    if (this.tempQuaternion) this.tempQuaternion.copy(this.model.quaternion); // keep camera smoothing aligned
  }

  // Function to handle animation when model was preloaded in index.js
  handleAnimation(model, characterGLTF) {
  if (!model || !characterGLTF) return;
  this.model = model;

  // compute footOffset as before
  const bbox = new THREE.Box3().setFromObject(this.model);
  this.footOffset = -bbox.min.y;

  // create a reusable controller and attach to model.userData
  const animCtrl = createAnimController(this.model, characterGLTF);
  this.mixer = animCtrl.mixer;
  this.idleAction    = animCtrl.idleAction;
  this.walkAction    = animCtrl.walkAction;
  this.runningAction = animCtrl.runningAction;
  this.leftTurnAction  = animCtrl.leftTurnAction;
  this.rightTurnAction = animCtrl.rightTurnAction;
  // make playAction and currentAction behavior remain local to the class (playAction already exists)
  // initialize currentAction so playAction/crossfades work:
  if (this.idleAction) {
    this.currentAction = this.idleAction;
    // ensure idle is playing
    this.currentAction.play();
  }
  // attach anim controller for external consumers (NPC sync already checks this path)
  this.model.userData.animCtrl = animCtrl;
}

  getForwardVector() {
    if (this.model) {
      const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion);
      f.y = 0;
      return f.normalize();
    }
    const v = new THREE.Vector3();
    if (this.camera) {
      this.camera.getWorldDirection(v);
      v.y = 0;
      return v.normalize();
    }
    return new THREE.Vector3(0, 0, 1);
  }

  getSideVector() {
    const f = this.getForwardVector();
    return new THREE.Vector3().copy(f).cross(new THREE.Vector3(0, 1, 0)).normalize();
  }

  playAction(action) {
    if (!action) return; // safe-guard
    action.enabled = true;
    action.paused = false;
    // If the action is already playing, do nothing to avoid redundant calls.
    if (this.currentAction === action) {
      return;
    }

    // If there's a different action currently playing, crossfade to the new one.
    if (this.currentAction) {
      this.currentAction.crossFadeTo(action, 0.5, false); // Added a crossfade duration for smoother transitions
    }

    // Play the new action.
    action.reset().play();

    // Update the current action.
    this.currentAction = action;
  }

  onKeyDown(event) {
        // *** NEW CHECK: Ignore event if an input element is focused ***
    const isInput = event.target.closest('input, textarea, select, [contenteditable="true"]');
    if (isInput) {
        return; // Exit the handler immediately if typing in a form field
    }
    switch (event.code) {
      case 'KeyW': this.input.forward = true; break;
      case 'KeyS': this.input.backward = true; break;
      case 'KeyA': this.input.left = true; break;
      case 'KeyD': this.input.right = true; break;
      case 'ShiftLeft' : this.input.run = true; break;
      case 'ShiftRight': this.input.run = true; break;
    }
  }

  onKeyUp(event) {
    switch (event.code) {
      case 'KeyW': this.input.forward = false; break;
      case 'KeyS': this.input.backward = false; break;
      case 'KeyA': this.input.left = false; break;
      case 'KeyD': this.input.right = false; break;
      case 'ShiftLeft' : this.input.run = false; break; 
      case 'ShiftRight': this.input.run = false; break;
    }
  }

  // Attach model. Optionally pass the GLTF so animations are prepared immediately.
  attachModel(model, characterGLTF = null) {
  this.model = model;
  if (characterGLTF) {
  this.handleAnimation(model, characterGLTF);
  }

  // keep smoothing aligned so there is no visual jump
  if (this.playerCollider) this._smoothedPlayerPosition.copy(this.playerCollider.end);
  if (this.tempQuaternion && this.model) this.tempQuaternion.copy(this.model.quaternion);

  // If we already have a crowd agent (created earlier), align/teleport it to the model now
  if (this.crowdAgent && this.model) {
  try {
  const p = this.model.position;
  if (typeof this.crowdAgent.teleport === 'function') {
  this.crowdAgent.teleport({ x: p.x, y: p.y, z: p.z });
  } else if (this.crowdAgent.position) {
  this.crowdAgent.position = { x: p.x, y: p.y, z: p.z };
  }
  } catch (e) {
  console.warn("attachModel: failed to align crowdAgent to model", e);
  }
  }
  }

  setInitialRotationFromYaw(yaw) {
    if (this.model) {
      // Set the player model's rotation to match the camera's yaw
      this.model.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    }
  }

  /**
   * Central animation decision logic extracted so it can be reused by NPC controllers.
   * speed: horizontal speed in world units (m/s)
   * opts: { left: bool, right: bool, run: bool }  - optional flags
   */
  updateAnimationState(speed, opts = {}) {
    const left = !!opts.left;
    const right = !!opts.right;
    const run = !!opts.run;

    // safe-guards if actions not present
    const hasIdle = !!this.idleAction;
    const hasWalk = !!this.walkAction;
    const hasRun = !!this.runningAction;
    const hasLeft = !!this.leftTurnAction;
    const hasRight = !!this.rightTurnAction;

    if (speed < 0.05) {
      // Idle
      if (hasIdle) {
        this.playAction(this.idleAction);
        if (this.currentAction) this.currentAction.timeScale = 1.0;
      }
    } else {
      // Movement
      if (run && hasRun) {
        this.runningAction.timeScale = 1.5;
        this.playAction(this.runningAction);
        if (this.currentAction) {
          this.currentAction.timeScale = 1.5;
        }
      } else if (hasWalk) {
        this.playAction(this.walkAction);
        if (this.currentAction) {
          this.currentAction.timeScale = 1.0;
        }
      }

      // Optional turn animations if nearly stationary
      if (speed < 0.2) {
        if (left && hasLeft) {
          this.playAction(this.leftTurnAction);
          if (this.currentAction) this.currentAction.timeScale = 1.3;
        } else if (right && hasRight) {
          this.playAction(this.rightTurnAction);
          if (this.currentAction) this.currentAction.timeScale = 1.0;
        }
      }
    }
  }

  /**
   * Public helper for NPC controllers:
   * npcController should call this each frame with NPC horizontal speed and flags.
   * Example: npcPlayer.setNPCAnimationState( speed, { left:false, right:false, run:false } )
   */
  setNPCAnimationState(speed, opts = {}) {
    this.updateAnimationState(speed, opts);
  }

  update(delta) {
    if (!this.bvhReady || !this.model) return;

    // --- gravity + damping (stable) ---
    if (!this.playerOnFloor) {
      this.playerVelocity.y -= this.gravity * delta;
      this.playerVelocity.multiplyScalar(Math.exp(-1.5 * delta));
    } else {
      this.playerVelocity.y = 0;
      this.playerVelocity.multiplyScalar(Math.exp(-10 * delta));
    }

    // --- input forces ---
    const baseSpeed = this.playerOnFloor ? 1 : 18;
    // Increase speed when the run button is pressed
    const finalSpeed = this.input.run ? baseSpeed * 2.5 : baseSpeed; // Adjust multiplier (2.5) for desired speed
    const speedDelta = delta * finalSpeed;

    // Use model-forward for movement
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion).setY(0).normalize();
    if (this.input.forward) {
      this.playerVelocity.addScaledVector(forward, speedDelta);
    }
    if (this.input.backward) {
      this.playerVelocity.addScaledVector(forward, -speedDelta * 0.6); // slower backwards
    }

    // --- TURNING: rotate the model AND rotate horizontal velocity so momentum follows the facing direction
    const yawAxis = new THREE.Vector3(0, 1, 0);

    if (this.input.left) {
      const yawDelta = this.turnRate * delta;
      // rotate model visually
      this.model.rotateOnWorldAxis(yawAxis, yawDelta);

      // rotate horizontal velocity vector by same yaw so momentum stays aligned to model
      const tmpVel = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(yawAxis, yawDelta);
      tmpVel.applyQuaternion(yawQuat);
      this.playerVelocity.x = tmpVel.x;
      this.playerVelocity.z = tmpVel.z;
    }

    if (this.input.right) {
      const yawDelta = -this.turnRate * delta;
      this.model.rotateOnWorldAxis(yawAxis, yawDelta);

      const tmpVel = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z);
      const yawQuat = new THREE.Quaternion().setFromAxisAngle(yawAxis, yawDelta);
      tmpVel.applyQuaternion(yawQuat);
      this.playerVelocity.x = tmpVel.x;
      this.playerVelocity.z = tmpVel.z;
    }

    // --- integrate position ---
    const deltaPos = this.playerVelocity.clone().multiplyScalar(delta);
    this.playerCollider.translate(deltaPos);

    // --- collisions (your existing shapecast; make sure it sets playerOnFloor) ---
    this.playerOnFloor = false;

    // compute world AABB of the capsule
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
    this._capsuleWorldBox.set(this._tmpMin, this._tmpMax);

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry.boundsTree;
      if (!bvh) continue;
      if (mesh.userData?.worldBox && !mesh.userData.worldBox.intersectsBox(this._capsuleWorldBox)) continue;

      this.tempBox.makeEmpty();
      this.tempMat.copy(mesh.userData.invWorld);

      this.tempSegment.copy(this.playerCollider);
      this.tempSegment.start.applyMatrix4(this.tempMat);
      this.tempSegment.end.applyMatrix4(this.tempMat);
      this.tempBox.expandByPoint(this.tempSegment.start);
      this.tempBox.expandByPoint(this.tempSegment.end);
      this.tempBox.min.addScalar(this.playerCollider.radius * -1);
      this.tempBox.max.addScalar(this.playerCollider.radius);

      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this.tempBox),
        intersectsTriangle: (tri) => {
          const triPoint = new THREE.Vector3();
          const capPoint = new THREE.Vector3();
          const dist = tri.closestPointToSegment(this.tempSegment, triPoint, capPoint);
          if (dist < this.playerCollider.radius) {
            const depth = this.playerCollider.radius - dist;
            const pushDir = capPoint.sub(triPoint).normalize();
            this.tempSegment.start.addScaledVector(pushDir, depth);
            this.tempSegment.end.addScaledVector(pushDir, depth);
            if (pushDir.y > 0.1) this.playerOnFloor = true;
          }
        }
      });

      this.playerCollider.start.copy(this.tempSegment.start).applyMatrix4(mesh.matrixWorld);
      this.playerCollider.end.copy(this.tempSegment.end).applyMatrix4(mesh.matrixWorld);
    }

    // clamp extremely small horizontal velocity to zero to avoid micro-drift
    const horiz = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
    if (horiz < 0.001) {
      this.playerVelocity.x = 0;
      this.playerVelocity.z = 0;
    }
    const smoothing = 1.0 - Math.exp(-10 * delta); // dynamic smoothing
    this._smoothedPlayerPosition.lerp(this.playerCollider.end, smoothing); // tune 0.12-0.25
    this.model.position.set(
      this._smoothedPlayerPosition.x,
      this.playerCollider.start.y - this.playerCollider.radius + this.footOffset,
      this._smoothedPlayerPosition.z
    );
    this.tempQuaternion.slerp(this.model.quaternion, 1.0 - Math.exp(-5 * delta));

    // play/pause walk (mixer is advanced once per frame in animate())
    // --- Animation state handling ---
    const speed = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z).length();

    if (!this.input.forward && !this.input.backward && !this.input.left && !this.input.right) {
      const horiz2 = Math.hypot(this.playerVelocity.x, this.playerVelocity.z);
      if (horiz2 < 0.02) { // tiny threshold to kill float error
        this.playerVelocity.x = 0;
        this.playerVelocity.z = 0;
      }
    }

    // reuse central logic
    this.updateAnimationState(speed, this.input);
  }

  // ThirdPersonPlayer.js — inside class ThirdPersonPlayer
  
  startFollowAgent(npcEntry, options = {}) {
    if (!npcEntry || !npcEntry.agent) {
      console.warn('ThirdPersonPlayer.startFollowAgent: expected npc entry with .agent and .model');
      return false;
    }

    // new options: offsetSide, followSide (string 'left'|'right'), mode ('side'|'behind')
    this._follow = {
      entry: npcEntry,
      smoothing: options.smoothing ?? 0.12,
      offsetBehind: options.offsetBehind ?? 1.0,
      offsetSide: options.offsetSide ?? 0.7,
      heightOffset: options.heightOffset ?? 0.0,
      mode: options.mode ?? 'side'
    };

    // accept either 'left'/'right' or fallback to existing state
    this.followSide = options.followSide ?? (this.followSide || 'right');

    // snap tp model to an initial follow pose (prefer a side position when mode==='side')
    if (this.model && npcEntry.model) {
      const ap = this._resolveAgentPosition(npcEntry.agent);
      if (ap) {
        const forward = npcEntry.model.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0) , forward).normalize();
        const footOffset = this.footOffset ?? (this.model.userData?.footOffset ?? 0);

        let desired = new THREE.Vector3(ap.x, ap.y + footOffset + (this._follow.heightOffset || 0), ap.z);

        if (this._follow.mode === 'side') {
          const sideMultiplier = (this.followSide === 'left') ? -1 : 1;
          desired.add(right.clone().multiplyScalar((this._follow.offsetSide || 0.7) * sideMultiplier));
          desired.add(forward.clone().multiplyScalar(- (this._follow.offsetBehind || 0.12)));
        } else {
          // legacy behind behavior
          desired.add(forward.clone().multiplyScalar(- (this._follow.offsetBehind || 1.0)));
        }

        this.model.position.copy(desired);
        this.model.quaternion.copy(npcEntry.model.quaternion);
        this._updateCapsuleToModel();
        this._cameraSnapped = false;
      }
    }

    this._follow.verticalVelocity = 0;
    return true;
  }


  stopFollowAgent() {
    this._follow = null;
    this.isTouring = false;
  }

  isTouring() {
    return this.isTouring;
  }

  // small helper: resolve agent position object -> {x,y,z}
  _resolveAgentPosition(agent) {
    if (!agent) return null;
    try {
      const p = (typeof agent.interpolatedPosition === 'function')
                ? agent.interpolatedPosition()
                : (typeof agent.position === 'function' ? agent.position() : agent.position);
      if (!p) return null;
      return { x: p.x ?? p[0], y: p.y ?? p[1], z: p.z ?? p[2] };
    } catch (e) {
      return null;
    }
  }

  // keep the player capsule aligned to the model position
  _updateCapsuleToModel() {
    if (!this.playerCollider || !this.model) return;
    const segLen = this.playerCollider.end.y - this.playerCollider.start.y;
    const bottomY = this.model.position.y + this.playerCollider.radius + 0.02;
    this.playerCollider.start.set(this.model.position.x, bottomY, this.model.position.z);
    this.playerCollider.end.set(this.model.position.x, bottomY + segLen, this.model.position.z);
    this._smoothedPlayerPosition.copy(this.playerCollider.end);
  }
  // Call this each frame if following an agent
  updateFollow(delta) {
        if (!this.crowdAgent || !this.model || !this._follow) return;

        const agentPosData = this._resolveAgentPosition(this.crowdAgent);
        if (!agentPosData) return;
        const agentPos = new THREE.Vector3(agentPosData.x, agentPosData.y, agentPosData.z);

        let vel;
        try {
            vel = this.crowdAgent.velocity ? this.crowdAgent.velocity() : null;
        } catch (e) { vel = null; }
        const vx = vel?.x ?? 0;
        const vz = vel?.z ?? 0;
        const speed = Math.hypot(vx, vz);

        let targetPos = agentPos.clone();
        if (this.bvhMeshes && this.bvhMeshes.length > 0) {
            try {
                const downRay = new THREE.Raycaster(
                    new THREE.Vector3(agentPos.x, this.model.position.y + 2.0, agentPos.z),
                    new THREE.Vector3(0, -1, 0)
                );
                const hits = downRay.intersectObjects(this.bvhMeshes, true);
                if (hits.length > 0) targetPos.y = hits[0].point.y;
            } catch (e) { /* ignore */ }
        }
        targetPos.y += this.footOffset;

        const posLerpFactor = 0.12;
        this.model.position.lerp(targetPos, posLerpFactor);
        this._updateCapsuleToModel();

        // --- HYBRID ROTATION LOGIC (The Fix) ---
        const entry = this._follow.entry;
        const isNpcIdleAtTourStop = entry?.state?.tourFacingQuat && speed < 0.1;

        if (isNpcIdleAtTourStop) {
            // This is the key change: when stopped, snap to the target rotation.
            const targetQuat = entry.state.tourFacingQuat;
            this.model.quaternion.copy(targetQuat);
        } else if (speed > 0.1) {
            // When moving, continue to smoothly rotate.
            const targetYaw = Math.atan2(vx, vz); // slight left offset for better side-follow
            const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0))
            const rotSlerpFactor = 0.3;
            this.model.quaternion.slerp(targetQuat, rotSlerpFactor);
        }

        if (this.tempQuaternion) {
          const camSlerpFactor = 0.12; // Slower smoothing for camera
          this.tempQuaternion.slerp(this.model.quaternion, camSlerpFactor);
        }

        const isRunning = speed > 2.5;
        this.updateAnimationState(speed, { run: isRunning });
    }

  setCrowdAgent(agent) {
    this.crowdAgent = agent;
  }

syncFromCrowd() {
  if (!this.crowdAgent || !this.model) return;

  // --- 1. Get Agent's Position ---
  let agentPosData;
  try {
    // Use the smoother interpolated position if available
    agentPosData = this.crowdAgent.interpolatedPosition ?? this.crowdAgent.position();
  } catch (e) {
    agentPosData = this.crowdAgent.position();
  }
  if (!agentPosData) return;

  const agentPos = new THREE.Vector3(agentPosData.x, agentPosData.y, agentPosData.z);

  // --- 2. Snap Vertically to the Visual Floor ---
  // This is crucial to prevent floating. It's the same logic used for NPCs.
  let targetPos = agentPos.clone();
  let snappedToBVH = false;

  if (this.bvhMeshes && this.bvhMeshes.length > 0) {
    try {
      const downOrigin = new THREE.Vector3(agentPos.x, agentPos.y + 2.0, agentPos.z);
      const downRay = new THREE.Raycaster(downOrigin, new THREE.Vector3(0, -1, 0));
      const hits = downRay.intersectObjects(this.bvhMeshes, true);
      if (hits && hits.length > 0) {
        targetPos.y = hits[0].point.y;
        snappedToBVH = true;
      }
    } catch (e) { /* Ignore raycast errors */ }
  }

  // If we couldn't snap to a mesh, use the agent's navmesh height as a fallback.
  if (!snappedToBVH) {
    targetPos.y = agentPos.y;
  }
  // Apply the foot offset to place the model's feet on the ground.
  targetPos.y += this.footOffset;


  // --- 3. Smoothly Apply Position to the Model ---
  // A high lerp factor makes the player feel responsive to the agent's movement.
  const posLerpFactor = 0.8;
  this.model.position.x = THREE.MathUtils.lerp(this.model.position.x, targetPos.x, posLerpFactor);
  this.model.position.z = THREE.MathUtils.lerp(this.model.position.z, targetPos.z, posLerpFactor);
  this.model.position.y = THREE.MathUtils.lerp(this.model.position.y, targetPos.y, posLerpFactor);

  // --- 4. Get Agent's Velocity for Rotation and Animation ---
  let vel;
  try {
    vel = this.crowdAgent.velocity();
  } catch (e) {
    vel = null;
  }
  const vx = vel?.x ?? 0;
  const vz = vel?.z ?? 0;
  const speed = Math.sqrt(vx * vx + vz * vz);

  // --- 5. Apply Rotation ---
  // Make the model face the direction it's moving.
  if (speed > 1e-3) {
    let targetYaw = Math.atan2(vx, vz);
    if (this.isNPC){
      targetYaw -= Math.PI/2
    }
    const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
    // Slerp for smooth turning.
    this.model.quaternion.slerp(targetQuat, 0.1);
  }

  // --- 6. Update Animation ---
  // Use the agent's speed to decide whether to play the walk or run animation.
  const isRunning = speed > (2.4 * 1.1); // A little higher than walk speed
  this.updateAnimationState(speed, { run: isRunning });
}
}

