import crypto from 'crypto';

/** Permit the immutable inline bootstrap scripts emitted by Next static export. */
export function productionContentPolicy(html: string): string {
  const hashes = new Set<string>();
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    if (match[1].trim()) hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1]).digest('base64')}'`);
  }
  return [
    "default-src 'self'", `script-src 'self' ${[...hashes].join(' ')}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: vanhmedia: https:",
    "media-src 'self' blob: vanhmedia: https:", "font-src 'self' data: https:",
    "connect-src 'self' https: ws://127.0.0.1:*", "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "frame-src 'none'",
  ].join('; ');
}
