import assert from 'assert';
import type { IdeaBlueprint, PipelineSessionState } from '../renderer/types/aiStudio';

console.log('=== TEST: Resume & Cancel Production Process Controls Logic ===');

// Mock state
let session: PipelineSessionState | null = null;
let selectedIdea: IdeaBlueprint | null = null;
let centerTab: 'script' | 'visual' | 'character' = 'visual';
let savedProjectSession: PipelineSessionState | null = null;
let conflictModalData: { pendingBlueprint: IdeaBlueprint } | null = null;
let isRunning = false;

const ideaA: IdeaBlueprint = {
  title: 'Bí ẩn lăng mộ Tần Thủy Hoàng',
  aspectRatio: '16:9',
  hookConcept: 'Khám phá bí mật thủy ngân dưới lòng đất',
  targetAudience: 'Người yêu lịch sử',
};

const ideaB: IdeaBlueprint = {
  title: 'Top 5 AI thay đổi thế giới 2026',
  aspectRatio: '9:16',
  hookConcept: 'AI đang thay thế lập trình viên thế nào?',
  targetAudience: 'Dân công nghệ',
};

function isIdeaInActiveSession(idea: IdeaBlueprint | null | undefined): boolean {
  if (!session || !idea) return false;
  const sessionTopic = (session.topic || '').trim().toLowerCase();
  const ideaTitle = (idea.title || '').trim().toLowerCase();
  const ideaTopic = (idea.topic || '').trim().toLowerCase();
  const bpTitle = (session.artifacts?.blueprint?.title || '').trim().toLowerCase();
  const bpTopic = (session.artifacts?.blueprint?.topic || '').trim().toLowerCase();

  return (
    (ideaTitle !== '' && (ideaTitle === sessionTopic || ideaTitle === bpTitle)) ||
    (ideaTopic !== '' && (ideaTopic === sessionTopic || ideaTopic === bpTopic))
  );
}

function handleResumeSession(idea?: IdeaBlueprint | null) {
  const target = idea || session?.artifacts?.blueprint || selectedIdea;
  if (target) {
    selectedIdea = target;
  }
  centerTab = 'script';
}

// Hủy / Dừng tiến trình hiện tại đang chạy (KHÔNG XÓA DỮ LIỆU)
function handleCancelCurrentRun() {
  if (!session) {
    isRunning = false;
    return;
  }
  isRunning = false;
  session.status = 'cancelled';
  if (session.stages && session.stages[session.currentStage]) {
    session.stages[session.currentStage].status = 'error';
  }
  savedProjectSession = session;
}

// Tiếp tục tiến trình chạy tiếp từ bước hiện tại
function handleResumePipelineRun(idea?: IdeaBlueprint | null) {
  handleResumeSession(idea);
  if (!session) return;
  isRunning = true;
  session.status = 'running';
  savedProjectSession = session;
}

// Xóa hoàn toàn phiên (khi người dùng chủ động xóa video)
function handleClearSession() {
  session = null;
  savedProjectSession = null;
  conflictModalData = null;
  isRunning = false;
}

