const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const YAPPA_EXTRA_SECONDS = 33;

let rooms = [];
let videoIds = [];

// 📄 Videos aus Datei laden
function loadVideos() {
  const filePath = path.join(__dirname, 'videos.txt');
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    videoIds = lines.map(l => l.trim()).filter(l => l.length > 0);
  } else {
    console.error("❌ Datei 'videos.txt' nicht gefunden.");
    process.exit(1);
  }
}

// 🔁 Nächstes verfügbares Video
function getRandomVideoId(exclude = []) {
  const options = videoIds.filter(id => !exclude.includes(id));
  return options[Math.floor(Math.random() * options.length)];
}

function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    videoId: null,
    videoStart: null,
    shuffleAt: null
  };
}

function cleanupRooms() {
  rooms = rooms.filter(room => room.users.length > 0);
}

function updateRoomsForAll() {
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

function assignUserToRoom(socket) {
  let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
  if (!room) {
    room = createRoom();
    room.videoId = getRandomVideoId();
    room.videoStart = Date.now();
    room.shuffleAt = room.videoStart + 1000 * (180 + YAPPA_EXTRA_SECONDS); // fallback 3min
    rooms.push(room);
  }

  room.users.push(socket.id);
  socket.join(room.id);

  socket.emit('joined_room', {
    roomId: room.id,
    videoId: room.videoId,
    videoStart: room.videoStart,
    shuffleAt: room.shuffleAt
  });

  updateRoomsForAll();
}

function shuffleUsers() {
  const allUsers = Array.from(io.sockets.sockets.keys());

  for (let i = allUsers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allUsers[i], allUsers[j]] = [allUsers[j], allUsers[i]];
  }

  rooms = [];
  const assignedVideoIds = [];
  let i = 0;

  while (i < allUsers.length) {
    const room = createRoom();
    room.users = allUsers.slice(i, i + MAX_USERS_PER_ROOM);
    room.videoId = getRandomVideoId(assignedVideoIds);
    room.videoStart = Date.now();
    room.shuffleAt = room.videoStart + 1000 * (180 + YAPPA_EXTRA_SECONDS);
    assignedVideoIds.push(room.videoId);
    rooms.push(room);
    i += MAX_USERS_PER_ROOM;
  }

  io.sockets.sockets.forEach(socket => {
    const socketRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    socketRooms.forEach(rId => socket.leave(rId));
  });

  rooms.forEach(room => {
    room.users.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(room.id);
        socket.emit('joined_room', {
          roomId: room.id,
          videoId: room.videoId,
          videoStart: room.videoStart,
          shuffleAt: room.shuffleAt
        });
      }
    });
  });

  updateRoomsForAll();
}

// 🧠 Überwacht Räume & triggert Shuffle pro Raum
function monitorShuffleTimers() {
  setInterval(() => {
    const now = Date.now();
    let needsShuffle = false;

    for (const room of rooms) {
      if (room.shuffleAt && now >= room.shuffleAt) {
        needsShuffle = true;
        break;
      }
    }

    if (needsShuffle) {
      console.log("🎬 Automatischer Shuffle wird ausgelöst.");
      shuffleUsers();
      io.emit('trigger_reload');
    }
  }, 1000);
}

// 📁 Statische Dateien bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('✅ User connected:', socket.id);
  assignUserToRoom(socket);

  socket.on('message', (msg) => {
    const userRoom = Array.from(socket.rooms).find(r => r !== socket.id);
    if (userRoom) {
      io.to(userRoom).emit('message', { user: socket.id, text: msg });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    rooms.forEach(r => {
      r.users = r.users.filter(u => u !== socket.id);
    });
    cleanupRooms();
    updateRoomsForAll();
  });
});

// 🚀 Start
loadVideos();
monitorShuffleTimers();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
