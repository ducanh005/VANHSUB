const sensitiveKey = /api.?key|authorization|cookie|access.?token|refresh.?token|password|secret|credential/i;

export function redactLogText(text: string): string {
  return text
    .replace(/\b(Bearer\s+)[^\s"',;}]+/gi, '$1[REDACTED]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|cookie|authorization)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n&,;}]+)/gi, '$1[REDACTED]')
    .replace(/([?&](?:key|token|signature|credential|auth)=)[^&#\s]+/gi, '$1[REDACTED]');
}

export function formatSafeLogArg(value: unknown): string {
  if (typeof value === 'string') return redactLogText(value);
  if (value instanceof Error) return redactLogText(value.stack || value.message);
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (key, item) => {
      if (sensitiveKey.test(key)) return '[REDACTED]';
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      return typeof item === 'string' ? redactLogText(item) : item;
    });
    return text ?? String(value);
  } catch { return '[Unserializable log value]'; }
}
