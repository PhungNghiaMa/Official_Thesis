// src/game_logic/NPCGuide.js
import * as THREE from 'three';
import ThirdPersonPlayer from './ThirdPersonPlayer.js';
import { acceleratedRaycast } from "three-mesh-bvh";
if (acceleratedRaycast) THREE.Mesh.prototype.raycast = acceleratedRaycast;

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
    heightOffset = 1,
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

    // NOTE: pass model into the correct parameter position (5th arg)
    this.animCtrl = new ThirdPersonPlayer(null, scene, null, model);

    // cache mixer pointer
    this.mixer = this.animCtrl.mixer ?? null;

    // if (gltf && this.animCtrl && typeof this.animCtrl.handleAnimation === 'function') {
    //   this.animCtrl.handleAnimation(this.model, gltf);
    // }


    // compute robust foot offset (bone-aware)
    // this will evaluate the mixer briefly so skeleton pose is applied
    this.computeFootOffset = () => {
      if (!this.model) return;
      if (this.mixer) this.mixer.update(0.0001); // ensure skeleton poses applied

      this.model.updateMatrixWorld(true);
      let minY = Infinity;
      const tmpVec = new THREE.Vector3();

      this.model.traverse((child) => {
        if (!child.isMesh) return;
        child.updateMatrixWorld(true);

        // consider bones for skinned meshes
        if (child.isSkinnedMesh && child.skeleton && Array.isArray(child.skeleton.bones)) {
          for (const bone of child.skeleton.bones) {
            bone.getWorldPosition(tmpVec);
            if (tmpVec.y < minY) minY = tmpVec.y;
          }
        }

        // consider mesh bounding box as well (fallback/complement)
        try {
          const box = new THREE.Box3().setFromObject(child);
          if (box.min.y < minY) minY = box.min.y;
        } catch (e) {
          // ignore objects that fail
        }
      });

      if (!isFinite(minY)) {
        const bb = new THREE.Box3().setFromObject(this.model);
        minY = bb.min.y;
      }

      this.model.userData = this.model.userData || {};
      // store: distance from model position.y to lowest world y (feet)
      this.model.userData.footOffset = this.model.position.y - minY;
      console.info('NPCGuide: recomputed footOffset =', this.model.userData.footOffset);
    };

    // compute initial robust foot offset
    this.computeFootOffset();

    // remove any other overriding footOffset (we now rely on computeFootOffset)
    // (do not compute a second bounding-box-only offset that can be stale)

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

    // initial idle (use playAction of animCtrl if available)
    if (this.animCtrl && this.animCtrl.idleAction && this.animCtrl.playAction) {
      this.animCtrl.playAction(this.animCtrl.idleAction);
    }
  }

setNavQuery(navQuery){
  if (!navQuery){
    console.error("Please add navQuery parameter to setNavQuery function")
  }
  this.navQuery = navQuery;
}

getAnimation() {
  if (!this.animCtrl || !this.model || !this.gltf) return;
  this.animCtrl.handleAnimation(this.model, this.gltf);
  this.mixer = this.animCtrl.mixer; // keep local reference if you want
}


  // Replace the existing setDestination(...) method with this
  // inside NPCGuide.js
