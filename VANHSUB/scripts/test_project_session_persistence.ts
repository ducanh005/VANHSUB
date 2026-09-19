import assert from 'assert';
import path from 'path';
import os from 'os';
import {
  getAiStudioConfig,
  updateAiStudioConfig,
} from '../main/store/aiStudioStore';
import type {
  SavedProjectProfile,
  IdeaBlueprint,
  PipelineSessionState,
} from '../main/ai-studio/types';

async function runPersistenceTests() {
  console.log('=== TEST: Project Ideas & Script Session Full Persistence ===');

  const testDir = path.join(os.tmpdir(), 'vanhsub-test-persistence-' + Date.now());
  process.env.VANHSUB_AI_STUDIO_DIR = testDir;

  const sampleIdeas: IdeaBlueprint[] = [
    {
      id: 'idea_1',
      title: 'Bí Mật Kim Tự Tháp Giza',
      hook: 'Bạn có biết công trình này đã tồn tại qua hàng ngàn năm phong ba bão táp?',
      targetAudience: 'Những người đam mê khảo cổ học',
      rationale: 'Chủ đề hot với lượng tìm kiếm cao',
      estimatedDuration: '5-8 phút',
      visualStyle: 'Điện ảnh huyền bí',
      scenes: 15,
      suggestedTags: ['kim_tu_thap', 'ai_cap', 'khao_co'],
    },
    {
      id: 'idea_2',
      title: 'Lăng Mộ Tần Thủy Hoàng',
      hook: 'Đội quân đất nung canh giữ điều gì suốt hai thiên niên kỷ?',
      targetAudience: 'Người thích lịch sử phương Đông',
      rationale: 'Hấp dẫn kịch tính',
      estimatedDuration: '5-8 phút',
      visualStyle: 'Sử thi cổ trang',
      scenes: 18,
      suggestedTags: ['tan_thuy_hoang', 'lich_su'],
    },
  ];

  const sampleSession: PipelineSessionState = {
    id: 'session_giz_123',
    projectId: 'proj_egypt_01',
    projectName: 'Hồ Sơ Cổ Đại',
    mode: 'auto_pilot',
    stage: 2,
    status: 'awaiting_approval',
    progress: 35,
    stageProgress: 100,
    startTime: Date.now() - 60000,
    elapsedSeconds: 60,
    artifacts: {
      scriptLines: [
        {
          id: 'line_1',
          index: 1,
          text: 'Sâu trong lòng sa mạc Sahara, Kim tự tháp Giza sừng sững như một thách thức với thời gian.',
          durationMs: 5000,
          startMs: 0,
          endMs: 5000,
        },
        {
          id: 'line_2',
          index: 2,
          text: 'Hàng triệu khối đá nặng hàng tấn được ghép lại với độ chính xác đến khó tin.',
          durationMs: 6000,
          startMs: 5000,
          endMs: 11000,
        },
      ],
      currentScore: 88,
    },
    logs: ['Stage 1 completed', 'Stage 2 completed: 2 script lines generated'],
  };

  // Step 1: Initialize Project 1 with channel profile
  const proj1: SavedProjectProfile = {
    id: 'proj_egypt_01',
    name: 'Hồ Sơ Cổ Đại',
    channelProfile: {
      projectName: 'Hồ Sơ Cổ Đại',
      channelNiche: 'Khảo cổ học & Lịch sử thế giới',
      channelOrientation: 'Bí ẩn, khoa học, lôi cuốn',
      aiProvider: 'gemini_web',
      targetLongDuration: '5_8_min',
      imageSource: 'ai_flow_meta',
      videoStyleId: '',
      videoStyles: [],
      seriesType: 'anthology_new_topic',
      channelDescription: '',
      masterPrompt: '',
      researchFactBeforeWrite: false,
      evaluationLlm: 'gemini_web',
      channelHook: '',
      targetShortDuration: '60_90_sec',
      ttsEngine: 'edge_tts',
      specificVoice: 'vi-VN-NamMinhNeural',
      characterSync: 'per_video',
      characterRole: '',
      characterImageMode: 'ai_draw',
      chromeProfile: 'auto',
      visualEngine: 'google_flow',
      visualMode: 'blend',
      videoScenesIntro: 3,
      videoScenesBody: 10,
      staticImageDurationMin: 5,
      staticImageDurationMax: 8,
      videoModel: 'Omni 1.1 Flash',
      imageModel: '⭐ Nano Banana 2',
    },
    flowConfig: { aspectRatio: '16:9' },
    updatedAt: Date.now(),
  };

  updateAiStudioConfig({
    savedProjects: [proj1],
    activeProjectId: proj1.id,
  });

  // Step 2: Simulate saving generated ideas & session for Project 1
  let cfg = getAiStudioConfig();
  const existingList = cfg.savedProjects || [];
  const idx = existingList.findIndex((p) => p.id === proj1.id);
  assert.ok(idx >= 0, 'Project 1 must exist in saved projects');

  const updatedProj1: SavedProjectProfile = {
    ...existingList[idx],
    ideas: sampleIdeas,
    selectedIdea: sampleIdeas[0],
    lastSessionId: sampleSession.id,
    savedSession: sampleSession,
    updatedAt: Date.now(),
  };

  updateAiStudioConfig({
    savedProjects: [updatedProj1],
  });

  // Verify Project 1 now has ideas and session stored
  cfg = getAiStudioConfig();
  const savedP1 = cfg.savedProjects?.find((p) => p.id === proj1.id);
  assert.ok(savedP1, 'Project 1 must be saved');
  assert.strictEqual(savedP1?.ideas?.length, 2, 'Project 1 must have 2 saved ideas');
  assert.strictEqual(savedP1?.selectedIdea?.id, 'idea_1');
  assert.strictEqual(savedP1?.lastSessionId, 'session_giz_123');
  assert.strictEqual(savedP1?.savedSession?.artifacts.scriptLines?.length, 2);
  console.log('✓ [PASS] Project 1 saved ideas and script session successfully on disk.');

  // Step 3: Simulate modifying project settings (e.g. change aspect ratio or niche)
  // Merge must preserve ideas, selectedIdea, and savedSession
  const partialUpdate: Partial<SavedProjectProfile> = {
    id: proj1.id,
    flowConfig: { aspectRatio: '9:16' },
  };
  const currentList = cfg.savedProjects || [];
  const pIdx = currentList.findIndex((p) => p.id === proj1.id);
  const safeMergedList = [...currentList];
  safeMergedList[pIdx] = {
    ...currentList[pIdx],
    ...partialUpdate,
    updatedAt: Date.now(),
  };
  updateAiStudioConfig({ savedProjects: safeMergedList });

  cfg = getAiStudioConfig();
  const reloadedP1 = cfg.savedProjects?.find((p) => p.id === proj1.id);
  assert.strictEqual(reloadedP1?.flowConfig?.aspectRatio, '9:16');
  assert.strictEqual(reloadedP1?.ideas?.length, 2, 'Ideas must NOT be wiped by setting updates');
  assert.strictEqual(reloadedP1?.savedSession?.artifacts.scriptLines?.length, 2, 'Script lines must NOT be wiped');
  console.log('✓ [PASS] Safe merge verified: Updating project settings preserves ideas and session.');

  // Step 4: Add Project 2 (Isolation Test)
  const proj2: SavedProjectProfile = {
    id: 'proj_space_02',
    name: 'Thiên Văn Kỳ Thú',
    channelProfile: {
      ...proj1.channelProfile,
      projectName: 'Thiên Văn Kỳ Thú',
      channelNiche: 'Vũ trụ học',
    },
    flowConfig: { aspectRatio: '16:9' },
    ideas: [
      {
        id: 'space_idea_1',
        title: 'Hố Đen Vũ Trụ',
        hook: 'Điều gì xảy ra nếu bạn rơi vào chân trời sự kiện?',
        targetAudience: 'Đam mê khoa học',
        rationale: 'Hút view cao',
        estimatedDuration: '5-8 phút',
        visualStyle: 'Cyberpunk',
        scenes: 12,
        suggestedTags: ['black_hole', 'space'],
      },
    ],
    lastSessionId: 'session_space_456',
    updatedAt: Date.now(),
  };

  updateAiStudioConfig({
    savedProjects: [proj2, reloadedP1!],
    activeProjectId: proj2.id,
  });

  cfg = getAiStudioConfig();
  assert.strictEqual(cfg.savedProjects?.length, 2);
  const p1Check = cfg.savedProjects.find((p) => p.id === proj1.id);
  const p2Check = cfg.savedProjects.find((p) => p.id === proj2.id);

  assert.strictEqual(p1Check?.ideas?.length, 2, 'Project 1 ideas intact');
  assert.strictEqual(p1Check?.selectedIdea?.title, 'Bí Mật Kim Tự Tháp Giza');
  assert.strictEqual(p2Check?.ideas?.length, 1, 'Project 2 has 1 idea');
  assert.strictEqual(p2Check?.ideas?.[0].title, 'Hố Đen Vũ Trụ');
  console.log('✓ [PASS] Project isolation verified: Multiple projects maintain their own independent ideas and sessions.');

  // Step 5: Simulate inline script line editing in Project 1
  const modifiedP1 = { ...p1Check! };
  const updatedScriptLines = [
    ...modifiedP1.savedSession!.artifacts.scriptLines!,
    {
      id: 'line_3',
      index: 3,
      text: 'Những căn phòng bí mật bên trong vẫn còn là điều bí ẩn chưa có lời giải.',
      durationMs: 5500,
      startMs: 11000,
      endMs: 16500,
    },
  ];
  modifiedP1.savedSession = {
    ...modifiedP1.savedSession!,
    artifacts: {
      ...modifiedP1.savedSession!.artifacts,
      scriptLines: updatedScriptLines,
    },
  };

  const finalList = cfg.savedProjects.map((p) => (p.id === proj1.id ? modifiedP1 : p));
  updateAiStudioConfig({ savedProjects: finalList });

  cfg = getAiStudioConfig();
  const finalP1 = cfg.savedProjects?.find((p) => p.id === proj1.id);
  assert.strictEqual(finalP1?.savedSession?.artifacts.scriptLines?.length, 3, 'Project 1 script line count must be 3');
  assert.strictEqual(finalP1?.savedSession?.artifacts.scriptLines?.[2].text, 'Những căn phòng bí mật bên trong vẫn còn là điều bí ẩn chưa có lời giải.');
  console.log('✓ [PASS] Script edits persist across saves and reloads.');

  console.log('\n==================================================');
  console.log('ALL PROJECT IDEAS & SCRIPT SESSION TESTS PASSED! ✅');
  console.log('==================================================');
}

runPersistenceTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
