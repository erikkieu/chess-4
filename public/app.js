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
  yourColor: null,
  selectedCell: null,
  isConnected: false,
  reconnectTimer: null,
};

let ws = null;

function inBoard(row, col) {
  return (row >= 3 && row <= 10) || (col >= 3 && col <= 10);
}

function pieceAt(row, col) {
  return state.board[`${row},${col}`] || null;
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
    const playerName = state.playersByColor[color] || 'Waiting for player…';
    const ready = state.readyByColor[color] ? '✅ ready' : '⏳ not ready';
    const turn = state.turn === color && state.started ? ' • turn' : '';
    li.textContent = `${color.toUpperCase()}: ${playerName} (${ready}${turn})`;
    rosterEl.append(li);
  });
}

function updateGameStatus() {
  if (!state.yourColor) {
    gameStatusEl.textContent = 'Observer mode (all colors currently assigned).';
    readyButton.disabled = true;
    readyButton.textContent = 'Ready';
    return;
  }

  if (!state.started) {
    const isReady = !!state.readyByColor[state.yourColor];
    gameStatusEl.textContent = `You are ${state.yourColor.toUpperCase()}. Click ready when you are prepared.`;
    readyButton.disabled = false;
    readyButton.textContent = isReady ? 'Unready' : 'Ready';
    return;
  }

  readyButton.disabled = true;
  readyButton.textContent = 'Ready';
  if (state.turn === state.yourColor) {
    gameStatusEl.textContent = `Your turn (${state.yourColor.toUpperCase()}). Select a piece then its destination.`;
  } else {
    gameStatusEl.textContent = `Game in progress. Waiting for ${String(state.turn || '').toUpperCase()} to move.`;
  }
}

function renderBoard() {
  board.innerHTML = '';

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
  state.yourColor = payload.yourColor || null;
  state.selectedCell = null;

  renderBoard();
  updateRoster();
  updateWaitingRoomInfo();
  updateGameStatus();
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
    renderBoard();
    return;
  }

  if (!state.selectedCell) {
    if (!piece || piece.color !== state.yourColor) return;
    state.selectedCell = { row, col };
    renderBoard();
    return;
  }

  if (state.selectedCell.row === row && state.selectedCell.col === col) {
    state.selectedCell = null;
    renderBoard();
    return;
  }

  if (piece && piece.color === state.yourColor) {
    state.selectedCell = { row, col };
    renderBoard();
    return;
  }

  sendJson({
    type: 'game:move',
    from: state.selectedCell,
    to: { row, col },
  });

  state.selectedCell = null;
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
connect();
