const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const YAPPA_EXTRA_SECONDS = 30;
const IMAGE_DURATION_SECONDS = 3;

let rooms = [];
const userRoomMap = new Map(); // socket.id → room.id
const roomTimeouts = new Map(); // room.id → Timeout-Handle

function getRandomImageSeed() {
  return Math.floor(Math.random() * 1000000);
}

function createRoom() {
  const now = Date.now();
  const seed = getRandomImageSeed();
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    imageSeed: seed,
    imageUrl: `https://picsum.photos/seed/${seed}/800/450`,
    imageStart: now,
    shuffleAt: now + 1000 * (IMAGE_DURATION_SECONDS + YAPPA_EXTRA_SECONDS)
  };
}

function cleanupRoomsDelayed(roomId) {
  if (roomTimeouts.has(roomId)) return;

  const timeout = setTimeout(() => {
    const room = rooms.find(r => r.id === roomId);
    if (room && room.users.length === 0) {
      rooms = rooms.filter(r => r.id !== roomId);
      roomTimeouts.delete(roomId);
      updateRoomsForAll();
    }
  }, 3000);

  roomTimeouts.set(roomId, timeout);
}

function updateRoomsForAll() {
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

function assignUserToRoom(socket) {
  const existingRoomId = userRoomMap.get(socket.id);
  const existingRoom = rooms.find(r => r.id === existingRoomId);

  if (existingRoom) {
    existingRoom.users.push(socket.id);
    socket.join(existingRoom.id);
    clearTimeout(roomTimeouts.get(existingRoom.id));
    roomTimeouts.delete(existingRoom.id);

    socket.emit('joined_room', {
      roomId: existingRoom.id,
      imageUrl: existingRoom.imageUrl,
      imageStart: existingRoom.imageStart,
      shuffleAt: existingRoom.shuffleAt
    });

    return updateRoomsForAll();
  }

  let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
  if (!room) {
    room = createRoom();
    rooms.push(room);
  }

  room.users.push(socket.id);
  userRoomMap.set(socket.id, room.id);
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
  userRoomMap.clear();
  roomTimeouts.clear();

  let i = 0;
  while (i < allUsers.length) {
    const room = createRoom();
    room.users = allUsers.slice(i, i + MAX_USERS_PER_ROOM);
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
        userRoomMap.set(socket.id, room.id);
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
    const userRoomId = userRoomMap.get(socket.id);
    if (userRoomId) {
      io.to(userRoomId).emit('message', { user: socket.id, text: msg });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);

    const roomId = userRoomMap.get(socket.id);
    userRoomMap.delete(socket.id);

    const room = rooms.find(r => r.id === roomId);
    if (room) {
      room.users = room.users.filter(u => u !== socket.id);
      cleanupRoomsDelayed(roomId);
    }

    updateRoomsForAll();
  });
});

monitorShuffleTimers();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server läuft auf Port ${PORT}`);
});
