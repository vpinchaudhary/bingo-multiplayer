'use strict';

const game = require('./game');

/**
 * In-memory room/lobby manager. No database — rooms live only as long as the
 * process and disappear when empty, exactly like a Bingo night at home.
 *
 * Identity model: a "user" is { id, name } where id = slug(name)+timestamp,
 * created on the client and kept in localStorage for the session. The same
 * user id reconnecting re-attaches to whatever room they were in.
 */

let roomSeq = 1;

/** @typedef {{ id: string, name: string }} User */

class RoomStore {
  /**
   * @param {object} [opts]
   * @param {number} [opts.graceMs] - how long a disconnected player's seat (and
   *        an emptied room / vacated host role) is held before cleanup, so a
   *        refresh or brief network blip can rejoin the same game.
   */
  constructor(opts = {}) {
    /** @type {Map<string, object>} roomId -> room */
    this.rooms = new Map();
    this.graceMs = opts.graceMs != null ? opts.graceMs : 45000;
    /** Optional (roomId) => void, called when a deferred cleanup changes a room. */
    this.onRoomChange = null;
  }

  _emitChange(roomId) {
    if (typeof this.onRoomChange === 'function') this.onRoomChange(roomId);
  }

  /** Find the room a user is currently a member of (for rejoin), or null. */
  findRoomByUser(userId) {
    for (const room of this.rooms.values()) {
      if (room.players.some((p) => p.id === userId)) return room;
    }
    return null;
  }

  /** Public, lobby-safe summary of every room. */
  listRooms() {
    return [...this.rooms.values()].map((room) => ({
      id: room.id,
      name: room.name,
      hostName: this._playerName(room, room.hostId),
      players: room.players.filter((p) => p.connected).length,
      status: room.status, // 'waiting' | 'playing' | 'finished'
    }));
  }

