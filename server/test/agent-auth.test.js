const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function connectSocket(base, token) {
  const open = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
  const handshake = await open.text();
  assert.equal(open.status, 200);
  const sid = JSON.parse(handshake.slice(1)).sid;
  const url = `${base}/socket.io/?EIO=4&transport=polling&sid=${sid}`;
  const response = await fetch(url, { method: 'POST', body: `40${JSON.stringify({ token })}` });
  assert.equal(response.status, 200);
  return { url };
}

async function emit(socket, event, data) {
  const response = await fetch(socket.url, {
    method: 'POST',
    body: `42${JSON.stringify([event, data])}`
  });
  assert.equal(response.status, 200);
}

test('agent token can register devices but cannot enumerate or join controller role', { timeout: 10000 }, async (t) => {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netrem-test-'));
  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: `${__dirname}/..`,
    env: {
      ...process.env, PORT: String(port), ACCESS_TOKEN: 'controller-secret', AGENT_TOKEN: 'agent-secret',
      DEVICE_REGISTRY_PATH: path.join(tempDir, 'devices.json')
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    if (server.exitCode === null) {
      await new Promise((resolve) => { server.once('exit', resolve); server.kill(); });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) { ready = true; break; }
    } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'relay started');

  const agent = await connectSocket(base, 'agent-secret');
  await emit(agent, 'controller:join', { roomId: 'forbidden-room' });
  await emit(agent, 'agent:join', { roomId: 'lab-pc01', device: { host: 'PC01' } });

  const agentList = await fetch(`${base}/api/agents`, {
    headers: { Authorization: 'Bearer agent-secret' }
  });
  assert.equal(agentList.status, 401);

  const controllerList = await fetch(`${base}/api/agents`, {
    headers: { Authorization: 'Bearer controller-secret' }
  });
  assert.equal(controllerList.status, 200);
  assert.deepEqual((await controllerList.json()).agents.map((item) => item.roomId), ['lab-pc01']);

  const controller = await connectSocket(base, 'controller-secret');
  await emit(controller, 'agent:join', { roomId: 'forbidden-agent' });
  const afterSpoof = await fetch(`${base}/api/agents`, {
    headers: { Authorization: 'Bearer controller-secret' }
  });
  assert.deepEqual((await afterSpoof.json()).agents.map((item) => item.roomId), ['lab-pc01']);

  const secondAgent = await connectSocket(base, 'agent-secret');
  await emit(secondAgent, 'agent:join', { roomId: 'lab-pc02', device: { host: 'PC02' } });
  const pageOne = await fetch(`${base}/api/agents?limit=1&offset=0`, {
    headers: { Authorization: 'Bearer controller-secret' }
  });
  const firstPage = await pageOne.json();
  assert.equal(firstPage.total, 2);
  assert.equal(firstPage.agents.length, 1);
  const pageTwo = await fetch(`${base}/api/agents?limit=1&offset=1`, {
    headers: { Authorization: 'Bearer controller-secret' }
  });
  const secondPage = await pageTwo.json();
  assert.equal(secondPage.agents.length, 1);
  assert.notEqual(firstPage.agents[0].roomId, secondPage.agents[0].roomId);
  const search = await fetch(`${base}/api/agents?q=pc02`, {
    headers: { Authorization: 'Bearer controller-secret' }
  });
  assert.deepEqual((await search.json()).agents.map((item) => item.roomId), ['lab-pc02']);
});