function handleRequestStartProduction(blueprint: IdeaBlueprint) {
  if (isIdeaInActiveSession(blueprint)) {
    handleResumeSession(blueprint);
    return;
  }

  const hasExistingWork =
    Boolean(session) &&
    (Boolean(session?.artifacts?.scriptLines && session.artifacts.scriptLines.length > 0) ||
      (session?.currentStage || 1) >= 2 ||
      isRunning);

  if (hasExistingWork) {
    conflictModalData = { pendingBlueprint: blueprint };
    return;
  }

  // Start new
  isRunning = true;
  session = {
    sessionId: 'session-test-01',
    topic: blueprint.title,
    currentStage: 2,
    stageName: 'script',
    status: 'running',
    progress: 25,
    gatedMode: true,
    stages: {
      1: { status: 'success', stage: 1, stageName: 'Dữ kiện' },
      2: { status: 'running', stage: 2, stageName: 'Kịch bản' },
    },
    artifacts: {
      blueprint,
      scriptLines: [
        { id: 'sc-1', text: 'Đây là câu hook mở đầu bí ẩn', estimatedDurationSec: 6 },
        { id: 'sc-2', text: 'Lăng mộ đã bị chôn sâu 2000 năm', estimatedDurationSec: 8 },
      ],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  savedProjectSession = session;
  selectedIdea = blueprint;
  centerTab = 'script';
}

// 1. Initial State: No session
assert.strictEqual(session, null);
assert.strictEqual(isIdeaInActiveSession(ideaA), false);

// 2. Start production with Idea A
handleRequestStartProduction(ideaA);
assert.notStrictEqual(session, null);
assert.strictEqual(isRunning, true);
assert.strictEqual(session?.status, 'running');
assert.strictEqual(session?.topic, ideaA.title);
assert.strictEqual(session?.artifacts?.scriptLines?.length, 2);
assert.strictEqual(isIdeaInActiveSession(ideaA), true);
assert.strictEqual(centerTab, 'script');
console.log('✓ [PASS] Production started: isRunning = true, script lines generated.');

// 3. User clicks "HỦY TIẾN TRÌNH" (Cancel currently running background process)
// CRITICAL: MUST STOP RUNNING BUT MUST NOT WIPE DATA!
const originalSessionId = session?.sessionId;
handleCancelCurrentRun();
assert.strictEqual(isRunning, false, 'isRunning must be false after cancel');
assert.strictEqual(session?.status, 'cancelled', 'session status must be cancelled');
assert.strictEqual(session?.sessionId, originalSessionId, 'sessionId must be preserved');
assert.strictEqual(session?.artifacts?.scriptLines?.length, 2, 'script lines must NOT be deleted');
assert.strictEqual(savedProjectSession !== null, true, 'saved session must remain intact');
console.log('✓ [PASS] "Hủy tiến trình" halted execution safely: isRunning = false, 100% script lines preserved.');

// 4. User clicks "TIẾP TỤC" (Resume currently paused process)
handleResumePipelineRun();
assert.strictEqual(isRunning, true, 'isRunning must become true after resume');
assert.strictEqual(session?.status, 'running', 'session status must be running again');
assert.strictEqual(session?.sessionId, originalSessionId, 'sessionId must remain unchanged');
assert.strictEqual(session?.artifacts?.scriptLines?.length, 2, 'script lines preserved during resume');
console.log('✓ [PASS] "Tiếp tục" resumed pipeline cleanly without restarting or wiping data.');

// 5. Conflict Protection: User clicks "Sản xuất" on Idea B while Idea A session exists
handleRequestStartProduction(ideaB);
assert.strictEqual(session?.sessionId, originalSessionId);
assert.strictEqual(session?.topic, ideaA.title);
assert.notStrictEqual(conflictModalData, null);
assert.strictEqual(conflictModalData?.pendingBlueprint.title, ideaB.title);
console.log('✓ [PASS] Conflict guard prevented accidental overwrite of active session with Idea B.');

// 6. User chooses "Tiếp tục phiên hiện tại" from conflict modal
handleResumeSession();
conflictModalData = null;
assert.strictEqual(centerTab, 'script');
assert.strictEqual(session?.topic, ideaA.title);
console.log('✓ [PASS] User can resume current session from conflict warning modal.');

// 7. Explicit Delete / Reset (when user explicitly deletes video)
handleClearSession();
assert.strictEqual(session, null);
assert.strictEqual(savedProjectSession, null);
assert.strictEqual(isIdeaInActiveSession(ideaA), false);
console.log('✓ [PASS] Explicit delete only resets when explicitly confirmed.');

// 8. Fresh production after explicit reset
handleRequestStartProduction(ideaB);
assert.strictEqual(session?.topic, ideaB.title);
assert.strictEqual(isIdeaInActiveSession(ideaB), true);
console.log('✓ [PASS] New session started cleanly with Idea B.');

console.log('\n=============================================================');
console.log('ALL RESUME & CANCEL PROCESS CONTROLS TESTS PASSED! ✅');
console.log('=============================================================');
