// webrtc_game.js
// Drop into front-end and load this script AFTER index.js so window.gameAPI exists.
// Example usage:
//   <script type="module" src="./src/game_logic/webrtc_game.js"></script>
//   then call initConnection() from console or programmatically.
import { addRemotePlayer, updateRemotePlayerState, removeRemotePlayer, updateRemotePlayers, getLocalPlayerState , getCurrentNPCState , initNPC , _sharedRefs } 
  from './index.js';
const API_BASE = "http://localhost:3001"// default to backend:3001
const ROOM_ID = new URLSearchParams(location.search).get("room") || "default";
const PEER_ID = (window.WEBRTC_PEER_ID) ? window.WEBRTC_PEER_ID : Math.random().toString(36).substring(2, 10);

let pc = null;
let dc = null;
let sendTimer = null;
let isConnected = false;

window.gameAPI = {}

// Animation codes for compact binary transmission
const ANIM_IDLE = 0;
const ANIM_WALK = 1;
const ANIM_RUN  = 2;

// Throttle / threshold parameters
const NPC_SEND_HZ = 180;                   // target sends per second
const NPC_SEND_INTERVAL_MS = Math.round(1000 / NPC_SEND_HZ);
const NPC_MIN_POS_DELTA = 0.01;          // meters — ignore tiny movements
const NPC_MIN_ANGLE_DELTA = 0.1;        // radians — ignore tiny rotations
const NPC_FORCE_SEND_MS = 5000;          // ensure at least one send every N ms
let _remoteNPCEntry = null;

// Instrumentation
let npcSentBytes = 0;
let npcSentPackets = 0;
let npcLastInstrumentationTime = performance.now();

// Host flag
let isHost = false;

// ===== NPC send loop state (ensure declared once globally in webRTC.js) =====
let _npc_lastPos = null;
let _npc_lastQuat = null;
let _npc_lastSendTime = 0;
let _npc_forceSendTimer = null;
let _npc_sendIntervalHandle = null;   // previously undefined -> ReferenceError
let _npc_forceTimer = null;           // alias used by some functions; keep both safe
let existingNPC = null

window.npcModelName = null;

// Voice chat instance 
// --- Voice Chat globals ---
let localAudioStream = null;
let micSender = null;
let isMicActive = false;
let remoteAudioEls = new Map(); // key: peerId, value: HTMLAudioElement
let isTalking = false;
const audioCtx = new window.AudioContext();
const remoteAudioNodes = new Map(); // peerId -> { source, panner, gain }
window.audioCtx = audioCtx;
window.remoteAudioNodes = remoteAudioNodes;

async function enableVoiceChat(pc) {
  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 48000,
        sampleSize: 16,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        googEchoCancellation: true,    // Older, but sometimes necessary for max effect
        googNoiseSuppression: true,    
        googAutoGainControl: true,
        googHighpassFilter: true,      // Filters out low-frequency rumbles/hums
      },
    });
    console.log("[Voice] Microphone access enabled");

    // --- 🎧 Clean and compress mic audio before sending ---
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(localAudioStream);
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-30, audioCtx.currentTime);
    compressor.knee.setValueAtTime(40, audioCtx.currentTime);
    compressor.ratio.setValueAtTime(12, audioCtx.currentTime);
    compressor.attack.setValueAtTime(0, audioCtx.currentTime);
    compressor.release.setValueAtTime(0.25, audioCtx.currentTime);

    const dest = audioCtx.createMediaStreamDestination();
    source.connect(compressor);
    compressor.connect(dest);

    // --- 🎤 Use processed stream for WebRTC ---
    const processedStream = dest.stream;
    const audioTrack = processedStream.getAudioTracks()[0];
    if (audioTrack) {
      micSender = pc.addTrack(audioTrack, processedStream);
      const params = micSender.getParameters();
      if (!params.encodings) params.encodings = [{}];
      params.encodings[0].maxBitrate = 128000; // fullband Opus
      await micSender.setParameters(params).catch(console.warn);
      console.log("[Voice] Audio track (processed) added to PeerConnection");
    }

    window.localAudioStream = localAudioStream;
    isMicActive = true;
  } catch (error) {
    console.error("[Voice] Failed to access microphone:", error);
  }
}

function initVoiceUI() {
  const btn = document.createElement("button");
  btn.id = "voiceBtn";
  btn.textContent = "🎙️ Clic to Talk";
  btn.style.position = "absolute";
  btn.style.bottom = "20px";
  btn.style.right = "20px";
  btn.style.padding = "10px 16px";
  btn.style.zIndex = 9999;
  btn.style.borderRadius = "8px";
  btn.style.background = "rgba(0,0,0,0.6)";
  btn.style.color = "white";
  btn.style.fontSize = "14px";
  btn.style.cursor = "pointer";
  btn.style.border = "1px solid rgba(255,255,255,0.25)";
  btn.style.userSelect = "none";
  document.body.appendChild(btn);

  // Push-to-talk (press and hold)
  btn.onclick = (event) =>{
    if (event) event.preventDefault();
    if (isTalking) {
      // If currently talking, stop it
      btn.style.background = "rgba(0,0,0,0.6)";
      stopTalking();
      // Optional: You might want to update the button appearance here
      // btn.classList.remove('active');
    } else {
      // If currently silent, start talking
      btn.style.background = "green";
      startTalking();
      // Optional: You might want to update the button appearance here
      // btn.classList.add('active');
    }

    // Flip the state
    isTalking = !isTalking;
  }

}

function startTalking() {
  if (!localAudioStream) return;

  localAudioStream.getAudioTracks().forEach(t => t.enabled = true);
  isMicActive = true;
  console.log("[Voice] Mic ON (talking)");

  // 🔊 Create local playback if not already present
  let loop = document.getElementById("local-loopback-audio");
  if (!loop) {
    loop = document.createElement("audio");
    loop.id = "local-loopback-audio";
    loop.srcObject = localAudioStream;
    loop.autoplay = true;
    loop.muted = false;
    loop.playsInline = true;
    loop.volume = 1;
    document.body.appendChild(loop);

    loop.play().then(() => {
      console.log("[Voice] Local loopback playing");
    }).catch(err => {
      console.warn("[Voice] Loopback blocked:", err);
    });
  }
}


function stopTalking() {
  // Assuming localAudioStream and isMicActive are defined in a wider scope
  if (!localAudioStream) return;
  localAudioStream.getAudioTracks().forEach(t => t.enabled = false);
  isMicActive = false;
  console.log("[Voice] Mic OFF");
}


// Lazy access helpers (always use these inside webRTC.js instead of globalRefs directly)
function getScene()       { return _sharedRefs.scene || null; }
function getTpView()      { return _sharedRefs.tpView || null; }
function getCrowd()      { return _sharedRefs.crowd || null; }
function getAgentsFunc() { return _sharedRefs.getAgents ? _sharedRefs.getAgents() : new Map(); }
function stopTour(npc) {return _sharedRefs.stopTour ? _sharedRefs.stopTour(npc) : null;}




function vecDistance(a, b) {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}
function quatDot(q1, q2) {
  return q1.x*q2.x + q1.y*q2.y + q1.z*q2.z + q1.w*q2.w;
}
function quatAngleDelta(q1, q2) {
  // angle between two unit quaternions
  const dot = Math.min(1, Math.max(-1, Math.abs(quatDot(q1,q2))));
  return Math.acos(dot) * 2;
}

