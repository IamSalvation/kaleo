const socket = io();
let myId, pc, localStream, peerId, pendingOffer, muted = false, camOff = false;
let callStartTime = null;
let timerInterval = null;

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

// 1. Device ID
let saved = localStorage.getItem("kaleo_id");
if (!saved) {
  saved = `KAL-${Math.random().toString(36).substring(2, 6).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  localStorage.setItem("kaleo_id", saved);
}
myId = saved;
$("myId").value = myId;
$("displayMyId").textContent = myId;
$("copyBtn").onclick = () => navigator.clipboard.writeText(myId);

// --- Call History Logic ---
function getHistory() {
  return JSON.parse(localStorage.getItem("kaleo_history") || "[]");
}

function saveToHistory(id, type) {
  let history = getHistory().filter(h => h.id !== id);
  history.unshift({ id, type, time: Date.now() });
  history = history.slice(0, 5); // Keep last 5
  localStorage.setItem("kaleo_history", JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const history = getHistory();
  const container = $("historyList");
  if (!container) return;

  if (history.length === 0) {
    container.innerHTML = '<p style="color:#666; font-size:12px; text-align:center;">No recent calls</p>';
    return;
  }

  container.innerHTML = history.map(h => `
    <div onclick="redial('${h.id}')" style="background:#1F2A44; padding:10px 14px; border-radius:12px; margin-bottom:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; transition: background 0.2s;" onmouseover="this.style.background='#2a3755'" onmouseout="this.style.background='#1F2A44'">
      <div>
        <strong style="font-size:14px; color:#fff;">${h.id}</strong>
        <div style="font-size:11px; color:#94A3B8; margin-top:2px;">${h.type === 'video' ? '📹 Video' : '📞 Voice'}</div>
      </div>
      <span style="color:#4F46E5; font-weight:bold; font-size:12px;">Redial</span>
    </div>
  `).join("");
}

window.redial = (id) => {
  $("peerName").value = id;
  startCall(true); // Default to video call
};
// ---------------------------

// 2. Register
$("registerBtn").onclick = () => {
  socket.emit("register", myId);
  $("joinScreen").style.display = "none";
  $("callScreen").style.display = "flex";
  renderHistory(); // Load history when entering app
};

socket.on("connect", () => {
  if ($("joinScreen").style.display === "none") socket.emit("register", myId);
});

// 3. Media
async function getMedia(video) {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { width: 640, height: 360 } : false
    });
    $("localVideo").srcObject = localStream;
    return true;
  } catch (e) { alert("Camera/Mic error: " + e.message); return false; }
}

// 4. Call Timer
function startTimer() {
  callStartTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
    const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    $("statusText").textContent = `${m}:${s}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  callStartTime = null;
}

// 5. Peer Connection
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
    if (pc.connectionState === "connected") {
      startTimer();
    }
  };
}

// 6. Outgoing Call
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
  $("videoGrid").style.display = "block"; // Changed to block for full screen video
  $("controlsBar").style.display = "flex";

  socket.emit("call-user", { from: myId, to: target, offer });
  saveToHistory(target, video ? "video" : "voice");
}

// Button handlers (IDs match the new HTML)
$("videoCallBtn").onclick = () => startCall(true);
$("voiceCallBtn").onclick = () => startCall(false);

// 7. Incoming Call
socket.on("incoming-call", ({ from, offer }) => {
  peerId = from;
  pendingOffer = offer;
  $("callerName").textContent = from;
  $("incomingModal").style.display = "flex";

  // Play ringtone
  const ringtone = $("ringtone");
  ringtone.currentTime = 0;
  ringtone.play().catch(e => console.warn("Ringtone blocked:", e));

  saveToHistory(from, "voice"); // Save to history as received
});

$("acceptBtn").onclick = async () => {
  $("incomingModal").style.display = "none";

  // Stop ringtone
  $("ringtone").pause();
  $("ringtone").currentTime = 0;

  $("remoteLabel").textContent = peerId;

  const ready = await getMedia(true);
  if (!ready) return;

  createPeer(peerId);
  await pc.setRemoteDescription(pendingOffer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer-call", { to: peerId, answer });

  $("dialPanel").style.display = "none";
  $("videoGrid").style.display = "block"; // Changed to block for full screen video
  $("controlsBar").style.display = "flex";
};

$("declineBtn").onclick = () => {
  socket.emit("end-call", { to: peerId });
  $("incomingModal").style.display = "none";

  // Stop ringtone
  $("ringtone").pause();
  $("ringtone").currentTime = 0;
};

// 8. Signaling
socket.on("call-answered", async ({ answer }) => {
  await pc.setRemoteDescription(answer);
});

socket.on("ice-candidate", async ({ candidate }) => {
  if (pc) await pc.addIceCandidate(candidate).catch(() => { });
});

socket.on("call-ended", () => {
  $("ringtone").pause();
  $("ringtone").currentTime = 0;
  cleanup();
});

socket.on("user-unavailable", ({ to }) => {
  alert(to + " is offline.");
  cleanup();
});

// 9. Controls
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

// 10. Cleanup
function cleanup() {
  stopTimer();
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  pc = null; localStream = null; peerId = null;
  $("localVideo").srcObject = null;
  $("remoteVideo").srcObject = null;
  $("dialPanel").style.display = "flex";
  $("videoGrid").style.display = "none";
  $("controlsBar").style.display = "none";
  $("statusText").textContent = "idle";
  renderHistory();
}