import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function main() {
  const sockets: any[] = [], stored: any = {}, handled: any[] = [];
  let listener: any, trusted = false;
  class Socket {
    static OPEN = 1; static CONNECTING = 0;
    readyState = 0; sent: any[] = []; onopen: any; onmessage: any; onclose: any;
    constructor() { sockets.push(this); }
    send(text: string) { this.sent.push(JSON.parse(text)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const extension = 'chrome-extension://' + 'a'.repeat(32) + '/';
  const context: any = { WebSocket: Socket, console: { log() {}, warn() {}, error() {} }, setInterval: () => 1, clearInterval() {}, setTimeout,
    handled, chrome: {
      storage: { local: {
        setAccessLevel: async ({ accessLevel }: any) => { trusted = accessLevel === 'TRUSTED_CONTEXTS'; },
        get: async () => ({ ...stored }), set: async (value: any) => { assert.ok(trusted); Object.assign(stored, value); },
      } },
      tabs: { onRemoved: { addListener() {} } },
      runtime: { id: 'a'.repeat(32), getURL: (file: string) => extension + file, getManifest: () => ({ version: '1.0.8' }),
        onConnect: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(fn: any) { listener = fn; } } },
      alarms: { create() {}, onAlarm: { addListener() {} } },
    } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('extension/background.js', 'utf8') + '\nhandleMessage = async message => handled.push(message.type);', context);
  const socket = sockets[0]; socket.readyState = Socket.OPEN; await socket.onopen();
  assert.equal(socket.sent[0].type, 'HANDSHAKE');
  await socket.onmessage({ data: JSON.stringify({ type: 'EXECUTE_RPC' }) }); assert.equal(handled.length, 0);
  const code = 'a'.repeat(32); let response: any;
  listener({ type: 'BRIDGE_PAIR', code }, { id: 'a'.repeat(32), tab: { id: 1 }, url: extension + 'pairing.html' }, (value: any) => { response = value; });
  assert.equal(response, undefined, 'Content scripts cannot issue pairing');
  listener({ type: 'BRIDGE_PAIR', code }, { id: 'a'.repeat(32), url: extension + 'other.html' }, (value: any) => { response = value; });
  assert.equal(response, undefined);
  listener({ type: 'BRIDGE_PAIR', code }, { id: 'a'.repeat(32), url: extension + 'pairing.html' }, (value: any) => { response = value; });
  assert.equal(response.ok, true); assert.equal(socket.sent.at(-1).type, 'PAIR');
  const token = 'a'.repeat(43);
  await socket.onmessage({ data: JSON.stringify({ type: 'AUTH_OK', token }) });
  assert.equal(stored.bridgePairingToken, token);
  await socket.onmessage({ data: JSON.stringify({ type: 'EXECUTE_RPC' }) }); assert.equal(handled.length, 1);
  socket.close();
  vm.runInContext('connectWebSocket()', context);
  const reconnected = sockets[1]; reconnected.readyState = Socket.OPEN; await reconnected.onopen();
  assert.equal(reconnected.sent[0].token, token, 'Reconnect uses persisted token');
  await reconnected.onmessage({ data: JSON.stringify({ type: 'AUTH_OK' }) });
  socket.onclose();
  listener({ type: 'BRIDGE_PAIRING_STATUS' }, { id: 'a'.repeat(32), url: extension + 'pairing.html' }, (value: any) => { response = value; });
  assert.equal(response.connected, true, 'Stale socket callback does not reset new connection');
  assert.equal(response.token, undefined);
  console.log('PASS: extension VM gates commands until auth, restricts pairing to its popup, isolates storage and reconnects without exposing tokens');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