function getNPCState() {
  // prefer local variable npcModel if available in index.js scope (index.js already has getCurrentNPCState export)
  try {
    if (typeof getCurrentNPCState === "function") {
      // if index.js provides an exported function, call it
      return getCurrentNPCState();
    }
  } catch (e) { /* fallthrough */ }

  // fallback: try module variable npcModel if present
  if (typeof npcModel !== "undefined" && npcModel) {
    return { p: { x: npcModel.position.x, y: npcModel.position.y, z: npcModel.position.z },
            q: { x: npcModel.quaternion.x, y: npcModel.quaternion.y, z: npcModel.quaternion.z, w: npcModel.quaternion.w }};
  }
  return null;
}


function sendNPCStateBinaryFromState(st) {
  if (!dc || dc.readyState !== "open") throw new Error("dc not open");
  const buf = new ArrayBuffer(1 + 7*4);
  const dv = new DataView(buf);
  dv.setUint8(0, 4); // type = 4 (npc_state)
  dv.setFloat32(1 + 0*4, st.p.x, true);
  dv.setFloat32(1 + 1*4, st.p.y, true);
  dv.setFloat32(1 + 2*4, st.p.z, true);
  dv.setFloat32(1 + 3*4, st.q.x, true);
  dv.setFloat32(1 + 4*4, st.q.y, true);
  dv.setFloat32(1 + 5*4, st.q.z, true);
  dv.setFloat32(1 + 6*4, st.q.w, true);

    // name length and name bytes
  const nameLenOffset = 1 + 7*4;
  dv.setUint8(nameLenOffset, nameLen);
  if (nameLen > 0) {
    u8.set(nameBytes.subarray(0, nameLen), nameLenOffset + 1);
  }

  dc.send(buf);
  return buf.byteLength;
}

function sendNPCStateJSONFromState(st) {
  if (!dc || dc.readyState !== "open") throw new Error("dc not open");
  const msg = { t: "npc_state", p: [st.p.x, st.p.y, st.p.z], q: [st.q.x, st.q.y, st.q.z, st.q.w], npcName: st.npcName || null , camPos: st.camPos || null, camLookAt: st.camLookAt || null };
  dc.send(JSON.stringify(msg));
}

// ============================================================================
// 🧭 Tour lifecycle event handlers (non-host stop fix)
// ============================================================================

// When host stops the tour — make sure non-host regains control.
// When host broadcasts tour stop, clients run this to stop NPC + restore control
window.addEventListener("tour-stop", (ev) => {
  const msg = ev?.detail || {};
  const npcName = msg.npcName || null;
  console.log("[Tour] Received tour-stop", npcName ? ("npc=" + npcName) : "");

  try {
    // --- 1) Restore local player control / stop following ---
    const tp = getTpView?.();
    const fp = (typeof window !== 'undefined' ? window.fpView : null); // keep same style
    if (tp) {
      tp.isTouring = false;
      tp.remoteControlled = false;
      if (typeof tp.stopFollowAgent === 'function') try { tp.stopFollowAgent(); } catch(e) {}
      if (typeof tp.setHost === 'function') try { tp.setHost(false); } catch(e) {}
    }
    if (fp) {
      fp.isTouring = false;
      fp.remoteControlled = false;
      if (typeof fp.stopFollowAgent === 'function') try { fp.stopFollowAgent(); } catch(e) {}
      if (typeof fp.setHost === 'function') try { fp.setHost(false); } catch(e) {}
    }

    // --- 2) Stop the NPC agent(s) on this client ---
    const agentsMap = getAgentsFunc ? getAgentsFunc() : null;
    if (agentsMap && typeof agentsMap.values === "function") {
      for (const entry of agentsMap.values()) {
        if (!entry || !entry.model) continue;
        const model = entry.model;
        // Candidate matching:
        const matchByName = npcName && (model.name === npcName || model.userData?.tourId === npcName);
        const remoteControlled = !!model.userData?.remoteControlled;
        // If npcName specified, stop that specific NPC. Otherwise stop any remoteControlled NPC.
        if ((npcName && matchByName) || (!npcName && remoteControlled)) {
          try {
            // call CrowdManager stop if available. stopAgentTour expects entry or agent
            if (typeof stopTour === 'function') {
              stopTour(entry);
              entry.state.touring = false;
            } else if (entry.agent && typeof entry.agent.stop === 'function') {
              entry.state.touring = false;
              entry.agent.stop();
              
            }
          } catch (e) {
            console.warn("[Tour] stopTour failed for", model.name, e);
          }
          // clear flags so client doesn't continue applying remote transforms
          try {
            model.userData.remoteControlled = false;
            model.userData.externalPos = null;
            model.userData.externalQuat = null;
            if (entry.state) {
              entry.state.isOnTour = false;
              entry.state.mode = 'idle';
              entry.state.tourFacingQuat = null;
              entry.state.preventRotationUntil = null;
            }
          } catch (e) {}
          console.log("[Tour] Stopped NPC on client:", model.name);
        }
      }
    }

    // --- 3) Clear webRTC internal tour helper state ---
    try {
      // stop any NPC throttled sender if host left
      if (typeof stopNPCThrottledSender === 'function') stopNPCThrottledSender();
      _remoteNPCEntry = null;
      window.npcModelName = null;
    } catch (e) {}
  } catch (err) {
    console.warn("[Tour] tour-stop handler error:", err);
  }
});



// Helper: send a one-time authoritative npc_state (including camera) as JSON.
// Use this from the host when starting a tour or when a participant joins to ensure
// immediate snap behavior on non-host clients.
function sendNpcSnap(npcModel) {
  if (!dc || dc.readyState !== "open") return false;
  try {
    if (!npcModel) {
      // try to get state from getNPCState() helper if available
      try {
        const st = getNPCState();
        if (st) {
          const payload = { t: 'npc_state', p: [st.p.x, st.p.y, st.p.z], q: [st.q.x, st.q.y, st.q.z, st.q.w], npcName: st.npcName || null, camPos: st.camPos || null, camLookAt: st.camLookAt || null };
          dc.send(JSON.stringify(payload));
          console.info('[Tour] sendNpcSnap: sent snapshot from getNPCState');
          return true;
        }
      } catch (e) { /* fallthrough */ }
      return false;
    }

    const npcName = npcModel.name || (npcModel.userData && npcModel.userData.tourId) || (`NPC_${Date.now()}`);
    const cam = (typeof window !== 'undefined' && window.camera) ? window.camera : null;
    let camPos = null;
    let camLookAt = null;
    try {
      if (cam) {
        camPos = { x: cam.position.x, y: cam.position.y, z: cam.position.z };
        // compute lookAt using a forward vector or using a small offset if available
        const forward = new THREE.Vector3(0,0,-1).applyQuaternion(cam.quaternion).add(cam.position);
        camLookAt = { x: forward.x, y: forward.y, z: forward.z };
      }
    } catch (e) { /* ignore camera extraction errors */ }

    const msg = {
      t: 'npc_state',
      p: [ npcModel.position.x, npcModel.position.y, npcModel.position.z ],
      q: [ npcModel.quaternion.x, npcModel.quaternion.y, npcModel.quaternion.z, npcModel.quaternion.w ],
      npcName,
      camPos,
      camLookAt
    };
    dc.send(JSON.stringify(msg));
    console.info('[Tour] sendNpcSnap: broadcast snapshot for', npcName);
    return true;
  } catch (e) {
    console.warn('[Tour] sendNpcSnap failed', e);
    return false;
  }
}



