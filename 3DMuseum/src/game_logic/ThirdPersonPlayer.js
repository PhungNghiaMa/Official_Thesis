import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationMixer } from 'three';
import { Sphere } from 'three';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 30;

export default class ThirdPersonPlayer {
  constructor(camera, scene, container, playerCollider, characterModel, mixer) {
    this.camera = camera;
    this.scene = scene;
    this.container = container;

    this.playerVelocity = new THREE.Vector3();
    this.playerOnFloor = false;
    this.gravity = GRAVITY;
    this.turnRateDegree = 90;
    this.turnRate = THREE.MathUtils.degToRad(this.turnRateDegree);
    this.cameraCollider = new Sphere(new THREE.Vector3(0,1,0), 0.35);


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

  // Backup function in the case that index.js fail to load character model
  loadModel(url, DracoLoader, KTX2Loader, renderer) {
    const loader = new GLTFLoader();
    loader.setDRACOLoader(DracoLoader);
    loader.setKTX2Loader(KTX2Loader);

    loader.load(url, (gltf) => {
      this.model = gltf.scene;
      this.model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
        if (child.material && child.material.map) {
          child.material.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          child.material.map.colorSpace = THREE.SRGBColorSpace;
          child.material.map.needsUpdate = true;
        }
      });
      // this.scene.add(this.model);

      const bbox = new THREE.Box3().setFromObject(this.model);
      this.footOffset = -bbox.min.y;

      this.mixer = new AnimationMixer(this.model);
      if (gltf.animations && gltf.animations.length > 0) {
        gltf.animations.forEach((clip) =>{
          console.log(clip.name)
          clip.tracks = clip.tracks.filter(track => {
            // Keep rotations/scales, drop positions on the root
            // Usually root is "mixamorigHips" or similar
            return !track.name.endsWith('.position');
          });
          switch (clip.name){
            case "Idle":
              this.idleAction = this.mixer.clipAction(clip);
              break;
            case "WalkForward":
              this.walkAction = this.mixer.clipAction(clip);
              break;
            case "Running":
              this.runningAction = this.mixer.clipAction(clip);
              break;
            case "LeftTurn":
              this.leftTurnAction = this.mixer.clipAction(clip);
              break;
            case "RightTurn":
              this.rightTurnAction = this.mixer.clipAction(clip);
              break;
            default:
              break;    
          }
        })
        if (this.idleAction){
          this.idleAction.play();
          this.currentAction = this.idleAction;
        }
      }
    });
  }


  // Function to handle animation
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
    this.camera.getWorldDirection(v);
    v.y = 0;
    return v.normalize();
  }

  getSideVector() {
    const f = this.getForwardVector();
    return new THREE.Vector3().copy(f).cross(new THREE.Vector3(0, 1, 0)).normalize();
  }

  playAction(action) {
    if (action && this.currentAction !== action) {
      if (this.currentAction) this.currentAction.crossFadeTo(action, 0.2, false);
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

  attachModel(model){
    this.model = model;
  }

  update(delta) {
    if (!this.bvhReady || !this.model) return;

    // --- gravity + damping (stable) ---
    if (!this.playerOnFloor) {
      this.playerVelocity.y -= this.gravity * delta;
      this.playerVelocity.multiplyScalar(Math.exp(-0.4 * delta));
    } else {
      this.playerVelocity.y = 0;
      this.playerVelocity.multiplyScalar(Math.exp(-8 * delta));
    }

    // --- input forces ---
        const baseSpeed = this.playerOnFloor ? 15 : 8;
    // ✅ FIX: Increase speed when the run button is pressed
    const finalSpeed = this.input.run ? baseSpeed * 2.5 : baseSpeed; // Adjust multiplier (2.5) for desired speed
    const speedDelta = delta * finalSpeed;

    // ✅ FIX: Use the camera's direction for movement input
    const tempCamVector = new THREE.Vector3();
    this.camera.getWorldDirection(tempCamVector);
    tempCamVector.y = 0;
    const cameraForward = tempCamVector.normalize();

    // const cameraSide = new THREE.Vector3().copy(cameraForward).cross(new THREE.Vector3(0, 1, 0)).normalize();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.model.quaternion).setY(0).normalize();
    if (this.input.forward) {
      this.playerVelocity.addScaledVector(forward, speedDelta);
    }
    if (this.input.backward) {
      this.playerVelocity.addScaledVector(forward, -speedDelta * 0.6); // slower backwards
    }

    // --- Rotation while moving ---
    // (so pressing A/D curves movement into an arc)
    if (this.input.left) {
      this.model.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), this.turnRate * delta);
    }
    if (this.input.right) {
      this.model.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -this.turnRate * delta);
    }

    // --- integrate position ---
    const deltaPos = this.playerVelocity.clone().multiplyScalar(delta);
    this.playerCollider.translate(deltaPos);

    // --- collisions (your existing shapecast; make sure it sets playerOnFloor) ---
    this.playerOnFloor = false;
    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry.boundsTree;
      if (!bvh) continue;

      this.tempBox.makeEmpty();
      this.tempMat.copy(mesh.matrixWorld).invert();
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

    // --- update model transform ---
    this.model.position.set(
      this.playerCollider.end.x,
      // this.playerCollider.start.y + this.footOffset,
      this.playerCollider.start.y - this.playerCollider.radius + this.footOffset,
      this.playerCollider.end.z
    );

    // play/pause walk (mixer is advanced once per frame in animate())
    // --- Animation state handling ---
    const speed = new THREE.Vector3(this.playerVelocity.x, 0, this.playerVelocity.z).length();

    if (speed < 0.05) {
      // --- IDLE ---
      this.playAction(this.idleAction);
      if (this.currentAction) this.currentAction.timeScale = 1.0;

    } else {
      // --- MOVEMENT ---
      if (this.input.run && this.runningAction) {
        // RUNNING
        this.runningAction.timeScale = 1.5;
        this.playAction(this.runningAction);
        if (this.currentAction) {
          // Faster playback if moving faster
          this.currentAction.timeScale = 1.5;
        }

      } else if (this.walkAction) {
        // WALKING
        this.playAction(this.walkAction);
        if (this.currentAction) {
          // Walk animation syncs to speed
          this.currentAction.timeScale = 1.2
        }
      }

      // --- OPTIONAL TURN ANIMS (play only if no forward/back movement) ---
      if (speed < 0.2) {
        if (this.input.left && this.leftTurnAction) {
          this.playAction(this.leftTurnAction);
          if (this.currentAction) this.currentAction.timeScale = 1.0;
        } else if (this.input.right && this.rightTurnAction) {
          this.playAction(this.rightTurnAction);
          if (this.currentAction) this.currentAction.timeScale = 1.0;
        }
      }
    }

  }

}
