import assert from 'node:assert/strict';
import path from 'node:path';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { formatSafeLogArg } from '../main/security/logRedaction';
import { guardRendererInvoke, trustRenderer, validateFlowBrowserUrl, validateModelName, resolveBundledPath } from '../main/security/rendererTrust';
import { createBridgeSocketServer } from '../main/security/bridgeTransport';

async function main() {
  const logged = formatSafeLogArg({ nested: { apiKey: 'SYNTHETIC_KEY', cookie: 'SYNTHETIC_COOKIE' }, message: 'Authorization: Bearer SYNTHETIC_TOKEN', url: 'https://example.invalid/?key=SYNTHETIC_QUERY' });
  assert.equal(logged.includes('SYNTHETIC_'), false);
  assert.ok(logged.includes('[REDACTED]'));
  assert.equal(formatSafeLogArg(new Error('api_key=SYNTHETIC_ERROR')).includes('SYNTHETIC_ERROR'), false);
  const callbacks: Record<string, Function> = {};
  const frame = { url: 'http://localhost:8888/home' };
  let openHandler: any;
  const contents: any = { id: 7, mainFrame: frame, isDestroyed: () => false,
    once: (name: string, callback: Function) => { callbacks[name] = callback; },
    on: (name: string, callback: Function) => { callbacks[name] = callback; },
    setWindowOpenHandler: (handler: any) => { openHandler = handler; } };
  let invoked = 0;
  const guarded = guardRendererInvoke(() => ++invoked);
  const event: any = { sender: contents, senderFrame: frame };
  assert.throws(() => guarded(event), /IPC_FORBIDDEN/);
  trustRenderer(contents, frame.url);
  assert.equal(guarded(event), 1);
  assert.throws(() => guarded({ ...event, sender: { ...contents } }), /IPC_FORBIDDEN/);
  assert.throws(() => guarded({ ...event, senderFrame: { url: frame.url } }), /IPC_FORBIDDEN/);
  frame.url = 'https://attacker.invalid/';
  assert.throws(() => guarded(event), /IPC_FORBIDDEN/);
  frame.url = 'http://localhost:8889/home';
  assert.throws(() => guarded(event), /IPC_FORBIDDEN/);
  frame.url = 'http://localhost:8888/home';
  let prevented = false;
  callbacks['will-navigate']({ preventDefault: () => { prevented = true; } }, 'https://attacker.invalid/');
  assert.equal(prevented, true);
  assert.equal(openHandler({ url: 'https://attacker.invalid' }).action, 'deny');
  callbacks.destroyed();
  assert.throws(() => guarded(event), /IPC_FORBIDDEN/);
  assert.equal(invoked, 1);
  assert.ok(validateFlowBrowserUrl('https://flow.google.com/project/a').startsWith('https://flow.google.com/'));
  for (const value of ['file:///C:/Windows/system.ini', 'javascript:alert(1)', 'https://attacker.invalid', 'https://flow.google.com.attacker.invalid', 'https://user@flow.google.com/', 'http://flow.google.com']) assert.throws(() => validateFlowBrowserUrl(value));
  for (const name of ['../x', '..\\x', 'base/../../x', 'C:\\x', '', 'a\u0000b']) assert.throws(() => validateModelName(name));
  assert.equal(validateModelName('large-v3-turbo-q5_0'), 'large-v3-turbo-q5_0');
  const root = path.resolve('app');
  assert.equal(resolveBundledPath(root, '/home/index.html'), path.join(root, 'home', 'index.html'));
  for (const value of ['../settings.json', '..\\settings.json', 'C:\\Windows\\system.ini']) assert.throws(() => resolveBundledPath(root, value));
  const server = createBridgeSocketServer(0);
  await once(server, 'listening');
  const port = (server.address() as any).port;
  const connect = async (origin?: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {});
    try { await once(socket, 'open'); return true; } catch { return false; }
    finally { socket.terminate(); }
  };
  try {
    assert.equal(await connect('https://attacker.invalid'), false);
    assert.equal(await connect(), false);
    assert.equal(await connect('chrome-extension://' + 'a'.repeat(32)), true);
  } finally {
    for (const client of server.clients) client.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  console.log('PASS: IPC sender/frame/origin, navigation, URL/model/path validation and real WebSocket origin handshake');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