// main throttled loop
function trySendNPCState(force=false) {
  if (!dc || dc.readyState !== "open") return;
  const st = getNPCState();
  if (!st) return;

  const now = performance.now();
  const sinceLast = now - _npc_lastSendTime;

  if (!force && _npc_lastPos && _npc_lastQuat) {
    const posDelta = vecDistance(st.p, _npc_lastPos);
    const angDelta = quatAngleDelta(st.q, _npc_lastQuat);
    if (posDelta < NPC_MIN_POS_DELTA && angDelta < NPC_MIN_ANGLE_DELTA && sinceLast < NPC_SEND_INTERVAL_MS) {
      return; // nothing notable changed
    }
  }
  if (!force && sinceLast < (NPC_SEND_INTERVAL_MS)) return; // debounce

  try {
    const bytes = sendNPCStateBinaryFromState(st);
    npcSentBytes += bytes;
    npcSentPackets += 1;
  } catch (err) {
    // fallback to JSON
    try {
      sendNPCStateJSONFromState(st);
      const guessLen = JSON.stringify({ t: "npc_state", p:[st.p.x,st.p.y,st.p.z], q:[st.q.x,st.q.y,st.q.z,st.q.w], npcName: st.npcName || null}).length;
      npcSentBytes += guessLen;
      npcSentPackets += 1;
    } catch (e2) {
      console.warn("[NPC_NET] both binary and JSON send failed", e2);
    }
  }

  _npc_lastSendTime = now;
  _npc_lastPos = st.p;
  _npc_lastQuat = st.q;
}

// throttled sender
function startNPCThrottledSender() {
  if (_npc_sendIntervalHandle) return;
  _npc_lastSendTime = performance.now();
  _npc_lastPos = null;
  _npc_lastQuat = null;

  // ensure we force-send at least every NPC_FORCE_SEND_MS
  if (_npc_forceSendTimer) clearInterval(_npc_forceSendTimer);
  _npc_forceSendTimer = setInterval(() => {
    trySendNPCState(true);
  }, NPC_FORCE_SEND_MS);

  _npc_sendIntervalHandle = setInterval(() => {
    trySendNPCState(false);
    // instrumentation logging once per 5s
    const now = performance.now();
    if (now - npcLastInstrumentationTime > 5000) {
      // console.info(`[NPC_NET] sent ${npcSentPackets} pkts, ${ (npcSentBytes/1024).toFixed(1) } KB in last ${(now - npcLastInstrumentationTime)/1000}s`);
      npcSentBytes = 0;
      npcSentPackets = 0;
      npcLastInstrumentationTime = now;
    }
  }, NPC_SEND_INTERVAL_MS);
}

function stopNPCThrottledSender() {
  if (_npc_sendIntervalHandle) {
    clearInterval(_npc_sendIntervalHandle);
    _npc_sendIntervalHandle = null;
  }
  if (_npc_forceSendTimer) {
    clearInterval(_npc_forceSendTimer);
    _npc_forceSendTimer = null;
  }
}

// UI for remote to accept a tour invite
function showJoinTourButton(hostId, npcName) {
  // avoid duplicate buttons
  if (document.getElementById(`join-tour-btn-${npcName}`)) return;

  const btn = document.createElement("button");
  btn.id = `join-tour-btn-${npcName}`;
  btn.textContent = "Join Room Tour";
  btn.style.position = "absolute";
  btn.style.top = "12px";
  btn.style.right = "12px";
  btn.style.padding = "8px 12px";
  btn.style.zIndex = 99999;
  btn.style.background = "rgba(0,0,0,0.7)";
  btn.style.color = "white";
  btn.style.border = "1px solid rgba(255,255,255,0.12)";
  btn.style.borderRadius = "6px";
  document.body.appendChild(btn);

  const removeBtn = () => { try { btn.remove(); } catch (e) {} };

  btn.onclick = () => {
    // send acceptance to host
    try {
      const msg = { t: "tour_joined", from: PEER_ID, to: hostId, npcName };
      if (dc && dc.readyState === "open") dc.send(JSON.stringify(msg));
    } catch (e) { console.warn("tour_joined send failed", e); }

    // start local follow immediately
    try {
      startLocalRoomTourMode(npcName);
    } catch (e) {
      console.warn("startLocalRoomTourMode failed:", e);
    }

    removeBtn();
  };

  // auto-remove after 12s if not clicked
  setTimeout(removeBtn, 12000);
}

// Create a lightweight placeholder NPC in the local scene so remote can find it by name.
// state: { name, p: [x,y,z], q: [x,y,z,w], footOffset }
function createPlaceholderNPC(state) {
  try {
    if (!state || !state.name) return null;
    const scn = getScene ? getScene() : (typeof window !== 'undefined' ? window.scene : null);
    if (!scn) {
      console.warn("[placeholderNPC] scene not ready, cannot create placeholder for", state.name);
      return null;
    }
    // if already exists, return it
    const existing = scn.getObjectByName ? scn.getObjectByName(state.name) : null;
    if (existing) return existing;

    if (typeof window.THREE === "undefined") {
      console.warn("[placeholderNPC] THREE not available to create placeholder mesh");
      // create empty object only if possible
      const g = { name: state.name, position: { x: state.p[0], y: state.p[1], z: state.p[2] }, quaternion: { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] } };
      return g;
    }

    // create a simple Group with a small visual marker (box) so it's visible
    const group = new window.THREE.Group();
    group.name = state.name;
    group.position.set(state.p[0], state.p[1], state.p[2]);
    group.quaternion.set(state.q[0], state.q[1], state.q[2], state.q[3]);
    group.userData = group.userData || {};
    group.userData.tourId = state.name;
    group.userData.footOffset = state.footOffset || 0;

    // small visible cube marker so remote can visually confirm
    try {
      const geo = new window.THREE.BoxGeometry(0.3, 0.3, 0.3);
      const mat = new window.THREE.MeshBasicMaterial({ color: 0xff66ff, transparent: true, opacity: 0.9 });
      const mesh = new window.THREE.Mesh(geo, mat);
      mesh.position.set(0, 0.15 + (group.userData.footOffset || 0), 0);
      mesh.name = state.name + "_marker";
      group.add(mesh);
    } catch (e) {
      // ignore if geometry/material creation fails
    }

    scn.add(group);
    console.info("[placeholderNPC] created placeholder for", state.name, "at", group.position);
    return group;
  } catch (err) {
    console.warn("[placeholderNPC] create failed:", err);
    return null;
  }
}



// Called when user accepts tour invite. Hook your local NPC-follow behavior here.
// index.js — helper to start local room tour following a host NPCName
// requires: window.tpView (ThirdPersonPlayer instance), CrowdManager (imported or exposed), scene, navQuery



