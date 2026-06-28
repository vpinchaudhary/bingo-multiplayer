'use strict';

/* ====== Bingo Night — client ====== */

const socket = io();

// ---- Local identity (persisted for the session) ----
const STORAGE_KEY = 'bingo.user';

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'player';
}

function loadUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveUser(user) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

function createUser(name) {
  // Unique, stable-for-the-session id = slug(name) + timestamp.
  return { id: `${slug(name)}-${Date.now()}`, name: name.trim() };
}

let me = loadUser();
let currentRoom = null;     // latest room view from server
let currentRoomId = null;   // id we believe we're in
let prevCalledCount = 0;    // to animate the newest called number

// ---- DOM helpers ----
const $ = (sel) => document.querySelector(sel);
const screens = {
  name: $('#screen-name'),
  lobby: $('#screen-lobby'),
  room: $('#screen-room'),
};

function showScreen(key) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[key].classList.add('active');
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ================= Name screen =================
const nameForm = $('#name-form');
const nameInput = $('#name-input');

nameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  if (name.length < 1) return toast('Please enter a name');
  me = createUser(name);
  saveUser(me);
  socket.emit('hello', me);
  enterLobby();
});

$('#change-name').addEventListener('click', () => {
  // Renaming creates a fresh identity (per spec: persistent unless renamed).
  showScreen('name');
  nameInput.value = me ? me.name : '';
  nameInput.focus();
});

function enterLobby() {
  $('#me-name').textContent = me.name;
  showScreen('lobby');
  socket.emit('getLobby');
}

// ================= Lobby =================
$('#create-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const roomName = $('#room-name-input').value.trim();
  socket.emit('createRoom', roomName);
  $('#room-name-input').value = '';
});

$('#refresh-lobby').addEventListener('click', () => socket.emit('getLobby'));
$('#change-name').addEventListener('click', () => {});

function renderLobby(rooms) {
  const list = $('#room-list');
  list.innerHTML = '';
  $('#no-rooms').hidden = rooms.length > 0;

  rooms.forEach((r) => {
    const li = document.createElement('li');
    li.className = 'room-item';
    const joinable = r.status === 'waiting';
    li.innerHTML = `
      <div class="meta">
        <div class="rname"></div>
        <div class="rsub"></div>
      </div>
      <span class="badge ${r.status}">${r.status}</span>
    `;
    li.querySelector('.rname').textContent = r.name;
    li.querySelector('.rsub').textContent =
      `host ${r.hostName} • ${r.players} player${r.players === 1 ? '' : 's'}`;
    if (joinable) {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => socket.emit('joinRoom', r.id));
    } else {
      li.style.opacity = '.55';
    }
    list.appendChild(li);
  });
}

// ================= Room: leave / start / kick / play again =================
$('#leave-room').addEventListener('click', () => {
  socket.emit('leaveRoom');
});
$('#start-game').addEventListener('click', () => socket.emit('startGame'));
$('#play-again').addEventListener('click', () => {
  hideResult();
  socket.emit('playAgain');
});
$('#back-to-room').addEventListener('click', hideResult);

// ================= Render a room view =================
function renderRoom(room) {
  currentRoom = room;
  currentRoomId = room.id;
  showScreen('room');

  $('#room-title').textContent = room.name;
  const statusPill = $('#room-status');
  statusPill.textContent = room.status;

  const isHost = room.hostId === me.id;

  if (room.status === 'waiting') {
    renderWaiting(room, isHost);
  } else {
    renderPlay(room, isHost);
  }

  if (room.status === 'finished' && room.result) {
    showResult(room, isHost);
  }
}

function playerLi(p, { kickable }) {
  const li = document.createElement('li');
  const left = document.createElement('div');
  left.className = 'pleft';
  left.innerHTML = `
    <span class="dot ${p.connected ? '' : 'off'}"></span>
    <span class="pname"></span>
    ${p.isHost ? '<span class="tag-host">HOST</span>' : ''}
    ${p.id === me.id ? '<span class="tag-you">you</span>' : ''}
  `;
  left.querySelector('.pname').textContent = p.name;
  li.appendChild(left);

  if (kickable && p.id !== me.id) {
    const x = document.createElement('button');
    x.className = 'kick-x';
    x.textContent = '✕';
    x.title = 'Remove player';
    x.addEventListener('click', () => socket.emit('kickPlayer', p.id));
    li.appendChild(x);
  } else {
    const badge = document.createElement('span');
    badge.className = 'lines-badge';
    badge.textContent = `${p.lines} line${p.lines === 1 ? '' : 's'}`;
    li.appendChild(badge);
  }
  return li;
}

// ---- Waiting view ----
function renderWaiting(room, isHost) {
  $('#waiting-view').hidden = false;
  $('#play-view').hidden = true;

  const ul = $('#waiting-players');
  ul.innerHTML = '';
  room.players.forEach((p) => ul.appendChild(playerLi(p, { kickable: isHost })));

  $('#host-controls').hidden = !isHost;
  $('#waiting-hint').hidden = isHost;

  const connected = room.players.filter((p) => p.connected).length;
  $('#start-game').disabled = connected < 2;
}

