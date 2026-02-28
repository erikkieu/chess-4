const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const GAME_COLORS = ['gold', 'red', 'blue', 'green'];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const clients = new Map();

const gameState = {
  board: createInitialBoard(),
  playersByColor: { gold: null, red: null, blue: null, green: null },
  readyByColor: { gold: false, red: false, blue: false, green: false },
  started: false,
  turn: null,
};

function keyFor(row, col) {
  return `${row},${col}`;
}

function inBoard(row, col) {
  return (row >= 3 && row <= 10) || (col >= 3 && col <= 10);
}

function createInitialBoard() {
  const board = {};

  function set(row, col, type, color) {
    board[keyFor(row, col)] = { type, color, hasMoved: false };
  }

  const edgeKingsFirst = ['rook', 'knight', 'bishop', 'king', 'queen', 'bishop', 'knight', 'rook'];
  const edgeQueensFirst = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

  for (let col = 3; col <= 10; col += 1) {
    set(0, col, edgeKingsFirst[col - 3], 'gold');
    set(1, col, 'pawn', 'gold');
    set(13, col, edgeQueensFirst[col - 3], 'red');
    set(12, col, 'pawn', 'red');
  }

  for (let row = 3; row <= 10; row += 1) {
    set(row, 0, edgeKingsFirst[row - 3], 'blue');
    set(row, 1, 'pawn', 'blue');
    set(row, 13, edgeQueensFirst[row - 3], 'green');
    set(row, 12, 'pawn', 'green');
  }

  return board;
}

function pieceAt(board, row, col) {
  return board[keyFor(row, col)] || null;
}

function isClearPath(board, from, to, dr, dc) {
  let row = from.row + dr;
  let col = from.col + dc;

  while (row !== to.row || col !== to.col) {
    if (!inBoard(row, col)) return false;
    if (pieceAt(board, row, col)) return false;
    row += dr;
    col += dc;
  }

  return true;
}

function validatePawnMove(board, piece, from, to) {
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const target = pieceAt(board, to.row, to.col);

  const pawnConfig = {
    gold: { move: [1, 0], captures: [[1, 1], [1, -1]], start: (r) => r === 1 },
    red: { move: [-1, 0], captures: [[-1, 1], [-1, -1]], start: (r) => r === 12 },
    blue: { move: [0, 1], captures: [[1, 1], [-1, 1]], start: (_, c) => c === 1 },
    green: { move: [0, -1], captures: [[1, -1], [-1, -1]], start: (_, c) => c === 12 },
  };

  const config = pawnConfig[piece.color];

  if (target) {
    return config.captures.some(([dr, dc]) => dr === rowDiff && dc === colDiff);
  }

  const [stepRow, stepCol] = config.move;
  if (rowDiff === stepRow && colDiff === stepCol) {
    return true;
  }

  if (config.start(from.row, from.col) && rowDiff === stepRow * 2 && colDiff === stepCol * 2) {
    const midRow = from.row + stepRow;
    const midCol = from.col + stepCol;
    return !pieceAt(board, midRow, midCol);
  }

  return false;
}

function validateMove(board, piece, from, to) {
  if (!inBoard(to.row, to.col)) return false;
  if (from.row === to.row && from.col === to.col) return false;

  const target = pieceAt(board, to.row, to.col);
  if (target && target.color === piece.color) return false;

  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const absRow = Math.abs(rowDiff);
  const absCol = Math.abs(colDiff);

  if (piece.type === 'pawn') {
    return validatePawnMove(board, piece, from, to);
  }

  if (piece.type === 'knight') {
    return (absRow === 2 && absCol === 1) || (absRow === 1 && absCol === 2);
  }

  if (piece.type === 'king') {
    return absRow <= 1 && absCol <= 1;
  }

  if (piece.type === 'rook') {
    if (rowDiff !== 0 && colDiff !== 0) return false;
    const dr = rowDiff === 0 ? 0 : rowDiff / absRow;
    const dc = colDiff === 0 ? 0 : colDiff / absCol;
    return isClearPath(board, from, to, dr, dc);
  }

  if (piece.type === 'bishop') {
    if (absRow !== absCol) return false;
    const dr = rowDiff / absRow;
    const dc = colDiff / absCol;
    return isClearPath(board, from, to, dr, dc);
  }

  if (piece.type === 'queen') {
    if (rowDiff === 0 || colDiff === 0) {
      const dr = rowDiff === 0 ? 0 : rowDiff / absRow;
      const dc = colDiff === 0 ? 0 : colDiff / absCol;
      return isClearPath(board, from, to, dr, dc);
    }
    if (absRow === absCol) {
      const dr = rowDiff / absRow;
      const dc = colDiff / absCol;
      return isClearPath(board, from, to, dr, dc);
    }
    return false;
  }

  return false;
}

