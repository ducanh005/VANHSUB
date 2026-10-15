interface PlatformStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
}

/** Default behavior is fail-closed. Insecure fixtures require explicit headless opt-in. */
export function encryptPlatformSecret(plain: string, storage?: PlatformStorage | null, allowInsecureTestFallback =
  process.env.VANHSUB_ALLOW_INSECURE_TEST_SECRETS === '1' && !process.versions.electron): string {
  if (!plain) return '';
  try {
    if (storage?.isEncryptionAvailable()) return 'enc:v1:' + storage.encryptString(plain).toString('base64');
  } catch {
    throw new Error('Không thể mã hóa secret bằng DPAPI; cấu hình cũ được giữ nguyên.');
  }
  if (allowInsecureTestFallback) return 'enc:v1:headless:' + Buffer.from(plain, 'utf8').toString('base64');
  throw new Error('DPAPI chưa sẵn sàng. Không lưu secret dưới dạng plaintext hoặc base64.');
}
