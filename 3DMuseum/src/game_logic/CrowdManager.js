import { Crowd } from 'recast-navigation';
import * as THREE from 'three';
import { prefetchAudio , playAudio , AssetDataMap , FrameToImageMeshMap} from './index.js';
import { getCachedAudioDuration } from './utils.js';
import {hostStartTour} from './webRTC.js';
export let crowd = null;
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
    collisionQueryRange: agentParams.collisionQueryRange ?? 30.0,
    pathOptimizationRange: agentParams.pathOptimizationRange ?? 30.0,
    separationWeight: agentParams.separationWeight ?? 0.05,
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

    // console.log('🎯 Agent target set to', navPt.point);
  } catch (e) {
    console.warn('setAgentTarget failed:', e);
  }
}

// CrowdManager.js - replace existing updateCrowd
// CrowdManager.js - updated updateCrowd to apply remote-controlled transforms

export function updateCrowd(dt, timeSinceLastFrame = undefined, maxSubSteps = undefined) {
  if (!crowd) return;
  try {
    // run existing crowd update (if supported)
    if (timeSinceLastFrame !== undefined && maxSubSteps !== undefined) {
      if (typeof crowd.update === 'function') {
        crowd.update(dt, timeSinceLastFrame, maxSubSteps);
      }
    } else if (typeof crowd.update === 'function') {
      crowd.update(dt);
    }
  } catch (e) {
    console.warn('updateCrowd error:', e);
  }

  // ---- New: reconcile externally-driven agents (remoteControlled) ----
  // Use the exported getAgents() or a passed-in agents Map as your codebase provides.
  try {
    // try to get agents Map from global / exported function if available
    const agentsMap = (typeof getAgents === 'function') ? getAgents() : (typeof window !== 'undefined' && window.getAgents ? window.getAgents() : null);
    if (agentsMap && typeof agentsMap.values === 'function') {
      for (const entry of agentsMap.values()) {
        try {
          
          const agentHandle = entry?.agent || entry?.key || null;
          const model = entry?.model || entry?.userData?.model || null;
          const ud = entry?.userData || (agentHandle && agentHandle.userData) || null;

          if (!ud) continue;
          // Check whether this agent is remoteControlled and has externalPos
          if (ud.remoteControlled && ud.externalPos) {
            // Canonicalize pos/quaternion into Three objects
            let netPos = ud.externalPos;
            let netQuat = ud.externalQuat;
            if (netPos && !(netPos instanceof THREE.Vector3)) {
              netPos = new THREE.Vector3(netPos.x || 0, netPos.y || 0, netPos.z || 0);
              ud.externalPos = netPos;
              model.userData.externalPos = netPos;
            }
            if (netQuat && !(netQuat instanceof THREE.Quaternion)) {
              netQuat = new THREE.Quaternion(netQuat.x||0, netQuat.y||0, netQuat.z||0, netQuat.w||1);
              ud.externalQuat = netQuat;
              model.userData.externalQuat = netQuat;
            }

            // Ensure animation controller exists (create if missing)
            let animationCtrl = model.userData?.animationCtrl || model.userData?.animCtrl || null;

            try {
              if (animationCtrl && animationCtrl.mixer) {
                animationCtrl.mixer.update(safeDt);
                // run animations slightly slower overall (60% speed)
                animationCtrl.mixer.timeScale = 0.6;
              }
            } catch(e) {}

            if (!animationCtrl && typeof createAnimController === 'function' && typeof characterGLTF !== 'undefined' && characterGLTF) {
              try {
                animationCtrl = createAnimController(model, characterGLTF);
                model.userData.animationCtrl = animationCtrl;
                model.userData.animCtrl = animationCtrl;
                if (animationCtrl.idleAction && typeof animationCtrl.idleAction.play === 'function') {
                  animationCtrl.idleAction.play();
                }
              } catch (e) { /* ignore */ }
            }

            // Safe dt
            const safeDt = (typeof dt === 'number' && dt > 1e-6) ? dt : (1/60);

            // Compute instantaneous displacement then exponential-smooth the speed
            const nowPos = netPos;
            const prevPos = model.userData._prevPos instanceof THREE.Vector3 ? model.userData._prevPos : nowPos.clone();
            const dist = prevPos.distanceTo(nowPos);
            const instantaneousSpeed = dist / safeDt - 1e-6; // subtract small epsilon to avoid jitter at low speeds
            // exponential smoothing of speed: new = old + (inst - old) * alphaSpeed
            // alphaSpeed chosen to be responsive to starts but decay slowly on stops
            const alphaSpeed = 0.12; // tune: larger -> more responsive, smaller -> smoother
            const lastSmoothed = model.userData._smoothedSpeed || 0;
            const smoothedSpeed = lastSmoothed + (instantaneousSpeed - lastSmoothed) * alphaSpeed;
            // scale down to ~0.8 so animation & speed decisions are slightly reduced
            const scaledSmoothed = smoothedSpeed * 0.8;
            model.userData._smoothedSpeed = (scaledSmoothed < 0.02) ? 0 : scaledSmoothed;
            model.userData._prevPos = nowPos.clone();

            // drive animation with smoothed speed
            const moving = model.userData._smoothedSpeed > 0.01;
            const run = model.userData._smoothedSpeed > 8.0;
            if (animationCtrl && typeof animationCtrl.setNPCAnimationState === 'function') {
              try { animationCtrl.setNPCAnimationState(model.userData._smoothedSpeed, { moving, run }); } catch(e) {}
            }
            try { if (animationCtrl && animationCtrl.mixer) animationCtrl.mixer.update(safeDt); } catch(e) {}

            // Teleport the crowd agent once (keeps navmesh state coherent)
            try {
              // If this is the very first remote sync for this model, perform an immediate
              // exact teleport of model, agent and camera (if provided). This ensures a
              // newly-joining non-host will match the host 100% on tour start.
              if (!model.userData._firstRemoteSync) {
                try {
                  // Teleport visual model immediately to network pose
                  if (model.position && typeof model.position.set === 'function') {
                    model.position.set(nowPos.x, nowPos.y, nowPos.z);
                  }
                  if (model.quaternion && netQuat) {
                    model.quaternion.copy(netQuat);
                  }
                  // initialize interpolation targets so next frames don't snap
                  model.userData._targetPos = nowPos.clone();
                  model.userData._targetQuat = netQuat.clone();
                  model.userData._prevPos = nowPos.clone();
                  model.userData._firstRemoteSync = true;

                  // If a tpView (third-person view) is associated, also snap its camera
                  const tpView = model.userData?.tpView || (entry && entry.userData && entry.userData.tpView);
                  if (tpView && tpView.camera) {
                    // If external camera pose was provided, prefer that; otherwise infer from model
                    const camPos = ud.externalCameraPos && !(ud.externalCameraPos instanceof THREE.Vector3)
                      ? new THREE.Vector3(ud.externalCameraPos.x||0, ud.externalCameraPos.y||0, ud.externalCameraPos.z||0)
                      : (ud.externalCameraPos instanceof THREE.Vector3 ? ud.externalCameraPos : null);
                    const camQuat = ud.externalCameraQuat && !(ud.externalCameraQuat instanceof THREE.Quaternion)
                      ? new THREE.Quaternion(ud.externalCameraQuat.x||0, ud.externalCameraQuat.y||0, ud.externalCameraQuat.z||0, ud.externalCameraQuat.w||1)
                      : (ud.externalCameraQuat instanceof THREE.Quaternion ? ud.externalCameraQuat : null);

                    if (camPos) tpView.camera.position.copy(camPos);
                    else {
                      // fallback: position camera relative to model using tpView offsets if available
                      if (tpView._smoothedPlayerPosition) tpView._smoothedPlayerPosition.copy(nowPos);
                      if (tpView.playerCollider && tpView.playerCollider.end) tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
                    }
                    if (camQuat) tpView.camera.quaternion.copy(camQuat);
                    if (tpView.playerCollider) {
                      tpView._smoothedPlayerPosition = tpView._smoothedPlayerPosition || new THREE.Vector3().copy(nowPos);
                    }
                  }
                } catch (e) {
                  /* non-fatal */
                }
              }

              // Always ensure the nav-agent internal pose is set to the authoritative network position
              if (agentHandle && typeof agentHandle.teleport === 'function') {
                agentHandle.teleport({ x: nowPos.x, y: nowPos.y, z: nowPos.z });
              } else if (agentHandle && agentHandle.position) {
                agentHandle.position = { x: nowPos.x, y: nowPos.y, z: nowPos.z };
              }
            } catch (e) { /* ignore */ }

            // Visual interpolation toward target (exponential lerp based on dt)
            // alpha = 1 - exp(-k * dt) gives framerate-independent smoothing.
            const k = 4; // responsiveness constant, tune between 4..14 (larger -> snappier)
            const alpha = 1 - Math.exp(-k * safeDt);
            // Initialize target storage
            if (!model.userData._targetPos) {
              model.userData._targetPos = model.position.clone();
              model.userData._targetQuat = model.quaternion.clone();
            }
            model.userData._targetPos.copy(nowPos);
            model.userData._targetQuat.copy(netQuat);

            // Interpolate visual model toward target
            if (model.position && typeof model.position.lerp === 'function') {
              model.position.lerp(model.userData._targetPos, alpha);
            } else if (model.position && typeof model.position.set === 'function') {
              model.position.set(nowPos.x, nowPos.y, nowPos.z);
            }
            if (model.quaternion && typeof model.quaternion.slerp === 'function') {
              model.quaternion.slerp(model.userData._targetQuat, alpha);
            } else if (model.quaternion && typeof model.quaternion.set === 'function') {
              model.quaternion.set(netQuat.x, netQuat.y, netQuat.z, netQuat.w);
            }
            if (model.matrixWorldNeedsUpdate !== undefined) model.matrixWorldNeedsUpdate = true;

            // update crowd agent interpolated cache if provided (best-effort)
            try {
              if (agentHandle && typeof agentHandle.interpolatedPosition === 'function') {
                const ip = agentHandle.interpolatedPosition();
                if (ip) { ip.x = nowPos.x; ip.y = nowPos.y; ip.z = nowPos.z; }
              }
            } catch (e) { /* ignore */ }
          }
        }catch (err) {}
      }
    }
  } catch (err) {
    // Non-fatal - we want to avoid noisy failures
    console.debug('updateCrowd remote reconciliation failed:', err);
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
    const role = options.role || "";
    const queue = [];
    const tempWorldPos = new THREE.Vector3();

    if (typeof hostStartTour === "function") hostStartTour(agentEntry.model);


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
        // console.warn("Queued tour target:", pictureMesh.name, "=> TourTarget worldPos", tempWorldPos);
    }

    if (queue.length === 0) {
        console.warn("startAgentTour: no valid nav points");
        return false;
    }



    // Create tour state
    const now = performance.now() / 1000;
    agentTours.set(entry.agent, {
        agent: entry.agent,
        role,
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
    entry.state.currentPictureMesh = null;
    entry.state.mode = 'idle';
    entry.state.requestedGait = null;
    entry.state.isOnTour = false;
    entry.state.atDestination = false;
  }
  return true;
}



export async function updateAgentTours(navQuery) {
  if (!navQuery) return;

  const now = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000;

  for (const [agentHandle, tour] of agentTours.entries()) {
    try {
      if (!agentHandle || !tour || !Array.isArray(tour.queue) || tour.queue.length === 0) {
        agentTours.delete(agentHandle);
        continue;
      }

      // Ensure per-tour helper flags exist (non-persistent across reloads)
      if (typeof tour._arrived === 'undefined') tour._arrived = false;
      if (typeof tour._prefetchCID === 'undefined') tour._prefetchCID = null;
      if (typeof tour._restoreParamsScheduled === 'undefined') tour._restoreParamsScheduled = false;

      const entry = tour.entry ?? null;
      const model = entry?.model ?? (entry?.userData?.model ?? null);
      if (entry && entry.state) entry.state.mode = tour.status;

      // get agent position (interpolated if available)
      // get agent position (interpolated if available).
      // If agent is remoteControlled and has externalPos, prefer that (host-driven).
      let agentPosition = null;
      try {
        const ud = (agentHandle && agentHandle.userData) ? agentHandle.userData : null;
        if (ud && ud.remoteControlled && ud.externalPos) {
          // externalPos is expected to be a THREE.Vector3-like {x,y,z}
          agentPosition = ud.externalPos;
        } else {
          agentPosition =
            (typeof agentHandle.interpolatedPosition === "function")
              ? agentHandle.interpolatedPosition()
              : (typeof agentHandle.position === "function" ? agentHandle.position() : agentHandle.position);
        }
      } catch {
        agentPosition = agentHandle.position ?? null;
      }
      if (!agentPosition) continue;

      const agentPos = new THREE.Vector3(
        agentPosition.x ?? agentPosition[0],
        agentPosition.y ?? agentPosition[1],
        agentPosition.z ?? agentPosition[2]
      );

      const current = tour.queue[tour.index];
      if (current && !current.pictureMesh && current.pictureMeshName) {
        const resolved = scene.getObjectByName(current.pictureMeshName);
        if (resolved) current.pictureMesh = resolved;
      }

      const next = tour.queue[tour.index + 1];

      if (!current || !current.navPt?.point) {
        tour.index = Math.min(tour.index + 1, tour.queue.length - 1);
        continue;
      }

      const targetPt = current.navPt.point;
      const dx = agentPos.x - targetPt.x;
      const dz = agentPos.z - targetPt.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // === parameters for hysteresis to avoid oscillation ===
      const arrivalDist = (tour.arrivalDist ?? TOUR_DEFAULT.arrivalDist);
      const hysteresisDist = Math.max(arrivalDist * 0.5, 0.25); // if it moves farther than this, clear arrived

      // --------------------------
      // MOVING state (main)
      // --------------------------
      if (tour.status === 'moving') {
        // mark tour state
        if (entry && entry.state) {
          entry.state.currentPictureMesh = null;
          entry.state.isOnTour = true;
          entry.state.atDestination = false;
          entry.state.isViewingPicture = false;
        }

        // --- PREFETCH (DEFERRED & DEBOUNCED) ---
        // build next audio CID (but do not decode/fetch here synchronously)
        if (next && AssetDataMap.size > 0 && typeof prefetchAudio === 'function') {
          const nextPictureMesh = next.pictureMesh?.name;
          const nextImageMesh = FrameToImageMeshMap[nextPictureMesh];
          const fetchItem = AssetDataMap.get(nextImageMesh);
          // console.warn("NEXT IMAGE MESH: ", nextImageMesh)
          if (fetchItem) {
            const language = localStorage.getItem("language") || "en";
            const nextAudioCID = (language === "vi") ? fetchItem.viet_audio_cid : fetchItem.eng_audio_cid;

            // schedule prefetch only once per unique CID per tour
            if (nextAudioCID && nextAudioCID !== tour._prefetchCID) {
              tour._prefetchCID = nextAudioCID;
              // defer actual network/decoding to idle time — no awaits in update loop
              if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(() => {
                  try { prefetchAudio(nextAudioCID); } catch (e) { console.warn('prefetchAudio failed', e); }
                }, { timeout: 1000 });
              } else {
                setTimeout(() => { try { prefetchAudio(nextAudioCID); } catch (e) { console.warn('prefetchAudio failed', e); } }, 0);
              }
            }
          }
        }
        // --- ARRIVAL DETECTION (with single-fire) ---
        if (dist <= arrivalDist) {
          // if not already handled as arrived -> handle arrival once
          if (!tour._arrived) {
            tour._arrived = true;             // mark arrived to avoid repeated handling
            tour._prefetchCID = null;        // allow next leg to prefetch later

            // play audio (deferred slightly so it doesn't block)
            const pictureMeshName = current.pictureMesh?.name;
            const imageMeshName = FrameToImageMeshMap[pictureMeshName];
            if (pictureMeshName && AssetDataMap.size > 0 && typeof playAudio === 'function') {
              const assetData = AssetDataMap.get(imageMeshName);
              if (assetData) {
                const language = localStorage.getItem('language') || 'en';
                const audioCID = (language === 'vi') ? assetData.viet_audio_cid : assetData.eng_audio_cid;
                if (audioCID) {
                  // Attempt to obtain cached decoded duration (if pre-decoded)
                  const cachedDur = (typeof getCachedAudioDuration === 'function') ? getCachedAudioDuration(audioCID) : null;
                  const padding = 0.15; // small padding to account for latency
                  const baseHold = (cachedDur && !isNaN(cachedDur)) ? cachedDur : (assetData?.holdTime ?? TOUR_DEFAULT.holdTime);
                  // Set tour.holdTime synchronously so the nextActionTime uses it
                  tour.holdTime = Math.max(0.1, baseHold + padding);

                  // mark loading state and start playback shortly (non-blocking)
                  if (entry && entry.state) {
                    entry.state.audioLoading = true;
                    entry.state.isPlayingAudio = false;
                  }

                  setTimeout(() => {
                    try {
                      // Use onEnded callback so we resume exactly when audio finishes
                      playAudio(audioCID, () => {
                        if (entry && entry.state) entry.state.isPlayingAudio = false;
                        // make tour ready to continue immediately: set nextActionTime to now
                        try { tour.nextActionTime = (typeof performance !== 'undefined') ? performance.now() / 1000 : Date.now() / 1000; } catch (e) {}
                        // ensure status is waiting so updateAgentTours will advance next frame
                        tour.status = 'waiting';
                      });
                    } catch (e) {
                      console.warn('playAudio failed', e);
                      // fallback: clear playing flag after holdTime
                      if (entry && entry.state) entry.state.isPlayingAudio = false;
                    }
                    if (entry && entry.state) {
                      entry.state.audioLoading = false;
                      entry.state.isPlayingAudio = true;
                    }
                  }, 60);
                }
              }
            }

            // STOP AGENT (once) - use resetMoveTarget or requestMoveTarget once
            try {
              if (typeof agentHandle.resetMoveTarget === 'function') {
                agentHandle.resetMoveTarget();
              } else if (typeof agentHandle.requestMoveTarget === 'function') {
                agentHandle.requestMoveTarget(agentPos);
              }

              // set movement params to 0 to hold in place — only once
              if (typeof agentHandle.updateParameters === 'function') {
                const params = {
                  maxSpeed: 3.5,
                  maxAcceleration: 8.0
                };
                // gradually fade to stop over 300ms
                let steps = 6;
                const stepDelay = 50;
                for (let i = 1; i <= steps; i++) {
                  const factor = 1 - i / steps;
                  setTimeout(() => {
                    agentHandle.updateParameters({
                      maxSpeed: params.maxSpeed * factor,
                      maxAcceleration: params.maxAcceleration * factor
                    });
                  }, i * stepDelay);
                }
              } else if (crowd && typeof crowd.requestMoveTarget === 'function') {
                crowd.requestMoveTarget(agentHandle, { x: agentPos.x, y: agentPos.y, z: agentPos.z });

              }
            } catch (e) { /* ignore errors */ }

            // align model to agent pos (snap when arrived)
            if (model) {
              const footOffset = (typeof model.userData?.footOffset === 'number') ? model.userData.footOffset : 0;
              model.position.set(agentPos.x, agentPos.y + footOffset, agentPos.z);
            }

            // face picture (same as before)
            if (model) {
              const faceW = current.faceWorldPos?.clone() ?? new THREE.Vector3(targetPt.x, model.position.y, targetPt.z);
              let planeNormal = new THREE.Vector3(0, 0, 1);
              try {
                if (current.pictureMesh && typeof current.pictureMesh.getWorldDirection === 'function') {
                  planeNormal.copy(current.pictureMesh.getWorldDirection(new THREE.Vector3()));
                  if (planeNormal.lengthSq() < 1e-6) planeNormal.set(0, 0, 1);
                }
              } catch (e) { planeNormal.set(0, 0, 1); }

              const toAgent = new THREE.Vector3(agentPos.x - faceW.x, 0, agentPos.z - faceW.z);
              if (toAgent.lengthSq() < 1e-6) toAgent.set(0, 0, 1);
              else toAgent.normalize();
              if (planeNormal.dot(toAgent) < 0) planeNormal.negate();

              const lookAtPoint = faceW.clone().addScaledVector(planeNormal, 0.5);
              lookAtPoint.y = model.position.y;

              const dirH = new THREE.Vector3(lookAtPoint.x - agentPos.x, 0, lookAtPoint.z - agentPos.z);
              if (dirH.lengthSq() > 1e-6) {
                dirH.normalize();
                let yaw = Math.atan2(dirH.x, dirH.z);
                const correction = (model.userData && typeof model.userData.forwardCorrection === 'number') ? model.userData.forwardCorrection : 0;
                const desiredQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + correction, 0));
                model.quaternion.copy(desiredQuat);
                if (!entry.state) entry.state = {};
                entry.state.tourFacingQuat = desiredQuat.clone();
                entry.state.preventRotationUntil = now + (tour.holdTime ?? TOUR_DEFAULT.holdTime);
              }
            }

            // set waiting state and flags
            tour.status = 'waiting';
            tour.nextActionTime = now + (tour.holdTime ?? TOUR_DEFAULT.holdTime);
            if (entry && entry.state) {
              entry.state.mode = 'idle';
              entry.state.requestedGait = null;
              entry.state.atDestination = true;
              entry.state.currentPictureMesh = current.pictureMesh ?? null
              entry.state.isViewingPicture = true; 
            }
            continue; // next agent
          }
        } else {
          // if we had previously marked arrived but agent wandered outside small hysteresis radius, clear arrived flag
          if (tour._arrived && dist > (arrivalDist + hysteresisDist)) {
            tour._arrived = false;
          }
        }

        // skip rotation while preventRotationUntil holds
        if (entry?.state?.preventRotationUntil && now < entry.state.preventRotationUntil) {
          continue;
        }
      } // end moving

      // --------------------------
      // WAITING state: move to next target when hold expires
      // --------------------------
      else if (tour.status === 'waiting') {
        if (now >= (tour.nextActionTime ?? 0)) {
          let nextIndex = tour.index + 1;
          if (nextIndex >= tour.queue.length) {
            if (tour.loop) nextIndex = 0;
            else {
              // finish tour
              console.warn('updateAgentTours: tour finished for agent', agentHandle);
              agentTours.delete(agentHandle);
              if (entry && entry.state) {
                entry.state.preventRotationUntil = null;
                entry.state.tourFacingQuat = null;
                entry.state.atDestination = false;
                entry.state.isOnTour = false;
                entry.state.currentPictureMesh = null;
                entry.state.isViewingPicture = false;
              }
              continue;
            }
          }
          // advance index
          tour.index = nextIndex;

          // restore movement parameters if we previously zeroed them
          try {
            if (tour._restoreParamsScheduled) {
              if (typeof agentHandle.updateParameters === 'function') {
                // restore sensible defaults (tune to your agent defaults)
                agentHandle.updateParameters({
                  maxSpeed: tour.gait?.maxSpeed ?? 2.0,
                  maxAcceleration: tour.gait?.maxAcceleration ?? 6.0
                });
              }
              tour._restoreParamsScheduled = false;
            }
          } catch (err) { /* ignore */ }

          try {
            setAgentTarget(agentHandle, tour.queue[tour.index].navPt, navQuery, { entry, requestedGait: tour.gait ?? null });
          } catch (e) {
            console.warn("updateAgentTours: setAgentTarget failed", e);
          }

          tour.status = 'moving';
        }
      }

      // --------------------------
      // STARTING state
      // --------------------------
      else if (tour.status === 'starting') {
        try {
          const nextNav = current.navPt;
          setAgentTarget(agentHandle, nextNav, navQuery, { entry, requestedGait: tour.gait ?? null });
        } catch (e) {
          console.warn("updateAgentTours: starting setAgentTarget failed", e);
        }
        tour.status = 'moving';
      }

    } catch (ex) {
      console.error('updateAgentTours: exception for agent:', ex);
    }
  } // end for
}



