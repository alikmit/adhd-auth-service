const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const { URL } = require('url');

const app = express();
app.use(express.json());
app.use(cors({ origin: true }));

app.get('/', (_req, res) => res.status(200).send('OK'));

app.post('/api/coaching/clear-buffer', (req, res) => {
  res.status(204).end();
});

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function originAllowed(_origin) { return true; }

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/'; } catch {}
  if (pathname !== '/audio-stream') return socket.destroy();

  const origin = req.headers.origin;
  if (!originAllowed(origin)) return socket.destroy();

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log('WS connected:', req.headers['x-forwarded-for'] || req.socket.remoteAddress, req.url);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (msg, isBinary) => {
    if (isBinary) ws.send(JSON.stringify({ type: 'ack', bytes: msg.length || 0 }));
    else ws.send(JSON.stringify({ type: 'ack', bytes: Buffer.byteLength(msg) }));
  });

  ws.on('error', (e) => console.error('WS error:', e?.message || e));
  ws.on('close', (code, reason) => console.log('WS closed', code, reason?.toString()));
});

const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 25000);
wss.on('close', () => clearInterval(interval));

server.on('clientError', (err, socket) => {
  console.error('clientError:', err?.message);
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch {}
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`HTTP+WS listening on :${PORT}`);
  console.log('HTTP: GET / → OK');
  console.log('WS:   wss://<host>/audio-stream');
});
