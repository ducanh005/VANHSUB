import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { transcribe } from '../main/asr/whisperEngine';

async function main() {
  const prior = process.env.VANHSUB_WHISPER_CLI;
  const modelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-missing-cli-'));
  try {
    fs.writeFileSync(path.join(modelsDir, 'ggml-tiny.bin'), 'placeholder');
    process.env.VANHSUB_WHISPER_CLI = path.join(process.cwd(), '__missing_whisper_cli__.exe');
    await assert.rejects(() => transcribe(
      'node_modules/nodejs-whisper/cpp/whisper.cpp/bindings/go/samples/jfk.wav',
      { modelName: 'tiny', modelRootPath: modelsDir },
    ), /Không tìm thấy binary whisper-cli/);
  } finally {
    if (prior === undefined) delete process.env.VANHSUB_WHISPER_CLI;
    else process.env.VANHSUB_WHISPER_CLI = prior;
    fs.rmSync(modelsDir, { recursive: true, force: true });
  }
  console.log('PASS: missing whisper-cli fails explicitly');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
