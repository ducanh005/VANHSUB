import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { encryptPlatformSecret } from '../main/security/secretStorage';
import { productionContentPolicy } from '../main/security/contentPolicy';
import { AiStudioDiskStorageManager } from '../main/ai-studio/storage/AiStudioDiskStorageManager';
import * as operations from '../main/lib/taskOperations';
import * as leases from '../main/lib/taskLease';

async function main() {
  const release = leases.reserveTaskOperation('integration-shared-registry');
  assert.equal(operations.isTaskOperationActive('integration-shared-registry'), true);
  assert.throws(() => operations.reserveTaskOperation('integration-shared-registry'), /đang xử lý/);
  release();
  assert.equal(operations.isTaskOperationActive('integration-shared-registry'), false);
  const value = 'synthetic-secret';
  assert.throws(() => encryptPlatformSecret(value, null, false), /DPAPI/);
  assert.throws(() => encryptPlatformSecret(value, { isEncryptionAvailable: () => true, encryptString: () => { throw new Error(value); } }, true), /mã hóa/);
  const encrypted = encryptPlatformSecret(value, { isEncryptionAvailable: () => true, encryptString: () => Buffer.from('synthetic-ciphertext') }, false);
  assert.ok(encrypted.startsWith('enc:v1:'));
  assert.ok(!encrypted.includes(value));
  assert.ok(encryptPlatformSecret(value, null, true).startsWith('enc:v1:headless:'));
  const script = 'window.bootstrap = true;';
  const policy = productionContentPolicy(`<script>${script}</script><script src="/chunk.js"></script>`);
  assert.ok(policy.includes(crypto.createHash('sha256').update(script).digest('base64')));
  assert.ok(!policy.includes("script-src 'self' 'unsafe-inline'"));
  assert.ok(!policy.includes('unsafe-eval'));
  assert.ok(policy.includes("object-src 'none'"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-atomic-'));
  try {
    const storage = new AiStudioDiskStorageManager('owned', { baseDir: root, exactProjectDir: true });
    const file = path.join(root, 'last-good.json');
    fs.writeFileSync(file, 'last good checkpoint');
    const rename = fs.renameSync, copy = fs.copyFileSync;
    try {
      fs.renameSync = (() => { throw Object.assign(new Error('synthetic lock'), { code: 'EPERM' }); }) as any;
      fs.copyFileSync = (() => { throw new Error('synthetic disk full'); }) as any;
      assert.throws(() => storage.writeAtomic(file, 'replacement'), /lock/);
      assert.equal(fs.readFileSync(file, 'utf8'), 'last good checkpoint');
    } finally { fs.renameSync = rename; fs.copyFileSync = copy; }
    assert.equal(fs.readdirSync(root).some(name => name.includes('.tmp.')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('PASS: fail-closed secret writes, immutable bootstrap CSP hashes and locked atomic destination preservation');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
