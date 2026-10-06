/**
 * tests/test_challenger_m6_1_adversarial.ts
 *
 * Adversarial Challenger Test Suite for Milestone 6:
 * AutoPilotView Modularization & Advanced Drawer
 *
 * Checks:
 * 1. Artifacts existence & re-export completeness in index.ts
 * 2. Component callability & SSR render integrity
 * 3. Adversarial empty props ({}) and undefined prop tolerance
 * 4. Boundary & malformed input tolerance (toMediaUrl, presets, stages)
 * 5. Anti-facade and genuine integration verification in AutoPilotView.tsx
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AutoPilotHeader,
  PipelineTrackerPanel,
  IdeaListPanel,
  CharacterStudioPanel,
  StoryboardGridPanel,
  StoryboardSceneCard,
  MediaLightboxModal,
  AdvancedInfrastructureDrawer,
  STAGES,
  STYLE_PRESETS,
  toMediaUrl,
} from '../renderer/components/ai-studio/autopilot';

import AutoPilotView from '../renderer/components/ai-studio/AutoPilotView';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  category: string;
}

const results: TestResult[] = [];

function recordPass(category: string, name: string) {
  results.push({ category, name, passed: true });
  console.log(`  ✅ [${category}] ${name}`);
}

function recordFail(category: string, name: string, error: any) {
  const errMsg = error instanceof Error ? error.message : String(error);
  results.push({ category, name, passed: false, error: errMsg });
  console.error(`  ❌ [${category}] ${name}: ${errMsg}`);
}

function runTestCase(category: string, name: string, fn: () => void) {
  try {
    fn();
    recordPass(category, name);
  } catch (err: any) {
    recordFail(category, name, err);
  }
}

async function runAdversarialSuite() {
  console.log('================================================================================');
  console.log('⚔️  CHALLENGER M6-1: ADVERSARIAL STRESS TEST & FORENSIC AUDIT ⚔️');
  console.log('================================================================================\n');

  const autopilotDir = path.join(__dirname, '..', 'renderer', 'components', 'ai-studio', 'autopilot');
  const autopilotViewPath = path.join(__dirname, '..', 'renderer', 'components', 'ai-studio', 'AutoPilotView.tsx');

  // ============================================================================
  // Suite A: Artifact Presence & Re-export Completeness
  // ============================================================================
  console.log('--- 📁 SUITE A: ARTIFACT PRESENCE & RE-EXPORT COMPLETENESS ---');

  const requiredFiles = [
    'AutoPilotHeader.tsx',
    'PipelineTrackerPanel.tsx',
    'IdeaListPanel.tsx',
    'CharacterStudioPanel.tsx',
    'StoryboardGridPanel.tsx',
    'StoryboardSceneCard.tsx',
    'MediaLightboxModal.tsx',
    'AdvancedInfrastructureDrawer.tsx',
    'index.ts',
  ];

  for (const file of requiredFiles) {
    runTestCase('SUITE_A', `Artifact exists: ${file}`, () => {
      const fullPath = path.join(autopilotDir, file);
      assert.strictEqual(fs.existsSync(fullPath), true, `Missing file: ${file}`);
      const stats = fs.statSync(fullPath);
      assert(stats.size > 200, `File ${file} has insufficient content (size: ${stats.size}b)`);
    });
  }

  runTestCase('SUITE_A', 'index.ts re-exports all 8 components and utilities', () => {
    const indexPath = path.join(autopilotDir, 'index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    const expectedSymbols = [
      'AutoPilotHeader',
      'PipelineTrackerPanel',
      'IdeaListPanel',
      'CharacterStudioPanel',
      'StoryboardGridPanel',
      'StoryboardSceneCard',
      'MediaLightboxModal',
      'AdvancedInfrastructureDrawer',
      'STAGES',
      'STYLE_PRESETS',
      'toMediaUrl',
    ];

    for (const sym of expectedSymbols) {
      assert(
        indexContent.includes(sym),
        `index.ts must re-export symbol '${sym}'`
      );
    }
  });

  // ============================================================================
  // Suite B: Baseline Valid SSR Rendering
  // ============================================================================
  console.log('\n--- ⚛️ SUITE B: BASELINE VALID SSR RENDERING ---');

  runTestCase('SUITE_B', 'AutoPilotHeader renders with baseline props', () => {
    const html = renderToStaticMarkup(
      React.createElement(AutoPilotHeader, {
        projectName: 'Test Project',
        savedProjects: [{ id: 'proj-1', name: 'Test Project' }],
        activeProjectId: 'proj-1',
        activeTab: 'video',
        onTabChange: () => {},
        aiProviderName: 'Gemini 2.5 Flash',
        isFlowWindowOpen: false,
        onToggleFlowLive: () => {},
        onOpenChannelConfig: () => {},
        onOpenAdvancedDrawer: () => {},
        session: null,
        ideasCount: 3,
        isRunning: false,
        isGatedMode: true,
        onToggleGatedMode: () => {},
        onCancelRun: () => {},
        onResumeRun: () => {},
      })
    );
    assert(html.includes('Test Project'), 'HTML must contain project name');
    assert(html.includes('AI STUDIO'), 'HTML must contain AI STUDIO badge');
    assert(html.includes('Hạ tầng'), 'HTML must contain Hạ tầng button');
  });

  runTestCase('SUITE_B', 'PipelineTrackerPanel renders with baseline props (session=null)', () => {
    const html = renderToStaticMarkup(
      React.createElement(PipelineTrackerPanel, {
        session: null,
        isRunning: false,
        isApproving: false,
        onApproveStage: () => {},
        onRetryStage: () => {},
        onCancelRun: () => {},
        onResumeRun: () => {},
        onToggleFlowLive: () => {},
        isFlowWindowOpen: false,
        errorMessage: null,
        errorCode: null,
        countdownSeconds: null,
        onDismissError: () => {},
        onOpenChromeBridge: () => {},
        onOpenDiagnostics: () => {},
        onOpenFolder: () => {},
      })
    );
    assert(html.includes('Tiến độ sản xuất'), 'HTML must contain header title');
    assert(html.includes('Duyệt một ý tưởng để bắt đầu sản xuất'), 'HTML must contain idle placeholder');
  });

  runTestCase('SUITE_B', 'PipelineTrackerPanel renders with active session & stages', () => {
    const html = renderToStaticMarkup(
      React.createElement(PipelineTrackerPanel, {
        session: {
          id: 'sess-123',
          topic: 'Chiến tranh Thế giới 2',
          status: 'running',
          currentStage: 3,
          progress: 35,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          stageStatuses: {
            '1': 'completed',
            '2': 'completed',
            '3': 'running',
          },
        } as any,
        isRunning: true,
        isApproving: false,
        onApproveStage: () => {},
        onRetryStage: () => {},
        onCancelRun: () => {},
        onResumeRun: () => {},
        onToggleFlowLive: () => {},
        isFlowWindowOpen: true,
        errorMessage: null,
        errorCode: null,
        countdownSeconds: null,
        onDismissError: () => {},
        onOpenChromeBridge: () => {},
        onOpenDiagnostics: () => {},
        onOpenFolder: () => {},
      })
    );
    assert(html.includes('35%'), 'HTML must contain progress percentage');
    assert(html.includes('Hủy tiến trình'), 'HTML must render cancel button when running');
  });

  runTestCase('SUITE_B', 'IdeaListPanel renders with baseline props', () => {
    const html = renderToStaticMarkup(
      React.createElement(IdeaListPanel, {
        ideas: [
          {
            id: 'idea-1',
            title: 'Top 5 Bí Mật Lịch Sử',
            hookConcept: 'Những bí mật chưa từng được kể',
            aspectRatio: '16:9',
            topic: 'Lịch sử',
          } as any,
        ],
        selectedIdea: null,
        onSelectIdea: () => {},
        selectedFormat: '16:9',
        onFormatChange: () => {},
        setupComplete: true,
        onOpenIdeaModal: () => {},
        isRunning: false,
        session: null,
        onCancelRun: () => {},
        onResumeSession: () => {},
        onRequestStartProduction: () => {},
      })
    );
    assert(html.includes('Top 5 Bí Mật Lịch Sử'), 'HTML must contain idea title');
    assert(html.includes('Sinh'), 'HTML must contain Sinh button');
  });

  runTestCase('SUITE_B', 'CharacterStudioPanel renders with baseline props', () => {
    const html = renderToStaticMarkup(
      React.createElement(CharacterStudioPanel, {
        hostName: 'Giáo Sư X',
        hostDescription: 'Một học giả thông thái',
        onUpdateHostName: () => {},
        onUpdateHostDescription: () => {},
        onUploadAvatar: () => {},
        onRemoveAvatar: () => {},
        onAiGenerateHost: () => {},
        channelCharacters: [{ id: 'char-1', name: 'Nhân vật phụ', descriptionEn: 'Warrior' }],
        newCharName: '',
        newCharDesc: '',
        onNewCharNameChange: () => {},
        onNewCharDescChange: () => {},
        onAddCharacter: () => {},
        onRemoveCharacter: () => {},
        visualArtStylePreset: 'cinematic',
        onSelectStylePreset: () => {},
        projectBackgroundPrompt: 'Vintage office',
        onUpdateBackgroundPrompt: () => {},
        onAiSuggestBackground: () => {},
        hostToast: null,
      })
    );
    assert(html.includes('Giáo Sư X'), 'HTML must contain host name');
    assert(html.includes('Điện ảnh Chân thực'), 'HTML must render style preset');
  });

  runTestCase('SUITE_B', 'StoryboardGridPanel renders with baseline props', () => {
    const html = renderToStaticMarkup(
      React.createElement(StoryboardGridPanel, {
        session: {
          id: 'sess-1',
          topic: 'Demo',
          status: 'completed',
          currentStage: 8,
          progress: 100,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          artifacts: {
            scenes: [
              {
                id: 'scene-1',
                shotId: 'shot-1',
                lineIndex: 0,
                visualPrompt: 'A wide cinematic landscape',
                videoPath: 'd:/output/shot1.mp4',
              } as any,
            ],
          },
        } as any,
        selectedShotIds: ['shot-1'],
        onToggleSelectShot: () => {},
        onSelectAllShots: () => {},
        onChangeGranularity: () => {},
        onSelectCustomMediaDir: () => {},
        onOpenFolder: () => {},
        isFlowWindowOpen: false,
        onToggleFlowLive: () => {},
        sceneActionNotice: null,
        onDismissSceneNotice: () => {},
        regeneratingSceneId: null,
        importingSceneId: null,
        onRegenerateScene: () => {},
        onImportManualMedia: () => {},
        onPreviewMedia: () => {},
        onRegenerateStoryboardOneToOne: () => {},
        onResumePipelineRun: () => {},
        isRunning: false,
      })
    );
    assert(html.includes('Phân cảnh &amp; Media AI'), 'HTML must contain section title');
    assert(html.includes('A wide cinematic landscape'), 'HTML must render scene card visual prompt');
  });

  runTestCase('SUITE_B', 'StoryboardSceneCard renders with baseline props', () => {
    const html = renderToStaticMarkup(
      React.createElement(StoryboardSceneCard, {
        scene: {
          id: 'sc-1',
          shotId: 'shot-01',
          lineIndex: 0,
          visualPrompt: 'Cyberpunk rainy street',
          lineText: 'Năm 2077...',
          durationMs: 4000,
        } as any,
        sceneIndex: 0,
        isSelected: false,
        onToggleSelect: () => {},
        isRegenerating: false,
        isImporting: false,
        onRegenerate: () => {},
        onImportMedia: () => {},
        onPreview: () => {},
        onOpenFolder: () => {},
      })
    );
    assert(html.includes('Cyberpunk rainy street'), 'HTML must render prompt');
    assert(html.includes('Năm 2077...'), 'HTML must render voice text');
  });

  runTestCase('SUITE_B', 'MediaLightboxModal renders when open with media', () => {
    const html = renderToStaticMarkup(
      React.createElement(MediaLightboxModal, {
        media: {
          type: 'image',
          url: 'd:/media/test.png',
          shotId: 'shot-101',
          narration: 'Lời bình minh họa',
        },
        onClose: () => {},
        onOpenFolder: () => {},
      })
    );
    assert(html.includes('shot-101'), 'HTML must render shotId in lightbox');
    assert(html.includes('Image Preview'), 'HTML must render image preview indicator');
  });

  runTestCase('SUITE_B', 'AdvancedInfrastructureDrawer renders when open', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdvancedInfrastructureDrawer, {
        isOpen: true,
        onClose: () => {},
        bridgePort: 19890,
        isLobbyDebugVisible: false,
        onToggleLobbyDebug: () => {},
      })
    );
    assert(html.includes('Hạ tầng &amp; Kỹ thuật Nâng cao'), 'HTML must render drawer title');
    assert(html.includes('19890'), 'HTML must render WebSocket port');
    assert(html.includes('Chạy ngầm (Offscreen)'), 'HTML must render offscreen status');
  });

  // ============================================================================
  // Suite C: Adversarial Stress Test - Empty Props ({}) & Nullish Resilience
  // ============================================================================
  console.log('\n--- 🛡️ SUITE C: ADVERSARIAL STRESS TEST (EMPTY PROPS & UNDEFINED VALUES) ---');

  runTestCase('SUITE_C', 'AutoPilotHeader handles empty props ({}) without unhandled crash', () => {
    try {
      const html = renderToStaticMarkup(React.createElement(AutoPilotHeader as any, {}));
      assert(typeof html === 'string', 'Should return HTML string');
    } catch (err: any) {
      throw new Error(`AutoPilotHeader crashed on empty props: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'PipelineTrackerPanel handles empty props ({}) without unhandled crash', () => {
    try {
      const html = renderToStaticMarkup(React.createElement(PipelineTrackerPanel as any, {}));
      assert(typeof html === 'string', 'Should return HTML string');
      assert(html.includes('Tiến độ sản xuất'), 'Should render base header');
    } catch (err: any) {
      throw new Error(`PipelineTrackerPanel crashed on empty props: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'MediaLightboxModal handles empty props ({}) without unhandled crash', () => {
    try {
      const html = renderToStaticMarkup(React.createElement(MediaLightboxModal as any, {}));
      assert.strictEqual(html, '', 'Should render null (empty string) when media is undefined');
    } catch (err: any) {
      throw new Error(`MediaLightboxModal crashed on empty props: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'AdvancedInfrastructureDrawer handles empty props ({}) without unhandled crash', () => {
    try {
      const html = renderToStaticMarkup(React.createElement(AdvancedInfrastructureDrawer as any, {}));
      assert.strictEqual(html, '', 'Should render null (empty string) when isOpen is undefined');
    } catch (err: any) {
      throw new Error(`AdvancedInfrastructureDrawer crashed on empty props: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'CharacterStudioPanel handles empty props ({}) without unhandled crash', () => {
    try {
      const html = renderToStaticMarkup(React.createElement(CharacterStudioPanel as any, {}));
      assert(typeof html === 'string', 'Should return HTML string');
    } catch (err: any) {
      throw new Error(`CharacterStudioPanel crashed on empty props: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'IdeaListPanel resilience: handles empty ideas array or missing ideas prop', () => {
    // 1. With empty array ideas: []
    const htmlWithEmptyArray = renderToStaticMarkup(
      React.createElement(IdeaListPanel as any, { ideas: [] })
    );
    assert(htmlWithEmptyArray.includes('Chưa có ý tưởng'), 'Must render empty state message');

    // 2. Adversarial: What happens if ideas is undefined?
    try {
      renderToStaticMarkup(React.createElement(IdeaListPanel as any, {}));
    } catch (err: any) {
      // Documenting the behavior: does it crash when ideas is undefined?
      throw new Error(`CRASH_ON_UNDEFINED_PROP: IdeaListPanel crashed when ideas prop was undefined: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'StoryboardGridPanel resilience: handles empty scenes and empty selectedShotIds', () => {
    // 1. With empty array selectedShotIds: []
    const htmlWithEmpty = renderToStaticMarkup(
      React.createElement(StoryboardGridPanel as any, {
        session: null,
        selectedShotIds: [],
      })
    );
    assert(htmlWithEmpty.includes('Phân cảnh &amp; Media AI'), 'Must render toolbar');

    // 2. Adversarial: What happens if selectedShotIds is undefined when session has scenes?
    try {
      renderToStaticMarkup(
        React.createElement(StoryboardGridPanel as any, {
          session: {
            artifacts: {
              scenes: [{ id: 'scene-1', shotId: 'shot-1' }],
            },
          },
        })
      );
    } catch (err: any) {
      throw new Error(`CRASH_ON_UNDEFINED_PROP: StoryboardGridPanel crashed when selectedShotIds was undefined with scenes: ${err.message}`);
    }
  });

  runTestCase('SUITE_C', 'StoryboardSceneCard resilience: handles valid minimal scene object vs undefined', () => {
    // 1. Minimal scene object
    const htmlWithMinimal = renderToStaticMarkup(
      React.createElement(StoryboardSceneCard as any, {
        scene: { id: 'test-1' },
      })
    );
    assert(typeof htmlWithMinimal === 'string', 'Must render minimal scene');

    // 2. Adversarial: What happens if scene is undefined?
    try {
      renderToStaticMarkup(React.createElement(StoryboardSceneCard as any, {}));
    } catch (err: any) {
      throw new Error(`CRASH_ON_UNDEFINED_PROP: StoryboardSceneCard crashed when scene prop was undefined: ${err.message}`);
    }
  });

  // ============================================================================
  // Suite D: Adversarial Input Boundaries (toMediaUrl, Presets, Stages)
  // ============================================================================
  console.log('\n--- 🎯 SUITE D: ADVERSARIAL INPUT BOUNDARIES ---');

  runTestCase('SUITE_D', 'toMediaUrl handles extreme edge cases and malformed paths', () => {
    assert.strictEqual(toMediaUrl(undefined), '', 'undefined -> empty string');
    assert.strictEqual(toMediaUrl(null), '', 'null -> empty string');
    assert.strictEqual(toMediaUrl(''), '', 'empty string -> empty string');

    // Relative and local windows paths
    const local1 = toMediaUrl('D:\\assets\\clip 1.mp4');
    assert(local1.startsWith('vanhmedia://local/'), 'Must use custom protocol');
    assert(local1.includes('clip%201.mp4') || local1.includes('clip 1.mp4') || local1.includes('D%3A%2Fassets'), 'Must encode URL path');

    // File protocol stripping
    const fileProto = toMediaUrl('file:///C:/Users/test/media.png');
    assert(!fileProto.includes('file:///'), 'Must strip file:/// scheme');
    assert(fileProto.startsWith('vanhmedia://local/'), 'Must prepend vanhmedia://local/');

    // Web URLs preserved untouched
    const webUrl = 'https://storage.googleapis.com/test-bucket/video.mp4?alt=media&token=123';
    assert.strictEqual(toMediaUrl(webUrl), webUrl, 'HTTPS URL must be preserved untouched');

    // Data URI preserved
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ...';
    assert.strictEqual(toMediaUrl(dataUri), dataUri, 'Data URI must be preserved untouched');
  });

  runTestCase('SUITE_D', 'STAGES satisfies Contract 6 stage sequencing', () => {
    assert.strictEqual(STAGES.length, 8, 'Must have exactly 8 stages');
    for (let i = 0; i < 8; i++) {
      assert.strictEqual(STAGES[i].id, i + 1, `Stage ${i + 1} id must match sequence`);
      assert(typeof STAGES[i].name === 'string' && STAGES[i].name.length > 0, `Stage ${i + 1} name must be non-empty`);
      assert(typeof STAGES[i].icon === 'object' || typeof STAGES[i].icon === 'function', `Stage ${i + 1} icon must be component`);
    }
  });

  runTestCase('SUITE_D', 'STYLE_PRESETS contains 6 cinematic presets with non-empty prompts', () => {
    assert.strictEqual(STYLE_PRESETS.length, 6, 'Must contain 6 presets');
    for (const preset of STYLE_PRESETS) {
      assert(preset.id.length > 0, 'Preset id must not be empty');
      assert(preset.name.length > 0, 'Preset name must not be empty');
      assert(preset.sampleBg.length > 20, 'Preset sampleBg must be detailed prompt');
    }
  });

  // ============================================================================
  // Suite E: Anti-Facade & Genuine Integration in AutoPilotView.tsx
  // ============================================================================
  console.log('\n--- 🔍 SUITE E: ANTI-FACADE & GENUINE INTEGRATION AUDIT ---');

  runTestCase('SUITE_E', 'AutoPilotView.tsx genuinely renders all primary subcomponents in JSX', () => {
    const viewContent = fs.readFileSync(autopilotViewPath, 'utf8');

    // Verify subcomponent tags are present in JSX
    assert(viewContent.includes('<AutoPilotHeader'), 'AutoPilotHeader must be rendered in AutoPilotView');
    assert(viewContent.includes('<IdeaListPanel'), 'IdeaListPanel must be rendered in AutoPilotView');
    assert(viewContent.includes('<PipelineTrackerPanel'), 'PipelineTrackerPanel must be rendered in AutoPilotView');
    assert(viewContent.includes('<CharacterStudioPanel'), 'CharacterStudioPanel must be rendered in AutoPilotView');
    assert(viewContent.includes('<StoryboardGridPanel'), 'StoryboardGridPanel must be rendered in AutoPilotView');
    assert(viewContent.includes('<MediaLightboxModal'), 'MediaLightboxModal must be rendered in AutoPilotView');
    assert(viewContent.includes('<AdvancedInfrastructureDrawer'), 'AdvancedInfrastructureDrawer must be rendered in AutoPilotView');

    // Verify StoryboardGridPanel renders StoryboardSceneCard
    const gridPath = path.join(autopilotDir, 'StoryboardGridPanel.tsx');
    const gridContent = fs.readFileSync(gridPath, 'utf8');
    assert(gridContent.includes('<StoryboardSceneCard'), 'StoryboardGridPanel must compose StoryboardSceneCard');
  });

  runTestCase('SUITE_E', 'AutoPilotView passes genuine state & handlers (not static stubs)', () => {
    const viewContent = fs.readFileSync(autopilotViewPath, 'utf8');

    // Check AutoPilotHeader wiring
    assert(viewContent.includes('projectName={projectName}'), 'Header must bind to projectName variable');
    assert(viewContent.includes('isFlowWindowOpen={isFlowWindowOpen}'), 'Header must bind to flow window state');
    assert(viewContent.includes('onOpenAdvancedDrawer={() => setIsAdvancedDrawerOpen(true)}'), 'Header must wire advanced drawer trigger');

    // Check AdvancedInfrastructureDrawer wiring
    assert(viewContent.includes('isOpen={isAdvancedDrawerOpen}'), 'Drawer must bind to isAdvancedDrawerOpen state');
    assert(viewContent.includes('onClose={() => setIsAdvancedDrawerOpen(false)}'), 'Drawer must bind to onClose');

    // Check PipelineTrackerPanel wiring
    assert(viewContent.includes('session={session}'), 'Pipeline tracker must receive session state');
    assert(viewContent.includes('onApproveStage={handleApproveStage}'), 'Pipeline tracker must receive approve handler');

    // Check StoryboardGridPanel wiring
    assert(viewContent.includes('selectedShotIds={selectedShotIds}'), 'Grid panel must receive selectedShotIds');
    assert(viewContent.includes('onPreviewMedia={setPreviewMedia}'), 'Grid panel must wire media lightbox preview');
  });

  // ============================================================================
  // Summary
  // ============================================================================
  console.log('\n================================================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`📊 ADVERSARIAL TEST SUMMARY:`);
  console.log(`   Total Inquiries: ${total}`);
  console.log(`   Passed:          ${passed} ✅`);
  console.log(`   Failed:          ${failed} ❌`);
  console.log(`   Pass Rate:       ${((passed / total) * 100).toFixed(1)}%`);
  console.log('================================================================================\n');

  if (failed > 0) {
    console.log('⚠️ FAILURES ENCOUNTERED:');
    for (const f of results.filter((r) => !r.passed)) {
      console.log(`   - [${f.category}] ${f.name}: ${f.error}`);
    }
  }

  // Return execution code
  process.exit(failed > 0 ? 1 : 0);
}

void runAdversarialSuite();
