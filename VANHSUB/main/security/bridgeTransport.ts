import { WebSocketServer } from 'ws';

/** An ordinary web page must not impersonate the authenticated browser extension. */
export function createBridgeSocketServer(port: number): WebSocketServer {
  return new WebSocketServer({
    port, host: '127.0.0.1', maxPayload: 32 * 1024 * 1024,
    verifyClient: ({ origin }: { origin: string }) => /^chrome-extension:\/\/[a-p]{32}$/.test(origin || ''),
  });
}
