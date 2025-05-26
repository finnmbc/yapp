const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const RESHUFFLE_INTERVAL_MS = (1 * 60 + 3) * 1000;

let rooms = [];
let nextShuffleTimestamp = Date.now() + RESHUFFLE_INTERVAL_MS;

// Liste mit normalen YouTube-Video-IDs
const videoIds = [
  "dQw4w9WgXcQ", // Rickroll
  "kJQP7kiw5Fk", // Despacito
  "3JZ_D3ELwOQ", // Nyan Cat
  "Zi_XLOBDo_Y", // Michael Jackson - Billie Jean
  "RgKAFK5djSk"  // Wiz Khalifa - See You Again
];

function getRandomVideoId(exclude = []) {
  const options = videoIds.filter(id => !exclude.includes(id));
  return options[Math.floor(Math.random() * options.length)];
}

function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    videoId: null
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
    rooms.push(room);
  }

  room.users.push(socket.id);
  socket.join(room.id);

  socket.emit('joined_room', {
    roomId: room.id,
    nextShuffleTimestamp
  });

  if (room.videoId) {
    socket.emit('video_prompt', { videoId: room.videoId });
  }

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
          nextShuffleTimestamp
        });

        if (room.videoId) {
          socket.emit('video_prompt', { videoId: room.videoId });
        }
      }
    });
  });

  updateRoomsForAll();
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  assignUserToRoom(socket);

  socket.on('message', (msg) => {
    const userRoom = Array.from(socket.rooms).find(r => r !== socket.id);
    if (userRoom) {
      io.to(userRoom).emit('message', { user: socket.id, text: msg });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    rooms.forEach(r => {
      r.users = r.users.filter(u => u !== socket.id);
    });
    cleanupRooms();
    updateRoomsForAll();
  });
});

function scheduleNextShuffle() {
  const now = Date.now();
  const delay = nextShuffleTimestamp - now;

  console.log(`Nächstes Shuffle in ${Math.round(delay / 1000)} Sekunden.`);

  setTimeout(() => {
    console.log('Shuffle users...');
    shuffleUsers();
    nextShuffleTimestamp = Date.now() + RESHUFFLE_INTERVAL_MS;
    io.emit('trigger_reload');
    scheduleNextShuffle();
  }, delay);
}

scheduleNextShuffle();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
