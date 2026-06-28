'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const game = require('../server/game');
const { RoomStore } = require('../server/rooms');

test('generateGrid: 5x5 with unique 1..25', () => {
  const grid = game.generateGrid();
  assert.equal(grid.length, 5);
  const flat = grid.flat();
  assert.equal(flat.length, 25);
  const set = new Set(flat);
  assert.equal(set.size, 25);
  for (let n = 1; n <= 25; n++) assert.ok(set.has(n), `missing ${n}`);
});

test('countLines: empty board has 0 lines', () => {
  const grid = game.generateGrid();
  assert.equal(game.countLines(grid, new Set()), 0);
});

test('countLines: counts rows, cols and diagonals', () => {
  const grid = [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20],
    [21, 22, 23, 24, 25],
  ];
  // Full first row only
  assert.equal(game.countLines(grid, new Set([1, 2, 3, 4, 5])), 1);
  // First column only
  assert.equal(game.countLines(grid, new Set([1, 6, 11, 16, 21])), 1);
  // Main diagonal only
  assert.equal(game.countLines(grid, new Set([1, 7, 13, 19, 25])), 1);
  // Anti diagonal only
  assert.equal(game.countLines(grid, new Set([5, 9, 13, 17, 21])), 1);
});

test('countLines: all 25 called => 12 lines', () => {
  const grid = game.generateGrid();
  const all = new Set();
  for (let n = 1; n <= 25; n++) all.add(n);
  assert.equal(game.countLines(grid, all), 12); // 5 rows + 5 cols + 2 diags
});

test('hasWon: needs 5 lines', () => {
  assert.equal(game.hasWon(4), false);
  assert.equal(game.hasWon(5), true);
  assert.equal(game.hasWon(6), true);
});

test('validateCall: range and duplicates', () => {
  assert.equal(game.validateCall(0, new Set()).ok, false);
  assert.equal(game.validateCall(26, new Set()).ok, false);
  assert.equal(game.validateCall(5.5, new Set()).ok, false);
  assert.equal(game.validateCall(5, new Set([5])).ok, false);
  assert.equal(game.validateCall(5, new Set()).ok, true);
});

// ---------- Room flow ----------
function user(id, name) { return { id, name: name || id }; }

test('room: create, join, start requires 2 players', () => {
  const store = new RoomStore();
  const room = store.createRoom(user('a'), 'Test');
  assert.equal(room.players.length, 1);

  let res = store.startGame(room.id, 'a');
  assert.equal(res.ok, false, 'cannot start with one player');

  store.addPlayer(room.id, user('b'));
  res = store.startGame(room.id, 'a');
  assert.equal(res.ok, true);
  assert.equal(room.status, 'playing');
  assert.ok(room.players.every((p) => p.grid));
});

test('room: only host can start', () => {
  const store = new RoomStore();
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  const res = store.startGame(room.id, 'b');
  assert.equal(res.ok, false);
});

test('room: turn enforcement and rotation', () => {
  const store = new RoomStore();
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  store.startGame(room.id, 'a');

  // b cannot call on a's turn
  let res = store.callNumber(room.id, 'b', 1);
  assert.equal(res.ok, false);

  // a calls 1, turn moves to b
  res = store.callNumber(room.id, 'a', 1);
  assert.equal(res.ok, true);
  assert.equal(room.players[room.turnIndex].id, 'b');

  // a cannot call again
  res = store.callNumber(room.id, 'a', 2);
  assert.equal(res.ok, false);
});

