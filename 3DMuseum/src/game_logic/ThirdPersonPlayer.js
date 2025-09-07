import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { AnimationMixer } from 'three';
import { Sphere } from 'three';

if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 30;

export default class ThirdPersonPlayer {
  constructor(camera, scene, playerCollider, characterModel) {
    this.camera = camera;
    this.scene = scene;

    this.playerVelocity = new THREE.Vector3();
    this.playerOnFloor = false;
    this.gravity = GRAVITY;
    this.turnRateDegree = 50;
    this.turnRate = THREE.MathUtils.degToRad(this.turnRateDegree);
    this.cameraCollider = new Sphere(new THREE.Vector3(0,1,0), 0.35);

    this._capsuleWorldBox = new THREE.Box3();
    this._tmpMin = new THREE.Vector3();
    this._tmpMax = new THREE.Vector3();

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

    // helpers
    this.tempBox = new THREE.Box3();
    this.tempMat = new THREE.Matrix4();
    this.tempSegment = new THREE.Line3();
  }

  // buildBVH(scene) {
  //   this.bvhMeshes = [];
  //   scene.traverse((child) => {
  //     if (child.isMesh && child.geometry) {
  //       child.updateMatrixWorld(true);
  //       if (!child.geometry.boundsTree) {
  //         child.geometry.boundsTree = new MeshBVH(child.geometry, { maxLeafTris: 10 });
  //       }
  //       // cache static world AABB and inverse world matrix
  //       child.userData.worldBox = new THREE.Box3().setFromObject(child);
  //       child.userData.invWorld = child.matrixWorld.clone().invert();

  //       this.bvhMeshes.push(child);
  //     }
  //   });
  //   this.bvhReady = true;
  // }

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

    // ensure the character can cast/receive shadow
    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // compute how much we must lift the model so feet = y:0 in model space
    const bbox = new THREE.Box3().setFromObject(this.model);
    this.footOffset = -bbox.min.y;

    // mixer & clips
    if (!this.mixer) this.mixer = new AnimationMixer(this.model);

    if (characterGLTF.animations && characterGLTF.animations.length > 0) {
      characterGLTF.animations.forEach((clip) => {
        // prevent root translation from yanking us around
        clip.tracks = clip.tracks.filter(track => !track.name.endsWith('.position'));

        switch (clip.name) {
          case 'Idle':         this.idleAction = this.mixer.clipAction(clip); break;
          case 'WalkForward':  this.walkAction = this.mixer.clipAction(clip); break;
          case 'Running':      this.runningAction = this.mixer.clipAction(clip); break;
          case 'LeftTurn':     this.leftTurnAction = this.mixer.clipAction(clip); break;
          case 'RightTurn':    this.rightTurnAction = this.mixer.clipAction(clip); break;
          default: break;
        }
      });

      if (this.idleAction) {
        this.idleAction.play();
        this.currentAction = this.idleAction;
      }
    }
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
  attachModel(model, characterGLTF = null){
    this.model = model;
    if (characterGLTF) {
      this.handleAnimation(model, characterGLTF);
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

}
