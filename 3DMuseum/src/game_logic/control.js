import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';

// Enable the accelerated raycasting for all meshes
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const GRAVITY = 30;

export default class FirstPersonPlayer {
  constructor(camera, scene, container = document, playerCollider = null) {
    this.camera = camera;
    this.scene = scene;
    this.container = container || document;

    this.keys = {};

    this.playerCollider = playerCollider
      ? playerCollider
      : new Capsule(
          new THREE.Vector3(0, 0.35, 0),
          new THREE.Vector3(0, 1.0, 0),
          0.35
        );

    this.playerVelocity = new THREE.Vector3();
    this.playerDirection = new THREE.Vector3();
    this.onFloor = false;

    this.tempBox = new THREE.Box3();
    this.tempMat = new THREE.Matrix4();
    this.tempSegment = new THREE.Line3();
    this.tempVector = new THREE.Vector3();

    this.collisionMeshes = [];
    this.bvhReady = false;

    this.pitch = 0;
    this.yaw = 0;

    this.isMouseDown = false;
    this.previousMousePosition = { x: 0, y: 0 };

    this._initInputHandlers();
  }

  buildBVH(scene) {
    this.collisionMeshes = [];
    scene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        child.updateMatrixWorld(true);
        // This is the correct way to build the BVH
        child.geometry.boundsTree = new MeshBVH(child.geometry, { maxLeafTris: 10 });
        this.collisionMeshes.push(child);
      }
    });
    this.bvhReady = true;
    console.log('[FirstPersonPlayer] BVH built for', this.collisionMeshes.length, 'meshes');
  }

  onKeyDown(event) {
    this.keys[event.code] = true;
  }

  onKeyUp(event) {
    this.keys[event.code] = false;
  }

  update(deltaTime) {
    if (!this.bvhReady) return;

    let damping = Math.exp(-4 * deltaTime) - 1;
    if (!this.onFloor) {
      this.playerVelocity.y -= GRAVITY * deltaTime;
      damping *= 0.1;
    } else {
      this.playerVelocity.y = 0;
    }

    this.playerVelocity.addScaledVector(this.playerVelocity, damping);

    const speedDelta = deltaTime * (this.onFloor ? 25 : 8);

    if (this.keys['KeyW']) {
      this.playerVelocity.add(this.getForwardVector().multiplyScalar(speedDelta));
    }
    if (this.keys['KeyS']) {
      this.playerVelocity.add(this.getForwardVector().multiplyScalar(-speedDelta));
    }
    if (this.keys['KeyA']) {
      this.playerVelocity.add(this.getSideVector().multiplyScalar(-speedDelta));
    }
    if (this.keys['KeyD']) {
      this.playerVelocity.add(this.getSideVector().multiplyScalar(speedDelta));
    }

    const deltaPosition = this.playerVelocity.clone().multiplyScalar(deltaTime);
    this.playerCollider.translate(deltaPosition);

    this.onFloor = false;
    for (const mesh of this.collisionMeshes) {
      const bvh = mesh.geometry.boundsTree;
      this.tempBox.makeEmpty();
      this.tempMat.copy(mesh.matrixWorld).invert();
      this.tempSegment.copy(this.playerCollider);

      this.tempSegment.start.applyMatrix4(this.tempMat);
      this.tempSegment.end.applyMatrix4(this.tempMat);
      this.tempBox.expandByPoint(this.tempSegment.start);
      this.tempBox.expandByPoint(this.tempSegment.end);
      this.tempBox.min.addScalar(-this.playerCollider.radius);
      this.tempBox.max.addScalar(this.playerCollider.radius);

      bvh.shapecast({
        intersectsBounds: box => box.intersectsBox(this.tempBox),
        intersectsTriangle: tri => {
          const triPoint = this.tempVector;
          const capsulePoint = this.tempVector.clone();

          const distance = tri.closestPointToSegment(this.tempSegment, triPoint, capsulePoint);
          if (distance < this.playerCollider.radius) {
            const depth = this.playerCollider.radius - distance;
            const direction = capsulePoint.sub(triPoint).normalize();

            this.tempSegment.start.addScaledVector(direction, depth);
            this.tempSegment.end.addScaledVector(direction, depth);

            if (direction.dot(new THREE.Vector3(0, 1, 0)) > 0.5) {
              this.onFloor = true;
            }
          }
        }
      });

      this.playerCollider.start.copy(this.tempSegment.start).applyMatrix4(mesh.matrixWorld);
      this.playerCollider.end.copy(this.tempSegment.end).applyMatrix4(mesh.matrixWorld);
    }

    this.camera.position.copy(this.playerCollider.end);
  }

  getForwardVector() {
    this.camera.getWorldDirection(this.playerDirection);
    this.playerDirection.y = 0;
    this.playerDirection.normalize();
    return this.playerDirection.clone();
  }

  getSideVector() {
    this.camera.getWorldDirection(this.playerDirection);
    this.playerDirection.y = 0;
    this.playerDirection.normalize();
    this.playerDirection.cross(this.camera.up);
    this.playerDirection.normalize();
    return this.playerDirection.clone();
  }

  _initInputHandlers() {
    this.container.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.container.addEventListener('keyup', (event) => this.onKeyUp(event));

    this.container.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.previousMousePosition.x = e.clientX;
      this.previousMousePosition.y = e.clientY;
    });

    this.container.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    this.container.addEventListener('mousemove', (event) => {
      if (!this.isMouseDown) return;

      const deltaX = event.clientX - this.previousMousePosition.x;
      const deltaY = event.clientY - this.previousMousePosition.y;

      this.yaw -= deltaX * 0.002;
      this.pitch -= deltaY * 0.002;
      this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

      this.previousMousePosition.x = event.clientX;
      this.previousMousePosition.y = event.clientY;
    });
  }

  dispose() {
    this.collisionMeshes = [];
    this.bvhReady = false;
  }
}