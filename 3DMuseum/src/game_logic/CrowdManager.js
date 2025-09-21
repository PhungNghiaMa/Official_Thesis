import { Crowd } from 'recast-navigation';
import * as THREE from 'three';

let crowd = null;
const agents = new Map();

export function initCrowd(navMesh, maxAgents = 16, maxAgentRadius = 1.0) {
  if (!navMesh) {
    console.error("initCrowd: navMesh is required");
    return null;
  }
  try {
    crowd = new Crowd(navMesh, { maxAgents, maxAgentRadius });
    console.log("✅ Crowd initialized with", { maxAgents, maxAgentRadius });
    return crowd;
  } catch (e) {
    console.error("❌ initCrowd failed:", e);
    return null;
  }
}

export function addAgent(position, agentParams = {}, userData = {}) {
  if (!crowd) {
    console.error("addAgent: crowd not initialized");
    return null;
  }

  const pos = { x: position.x, y: position.y, z: position.z };

  const params = {
    radius: agentParams.radius ?? 0.5,
    height: agentParams.height ?? 2.0,
    maxAcceleration: agentParams.maxAcceleration ?? 8.0,
    maxSpeed: agentParams.maxSpeed ?? 3.5,
    collisionQueryRange: agentParams.collisionQueryRange ?? 10.0,
    pathOptimizationRange: agentParams.pathOptimizationRange ?? 30.0,
    separationWeight: agentParams.separationWeight ?? 2.0,
  };

  const agent = crowd.addAgent(pos, params);

  if (!agent) {
    console.error("❌ addAgent failed at pos", pos, "params:", params);
    return null;
  }

  agents.set(agent, { agent, userData });
  console.log("✅ Agent added:", agent, "at", pos);
  return agent;
}


export function setAgentTarget(agentId, targetPosition, navQuery, options = {}) {
  if (!crowd || !navQuery || !agentId || !targetPosition) return;
  const { entry = null, requestedGait = null, pathLength = null } = options;

  // Resolve a navQuery 'closest' result (object with .point)
  let navPt = null;
  if (targetPosition && targetPosition.point && targetPosition.point.x !== undefined) {
    // already a navQuery-like result
    navPt = targetPosition;
  } else {
    // snap the plain {x,y,z} to navmesh
    navPt = navQuery.findClosestPoint(targetPosition);
  }

  if (!navPt?.point) {
    console.warn('setAgentTarget: could not resolve nav point', targetPosition);
    return;
  }

  try {
    // resolve agent handle
    let agentHandle = null;
    if (typeof agentId === 'number') agentHandle = crowd.getAgent(agentId);
    else agentHandle = agentId; // assume agent object

    if (!agentHandle) {
      const stored = Array.from(agents.values()).find(a => a.agent === agentId || a.model === agentId);
      if (stored) agentHandle = stored.agent;
    }
    if (!agentHandle) {
      console.warn('setAgentTarget: agent handle not found for', agentId);
      return;
    }

    // request move - use the point form (this matches your working click-path code)
    if (typeof agentHandle.requestMoveTarget === 'function') {
      agentHandle.requestMoveTarget(navPt.point);
    } else if (typeof agentId === 'number') {
      const a = crowd.getAgent(agentId);
      if (a && typeof a.requestMoveTarget === 'function') a.requestMoveTarget(navPt.point);
    }

    // record gait state (unchanged)
    if (entry) {
      entry.state = entry.state || {};
      if (requestedGait) {
        entry.state.requestedGait = requestedGait;
      } else if (pathLength != null) {
        entry.state.requestedGait = pathLength >= 4.0 ? 'run' : 'walk';
      }
    }

    console.log('🎯 Agent target set to', navPt.point);
  } catch (e) {
    console.warn('setAgentTarget failed:', e);
  }
}



// CrowdManager.js - replace existing updateCrowd
export function updateCrowd(dt, timeSinceLastFrame = undefined, maxSubSteps = undefined) {
  if (!crowd) return;
  try {
    if (timeSinceLastFrame !== undefined && maxSubSteps !== undefined) {
      // fixed time stepping with interpolation if crowd supports it
      if (typeof crowd.update === 'function') {
        crowd.update(dt, timeSinceLastFrame, maxSubSteps);
      }
    } else if (typeof crowd.update === 'function') {
      crowd.update(dt);
    }
  } catch (e) {
    console.warn('updateCrowd error:', e);
  }
}

export function getAgents() {
  return agents;
}

export function removeAgent(agent) {
  if (!crowd) return;
  crowd.removeAgent(agent);
  agents.delete(agent);
}

