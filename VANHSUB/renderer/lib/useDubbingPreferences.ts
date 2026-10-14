import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Task } from '../types/task';
import { normalizeDubbingPreferences, type DubbingPreferences } from '../../main/lib/dubbingPreferences';

/** Both dubbing controls edit the same per-task configuration. */
export function useDubbingPreferences(task: Task | null) {
  const [value, setValue] = useState(() => normalizeDubbingPreferences(task?.dubbingPreferences));
  const pending = useRef<string | null>(null);
  const version = useRef(0);
  const saved = JSON.stringify(task?.dubbingPreferences);
  useEffect(() => {
    pending.current = null;
    version.current++;
    setValue(normalizeDubbingPreferences(task?.dubbingPreferences));
  }, [task?.id]);
  useEffect(() => {
    const next = normalizeDubbingPreferences(task?.dubbingPreferences);
    if (!pending.current || pending.current === JSON.stringify(next)) setValue(next);
  }, [task?.id, saved]);
  function update(patch: Partial<DubbingPreferences>) {
    const next = normalizeDubbingPreferences({ ...value, ...patch });
    setValue(next);
    if (!task || typeof window === 'undefined') return;
    pending.current = JSON.stringify(next);
    const request = ++version.current;
    window.vanhsub.tasks.update(task.id, { dubbingPreferences: next, dubbedVideoPath: undefined }).then(() => {
      if (version.current === request) pending.current = null;
    }).catch((error) => {
      if (version.current === request) {
        pending.current = null;
        setValue(normalizeDubbingPreferences(task.dubbingPreferences));
        toast.error(error?.message || 'Không lưu được cấu hình lồng tiếng.');
      }
    });
  }
  return { ...value,
    setReplaceAudio: (replaceAudio: boolean) => update({ replaceAudio }),
    setSyncMode: (syncMode: DubbingPreferences['syncMode']) => update({ syncMode }),
    setMixOriginalAudio: (mixOriginalAudio: boolean) => update({ mixOriginalAudio }),
    setVocalSeparation: (vocalSeparation: boolean) => update({ vocalSeparation }),
  };
}
