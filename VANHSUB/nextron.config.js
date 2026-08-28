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
      'nodejs-whisper',
      'uuid',
    ];
    return config;
  },
};