export const agentTours = new Map();
const TOUR_DEFAULT = {
  desiredDistance: 1, // Desired distance that want to set between the agent (NPC) and the objects (Pictures)
  fanSteps: 12, // Sampling resolution if direct snap fails
  holdTime: 3.0, // Seconds to wait for NPC to present at each picture 
  loop: false,  // Loop when finish . Set false to not loop when the NPC finish introduce product
  arrivalDist: 0.18 // Arrival / distance threshold (horizontal)
}

function resolveEntry(agentEntry){
  if (!agentEntry) return null;
  // If full entry object (has both NPC model and the agent is created), return it 
  if (agentEntry.agent && agentEntry.model) return agentEntry;
  // If just an agent handle , try to find stored userData from agents Map (if available)
  for (const agentValue of agents.values()){
    if (agentValue.agent === agentEntry || agentValue.agent === (agentEntry.agent ?? null)) return agentValue;
    // Also allow passing model reference 
    if (agentValue.model === agentEntry || agentValue.model === (agentEntry.model ?? null)) return agentValue;
  }
  return {agent: agentEntry , model: null , state: {}};
}


/**
 * Start a tour for agent/entry.
 * - agentEntry: the object returned by initNPC (recommended) OR the raw agent handle.
 * - meshes: array of THREE.Mesh (picture frames)
 * - navQuery: your navQuery (required)
 * - options: { desiredDistance, fanSteps, holdTime, loop, gait }
 *
 * Returns true on success.
 */

export function startAgentTour(agentEntry, PictureMeshes = [], navQuery, options = {}) {
    if (!agentEntry || !PictureMeshes || PictureMeshes.length === 0 || !navQuery) return false;

    const entry = agentEntry;
    const targetsMap = options.targetsMap || new Map();
    const queue = [];
    const tempWorldPos = new THREE.Vector3();

    for (const pictureMesh of PictureMeshes) {
        if (!pictureMesh) continue;

        // ✅ Look up the TourTarget for this picture
        const explicitTarget = targetsMap.get(pictureMesh.name);
        if (!explicitTarget) {
            console.warn("No TourTarget found for", pictureMesh.name);
            continue;
        }

        // Get the TourTarget world position
        explicitTarget.getWorldPosition(tempWorldPos);

        // Snap that position onto the navmesh
        const navPt = navQuery.findClosestPoint({
            x: tempWorldPos.x,
            y: tempWorldPos.y,
            z: tempWorldPos.z
        });

        if (!navPt) {
            console.warn("startAgentTour: navmesh point not found for", pictureMesh.name);
            continue;
        }

        // Where NPC should face = picture mesh center
        const facePos = new THREE.Vector3();
        pictureMesh.getWorldPosition(facePos);

        // Queue entry
        queue.push({
            pictureMesh,
            navPt,                  // navigation anchor = TourTarget snapped to navmesh
            faceWorldPos: facePos,  // look at the picture
            targetWorldPos: tempWorldPos.clone()
        });

        console.warn("Queued tour target:", pictureMesh.name, "=> TourTarget worldPos", tempWorldPos);
    }

    if (queue.length === 0) {
        console.warn("startAgentTour: no valid nav points");
        return false;
    }

    // Create tour state
    const now = performance.now() / 1000;
    agentTours.set(entry.agent, {
        agent: entry.agent,
        entry,
        queue,
        index: 0,
        loop: !!options.loop,
        holdTime: options.holdTime ?? TOUR_DEFAULT.holdTime,
        status: "starting",
        nextActionTime: now,
        gait: options.gait ?? null
    });

    // Kick off first movement
    try {
        setAgentTarget(entry.agent, queue[0].navPt, navQuery, {
            entry,
            requestedGait: options.gait ?? null
        });
    } catch (e) {
        console.warn("startAgentTour: initial setAgentTarget failed", e);
    }

    console.warn("✅ Starting tour with", queue.length, "targets");
    return true;
}

export function stopAgentTour(agentEntry) {
  const entry = resolveEntry(agentEntry);
  if (!entry || !entry.agent) return false;
  const t = agentTours.get(entry.agent);
  if (!t) return false;
  agentTours.delete(entry.agent);
  // clear flags on entry
  if (entry.state) {
    entry.state.preventRotationUntil = null;
    entry.state.tourFacingQuat = null;
  }
  return true;
}

