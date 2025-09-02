// src/game_logic/NPCGuide.js
import * as THREE from 'three';
import ThirdPersonPlayer from './ThirdPersonPlayer.js';

export default class NPCGuide {
  constructor({
    scene,
    navQuery,
    model,
    gltf,
    bvhMeshes = [],         // three-mesh-bvh meshes (same you pass to tpView.buildBVH)
    walkSpeed = 1.3,
    runSpeed = 2.2,
    turnSpeed = 6.0,
    heightOffset = 0.01,
    arrivalRadius = 0.15,
    useCapsuleCollision = false, // optional fallback collision resolver
    capsule = { height: 1.6, radius: 0.35 }
  }) {
    this.scene = scene;
    this.navQuery = navQuery;
    this.model = model;
    this.gltf = gltf;
    this.bvhMeshes = bvhMeshes;
    this.walkSpeed = walkSpeed;
    this.runSpeed = runSpeed;
    this.turnSpeed = turnSpeed;
    this.heightOffset = heightOffset;
    this.arrivalRadius = arrivalRadius;
    this.useCapsuleCollision = useCapsuleCollision;
    this.capsule = capsule;

    // Animation controller reuse
    this.animCtrl = new ThirdPersonPlayer(null, scene, null, model);
    if (gltf) this.animCtrl.handleAnimation(model, gltf);
    this.mixer = this.animCtrl.mixer;

    this.currentPath = []; // array of THREE.Vector3
    this.pathIndex = 0;
    this.reachedCallback = null;

    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._downRay = new THREE.Raycaster();
    this._fwdRay = new THREE.Raycaster();

    // capsule helpers for optional sweep (if enabled)
    if (this.useCapsuleCollision) {
      this._capsuleStart = new THREE.Vector3();
      this._capsuleEnd = new THREE.Vector3();
      this._tmpBox = new THREE.Box3();
      this._invMat = new THREE.Matrix4();
      this._segment = new THREE.Line3();
    }

    // initial idle
    this.animCtrl.setNPCAnimationState(0, { left: false, right: false, run: false });
  }