// ---- Play view ----
function renderPlay(room, isHost) {
  $('#waiting-view').hidden = true;
  $('#play-view').hidden = false;

  const you = room.players.find((p) => p.id === me.id);
  const myTurn = room.currentTurnId === me.id && room.status === 'playing';
  const currentPlayer = room.players.find((p) => p.id === room.currentTurnId);

  // Turn banner
  const banner = $('#turn-banner');
  if (room.status === 'finished') {
    banner.classList.remove('you');
    banner.textContent = 'Game over';
  } else if (myTurn) {
    banner.classList.add('you');
    banner.textContent = '🎯 Your turn — call a number!';
  } else {
    banner.classList.remove('you');
    banner.textContent = `Waiting for ${currentPlayer ? currentPlayer.name : '…'}`;
  }

  // BINGO letters (for me)
  renderBingoLetters(you ? you.lines : 0);

  // Grid (mine)
  renderGrid(you ? you.grid : null, room.calledNumbers);

  // Last call
  const lc = $('#last-call');
  if (room.lastCall) {
    lc.innerHTML = `Last call: <strong>${room.lastCall.num}</strong> by ${room.lastCall.byName}`;
  } else {
    lc.textContent = 'No numbers called yet';
  }

  // Number pad
  renderNumberPad(room, myTurn);

  // Players & lines
  const ul = $('#play-players');
  ul.innerHTML = '';
  room.players.forEach((p) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="pleft">
        <span class="dot ${p.connected ? '' : 'off'}"></span>
        <span class="pname"></span>
        ${p.id === room.currentTurnId ? '🎯' : ''}
      </div>
      <span class="lines-badge">${'★'.repeat(p.lines)}${p.lines}/5</span>
    `;
    li.querySelector('.pname').textContent = p.name;
    ul.appendChild(li);
  });

  // Called numbers
  const cl = $('#called-list');
  cl.innerHTML = '';
  room.calledNumbers.forEach((n) => {
    const s = document.createElement('span');
    s.textContent = n;
    cl.appendChild(s);
  });

  prevCalledCount = room.calledNumbers.length;
}

function renderBingoLetters(lines) {
  const wrap = $('#bingo-letters');
  wrap.innerHTML = '';
  ['B', 'I', 'N', 'G', 'O'].forEach((ch, i) => {
    const d = document.createElement('div');
    d.className = 'bl' + (i < lines ? ' on' : '');
    d.textContent = ch;
    wrap.appendChild(d);
  });
}

function renderGrid(grid, calledNumbers) {
  const el = $('#grid');
  el.innerHTML = '';
  if (!grid) return;
  const calledSet = new Set(calledNumbers);
  const newest = calledNumbers.length > prevCalledCount
    ? calledNumbers[calledNumbers.length - 1]
    : null;

  grid.forEach((row) => {
    row.forEach((num) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (calledSet.has(num)) {
        cell.classList.add('marked');
        if (num === newest) cell.classList.add('just');
      }
      cell.textContent = num;
      el.appendChild(cell);
    });
  });
}

function renderNumberPad(room, myTurn) {
  const pad = $('#number-pad');
  pad.innerHTML = '';
  pad.classList.toggle('locked', !myTurn);
  const calledSet = new Set(room.calledNumbers);
  for (let n = 1; n <= 25; n++) {
    const b = document.createElement('button');
    b.className = 'np' + (calledSet.has(n) ? ' called' : '');
    b.textContent = n;
    if (!calledSet.has(n) && myTurn) {
      b.addEventListener('click', () => socket.emit('callNumber', n));
    }
    pad.appendChild(b);
  }
}

// ================= Result overlay =================
function showResult(room, isHost) {
  const overlay = $('#result-overlay');
  const { winners, draw } = room.result;
  const iWon = winners.some((w) => w.id === me.id);

  $('#result-emoji').textContent = iWon ? '🏆' : (draw ? '🤝' : '🎊');
  $('#result-title').textContent = draw ? "It's a draw!" : 'BINGO!';

  let detail;
  if (draw) {
    detail = `${winners.map((w) => w.name).join(' & ')} tied with 5 lines!`;
  } else {
    detail = `${winners[0].name} won with B-I-N-G-O!`;
  }
  if (iWon && !draw) detail = 'You got 5 lines first — you win! 🎉';
  $('#result-detail').textContent = detail;

  $('#play-again').hidden = !isHost;
  overlay.hidden = false;
}

function hideResult() {
  $('#result-overlay').hidden = true;
}

// ================= Socket events =================
socket.on('connect', () => {
  if (me) socket.emit('hello', me);
});

socket.on('lobby', (rooms) => {
  // Only refresh the lobby list when we're actually on the lobby screen.
  renderLobby(rooms);
});

socket.on('joined', (roomId) => {
  currentRoomId = roomId;
});

socket.on('room', (room) => {
  if (!room) return;
  renderRoom(room);
});

socket.on('roomClosed', () => {
  currentRoomId = null;
  currentRoom = null;
  hideResult();
  toast('Room closed');
  enterLobby();
});

socket.on('left', () => {
  currentRoomId = null;
  currentRoom = null;
  hideResult();
  enterLobby();
});

socket.on('kicked', (targetId) => {
  if (me && targetId === me.id) {
    currentRoomId = null;
    currentRoom = null;
    hideResult();
    toast('You were removed from the game');
    enterLobby();
  }
});

socket.on('errorMsg', (msg) => toast(msg));

// ================= Boot =================
if (me && me.name) {
  socket.emit('hello', me);
  $('#me-name').textContent = me.name;
  enterLobby();
} else {
  showScreen('name');
}
