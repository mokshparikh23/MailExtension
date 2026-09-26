const fs = require('fs');
const path = require('path');
const geoip = require('geoip-lite');

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || path.join(process.cwd(), 'data', 'audit.jsonl');

function clientIp(handshake) {
  const forwarded = handshake.headers && handshake.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return handshake.address || '';
}

function record(event) {
  setImmediate(() => {
    const ip = event.ip || '';
    const lookup = ip ? geoip.lookup(ip) : null;
    const line = {
      ts: new Date().toISOString(),
      ...event,
      geo: lookup ? {
        country: lookup.country || null,
        region: lookup.region || null,
        city: lookup.city || null,
        ll: lookup.ll || null
      } : null
    };

    fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true }, (mkdirErr) => {
      if (mkdirErr) return;
      fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(line)}\n`, () => {});
    });
  });
}

function readRecent(limit = 100) {
  const bounded = Math.max(1, Math.min(Number(limit) || 100, 1000));
  try {
    const raw = fs.readFileSync(AUDIT_LOG_PATH, 'utf8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-bounded)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_err) {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

module.exports = { clientIp, record, readRecent };
