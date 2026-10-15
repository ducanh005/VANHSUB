/** Prepare all replacements before an atomic store write. Never log source values. */
export function planLegacySecretMigration(
  record: Record<string, unknown>, keys: Iterable<string>,
  encrypt: (value: string) => string, decrypt: (value: string) => string,
): Record<string, string> {
  const replacements: Record<string, string> = {};
  for (const key of keys) {
    const raw = record[key];
    if (raw === undefined || raw === '') continue;
    if (typeof raw !== 'string') throw new Error('Dữ liệu secret cũ không hợp lệ; giữ nguyên cấu hình.');
    if (raw.startsWith('enc:v1:') && !raw.startsWith('enc:v1:headless:')) continue;
    let plain = raw;
    if (raw.startsWith('enc:v1:headless:')) {
      const encoded = raw.slice('enc:v1:headless:'.length);
      const decoded = Buffer.from(encoded, 'base64');
      plain = decoded.toString('utf8');
      if (!encoded || decoded.toString('base64') !== encoded || !Buffer.from(plain, 'utf8').equals(decoded)) {
        throw new Error('Dữ liệu secret cũ không hợp lệ; giữ nguyên cấu hình.');
      }
    }
    const encrypted = encrypt(plain);
    if (!encrypted.startsWith('enc:v1:') || encrypted.startsWith('enc:v1:headless:') || decrypt(encrypted) !== plain) {
      throw new Error('Không xác minh được mã hóa secret; giữ nguyên cấu hình.');
    }
    replacements[key] = encrypted;
  }
  return replacements;
}
