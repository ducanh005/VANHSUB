import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
interface PairedDevice { version: 1; origin: string; tokenHash: string }

/** Only token hashes persist. Pairing codes exist in memory for two minutes. */
export class BridgePairingAuthority {
  private challenge?: { hash: string; expiresAt: number; remaining: number };
  constructor(private readonly file: string, private readonly now = Date.now) {}

  createCode(): { code: string; expiresAt: number } {
    const code = crypto.randomBytes(16).toString('hex');
    const expiresAt = this.now() + 120_000;
    this.challenge = { hash: digest(code), expiresAt, remaining: 5 };
    return { code, expiresAt };
  }

  private readDevice(): PairedDevice | undefined {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data?.version === 1 && extensionOrigin.test(data.origin) && /^[a-f0-9]{64}$/.test(data.tokenHash)) return data;
    } catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Không đọc được thông tin ghép đôi Chrome.'); }
  }

  private save(device: PairedDevice | null): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(device), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  authorize(origin: string, token: unknown): boolean {
    if (!extensionOrigin.test(origin) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const device = this.readDevice();
    return Boolean(device && device.origin === origin && crypto.timingSafeEqual(Buffer.from(device.tokenHash, 'hex'), Buffer.from(digest(token), 'hex')));
  }

  pair(origin: string, code: unknown): string | undefined {
    const challenge = this.challenge;
    if (!extensionOrigin.test(origin) || !challenge || this.now() >= challenge.expiresAt || challenge.remaining <= 0) return;
    challenge.remaining--;
    if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code) ||
        !crypto.timingSafeEqual(Buffer.from(challenge.hash, 'hex'), Buffer.from(digest(code), 'hex'))) return;
    const token = crypto.randomBytes(32).toString('base64url');
    this.save({ version: 1, origin, tokenHash: digest(token) });
    this.challenge = undefined;
    return token;
  }

  revoke(): void { this.save(null); this.challenge = undefined; }

  authenticateSocket(socket: WebSocket, origin: string, accepted: () => void): void {
    const timer = setTimeout(() => socket.close(1008, 'PAIRING_REQUIRED'), 30_000);
    timer.unref();
    const dispose = () => { clearTimeout(timer); socket.off('message', receive); socket.off('close', dispose); socket.off('error', dispose); };
    const receive = (data: any) => {
      try {
        if (data.length > 2048) { socket.close(1008, 'INVALID_AUTH'); return; }
        const message = JSON.parse(data.toString());
        let token: string | undefined;
        if (message?.type === 'PAIR') token = this.pair(origin, message.code);
        if (token || (message?.type === 'HANDSHAKE' && this.authorize(origin, message.token))) {
          dispose();
          // A new pair replaces previous authorization. The server handles revocation of old sockets.
          accepted();
          socket.send(JSON.stringify({ type: 'AUTH_OK', ...(token ? { token } : {}) }));
        } else socket.send(JSON.stringify({ type: 'AUTH_REQUIRED', minimumVersion: '1.0.8' }));
      } catch { socket.close(1008, 'INVALID_AUTH'); }
    };
    socket.on('message', receive); socket.once('close', dispose); socket.once('error', dispose);
  }
}
