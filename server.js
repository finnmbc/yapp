const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const ROOM_DURATION_MS = 10 * 60 * 1000; // 10 Minuten
const RESHUFFLE_INTERVAL_MS = 2 * 60 * 1000; // 2 Minuten

let rooms = [];
let nextShuffleTimestamp = Date.now() + RESHUFFLE_INTERVAL_MS;

// Hilfsfunktion zum Erstellen eines neuen Raums
function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    createdAt: Date.now(),
  };
}

// Alte/ungültige Räume entfernen
function cleanupRooms() {
  const now = Date.now();
  rooms = rooms.filter(room => room.users.length > 0 && (now - room.createdAt < ROOM_DURATION_MS));
}

// Alle Clients über aktuelle Räume informieren
function updateRoomsForAll() {
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

// Nutzer zufällig auf Räume verteilen
function shuffleUsers() {
  const allUsers = [];

  // Alle verbundenen Sockets sammeln
  io.sockets.sockets.forEach((socket) => {
    allUsers.push(socket.id);
  });

  // Nutzer mischen (Fisher-Yates)
  for (let i = allUsers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allUsers[i], allUsers[j]] = [allUsers[j], allUsers[i]];
  }

  rooms = [];

  // Nutzer auf neue Räume verteilen
  allUsers.forEach(socketId => {
    let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
    if (!room) {
      room = createRoom();
      rooms.push(room);
    }
    room.users.push(socketId);
  });

  // Alle Nutzer aus alten Räumen entfernen
  io.sockets.sockets.forEach((socket) => {
    const socketRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    socketRooms.forEach(rId => socket.leave(rId));
  });

  // Nutzer neuen Räumen zuweisen und Event senden
  rooms.forEach(room => {
    room.users.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(room.id);
        socket.emit('joined_room', {
          roomId: room.id,
          nextShuffleTimestamp
        });
      }
    });
  });

  updateRoomsForAll();
}

// Statische Dateien aus dem "public"-Ordner bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// WebSocket-Handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  cleanupRooms();

  const room = rooms.find(r => r.users.includes(socket.id));
  if (room) {
    socket.join(room.id);
  }

  // Immer joined_room senden – mit oder ohne Raum
  socket.emit('joined_room', {
    roomId: room ? room.id : null,
    nextShuffleTimestamp
  });

  updateRoomsForAll();

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

// Zyklisches Shuffeln alle 2 Minuten
setInterval(() => {
  console.log('Shuffle users in rooms...');
  shuffleUsers();
  nextShuffleTimestamp = Date.now() + RESHUFFLE_INTERVAL_MS;
}, RESHUFFLE_INTERVAL_MS);

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
