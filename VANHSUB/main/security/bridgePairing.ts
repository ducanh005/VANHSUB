import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import { encryptPlatformSecret } from './secretStorage';

const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const proof = (key: string, message: string) => crypto.createHmac('sha256', key).update(message).digest('hex');
const equalProof = (value: unknown, expected: string) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
export interface PairingCipher { encrypt(value: string): string; decrypt(value: string): string }
const platformCipher: PairingCipher = {
  encrypt(value) { return encryptPlatformSecret(value, require('electron').safeStorage, false); },
  decrypt(value) {
    if (!value.startsWith('enc:v1:') || value.startsWith('enc:v1:headless:')) throw new Error('PAIRING_ENCRYPTION_REQUIRED');
    return require('electron').safeStorage.decryptString(Buffer.from(value.slice('enc:v1:'.length), 'base64'));
  },
};

/** Protocol2 never sends the pairing code or persistent token in a reconnect request. */
export class BridgePairingAuthority {
  private challenge?: { hash: string; expiresAt: number; remaining: number };
  constructor(private readonly file: string, private readonly now = Date.now, private readonly cipher: PairingCipher = platformCipher) {}

  createCode(): { code: string; expiresAt: number } {
    const code = crypto.randomBytes(16).toString('hex'), expiresAt = this.now() + 120_000;
    this.challenge = { hash: digest(code), expiresAt, remaining: 5 };
    return { code, expiresAt };
  }

  private readDevice(): { origin: string; key: string } | undefined {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (data?.version !== 2 || !extensionOrigin.test(data.origin) || typeof data.encryptedKey !== 'string') return;
      const key = this.cipher.decrypt(data.encryptedKey);
      if (/^[a-f0-9]{64}$/.test(key)) return { origin: data.origin, key };
    } catch (error: any) { if (error.code !== 'ENOENT') throw new Error('Không đọc được thông tin ghép đôi Chrome.'); }
  }

  private save(device: object | null): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, JSON.stringify(device), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, this.file); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  authorize(origin: string, token: unknown): boolean {
    if (!extensionOrigin.test(origin) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const device = this.readDevice();
    return Boolean(device && device.origin === origin && equalProof(digest(token), device.key));
  }

  private pairProof(origin: string, supplied: unknown, context: string): { token: string; serverProof: string } | undefined {
    const challenge = this.challenge;
    if (!extensionOrigin.test(origin) || !challenge || this.now() >= challenge.expiresAt || challenge.remaining <= 0) return;
    challenge.remaining--;
    if (!equalProof(supplied, proof(challenge.hash, 'client|' + context))) return;
    const token = crypto.randomBytes(32).toString('base64url'), key = digest(token);
    const encryptedKey = this.cipher.encrypt(key);
    if (this.cipher.decrypt(encryptedKey) !== key) throw new Error('PAIRING_ENCRYPTION_FAILED');
    this.save({ version: 2, origin, encryptedKey });
    this.challenge = undefined;
    return { token, serverProof: proof(challenge.hash, 'server|' + context + '|' + digest(token)) };
  }

  /** Direct helper for fixture/expiry tests; the WebSocket accepts proofs only. */
  pair(origin: string, code: unknown): string | undefined {
    if (typeof code !== 'string' || !/^[a-f0-9]{32}$/.test(code)) return this.pairProof(origin, '', 'direct')?.token;
    return this.pairProof(origin, proof(digest(code), 'client|direct'), 'direct')?.token;
  }
  revoke(): void { this.save(null); this.challenge = undefined; }

  authenticateSocket(socket: WebSocket, origin: string, port: number, accepted: () => void): void {
    const nonce = crypto.randomBytes(32).toString('base64url');
    // Port binding prevents a fake listener on the alternate port from relaying a proof.
    const context = `${origin}|${port}|${nonce}`;
    const timer = setTimeout(() => socket.close(1008, 'PAIRING_REQUIRED'), 30_000); timer.unref();
    const dispose = () => { clearTimeout(timer); socket.off('message', receive); socket.off('close', dispose); socket.off('error', dispose); };
    const receive = (data: any) => {
      try {
        if (data.length > 2048) { socket.close(1008, 'INVALID_AUTH'); return; }
        const message = JSON.parse(data.toString());
        let response: { token?: string; serverProof: string } | undefined;
        if (message?.type === 'PAIR') response = this.pairProof(origin, message.proof, context);
        if (message?.type === 'HANDSHAKE') {
          const device = this.readDevice();
          if (device?.origin === origin && equalProof(message.proof, proof(device.key, 'client|' + context))) response = { serverProof: proof(device.key, 'server|' + context) };
        }
        if (response) { dispose(); accepted(); socket.send(JSON.stringify({ type: 'AUTH_OK', protocol: 2, ...response })); }
        else socket.send(JSON.stringify({ type: 'AUTH_REQUIRED', protocol: 2, minimumVersion: '1.0.8' }));
      } catch { socket.close(1008, 'INVALID_AUTH'); }
    };
    socket.on('message', receive); socket.once('close', dispose); socket.once('error', dispose);
    socket.send(JSON.stringify({ type: 'AUTH_CHALLENGE', protocol: 2, nonce, port }));
  }
}
