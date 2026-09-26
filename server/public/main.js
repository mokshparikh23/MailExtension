const $ = (id) => document.getElementById(id);

let socket = null;
let roomId = null;
let liveTimer = null;

const screen = $('screen');
const empty = $('empty');
const logBox = $('log');
const screenWrap = document.querySelector('.screen-wrap');
let fitMode = 'contain';
let fullCanvas = null;
let fullCtx = null;
let hasFrame = false;

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
    quality: Number($('quality').value || 45),
    forceFull: !hasFrame
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
    if (room.device) {
      $('deviceMeta').textContent = `Device: ${room.device.host || '-'}, Version: ${room.device.version || '-'}`;
    }
  });

  socket.on('controller:screen', ({ image, mime, width, height, size, type, region }) => {
    const frameType = type || 'FULL';
    $('screenMeta').textContent = `Size: ${formatBytes(size || 0)} | Type: ${formatType(frameType)}`;

    if (frameType === 'NO_CHANGE') {
      log(`Screen ${width || '-'}x${height || '-'}, 0 KB, no change`);
      return;
    }

    if (frameType === 'DELTA') {
      applyDeltaFrame({ image, mime, width, height, size, region });
      return;
    }

    applyFullFrame({ image, mime, width, height, size });
  });
});

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatType(type) {
  if (type === 'NO_CHANGE') return 'No Change';
  return type;
}

function ensureCanvas(width, height) {
  if (!fullCanvas) {
    fullCanvas = document.createElement('canvas');
    fullCtx = fullCanvas.getContext('2d');
  }
  if (fullCanvas.width !== width || fullCanvas.height !== height) {
    fullCanvas.width = width;
    fullCanvas.height = height;
  }
}

function applyFullFrame({ image, mime, width, height, size }) {
  const img = new Image();
  img.onload = () => {
    ensureCanvas(img.naturalWidth, img.naturalHeight);
    fullCtx.drawImage(img, 0, 0);
    screen.src = fullCanvas.toDataURL('image/png');
    empty.style.display = 'none';
    hasFrame = true;
    log(`Screen ${width}x${height}, ${formatBytes(size)}, FULL`);
  };
  img.src = `data:${mime || 'image/png'};base64,${image}`;
}

function applyDeltaFrame({ image, mime, width, height, size, region }) {
  if (!fullCanvas || !fullCtx || !region) {
    socket.emit('controller:request-screen', { roomId, quality: Number($('quality').value || 45), forceFull: true });
    return;
  }
  const img = new Image();
  img.onload = () => {
    fullCtx.drawImage(img, region.x, region.y);
    screen.src = fullCanvas.toDataURL('image/png');
    empty.style.display = 'none';
    hasFrame = true;
    log(`Screen ${width}x${height}, ${formatBytes(size)}, DELTA ${region.width}x${region.height}`);
  };
  img.src = `data:${mime || 'image/png'};base64,${image}`;
}

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
