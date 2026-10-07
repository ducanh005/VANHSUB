import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function main() {
  let calls = 0;
  let status = 200;
  let fail = false;
  const nativeFetch = async () => {
    calls++;
    if (fail) throw new Error('Network disconnected');
    return { status, clone: () => ({ text: async () => 'response from Flow' }) };
  };
  const window: any = { fetch: nativeFetch, addEventListener() {} };
  const context = vm.createContext({ window, console: { log() {}, warn() {} }, setTimeout, clearTimeout });
  const source = fs.readFileSync('extension/injected.js', 'utf8');
  vm.runInContext(source, context);
  await window.fetch('https://labs.google/batchexecute?rpcids=ogiZ0b', { body: 'test' });
  await Promise.resolve();
  assert.equal(window.__VANHSUB_SNIFFER__.history[0].status, 200);
  assert.equal(window.__VANHSUB_SNIFFER__.history[0].response, 'response from Flow');
  status = 403;
  await window.fetch('https://labs.google/batchexecute?rpcids=ogiZ0b');
  assert.equal(window.__VANHSUB_SNIFFER__.history[1].status, 403);
  fail = true;
  await assert.rejects(window.fetch('https://labs.google/batchexecute?rpcids=ogiZ0b'), /Network disconnected/);
  assert.equal(window.__VANHSUB_SNIFFER__.history[2].status, 0);
  assert.equal(calls, 3, 'Observer must not retry or generate extra requests');
  assert.equal(window.__VANHSUB_SNIFFER__.history.length, 3);
  console.log('PASS: captures HTTP success, HTTP rejection, network failure; no extra requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
