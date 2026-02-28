const board = document.querySelector('#board');
const nameInput = document.querySelector('#nameInput');
const recipientSelect = document.querySelector('#recipientSelect');
const messages = document.querySelector('#messages');
const statusEl = document.querySelector('#status');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');
const readyButton = document.querySelector('#readyButton');
const gameStatusEl = document.querySelector('#gameStatus');
const rosterEl = document.querySelector('#roster');
const waitingRoomInfoEl = document.querySelector('#waitingRoomInfo');
const turnIndicatorEl = document.querySelector('#turnIndicator');
const timerDisplayEl = document.querySelector('#timerDisplay');

const pieces = {
  rook: '♜',
  knight: '♞',
  bishop: '♝',
  queen: '♛',
  king: '♚',
  pawn: '♟',
};

const RECONNECT_DELAY_MS = 1500;

const state = {
  users: [],
  board: {},
  playersByColor: { gold: null, red: null, blue: null, green: null },
  readyByColor: { gold: false, red: false, blue: false, green: false },
  started: false,
  turn: null,
  turnDeadline: null,
  yourColor: null,
  selectedCell: null,
  legalMoves: [],
  isConnected: false,
  reconnectTimer: null,
};

let ws = null;
let turnTimerInterval = null;

function keyFor(row, col) {
  return `${row},${col}`;
}

function inBoard(row, col) {
  return (row >= 3 && row <= 10) || (col >= 3 && col <= 10);
}

function pieceAt(row, col) {
  return state.board[keyFor(row, col)] || null;
}

function isClearPath(from, to, dr, dc) {
  let row = from.row + dr;
  let col = from.col + dc;

  while (row !== to.row || col !== to.col) {
    if (!inBoard(row, col)) return false;
    if (pieceAt(row, col)) return false;
    row += dr;
    col += dc;
  }

  return true;
}

function validatePawnMove(piece, from, to) {
  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const target = pieceAt(to.row, to.col);

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
    return !pieceAt(midRow, midCol);
  }

  return false;
}

function validateMove(piece, from, to) {
  if (!inBoard(to.row, to.col)) return false;
  if (from.row === to.row && from.col === to.col) return false;

  const target = pieceAt(to.row, to.col);
  if (target && target.color === piece.color) return false;

  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const absRow = Math.abs(rowDiff);
  const absCol = Math.abs(colDiff);

  if (piece.type === 'pawn') {
    return validatePawnMove(piece, from, to);
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
    return isClearPath(from, to, dr, dc);
  }

  if (piece.type === 'bishop') {
    if (absRow !== absCol) return false;
    const dr = rowDiff / absRow;
    const dc = colDiff / absCol;
    return isClearPath(from, to, dr, dc);
  }

  if (piece.type === 'queen') {
    if (rowDiff === 0 || colDiff === 0) {
      const dr = rowDiff === 0 ? 0 : rowDiff / absRow;
      const dc = colDiff === 0 ? 0 : colDiff / absCol;
      return isClearPath(from, to, dr, dc);
    }
    if (absRow === absCol) {
      const dr = rowDiff / absRow;
      const dc = colDiff / absCol;
      return isClearPath(from, to, dr, dc);
    }
    return false;
  }

  return false;
}

function collectLegalMoves(from) {
  const piece = pieceAt(from.row, from.col);
  if (!piece) return [];

  const legalMoves = [];
  for (let row = 0; row < 14; row += 1) {
    for (let col = 0; col < 14; col += 1) {
      if (!inBoard(row, col)) continue;
      const to = { row, col };
      if (validateMove(piece, from, to)) {
        legalMoves.push({ row, col });
      }
    }
  }

  return legalMoves;
}

function pushMessage(line, type = '') {
  const li = document.createElement('li');
  if (type) li.classList.add(type);
  li.innerHTML = line;
  messages.append(li);
  messages.scrollTop = messages.scrollHeight;
}

function sendJson(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    pushMessage('Connection is down. Trying to reconnect…', 'system');
    return;
  }
  ws.send(JSON.stringify(payload));
}

