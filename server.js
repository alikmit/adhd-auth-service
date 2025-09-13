// server.js
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const { URL } = require('url');

const app = express();
app.use(express.json());
app.use(cors({ origin: true })); // permissive; tighten later

// --- Health check (HTTP) ---
app.get('/', (_req, res) => res.status(200).send('OK'));

// --- Your app is calling this; return 204 so it stops erroring ---
app.post('/api/coaching/clear-buffer', (req, res) => {
  // If you later keep server-side audio state, clear it here using a session id.
  // For now, just acknowledge.
  res.status(204).end();
});

// (Optional) simple debug route
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- One HTTP server for both HTTP and WS ---
const server = http.createServer(app);

// WebSocket server (attach via upgrade)
const wss = new WebSocketServer({ noServer: true });

// Allow all origins initially (WS Origin header). Tighten later.
function originAllowed(_origin) { return true; }

server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try {
    // Render gives absolute path in req.url; normalize it
    pathname = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '') || '/';
  } catch(_) {}
  // Accept /audio-stream and /audio-stream/
  if (pathname !== '/audio-stream') {
    socket.destroy();
    return;
  }
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  console.log('WS connected:', req.headers['x-forwarded-for'] || req.socket.remoteAddress, req.url);

  // keep-alive
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (msg, isBinary) => {
    // For now, just ACK so you see the roundtrip working.
    // Later: forward audio frames to Deepgram/Assembly/Whisper.
    if (isBinary) {
      ws.send(JSON.stringify({ type: 'ack', bytes: msg.length || 0 }));
    } else {
      ws.send(JSON.stringify({ type: 'ack', bytes: Buffer.byteLength(msg) }));
    }
  });

  ws.on('error', (e) => console.error('WS error:', e.message || e));
  ws.on('close', (code, reason) => console.log('WS closed', code, reason?.toString()));
});

// Heartbeat to satisfy proxies
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(interval));

server.on('clientError', (err, socket) => {
  console.error('clientError:', err?.message);
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (_) {}
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`HTTP+WS listening on :${PORT}`);
  console.log('HTTP:  GET /  →  OK');
  console.log('WS:    GET wss://<host>/audio-stream  (no trailing slash OK)');
});