export function updateAgentTours(navQuery) {
  if (!navQuery) return;
  const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

  for (const [agentHandle, tour] of agentTours.entries()) {
    try {
      if (!agentHandle || !tour || !Array.isArray(tour.queue) || tour.queue.length === 0) {
        agentTours.delete(agentHandle);
        continue;
      }

      const entry = tour.entry ?? null;
      const model = entry?.model ?? (entry?.userData?.model ?? null);

      // --- agent position (interpolated if available) ---
      let agentPosition;
      try {
        agentPosition = (typeof agentHandle.interpolatedPosition === 'function')
          ? agentHandle.interpolatedPosition()
          : (typeof agentHandle.position === 'function' ? agentHandle.position() : agentHandle.position);
      } catch (e) {
        agentPosition = agentHandle.position ?? null;
      }
      if (!agentPosition) continue;
      const agentPos = new THREE.Vector3(
        agentPosition.x ?? agentPosition[0],
        agentPosition.y ?? agentPosition[1],
        agentPosition.z ?? agentPosition[2]
      );

      const current = tour.queue[tour.index];
      if (!current || !current.navPt || !current.navPt.point) {
        console.warn('updateAgentTours: skipping invalid queue item at index', tour.index);
        // try to advance to next item to avoid endless loop
        tour.index = Math.min(tour.index + 1, tour.queue.length - 1);
        continue;
      }

      // compute horizontal distance to the target nav point
      const targetPt = current.navPt.point;
      const targetXZ = new THREE.Vector3(targetPt.x, 0, targetPt.z);
      const dx = agentPos.x - targetXZ.x;
      const dz = agentPos.z - targetXZ.z;
      const dist = Math.sqrt(dx*dx + dz*dz);

      // DEBUG: show where we are for this tour occasionally
      // console.debug(`tour idx=${tour.index}/${tour.queue.length-1} status=${tour.status} dist=${dist.toFixed(3)} target=${targetPt.x.toFixed(2)},${targetPt.z.toFixed(2)}`);

      if (tour.status === 'moving') {
        // arrival test
        const arrivalDist = (tour.arrivalDist ?? TOUR_DEFAULT.arrivalDist);
        if (dist <= arrivalDist) {
          console.warn('updateAgentTours: arrived at index', tour.index, 'for', current.pictureMesh?.name ?? '(unknown)', 'dist', dist.toFixed(3));

          // clear any move target on the agent (stop it immediately)
          try {
            if (typeof agentHandle.resetMoveTarget === 'function') {
              agentHandle.resetMoveTarget();
            } else if (typeof agentHandle.requestMoveTarget === 'function') {
              // requestMoveTarget to its current position is another way to stop it
              agentHandle.requestMoveTarget(agentPos);
            }

            // ALSO make agent physically unable to continue by clamping speed/accel.
            // Many crowd runtimes expose updateParameters/updateAgent params — try that.
            try {
              if (typeof agentHandle.updateParameters === 'function') {
                agentHandle.updateParameters({
                  maxSpeed: 0.0,
                  maxAcceleration: 0.0
                });
              } else if (crowd && typeof crowd.requestMoveTarget === 'function') {
                // As a fallback, requestMoveTarget to the current position via crowd API
                try { crowd.requestMoveTarget(agentHandle, { x: agentPos.x, y: agentPos.y, z: agentPos.z }); } catch (e2) {}
              }
            } catch (eParams) { /* ignore parameter set failures */ }
          } catch (e) { /* ignore */ }

          // snap model vertically (if present)
          if (model) {
            const footOffset = (typeof model.userData?.footOffset === 'number') ? model.userData.footOffset : 0;
            model.position.set(agentPos.x, agentPos.y + footOffset, agentPos.z);
          }

          // compute facing quaternion so agent faces picture mesh
          const faceW = current.faceWorldPos?.clone()
            ?? new THREE.Vector3(targetPt.x, model ? model.position.y : agentPos.y, targetPt.z);
          const dir = new THREE.Vector3(faceW.x - agentPos.x, 0, faceW.z - agentPos.z);
          if (dir.lengthSq() > 1e-6 && model) {
            const yaw = Math.atan2(dir.x, dir.z);
            const tq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw - 0.8, 0));
            model.quaternion.copy(tq);
            if (!entry.state) entry.state = {};
            entry.state.tourFacingQuat = tq.clone();
            // freeze rotations until holdTime elapses
            entry.state.preventRotationUntil = now + (tour.holdTime ?? TOUR_DEFAULT.holdTime);
            console.warn('updateAgentTours: freeze rotation until', entry.state.preventRotationUntil.toFixed(3));
          } else {
            if (entry && entry.state) entry.state.preventRotationUntil = now + (tour.holdTime ?? TOUR_DEFAULT.holdTime);
          }

          // go to waiting state
          tour.status = 'waiting';
          tour.nextActionTime = now + (tour.holdTime ?? TOUR_DEFAULT.holdTime);

          // set model/entry to idle state so animation system plays idle
          if (entry && entry.state) {
            entry.state.mode = 'idle';
            entry.state.requestedGait = null;
          }

          // Safety: also ensure the underlying crowd agent remains stopped for the
          // duration of the hold so small pathing jitter doesn't re-trigger motion.
          // (We already set updateParameters above to 0; schedule a restore later when we move.)

          continue; // done for this agent this frame
        }

        // still moving: no other action in this branch
      } else if (tour.status === 'waiting') {
        // waiting for hold time to finish before moving to next target
        if (now >= (tour.nextActionTime ?? 0)) {
          let nextIndex = tour.index + 1;
          if (nextIndex >= tour.queue.length) {
            if (tour.loop) nextIndex = 0;
            else {
              // finish the tour
              console.warn('updateAgentTours: tour finished for agent', agentHandle);
              agentTours.delete(agentHandle);
              if (entry && entry.state) {
                entry.state.preventRotationUntil = null;
                entry.state.tourFacingQuat = null;
              }
              continue;
            }
          }
          tour.index = nextIndex;

          // before requesting move, compute a debug path check
          try {
            const startRes = navQuery.findClosestPoint({ x: agentPos.x, y: agentPos.y + 1.0, z: agentPos.z });
            const startPoint = startRes?.point ?? { x: agentPos.x, y: agentPos.y, z: agentPos.z };
            const nextNavPt = tour.queue[tour.index].navPt;
            const pathRes = navQuery.computePath(startPoint, nextNavPt.point);
            console.warn('updateAgentTours -> attempting move to', tour.queue[tour.index].pictureMesh?.name, 'index', tour.index,
                         'navPt', nextNavPt.point, 'pathOK?', !!pathRes?.success);
          } catch (e) {
            console.warn('updateAgentTours -> path check failed', e);
          }

          // request move to new target (use the navQuery object directly)
          try {
            console.warn('updateAgentTours setting target (from waiting):', tour.queue[tour.index].pictureMesh?.name,
                         '->', tour.queue[tour.index].navPt.point);
            setAgentTarget(agentHandle, tour.queue[tour.index].navPt, navQuery, { entry, requestedGait: tour.gait ?? null });
          } catch (e) {
            console.warn('updateAgentTours: setAgentTarget failed', e);
          }

          tour.status = 'moving';
        }
      } else if (tour.status === 'starting') {
        // initial bootstrap: set first move
        try {
          const nextNav = current.navPt;
          console.warn('updateAgentTours (starting) set target:', current.pictureMesh?.name, '->', nextNav.point);
          setAgentTarget(agentHandle, nextNav, navQuery, { entry, requestedGait: tour.gait ?? null });
        } catch (e) {
          console.warn('updateAgentTours: starting setAgentTarget failed', e);
        }
        tour.status = 'moving';
      }
    } catch (ex) {
      console.error('updateAgentTours: exception for agent:', ex);
    }
  } // end for
}


