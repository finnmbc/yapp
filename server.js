const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const YAPPA_EXTRA_SECONDS = 33;
const IMAGE_DURATION_SECONDS = 180; // z. B. 3 Minuten Anschauzeit

let rooms = [];

// 🔁 Liefert zufällige Bild-URL von Unsplash
function getRandomImageUrl() {
  const seed = Math.floor(Math.random() * 1000000);
  return `https://source.unsplash.com/random/800x450?sig=${seed}`;
}

function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    imageUrl: getRandomImageUrl(),
    imageStart: Date.now(),
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
    room.shuffleAt = room.imageStart + 1000 * (IMAGE_DURATION_SECONDS + YAPPA_EXTRA_SECONDS);
    rooms.push(room);
  }

  room.users.push(socket.id);
  socket.join(room.id);

  socket.emit('joined_room', {
    roomId: room.id,
    imageUrl: room.imageUrl,
    imageStart: room.imageStart,
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
  let i = 0;

  while (i < allUsers.length) {
    const room = createRoom();
    room.users = allUsers.slice(i, i + MAX_USERS_PER_ROOM);
    room.imageStart = Date.now();
    room.shuffleAt = room.imageStart + 1000 * (IMAGE_DURATION_SECONDS + YAPPA_EXTRA_SECONDS);
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
          imageUrl: room.imageUrl,
          imageStart: room.imageStart,
          shuffleAt: room.shuffleAt
        });
      }
    });
  });

  updateRoomsForAll();
}

// 🧠 Raum-Zeit überwachen
function monitorShuffleTimers() {
  setInterval(() => {
    const now = Date.now();
    const due = rooms.find(r => r.shuffleAt && now >= r.shuffleAt);

    if (due) {
      console.log("🔄 Shuffle ausgelöst.");
      shuffleUsers();
      io.emit('trigger_reload');
    }
  }, 1000);
}

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

// Start
monitorShuffleTimers();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