// start local tour mode following the NPC with given name
export async function startLocalRoomTourMode(npcName) {
  const scene = getScene();
  const tpView = getTpView();
  const agentsMap = getAgentsFunc();                // this returns a Map (not a function)
  console.log("startLocalRoomTourMode: agentsMap is", agentsMap);
  const crowd = getCrowd();

  if (!tpView) {
    console.warn("startLocalRoomTourMode: tpView not ready yet.");
    return false;
  }
  if (!scene) {
    console.warn("startLocalRoomTourMode: scene not ready yet.");
    return false;
  }

  // --- Find NPC model in scene ---
  let npcModel = scene.getObjectByName ? scene.getObjectByName(npcName) : null;
  if (!npcModel) {
    scene.traverse?.(obj => { if (!npcModel && obj.name === npcName) npcModel = obj; });
  }

  // --- Find existing crowd entry using agentsMap (Map) ---
  let entry = null;
  try {
    if (agentsMap && agentsMap.size > 0) {
      for (const val of agentsMap.values()) {
        if (!val) continue;
        console.warn("AGENT ENTRY IN startRoomTourMode:", val);
        if (val.userData?.model === npcModel) {
          entry = val;
          console.log("startLocalRoomTourMode: found existing agent entry for NPC:", npcName, entry);
          break;
        }
      }
    }
  } catch (e) {
    console.warn("startLocalRoomTourMode: getAgents() failed:", e);
  }


  // --- If still not found, create fallback agent (use addAgent if available, else make a minimal fake agent) ---
  if (!entry) {
    console.warn("No existing agent found for NPC; creating fallback agent...");
    try {
      const pos = npcModel.position || new window.THREE.Vector3(0,0,0);

      if (typeof _sharedRefs.addAgent === "function") {
        // addAgent might be async or sync; handle both
        let newAgent;
        try { newAgent = _sharedRefs.addAgent({ x: pos.x, y: pos.y, z: pos.z }); }
        catch (err) {
          console.log("[ startLocalRoomTour ] Fail to add agent to crowd: ", err)
        }
        entry = { agent: newAgent, model: npcModel, state: {} };
      } else {
        // Minimal fake agent so tpView can still follow. This is a degraded fallback.
        console.warn("startLocalRoomTourMode: addAgent() not available; creating minimal fallback agent object.");
        const fakeAgent = {
          position: { x: pos.x, y: pos.y, z: pos.z },
          teleport(p) { this.position = { x: p.x, y: p.y, z: p.z }; },
          userData: { model: npcModel }
        };
        entry = { agent: fakeAgent, model: npcModel, state: {} };
      }
    } catch (err) {
      console.warn("startLocalRoomTourMode: addAgent() failed:", err);
      return false;
    }
  }

  // --- Ensure tpView has a crowd agent, then start follow ---
  try {
    if (!tpView.crowdAgent) {
      if (typeof _sharedRefs.addThirdPersonToCrowd === "function") {
        await _sharedRefs.addThirdPersonToCrowd(scene, crowd, tpView);
      } else {
        console.warn("addThirdPersonToCrowd not available; assuming tpView already has crowdAgent or setCrowdAgent will be used");
      }
    }

    if (!tpView.crowdAgent && typeof tpView.setCrowdAgent === "function" && entry.agent) {
      tpView.setCrowdAgent(entry.agent);
    }

    const followOptions = { mode: 'side', offsetSide: 0.8, offsetBehind: 0.12, heightOffset: 0, followSide: 'left' };
    if (typeof tpView.startFollowAgent === "function") {
      tpView.startFollowAgent(entry, followOptions);
    } else {
      console.warn("tpView has no startFollowAgent API; cannot start follow");
      return false;
    }

    tpView.isTouring = true;
    console.info("[tour] Started local follow of NPC:", npcName);
    return true;
  } catch (err) {
    console.warn("startLocalRoomTourMode failed:", err);
    return false;
  }
}



// Export small helpers for console/debug
window._HOST_ASSIGNED = false;




  // in webRTC.js
  Object.assign(window.gameAPI, { addRemotePlayer, updateRemotePlayerState, removeRemotePlayer, updateRemotePlayers });

const SEND_INTERVAL = 100; //ms => 10Hz (Each 10 ms , the data will be send to the backend)
// const ICE_CONFIG = {
//   iceServers: [
//     { urls: ["stun:stun.l.google.com:19302"] },
//     // optionally the page may set window.TURN_URL/TURN_USER/TURN_PASS
//     ...(window.TURN_URL ? [{ urls: [window.TURN_URL], username: window.TURN_USER || "", credential: window.TURN_PASS || "" }] : [])
//   ]
// };
const ICE_CONFIG = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302"] }
  ],
  iceTransportPolicy: "all"
};


export async function initConnection() {
  console.log("[WebRTC] Connecting to SFU... room:", ROOM_ID, "peer:", PEER_ID);
  // create RTCPeerConnection
  pc = new RTCPeerConnection(ICE_CONFIG);

  pc.getSenders().forEach(sender => {
  if (sender.track && sender.track.kind === "audio") {
    const params = sender.getParameters();
    if (!params.encodings) params.encodings = [{}];
    params.encodings[0].maxBitrate = 256000;
    params.degradationPreference = "maintain-framerate";

    sender.setParameters(params).catch(console.warn);
  }
});


  // Receive and play incoming audio streams
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (!stream) return;

    // Derive peerId (you can enhance this later to map by sender)
    const peerKey = `peer-${remoteAudioNodes.size + 1}`;
    console.log("[Voice] Received remote audio track:", peerKey);

    // --- Create 3D spatial audio pipeline ---
    const source = audioCtx.createMediaStreamSource(stream);
    const panner = audioCtx.createPanner();
    const gain = audioCtx.createGain();

    // Configure the 3D panner for spatial realism
    panner.panningModel = "HRTF"; // better spatial realism
    // panner.distanceModel = "inverse";
    panner.refDistance = 1.0; // distance at which sound is full volume
    panner.maxDistance = 50.0;
    panner.rolloffFactor = 1.0; // how fast sound fades with distance
    panner.coneInnerAngle = 180;
    panner.coneOuterAngle = 230;
    panner.coneOuterGain = 0.2;
    panner.distanceModel = "exponential";
    panner.rolloffFactor = 2.0;


    // Chain nodes → audioCtx.destination
    source.connect(panner);
    panner.connect(gain);
    gain.connect(audioCtx.destination);

    // Save for future updates
    remoteAudioNodes.set(peerKey, { source, panner, gain, stream });
  };
  await enableVoiceChat(pc);
  initVoiceUI();


  // Data channel for game-state
  dc = pc.createDataChannel("gamedata", { ordered: true });
  dc.binaryType = "arraybuffer"; // <--- ensure binary arrives as ArrayBuffer
  dc.onopen = onDataOpen;
  dc.onmessage = (e) => {
    try {
      if (typeof e.data === "string") {
        console.debug("[WebRTC] DC recv (text):", e.data.slice(0,200));
        onDataMessage(e.data);
      } else if (e.data instanceof ArrayBuffer || ArrayBuffer.isView(e.data)) {
        // Prefer binary handler
        console.debug("[WebRTC] DC recv (binary)", e.data.byteLength || e.data.length);
        try { 
          // NOTE: SFU broadcasts will typically not attach sender metadata to datachannel payloads.
          // If you rely on knowing the peer id for each binary packet, encode it into the packet
          // or ensure the client first sends a JSON "join" (we already do that on open).
          onDataMessageBinary({ data: e.data }, /*senderId=*/null);
        } catch (err) {
          console.warn("[WebRTC] binary handler error, falling back to JSON attempt", err);
          // attempt to parse as text fallback
          try { onDataMessage(new TextDecoder().decode(e.data)); } catch (e2) {}
        }
      } else {
        console.warn("[WebRTC] DC recv unknown data type", typeof e.data, e);
      }
    } catch (err) {
      console.error("[WebRTC] dc.onmessage top-level error:", err);
    }
  };

  dc.onclose = () => console.log("[WebRTC] Data channel closed");
  

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      console.log('[client pc] ICE candidate:', e.candidate.candidate);
    } else {
      console.log('[client pc] ICE gathering complete');
    }
  };
  pc.oniceconnectionstatechange = () => console.warn('[client pc] iceConnectionState ->', pc.iceConnectionState);
  pc.onconnectionstatechange = () => console.warn('[client pc] connectionState ->', pc.connectionState);
  pc.onsignalingstatechange = () => console.warn('[client pc] signalingState ->', pc.signalingState);


  pc.onconnectionstatechange = () => {
    console.log("[WebRTC] connectionState:", pc.connectionState);
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) cleanup();
  };

  // create offer and send to SFU
  const joinUrl = `${API_BASE}/join?room=${encodeURIComponent(ROOM_ID)}&peer=${encodeURIComponent(PEER_ID)}`;
  const answer = await createAndSendOffer(pc, joinUrl);
  console.log('[WebRTC] SFU answer received (object):', answer);


  console.log('[WebRTC] SFU answer received (object):', answer);
  // keep pc/dc around; onDataOpen will start periodic sending
}

