const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const MAX_USERS_PER_ROOM = 4;
const MIN_USERS_PER_ROOM = 2;
const RESHUFFLE_INTERVAL_MS = (1 * 60 + 3) * 1000;

let rooms = [];
let nextShuffleTimestamp = Date.now() + RESHUFFLE_INTERVAL_MS;

// Raum erstellen (ohne createdAt)
function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: []
  };
}

// Nur leere Räume entfernen
function cleanupRooms() {
  rooms = rooms.filter(room => room.users.length > 0);
}

// Räume an alle Clients senden
function updateRoomsForAll() {
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

// Nutzer fair auf Räume verteilen (2–4 Nutzer pro Raum, keine 1er-Gruppen)
function shuffleUsers() {
  const allUsers = Array.from(io.sockets.sockets.keys());

  // Nutzer mischen
  for (let i = allUsers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allUsers[i], allUsers[j]] = [allUsers[j], allUsers[i]];
  }

  rooms = [];
  const groups = [];

  let i = 0;
  while (i < allUsers.length) {
    const usersLeft = allUsers.length - i;
    let groupSize;

    if (usersLeft === 1) {
      const lastGroup = groups.pop();
      lastGroup.push(allUsers[i]);
      groups.push(lastGroup);
      break;
    }

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

  // Alte Räume verlassen
  io.sockets.sockets.forEach(socket => {
    const socketRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    socketRooms.forEach(rId => socket.leave(rId));
  });

  // Räume zuweisen
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

// Statische Dateien bereitstellen
app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO Verbindung
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  cleanupRooms();

  // Suche vorhandene Raumzuweisung
  let assignedRoom = null;
  for (const room of rooms) {
    if (room.users.includes(socket.id)) {
      assignedRoom = room;
      break;
    }
  }

  if (assignedRoom) {
    socket.join(assignedRoom.id);
    socket.emit('joined_room', {
      roomId: assignedRoom.id,
      nextShuffleTimestamp
    });
  } else {
    socket.emit('joined_room', {
      roomId: null,
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

// Shuffle-Zyklus
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

// Start
scheduleNextShuffle();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
