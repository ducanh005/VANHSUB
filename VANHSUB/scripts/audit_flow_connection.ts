// Readiness only: never sends generation, auth, browser navigation or tab commands.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';

const available = (port: number) => new Promise<boolean>(resolve => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});
async function main() {
  const result: any = { checkedAt: new Date().toISOString(), generationCount: 0, browserOrTabCommands: 0, bridgeWaitMs: 30000 };
  try {
    const response = await fetch('http://127.0.0.1:9224/json/version', { signal: AbortSignal.timeout(2000) });
    result.cdpAvailable = response.ok;
  } catch { result.cdpAvailable = false; }
  const portsFree = (await Promise.all([available(9222), available(8765)])).every(Boolean);
  result.bridgePortsAvailableBeforeProbe = portsFree;
  if (portsFree) {
    const bridge = FlowBridgeServer.getInstance();
    try {
      bridge.start();
      const deadline = Date.now() + result.bridgeWaitMs;
      while (!bridge.isConnected() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 500));
      result.extensionConnected = bridge.isConnected();
    } finally { bridge.stop(); }
  }
  result.status = result.cdpAvailable || result.extensionConnected ? 'CONNECTION_AVAILABLE_NOT_YET_LIVE_TESTED' : 'BLOCKED_NO_TEST_CONNECTION';
  fs.writeFileSync(path.resolve('docs/audit-evidence/2026-10-15/flow-connection.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