  async setDestination(worldTarget) {
    if (!this.navQuery) {
      console.warn('NPCGuide: navQuery missing');
      return false;
    }
    const start = { x: this.model.position.x, y: this.model.position.y, z: this.model.position.z };
    const end = { x: worldTarget.x, y: worldTarget.y, z: worldTarget.z };

    const res = this.navQuery.computePath(start, end);
    if (!res || !res.success || !res.path || res.path.length === 0) {
      this.currentPath = [];
      this.pathIndex = 0;
      return false;
    }

    this.currentPath = res.path.map(p => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]));
    this.pathIndex = 0;
    return true;
  }

  async followWaypoints(waypoints = []) {
    if (!this.navQuery || waypoints.length === 0) return false;
    const full = [];
    let start = this.model.position.clone();
    for (let i = 0; i < waypoints.length; i++) {
      const target = waypoints[i];
      const res = this.navQuery.computePath(
        { x: start.x, y: start.y, z: start.z },
        { x: target.x, y: target.y, z: target.z }
      );
      if (res?.success && res.path?.length) {
        const seg = res.path.map(p => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]));
        if (full.length && seg.length) seg.shift(); // avoid duplicate corners
        full.push(...seg);
        start = seg[seg.length - 1].clone();
      } else {
        // failed this segment — abort but keep what we have
        console.warn('NPCGuide: waypoint path segment failed', target);
      }
    }
    if (full.length) {
      this.currentPath = full;
      this.pathIndex = 0;
      return true;
    }
    return false;
  }

  // optional small helper to resolve capsule penetration using BVH shapecast
  _resolveCapsulePenetration() {
    if (!this.useCapsuleCollision || !this.bvhMeshes?.length) return;

    const radius = this.capsule.radius;
    // set capsule endpoints relative to model position
    this._capsuleStart.set(this.model.position.x, this.model.position.y - 0.1, this.model.position.z);
    this._capsuleEnd.set(this.model.position.x, this.model.position.y + this.capsule.height - 0.1, this.model.position.z);

    // compute world aabb for capsule
    this._tmpBox.makeEmpty();
    this._tmpBox.expandByPoint(this._capsuleStart);
    this._tmpBox.expandByPoint(this._capsuleEnd);
    this._tmpBox.min.addScalar(-radius);
    this._tmpBox.max.addScalar(radius);

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry.boundsTree;
      if (!bvh) continue;
      if (mesh.userData?.worldBox && !mesh.userData.worldBox.intersectsBox(this._tmpBox)) continue;

      // transform capsule to mesh local space
      this._invMat.copy(mesh.matrixWorld).invert();
      this._segment.start.copy(this._capsuleStart).applyMatrix4(this._invMat);
      this._segment.end.copy(this._capsuleEnd).applyMatrix4(this._invMat);

      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this._segment.getBoundingBox(new THREE.Box3()).expandByScalar(radius)),
        intersectsTriangle: (tri) => {
          // triangle.closestPointToSegment / tri-point closests logic from your player code
          const triPoint = new THREE.Vector3();
          const capPoint = new THREE.Vector3();
          const dist = tri.closestPointToSegment(this._segment, triPoint, capPoint);
          if (dist < radius) {
            const depth = radius - dist;
            const pushDir = capPoint.sub(triPoint).normalize();
            // push capsule endpoints in local space and then transform back
            this._segment.start.addScaledVector(pushDir, depth);
            this._segment.end.addScaledVector(pushDir, depth);
            // apply back to world
            const newStart = this._segment.start.clone().applyMatrix4(mesh.matrixWorld);
            const newEnd = this._segment.end.clone().applyMatrix4(mesh.matrixWorld);
            // move model to newStart with simple translation
            const delta = newStart.clone().sub(this._capsuleStart);
            this.model.position.add(delta);
          }
        }
      });
    }
  }

  update(delta) {
    if (this.mixer) this.mixer.update(delta);

    if (!this.currentPath || this.currentPath.length === 0) {
      this.animCtrl.setNPCAnimationState(0, { run: false, left: false, right: false });
      return;
    }

    const pos = this.model.position;
    const target = this.currentPath[this.pathIndex];
    this._tmpV.subVectors(target, pos);
    const horiz = this._tmpV.clone(); horiz.y = 0;
    const dist = horiz.length();

    if (dist < this.arrivalRadius) {
      if (this.pathIndex < this.currentPath.length - 1) {
        this.pathIndex++;
        return;
      } else {
        // reached final
        this.currentPath = [];
        this.pathIndex = 0;
        this.animCtrl.setNPCAnimationState(0, { run: false, left: false, right: false });
        return;
      }
    }

    // face direction smoothly
    if (horiz.lengthSq() > 1e-6) {
      const targetYaw = Math.atan2(horiz.x, horiz.z);
      const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
      this.model.quaternion.slerp(facing, Math.min(1, this.turnSpeed * delta));
    }

    // speed: small ramping by distance
    const speed = Math.min(this.walkSpeed + dist * 0.5, this.runSpeed);
    const step = Math.min(dist, speed * delta);
    horiz.normalize();
    pos.addScaledVector(horiz, step);

    // small forward buffer — raycast a short distance and back off a bit if colliding
    if (this.bvhMeshes?.length) {
      this._fwdRay.set(pos.clone().add(new THREE.Vector3(0, 0.7, 0)), horiz);
      this._fwdRay.near = 0;
      this._fwdRay.far = 0.35;
      const hit = this._fwdRay.intersectObjects(this.bvhMeshes, true);
      if (hit.length) pos.addScaledVector(horiz, -0.06);
    }

    // downward snap to BVH floor so feet land properly
    // downward snap — raycast downward onto BVH meshes
    if (this.bvhMeshes?.length) {
      this._downRay.set(pos.clone().add(new THREE.Vector3(0, 2.0, 0)), new THREE.Vector3(0, -1, 0));
      const hits = this._downRay.intersectObjects(this.bvhMeshes, true);

      if (hits.length) {
        const footOffset = (this.model?.userData?.footOffset ?? this.heightOffset ?? 0);
        this.model.position.y = hits[0].point.y + footOffset + 0.01; // +0.01 safety epsilon
      } else {
        // fallback: keep slightly above computed player start or previous y
        this.model.position.y = Math.max(
          this.model.position.y,
          (this.landedY ?? this.model.position.y)
        );
      }

    }


    // Optional capsule penetration resolution for stubborn geometry
    if (this.useCapsuleCollision) this._resolveCapsulePenetration();

    // update animation
    this.animCtrl.setNPCAnimationState(speed, { run: speed > this.walkSpeed * 1.4, left: false, right: false });
  }
}