// --- Create offer and wait for ICE gathering to finish BEFORE sending to SFU ---
async function createAndSendOffer(pc, joinUrl) {
  const offer = await pc.createOffer({
    // you can set offerToReceiveAudio/video if needed for getUserMedia flows
  });
  await pc.setLocalDescription(offer);

  // Wait for ICE gathering complete (or a small timeout)
  await new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    // safety timeout in 3s in case it stalls (adjust as needed)
    setTimeout(() => {
      try { pc.removeEventListener('icegatheringstatechange', onChange); } catch (e) {}
      resolve();
    }, 3000);
  });

  // Now pc.localDescription should include ICE candidates -> post to SFU
  const localDesc = pc.localDescription;
  const body = (localDesc && localDesc.sdp) ? JSON.stringify(localDesc) : JSON.stringify(offer);
  const resp = await fetch(joinUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
  if (!resp.ok) {
    const text = await resp.text().catch(()=>null);
    console.error("[WebRTC] join HTTP failed status", resp.status, "body:", text);
    throw new Error(`[WebRTC] SFU join failed: ${resp.status} ${text||''}`);
  }
  // Server should reply with JSON SDP. Avoid throwing on parse error: log full body to debug.
  const text = await resp.text();
  try {
    const answer = JSON.parse(text);
    await pc.setRemoteDescription(answer);
    return answer;
  } catch (err) {
    console.error("[WebRTC] Failed to parse SFU answer JSON. body length:", (text||"").length, "err:", err);
    // help server-side debugging: throw with full string (do not swallow)
    throw new Error("invalid JSON answer: " + err.message + " -- body: " + (text ? text.slice(0,2000) : "<empty>"));
  }
}


// Called when DataChannel is open
function onDataOpen() {
  console.log("[WebRTC] Data channel open");
  isHost = window._HOST_ASSIGNED;
  console.warn(`[WebRTC] Data channel open — you are ${isHost ? "HOST" : "CLIENT"}`);


  // announce ourselves via JSON (easy for debug)
  sendLocalState({ t: "join", id: PEER_ID, ts: Date.now() }); // keep JSON join for debugging
  // also send a tiny binary join (type=1) so binary-only clients can see it

  // also send binary join with id (type=1)
  try {
    const idBytes = new TextEncoder().encode(PEER_ID);
    if (idBytes.length <= 255) {
      const buf = new ArrayBuffer(1 + 1 + idBytes.length);
      const u8 = new Uint8Array(buf);
      u8[0] = 1; // join
      u8[1] = idBytes.length;
      u8.set(idBytes, 2);
      dc.send(buf);
    }
  } catch (e) { /* ignore */ }

  // send binary states at freq
  if (sendTimer) clearInterval(sendTimer);
    sendTimer = setInterval(() => {
    // if (!isHost) return; // 🚫 prevent non-host from sending

    const st = getLocalPlayerState ? getLocalPlayerState() : null;
    if (!st) return;
    try {
      // Debug
      // console.log("Send state:", st.camPos, st.camLookAt);
      sendLocalStateBinary(st);
    } catch (e) {
      sendLocalState({ t: "state", id: PEER_ID, p: st.p, q: st.q, ts: Date.now() });
    }
  }, SEND_INTERVAL);

}

// Debug helper - run in console after initConnection()
function dumpLocalSDPShort() {
  if (!pc || !pc.localDescription) return console.warn("no localDescription yet");
  console.log("local sdp length:", pc.localDescription.sdp.length);
  console.log(pc.localDescription.sdp.slice(0,800));
}
window.dumpLocalSDPShort = dumpLocalSDPShort;


// When data arrives from peers
// webRTC.js — replace existing onDataMessage function
function onDataMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.t) {
    case "state":
      if (msg.id === PEER_ID) return;
      if (typeof addRemotePlayer === "function") addRemotePlayer(msg.id, 1);
      if (typeof updateRemotePlayerState === "function") updateRemotePlayerState(msg.id, msg);
      break;

    case "join":
      if (msg.id === PEER_ID) return;
      if (typeof addRemotePlayer === "function") addRemotePlayer(msg.id, 1);

      break;

    case "leave":
      if (typeof removeRemotePlayer === "function") removeRemotePlayer(msg.id);
      break;

    case "tour":
      // legacy support: simple tour command
      if (msg.cmd === "start") window.dispatchEvent(new CustomEvent("tour-start", { detail: msg }));
      if (msg.cmd === "stop") window.dispatchEvent(new CustomEvent("tour-stop", { detail: msg }));
      break;

    case "tour_invite": {
      const hostId = msg.from || null;
      const npcName = msg.npcName || null;
      const npcSnapshot = msg.npcState || null;

      // existingNPC = scene?.children?.find(o => o.name.startsWith("NPC_tour_"));
      const NPC = getAgentsFunc ? getAgentsFunc() : null;
      if (NPC.size <= 0){
        console.warn("[Tour] No agents map available to find existing NPC.");
        return;
      }
      window.NPC = NPC;
      if (NPC.size > 0) {
        existingNPC = NPC.values().next().value.userData.model

        existingNPC.name = npcName;
        existingNPC.animCtrl = existingNPC.animCtrl || {};
        existingNPC.animationCtrl = existingNPC.animationCtrl || {};
        existingNPC.userData = existingNPC.userData || {};
        existingNPC.userData.name = npcName;
        existingNPC.userData.tourId = npcName;
        console.info("[Tour] Renamed existing NPC to match host:", npcName);
        window.EXISTING_NPC = existingNPC;
      }

      console.warn("[Tour] Received tour_invite for NPC:", npcName, "existingNPC is", existingNPC);


      
      // --- Relink the existing crowd agent to this renamed NPC ---
      try {
        const agentsMap = getAgentsFunc?.();
        if (agentsMap && typeof agentsMap.values === "function") {
          for (const val of agentsMap.values()) {
            if (val?.model && val.model.userData?.tourId?.startsWith("NPC_tour_")) {
              // Link to the renamed NPC
              val.model = existingNPC;
              if (val?.userData) val.userData.model = existingNPC;
              console.log("[Tour] Linked crowd agent to renamed NPC:", npcName);
            }
          }
        }
      } catch (err) {
        console.warn("[Tour] Failed to relink crowd agent:", err);
      }

      console.log("[WebRTC] Received tour_invite from host:", hostId, 
                  "npcName =", npcName, 
                  "hasSnapshot =", !!npcSnapshot);


      // ✅ Show the join button so the user can accept the tour
      if (typeof showJoinTourButton === "function") {
        showJoinTourButton(hostId, npcName);
      }
      break;
    }

    case "tour_joined":
      // Host receives confirmations from participants
      // msg.from = joining peer id, msg.to = host id
      if (msg.to && msg.to === PEER_ID) {
        console.info(`[Tour] peer ${msg.from} confirmed join`);
        // optionally send immediate NPC sync to new participant (sendNPCStateBinaryFromState or JSON)
        // Send a one-time authoritative snap (including camera) to help the joining client snap exactly
        try {
          // prefer to send snapshot for current NPC state
          const scene = getScene();
          let npcModel = null;
          try { if (msg.npcName && scene && scene.getObjectByName) npcModel = scene.getObjectByName(msg.npcName); } catch(e){}
          // fallback: ask getNPCState helper
          if (!npcModel && typeof getNPCState === "function") {
            try { const st = getNPCState(); if (st && st.npcModel) npcModel = st.npcModel; } catch(e){}
          }
          // finally, send a snap (if npcModel not available, send via getNPCState inside sendNpcSnap)
          sendNpcSnap(npcModel);
        } catch (e) { console.warn('sendNpcSnap on tour_joined failed', e); }
      }
      break;

    case "npc_state":
      // forwarded JSON NPC state (fallback). Prefer binary handler but handle JSON too.
      if (typeof updateNPCRemoteState === "function") {
        updateNPCRemoteState(msg);
      }
      break;

    default:
      // unknown message type
      break;
  }
}


