const express = require('express');
const helmet = require('helmet');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { randomUUID } = require('crypto');
const { sendMagicPacket } = require('./wake');

const PORT = Number(process.env.PORT || 3000);
const ACCESS_TOKEN = process.env.ACCESS_TOKEN || 'change-me-before-deploy';
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
  if (token !== ACCESS_TOKEN) {
    next(new Error('unauthorized'));
    return;
  }
  next();
}

io.use(authorize);

io.on('connection', (socket) => {
  socket.on('controller:join', ({ roomId }) => {
    if (!roomId) return;
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

  socket.on('agent:join', ({ roomId, device }) => {
    if (!roomId) return;
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
    socket.to(roomId).emit('agent:capture-screen', {
      quality: Math.max(10, Math.min(Number(quality || 40), 90)),
      forceFull: Boolean(forceFull)
    });
  });

  socket.on('agent:screen', ({ roomId, image, mime, width, height, size, type, region }) => {
    const room = getRoom(roomId);
    room.lastSeenAt = Date.now();
    socket.to(roomId).emit('controller:screen', { image, mime, width, height, size, type, region });
    io.to(roomId).emit('room:status', room);
  });

  socket.on('agent:control-status', ({ roomId, accessibility }) => {
    if (socket.data.role !== 'agent' || socket.data.roomId !== roomId) return;
    getRoom(roomId).controlAccessibility = accessibility;
    socket.to(roomId).emit('controller:control-status', { accessibility });
  });

  socket.on('agent:control-result', ({ roomId, action, error }) => {
    if (socket.data.role !== 'agent' || socket.data.roomId !== roomId) return;
    socket.to(roomId).emit('controller:control-result', { action, error });
  });

  socket.on('controller:mouse-move', ({ roomId, x, y, screenSize }) => {
    socket.to(roomId).emit('agent:mouse-move', { x, y, screenSize });
  });

  socket.on('controller:mouse-click', ({ roomId, button, x, y, screenSize }) => {
    // Older agents move and click through separate handlers. Socket.IO keeps
    // these events in order; updated agents can also use the click coordinates.
    if (Number.isFinite(x) && Number.isFinite(y) && screenSize) {
      socket.to(roomId).emit('agent:mouse-move', { x, y, screenSize });
    }
    socket.to(roomId).emit('agent:mouse-click', { button, x, y, screenSize });
  });

  socket.on('controller:mouse-scroll', ({ roomId, deltaY }) => {
    socket.to(roomId).emit('agent:mouse-scroll', { deltaY });
  });

  socket.on('controller:key', ({ roomId, key, ctrlKey, altKey, shiftKey, metaKey }) => {
    socket.to(roomId).emit('agent:key', { key, ctrlKey, altKey, shiftKey, metaKey });
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