function connect() {
  const wsUrl = resolveWebSocketUrl();
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    state.isConnected = true;
    statusEl.textContent = `Connected (${wsUrl})`;
  });

  ws.addEventListener('error', () => {
    statusEl.textContent = `Connection error (${wsUrl})`;
    if (location.hostname.endsWith('netlify.app') && !window.CHESS_WS_URL) {
      pushMessage(
        'This Netlify site serves the UI only. Add ?ws=wss://<your-backend-host> or set window.CHESS_WS_URL before app.js loads.',
        'system'
      );
    }
  });

  ws.addEventListener('close', () => {
    state.isConnected = false;
    statusEl.textContent = `Disconnected. Retrying in ${Math.floor(RECONNECT_DELAY_MS / 1000)}s…`;

    if (!state.reconnectTimer) {
      state.reconnectTimer = window.setTimeout(() => {
        state.reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    }
  });

  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.event === 'welcome') {
      state.users = msg.payload.users;
      updateRecipientOptions();
      applyGameState(msg.payload.game);
      pushMessage('Welcome! Set your name, chat, and ready up to start.', 'system');
    }

    if (msg.event === 'users:update') {
      state.users = msg.payload.users;
      updateRecipientOptions();
      updateWaitingRoomInfo();
    }

    if (msg.event === 'game:update') {
      applyGameState(msg.payload);
    }

    if (msg.event === 'chat') {
      const time = new Date(msg.payload.at).toLocaleTimeString();
      const privateTag = msg.payload.private ? '<span class="private">[private]</span> ' : '';
      const toTag = msg.payload.to && msg.payload.to !== 'all' ? ` → <strong>${msg.payload.to}</strong>` : '';
      pushMessage(
        `${privateTag}<span class="meta">[${time}]</span> <strong>${msg.payload.from}</strong>${toTag}: ${msg.payload.text}`,
        msg.payload.private ? 'private' : ''
      );
    }

    if (msg.event === 'system') {
      pushMessage(`<span class="meta">System:</span> ${msg.payload.text}`, 'system');
    }
  });
}

function updateRecipientOptions() {
  const current = recipientSelect.value;
  recipientSelect.innerHTML = '<option value="all">Everyone</option>';

  state.users.forEach((user) => {
    if (!user || user === nameInput.value.trim()) return;
    const option = document.createElement('option');
    option.value = user;
    option.textContent = user;
    recipientSelect.append(option);
  });

  recipientSelect.value = [...recipientSelect.options].some((opt) => opt.value === current)
    ? current
    : 'all';
}

function updateWaitingRoomInfo() {
  const connectedCount = state.users.length;
  const seatedPlayers = Object.values(state.playersByColor).filter(Boolean).length;
  const readyCount = Object.values(state.readyByColor).filter(Boolean).length;

  if (state.started) {
    waitingRoomInfoEl.textContent = `Connected: ${connectedCount}. Match live (${readyCount}/${seatedPlayers} marked ready).`;
    return;
  }

  waitingRoomInfoEl.textContent = `Waiting room: ${connectedCount} connected • ${seatedPlayers}/4 seats filled • ${readyCount}/${seatedPlayers || 4} ready`;
}

function updateRoster() {
  rosterEl.innerHTML = '';
  ['gold', 'red', 'blue', 'green'].forEach((color) => {
    const li = document.createElement('li');
    li.className = `roster-${color}`;
    if (state.turn === color && state.started) {
      li.classList.add('current-turn');
    }

    const playerName = state.playersByColor[color] || 'Waiting for player…';
    const ready = state.readyByColor[color] ? '✅ ready' : '⏳ not ready';
    const turn = state.turn === color && state.started ? ' • ACTIVE TURN' : '';
    li.textContent = `${color.toUpperCase()}: ${playerName} (${ready}${turn})`;
    rosterEl.append(li);
  });
}

function stopTurnCountdown() {
  if (turnTimerInterval) {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
  }
}

function refreshTurnCountdown() {
  if (!state.started || !state.turnDeadline) {
    timerDisplayEl.textContent = 'Move timer: --';
    return;
  }

  const secondsLeft = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
  timerDisplayEl.textContent = `Move timer: ${secondsLeft}s`;
}

function startTurnCountdown() {
  stopTurnCountdown();
  if (!state.started || !state.turnDeadline) {
    refreshTurnCountdown();
    return;
  }

  refreshTurnCountdown();
  turnTimerInterval = setInterval(refreshTurnCountdown, 250);
}

