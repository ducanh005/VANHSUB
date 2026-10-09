/** Adapt a generated utterance before it is placed on the fixed source timeline. */
export interface TtsTimingAttempt {
  strategy: 'original' | 'shortened' | 'rate';
  text: string;
  speed: number;
  durationMs: number;
}

export interface TtsTimingResult {
  chosen: TtsTimingAttempt;
  attempts: TtsTimingAttempt[];
  requiredTempo: number;
}

export function configuredMaxTempo(): number {
  const raw = process.env.VANHSUB_MAX_TEMPO;
  if (!raw) return 1.35;
  const value = Number(raw);
  if (!(value >= 1 && value <= 1.5)) throw new Error('VANHSUB_MAX_TEMPO must be between 1.0 and 1.5');
  return value;
}

export async function adaptTtsDuration(options: {
  text: string;
  speed: number;
  slotMs: number;
  maxTempo: number;
  supportsRate: boolean;
  synthesize: (text: string, speed: number) => Promise<number>;
  shorten?: (text: string, targetRatio: number) => Promise<string | null>;
}): Promise<TtsTimingResult> {
  const { text, speed, slotMs, maxTempo, supportsRate, synthesize, shorten } = options;
  if (!(slotMs > 0) || !(maxTempo >= 1 && maxTempo <= 2)) {
    throw new Error('Invalid TTS timing limits');
  }
  const attempts: TtsTimingAttempt[] = [];
  const tryAudio = async (strategy: TtsTimingAttempt['strategy'], spoken: string, rate: number) => {
    const durationMs = await synthesize(spoken, rate);
    if (!(durationMs > 0) || !Number.isFinite(durationMs)) throw new Error('TTS produced invalid audio duration');
    const attempt = { strategy, text: spoken, speed: rate, durationMs };
    attempts.push(attempt);
    return attempt;
  };
  let best = await tryAudio('original', text, speed);
  if (best.durationMs > slotMs * 1.05 && shorten) {
    const candidate = (await shorten(text, Math.min(0.95, slotMs / best.durationMs)))?.trim();
    if (candidate && candidate.length < text.length && candidate !== text) {
      const attempt = await tryAudio('shortened', candidate, speed);
      if (attempt.durationMs < best.durationMs) best = attempt;
    }
  }
  if (best.durationMs > slotMs * 1.05 && supportsRate) {
    const rate = Math.min(speed * 1.2, Math.max(speed * 1.05, speed * best.durationMs / slotMs / maxTempo));
    if (rate > speed + 0.01) {
      const attempt = await tryAudio('rate', best.text, rate);
      if (attempt.durationMs < best.durationMs) best = attempt;
    }
  }
  const requiredTempo = best.durationMs / slotMs;
  if (requiredTempo > maxTempo) {
    throw new Error(`TTS timing conflict: ${Math.round(best.durationMs)} ms speech exceeds ${Math.round(slotMs)} ms slot (needs ${requiredTempo.toFixed(2)}x; limit ${maxTempo.toFixed(2)}x)`);
  }
  return { chosen: best, attempts, requiredTempo };
}