  createRoom(user, roomName) {
    const id = `room-${roomSeq++}`;
    const room = {
      id,
      name: (roomName && roomName.trim()) || `${user.name}'s game`,
      hostId: user.id,
      status: 'waiting',
      players: [],
      calledNumbers: [], // ordered list of called numbers
      calledSet: new Set(),
      turnIndex: 0, // index into players[] of whose turn it is
      lastCall: null, // { num, byId, byName }
      result: null, // { winners: [{id,name}], draw: boolean }
    };
    this.rooms.set(id, room);
    this.addPlayer(id, user);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId) || null;
  }

  _playerName(room, userId) {
    const p = room.players.find((pl) => pl.id === userId);
    return p ? p.name : 'unknown';
  }

  /** Add (or reconnect) a player to a room. Returns the player object. */
  addPlayer(roomId, user) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    let player = room.players.find((p) => p.id === user.id);
    if (player) {
      // Rejoin: an existing member is reconnecting (refresh / network blip).
      // Works in any room state, including a game in progress.
      player.connected = true;
      player.name = user.name; // allow rename on reconnect
      this._reevaluateCleanup(room);
      return player;
    }

    // Brand-new players can only join a room that hasn't started.
    if (room.status !== 'waiting') return null;

    player = {
      id: user.id,
      name: user.name,
      connected: true,
      grid: null,
      lines: 0,
    };
    room.players.push(player);
    this._reevaluateCleanup(room);
    return player;
  }

  /**
   * Mark a player disconnected. Their seat is held for `graceMs` so a refresh
   * or brief drop can rejoin the same game. Their turn is skipped immediately,
   * but the room is only deleted (if empty) or the host only reassigned (if the
   * host left) once the grace window elapses without them coming back.
   */
  disconnect(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const player = room.players.find((p) => p.id === userId);
    if (player) player.connected = false;

    // Don't make a disconnected player block the game — skip their turn now.
    this._fixTurnIfNeeded(room);

    // Defer room deletion / host hand-off until the grace window passes.
    this._reevaluateCleanup(room);
  }

  // ----- Grace-window cleanup -----

  /** True if the room currently needs deferred cleanup (empty or host gone). */
  _needsCleanup(room) {
    const connected = room.players.filter((p) => p.connected);
    if (connected.length === 0) return true;
    const host = room.players.find((p) => p.id === room.hostId);
    return !host || !host.connected;
  }

  /** (Re)decide whether a cleanup timer should be pending for this room. */
  _reevaluateCleanup(room) {
    if (this._needsCleanup(room)) {
      this._scheduleCleanup(room);
    } else {
      this._cancelCleanup(room);
    }
  }

  _scheduleCleanup(room) {
    if (room._cleanupTimer) return; // already pending
    room._cleanupTimer = setTimeout(() => {
      room._cleanupTimer = null;
      this.runCleanupNow(room.id);
    }, this.graceMs);
    // A pending cleanup shouldn't keep the process alive on its own.
    if (room._cleanupTimer && typeof room._cleanupTimer.unref === 'function') {
      room._cleanupTimer.unref();
    }
  }

  _cancelCleanup(room) {
    if (room._cleanupTimer) {
      clearTimeout(room._cleanupTimer);
      room._cleanupTimer = null;
    }
  }

  /**
   * Run cleanup immediately (called by the grace timer; also handy for tests):
   * delete the room if nobody returned, or hand the host role to a remaining
   * player if the host never came back. Notifies via onRoomChange if relevant.
   */
  runCleanupNow(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this._cancelCleanup(room);

    const connected = room.players.filter((p) => p.connected);
    if (connected.length === 0) {
      this.rooms.delete(roomId);
      this._emitChange(roomId);
      return;
    }

    const host = room.players.find((p) => p.id === room.hostId);
    if (!host || !host.connected) {
      room.hostId = connected[0].id;
      this._fixTurnIfNeeded(room);
      this._emitChange(roomId);
    }
  }

  /** Host removes a player entirely. */
  kickPlayer(roomId, hostId, targetId) {
    const room = this.rooms.get(roomId);
    if (!room || room.hostId !== hostId || hostId === targetId) return false;
    const idx = room.players.findIndex((p) => p.id === targetId);
    if (idx === -1) return false;
    room.players.splice(idx, 1);
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    this._fixTurnIfNeeded(room);
    this._reevaluateCleanup(room);
    return true;
  }

  /** Host leaves a room voluntarily (lobby). */
  leaveRoom(roomId, userId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const idx = room.players.findIndex((p) => p.id === userId);
    if (idx !== -1) room.players.splice(idx, 1);

    if (room.players.length === 0) {
      this._cancelCleanup(room);
      this.rooms.delete(roomId);
      return;
    }
    if (room.hostId === userId) room.hostId = room.players[0].id;
    if (room.turnIndex >= room.players.length) room.turnIndex = 0;
    this._fixTurnIfNeeded(room);
    this._reevaluateCleanup(room);
  }

  /** Host starts the game: deal grids, reset state. */
  startGame(roomId, hostId) {
    const room = this.rooms.get(roomId);
    if (!room || room.hostId !== hostId) return { ok: false, error: 'Only the host can start' };
    if (room.status === 'playing') return { ok: false, error: 'Already started' };
    const active = room.players.filter((p) => p.connected);
    if (active.length < 2) return { ok: false, error: 'Need at least 2 players' };

    for (const p of room.players) {
      p.grid = game.generateGrid();
      p.lines = 0;
    }
    room.calledNumbers = [];
    room.calledSet = new Set();
    room.turnIndex = 0;
    room.lastCall = null;
    room.result = null;
    room.status = 'playing';
    this._fixTurnIfNeeded(room); // ensure turn starts on a connected player
    return { ok: true };
  }

  /**
   * The current player calls a number.
   * @returns {{ok: boolean, error?: string, finished?: boolean}}
   */
  callNumber(roomId, userId, num) {
    const room = this.rooms.get(roomId);
    if (!room) return { ok: false, error: 'Room not found' };
    if (room.status !== 'playing') return { ok: false, error: 'Game not in progress' };

    const current = room.players[room.turnIndex];
    if (!current || current.id !== userId) return { ok: false, error: "It's not your turn" };

    const valid = game.validateCall(num, room.calledSet);
    if (!valid.ok) return { ok: false, error: valid.error };

    // Record the call; everyone marks it.
    room.calledNumbers.push(num);
    room.calledSet.add(num);
    room.lastCall = { num, byId: current.id, byName: current.name };

    // Recompute every player's completed lines.
    for (const p of room.players) {
      p.lines = p.grid ? game.countLines(p.grid, room.calledSet) : 0;
    }

    // Win check — anyone at >=5 lines after this call wins; ties => draw.
    const winners = room.players.filter((p) => game.hasWon(p.lines));
    if (winners.length > 0) {
      room.status = 'finished';
      room.result = {
        winners: winners.map((p) => ({ id: p.id, name: p.name, lines: p.lines })),
        draw: winners.length > 1,
      };
      return { ok: true, finished: true };
    }

    this._advanceTurn(room);
    return { ok: true, finished: false };
  }

  /** Host resets a finished room back to the lobby/waiting state. */
  playAgain(roomId, hostId) {
    const room = this.rooms.get(roomId);
    if (!room || room.hostId !== hostId) return false;
    room.status = 'waiting';
    room.calledNumbers = [];
    room.calledSet = new Set();
    room.turnIndex = 0;
    room.lastCall = null;
    room.result = null;
    for (const p of room.players) {
      p.grid = null;
      p.lines = 0;
    }
    return true;
  }

  _advanceTurn(room) {
    const n = room.players.length;
    if (n === 0) return;
    for (let step = 1; step <= n; step++) {
      const idx = (room.turnIndex + step) % n;
      if (room.players[idx].connected) {
        room.turnIndex = idx;
        return;
      }
    }
    // No connected players (shouldn't happen mid-call) — leave as is.
  }

  /** Make sure turnIndex points at a connected player. */
  _fixTurnIfNeeded(room) {
    const n = room.players.length;
    if (n === 0) { room.turnIndex = 0; return; }
    if (room.turnIndex >= n) room.turnIndex = 0;
    if (room.players[room.turnIndex] && room.players[room.turnIndex].connected) return;
    for (let step = 0; step < n; step++) {
      const idx = (room.turnIndex + step) % n;
      if (room.players[idx].connected) { room.turnIndex = idx; return; }
    }
  }

  /**
   * Build the per-room state to send to clients. Each player only sees their
   * own grid; opponents are shown by name, connection, line count and turn.
   * @param {string} roomId
   * @param {string} forUserId - the recipient (to include their grid)
   */
  viewFor(roomId, forUserId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const current = room.players[room.turnIndex];
    return {
      id: room.id,
      name: room.name,
      status: room.status,
      hostId: room.hostId,
      youId: forUserId,
      currentTurnId: current ? current.id : null,
      lastCall: room.lastCall,
      calledNumbers: room.calledNumbers,
      result: room.result,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        lines: p.lines,
        isHost: p.id === room.hostId,
        // Only reveal the grid to its owner.
        grid: p.id === forUserId ? p.grid : null,
      })),
    };
  }
}

module.exports = { RoomStore };
