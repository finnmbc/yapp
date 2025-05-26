const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 10;
const ROOM_DURATION_MS = 10 * 60 * 1000; // 10 Minuten

let rooms = [];

function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    createdAt: Date.now(),
  };
}

function cleanupRooms() {
  const now = Date.now();
  rooms = rooms.filter(room => now - room.createdAt < ROOM_DURATION_MS);
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  cleanupRooms();

  let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
  if (!room) {
    room = createRoom();
    rooms.push(room);
  }
  room.users.push(socket.id);
  socket.join(room.id);

  socket.emit('joined_room', room.id);

  socket.on('message', (msg) => {
    io.to(room.id).emit('message', { user: socket.id, text: msg });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    room.users = room.users.filter(u => u !== socket.id);
    if (room.users.length === 0) {
      rooms = rooms.filter(r => r.id !== room.id);
    }
  });
});

server.listen(3000, () => {
  console.log('Server läuft auf http://localhost:3000');
});
