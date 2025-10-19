
// =====================
//  WebRTC SFU CLIENT
// =====================

const SFU_SERVER_URL = "http://localhost:8080/sfu/join"; // Change to your Go backend
const ROOM_ID = "test-room";   // You can dynamically set this
const PEER_ID = "player-" + Math.floor(Math.random() * 9999);

// STUN / TURN configuration (match backend .env or os.Setenv)
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  // Optional TURN server if you have one
  // {
  //   urls: "turn:turn.yourdomain.com:3478",
  //   username: "user",
  //   credential: "password"
  // }
];

let pc = null;
let dataChannel = null;
let localStream = null;
let remoteStream = null;

// HTML elements
const joinBtn = document.getElementById("joinBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

joinBtn.onclick = async () => {
  await joinRoom();
};

async function joinRoom() {
  console.log("Joining SFU room:", ROOM_ID, "as", PEER_ID);

  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // --- Create local media (camera/mic optional) ---
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    localVideo.srcObject = localStream;
  } catch (err) {
    console.warn("⚠️ No local media, proceeding data-only:", err);
  }

  // --- Remote tracks ---
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;
  pc.ontrack = (event) => {
    console.log("🎥 Remote track added:", event.streams);
    event.streams[0].getTracks().forEach(track => {
      remoteStream.addTrack(track);
    });
  };

  // --- DataChannel setup ---
  dataChannel = pc.createDataChannel("game-sync", { ordered: true });
  setupDataChannel(dataChannel);

  pc.ondatachannel = (event) => {
    console.log("📡 Received DataChannel:", event.channel.label);
    setupDataChannel(event.channel);
  };

  // --- ICE Candidates ---
  const pendingCandidates = [];
  pc.onicecandidate = async (event) => {
    if (event.candidate) {
      pendingCandidates.push(event.candidate);
    } else {
      // ICE gathering finished, send SDP + candidates to SFU
      await sendOffer(pendingCandidates);
    }
  };

  // --- Connection state debugging ---
  pc.onconnectionstatechange = () => {
    console.log("Connection state:", pc.connectionState);
  };

  // --- Create and set local offer ---
  const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await pc.setLocalDescription(offer);
}

// Send offer to Go SFU backend
async function sendOffer(candidates) {
  console.log("📤 Sending offer to SFU...");

  const payload = {
    sdp: pc.localDescription.sdp,
    type: pc.localDescription.type,
    candidates: candidates.map(c => c.toJSON())
  };

  const response = await fetch(`${SFU_SERVER_URL}?room=${ROOM_ID}&peer=${PEER_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  console.log("📥 Got SFU answer:", data);

  if (data.answer) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }

  if (data.candidates) {
    for (const c of data.candidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("Failed to add remote ICE candidate:", err);
      }
    }
  }

  console.log("✅ WebRTC connection initialized");
}

// Setup reliable DataChannel for gameplay state sync
function setupDataChannel(channel) {
  channel.onopen = () => {
    console.log("🟢 DataChannel open:", channel.label);
    // Example: send player position every 200ms
    setInterval(() => {
      const playerState = {
        id: PEER_ID,
        pos: getRandomPosition(), // Replace with real player pos
        time: Date.now()
      };
      channel.send(JSON.stringify(playerState));
    }, 200);
  };

  channel.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log("📨 Game update from peer:", msg);
    // TODO: update NPCs or player avatars accordingly
  };

  channel.onclose = () => console.log("🔴 DataChannel closed");
  channel.onerror = (err) => console.error("DataChannel error:", err);
}

// Example: random pos generator for testing
function getRandomPosition() {
  return { x: Math.random() * 10, y: 0, z: Math.random() * 10 };
}
