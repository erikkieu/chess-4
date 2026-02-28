const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const clients = new Map();

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

  clients.set(socket, { name: `guest-${Math.floor(Math.random() * 9999)}`, buffer: Buffer.alloc(0) });

  emit(socket, 'welcome', { users: usersList() });
  broadcast('users:update', { users: usersList() });

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
        client.name = sanitizeName(parsed.name);
        broadcast('users:update', { users: usersList() });
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

  socket.on('close', () => {
    clients.delete(socket);
    broadcast('users:update', { users: usersList() });
  });

  socket.on('end', () => {
    clients.delete(socket);
    broadcast('users:update', { users: usersList() });
  });

  socket.on('error', () => {
    clients.delete(socket);
    broadcast('users:update', { users: usersList() });
  });
});

server.listen(PORT, () => {
  console.log(`Chess-4 server running on http://localhost:${PORT}`);
});
