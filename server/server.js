'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { RoomStore } = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const store = new RoomStore();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

app.use(express.static(PUBLIC_DIR));
app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * Per-socket session: we remember which user this socket is and which room it
 * is in, so disconnects and broadcasts can be routed without trusting the
 * client to re-send everything every time.
 */
function sessionOf(socket) {
  if (!socket.data.session) socket.data.session = { user: null, roomId: null };
  return socket.data.session;
}

function sanitizeUser(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.slice(0, 80) : '';
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 24) : '';
  if (!id || !name) return null;
  return { id, name };
}

/** Push the updated lobby list to everyone. */
function broadcastLobby() {
  io.emit('lobby', store.listRooms());
}

/** Push room state to every socket currently in that room's socket.io room. */
function broadcastRoom(roomId) {
  const room = store.getRoom(roomId);
  if (!room) {
    // Room gone — tell its socket members to return to the lobby.
    io.to(roomId).emit('roomClosed');
    return;
  }
  const sockets = io.sockets.adapter.rooms.get(roomId);
  if (!sockets) return;
  for (const socketId of sockets) {
    const s = io.sockets.sockets.get(socketId);
    if (!s) continue;
    const session = sessionOf(s);
    if (!session.user) continue;
    s.emit('room', store.viewFor(roomId, session.user.id));
  }
}

io.on('connection', (socket) => {
  const session = sessionOf(socket);

  // Client announces who it is (from localStorage). Sent on every connect.
  socket.on('hello', (rawUser) => {
    const user = sanitizeUser(rawUser);
    if (!user) return socket.emit('errorMsg', 'Invalid name. Please pick a name.');
    session.user = user;
    socket.emit('lobby', store.listRooms());
  });

  socket.on('getLobby', () => {
    socket.emit('lobby', store.listRooms());
  });

  socket.on('createRoom', (roomName) => {
    if (!session.user) return socket.emit('errorMsg', 'Set your name first.');
    const room = store.createRoom(session.user, typeof roomName === 'string' ? roomName : '');
    session.roomId = room.id;
    socket.join(room.id);
    socket.emit('joined', room.id);
    broadcastRoom(room.id);
    broadcastLobby();
  });

  socket.on('joinRoom', (roomId) => {
    if (!session.user) return socket.emit('errorMsg', 'Set your name first.');
    const player = store.addPlayer(roomId, session.user);
    if (!player) return socket.emit('errorMsg', 'Could not join (game may have already started).');
    session.roomId = roomId;
    socket.join(roomId);
    socket.emit('joined', roomId);
    broadcastRoom(roomId);
    broadcastLobby();
  });

  socket.on('leaveRoom', () => {
    const { user, roomId } = session;
    if (!user || !roomId) return;
    socket.leave(roomId);
    store.leaveRoom(roomId, user.id);
    session.roomId = null;
    broadcastRoom(roomId);
    broadcastLobby();
    socket.emit('left');
  });

  socket.on('startGame', () => {
    const { user, roomId } = session;
    if (!user || !roomId) return;
    const res = store.startGame(roomId, user.id);
    if (!res.ok) return socket.emit('errorMsg', res.error);
    broadcastRoom(roomId);
    broadcastLobby();
  });

  socket.on('callNumber', (num) => {
    const { user, roomId } = session;
    if (!user || !roomId) return;
    const res = store.callNumber(roomId, user.id, Number(num));
    if (!res.ok) return socket.emit('errorMsg', res.error);
    broadcastRoom(roomId);
    if (res.finished) broadcastLobby();
  });

  socket.on('kickPlayer', (targetId) => {
    const { user, roomId } = session;
    if (!user || !roomId) return;
    const ok = store.kickPlayer(roomId, user.id, targetId);
    if (!ok) return socket.emit('errorMsg', 'Could not kick player.');
    // Tell the kicked player (if connected) to leave.
    const room = store.getRoom(roomId);
    io.to(roomId).emit('kicked', targetId);
    broadcastRoom(roomId);
    broadcastLobby();
    if (room) void room;
  });

  socket.on('playAgain', () => {
    const { user, roomId } = session;
    if (!user || !roomId) return;
    const ok = store.playAgain(roomId, user.id);
    if (!ok) return socket.emit('errorMsg', 'Only the host can restart.');
    broadcastRoom(roomId);
    broadcastLobby();
  });

  socket.on('disconnect', () => {
    const { user, roomId } = session;
    if (!user || !roomId) return;
    store.disconnect(roomId, user.id);
    broadcastRoom(roomId);
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Bingo server running at http://localhost:${PORT}`);
});

module.exports = { app, server, io, store };
