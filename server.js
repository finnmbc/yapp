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

function createRoom() {
  return {
    id: 'room_' + Math.random().toString(36).substr(2, 9),
    users: [],
    createdAt: Date.now(),
  };
}

function cleanupRooms() {
  const now = Date.now();
  rooms = rooms.filter(room => room.users.length > 0 && (now - room.createdAt < ROOM_DURATION_MS));
}

function updateRoomsForAll() {
  const summary = rooms.map(r => ({ id: r.id, count: r.users.length }));
  io.emit('rooms_update', summary);
}

function assignUserToRoom(socketId) {
  // Finde einen Raum mit weniger als MAX_USERS_PER_ROOM Nutzern
  let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
  if (!room) {
    room = createRoom();
    rooms.push(room);
  }
  room.users.push(socketId);
  return room;
}

function shuffleUsers() {
  // Alle Nutzer sammeln
  const allUsers = rooms.flatMap(r => r.users);
  rooms = []; // Räume resetten

  // Nutzer zufällig mischen
  for (let i = allUsers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allUsers[i], allUsers[j]] = [allUsers[j], allUsers[i]];
  }

  // Nutzer neu auf Räume verteilen
  allUsers.forEach(socketId => {
    let room = rooms.find(r => r.users.length < MAX_USERS_PER_ROOM);
    if (!room) {
      room = createRoom();
      rooms.push(room);
    }
    room.users.push(socketId);
  });

  // Teilnehmer auch in Socket.io neu joinen lassen
  // Zuerst alle Nutzer rauswerfen aus alten Räumen
  io.sockets.sockets.forEach((socket) => {
    // Entferne den Nutzer aus allen Räumen
    const socketRooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    socketRooms.forEach(rId => socket.leave(rId));
  });

  // Dann jedem Nutzer neuen Raum joinen und informieren
  rooms.forEach(room => {
    room.users.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.join(room.id);
        socket.emit('joined_room', room.id);
      }
    });
  });

  updateRoomsForAll();
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  cleanupRooms();

  const room = assignUserToRoom(socket.id);
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
    // Räume ohne Nutzer löschen
    cleanupRooms();

    updateRoomsForAll();
  });
});

// Timer für alle 2 Minuten Räume zufällig neu mischen
setInterval(() => {
  console.log('Shuffle users in rooms...');
  shuffleUsers();
}, RESHUFFLE_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
