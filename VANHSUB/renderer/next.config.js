import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
export default {
  turbopack: { root: fileURLToPath(new URL('..', import.meta.url)) },
  output: 'export',
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  // Renderer shares pure subtitle helpers from ../main; compile their TypeScript too.
  experimental: { externalDir: true },
  images: {
    unoptimized: true,
  },
}
