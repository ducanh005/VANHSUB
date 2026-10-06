// Nextron's compiler logs webpack errors without setting a failing exit code.
// Keep its exact build configuration, but make CI fail on compilation errors.
const id = require.resolve('webpack');
const webpack = require(id);
require.cache[id].exports = new Proxy(webpack, {
  apply(target, receiver, args) {
    const compiler = Reflect.apply(target, receiver, args);
    const run = compiler.run.bind(compiler);
    compiler.run = (callback) =>
      run((error, stats) => {
        if (error || stats?.hasErrors()) process.exitCode = 1;
        callback?.(error, stats);
      });
    return compiler;
  },
});