test('room: winning by completing 5 lines', () => {
  const store = new RoomStore();
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  store.startGame(room.id, 'a');

  // Force a known grid for player a so we control the win.
  const pa = room.players.find((p) => p.id === 'a');
  pa.grid = [
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10],
    [11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20],
    [21, 22, 23, 24, 25],
  ];
  const pb = room.players.find((p) => p.id === 'b');
  // Give b a grid that won't accidentally win on these numbers.
  pb.grid = [
    [25, 24, 23, 22, 21],
    [20, 19, 18, 17, 16],
    [15, 14, 13, 12, 11],
    [10, 9, 8, 7, 6],
    [5, 4, 3, 2, 1],
  ];

  // Player a needs 5 lines. Rows 1..5 in a's grid = numbers 1..25 but we only
  // need 5 lines. Mark columns 1..5 fully -> that's 5 columns = 5 lines.
  // Column values for a: col0=[1,6,11,16,21] etc. Mark all 25 => both win.
  // Instead craft: mark first 4 rows (rows are lines) + need a's turn.
  // Simpler: drive calls so a completes 5 lines. We'll just call all of row1..row4
  // (4 lines) then column0 remaining to make the 5th.
  // Row1:1-5, Row2:6-10, Row3:11-15, Row4:16-20 -> 4 row-lines.
  // Column0 needs 1,6,11,16,21 -> 21 is the only uncalled; calling 21 completes col0 (5th line).
  const seq = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
  let finished = false;
  for (const num of seq) {
    const cur = room.players[room.turnIndex].id;
    const res = store.callNumber(room.id, cur, num);
    assert.equal(res.ok, true, `call ${num} should succeed`);
    if (res.finished) { finished = true; break; }
  }
  assert.equal(finished, true);
  assert.equal(room.status, 'finished');
  assert.ok(room.result.winners.some((w) => w.id === 'a'));
});

test('room: kick player (host only)', () => {
  const store = new RoomStore();
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  store.addPlayer(room.id, user('c'));

  assert.equal(store.kickPlayer(room.id, 'b', 'c'), false, 'non-host cannot kick');
  assert.equal(store.kickPlayer(room.id, 'a', 'c'), true);
  assert.equal(room.players.find((p) => p.id === 'c'), undefined);
});

test('room: disconnect skips turn now; host reassigned only after grace', () => {
  const store = new RoomStore({ graceMs: 9999 });
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  store.startGame(room.id, 'a');
  store.disconnect(room.id, 'a'); // host a drops
  // Turn skips the disconnected player immediately...
  assert.equal(room.players[room.turnIndex].id, 'b');
  // ...but the host role is held during the grace window.
  assert.equal(room.hostId, 'a');
  store.runCleanupNow(room.id); // grace elapses without a returning
  assert.equal(room.hostId, 'b');
});

test('room: empty room is held during grace, deleted after', () => {
  const store = new RoomStore({ graceMs: 9999 });
  const room = store.createRoom(user('a'));
  store.disconnect(room.id, 'a');
  assert.ok(store.getRoom(room.id), 'kept during grace window');
  store.runCleanupNow(room.id);
  assert.equal(store.getRoom(room.id), null, 'removed after grace');
});

test('rejoin: dropped player returns to the same in-progress game', () => {
  const store = new RoomStore({ graceMs: 9999 });
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  store.startGame(room.id, 'a');
  // a calls 1, then b drops mid-game.
  store.callNumber(room.id, 'a', 1);
  store.disconnect(room.id, 'b');
  assert.equal(room.players.find((p) => p.id === 'b').connected, false);

  // b reconnects via addPlayer (what the server's "hello" rejoin does).
  const rejoined = store.addPlayer(room.id, user('b'));
  assert.ok(rejoined);
  assert.equal(rejoined.connected, true);
  assert.equal(room.status, 'playing', 'same game still running');
  // Their board and the called numbers were preserved.
  assert.ok(rejoined.grid);
  assert.deepEqual(room.calledNumbers, [1]);
});

test('rejoin: host reclaims role by returning before grace ends', () => {
  const store = new RoomStore({ graceMs: 9999 });
  const room = store.createRoom(user('a'));
  store.addPlayer(room.id, user('b'));
  store.disconnect(room.id, 'a'); // host drops
  store.addPlayer(room.id, user('a')); // ...but comes right back
  store.runCleanupNow(room.id);
  assert.equal(room.hostId, 'a', 'host retained after returning in time');
});

test('rejoin: room survives a solo refresh within the grace window', () => {
  const store = new RoomStore({ graceMs: 9999 });
  const room = store.createRoom(user('a'));
  store.disconnect(room.id, 'a');   // tab closed
  assert.ok(store.getRoom(room.id)); // still there
  const back = store.addPlayer(room.id, user('a')); // refreshed back in
  assert.ok(back);
  store.runCleanupNow(room.id);
  assert.ok(store.getRoom(room.id), 'room kept because player returned');
});
