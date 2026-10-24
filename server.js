const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const users = new Map(); // userId -> socketId

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  socket.on("register", (userId) => {
    users.set(userId, socket.id);
    socket.userId = userId;
    console.log(`Registered: ${userId} -> ${socket.id}`);
  });

  socket.on("ping", () => { });

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
    if (socket.userId) {
      users.delete(socket.userId);
      console.log(`Disconnected: ${socket.userId}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟣 Kaleo signal server running on http://localhost:${PORT}`);
});