// e = event object (dc.onmessage passes event). senderId optional (if SFU attaches metadata).
function onDataMessageBinary(e, senderId = null) {
  try {
    const arr = (e.data instanceof ArrayBuffer)
      ? new Uint8Array(e.data)
      : (ArrayBuffer.isView(e.data)
      ? new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)
      : new Uint8Array(e.data)
    ); // <-- The ternary expression for 'arr' is now correctly closed.

    try { 
      if (npcModel && tpView && tpView.model) {
        // snap visual rotation
        tpView.model.quaternion.copy(npcModel.quaternion);
        // keep camera smoothing aligned so there's no visual jump
        if (tpView.tempQuaternion) tpView.tempQuaternion.copy(tpView.model.quaternion);
        // ensure smoothed position aligns to avoid camera offset
        if (tpView._smoothedPlayerPosition && tpView.playerCollider && tpView.playerCollider.end) {
          tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
        }
      }
    } catch (e) { /* non-fatal */ }


    if (!arr || arr.length === 0) return;

    // Treat '{' or '[' as JSON fallback
    if (arr[0] === 123 || arr[0] === 91) {
      try {
        const txt = new TextDecoder("utf-8").decode(arr);
        const parsed = JSON.parse(txt);
        if (typeof onDataMessage === "function") onDataMessage(JSON.stringify(parsed));
      } catch (err) {
        console.warn("[WebRTC] JSON-from-binary parse error:", err);
      }
      return;
    }

    const type = arr[0]; // 0=state, 1=join, 2=leave, 3=tour-start, 4=npc_state

    // ───────────────────────────────────────────────
    // 🧠 TYPE 0 — EXTENDED PLAYER STATE (p, q, camPos, camLookAt)
    // ───────────────────────────────────────────────
    if (type === 0) {
      const idLen = arr[1];
      const headerLen = 1 + 1 + idLen;
      if (arr.length < headerLen + (13 * 4)) return; // need 13 floats

      const idBytes = arr.slice(2, 2 + idLen);
      const peerId = idBytes.length
        ? new TextDecoder().decode(idBytes)
        : senderId || ("remote_" + Math.random().toString(36).slice(2, 8));

      const dv = new DataView(arr.buffer, arr.byteOffset + headerLen);

      // floats: p(3), q(4), camPos(3), camLookAt(3)
      const floats = [];
      for (let i = 0; i < 13; i++) floats[i] = dv.getFloat32(i * 4, true);
      let offset = 13 * 4;

      // animation + timestamp
      let animCode = ANIM_IDLE;
      let timestamp = 0;
      if (arr.length >= headerLen + offset + 1) {
        animCode = dv.getUint8(offset); offset += 1;
      }
      if (arr.length >= headerLen + offset + 2) {
        timestamp = dv.getUint16(offset, true); offset += 2;
      }

      // translate anim code → label
      let anim = "idle";
      if (animCode === ANIM_WALK) anim = "walk";
      else if (animCode === ANIM_RUN) anim = "run";

      // construct message identical to JSON fallback
      const msg = {
        t: "state",
        id: peerId,
        p: [floats[0], floats[1], floats[2]],
        q: [floats[3], floats[4], floats[5], floats[6]],
        camPos: { x: floats[7], y: floats[8], z: floats[9] },
        camLookAt: { x: floats[10], y: floats[11], z: floats[12] },
        a: anim,
        ts: timestamp
      };

      // Update / spawn remote player
      if (typeof addRemotePlayer === "function") addRemotePlayer(peerId, 1);
      if (typeof updateRemotePlayerState === "function") updateRemotePlayerState(peerId, msg);
      return;
    }

    // ───────────────────────────────────────────────
    // TYPE 1 — join
    // ───────────────────────────────────────────────
    if (type === 1) {
      const idLen = arr[1] || 0;
      const idBytes = arr.slice(2, 2 + idLen);
      const id = (idBytes && idBytes.length)
        ? new TextDecoder().decode(idBytes)
        : (senderId || ("remote_" + Math.random().toString(36).slice(2, 8)));
      if (typeof addRemotePlayer === "function") addRemotePlayer(id, 1);
      return;
    }

    // ───────────────────────────────────────────────
    // TYPE 2 — leave
    // ───────────────────────────────────────────────
    if (type === 2) {
      const idLen = arr[1] || 0;
      const idBytes = arr.slice(2, 2 + idLen);
      const id = (idBytes && idBytes.length)
        ? new TextDecoder().decode(idBytes)
        : (senderId || null);
      if (id && typeof removeRemotePlayer === "function") removeRemotePlayer(id);
      return;
    }

    // ───────────────────────────────────────────────
    // TYPE 3 — tour-start
    // ───────────────────────────────────────────────
    if (type === 3) {
      window.dispatchEvent(new CustomEvent("tour-start", { detail: { from: senderId } }));
      return;
    }

    // ───────────────────────────────────────────────
    // TYPE 4 — npc_state (existing code kept as-is)
    // ───────────────────────────────────────────────
    if (type === 4) {
      const minLen = 1 + 7 * 4 + 1;
      if (arr.length < minLen) return;
      const dv = new DataView(arr.buffer, arr.byteOffset + 1);
      const px = dv.getFloat32(0 * 4, true);
      const py = dv.getFloat32(1 * 4, true);
      const pz = dv.getFloat32(2 * 4, true);
      const qx = dv.getFloat32(3 * 4, true);
      const qy = dv.getFloat32(4 * 4, true);
      const qz = dv.getFloat32(5 * 4, true);
      const qw = dv.getFloat32(6 * 4, true);

      const nameLenOffset = 7 * 4;
      if (arr.byteLength < 1 + nameLenOffset + 1) return;
      const nameLen = dv.getUint8(nameLenOffset);

      let npcName = null;
      if (nameLen > 0) {
        const nameStart = 1 + nameLenOffset + 1;
        const nameEnd = nameStart + nameLen;
        if (arr.length >= nameEnd) {
          const nameBytes = arr.slice(nameStart, nameEnd);
          try {
            npcName = new TextDecoder().decode(nameBytes);
          } catch { npcName = null; }
        }
      }

      const msg = { t: "npc_state", p: [px, py, pz], q: [qx, qy, qz, qw], npcName, camPos , camLookAt };
      if (typeof updateNPCRemoteState === "function") updateNPCRemoteState(msg);
      return;
    }

  } catch (err) {
    console.warn("[WebRTC] binary parse error:", err);
  }
}



