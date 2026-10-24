const socket = io();
let myId, pc, localStream, peerId, pendingOffer, muted = false, camOff = false;

const ICE_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.relay.metered.ca:80" },
    { urls: "turn:global.relay.metered.ca:80", username: "37c57fb8f7f7b17037d93382", credential: "XnV0QcW3yIYC7vxo" },
    { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "37c57fb8f7f7b17037d93382", credential: "XnV0QcW3yIYC7vxo" },
    { urls: "turn:global.relay.metered.ca:443", username: "37c57fb8f7f7b17037d93382", credential: "XnV0QcW3yIYC7vxo" },
    { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "37c57fb8f7f7b17037d93382", credential: "XnV0QcW3yIYC7vxo" }
  ]
};

const $ = (id) => document.getElementById(id);

let saved = localStorage.getItem("kaleo_id");
if (!saved) {
  saved = `KAL-${Math.random().toString(36).substring(2,6).toUpperCase()}-${Math.random().toString(36).substring(2,6).toUpperCase()}`;
  localStorage.setItem("kaleo_id", saved);
}
myId = saved;
$("myId").value = myId;
$("displayMyId").textContent = myId;
$("copyBtn").onclick = () => navigator.clipboard.writeText(myId);

$("registerBtn").onclick = () => {
  socket.emit("register", myId);
  $("joinScreen").style.display = "none";
  $("callScreen").style.display = "flex";
};

socket.on("connect", () => {
  if ($("joinScreen").style.display === "none") socket.emit("register", myId);
});

async function getMedia(video) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: { echoCancellation: true, noiseSuppression: true }, 
      video: video ? { width: 640, height: 360 } : false 
    });
    $("localVideo").srcObject = localStream;
    return true;
  } catch(e) { alert("Camera/Mic error: " + e.message); return false; }
}

function createPeer(target) {
  pc = new RTCPeerConnection(ICE_CONFIG);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  
  pc.ontrack = (e) => {
    $("remoteVideo").srcObject = e.streams[0];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit("ice-candidate", { to: target, candidate: e.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") $("statusText").textContent = "Connected";
  };
}

async function startCall(video) {
  const target = $("peerName").value.trim().toUpperCase();
  if (!target) return alert("Enter an ID");
  peerId = target;
  $("remoteLabel").textContent = peerId;
  
  const ready = await getMedia(video);
  if (!ready) return;

  createPeer(target);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  
  $("statusText").textContent = "Connecting...";
  $("dialPanel").style.display = "none";
  $("videoGrid").style.display = "grid";
  $("controlsBar").style.display = "flex";

  socket.emit("call-user", { from: myId, to: target, offer });
}

$("videoCallBtn").onclick = () => startCall(true);
$("voiceCallBtn").onclick = () => startCall(false);

socket.on("incoming-call", ({ from, offer }) => {
  peerId = from;
  pendingOffer = offer;
  $("callerName").textContent = from;
  $("incomingModal").style.display = "flex";
});

$("acceptBtn").onclick = async () => {
  $("incomingModal").style.display = "none";
  $("remoteLabel").textContent = peerId;
  
  const ready = await getMedia(true);
  if (!ready) return;

  createPeer(peerId);
  await pc.setRemoteDescription(pendingOffer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  
  socket.emit("answer-call", { to: peerId, answer });
  
  $("dialPanel").style.display = "none";
  $("videoGrid").style.display = "grid";
  $("controlsBar").style.display = "flex";
};

$("declineBtn").onclick = () => {
  socket.emit("end-call", { to: peerId });
  $("incomingModal").style.display = "none";
};

socket.on("call-answered", async ({ answer }) => {
  await pc.setRemoteDescription(answer);
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (pc) await pc.addIceCandidate(candidate).catch(()=>{});
});

socket.on("call-ended", cleanup);
socket.on("user-unavailable", ({ to }) => {
  alert(to + " is offline.");
  cleanup();
});

$("hangupBtn").onclick = () => {
  socket.emit("end-call", { to: peerId });
  cleanup();
};

$("muteBtn").onclick = () => {
  muted = !muted;
  localStream.getAudioTracks().forEach(t => t.enabled = !muted);
  $("muteBtn").style.background = muted ? "#EF4444" : "";
};

$("camBtn").onclick = () => {
  camOff = !camOff;
  localStream.getVideoTracks().forEach(t => t.enabled = !camOff);
  $("camBtn").style.background = camOff ? "#EF4444" : "";
};

function cleanup() {
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  pc = null; localStream = null; peerId = null;
  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("dialPanel").style.display = "flex";
  $("videoGrid").style.display = "none";
  $("controlsBar").style.display = "none";
  $("statusText").textContent = "idle";
}
