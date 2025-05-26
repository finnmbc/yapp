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

// Raum erstellen
function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    createdAt: Date.now(),
  };
}

// Alte Räume bereinigen
function cleanupRooms() {
  const now = Date.now();
  rooms = rooms.filter(room => room.users.length > 0 && (now - room.createdAt < ROOM_DURATION_MS));
}

// Räume an alle senden
function updateRoomsForAll() {
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

// Nutzer auf Räume verteilen
function shuffleUsers() {
  const allUsers = Array.from(io.sockets.sockets.keys());

  // Nutzer mischen (Fisher-Yates)
  for (let i = allUsers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allUsers[i], allUsers[j]] = [allUsers[j], allUsers[i]];
  }

  rooms = [];

  allUsers.forEach(socketId => {
    let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
    if (!room) {
      room = createRoom();
      rooms.push(room);
    }
    room.users.push(socketId);
  });

  // Nutzer aus alten Räumen entfernen
  io.sockets.sockets.forEach(socket => {
    const socketRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    socketRooms.forEach(rId => socket.leave(rId));
  });

  // Nutzer neuen Räumen zuweisen
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

// Nutzer bei Verbindung einem Raum zuweisen
function assignUserToRoom(socket) {
  let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
  if (!room) {
    room = createRoom();
    rooms.push(room);
  }

  room.users.push(socket.id);
  socket.join(room.id);

  socket.emit('joined_room', {
    roomId: room.id,
    nextShuffleTimestamp
  });

  updateRoomsForAll();
}

// Statische Dateien bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Socket-Verbindung
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  cleanupRooms();

  const existingRoom = rooms.find(r => r.users.includes(socket.id));
  if (!existingRoom) {
    assignUserToRoom(socket);
  } else {
    socket.join(existingRoom.id);
    socket.emit('joined_room', {
      roomId: existingRoom.id,
      nextShuffleTimestamp
    });
  }

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

// ⏱ Genaues Timing mit rekursivem setTimeout
function scheduleNextShuffle() {
  const now = Date.now();
  const delay = nextShuffleTimestamp - now;

  console.log(`Nächstes Shuffle in ${Math.round(delay / 1000)} Sekunden.`);

  setTimeout(() => {
    console.log('Shuffle users...');
    shuffleUsers();

    // Neues Ziel-Zeitfenster berechnen
    nextShuffleTimestamp = Date.now() + RESHUFFLE_INTERVAL_MS;

    // Clients zentral zum Reload auffordern
    io.emit('trigger_reload');

    // Nächsten Shuffle planen
    scheduleNextShuffle();
  }, delay);
}

// Initial starten
scheduleNextShuffle();

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
