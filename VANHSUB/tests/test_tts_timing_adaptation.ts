import assert from 'node:assert/strict';
import { adaptTtsDuration } from '../main/render/ttsTiming';

async function main() {
  const preserved: string[] = [];
  const shortened = await adaptTtsDuration({
    text: 'We need to leave this place immediately.', speed: 1, slotMs: 1000,
    maxTempo: 1.35, supportsRate: true,
    shorten: async () => 'We must leave now.',
    synthesize: async (text, speed) => {
      preserved.push(`${text}@${speed}`);
      return text.startsWith('We must') ? 1000 : 1700;
    },
  });
  assert.equal(shortened.chosen.strategy, 'shortened');
  assert.equal(shortened.chosen.text, 'We must leave now.');
  assert.equal(shortened.requiredTempo, 1);
  assert.deepEqual(preserved, ['We need to leave this place immediately.@1', 'We must leave now.@1']);

  const rated = await adaptTtsDuration({
    text: 'Hello.', speed: 1, slotMs: 1000, maxTempo: 1.35, supportsRate: true,
    synthesize: async (_text, speed) => 1550 / speed,
  });
  assert.equal(rated.chosen.strategy, 'rate');
  assert.ok(rated.chosen.speed > 1 && rated.requiredTempo <= 1.35);

  await assert.rejects(() => adaptTtsDuration({
    text: 'Keep every word.', speed: 1, slotMs: 1000, maxTempo: 1.35,
    supportsRate: false, synthesize: async () => 1900,
  }), /TTS timing conflict: 1900 ms speech exceeds 1000 ms slot/);
  console.log('PASS TTS adaptation: shortening, provider rate, explicit conflict');
}
main().catch((err) => { console.error(err); process.exitCode = 1; });
