// ============================================================
// KALEO — Vanilla JS WebRTC Client
// ============================================================

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ["websocket", "polling"],
});

// --- DOM refs ---
const joinScreen = document.getElementById("joinScreen");
const callScreen = document.getElementById("callScreen");
const incomingModal = document.getElementById("incomingModal");
const dialPanel = document.getElementById("dialPanel");
const videoGrid = document.getElementById("videoGrid");
const controlsBar = document.getElementById("controlsBar");

const myNameInput = document.getElementById("myName");
const registerBtn = document.getElementById("registerBtn");

const peerNameInput = document.getElementById("peerName");
const videoCallBtn = document.getElementById("videoCallBtn");
const voiceCallBtn = document.getElementById("voiceCallBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remoteLabel = document.getElementById("remoteLabel");

const muteBtn = document.getElementById("muteBtn");
const camBtn = document.getElementById("camBtn");
const hangupBtn = document.getElementById("hangupBtn");

const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");

const callerName = document.getElementById("callerName");
const acceptBtn = document.getElementById("acceptBtn");
const declineBtn = document.getElementById("declineBtn");

// --- State ---
let myName = null;
let peerConnection = null;
let localStream = null;
let remotePeerName = null;
let pendingOffer = null;
let muted = false;
let camOff = false;

// --- ICE config: STUN + TURN (fixes NAT traversal) ---
const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject"
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject"
    }
  ],
  iceCandidatePoolSize: 10,
};

// ============================================================
// UI helpers
// ============================================================
function setStatus(state) {
  statusText.textContent = state;
  statusDot.className = "status-dot";
  if (state === "connected") statusDot.classList.add("connected");
  if (state === "calling" || state === "ringing") statusDot.classList.add(state);
}

function showCallUI() {
  dialPanel.hidden = true;
  videoGrid.hidden = false;
  controlsBar.hidden = false;
}

function hideCallUI() {
  dialPanel.hidden = false;
  videoGrid.hidden = true;
  controlsBar.hidden = true;
}

// ============================================================
// Socket lifecycle
// ============================================================
socket.on("connect", () => {
  console.log("✅ Socket connected:", socket.id);
  // Re-register on every (re)connection so mobile tab resumes work
  if (myName) {
    socket.emit("register", myName);
    console.log("🔁 Re-registered as:", myName);
  }
});

socket.on("disconnect", (reason) => {
  console.warn("⚠️ Socket disconnected:", reason);
});

socket.on("reconnect", (attempt) => {
  console.log(`🔄 Reconnected after ${attempt} attempts`);
});

// ============================================================
// Register
// ============================================================
registerBtn.addEventListener("click", () => {
  const name = myNameInput.value.trim();
  if (!name) return alert("Please enter a name");
  myName = name;
  socket.emit("register", myName);
  joinScreen.hidden = true;
  callScreen.hidden = false;
  setStatus("idle");
  console.log("📝 Registered as:", myName);
});

myNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") registerBtn.click();
});

// ============================================================
// Media
// ============================================================
async function getLocalMedia(withVideo = true) {
  const constraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: withVideo
      ? {
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 24 },
      }
      : false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  localStream = stream;
  localVideo.srcObject = stream;
  return stream;
}

// ============================================================
// Peer connection
// ============================================================
function createPeerConnection(remoteId) {
  console.log("🔧 Creating RTCPeerConnection for:", remoteId);
  const pc = new RTCPeerConnection(ICE_CONFIG);

  // Add local tracks
  localStream.getTracks().forEach((track) => {
    console.log("  ➕ Adding track:", track.kind);
    pc.addTrack(track, localStream);
  });

  // Remote stream arrives
  pc.ontrack = (event) => {
    console.log("📹 Remote track received:", event.track.kind);
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch((e) => console.warn("play() failed:", e));
    }
  };

  // ICE candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("❄️ Sending ICE candidate:", event.candidate.type);
      socket.emit("ice-candidate", { to: remoteId, candidate: event.candidate });
    } else {
      console.log("❄️ ICE gathering complete");
    }
  };

  // ICE connection state
  pc.oniceconnectionstatechange = () => {
    console.log("🧊 ICE state:", pc.iceConnectionState);
    if (pc.iceConnectionState === "failed") {
      console.error("❌ ICE failed — TURN might be needed");
    }
  };

  // Connection state
  pc.onconnectionstatechange = () => {
    console.log("🔌 PC state:", pc.connectionState);
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      if (pc.connectionState !== "closed") cleanupCall();
    }
    if (pc.connectionState === "connected") {
      setStatus("connected");
    }
  };

  // Prefer AV1/VP9 for data savings
  try {
    const caps = RTCRtpSender.getCapabilities("video");
    if (caps) {
      const efficient = caps.codecs.filter((c) => /AV1|VP9/.test(c.mimeType));
      pc.getTransceivers().forEach((t) => {
        if (t.sender.track && t.sender.track.kind === "video") {
          t.setCodecPreferences([...efficient, ...caps.codecs]);
        }
      });
    }
  } catch (e) {
    console.warn("Codec preference failed:", e);
  }

  return pc;
}

