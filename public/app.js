// ============================================================
// KALEO — Vanilla JS WebRTC Client
// ============================================================

const socket = io();

const joinScreen    = document.getElementById("joinScreen");
const callScreen    = document.getElementById("callScreen");
const incomingModal = document.getElementById("incomingModal");
const dialPanel     = document.getElementById("dialPanel");
const videoGrid     = document.getElementById("videoGrid");
const controlsBar   = document.getElementById("controlsBar");

const myNameInput   = document.getElementById("myName");
const registerBtn   = document.getElementById("registerBtn");

const peerNameInput = document.getElementById("peerName");
const videoCallBtn  = document.getElementById("videoCallBtn");
const voiceCallBtn  = document.getElementById("voiceCallBtn");

const localVideo    = document.getElementById("localVideo");
const remoteVideo   = document.getElementById("remoteVideo");
const remoteLabel   = document.getElementById("remoteLabel");

const muteBtn       = document.getElementById("muteBtn");
const camBtn        = document.getElementById("camBtn");
const hangupBtn     = document.getElementById("hangupBtn");

const statusDot     = document.getElementById("statusDot");
const statusText    = document.getElementById("statusText");

const callerName    = document.getElementById("callerName");
const acceptBtn     = document.getElementById("acceptBtn");
const declineBtn    = document.getElementById("declineBtn");

let myName = null;
let peerConnection = null;
let localStream = null;
let remotePeerName = null;
let pendingOffer = null;
let muted = false;
let camOff = false;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

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

registerBtn.addEventListener("click", () => {
  const name = myNameInput.value.trim();
  if (!name) return alert("Please enter a name");
  myName = name;
  socket.emit("register", myName);
  joinScreen.hidden = true;
  callScreen.hidden = false;
  setStatus("idle");
});

myNameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") registerBtn.click();
});

async function getLocalMedia(withVideo = true) {
  const constraints = {
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: withVideo
      ? { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24 } }
      : false,
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  localStream = stream;
  localVideo.srcObject = stream;
  return stream;
}

function createPeerConnection(remoteId) {
  const pc = new RTCPeerConnection(ICE_CONFIG);

  localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("ice-candidate", { to: remoteId, candidate: event.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    console.log("PC state:", pc.connectionState);
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) cleanupCall();
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
  } catch (e) { console.warn("Codec preference failed:", e); }

  return pc;
}

async function startCall(withVideo) {
  const peer = peerNameInput.value.trim();
  if (!peer) return alert("Enter a peer name");
  if (peer === myName) return alert("You can't call yourself");

  remotePeerName = peer;
  remoteLabel.textContent = peer;

  try { await getLocalMedia(withVideo); }
  catch (err) { alert("Could not access camera/microphone: " + err.message); return; }

  peerConnection = createPeerConnection(peer);
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  socket.emit("call-user", { from: myName, to: peer, offer });
  showCallUI();
  setStatus("calling");
}

videoCallBtn.addEventListener("click", () => startCall(true));
voiceCallBtn.addEventListener("click", () => startCall(false));

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

  try { await getLocalMedia(true); }
  catch (err) { alert("Could not access camera/microphone: " + err.message); declineCall(); return; }

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

socket.on("call-answered", async ({ answer }) => {
  if (!peerConnection) return;
  await peerConnection.setRemoteDescription(answer);
  setStatus("connecting");
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (!peerConnection) return;
  try { await peerConnection.addIceCandidate(candidate); } catch (e) { console.warn("ICE error:", e); }
});

socket.on("call-ended", () => cleanupCall());

socket.on("user-unavailable", ({ to }) => {
  alert(to + " is not available");
  cleanupCall();
});

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

document.addEventListener("visibilitychange", () => {
  if (!localStream) return;
  const shouldEnable = !document.hidden && !camOff;
  localStream.getVideoTracks().forEach((t) => (t.enabled = shouldEnable));
});

window.addEventListener("beforeunload", (e) => {
  if (peerConnection && peerConnection.connectionState === "connected") {
    e.preventDefault(); e.returnValue = "";
  }
});