// sendLocalStateBinary: includes peer id length+bytes so receivers can map packet to peer
function sendLocalStateBinary(state) {
  if (!dc || dc.readyState !== "open") return;
  if (!state || !state.p || !state.q) return;

  const idBytes = new TextEncoder().encode(PEER_ID);
  if (idBytes.length > 255) {
    console.warn("[WebRTC] PEER_ID too long, fallback to JSON");
    sendLocalState({ t: "state", id: PEER_ID, p: state.p, q: state.q, camPos: state.camPos, camQuat: state.camQuat });
    return;
  }

  // determine current animation
  let animCode = ANIM_IDLE;
  if (tpView && tpView.isRunning) animCode = ANIM_RUN;
  else if (tpView && tpView.isWalking) animCode = ANIM_WALK;

  // timestamp (mod 65536 to fit uint16)
  const ts = Math.floor(performance.now() % 65536);

  // Payload floats: p(3) + q(4) + camPos(3) + camLookAt(3) = 13 floats
  const FLOAT_COUNT = 13;
  const FLOAT_BYTES = FLOAT_COUNT * 4;
  const headerLen = 1 + 1 + idBytes.length; // type + idLen + id bytes
  const payloadLen = FLOAT_BYTES + 1 + 2; // floats + anim (1) + timestamp (2)
  const buf = new ArrayBuffer(headerLen + payloadLen);
  const u8 = new Uint8Array(buf);

  u8[0] = 0; // type = state (binary)
  u8[1] = idBytes.length;
  u8.set(idBytes, 2);

  const dv = new DataView(buf, headerLen, payloadLen);

  // helper to read vector3 (supports arrays [x,y,z] or objects {x,y,z})
  const readVec3 = (v) => {
    if (!v) return { x: 0, y: 0, z: 0 };
    if (Array.isArray(v)) return { x: v[0] || 0, y: v[1] || 0, z: v[2] || 0 };
    return { x: (v.x !== undefined ? v.x : (v[0] || 0)), y: (v.y !== undefined ? v.y : (v[1] || 0)), z: (v.z !== undefined ? v.z : (v[2] || 0)) };
  };
  // helper to read quaternion (supports arrays [x,y,z,w] or objects {x,y,z,w})
  const readQuat = (q) => {
    if (!q) return { x: 0, y: 0, z: 0, w: 1 };
    if (Array.isArray(q)) return { x: q[0] || 0, y: q[1] || 0, z: q[2] || 0, w: q[3] !== undefined ? q[3] : 1 };
    return { x: (q.x !== undefined ? q.x : (q[0] || 0)), y: (q.y !== undefined ? q.y : (q[1] || 0)), z: (q.z !== undefined ? q.z : (q[2] || 0)), w: (q.w !== undefined ? q.w : (q[3] !== undefined ? q[3] : 1)) };
  };

  // normalize incoming p and q shapes
  const p = readVec3(state.p);
  const q = readQuat(state.q);
  const camPos = readVec3(state.camPos || state.cameraPosition || state.camPosWorld);
  const camLookAt = readVec3(state.camLookAt || state.camLook || state.camTarget);

  // Write floats in order:
  // 0..2  -> p.x,p.y,p.z
  // 3..6  -> q.x,q.y,q.z,q.w
  // 7..9  -> camPos.x,y,z
  // 10..12 -> camLookAt.x,y,z
  let fOffset = 0;
  dv.setFloat32(fOffset * 4 + 0, p.x, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, p.y, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, p.z, true); fOffset++;

  dv.setFloat32(fOffset * 4 + 0, q.x, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, q.y, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, q.z, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, q.w, true); fOffset++;

  dv.setFloat32(fOffset * 4 + 0, camPos.x, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, camPos.y, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, camPos.z, true); fOffset++;

  dv.setFloat32(fOffset * 4 + 0, camLookAt.x, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, camLookAt.y, true); fOffset++;
  dv.setFloat32(fOffset * 4 + 0, camLookAt.z, true); fOffset++;

  // offset now at FLOAT_BYTES
  let byteOffset = FLOAT_BYTES;
  dv.setUint8(byteOffset, animCode); byteOffset += 1;
  dv.setUint16(byteOffset, ts, true); byteOffset += 2;

  try { dc.send(buf); }
  catch (e) { console.warn("[WebRTC] dc send binary failed", e); }
}


// send arbitrary JSON object
function sendLocalState(obj) {
  if (!dc || dc.readyState !== "open") return;
  try { dc.send(JSON.stringify(obj)); } catch (e) { console.warn("[WebRTC] send failed:", e); }
}

// Update remote NPC model state
// state: { t: "npc_state", p: [x,y,z], q: [x,y,z,w], npcName?: string }
// webRTC.js

// This cache variable is important. Define it in the global scope of webRTC.js
// let _remoteNPCEntry = null; // You already have this, just ensure it's there.

