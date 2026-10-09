import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { classifyFlowRpcError } from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';

async function main() {
  const source = fs.readFileSync('extension/background.js', 'utf8');
  const fn = source.slice(source.indexOf('async function ensureTabInProject('), source.indexOf('\nasync function runBatchRpc('));
  let url = 'https://labs.google/fx/vi/tools/flow/project/old-project-123';
  let clicks = 0;
  let rejectNavigation = false;
  const context: any = {
    extractProjectIdFromUrl: (value: string) => value?.match(/\/project\/([^/?]+)/)?.[1] || null,
    isValidProjectId: (value: string) => typeof value === 'string' && value.length >= 8,
    log() {}, warn() {},
    setTimeout: (callback: () => void) => { callback(); return 0; },
    waitForTabReady: async () => {},
    chrome: {
      tabs: {
        update: async (_id: number, data: any) => { if (!rejectNavigation) url = data.url; },
        get: async () => ({ id: 1, url }),
      },
      scripting: { executeScript: async ({ func }: any) => [{ result: func() }] },
    },
    document: {
      querySelector: () => { throw new Error('Must not pick an arbitrary existing project'); },
      querySelectorAll: () => [{ innerText: 'New project', click: () => { clicks++; url = 'https://labs.google/fx/vi/tools/flow/project/new-project-456'; } }],
    },
  };
  vm.createContext(context);
  vm.runInContext(fn + '\nthis.ensure = ensureTabInProject;', context);
  await assert.rejects(context.ensure({ id: 1, url }), /FLOW_PROJECT_REQUIRED/);
  const created = await context.ensure({ id: 1, url }, undefined, true);
  assert.equal(created.projectId, 'new-project-456');
  assert.equal(clicks, 1);
  const resumed = await context.ensure({ id: 1, url }, 'new-project-456');
  assert.equal(resumed.projectId, 'new-project-456');
  assert.equal(clicks, 1);
  rejectNavigation = true;
  await assert.rejects(context.ensure({ id: 1, url }, 'other-project-789'), /FLOW_PROJECT_MISMATCH/);
  await assert.rejects(context.ensure({ id: 1, url }, undefined, true), /FLOW_PROJECT_CREATE_FAILED/);
  for (const code of ['PUBLIC_ERROR_UNUSUAL_ACTIVITY', 'BOT_FLAGGED', 'CAPTCHA_SCORE_LOW']) {
    const error = classifyFlowRpcError(new Error(code));
    assert.equal(error.retryable, false);
    assert.equal(error.suggestedAction, 'ABORT_HALT');
  }
  assert.equal(classifyFlowRpcError(new Error('HTTP 429 too many requests')).retryable, true);
  const service = new AiStudioVisualService();
  service.setRpcClient({} as any);
  let requests = 0;
  service.generateViaGoogleFlow = async () => { requests++; throw new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY'); };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-flow-test-'));
  try {
    await assert.rejects(service.dispatchVisualAssets([{ id: 'scene-1', motionType: 'ken_burns' }] as any,
      { maxRetries: 3, backoffBaseMs: 0 }, temp), /Google Flow từ chối|PUBLIC_ERROR_UNUSUAL_ACTIVITY/);
    assert.equal(requests, 1, 'Khi gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY, không được retry mù quáng mà phải dừng ngay');
  } finally { fs.rmSync(temp, { recursive: true }); }
  console.log('PASS: project creation, resume, missing owner, mismatch, failed creation, 3 activity blocks non-retryable, rate-limit retry.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
