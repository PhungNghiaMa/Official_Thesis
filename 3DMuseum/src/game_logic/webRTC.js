// webrtc_game.js
// Drop into front-end and load this script AFTER index.js so window.gameAPI exists.
// Example usage:
//   <script type="module" src="./src/game_logic/webrtc_game.js"></script>
//   then call initConnection() from console or programmatically.
import { addRemotePlayer, updateRemotePlayerState, removeRemotePlayer, updateRemotePlayers, getLocalPlayerState } 
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
const ANIM_MAP = { idle: 0, walk: 1, run: 2, leftTurn: 3, rightTurn: 4, unknown: 255 };




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
  // dc.onmessage = (e) => {
  //   // e.data is either string (text) or ArrayBuffer
  //   if (typeof e.data === "string") { onDataMessage(e.data); }
  //   else { onDataMessageBinary(e); }
  // };
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

  // // create offer
  // const offer = await pc.createOffer();
  // await pc.setLocalDescription(offer);

  // // send to SFU join endpoint (expect JSON answer SDP)
  // const url = `${API_BASE}/join?room=${encodeURIComponent(ROOM_ID)}&peer=${encodeURIComponent(PEER_ID)}`;
  // const res = await fetch(url, {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ sdp: offer.sdp, type: offer.type })
  // });

  // if (!res.ok) {
  //   console.error("[WebRTC] SFU join failed:", await res.text());
  //   return;
  // }
  // const answer = await res.json();
  // console.log('[WebRTC] SFU answer received:', answer);
  // console.log('[WebRTC] offer SDP length', (pc.localDescription && pc.localDescription.sdp ? pc.localDescription.sdp.length: 0));

  // try {
  //   await pc.setRemoteDescription(answer);
  // } catch (err) {
  //   console.error("[WebRTC] setRemoteDescription failed:", err, answer);
  //   return;
  // }
  // console.log("[WebRTC] Connected to room:", ROOM_ID);
  const answer = await createAndSendOffer(pc, `${API_BASE}/join?room=${encodeURIComponent(ROOM_ID)}&peer=${encodeURIComponent(PEER_ID)}`);
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
  isConnected = true;
  // announce ourselves via JSON (easy for debug)
  sendJSON({ t: "join", id: PEER_ID, ts: Date.now() }); // keep JSON join for debugging
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
    const st = getLocalPlayerState();
    // prefer binary
    try {
      sendLocalStateBinary(st);
    } catch (e) {
      // fallback to JSON if binary fails
      sendJSON({ t: "state", id: PEER_ID, p: st.p, q: st.q, ts: Date.now() });
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
function onDataMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.t) {
    case "state":
      if (msg.id === PEER_ID) return;
      // make sure player exists and update state
      if (typeof addRemotePlayer === "function") addRemotePlayer(msg.id , 1);
      if (typeof updateRemotePlayerState === "function") updateRemotePlayerState(msg.id, msg);
      break;
    case "join":
      if (msg.id === PEER_ID) return;
      if (typeof addRemotePlayer === "function") addRemotePlayer(msg.id , 1);
      break;
    case "leave":
      if (typeof removeRemotePlayer === "function") removeRemotePlayer(msg.id);
      break;
    case "tour":
      if (msg.cmd === "start") {
        window.dispatchEvent(new CustomEvent("tour-start", { detail: msg }));
      }
      break;
    default:
      // unknown
      break;
  }
}

// Send our local player state to peers
function sendLocalState() {
  if (!isConnected || !dc || dc.readyState !== "open") return;
  const local = getLocalPlayerState();
  if (!local) return;
  const msg = {
    t: "state",
    id: PEER_ID,
    p: local.p,
    q: local.q,
    a: local.a || null,
    ts: Date.now()
  };
  sendJSON(msg);
}

