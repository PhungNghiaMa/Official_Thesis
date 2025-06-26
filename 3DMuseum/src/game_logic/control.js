import * as THREE from 'three';
import { Capsule } from "three/examples/jsm/math/Capsule.js";
import { Octree } from "three/examples/jsm/math/Octree.js";
const GRAVITY = 30;

export default class FirstPersonPlayer {

    constructor(camera, scene, container = document, playerCollider = null) {

        this.camera = camera;
        this.scene = scene;
        this.container = container || document;
        this.playerCollider = playerCollider === null ? new Capsule(new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(0, 1, 0), 0.35) : playerCollider;
        this.worldOctree = new Octree();

        this.playerVelocity = new THREE.Vector3();
        this.playerDirection = new THREE.Vector3();

        this.playerOnFloor = false;
        this.mousePress = false;

        this.keyStates = {};
        this.lastCameraPitch = 0; // for clamping pitch
        this.activeObjects = [];
        this.FinishLoadOctree = false;

        let isMouseDown = false;
        let previousMousePosition = { x: 0, y: 0 };

        this.container.addEventListener('keydown', (event) => {
            this.keyStates[event.code] = true;
        });

        this.container.addEventListener('keyup', (event) => {
            this.keyStates[event.code] = false;
        });

        this.container.addEventListener('mousedown', (event) => {
            isMouseDown = true;
            previousMousePosition.x = event.clientX;
            previousMousePosition.y = event.clientY;
        });

        this.container.addEventListener('mouseup', () => {
            isMouseDown = false;
        });

        this.container.addEventListener('mousemove', (event) => {
            if (!isMouseDown) return;

            const deltaX = event.clientX - previousMousePosition.x;
            const deltaY = event.clientY - previousMousePosition.y;

            const rotationSpeed = 0.005;
            this.camera.rotation.y -= deltaX * rotationSpeed;
            this.camera.rotation.x -= deltaY * rotationSpeed;

            const maxPitch = Math.PI / 2 - 0.01;
            const minPitch = -Math.PI / 2 + 0.01;
            this.camera.rotation.x = Math.max(minPitch, Math.min(maxPitch, this.camera.rotation.x));

            previousMousePosition.x = event.clientX;
            previousMousePosition.y = event.clientY;
        });

        this.playerCollisions = this.playerCollisions.bind(this);
        this.update = this.update.bind(this);
        this.updatePlayer = this.updatePlayer.bind(this);
        this.loadOctaTree = this.loadOctaTree.bind(this);
    }

    loadOctaTree(scene) {
        if (!scene) {
            console.warn("No scene passed to loadOctaTree!");
            return;
        }
        let found = 0;
        scene.traverse((child) => {
            if (child.isMesh && child.geometry) {
                child.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(child);
                const size = new THREE.Vector3();
                box.getSize(size);

                if (size.y < 0.1 && child.name === "Floor") {
                    console.warn(`Inflating flat mesh "${child.name}" for Octree.`);
                    const center = new THREE.Vector3();
                    box.getCenter(center);

                    const physicalRepresentation = new THREE.Mesh(
                        new THREE.BoxGeometry(size.x, 0.01, size.z)
                    );
                    physicalRepresentation.position.copy(center);
                    physicalRepresentation.quaternion.copy(child.quaternion);
                    physicalRepresentation.updateMatrixWorld(true);
                    this.worldOctree.fromGraphNode(physicalRepresentation);
                } else if (child.name !== "Cube024" && child.name !== "Cube024_1") {
                    this.worldOctree.fromGraphNode(child);
                }
                found++;
            }
        });

        if (found === 0) {
            console.warn("No collidable meshes found in scene for Octree!");
        } else {
            console.log(`Octree built with ${found} meshes.`);
        }

        this.FinishLoadOctree = true;
        return this.FinishLoadOctree;
    }

    playerCollisions() {
        const result = this.worldOctree.capsuleIntersect(this.playerCollider);
        this.playerOnFloor = false;
        if (result) {
            this.playerOnFloor = result.normal.y > 0;
            if (!this.playerOnFloor) {
                this.playerVelocity.addScaledVector(result.normal, - result.normal.dot(this.playerVelocity));
            }
            if (result.depth >= 1e-10) {
                this.playerCollider.translate(result.normal.multiplyScalar(result.depth));
            }
        }
    }

    updatePlayer(deltaTime) {
        let damping = Math.exp(- 4 * deltaTime) - 1;
        if (!this.playerOnFloor) {
            this.playerVelocity.y -= GRAVITY * deltaTime;
            damping *= 0.1;
        } else {
            this.playerVelocity.y = 0;
        }

        this.playerVelocity.addScaledVector(this.playerVelocity, damping);
        const deltaPosition = this.playerVelocity.clone().multiplyScalar(deltaTime);
        this.playerCollider.translate(deltaPosition);
        this.playerCollisions();

        const cameraOffset = new THREE.Vector3(0, 1, 0);
        this.camera.position.copy(this.playerCollider.end).add(cameraOffset);
    }

    update(deltaTime) {
        this.updatePlayer(deltaTime);
        this.updateControls(deltaTime);
        this.teleportPlayerIfOob();
    }

    getForwardVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0;
        this.playerDirection.normalize();
        return this.playerDirection;
    }

    getSideVector() {
        this.camera.getWorldDirection(this.playerDirection);
        this.playerDirection.y = 0;
        this.playerDirection.normalize();
        this.playerDirection.cross(this.camera.up);
        this.playerDirection.normalize();
        return this.playerDirection;
    }

    updateControls(deltaTime) {
        const speedDelta = deltaTime * (this.playerOnFloor ? 25 : 8);

        if (this.keyStates['KeyW']) {
            this.playerVelocity.add(this.getForwardVector().multiplyScalar(speedDelta));
        }
        if (this.keyStates['KeyS']) {
            this.playerVelocity.add(this.getForwardVector().multiplyScalar(- speedDelta));
        }
        if (this.keyStates['KeyA']) {
            this.playerVelocity.add(this.getSideVector().multiplyScalar(- speedDelta));
        }
        if (this.keyStates['KeyD']) {
            this.playerVelocity.add(this.getSideVector().multiplyScalar(speedDelta));
        }
    }

    teleportPlayerIfOob() {
        if (this.camera.position.y <= -25) {
            this.playerCollider.start.set(0, 0.35, 0);
            this.playerCollider.end.set(0, 1, 0);
            this.playerCollider.radius = 0.35;
            this.camera.position.copy(this.playerCollider.end);
            this.camera.rotation.set(0, 0, 0);
        }
    }

    getPlayerPosition() {
        return this.playerCollider.end.clone();
    }

    removeObjectFromOctaTree(doorObj) {
        if (doorObj && doorObj.isMesh) {
            this.activeObjects = this.activeObjects.filter((object) => object !== doorObj);
            this.worldOctree.clear();
            this.activeObjects.forEach((object) => {
                if (object.isMesh && object.geometry) {
                    this.worldOctree.fromGraphNode(object);
                }
            });
            console.log("Door removed from Octree");
        } else {
            console.warn("Invalid door object passed to removeOctaTree!");
        }
    }

    dispose() {
        this.worldOctree = null;
        this.activeObjects = [];
        this.playerCollider = null;
        this.playerVelocity = null;
        this.playerDirection = null;
        console.log("FirstPersonPlayer resources disposed.");
    }

    getOctree() {
        return this.worldOctree;
    }
}
