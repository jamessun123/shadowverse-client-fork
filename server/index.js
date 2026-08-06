const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { getAllCardDefs } = require("sve-engine");
const { GameRoom } = require("./gameRoom");

const PORT = process.env.PORT || 5000;
const SERVER_VERSION = "0.2.1";
const CARD_DEF_COUNT = getAllCardDefs().length;
if (CARD_DEF_COUNT < 100) {
  console.warn(
    `[shadowverse-server] Only ${CARD_DEF_COUNT} card defs loaded — packages/sve-engine/data/cards.json may be missing from the deploy.`,
  );
}
const app = express();
app.use(cors());
app.get("/", (_req, res) =>
  res.json({
    status: "ok",
    mode: "authoritative",
    version: SERVER_VERSION,
    cardDefs: CARD_DEF_COUNT,
  }),
);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const rooms = new Map();

function normalizeRoomId(room) {
  if (room == null) return null;
  return String(room).trim();
}

function getOrCreateRoom(roomId, { testing = false } = {}) {
  const id = normalizeRoomId(roomId);
  if (!id) return null;
  if (!rooms.has(id)) {
    const room = new GameRoom(id, true);
    room.testing = !!testing;
    rooms.set(id, room);
  } else if (!rooms.get(id).automated) {
    rooms.get(id).automated = true;
  }
  return rooms.get(id);
}

function parseJoinPayload(raw) {
  if (typeof raw === "string" || typeof raw === "number") {
    return {
      room: normalizeRoomId(raw),
      playerId: null,
      deck: null,
      deckName: null,
      testing: false,
    };
  }
  if (raw && typeof raw === "object") {
    return {
      room: normalizeRoomId(raw.room),
      playerId: raw.playerId ?? null,
      deck: raw.deck ?? null,
      deckName: typeof raw.deckName === "string" ? raw.deckName : null,
      testing: !!raw.testing,
    };
  }
  return { room: null, playerId: null, deck: null, deckName: null, testing: false };
}

/** Rooms waiting for a second player (game not started yet). */
function listOpenRooms() {
  const open = [];
  for (const [id, room] of rooms) {
    if (room.state) continue;
    if (room.players.size === 0 || room.players.size >= 2) continue;
    open.push({
      roomId: id,
      players: room.players.size,
      deckName: room.hostDeckName || null,
      testing: !!room.testing,
      createdAt: room.createdAt || 0,
    });
  }
  open.sort((a, b) => b.createdAt - a.createdAt);
  return open;
}

function broadcastOpenRooms() {
  io.emit("open_rooms", listOpenRooms());
}

/** Prompt every seated client (by socket id) so room-membership races can't drop it. */
function emitAwaitingTurnOrder(gameRoom, { rematch = false } = {}) {
  gameRoom.awaitingTurnOrder = true;
  for (const [socketId, info] of gameRoom.players.entries()) {
    io.to(socketId).emit("awaiting_turn_order", {
      rematch: !!rematch,
      slot: info.slot,
      isHost: info.slot === 0,
    });
  }
}

function bothDecksReady(gameRoom) {
  return Boolean(
    gameRoom?.pendingDecks?.[0] &&
      gameRoom?.pendingDecks?.[1] &&
      !gameRoom.state,
  );
}

function leaveWaitingRoom(socket) {
  const roomId = socket.data.room;
  if (!roomId) return;
  const gameRoom = rooms.get(roomId);
  if (!gameRoom || gameRoom.state) return;

  gameRoom.players.delete(socket.id);
  socket.leave(roomId);
  socket.data.room = null;
  socket.data.slot = null;

  // Abort turn-order handshake — clear the lobby so a disconnected host seat
  // can't leave a ghost room that blocks matchmaking forever.
  if (gameRoom.awaitingTurnOrder) {
    gameRoom.awaitingTurnOrder = false;
    for (const sid of gameRoom.seatedSocketIds()) {
      io.to(sid).emit("turn_order_cancelled");
    }
    gameRoom.players.clear();
    gameRoom.pendingDecks = {};
    rooms.delete(roomId);
    broadcastOpenRooms();
    return;
  }

  if (gameRoom.players.size === 0) {
    rooms.delete(roomId);
  }
  broadcastOpenRooms();
}

