import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import axios from 'axios';

async function main() {
  const server = http.createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/media' }); response.end(); }
    else if (request.url === '/slow') { request.on('close', () => response.destroy()); }
    else { response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end(Buffer.from([1, 2, 3, 4])); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const data = await axios.get(`${base}/redirect`, { proxy: false, responseType: 'arraybuffer', timeout: 2000 });
    assert.deepEqual(Buffer.from(data.data), Buffer.from([1, 2, 3, 4]));
    await assert.rejects(() => axios.get(`${base}/redirect`, { proxy: false, maxRedirects: 0 }), error => axios.isAxiosError(error) && error.response?.status === 302);
    const controller = new AbortController();
    const pending = axios.get(`${base}/slow`, { proxy: false, signal: controller.signal, timeout: 2000 });
    const stopped = assert.rejects(pending, error => axios.isCancel(error));
    controller.abort(); await stopped;
    console.log(`PASS: axios ${axios.VERSION} local binary download, bounded redirects and cancellation`);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
