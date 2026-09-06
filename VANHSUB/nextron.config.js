module.exports = {
  webpack: (config) => {
    config.output = {
      ...config.output,
      library: { type: 'commonjs2' },
    };
    config.externals = [
      'electron',
      'electron/main',
      'electron/common',
      'electron/renderer',
      'electron-store',
      'fluent-ffmpeg',
      '@ffmpeg-installer/ffmpeg',
      '@ffprobe-installer/ffprobe',
      'nodejs-whisper',
      // tesseract.js spawn worker-script từ thư mục package — không bundle được
      'tesseract.js',
      'uuid',
    ];
    return config;
  },
};
