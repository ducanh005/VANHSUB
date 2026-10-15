import crypto from 'node:crypto';
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
  const cipher = { encrypt: (v: string) => 'fixture:' + Buffer.from(v).toString('base64'), decrypt: (v: string) => Buffer.from(v.slice(8), 'base64').toString() };
  const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
  const hmac = (k: string, v: string) => crypto.createHmac('sha256', k).update(v).digest('hex');
  const authority = new BridgePairingAuthority(file, () => now, cipher);
  const server = createBridgeSocketServer(0);
  const sockets: WebSocket[] = [];
  let accepted = 0, commands = 0;
  server.on('connection', (socket, request) => authority.authenticateSocket(socket, request.headers.origin!, request.socket.localPort!, () => {
    accepted++;
    socket.on('message', () => commands++);
  }));
  await once(server, 'listening');
  const port = (server.address() as any).port;
  const connect = async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin }); sockets.push(socket);
    const first = once(socket, 'message');
    await once(socket, 'open');
    const challenge = JSON.parse(String((await first)[0]));
    assert.equal(challenge.type, 'AUTH_CHALLENGE'); assert.equal(challenge.protocol, 2); assert.equal(challenge.port, port);
    (socket as any).context = `${origin}|${port}|${challenge.nonce}`;
    return socket;
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
    assert.equal((await exchange(unauthenticated, { type: 'PAIR', code: challenge.code })).type, 'AUTH_REQUIRED', 'Raw code cannot authenticate');
    const pairKey = sha(challenge.code);
    const response = await exchange(unauthenticated, { type: 'PAIR', proof: hmac(pairKey, 'client|' + (unauthenticated as any).context) });
    assert.equal(response.type, 'AUTH_OK'); assert.equal(accepted, 1);
    const token = response.token;
    assert.equal(response.serverProof, hmac(pairKey, 'server|' + (unauthenticated as any).context + '|' + sha(token)));
    const persisted = fs.readFileSync(file, 'utf8');
    assert.ok(!persisted.includes(token)); assert.ok(!persisted.includes(challenge.code));
    const restarted = new BridgePairingAuthority(file, () => now, cipher);
    assert.equal(restarted.authorize(origin, token), true);
    assert.equal(restarted.authorize('chrome-extension://' + 'b'.repeat(32), token), false);
    assert.equal(authority.pair(origin, challenge.code), undefined, 'One-use code cannot replay');
    const reconnect = await connect();
    assert.equal((await exchange(reconnect, { type: 'HANDSHAKE', token })).type, 'AUTH_REQUIRED', 'Raw bearer token rejected');
    assert.equal((await exchange(reconnect, { type: 'HANDSHAKE', proof: hmac(sha(token), 'client|' + (unauthenticated as any).context) })).type, 'AUTH_REQUIRED', 'Old nonce replay denied');
    const wrongPort = (reconnect as any).context.replace('|' + port + '|', '|' + (port + 1) + '|');
    assert.equal((await exchange(reconnect, { type: 'HANDSHAKE', proof: hmac(sha(token), 'client|' + wrongPort) })).type, 'AUTH_REQUIRED', 'Alternate-port relay denied');
    const reply = await exchange(reconnect, { type: 'HANDSHAKE', proof: hmac(sha(token), 'client|' + (reconnect as any).context) });
    assert.equal(reply.type, 'AUTH_OK');
    assert.equal(reply.serverProof, hmac(sha(token), 'server|' + (reconnect as any).context));
    const expired = authority.createCode(); now += 120_000;
    assert.equal(authority.pair(origin, expired.code), undefined);
    const bounded = authority.createCode();
    for (let index = 0; index < 5; index++) assert.equal(authority.pair(origin, '0'.repeat(32)), undefined);
    assert.equal(authority.pair(origin, bounded.code), undefined, 'Five wrong attempts exhaust code');
    authority.revoke(); assert.equal(restarted.authorize(origin, token), false);

    const unavailable = new BridgePairingAuthority(path.join(root, 'unavailable.json'), () => now, { encrypt() { throw new Error('No DPAPI'); }, decrypt() { throw new Error('No DPAPI'); } });
    const unavailableCode = unavailable.createCode();
    assert.throws(() => unavailable.pair(origin, unavailableCode.code), /No DPAPI/);
    assert.equal(fs.existsSync(path.join(root, 'unavailable.json')), false, 'No plaintext fallback');

    const bridge: any = FlowBridgeServer.getInstance();
    const owner = {}, foreign = {};
    let resolved = false;
    const timer = setTimeout(() => {}, 2000);
    bridge.pendingRequests.set('binding', { client: owner, timer, resolve: () => { resolved = true; }, reject() {} });
    bridge.handleIncomingMessage({ id: 'binding', result: { ok: true } }, foreign);
    assert.equal(resolved, false); assert.equal(bridge.pendingRequests.has('binding'), true);
    bridge.handleIncomingMessage({ id: 'binding', result: { ok: true } }, owner);
    assert.equal(resolved, true);
    console.log('PASS: real WS denies unpaired commands; one-use/expired/rate-bounded pairing, cipher-injected key persistence, nonce/port-bound mutual proofs, origin binding, reconnect/revoke and response-owner binding');
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