function updateNPCRemoteState(state) {
  if (!state || !state.p || !state.q) return;
  const localPlayer = getTpView();
  if (!localPlayer) return;
  localPlayer.remoteControlled = true;
  try {
    const agentsMap = getAgentsFunc ? getAgentsFunc() : null;
    if (!agentsMap) return; // Not ready

    const npcName = state.npcName || state.name || null;
    if (!npcName) return; // No name to match

    // --- Try to find the entry matching the host's npcName ---
    let foundEntry = null;
    if (_remoteNPCEntry && (_remoteNPCEntry.model?.name === npcName || _remoteNPCEntry.userData?.tourId === npcName)) {
        foundEntry = _remoteNPCEntry; // Use cached entry
    } else {
        // Loop through agentsMap to find the NPC by its new name
        for (const entry of agentsMap.values()) {
            const model = entry?.model || entry?.userData?.model;
            const ud = entry?.userData;
            if (model && model.name === npcName) {
                foundEntry = entry;
                break;
            }
            if (ud && ud.tourId === npcName) {
                foundEntry = entry;
                break;
            }
        }
    }

    // If no entry is found, we can't update anything.
    // This is OK, it just means the 'tour_invite' logic hasn't finished renaming the local NPC yet.
    if (!foundEntry) {
        // console.warn(`[Tour] updateNPCRemoteState: Could not find NPC entry named '${npcName}'. Packet dropped.`);
        return; 
    }

    // --- Found the entry, now update it ---
    if (foundEntry && !_remoteNPCEntry) {
        console.log(`[Tour] updateNPCRemoteState: Located and cached remote NPC entry:`, npcName);
        _remoteNPCEntry = foundEntry; // Cache it
    }

    const model = foundEntry.model || foundEntry.userData.model;
    const agent = foundEntry.agent || null;
    const ud = foundEntry.userData || {};
    foundEntry.userData = ud; // Ensure it's attached

    // Mark as remote controlled
    ud.remoteControlled = true;
    if (model) {
      model.userData = model.userData || {};
      model.userData.remoteControlled = true;
    }

    // --- IMMEDIATE SNAP for non-host tpView ---
    // When a non-host receives the first authoritative NPC state, snap the local
    // third-person view (tpView) model rotation and camera smoothing quaternion so
    // the player's character faces the same direction as the host/NPC immediately.
    try {
      if (!isHost) {
        const tpView = getTpView();
        if (tpView && tpView.model && model && !model.userData?._firstRemoteSync) {
          try {
            // copy NPC visual rotation into the local player model
            tpView.model.quaternion.copy(model.quaternion);
            // align camera smoothing quaternion so camera doesn't trail
            if (tpView.tempQuaternion) tpView.tempQuaternion.copy(tpView.model.quaternion);
            // align smoothed position to avoid sudden camera offsets
            if (tpView._smoothedPlayerPosition && tpView.playerCollider && tpView.playerCollider.end) {
              tpView._smoothedPlayerPosition.copy(tpView.playerCollider.end);
            }
            model.userData._firstRemoteSync = true;
          } catch (e) { /* non-fatal */ }
        }
      }
    } catch (e) { /* ignore */ }

    const qData = state.q ? { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] } : null;
    if (!isHost && localPlayer.model && qData) {
      // Pass the target rotation directly — let ThirdPersonPlayer interpolate it
      const netQuat = new THREE.Quaternion(qData.x, qData.y, qData.z, qData.w);
      if (localPlayer.targetQuat) localPlayer.targetQuat.copy(netQuat);
      else localPlayer.model.quaternion.copy(netQuat);
    } else if (localPlayer) {
      localPlayer.setHost(false);
    }


    // --- Store the external transform data (for updateCrowd to read) ---
    // We write to BOTH the agent's userData and the model's userData for maximum safety.
    try {
      if (typeof window.THREE !== 'undefined') {
        // Initialize Vector3/Quaternion on agent.userData if not present
        if (!ud.externalPos) ud.externalPos = new window.THREE.Vector3();
        if (!ud.externalQuat) ud.externalQuat = new window.THREE.Quaternion();
        
        ud.externalPos.set(state.p[0], state.p[1], state.p[2]);
        ud.externalQuat.set(state.q[0], state.q[1], state.q[2], state.q[3]);

        // Also write to model.userData
        if (model) {
          model.userData.externalPos = ud.externalPos;
          model.userData.externalQuat = ud.externalQuat;
        }
      } else {
        // Fallback for plain objects
        ud.externalPos = { x: state.p[0], y: state.p[1], z: state.p[2] };
        ud.externalQuat = { x: state.q[0], y: state.q[1], z: state.q[2], w: state.q[3] };
        if (model) {
            model.userData.externalPos = ud.externalPos;
            model.userData.externalQuat = ud.externalQuat;
        }
      }
    } catch(e) { 
      console.warn("Error setting externalPos/Quat", e);
    }

    // Teleport the crowd agent to keep it in sync
    if (agent && typeof agent.teleport === "function") {
      try { agent.teleport({ x: state.p[0], y: state.p[1], z: state.p[2] }); } catch(e){/*ignore*/}
    } else if (agent && agent.position) {
      try { agent.position = { x: state.p[0], y: state.p[1], z: state.p[2] }; } catch(e){/*ignore*/}
    }

    // ---------- CAMERA SYNC: use lookAt point (world-space) ----------
    // Only apply on non-host clients
    if (!isHost && typeof window !== 'undefined' && window.camera) {
      try {
        let targetLook = null;
        let targetCamPos = null;

        if (state.camLookAt && typeof window.THREE !== 'undefined') {
          targetLook = new window.THREE.Vector3(state.camLookAt.x ?? state.camLookAt[0], state.camLookAt.y ?? state.camLookAt[1], state.camLookAt.z ?? state.camLookAt[2]);
        }
        if (state.camPos && typeof window.THREE !== 'undefined') {
          targetCamPos = new window.THREE.Vector3(state.camPos.x ?? state.camPos[0], state.camPos.y ?? state.camPos[1], state.camPos.z ?? state.camPos[2]);
        }

        // smoothing factors (tune these)
        const POS_LERP = 0.2;   // how fast remote camera position chases host
        const ROT_SLERP = 0.2;  // how fast remote rotation chases host

        // LERP camera position toward host camera pos (if provided)
        if (targetCamPos) {
          window.camera.position.lerp(targetCamPos, POS_LERP);
        }

        // SLERP camera rotation toward host rotation (if lookAt is provided)
        if (targetLook && targetCamPos) {
          // Create a target rotation matrix
          const targetMatrix = new THREE.Matrix4().lookAt(targetCamPos, targetLook, window.camera.up);
          // Create a target quaternion from that matrix
          const targetQuat = new THREE.Quaternion().setFromRotationMatrix(targetMatrix);
          
          // Smoothly slerp the camera's current quaternion toward the target
          window.camera.quaternion.slerp(targetQuat, ROT_SLERP);
        }
      } catch (e) {
        // non-fatal
      }
    }
  } catch (err) {
    console.warn("[NPC] updateNPCRemoteState failed:", err);
  }
}

// Replace existing hostStartTour with this
export function hostStartTour(npcModel) {
  if (!isHost) {
    console.log("[Tour] Skipping hostStartTour — this peer is not the host.");
    return;
  }
  if (!npcModel) return;

  // build safe npcName + simple snapshot (primitives only)
  const npcName = npcModel.name || (npcModel.userData && npcModel.userData.tourId) || `NPC_${Date.now()}`;
  npcModel.name = npcName;
  npcModel.userData = npcModel.userData || {};
  npcModel.userData.tourId = npcName;

  // simple primitive snapshot (no large/circular objects)
  const npcSnapshot = {
    name: npcName,
    p: [ npcModel.position.x, npcModel.position.y, npcModel.position.z ],
    q: [ npcModel.quaternion.x, npcModel.quaternion.y, npcModel.quaternion.z, npcModel.quaternion.w ],
    footOffset: (npcModel.userData && typeof npcModel.userData.footOffset === "number") ? npcModel.userData.footOffset : 0
  };

  console.log("[Tour] hostStartTour assigned npcName:", npcName, " — sending invite + snapshot");

  // Broadcast invite to everyone (JSON) with npc snapshot
  try {
    const msg = { t: "tour_invite", from: PEER_ID, npcName, npcState: npcSnapshot };
    if (dc && dc.readyState === "open") dc.send(JSON.stringify(msg));
  } catch (e) { console.warn("tour_invite send failed", e); }

  // start sending NPC updates regularly (binary-first throttled sender)
  try { if (typeof startNPCThrottledSender === "function") startNPCThrottledSender(); } catch(e){ console.warn("startNPCThrottledSender failed", e); }

  // Also send one-time authoritative snapshot (including camera) so clients snap immediately
  try { sendNpcSnap(npcModel); } catch(e) { /* non-fatal */ }
}

// Host trigger to start room tour (broadcast)
function startRoomTourBroadcast() {
  if (!dc || dc.readyState !== "open") return;
  sendLocalState({ t: "tour", cmd: "start", ts: Date.now() });
  console.log("[WebRTC] Tour start broadcasted");
}

function stopRoomTourBroadcast(npcName = null) {
  if (!dc || dc.readyState !== "open") return;
  const payload = { t: "tour", cmd: "stop", ts: Date.now() };
  if (npcName) payload.npcName = npcName;
  sendLocalState(payload);
  console.log("[WebRTC] Tour stop broadcasted", npcName ? ("npc=" + npcName) : "");
}


// graceful cleanup
function cleanup() {
  if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
  isConnected = false;
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  // Stop audio tracks
  if (localAudioStream) {
    localAudioStream.getTracks().forEach(t => t.stop());
    localAudioStream = null;
    micSender = null;
    isMicActive = false;
  }

  // Remove remote audio elements
  for (const a of remoteAudioEls.values()) {
    try { a.remove(); } catch {}
  }
  remoteAudioEls.clear();

  dc = null;
  pc = null;

  console.log("[WebRTC] cleaned up");
}

// expose initConnection for console usage
window.initConnection = initConnection;
window.startRoomTourBroadcast = startRoomTourBroadcast;
window.stopRoomTourBroadcast = stopRoomTourBroadcast;
// helper to cleanly leave (call before unload or when leaving room)
export function leaveRoom() {
  sendLocalState({ t: "leave", id: PEER_ID, ts: Date.now() });
  cleanup();
  // optional: notify backend, etc.
}

// auto-init (optional) — comment out if you want manual control.
// initConnection().catch(err => console.warn('webrtc init failed', err));