// ============================================================
// Outgoing call
// ============================================================
async function startCall(withVideo) {
  const peer = peerNameInput.value.trim();
  if (!peer) return alert("Enter a peer name");
  if (peer === myName) return alert("You can't call yourself");

  remotePeerName = peer;
  remoteLabel.textContent = peer;

  try {
    await getLocalMedia(withVideo);
  } catch (err) {
    alert("Could not access camera/microphone: " + err.message);
    return;
  }

  peerConnection = createPeerConnection(peer);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  console.log("📞 Sending call to:", peer);
  socket.emit("call-user", { from: myName, to: peer, offer });

  showCallUI();
  setStatus("calling");
}

videoCallBtn.addEventListener("click", () => startCall(true));
voiceCallBtn.addEventListener("click", () => startCall(false));

// ============================================================
// Incoming call
// ============================================================
socket.on("incoming-call", ({ from, offer }) => {
  console.log("📲 Incoming call from:", from);
  remotePeerName = from;
  pendingOffer = offer;
  callerName.textContent = from;
  incomingModal.hidden = false;
  setStatus("ringing");
});

acceptBtn.addEventListener("click", async () => {
  incomingModal.hidden = true;
  if (!pendingOffer) return;
  remoteLabel.textContent = remotePeerName;

  try {
    await getLocalMedia(true);
  } catch (err) {
    alert("Could not access camera/microphone: " + err.message);
    declineCall();
    return;
  }

  peerConnection = createPeerConnection(remotePeerName);
  await peerConnection.setRemoteDescription(pendingOffer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  console.log("✅ Sending answer to:", remotePeerName);
  socket.emit("answer-call", { to: remotePeerName, answer });

  showCallUI();
  setStatus("connecting");
  pendingOffer = null;
});

function declineCall() {
  if (remotePeerName) socket.emit("end-call", { to: remotePeerName });
  incomingModal.hidden = true;
  pendingOffer = null;
  remotePeerName = null;
  setStatus("idle");
}

declineBtn.addEventListener("click", declineCall);

// ============================================================
// Signaling events
// ============================================================
socket.on("call-answered", async ({ answer }) => {
  console.log("📥 Call answered");
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(answer);
  setStatus("connecting");
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (!peerConnection) return;
  try {
    await peerConnection.addIceCandidate(candidate);
    console.log("❄️ Added remote ICE candidate");
  } catch (e) {
    console.warn("ICE error:", e);
  }
});

socket.on("call-ended", () => {
  console.log("📴 Call ended by peer");
  cleanupCall();
});

socket.on("user-unavailable", ({ to }) => {
  alert(to + " is not available");
  cleanupCall();
});

// ============================================================
// Controls
// ============================================================
muteBtn.addEventListener("click", () => {
  if (!localStream) return;
  muted = !muted;
  localStream.getAudioTracks().forEach((t) => (t.enabled = !muted));
  muteBtn.classList.toggle("off", muted);
  muteBtn.textContent = muted ? "🔇" : "🎤";
});

camBtn.addEventListener("click", () => {
  if (!localStream) return;
  camOff = !camOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = !camOff));
  camBtn.classList.toggle("off", camOff);
  camBtn.textContent = camOff ? "📷" : "📹";
});

hangupBtn.addEventListener("click", () => {
  if (remotePeerName) socket.emit("end-call", { to: remotePeerName });
  cleanupCall();
});

// ============================================================
// Cleanup
// ============================================================
function cleanupCall() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remotePeerName = null;
  pendingOffer = null;
  muted = false;
  camOff = false;
  muteBtn.classList.remove("off");
  camBtn.classList.remove("off");
  muteBtn.textContent = "🎤";
  camBtn.textContent = "📹";
  hideCallUI();
  setStatus("idle");
}

// ============================================================
// Data saver: pause outgoing video when tab is hidden
// ============================================================
document.addEventListener("visibilitychange", () => {
  if (!localStream) return;
  const shouldEnable = !document.hidden && !camOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = shouldEnable));

  // If tab comes back and we have a name, make sure we're registered
  if (!document.hidden && myName && socket.connected) {
    socket.emit("register", myName);
    console.log("🔁 Tab visible — re-registered as:", myName);
  }
});

// ============================================================
// Warn on unload during a call
// ============================================================
window.addEventListener("beforeunload", (e) => {
  if (peerConnection && peerConnection.connectionState === "connected") {
    e.preventDefault();
    e.returnValue = "";
  }
});