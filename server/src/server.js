const express = require('express');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');
const { sendMagicPacket } = require('./wake');

const PORT = Number(process.env.PORT || 3000);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'change-me-before-deploy';
const AGENT_TOKEN = process.env.AGENT_TOKEN || ACCESS_TOKEN;
const WAKE_MAC = process.env.WAKE_MAC || '';
const WAKE_BROADCAST = process.env.WAKE_BROADCAST || '255.255.255.255';
const WAKE_PORT = Number(process.env.WAKE_PORT || 9);
let lastWakeAt = 0;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*'
  },
  maxHttpBufferSize: 8 * 1024 * 1024
});

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      createdAt: Date.now(),
      controllerCount: 0,
      agentSocketId: null,
      controlAccessibility: null,
      lastSeenAt: null,
      device: null
    });
  }
  return rooms.get(roomId);
}

function authorize(socket, next) {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const scopes = [];
  if (token === ACCESS_TOKEN) scopes.push('controller');
  if (token === AGENT_TOKEN) scopes.push('agent');
  if (scopes.length === 0) {
    next(new Error('unauthorized'));
    return;
  }
  socket.data.scopes = scopes;
  next();
}

function isJoined(socket, role, roomId) {
  return socket.data.role === role && socket.data.roomId === roomId;
}

function sendToAgent(roomId, event, payload) {
  const agentSocketId = rooms.get(roomId)?.agentSocketId;
  if (agentSocketId) io.to(agentSocketId).emit(event, payload);
}

io.use(authorize);

io.on('connection', (socket) => {
  socket.on('controller:join', ({ roomId } = {}) => {
    if (!roomId || socket.data.role || !socket.data.scopes.includes('controller')) return;
    const room = getRoom(roomId);
    room.controllerCount += 1;
    socket.data.role = 'controller';
    socket.data.roomId = roomId;
    socket.join(roomId);
    socket.emit('room:status', room);
    if (room.controlAccessibility !== null) {
      socket.emit('controller:control-status', { accessibility: room.controlAccessibility });
    }
    socket.to(roomId).emit('room:status', room);
  });

  socket.on('agent:join', ({ roomId, device } = {}) => {
    if (!roomId || socket.data.role || !socket.data.scopes.includes('agent')) return;
    const room = getRoom(roomId);
    room.agentSocketId = socket.id;
    room.controlAccessibility = null;
    room.lastSeenAt = Date.now();
    room.device = device || {};
    socket.data.role = 'agent';
    socket.data.roomId = roomId;
    socket.join(roomId);
    io.to(roomId).emit('room:status', room);
  });

  socket.on('controller:request-screen', ({ roomId, quality, forceFull }) => {
    if (!isJoined(socket, 'controller', roomId)) return;
    sendToAgent(roomId, 'agent:capture-screen', {
      quality: Math.max(10, Math.min(Number(quality || 40), 90)),
      forceFull: Boolean(forceFull)
    });
  });

  socket.on('agent:screen', ({ roomId, image, mime, width, height, size, type, region }) => {
    if (!isJoined(socket, 'agent', roomId)) return;
    const room = getRoom(roomId);
    if (room.agentSocketId !== socket.id) return;
    room.lastSeenAt = Date.now();
    socket.to(roomId).emit('controller:screen', { image, mime, width, height, size, type, region });
    io.to(roomId).emit('room:status', room);
  });

  socket.on('agent:control-status', ({ roomId, accessibility }) => {
    if (!isJoined(socket, 'agent', roomId)) return;
    if (getRoom(roomId).agentSocketId !== socket.id) return;
    getRoom(roomId).controlAccessibility = accessibility;
    socket.to(roomId).emit('controller:control-status', { accessibility });
  });

  socket.on('agent:control-result', ({ roomId, action, error }) => {
    if (!isJoined(socket, 'agent', roomId)) return;
    if (getRoom(roomId).agentSocketId !== socket.id) return;
    socket.to(roomId).emit('controller:control-result', { action, error });
  });

  socket.on('controller:mouse-move', ({ roomId, x, y, screenSize }) => {
    if (!isJoined(socket, 'controller', roomId)) return;
    sendToAgent(roomId, 'agent:mouse-move', { x, y, screenSize });
  });

  socket.on('controller:mouse-click', ({ roomId, button, x, y, screenSize }) => {
    if (!isJoined(socket, 'controller', roomId)) return;
    // Older agents move and click through separate handlers. Socket.IO keeps
    // these events in order; updated agents can also use the click coordinates.
    if (Number.isFinite(x) && Number.isFinite(y) && screenSize) {
      sendToAgent(roomId, 'agent:mouse-move', { x, y, screenSize });
    }
    sendToAgent(roomId, 'agent:mouse-click', { button, x, y, screenSize });
  });

  socket.on('controller:mouse-scroll', ({ roomId, deltaY }) => {
    if (!isJoined(socket, 'controller', roomId)) return;
    sendToAgent(roomId, 'agent:mouse-scroll', { deltaY });
  });

  socket.on('controller:key', ({ roomId, key, ctrlKey, altKey, shiftKey, metaKey }) => {
    if (!isJoined(socket, 'controller', roomId)) return;
    sendToAgent(roomId, 'agent:key', { key, ctrlKey, altKey, shiftKey, metaKey });
  });

  socket.on('disconnect', () => {
    const { roomId, role } = socket.data;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    if (role === 'controller') room.controllerCount = Math.max(0, room.controllerCount - 1);
    if (role === 'agent' && room.agentSocketId === socket.id) room.agentSocketId = null;
    if (role === 'agent' && room.agentSocketId === null) room.controlAccessibility = null;
    io.to(roomId).emit('room:status', room);
  });
});

app.post('/api/room', (req, res) => {
  const auth = req.get('authorization') || '';
  if (auth !== `Bearer ${ACCESS_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const roomId = randomUUID().slice(0, 8);
  getRoom(roomId);
  res.json({ roomId });
});

app.get('/api/agents', (req, res) => {
  if (req.get('authorization') !== `Bearer ${ACCESS_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const agents = [...rooms.entries()].map(([roomId, room]) => ({
    roomId,
    online: Boolean(room.agentSocketId),
    device: room.device,
    lastSeenAt: room.lastSeenAt
  }));
  agents.sort((a, b) => Number(b.online) - Number(a.online) || a.roomId.localeCompare(b.roomId));
  res.json({ agents });
});

app.post('/api/wake', async (req, res) => {
  if (req.get('authorization') !== `Bearer ${ACCESS_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!WAKE_MAC) {
    res.status(503).json({ error: 'Wake-on-LAN is not configured on the relay.' });
    return;
  }
  if (Date.now() - lastWakeAt < 5000) {
    res.status(429).json({ error: 'Wait five seconds before sending another wake signal.' });
    return;
  }

  try {
    await sendMagicPacket({ mac: WAKE_MAC, broadcast: WAKE_BROADCAST, port: WAKE_PORT });
    lastWakeAt = Date.now();
    res.json({ ok: true, message: 'Wake signal sent. Waiting for the agent to reconnect.' });
  } catch (error) {
    console.error('Wake-on-LAN failed:', error);
    res.status(500).json({ error: 'Wake signal could not be sent. Check the relay configuration.' });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

server.listen(PORT, () => {
  console.log(`Internal remote-control relay listening on :${PORT}`);
});