function promoteIfNeeded(piece, row, col) {
  if (piece.type !== 'pawn') return piece;

  if (
    (piece.color === 'gold' && row === 13) ||
    (piece.color === 'red' && row === 0) ||
    (piece.color === 'blue' && col === 13) ||
    (piece.color === 'green' && col === 0)
  ) {
    return { ...piece, type: 'queen' };
  }

  return piece;
}

function sendFrame(socket, data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  socket.write(Buffer.concat([header, payload]));
}

function parseClientFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset];
    const byte2 = buffer[offset + 1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;

    let payloadLen = byte2 & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen += 2;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen += 8;
    }

    const maskLen = masked ? 4 : 0;
    if (offset + headerLen + maskLen + payloadLen > buffer.length) break;

    let payloadStart = offset + headerLen;
    let payload;

    if (masked) {
      const mask = buffer.slice(payloadStart, payloadStart + 4);
      payloadStart += 4;
      payload = buffer.slice(payloadStart, payloadStart + payloadLen);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    } else {
      payload = buffer.slice(payloadStart, payloadStart + payloadLen);
    }

    if (opcode === 0x8) {
      messages.push({ type: 'close' });
    } else if (opcode === 0x1) {
      messages.push({ type: 'text', data: payload.toString('utf8') });
    }

    offset = payloadStart + payloadLen;
  }

  return { messages, remaining: buffer.slice(offset) };
}

function emit(socket, event, payload) {
  sendFrame(socket, JSON.stringify({ event, payload }));
}

function broadcast(event, payload, filter = () => true) {
  clients.forEach((client, socket) => {
    if (filter(client, socket)) {
      emit(socket, event, payload);
    }
  });
}

function usersList() {
  return [...clients.values()].map((c) => c.name);
}

function sanitizeName(raw) {
  const value = String(raw || '').trim().slice(0, 24);
  return value || `guest-${Math.floor(Math.random() * 9999)}`;
}

function uniqueName(candidate, socket) {
  const taken = new Set(
    [...clients.entries()]
      .filter(([otherSocket]) => otherSocket !== socket)
      .map(([, client]) => client.name)
  );

  if (!taken.has(candidate)) return candidate;
  let suffix = 2;
  while (taken.has(`${candidate}-${suffix}`)) {
    suffix += 1;
  }
  return `${candidate}-${suffix}`;
}

function getColorForName(name) {
  return GAME_COLORS.find((color) => gameState.playersByColor[color] === name) || null;
}

function assignColor(name) {
  if (getColorForName(name)) return;
  const freeColor = GAME_COLORS.find((color) => !gameState.playersByColor[color]);
  if (!freeColor) return;
  gameState.playersByColor[freeColor] = name;
}

function unassignColor(name) {
  GAME_COLORS.forEach((color) => {
    if (gameState.playersByColor[color] === name) {
      gameState.playersByColor[color] = null;
      gameState.readyByColor[color] = false;
    }
  });
}

function snapshotFor(client) {
  return {
    users: usersList(),
    game: {
      board: gameState.board,
      playersByColor: gameState.playersByColor,
      readyByColor: gameState.readyByColor,
      started: gameState.started,
      turn: gameState.turn,
      yourColor: getColorForName(client.name),
    },
  };
}

function broadcastGameState() {
  clients.forEach((client, socket) => {
    emit(socket, 'game:update', snapshotFor(client).game);
  });
}

function resetGame(reasonText = '') {
  gameState.board = createInitialBoard();
  gameState.readyByColor = { gold: false, red: false, blue: false, green: false };
  gameState.started = false;
  gameState.turn = null;

  if (reasonText) {
    broadcast('system', { text: reasonText });
  }
}

function maybeStartGame() {
  const filled = GAME_COLORS.every((color) => !!gameState.playersByColor[color]);
  const allReady = GAME_COLORS.every((color) => gameState.readyByColor[color]);
  if (!filled || !allReady || gameState.started) return;

  gameState.board = createInitialBoard();
  gameState.started = true;
  gameState.turn = GAME_COLORS[Math.floor(Math.random() * GAME_COLORS.length)];
  broadcast('system', {
    text: `All players are ready. Game started! ${gameState.turn.toUpperCase()} moves first.`,
  });
}