io.on("connection", (socket) => {
  socket.emit("open_rooms", listOpenRooms());

  socket.on("list_rooms", () => {
    socket.emit("open_rooms", listOpenRooms());
  });

  socket.on("join_room", (payload) => {
    const { room, playerId, deck, deckName, testing } = parseJoinPayload(payload);
    if (!room) {
      socket.emit("join_error", { error: "Invalid room" });
      return;
    }

    // Leaving a previous waiting room before joining another.
    if (socket.data.room && socket.data.room !== room) {
      leaveWaitingRoom(socket);
    }

    const gameRoom = getOrCreateRoom(room, { testing });
    if (gameRoom.state) {
      socket.emit("join_error", { error: "Room is full" });
      return;
    }

    const slot = gameRoom.addPlayer(socket.id, playerId);
    if (slot == null) {
      socket.emit("join_error", { error: "Room is full" });
      return;
    }

    socket.join(room);
    socket.data.room = room;
    socket.data.playerId = playerId;
    socket.data.slot = slot;
    socket.data.automated = true;

    if (slot === 0 && deckName) {
      gameRoom.hostDeckName = deckName;
    }

    if (deck) {
      gameRoom.pendingDecks = gameRoom.pendingDecks || {};
      gameRoom.pendingDecks[slot] = deck;
      if (bothDecksReady(gameRoom)) {
        gameRoom.awaitingTurnOrder = true;
      }
    }

    socket.emit("joined", {
      room,
      slot,
      automated: true,
      testing: !!gameRoom.testing,
      serverMode: "authoritative",
      awaitingTurnOrder: !!gameRoom.awaitingTurnOrder,
    });

    broadcastOpenRooms();

    if (bothDecksReady(gameRoom) && gameRoom.awaitingTurnOrder) {
      emitAwaitingTurnOrder(gameRoom, { rematch: false });
    } else if (gameRoom.awaitingTurnOrder) {
      // Rejoining client missed the earlier broadcast — push it again.
      socket.emit("awaiting_turn_order", {
        rematch: !!gameRoom.state,
        slot,
        isHost: slot === 0,
      });
    }
  });

  socket.on("leave_room", () => {
    leaveWaitingRoom(socket);
  });

  socket.on("choose_turn_order", (payload) => {
    const roomId = socket.data.room;
    if (!roomId) return;
    const gameRoom = rooms.get(roomId);
    if (!gameRoom?.awaitingTurnOrder) return;
    const slot = gameRoom.getSlot(socket.id);
    if (slot !== 0) {
      socket.emit("engine_error", { error: "Only the room host can choose turn order" });
      return;
    }
    const decks = gameRoom.pendingDecks;
    if (!decks?.[0] || !decks?.[1]) return;

    const choice = payload?.choice;
    let firstPlayer;
    if (choice === "first") firstPlayer = 0;
    else if (choice === "second") firstPlayer = 1;
    else firstPlayer = Math.random() < 0.5 ? 0 : 1;

    gameRoom.awaitingTurnOrder = false;
    const views = gameRoom.startAutomatedGame([decks[0], decks[1]], firstPlayer);
    io.to(roomId).emit("engine_state", views);
    broadcastOpenRooms();
  });

  socket.on("request_rematch", () => {
    const roomId = socket.data.room;
    if (!roomId) return;
    const gameRoom = rooms.get(roomId);
    if (!gameRoom?.state) return;
    const decks = gameRoom.pendingDecks;
    if (!decks?.[0] || !decks?.[1]) return;

    const slot = gameRoom.getSlot(socket.id);
    if (slot == null) return;

    if (!gameRoom.rematchVotes) gameRoom.rematchVotes = new Set();
    if (gameRoom.rematchVotes.has(slot)) return;
    gameRoom.rematchVotes.add(slot);

    // First vote: prompt the other player with a confirmation dialog.
    if (gameRoom.rematchVotes.size === 1) {
      for (const [socketId, info] of gameRoom.players.entries()) {
        if (info.slot === slot) {
          io.to(socketId).emit("rematch_pending", { fromSlot: slot });
        } else {
          io.to(socketId).emit("rematch_requested", { fromSlot: slot });
        }
      }
      return;
    }

    // Both accepted — host picks turn order before the new match starts.
    emitAwaitingTurnOrder(gameRoom, { rematch: true });
  });

  socket.on("cancel_rematch", () => {
    const roomId = socket.data.room;
    if (!roomId) return;
    const gameRoom = rooms.get(roomId);
    if (!gameRoom) return;
    const slot = gameRoom.getSlot(socket.id);
    if (slot == null) return;

    const hadVotes = (gameRoom.rematchVotes?.size || 0) > 0;
    gameRoom.rematchVotes = new Set();

    // Cancel turn-order handshake if it already started.
    if (gameRoom.awaitingTurnOrder && gameRoom.state) {
      gameRoom.awaitingTurnOrder = false;
      io.to(roomId).emit("turn_order_cancelled");
      return;
    }

    // Otherwise clear the pending rematch prompt on both clients.
    if (hadVotes) {
      io.to(roomId).emit("rematch_cancelled", { fromSlot: slot });
    }
  });

  socket.on("engine_action", ({ actionId, action }) => {
    const room = socket.data.room;
    if (!room) {
      socket.emit("engine_error", { actionId, error: "Not in a room" });
      return;
    }
    const gameRoom = rooms.get(room);
    if (!gameRoom) {
      socket.emit("engine_error", {
        actionId,
        error: "Room not found",
      });
      return;
    }
    const result = gameRoom.applyPlayerAction(socket.id, { ...action, actionId });
    if (!result.ok) {
      socket.emit("engine_error", { actionId, error: result.error });
      return;
    }
    io.to(room).emit("engine_state", result.views);
  });

  socket.on("request_engine_state", () => {
    const room = socket.data.room;
    if (!room) return;
    const gameRoom = rooms.get(room);
    if (!gameRoom?.state) return;

    const views = gameRoom.broadcastViews();
    if (views) {
      socket.emit("engine_state", views);
    }
  });

  socket.on("rejoin_room", (roomId) => {
    const room = normalizeRoomId(roomId);
    const gameRoom = rooms.get(room);
    if (!gameRoom) return;

    const playerId = socket.data.playerId;
    const slot = gameRoom.addPlayer(socket.id, playerId);
    if (slot == null) return;

    socket.join(room);
    socket.data.room = room;
    socket.data.slot = slot;

    socket.emit("joined", {
      room,
      slot,
      automated: true,
      serverMode: "authoritative",
    });

    if (gameRoom.state) {
      socket.emit("engine_state", gameRoom.broadcastViews());
    }
    broadcastOpenRooms();
  });

  socket.on("send msg", (msg) => {
    if (msg?.room) {
      socket.to(msg.room).emit("receive msg", msg);
    }
  });

  socket.on("store_state", ({ room, playerId, state }) => {
    const gameRoom = getOrCreateRoom(room);
    if (gameRoom) gameRoom.storeLegacySnapshot(playerId, state);
  });

  socket.on("request_state", ({ room, playerId }) => {
    const gameRoom = rooms.get(normalizeRoomId(room));
    const snapshot = gameRoom?.getLegacySnapshot(playerId);
    if (snapshot) socket.emit("receive_stored_state", snapshot);
  });

  socket.on("disconnect", () => {
    // Keep seats warm while the host is choosing turn order so a brief
    // websocket blip doesn't remove the only player who can start the match.
    // Explicit leave_room still drops the seat.
    const roomId = socket.data.room;
    const gameRoom = roomId ? rooms.get(roomId) : null;
    if (gameRoom?.awaitingTurnOrder && !gameRoom.state) {
      return;
    }
    leaveWaitingRoom(socket);
  });
});

server.listen(PORT, () => {
  console.log(
    `Shadowverse authoritative server on :${PORT} (v${SERVER_VERSION}, ${CARD_DEF_COUNT} card defs)`,
  );
});