export function addThirdPersonToCrowd(scene, crowd, tpView) {
  if (!tpView || !tpView.model) return null;

  const pos = tpView.model.position;

  // Create TP crowd agent with realistic collision settings so it won't pass through geometry.
  // Use a radius and collisionQueryRange large enough to detect obstacles but small enough
  // to still allow close following. Tune these numbers if you want the TP agent to hug the NPC tighter.
  const agent = addAgent(pos, {
    radius: 0.25,               // capsule radius in meters (human scale)
    height: 1.8,                // agent height
    maxSpeed: 2.4,              // walking speed
    maxAcceleration: 6.0,
    collisionQueryRange: 0.25,  // >0 so agent queries collisions / obstacles
    pathOptimizationRange: 50,
    separationWeight: 0.05,      // small separation so TP won't push through NPCs
  });

  if (!agent) {
    console.error("addThirdPersonToCrowd: Failed to add agent");
    return null;
  }

  // Resolve numeric id -> agent object when necessary (crowd API differences)
  let agentHandle = agent;
  if (typeof agent === 'number' && crowd && typeof crowd.getAgent === 'function') {
    try {
      const resolved = crowd.getAgent(agent);
      if (resolved) agentHandle = resolved;
    } catch (e) { /* ignore */ }
  }

  // Give the tpView the agent object handle (so tpView.syncFromCrowd/updateFollow can call .position())
  if (typeof tpView.setCrowdAgent === 'function') {
    tpView.setCrowdAgent(agentHandle);
  } else {
    tpView.crowdAgent = agentHandle;
  }

  console.log("addThirdPersonToCrowd: created TP crowd agent", agentHandle);
  return agent;
}