function updateGameStatus() {
  if (!state.yourColor) {
    turnIndicatorEl.textContent = state.started
      ? `Turn: ${String(state.turn || '').toUpperCase()}`
      : 'Turn: waiting for players';
    gameStatusEl.textContent = 'Observer mode (all colors currently assigned).';
    readyButton.disabled = true;
    readyButton.textContent = 'Ready';
    return;
  }

  if (!state.started) {
    const isReady = !!state.readyByColor[state.yourColor];
    turnIndicatorEl.textContent = 'Turn: game not started';
    gameStatusEl.textContent = `You are ${state.yourColor.toUpperCase()}. Click ready when you are prepared.`;
    readyButton.disabled = false;
    readyButton.textContent = isReady ? 'Unready' : 'Ready';
    return;
  }

  readyButton.disabled = true;
  readyButton.textContent = 'Ready';

  if (state.turn === state.yourColor) {
    turnIndicatorEl.textContent = `🟢 YOUR TURN (${state.yourColor.toUpperCase()})`;
    gameStatusEl.textContent = 'Your turn: click one of your pieces to view legal moves, then click a highlighted square.';
  } else {
    turnIndicatorEl.textContent = `⏳ ${String(state.turn || '').toUpperCase()} TO MOVE`;
    gameStatusEl.textContent = `Game in progress. Waiting for ${String(state.turn || '').toUpperCase()} to move.`;
  }
}

function renderBoard() {
  board.innerHTML = '';

  const legalMoveSet = new Set(state.legalMoves.map((move) => keyFor(move.row, move.col)));

  for (let row = 0; row < 14; row += 1) {
    for (let col = 0; col < 14; col += 1) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.classList.add('cell');
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);

      if (!inBoard(row, col)) {
        cell.classList.add('void');
        cell.disabled = true;
      } else {
        cell.classList.add((row + col) % 2 ? 'dark' : 'light');
        const piece = pieceAt(row, col);
        if (piece) {
          cell.textContent = pieces[piece.type];
          cell.classList.add(`piece-${piece.color}`);
        }

        if (legalMoveSet.has(keyFor(row, col))) {
          cell.classList.add('legal-move');
          if (piece) {
            cell.classList.add('legal-capture');
          }
        }
      }

      if (state.selectedCell && state.selectedCell.row === row && state.selectedCell.col === col) {
        cell.classList.add('selected');
      }

      board.append(cell);
    }
  }
}

function applyGameState(payload) {
  state.board = payload.board || {};
  state.playersByColor = payload.playersByColor || state.playersByColor;
  state.readyByColor = payload.readyByColor || state.readyByColor;
  state.started = !!payload.started;
  state.turn = payload.turn || null;
  state.turnDeadline = payload.turnDeadline || null;
  state.yourColor = payload.yourColor || null;
  state.selectedCell = null;
  state.legalMoves = [];

  renderBoard();
  updateRoster();
  updateWaitingRoomInfo();
  updateGameStatus();
  startTurnCountdown();
}

function resolveWebSocketUrl() {
  const query = new URLSearchParams(location.search);
  const queryUrl = query.get('ws');
  const configuredUrl = window.CHESS_WS_URL;

  if (queryUrl) return queryUrl;
  if (configuredUrl) return configuredUrl;

  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${location.host}`;
}

nameInput.addEventListener('change', () => {
  sendJson({
    type: 'set-name',
    name: nameInput.value,
  });
});

readyButton.addEventListener('click', () => {
  if (!state.yourColor || state.started) return;
  sendJson({
    type: 'game:ready',
    ready: !state.readyByColor[state.yourColor],
  });
});

board.addEventListener('click', (event) => {
  const target = event.target.closest('.cell');
  if (!target || !target.dataset.row) return;

  const row = Number(target.dataset.row);
  const col = Number(target.dataset.col);
  if (!inBoard(row, col)) return;

  const piece = pieceAt(row, col);

  if (!state.started || !state.yourColor || state.turn !== state.yourColor) {
    state.selectedCell = null;
    state.legalMoves = [];
    renderBoard();
    return;
  }

  if (!state.selectedCell) {
    if (!piece || piece.color !== state.yourColor) return;
    state.selectedCell = { row, col };
    state.legalMoves = collectLegalMoves(state.selectedCell);
    renderBoard();
    return;
  }

  if (state.selectedCell.row === row && state.selectedCell.col === col) {
    state.selectedCell = null;
    state.legalMoves = [];
    renderBoard();
    return;
  }

  if (piece && piece.color === state.yourColor) {
    state.selectedCell = { row, col };
    state.legalMoves = collectLegalMoves(state.selectedCell);
    renderBoard();
    return;
  }

  const isLegalTarget = state.legalMoves.some((move) => move.row === row && move.col === col);
  if (!isLegalTarget) {
    return;
  }

  sendJson({
    type: 'game:move',
    from: state.selectedCell,
    to: { row, col },
  });

  state.selectedCell = null;
  state.legalMoves = [];
  renderBoard();
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  sendJson({
    type: 'chat',
    text,
    to: recipientSelect.value,
  });

  chatInput.value = '';
  chatInput.focus();
});

renderBoard();
updateRoster();
updateWaitingRoomInfo();
updateGameStatus();
refreshTurnCountdown();
connect();
