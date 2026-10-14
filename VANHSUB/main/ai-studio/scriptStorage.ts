import type { ScriptBeatLine } from './types';
import type { ScriptSceneItem } from './types/storage';

export function toStoredScriptScenes(lines: ScriptBeatLine[]): ScriptSceneItem[] {
  return lines.map((line, index) => ({
    scene_id: `scene_${String(index + 1).padStart(2, '0')}`,
    narration: line.text,
    visual_note: line.visualAction || line.visualNote || line.visualPromptEn || undefined,
    cameraAngle: line.cameraAngle,
    cameraMovement: line.cameraMovement,
    suggestedMediaType: line.suggestedMediaType,
    voiceDirection: line.voiceDirection,
  }));
}