setDestination(worldTarget) {
  if (!this.navQuery) { console.warn('NPCGuide: navQuery missing'); return false; }
  if (!worldTarget) { console.warn('NPCGuide: invalid destination', worldTarget); return false; }

  // normalize inputs and accept either:
  // - THREE.Vector3
  // - {x,y,z}
  // - array [x,y,z]
  // - result from navQuery.findClosestPoint({...}) which has { point: {x,y,z}, ... }
  const toPointObj = (p) => {
    if (!p) return null;
    // if user passed a navQuery result
    if (p.point && typeof p.point.x === 'number') return { x: p.point.x, y: p.point.y, z: p.point.z };
    if (p.isVector3) return { x: p.x, y: p.y, z: p.z };
    if (Array.isArray(p)) return { x: p[0], y: p[1], z: p[2] };
    return { x: p.x ?? p[0] ?? 0, y: p.y ?? p[1] ?? 0, z: p.z ?? p[2] ?? 0 };
  };

  const rawStart = toPointObj(this.model.position);
  const rawEnd = toPointObj(worldTarget);

  // project start/end onto navmesh (navQuery returns { point: {x,y,z}, ... })
  const startRes = this.navQuery.findClosestPoint(rawStart);
  const endRes   = this.navQuery.findClosestPoint(rawEnd);

  const start = startRes?.point || rawStart;
  const end   = endRes?.point   || rawEnd;

  console.info('NPCGuide.setDestination -> start(onNav):', start, 'end(onNav):', end);

  const res = this.navQuery.computePath(start, end);
  console.info('NPCGuide.computePath result:', res);

  if (!res || !res.success || !res.path || res.path.length === 0) {
    this.currentPath = [];
    this.pathIndex = 0;
    console.warn('NPCGuide: computePath returned empty or failed — path NOT set.');
    return false;
  }

  this.currentPath = res.path.map(p => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]));
  this.pathIndex = 0;
  console.info('NPCGuide: path created with', this.currentPath.length, 'points');
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

  // helper: returns true if a capsule at testPos would penetrate any BVH mesh
  _wouldPenetrateAt(testPos) {
    if (!this.bvhMeshes?.length) return false;
    const radius = this.capsule.radius;
    const start = new THREE.Vector3(testPos.x, testPos.y - 0.1, testPos.z);
    const end   = new THREE.Vector3(testPos.x, testPos.y + (this.capsule.height || 1.6) - 0.1, testPos.z);

    const worldSegBox = new THREE.Box3().setFromPoints([start, end]).expandByScalar(radius);

    let hitSomething = false;

    for (const mesh of this.bvhMeshes) {
      const bvh = mesh.geometry?.boundsTree;
      if (mesh.name === 'Floor') continue;
      if (!bvh) continue;
      if (mesh.userData?.worldBox && !mesh.userData.worldBox.intersectsBox(worldSegBox)) continue;

      const inv = mesh.matrixWorld.clone().invert();
      const localStart = start.clone().applyMatrix4(inv);
      const localEnd   = end.clone().applyMatrix4(inv);
      const localSeg   = new THREE.Line3(localStart, localEnd);

      let penetrated = false;
      bvh.shapecast({
        intersectsBounds: (box) => {
          const segBoxLocal = new THREE.Box3().setFromPoints([localStart, localEnd]).expandByScalar(radius);
          return box.intersectsBox(segBoxLocal);
        },
        intersectsTriangle: (tri) => {
          const triPoint = new THREE.Vector3();
          const capPoint = new THREE.Vector3();
          const dist = tri.closestPointToSegment(localSeg, triPoint, capPoint);
          if (dist < radius) {
            penetrated = true;
            return true;
          }
        }
      });

      if (penetrated) {
        hitSomething = true;
        // DEBUG LOG
        console.log("⚠️ Capsule penetration at", testPos.toArray(), "against mesh", mesh.name);
        return true;
      }
    }

    if (!hitSomething) {
      // DEBUG LOG
      console.log("✅ Capsule clear at", testPos.toArray());
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
        intersectsBounds: (box) => {
          const segBox = new THREE.Box3()
            .setFromPoints([this._segment.start, this._segment.end])
            .expandByScalar(radius);
          return box.intersectsBox(segBox);
        },
        intersectsTriangle: (tri) => {
          const triPoint = new THREE.Vector3();
          const capPoint = new THREE.Vector3();
          const dist = tri.closestPointToSegment(this._segment, triPoint, capPoint);
          if (dist < radius) {
            const depth = radius - dist;
            const pushDir = capPoint.sub(triPoint).normalize();
            this._segment.start.addScaledVector(pushDir, depth);
            this._segment.end.addScaledVector(pushDir, depth);

            const newStart = this._segment.start.clone().applyMatrix4(mesh.matrixWorld);
            const newEnd = this._segment.end.clone().applyMatrix4(mesh.matrixWorld);

            const delta = newStart.clone().sub(this._capsuleStart);
            this.model.position.add(delta);
          }
        }
      });

    }
  }

  // Replace the existing update(delta) function with this implementation
    update(delta) {
      if (!this.model) return;
      if (!this.currentPath || this.currentPath.length === 0) {
        if (this.animCtrl && this.animCtrl.idleAction && this.animCtrl.playAction) {
          this.animCtrl.playAction(this.animCtrl.idleAction);
        } else if (this.animCtrl && typeof this.animCtrl.setNPCAnimationState === 'function') {
          this.animCtrl.setNPCAnimationState(0, { left: false, right: false, run: false });
        }
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
          this.currentPath = [];
          this.pathIndex = 0;
          if (this.animCtrl && this.animCtrl.idleAction && this.animCtrl.playAction) {
            this.animCtrl.playAction(this.animCtrl.idleAction);
          }
          return;
        }
      }

      if (horiz.lengthSq() > 1e-6) {
        const targetYaw = Math.atan2(horiz.x, horiz.z);
        const facing = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, targetYaw, 0));
        this.model.quaternion.slerp(facing, Math.min(1, this.turnSpeed * delta));
      }

      const speed = Math.min(this.walkSpeed + dist * 0.5, this.runSpeed);
      const step = Math.min(dist, speed * delta);
      horiz.normalize();

      const predictedPosStraight = pos.clone().addScaledVector(horiz, step);

      const footOffset = (this.model?.userData?.footOffset !== undefined)
        ? this.model.userData.footOffset
        : ((this.animCtrl && typeof this.animCtrl.footOffset === 'number') ? this.animCtrl.footOffset : this.heightOffset);

      const wouldPenetrate = (worldPos) => this._wouldPenetrateAt(worldPos);

      let allowedDir = null;

      // ✅ STRAIGHT TEST
      let straightClear = true;
      if (this.useCapsuleCollision && wouldPenetrate(predictedPosStraight)) {
        straightClear = false;
      }
      if (straightClear && this.bvhMeshes?.length) {
        this._fwdRay.set(pos.clone().add(new THREE.Vector3(0, 0.7, 0)), horiz);
        this._fwdRay.near = 0;
        this._fwdRay.far = Math.max(0.35, step + 0.05);
        const hits = this._fwdRay.intersectObjects(this.bvhMeshes, true);
        if (hits.length) {
          const hit = hits[0];
          const normalY = Math.abs(hit.face?.normal.y ?? 0);
          if (hit.distance < step && normalY < 0.7) {
            straightClear = false; // real obstacle
          }
        }
      }
      if (straightClear) allowedDir = horiz;

      // ✅ STEERING
      if (!allowedDir) {
        const angles = [30, -30, 60, -60, 90, -90];
        const yAxis = new THREE.Vector3(0, 1, 0);
        for (let a of angles) {
          const rad = THREE.MathUtils.degToRad(a);
          const testDir = horiz.clone().applyAxisAngle(yAxis, rad).normalize();
          const testPos = pos.clone().addScaledVector(testDir, step);
          if (this.useCapsuleCollision && wouldPenetrate(testPos)) continue;

          let rayOk = true;
          if (this.bvhMeshes?.length) {
            this._fwdRay.set(pos.clone().add(new THREE.Vector3(0, 0.7, 0)), testDir);
            this._fwdRay.near = 0;
            this._fwdRay.far = Math.max(0.35, step + 0.05);
            const hits = this._fwdRay.intersectObjects(this.bvhMeshes, true);
            if (hits.length) {
              const hit = hits[0];
              const normalY = Math.abs(hit.face?.normal.y ?? 0);
              if (hit.distance < step && normalY < 0.7) rayOk = false;
            }
          }
          if (rayOk) { allowedDir = testDir; break; }
        }
      }

      // ✅ REPLAN
      if (!allowedDir && this.navQuery) {
        try {
          const startRes = this.navQuery.findClosestPoint({ x: pos.x, y: pos.y + 1.0, z: pos.z });
          const endWorld = this.currentPath[this.currentPath.length - 1];
          const endRes = this.navQuery.findClosestPoint({ x: endWorld.x, y: endWorld.y + 1.0, z: endWorld.z });
          if (startRes?.point && endRes?.point) {
            const repl = this.navQuery.computePath(startRes.point, endRes.point);
            if (repl?.success && repl.path?.length) {
              this.currentPath = repl.path.map(p => new THREE.Vector3(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]));
              this.pathIndex = 0;
              return;
            }
          }
        } catch (e) {
          console.warn('NPCGuide: local replan failed:', e);
        }
      }

      if (!allowedDir) {
        console.log('NPC blocked at', pos.toArray());
        return;
      }

      // ✅ APPLY MOVEMENT
      const newPos = pos.clone().addScaledVector(allowedDir, step);
      let snapped = false;
      if (this.navQuery) {
        try {
          const proj = this.navQuery.findClosestPoint({ x: newPos.x, y: newPos.y + 1.0, z: newPos.z });
          if (proj?.point) {
            newPos.y = proj.point.y + footOffset + 0.01;
            snapped = true;
          }
        } catch {}
      }
      if (!snapped && this.bvhMeshes?.length) {
        this._downRay.set(newPos.clone().add(new THREE.Vector3(0, 2.0, 0)), new THREE.Vector3(0, -1, 0));
        const hits = this._downRay.intersectObjects(this.bvhMeshes, true);
        if (hits.length) {
          newPos.y = hits[0].point.y + footOffset + 0.01;
          snapped = true;
        }
      }
      if (!snapped) newPos.y = Math.max(newPos.y, (this.landedY ?? pos.y));

      pos.copy(newPos);
      if (this.useCapsuleCollision) this._resolveCapsulePenetration();

      if (this.animCtrl && this.animCtrl.walkAction && this.animCtrl.playAction) {
        this.animCtrl.playAction(this.animCtrl.walkAction);
      } else if (this.animCtrl && typeof this.animCtrl.setNPCAnimationState === 'function') {
        this.animCtrl.setNPCAnimationState(Math.min(speed, this.runSpeed), { run: speed > this.walkSpeed });
      }
    }
}