function serveFile(filePath, res) {
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const target = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, path.normalize(target));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  serveFile(filePath, res);
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
  ];

  socket.write(`${headers.join('\r\n')}\r\n\r\n`);

  const guestName = uniqueName(`guest-${Math.floor(Math.random() * 9999)}`, socket);
  clients.set(socket, { name: guestName, buffer: Buffer.alloc(0) });
  assignColor(guestName);

  emit(socket, 'welcome', snapshotFor(clients.get(socket)));
  broadcast('users:update', { users: usersList() });
  broadcastGameState();

  socket.on('data', (chunk) => {
    const client = clients.get(socket);
    if (!client) return;

    client.buffer = Buffer.concat([client.buffer, chunk]);
    const { messages, remaining } = parseClientFrames(client.buffer);
    client.buffer = remaining;

    messages.forEach((msg) => {
      if (msg.type === 'close') {
        socket.end();
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(msg.data);
      } catch {
        return;
      }

      if (parsed.type === 'set-name') {
        const oldName = client.name;
        const newName = uniqueName(sanitizeName(parsed.name), socket);
        client.name = newName;
        const color = getColorForName(oldName);
        if (color) {
          gameState.playersByColor[color] = newName;
        } else {
          assignColor(newName);
        }

        broadcast('users:update', { users: usersList() });
        broadcastGameState();
        return;
      }

      if (parsed.type === 'game:ready') {
        const color = getColorForName(client.name);
        if (!color) {
          emit(socket, 'system', { text: 'Only assigned players can ready up.' });
          return;
        }
        if (gameState.started) {
          emit(socket, 'system', { text: 'Game already started.' });
          return;
        }

        gameState.readyByColor[color] = !!parsed.ready;
        maybeStartGame();
        broadcastGameState();
        return;
      }

      if (parsed.type === 'game:move') {
        const color = getColorForName(client.name);
        if (!color || !gameState.started) return;
        if (gameState.turn !== color) {
          emit(socket, 'system', { text: 'It is not your turn.' });
          return;
        }

        const from = {
          row: Number(parsed.from?.row),
          col: Number(parsed.from?.col),
        };
        const to = {
          row: Number(parsed.to?.row),
          col: Number(parsed.to?.col),
        };

        if (
          Number.isNaN(from.row) ||
          Number.isNaN(from.col) ||
          Number.isNaN(to.row) ||
          Number.isNaN(to.col)
        ) {
          return;
        }

        const movingPiece = pieceAt(gameState.board, from.row, from.col);
        if (!movingPiece || movingPiece.color !== color) {
          emit(socket, 'system', { text: 'You can only move your own pieces.' });
          return;
        }

        if (!validateMove(gameState.board, movingPiece, from, to)) {
          emit(socket, 'system', { text: 'Illegal move for that piece.' });
          return;
        }

        const updated = promoteIfNeeded({ ...movingPiece, hasMoved: true }, to.row, to.col);
        delete gameState.board[keyFor(from.row, from.col)];
        gameState.board[keyFor(to.row, to.col)] = updated;

        const turnIndex = GAME_COLORS.indexOf(color);
        gameState.turn = GAME_COLORS[(turnIndex + 1) % GAME_COLORS.length];
        broadcastGameState();
        return;
      }

      if (parsed.type === 'chat') {
        const text = String(parsed.text || '').trim().slice(0, 500);
        if (!text) return;

        const payload = {
          from: client.name,
          text,
          at: new Date().toISOString(),
          to: parsed.to || 'all',
        };

        if (parsed.to && parsed.to !== 'all') {
          let delivered = false;
          clients.forEach((other, otherSocket) => {
            if (other.name === parsed.to || otherSocket === socket) {
              emit(otherSocket, 'chat', { ...payload, private: true });
              delivered = true;
            }
          });

          if (!delivered) {
            emit(socket, 'system', { text: `User "${parsed.to}" is not connected.` });
          }
          return;
        }

        broadcast('chat', payload);
      }
    });
  });

  function onDisconnect() {
    const client = clients.get(socket);
    if (!client) return;

    unassignColor(client.name);
    clients.delete(socket);

    if (gameState.started) {
      resetGame(`${client.name} disconnected. Match reset and waiting for players to ready up again.`);
    }

    broadcast('users:update', { users: usersList() });
    broadcastGameState();
  }

  socket.on('close', onDisconnect);
  socket.on('end', onDisconnect);
  socket.on('error', onDisconnect);
});

server.listen(PORT, () => {
  console.log(`Chess-4 server running on http://localhost:${PORT}`);
  console.log(`LAN clients can connect using ws/http on port ${PORT} to this host IP.`);
});
