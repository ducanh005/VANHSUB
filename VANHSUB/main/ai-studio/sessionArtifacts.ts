import type { PipelineSessionState, ScriptBeatLine } from './types';

/** Remove stale pointers, never the previous files themselves. */
export function applyScriptLines(session: PipelineSessionState, incoming: ScriptBeatLine[]): void {
  if (!Array.isArray(incoming) || !incoming.length || incoming.some(line =>
    !line || typeof line.id !== 'string' || !line.id.trim() || typeof line.text !== 'string' || !line.text.trim()) ||
    new Set(incoming.map(line => line.id)).size !== incoming.length) {
    throw new Error('Kịch bản phải có lời thoại và ID duy nhất cho từng dòng.');
  }
  const clean = (line: ScriptBeatLine) => {
    const { audioPath, startMs, endMs, durationMs, assetPath, assetType, ...content } = line;
    return content;
  };
  const previous = session.artifacts.scriptLines || [];
  const lines = incoming.map(clean);
  if (JSON.stringify(previous.map(clean)) === JSON.stringify(lines)) return;
  session.artifacts.scriptHistory ||= [];
  session.artifacts.scriptHistory.push({ lines: structuredClone(previous), evaluation: session.artifacts.scriptEvaluation, timestamp: Date.now() });
  session.artifacts.scriptLines = lines;
  for (const key of ['audioPath', 'srtPath', 'wordsAlignment', 'scenes', 'storyboardSynthesis', 'mediaDir', 'videoPath', 'metadata', 'scriptEvaluation'] as const) {
    delete session.artifacts[key];
  }
  for (let stage = 3; stage <= 8; stage++) {
    session.stages[stage] = { status: 'pending', stageName: session.stages[stage]?.stageName || `Bước ${stage}` };
  }
  session.currentStage = 2;
  session.stageName = 'script';
  session.stages[2] = { ...session.stages[2], status: 'success', stageName: 'script' };
  session.status = 'awaiting_approval';
  session.progress = 25;
}
