export interface ChatGptTurnSnapshot {
  userCount: number;
  assistantCount: number;
  assistantId: string;
  text: string;
  isStreaming: boolean;
  hasCompletionControl: boolean;
  error?: string;
}

/** Never accept a previous answer or a paused reasoning/streaming placeholder. */
export class ChatGptTurnTracker {
  private lastText = '';
  private lastId = '';
  private stableSince = 0;

  constructor(private readonly baseline: ChatGptTurnSnapshot) {}

  observe(state: ChatGptTurnSnapshot, now: number): string | null {
    if (state.error) throw new Error(state.error);
    const isNewTurn = state.userCount > this.baseline.userCount &&
      state.assistantCount > this.baseline.assistantCount;
    if (!isNewTurn || !state.text.trim() || state.isStreaming) {
      this.stableSince = 0;
      return null;
    }
    if (state.text !== this.lastText || state.assistantId !== this.lastId || !this.stableSince) {
      this.lastText = state.text;
      this.lastId = state.assistantId;
      this.stableSince = now;
      return null;
    }
    return state.hasCompletionControl && now - this.stableSince >= 1800 ? state.text : null;
  }
}

/** Serialized into the remote page; keep this function independent of module state. */
export function readChatGptTurnSnapshot(): ChatGptTurnSnapshot {
  const assistants = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
  const last = assistants[assistants.length - 1];
  const turn = last?.closest('[data-testid^="conversation-turn-"], article') || last;
  const answer = last?.querySelector('.markdown');
  const alert = document.querySelector('[data-testid="conversation-error"], [data-testid="error-message"]');
  return {
    userCount: document.querySelectorAll('[data-message-author-role="user"]').length,
    assistantCount: assistants.length,
    assistantId: last?.getAttribute('data-message-id') || '',
    // A thinking placeholder can have a message ID before answer markdown exists.
    text: answer ? ((answer as HTMLElement).innerText || answer.textContent || '') : '',
    isStreaming: Boolean(document.querySelector('button[data-testid="stop-button"], .result-streaming')),
    hasCompletionControl: Boolean(turn?.querySelector(
      'button[data-testid="copy-turn-action-button"], button[data-testid="good-response-turn-action-button"], button[data-testid="bad-response-turn-action-button"]'
    )),
    error: alert?.textContent?.trim() || undefined,
  };
}

export function isChatGptSessionCookie(
  cookie: { name: string; domain?: string; expirationDate?: number },
  nowSeconds = Date.now() / 1000
): boolean {
  return /^(?:chatgpt\.com|\.chatgpt\.com)$/.test(cookie.domain || '') &&
    /^(?:__Secure-)?(?:next-auth|authjs)\.session-token(?:\.\d+)?$/.test(cookie.name) &&
    (cookie.expirationDate === undefined || cookie.expirationDate > nowSeconds);
}
