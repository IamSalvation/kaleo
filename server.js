const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const users = new Map();

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register", (id) => {
    users.set(id, socket.id);
    console.log(`Registered: ${id}`);
  });

  socket.on("call-user", ({ from, to, offer }) => {
    const target = users.get(to);
    if (target) {
      io.to(target).emit("incoming-call", { from, offer });
    } else {
      socket.emit("user-unavailable", { to });
    }
  });

  socket.on("answer-call", ({ to, answer }) => {
    const target = users.get(to);
    if (target) io.to(target).emit("call-answered", { answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    const target = users.get(to);
    if (target) io.to(target).emit("ice-candidate", { candidate });
  });

  socket.on("end-call", ({ to }) => {
    const target = users.get(to);
    if (target) io.to(target).emit("call-ended");
  });

  socket.on("disconnect", () => {
    for (const [userId, socketId] of users) {
      if (socketId === socket.id) {
        users.delete(userId);
        console.log(`Disconnected: ${userId}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟣 Kaleo signal server on :${PORT}`);
});
