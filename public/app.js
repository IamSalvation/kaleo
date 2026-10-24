// ============================================================
// KALEO — Vanilla JS WebRTC Client (Device ID Edition)
// ============================================================

const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

// --- DOM refs ---
const joinScreen = document.getElementById("joinScreen");
const callScreen = document.getElementById("callScreen");
const incomingModal = document.getElementById("incomingModal");
const dialPanel = document.getElementById("dialPanel");
const videoGrid = document.getElementById("videoGrid");
const controlsBar = document.getElementById("controlsBar");

const myIdInput = document.getElementById("myId");
const copyIdBtn = document.getElementById("copyIdBtn");
const registerBtn = document.getElementById("registerBtn");
const displayMyId = document.getElementById("displayMyId");

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

// --- ICE config: STUN + TURN ---
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
// Device ID Generation
// ============================================================
function getOrCreateId() {
  let savedId = localStorage.getItem("kaleo_id");
  if (!savedId) {
    const r1 = Math.random().toString(36).substring(2, 6).toUpperCase();
    const r2 = Math.random().toString(36).substring(2, 6).toUpperCase();
    savedId = `Kal-${r1}-${r2}`;
    localStorage.setItem("kaleo_id", savedId);
  }
  return savedId;
}

// Initialize ID on load
myName = getOrCreateId();
if (myIdInput) myIdInput.value = myName;
if (displayMyId) displayMyId.textContent = myName;

if (copyIdBtn) {
  copyIdBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(myName);
    copyIdBtn.textContent = "✅";
    setTimeout(() => copyIdBtn.textContent = "📋", 2000);
  });
}

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
// Socket Lifecycle & Reconnection
// ============================================================
socket.on("connect", () => {
  console.log("✅ Socket connected:", socket.id);
  // If already in the app, re-register immediately on reconnect
  if (myName && !joinScreen.hidden) {
    socket.emit("register", myName);
    console.log("🔁 Re-registered as:", myName);
  }
});

socket.on("disconnect", (reason) => {
  console.warn("⚠️ Socket disconnected:", reason);
  setStatus("offline");
});

// Keep-alive ping for mobile backgrounding
setInterval(() => {
  if (socket.connected) socket.emit("ping");
}, 10000);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && myName) {
    if (!joinScreen.hidden) socket.emit("register", myName);
    const shouldEnable = !camOff;
    if (localStream) localStream.getVideoTracks().forEach((t) => (t.enabled = shouldEnable));
  }
});

// ============================================================
// Register
// ============================================================
registerBtn.addEventListener("click", () => {
  socket.emit("register", myName);
  joinScreen.hidden = true;
  callScreen.hidden = false;
  setStatus("idle");
  console.log("📝 Registered as:", myName);
});

// ============================================================
// Media
// ============================================================
async function getLocalMedia(withVideo = true) {
  const constraints = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: withVideo ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } } : false,
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

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.play().catch((e) => console.warn("play() failed:", e));
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit("ice-candidate", { to: remoteId, candidate: event.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      if (pc.connectionState !== "closed") cleanupCall();
    }
    if (pc.connectionState === "connected") setStatus("connected");
  };

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
  } catch (e) { }

  return pc;
}

// ============================================================
// Outgoing call
// ============================================================
async function startCall(withVideo) {
  const peer = peerNameInput.value.trim().toUpperCase();
  if (!peer) return alert("Enter a Kaleo ID");
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
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(answer);
  setStatus("connecting");
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (!peerConnection) return;
  try { await peerConnection.addIceCandidate(candidate); } catch (e) { }
});

socket.on("call-ended", () => cleanupCall());

socket.on("user-unavailable", ({ to }) => {
  // Auto-heal: Force our own socket to re-register just in case it dropped
  if (myName) socket.emit("register", myName);

  alert(to + " is not available or offline. Make sure their tab is open and they clicked 'Enter Kaleo'.");
  cleanupCall();
});

// ============================================================
// Controls & Cleanup
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

function cleanupCall() {
  if (peerConnection) { peerConnection.close(); peerConnection = null; }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  remotePeerName = null;
  pendingOffer = null;
  muted = false; camOff = false;
  muteBtn.classList.remove("off"); camBtn.classList.remove("off");
  muteBtn.textContent = "🎤"; camBtn.textContent = "📹";
  hideCallUI();
  setStatus("idle");
}

window.addEventListener("beforeunload", (e) => {
  if (peerConnection && peerConnection.connectionState === "connected") {
    e.preventDefault(); e.returnValue = "";
  }
});