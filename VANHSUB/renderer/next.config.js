/** @type {import('next').NextConfig} */
export default {
  output: 'export',
  distDir: process.env.NODE_ENV === 'production' ? '../app' : '.next',
  trailingSlash: true,
  // Renderer shares pure TypeScript helpers with main/lib and main/render.
  experimental: { externalDir: true },
  images: {
    unoptimized: true,
  },
}
