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

function updateRoomsForAll() {
  // Sende die Raumübersicht an alle Clients
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  cleanupRooms();

  // Räume neu erzeugen, falls zu wenige vorhanden für aktuelle Nutzer
  // Dabei Räume mit max 10 Nutzern füllen
  const totalUsers = io.engine.clientsCount;

  // Aktuell belegte Plätze zählen
  const totalSlots = rooms.reduce((acc, r) => acc + r.users.length, 0);

  if (totalSlots < totalUsers) {
    const needed = totalUsers - totalSlots;
    // Neue Räume anlegen, wenn nötig
    for (let i = 0; i < needed; i++) {
      rooms.push(createRoom());
    }
  }

  // Nutzer einem Raum mit freiem Platz zuweisen
  let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
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
    // Nutzer aus allen Räumen entfernen (normalerweise nur 1 Raum)
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
