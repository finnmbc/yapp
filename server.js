const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const MIN_USERS_PER_ROOM = 2;
const ROOM_DURATION_MS = 10 * 60 * 1000; // 10 Minuten
const RESHUFFLE_INTERVAL_MS = (1 * 60 + 3) * 1000; // 1:03 Minuten

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

// Nutzer fair auf Räume verteilen (2–4 Nutzer pro Raum, keine 1er-Gruppen)
function shuffleUsers() {
  const allUsers = Array.from(io.sockets.sockets.keys());

  // Nutzer mischen (Fisher-Yates)
  for (let i = allUsers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allUsers[i], allUsers[j]] = [allUsers[j], allUsers[i]];
  }

  rooms = [];
  const groups = [];

  let i = 0;
  while (i < allUsers.length) {
    const usersLeft = allUsers.length - i;

    if (usersLeft === 1) {
      // Letzten Nutzer umverteilen → keine 1er-Gruppe
      const lastGroup = groups.pop();
      const split = Math.floor(lastGroup.length / 2);
      const group1 = lastGroup.slice(0, split);
      const group2 = lastGroup.slice(split).concat(allUsers[i]);
      groups.push(group1, group2);
      break;
    }

    let groupSize;
    if (usersLeft === 2 || usersLeft === 3 || usersLeft === 4) {
      groupSize = usersLeft;
    } else if (usersLeft % 3 === 0 || usersLeft > 4) {
      groupSize = 3;
    } else {
      groupSize = 4;
    }

    const group = allUsers.slice(i, i + groupSize);
    groups.push(group);
    i += groupSize;
  }

  // Räume aus Gruppen erstellen
  groups.forEach(group => {
    const room = createRoom();
    room.users = group;
    rooms.push(room);
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

// Nutzer beim Verbindungsaufbau Raum zuweisen
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

// Socket.IO-Verbindung
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

// Shuffle-Zyklus mit präzisem Timing
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

// Shuffle starten
scheduleNextShuffle();

// Server starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
