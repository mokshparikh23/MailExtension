const test = require('node:test');
const assert = require('node:assert/strict');
const { magicPacket } = require('../src/wake');

test('builds a 102-byte Wake-on-LAN packet for the target MAC', () => {
  const packet = magicPacket('01-23-45-67-89-ab');
  assert.equal(packet.length, 102);
  assert.equal(packet.subarray(0, 6).toString('hex'), 'ffffffffffff');
  for (let offset = 6; offset < packet.length; offset += 6) {
    assert.equal(packet.subarray(offset, offset + 6).toString('hex'), '0123456789ab');
  }
});

test('rejects an invalid MAC address', () => {
  assert.throws(() => magicPacket('not-a-mac'), /WAKE_MAC/);
});
