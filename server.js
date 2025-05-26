const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const ROOM_DURATION_MS = 10 * 60 * 1000; // 10 Minuten

let rooms = []; // Räume mit { id, users: [socketIds], createdAt }

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

function updateRoomsForAll() {
  // Sende die Raumübersicht an alle Clients
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  cleanupRooms();

  // Räume so anpassen, dass es mindestens so viele Räume wie Nutzer gibt
  // Also: Jeder Nutzer in seinem eigenen Raum
  if (rooms.length < io.engine.clientsCount) {
    const needed = io.engine.clientsCount - rooms.length;
    for (let i = 0; i < needed; i++) {
      rooms.push(createRoom());
    }
  }

  // Nutzer einem Raum mit Platz zuweisen (Platz hier = 1 Nutzer pro Raum)
  let room = rooms.find(r => r.users.length < 1);
  if (!room) {
    room = createRoom();
    rooms.push(room);
  }
  room.users.push(socket.id);
  socket.join(room.id);

  socket.emit('joined_room', room.id);

  updateRoomsForAll();

  socket.on('message', (msg) => {
    io.to(room.id).emit('message', { user: socket.id, text: msg });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Nutzer aus Raum entfernen
    rooms.forEach(r => {
      r.users = r.users.filter(u => u !== socket.id);
    });
    // Räume ohne Nutzer entfernen
    rooms = rooms.filter(r => r.users.length > 0);

    updateRoomsForAll();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
