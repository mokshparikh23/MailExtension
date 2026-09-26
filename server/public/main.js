const $ = (id) => document.getElementById(id);

let socket = null;
let roomId = null;
let liveTimer = null;
let framePending = false;
let frameRequestedAt = 0;
let lastFrameInfoAt = 0;
let agentOnline = false;
let legacyAgentNotified = false;
let deviceOffset = 0;
let deviceTotal = 0;
let deviceQuery = '';
let deviceLoading = false;

const screen = $('screen');
const empty = $('empty');
const logBox = $('log');
const screenWrap = document.querySelector('.screen-wrap');
const settingsPanel = $('settingsPanel');
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

function showSettings(show) {
  settingsPanel.hidden = !show;
  $('settingsBtn').setAttribute('aria-expanded', String(show));
}

async function loadDevices(reset = false) {
  if (deviceLoading) return;
  const token = $('token').value.trim();
  if (!token) {
    log('Enter the server token before loading devices.');
    return;
  }
  if (reset) {
    deviceOffset = 0;
    deviceQuery = $('deviceSearch').value.trim();
  }
  deviceLoading = true;
  $('refreshDevicesBtn').disabled = true;
  $('loadMoreDevicesBtn').disabled = true;
  try {
    const params = new URLSearchParams({ q: deviceQuery, offset: String(deviceOffset), limit: '100' });
    const response = await fetch(`/api/agents?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    const list = $('deviceList');
    if (reset) {
      list.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = result.total ? 'Select a device' : 'No matching devices';
      list.append(placeholder);
    }
    for (const agent of result.agents) {
      const option = document.createElement('option');
      option.value = agent.roomId;
      option.textContent = `${agent.online ? '●' : '○'} ${agent.device?.host || agent.roomId} (${agent.roomId})`;
      list.append(option);
    }
    deviceOffset += result.agents.length;
    deviceTotal = result.total;
    $('deviceCount').textContent = `${deviceOffset} of ${deviceTotal} devices`;
    $('loadMoreDevicesBtn').hidden = deviceOffset >= deviceTotal;
  } catch (error) {
    log(`Device list failed: ${error.message}`);
  } finally {
    deviceLoading = false;
    $('refreshDevicesBtn').disabled = false;
    $('loadMoreDevicesBtn').disabled = false;
  }
}

function requestScreen() {
  if (!socket?.connected || !roomId) return;
  framePending = true;
  frameRequestedAt = Date.now();
  socket.emit('controller:request-screen', {
    roomId,
    quality: Number($('quality').value || 60),
    forceFull: !hasFrame
  });
}

function startLive() {
  stopLive();
  const interval = Math.max(100, Number($('interval').value || 250));
  liveTimer = setInterval(() => {
    if (!framePending || Date.now() - frameRequestedAt > 3000) requestScreen();
  }, interval);
  requestScreen();
}

function stopLive() {
  if (liveTimer) clearInterval(liveTimer);
  liveTimer = null;
  framePending = false;
}

function imageCoords(event) {
  if (!screen.naturalWidth || !screen.naturalHeight) return null;
  const rect = screen.getBoundingClientRect();
  const scale = fitMode === 'cover'
    ? Math.max(rect.width / screen.naturalWidth, rect.height / screen.naturalHeight)
    : Math.min(rect.width / screen.naturalWidth, rect.height / screen.naturalHeight);
  const displayedWidth = screen.naturalWidth * scale;
  const displayedHeight = screen.naturalHeight * scale;
  const offsetX = (rect.width - displayedWidth) / 2;
  const offsetY = (rect.height - displayedHeight) / 2;
  const x = (event.clientX - rect.left - offsetX) / scale;
  const y = (event.clientY - rect.top - offsetY) / scale;
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
    agentOnline = false;
    hasFrame = false;
    fullCanvas = null;
    fullCtx = null;
    setStatus(`Connected: ${roomId}`);
    socket.emit('controller:join', { roomId });
    log(`Joined room ${roomId} as controller.`);
    showSettings(false);
    if ($('live').checked) startLive();
  });

  socket.on('disconnect', () => {
    stopLive();
    setStatus('Disconnected');
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
      if (room.agentSocketId && !room.device.version && !legacyAgentNotified) {
        log('Laptop B is running an older agent. Update it to reduce click delay.');
        legacyAgentNotified = true;
      }
    }
    if (room.agentSocketId && !agentOnline) {
      hasFrame = false;
      if ($('live').checked) requestScreen();
    }
    agentOnline = Boolean(room.agentSocketId);
  });

  socket.on('controller:screen', ({ image, mime, width, height, size, type, region }) => {
    const frameType = type || 'FULL';
    $('screenMeta').textContent = `Size: ${formatBytes(size || 0)} | Type: ${formatType(frameType)}`;
    if (Date.now() - lastFrameInfoAt > 1000) {
      $('streamInfo').textContent = `${width} × ${height} · ${Math.round((size || 0) / 1024)} KB/frame${mime === 'image/png' ? ' · PNG stream' : ''}`;
      lastFrameInfoAt = Date.now();
    }
    if (frameType === 'NO_CHANGE') {
      framePending = false;
      return;
    }
    if (frameType === 'DELTA') {
      applyDeltaFrame({ image, mime, width, height, size, region });
      return;
    }
    applyFullFrame({ image, mime, width, height, size });
  });

  socket.on('controller:control-status', ({ accessibility }) => {
    if (accessibility === false) log('Laptop B: Accessibility permission is missing. Enable it and restart the agent.');
    else if (accessibility === true) log('Laptop B: Accessibility permission granted.');
  });

  socket.on('controller:control-result', ({ action, error }) => {
    log(error ? `${action} failed on Laptop B: ${error}` : `${action} reached Laptop B.`);
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
    screen.src = img.src;
    empty.style.display = 'none';
    hasFrame = true;
    framePending = false;
  };
  img.onerror = () => { framePending = false; hasFrame = false; };
  img.src = `data:${mime || 'image/png'};base64,${image}`;
}

function applyDeltaFrame({ image, mime, width, height, size, region }) {
  if (!fullCanvas || !fullCtx || !region) {
    framePending = false;
    socket.emit('controller:request-screen', { roomId, quality: Number($('quality').value || 60), forceFull: true });
    return;
  }
  const img = new Image();
  img.onload = () => {
    fullCtx.drawImage(img, region.x, region.y);
    screen.src = fullCanvas.toDataURL('image/png');
    empty.style.display = 'none';
    hasFrame = true;
    framePending = false;
  };
  img.onerror = () => { framePending = false; hasFrame = false; };
  img.src = `data:${mime || 'image/png'};base64,${image}`;
}

$('screenBtn').addEventListener('click', requestScreen);
$('refreshDevicesBtn').addEventListener('click', () => loadDevices(true));
$('loadMoreDevicesBtn').addEventListener('click', () => loadDevices(false));
$('deviceSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadDevices(true);
  }
});
$('deviceList').addEventListener('change', () => {
  if ($('deviceList').value) $('roomId').value = $('deviceList').value;
});
$('wakeBtn').addEventListener('click', async () => {
  const token = $('token').value.trim();
  if (!token) {
    log('Enter the server token in Settings before sending a wake signal.');
    showSettings(true);
    return;
  }

  const button = $('wakeBtn');
  button.disabled = true;
  button.textContent = 'Sending…';
  try {
    const response = await fetch('/api/wake', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const result = await response.json();
    log(result.message || result.error || 'Wake request completed.');
  } catch (error) {
    log(`Wake request failed: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Wake Laptop B';
  }
});
$('live').addEventListener('change', (event) => event.target.checked ? startLive() : stopLive());
$('interval').addEventListener('change', () => {
  if ($('live').checked && socket?.connected) startLive();
});
$('settingsBtn').addEventListener('click', () => showSettings(settingsPanel.hidden));
$('closeSettingsBtn').addEventListener('click', () => showSettings(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !settingsPanel.hidden) showSettings(false);
});

$('fitBtn').addEventListener('click', () => {
  fitMode = fitMode === 'contain' ? 'cover' : 'contain';
  screenWrap.dataset.fit = fitMode;
  $('fitBtn').textContent = fitMode === 'contain' ? 'Fill area (crop)' : 'Show full screen';
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
  socket.emit('controller:mouse-click', { roomId, button: 'left', ...coords });
  log('Mouse click sent to Laptop B.');
});

screen.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!$('mouse').checked || !socket) return;
  const coords = imageCoords(event);
  if (!coords) return;
  socket.emit('controller:mouse-click', { roomId, button: 'right', ...coords });
  log('Right click sent to Laptop B.');
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
  log('Keyboard input sent to Laptop B.');
});
