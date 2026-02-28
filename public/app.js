const board = document.querySelector('#board');
const nameInput = document.querySelector('#nameInput');
const recipientSelect = document.querySelector('#recipientSelect');
const messages = document.querySelector('#messages');
const statusEl = document.querySelector('#status');
const chatForm = document.querySelector('#chatForm');
const chatInput = document.querySelector('#chatInput');

const pieces = {
  rook: '♜',
  knight: '♞',
  bishop: '♝',
  queen: '♛',
  king: '♚',
  pawn: '♟',
};

const state = {
  users: [],
};

function inBoard(row, col) {
  return (row >= 3 && row <= 10) || (col >= 3 && col <= 10);
}

function pieceAt(row, col) {
  if (row === 0 && col >= 3 && col <= 10) {
    const order = ['rook', 'knight', 'bishop', 'king', 'queen', 'bishop', 'knight', 'rook'];
    return { glyph: pieces[order[col - 3]], cls: 'piece-gold' };
  }
  if (row === 1 && col >= 3 && col <= 10) return { glyph: pieces.pawn, cls: 'piece-gold' };

  if (row === 13 && col >= 3 && col <= 10) {
    const order = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
    return { glyph: pieces[order[col - 3]], cls: 'piece-red' };
  }
  if (row === 12 && col >= 3 && col <= 10) return { glyph: pieces.pawn, cls: 'piece-red' };

  if (col === 0 && row >= 3 && row <= 10) {
    const order = ['rook', 'knight', 'bishop', 'king', 'queen', 'bishop', 'knight', 'rook'];
    return { glyph: pieces[order[row - 3]], cls: 'piece-blue' };
  }
  if (col === 1 && row >= 3 && row <= 10) return { glyph: pieces.pawn, cls: 'piece-blue' };

  if (col === 13 && row >= 3 && row <= 10) {
    const order = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
    return { glyph: pieces[order[row - 3]], cls: 'piece-green' };
  }
  if (col === 12 && row >= 3 && row <= 10) return { glyph: pieces.pawn, cls: 'piece-green' };

  return null;
}

function drawBoard() {
  for (let row = 0; row < 14; row += 1) {
    for (let col = 0; col < 14; col += 1) {
      const cell = document.createElement('div');
      cell.classList.add('cell');

      if (!inBoard(row, col)) {
        cell.classList.add('void');
      } else {
        cell.classList.add((row + col) % 2 ? 'dark' : 'light');
        const piece = pieceAt(row, col);
        if (piece) {
          cell.textContent = piece.glyph;
          cell.classList.add(piece.cls);
        }
      }

      board.append(cell);
    }
  }
}

function pushMessage(line, type = '') {
  const li = document.createElement('li');
  if (type) li.classList.add(type);
  li.innerHTML = line;
  messages.append(li);
  messages.scrollTop = messages.scrollHeight;
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

const ws = new WebSocket(`ws://${location.host}`);

ws.addEventListener('open', () => {
  statusEl.textContent = 'Connected';
});

ws.addEventListener('close', () => {
  statusEl.textContent = 'Disconnected';
});

ws.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data);

  if (msg.event === 'welcome') {
    state.users = msg.payload.users;
    updateRecipientOptions();
    pushMessage('Welcome! Set your name and start chatting.', 'system');
  }

  if (msg.event === 'users:update') {
    state.users = msg.payload.users;
    updateRecipientOptions();
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

nameInput.addEventListener('change', () => {
  ws.send(
    JSON.stringify({
      type: 'set-name',
      name: nameInput.value,
    })
  );
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  ws.send(
    JSON.stringify({
      type: 'chat',
      text,
      to: recipientSelect.value,
    })
  );

  chatInput.value = '';
  chatInput.focus();
});

drawBoard();
