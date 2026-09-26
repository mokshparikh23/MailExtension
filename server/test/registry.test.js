const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRegistry, saveRegistry } = require('../src/registry');

test('known devices survive a relay restart without stale online sockets', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'netrem-registry-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'devices.json');
  const rooms = new Map([
    ['lab-pc01', {
      createdAt: 10, controllerCount: 2, agentSocketId: 'socket-1',
      controlAccessibility: true, lastSeenAt: 20, device: { host: 'PC01' }
    }],
    ['unused-room', { lastSeenAt: null }]
  ]);
  saveRegistry(file, rooms);
  const restored = loadRegistry(file);
  assert.deepEqual([...restored.keys()], ['lab-pc01']);
  assert.equal(restored.get('lab-pc01').device.host, 'PC01');
  assert.equal(restored.get('lab-pc01').agentSocketId, null);
  assert.equal(restored.get('lab-pc01').controllerCount, 0);
});
