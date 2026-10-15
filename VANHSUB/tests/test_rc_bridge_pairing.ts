import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { BridgePairingAuthority } from '../main/security/bridgePairing';
import { createBridgeSocketServer } from '../main/security/bridgeTransport';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-pairing-'));
  const file = path.join(root, 'pairing.json');
  let now = 1000;
  const origin = 'chrome-extension://' + 'a'.repeat(32);
  const authority = new BridgePairingAuthority(file, () => now);
  const server = createBridgeSocketServer(0);
  const sockets: WebSocket[] = [];
  let accepted = 0, commands = 0;
  server.on('connection', (socket, request) => authority.authenticateSocket(socket, request.headers.origin!, () => {
    accepted++;
    socket.on('message', () => commands++);
  }));
  await once(server, 'listening');
  const port = (server.address() as any).port;
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin }); sockets.push(socket);
    await once(socket, 'open'); return socket;
  };
  const exchange = async (socket: WebSocket, payload: object) => {
    const response = once(socket, 'message'); socket.send(JSON.stringify(payload));
    return JSON.parse(String((await response)[0]));
  };
  try {
    const unauthenticated = await connect();
    assert.equal((await exchange(unauthenticated, { type: 'HANDSHAKE', token: 'x'.repeat(43) })).type, 'AUTH_REQUIRED');
    assert.equal((await exchange(unauthenticated, { id: 'stolen', result: { ok: true } })).type, 'AUTH_REQUIRED');
    assert.equal(accepted, 0); assert.equal(commands, 0);
    const challenge = authority.createCode();
    const response = await exchange(unauthenticated, { type: 'PAIR', code: challenge.code });
    assert.equal(response.type, 'AUTH_OK'); assert.equal(accepted, 1);
    const token = response.token;
    const persisted = fs.readFileSync(file, 'utf8');
    assert.ok(!persisted.includes(token)); assert.ok(!persisted.includes(challenge.code));
    const restarted = new BridgePairingAuthority(file, () => now);
    assert.equal(restarted.authorize(origin, token), true);
    assert.equal(restarted.authorize('chrome-extension://' + 'b'.repeat(32), token), false);
    assert.equal(authority.pair(origin, challenge.code), undefined, 'One-use code cannot replay');
    const reconnect = await connect();
    assert.equal((await exchange(reconnect, { type: 'HANDSHAKE', token })).type, 'AUTH_OK');
    const expired = authority.createCode(); now += 120_000;
    assert.equal(authority.pair(origin, expired.code), undefined);
    const bounded = authority.createCode();
    for (let index = 0; index < 5; index++) assert.equal(authority.pair(origin, '0'.repeat(32)), undefined);
    assert.equal(authority.pair(origin, bounded.code), undefined, 'Five wrong attempts exhaust code');
    authority.revoke(); assert.equal(restarted.authorize(origin, token), false);

    const bridge: any = FlowBridgeServer.getInstance();
    const owner = {}, foreign = {};
    let resolved = false;
    const timer = setTimeout(() => {}, 2000);
    bridge.pendingRequests.set('binding', { client: owner, timer, resolve: () => { resolved = true; }, reject() {} });
    bridge.handleIncomingMessage({ id: 'binding', result: { ok: true } }, foreign);
    assert.equal(resolved, false); assert.equal(bridge.pendingRequests.has('binding'), true);
    bridge.handleIncomingMessage({ id: 'binding', result: { ok: true } }, owner);
    assert.equal(resolved, true);
    console.log('PASS: real WS denies unpaired commands; one-use/expired/rate-bounded pairing, hash-only persistence, origin binding, reconnect/revoke and response-owner binding');
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