// e = event object (dc.onmessage passes event). senderId optional (if SFU attaches metadata).
function onDataMessageBinary(e, senderId = null) {
  try {
    const arr = (e.data instanceof ArrayBuffer)
      ? new Uint8Array(e.data)
      : (ArrayBuffer.isView(e.data) ? new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength) : new Uint8Array(e.data));

    if (!arr || arr.length === 0) return;

    // treat '{' or '[' as JSON fallback
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

    const type = arr[0]; // 0=state
    if (type === 0) {
      const idLen = arr[1];
      const headerLen = 1 + 1 + idLen;
      if (arr.length < headerLen + 7 * 4) return;

      const idBytes = arr.slice(2, 2 + idLen);
      const peerId = idBytes.length
        ? new TextDecoder().decode(idBytes)
        : senderId || ("remote_" + Math.random().toString(36).slice(2, 8));

      const dv = new DataView(arr.buffer, arr.byteOffset + headerLen);
      const f = [];
      for (let i = 0; i < 7; i++) f[i] = dv.getFloat32(i * 4, true);
      let offset = 7 * 4;

      // read optional animation + timestamp
      let animCode = ANIM_IDLE;
      let timestamp = 0;
      if (arr.length >= headerLen + offset + 1) {
        animCode = dv.getUint8(offset); offset += 1;
      }
      if (arr.length >= headerLen + offset + 2) {
        timestamp = dv.getUint16(offset, true); offset += 2;
      }

      let anim = "idle";
      if (animCode === ANIM_WALK) anim = "walk";
      else if (animCode === ANIM_RUN) anim = "run";

      const msg = { t: "state", id: peerId, p: [f[0], f[1], f[2]], q: [f[3], f[4], f[5], f[6]], a: anim, ts: timestamp };

      // Update remote player
      if (typeof addRemotePlayer === "function") addRemotePlayer(peerId, 1);
      if (typeof updateRemotePlayerState === "function") updateRemotePlayerState(peerId, msg);
      return;
    }

    if (type === 1) { // join
      const idLen = arr[1] || 0;
      const idBytes = arr.slice(2, 2 + idLen);
      const id = (idBytes && idBytes.length) ? new TextDecoder().decode(idBytes) : (senderId || ("remote_" + Math.random().toString(36).slice(2, 8)));
      if (typeof addRemotePlayer === "function") addRemotePlayer(id, 1);
      return;
    }

    if (type === 2) {
      const idLen = arr[1] || 0;
      const idBytes = arr.slice(2, 2 + idLen);
      const id = (idBytes && idBytes.length) ? new TextDecoder().decode(idBytes) : (senderId || null);
      if (id && typeof removeRemotePlayer === "function") removeRemotePlayer(id);
      return;
    }

    if (type === 3) { window.dispatchEvent(new CustomEvent("tour-start", { detail: { from: senderId } })); }
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
    sendJSON({ t: "state", id: PEER_ID, p: state.p, q: state.q });
    return;
  }

  // determine current animation
  let animCode = ANIM_IDLE;
  if (tpView && tpView.isRunning) animCode = ANIM_RUN;
  else if (tpView && tpView.isWalking) animCode = ANIM_WALK;

  // timestamp (mod 65536 to fit uint16)
  const ts = Math.floor(performance.now() % 65536);

  const headerLen = 1 + 1 + idBytes.length;
  const payloadLen = 7 * 4 + 1 + 2; // floats + anim + timestamp
  const buf = new ArrayBuffer(headerLen + payloadLen);
  const u8 = new Uint8Array(buf);

  u8[0] = 0; // type = state
  u8[1] = idBytes.length;
  u8.set(idBytes, 2);

  const dv = new DataView(buf, headerLen, payloadLen);
  for (let i = 0; i < 7; i++) dv.setFloat32(i * 4, state.p?.[i] ?? state.q?.[i - 3] ?? 0, true);

  let offset = 7 * 4;
  dv.setUint8(offset, animCode); offset += 1;
  dv.setUint16(offset, ts, true); offset += 2;

  try { dc.send(buf); }
  catch (e) { console.warn("[WebRTC] dc send binary failed", e); }
}



function sendJSON(obj) {
  if (!dc || dc.readyState !== "open") return;
  try { dc.send(JSON.stringify(obj)); } catch (e) { console.warn("[WebRTC] send failed:", e); }
}




// Host trigger to start room tour (broadcast)
export function startRoomTourBroadcast() {
  if (!dc || dc.readyState !== "open") return;
  sendJSON({ t: "tour", cmd: "start", ts: Date.now() });
  console.log("[WebRTC] Tour start broadcasted");
}

// graceful cleanup
function cleanup() {
  if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
  isConnected = false;
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  dc = null;
  pc = null;
  console.log("[WebRTC] cleaned up");
}

// expose initConnection for console usage
window.initConnection = initConnection;
window.startRoomTourBroadcast = startRoomTourBroadcast;

// helper to cleanly leave (call before unload or when leaving room)
export function leaveRoom() {
  sendJSON({ t: "leave", id: PEER_ID, ts: Date.now() });
  cleanup();
  // optional: notify backend, etc.
}

// auto-init (optional) — comment out if you want manual control.
// initConnection().catch(err => console.warn('webrtc init failed', err));