export function addThirdPersonToCrowd(scene, crowd, tpView) {
  return new Promise((resolve, reject) => {
    if (!tpView) return reject("tpView missing");

    let posVec = tpView.model?.position || tpView._smoothedPlayerPosition ||
                 tpView.playerCollider?.end || { x: 0, y: 1, z: 0 };
    const startPos = { x: posVec.x ?? 0, y: posVec.y ?? 1, z: posVec.z ?? 0 };

    const agent = addAgent(startPos, {
      radius: 0.25,
      height: 1.8,
      maxSpeed: 2.4,
      maxAcceleration: 6.0,
      collisionQueryRange: 1,
      pathOptimizationRange: 50,
      separationWeight: 0,
    });

    if (!agent) {
      console.error("addThirdPersonToCrowdAsync: failed to add agent");
      return reject("agent create failed");
    }

    let agentHandle = agent;
    if (typeof agent === "number" && crowd?.getAgent) {
      try {
        const resolved = crowd.getAgent(agent);
        if (resolved) agentHandle = resolved;
      } catch {}
    }

    if (tpView.setCrowdAgent) tpView.setCrowdAgent(agentHandle);
    else tpView.crowdAgent = agentHandle;

    // Record mapping between agent entry and the tpView/model so updateCrowd
    // can find the camera and perform an exact snap when remote-controlled data arrives.
    try {
      const stored = agents.get(agent);
      if (stored) {
        stored.model = tpView.model || stored.model;
        stored.userData = stored.userData || {};
        stored.userData.model = tpView.model || stored.userData.model;
        stored.userData.tpView = tpView;
      }
      if (tpView.model && tpView.model.userData) {
        tpView.model.userData.tpView = tpView;
      }
    } catch (e) { /* ignore */ }

    // Align immediately to tpView model position
    try {
      if (tpView.model && agentHandle) {
        const tgt = tpView.model.position;
        if (agentHandle.teleport) agentHandle.teleport({ x: tgt.x, y: tgt.y, z: tgt.z });
        else agentHandle.position = { x: tgt.x, y: tgt.y, z: tgt.z };
      }
    } catch (e) {
      console.warn("align tpView.crowdAgent failed", e);
    }

    // ✅ Wait one frame so crowd.update() runs once
    requestAnimationFrame(() => {
      console.log("addThirdPersonToCrowdAsync: TP crowd agent ready", agentHandle);
      resolve(agentHandle);
    });
  });
}

