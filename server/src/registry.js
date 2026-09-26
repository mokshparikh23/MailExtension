const fs = require('node:fs');
const path = require('node:path');

function loadRegistry(filePath) {
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('expected an array');
    return new Map(saved.filter((entry) =>
      entry && typeof entry.roomId === 'string' && entry.roomId.length <= 128 &&
      Number.isFinite(entry.lastSeenAt)
    ).map((entry) => [entry.roomId, {
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : entry.lastSeenAt,
      controllerCount: 0,
      agentSocketId: null,
      controlAccessibility: null,
      lastSeenAt: entry.lastSeenAt,
      device: entry.device && typeof entry.device === 'object' ? entry.device : {}
    }]));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error(`Could not read device registry: ${error.message}`);
  }
}

function saveRegistry(filePath, rooms) {
  const saved = [...rooms.entries()].filter(([, room]) => room.lastSeenAt !== null)
    .map(([roomId, room]) => ({
      roomId,
      createdAt: room.createdAt,
      lastSeenAt: room.lastSeenAt,
      device: room.device
    }));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

module.exports = { loadRegistry, saveRegistry };
