const dgram = require('dgram');
const net = require('net');

function magicPacket(mac) {
  const normalized = String(mac || '').replace(/[:-]/g, '');
  if (!/^[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error('WAKE_MAC must contain a 12-digit MAC address');
  }
  const address = Buffer.from(normalized, 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(address)]);
}

function sendMagicPacket({ mac, broadcast = '255.255.255.255', port = 9 }) {
  const packet = magicPacket(mac);
  if (net.isIP(broadcast) !== 4) {
    return Promise.reject(new Error('WAKE_BROADCAST must be an IPv4 address'));
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return Promise.reject(new Error('WAKE_PORT must be between 1 and 65535'));
  }

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', (error) => {
      socket.close();
      reject(error);
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
      } catch (error) {
        socket.close();
        reject(error);
        return;
      }
      socket.send(packet, port, broadcast, (error) => {
        socket.close();
        if (error) reject(error);
        else resolve();
      });
    });
  });
}

module.exports = { magicPacket, sendMagicPacket };
