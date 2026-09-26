const $ = (id) => document.getElementById(id);

let socket = null;
let roomId = null;
let liveTimer = null;

const screen = $('screen');
const empty = $('empty');
const logBox = $('log');
const screenWrap = document.querySelector('.screen-wrap');
let fitMode = 'contain';

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  logBox.textContent = `${line}\n${logBox.textContent}`.slice(0, 2400);
}

function setStatus(text) {
  $('status').textContent = text;
}

function requestScreen() {
  if (!socket || !roomId) return;
  socket.emit('controller:request-screen', {
    roomId,
    quality: Number($('quality').value || 45)
  });
}

function startLive() {
  stopLive();
  liveTimer = setInterval(requestScreen, Math.max(250, Number($('interval').value || 1000)));
  requestScreen();
}

function stopLive() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
}

function imageCoords(event) {
  if (!screen.naturalWidth || !screen.naturalHeight) return null;
  const rect = screen.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * screen.naturalWidth;
  const y = ((event.clientY - rect.top) / rect.height) * screen.naturalHeight;
  if (x < 0 || y < 0 || x > screen.naturalWidth || y > screen.naturalHeight) return null;
  return { x, y, screenSize: { width: screen.naturalWidth, height: screen.naturalHeight } };
}

$('connectBtn').addEventListener('click', () => {
  const token = $('token').value.trim();
  roomId = $('roomId').value.trim();
  if (!token || !roomId) {
    log('Token and room ID are required.');
    return;
  }

  if (socket) socket.disconnect();
  socket = io({ auth: { token } });

  socket.on('connect', () => {
    setStatus(`Connected: ${roomId}`);
    socket.emit('controller:join', { roomId });
    log(`Joined room ${roomId} as controller.`);
  });

  socket.on('connect_error', (err) => {
    setStatus('Unauthorized/disconnected');
    log(`Connection failed: ${err.message}`);
  });

  socket.on('room:status', (room) => {
    const agent = room.agentSocketId ? 'agent online' : 'agent offline';
    setStatus(`${roomId} - ${agent}`);
  });

  socket.on('controller:screen', ({ image, mime, width, height, size }) => {
    screen.src = `data:${mime || 'image/jpeg'};base64,${image}`;
    empty.style.display = 'none';
    log(`Screen ${width}x${height}, ${Math.round(size / 1024)} KB`);
  });
});

$('screenBtn').addEventListener('click', requestScreen);
$('live').addEventListener('change', (event) => event.target.checked ? startLive() : stopLive());

$('fitBtn').addEventListener('click', () => {
  fitMode = fitMode === 'contain' ? 'cover' : 'contain';
  screenWrap.dataset.fit = fitMode;
  $('fitBtn').textContent = fitMode === 'contain' ? 'Fill' : 'Fit';
});

$('fullscreenBtn').addEventListener('click', async () => {
  if (!document.fullscreenElement) {
    await screenWrap.requestFullscreen();
    return;
  }
  await document.exitFullscreen();
});

screen.addEventListener('click', (event) => {
  if (!$('mouse').checked || !socket) return;
  const coords = imageCoords(event);
  if (!coords) return;
  socket.emit('controller:mouse-move', { roomId, ...coords });
  socket.emit('controller:mouse-click', { roomId, button: 'left' });
});

screen.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!$('mouse').checked || !socket) return;
  const coords = imageCoords(event);
  if (!coords) return;
  socket.emit('controller:mouse-move', { roomId, ...coords });
  socket.emit('controller:mouse-click', { roomId, button: 'right' });
});

screen.addEventListener('wheel', (event) => {
  if (!$('mouse').checked || !socket) return;
  event.preventDefault();
  socket.emit('controller:mouse-scroll', { roomId, deltaY: event.deltaY });
});

document.addEventListener('keydown', (event) => {
  if (!$('keyboard').checked || !socket) return;
  if (event.target.tagName === 'INPUT') return;
  event.preventDefault();
  socket.emit('controller:key', {
    roomId,
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey
  });
});
