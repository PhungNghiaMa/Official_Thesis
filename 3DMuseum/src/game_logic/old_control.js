import * as THREE from 'three';
import { Capsule } from 'three/examples/jsm/math/Capsule.js';
import { MeshBVH, MeshBVHHelper } from 'three-mesh-bvh';

export default class FirstPersonPlayer {
  constructor(camera, scene, container, playerCollider) {
    this.camera = camera;
    this.scene = scene;
    this.container = container;

    this.playerCollider = new Capsule(
      new THREE.Vector3(0, 1.0, 0),
      new THREE.Vector3(0, 2.0, 0),
      0.35
    );

    // state
    this.playerVelocity = new THREE.Vector3();
    this.playerDirection = new THREE.Vector3();
    this.playerOnFloor = false;
    this.gravity = 30;

    // keyboard state
    this.keys = { forward: false, backward: false, left: false, right: false };

    // yaw/pitch (mouse look)
    this.pitch = 0;
    this.yaw = 0;
    this.isMouseDown = false;
    this.previousMousePosition = new THREE.Vector2();

    // BVH data
    this.bvhMeshes = [];
    this.bvhHelpers = [];
  }

  buildBVH(scene) {
    scene.traverse((object) => {
      if (object.isMesh) {
        object.geometry.computeBoundsTree();
        this.bvhMeshes.push(object);
      }
    });
  }

  // --------------------------------------------------------------------
  // external key handlers  (same API as the ThirdPersonPlayer)
  // --------------------------------------------------------------------
  onKeyDown(event) {
    if (event.code === 'KeyW') this.keys.forward = true;
    if (event.code === 'KeyS') this.keys.backward = true;
    if (event.code === 'KeyA') this.keys.left = true;
    if (event.code === 'KeyD') this.keys.right = true;
  }

  onKeyUp(event) {
    if (event.code === 'KeyW') this.keys.forward = false;
    if (event.code === 'KeyS') this.keys.backward = false;
    if (event.code === 'KeyA') this.keys.left = false;
    if (event.code === 'KeyD') this.keys.right = false;
  }

  // --------------------------------------------------------------------
  // the existing mouse-look handlers can stay internally here
  // --------------------------------------------------------------------
  initMouseLook() {
    this.container.addEventListener('mousedown', (e) => {
      this.isMouseDown = true;
      this.previousMousePosition.set(e.clientX, e.clientY);
    });

    this.container.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    this.container.addEventListener('mousemove', (event) => {
      if (!this.isMouseDown) return;

      const dx = event.clientX - this.previousMousePosition.x;
      const dy = event.clientY - this.previousMousePosition.y;
      this.yaw   -= dx * 0.002;
      this.pitch -= dy * 0.002;
      this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

      this.camera.quaternion.setFromEuler(
        new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')
      );

      this.previousMousePosition.set(event.clientX, event.clientY);
    });
  }

  // --------------------------------------------------------------------
  update(delta) {
    this.playerDirection.set(0, 0, 0);

    if (this.keys.forward)  this.playerDirection.z -= 1;
    if (this.keys.backward) this.playerDirection.z += 1;
    if (this.keys.left)     this.playerDirection.x -= 1;
    if (this.keys.right)    this.playerDirection.x += 1;

    if (this.playerDirection.length() > 0) {
      this.playerDirection.normalize();
      this.playerVelocity.x = this.playerDirection.x * 6;
      this.playerVelocity.z = this.playerDirection.z * 6;
    } else {
      this.playerVelocity.x = 0;
      this.playerVelocity.z = 0;
    }

    if (!this.playerOnFloor) this.playerVelocity.y -= this.gravity * delta;

    const deltaPos = this.playerVelocity.clone().multiplyScalar(delta);
    this.playerCollider.translate(deltaPos);

    // BVH collision
    let onFloor = false;
    const start = this.playerCollider.start.clone();
    const end   = this.playerCollider.end.clone();
    const radius = this.playerCollider.radius;

    this.bvhMeshes.forEach((mesh) => {
      mesh.geometry.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsSphere(new THREE.Sphere(start, radius)),
        intersectsTriangle: (tri) => {
          const triPoint = new THREE.Vector3();
          const capPoint = new THREE.Vector3();

          const dist = tri.closestPointToSegment({ start, end }, triPoint, capPoint);
          if (dist < radius) {
            const normal = tri.getNormal(new THREE.Vector3());
            const depth = radius - dist;
            this.playerCollider.translate(normal.multiplyScalar(depth));
            if (normal.y > 0) onFloor = true;
          }
        }
      });
    });

    this.playerOnFloor = onFloor;
    if (onFloor) this.playerVelocity.y = 0;

    // update camera position to collider
    this.camera.position.copy(this.playerCollider.end);
  }

  dispose() {
    this.collisionMeshes = [];
    this.bvhReady = false;
  }
}
