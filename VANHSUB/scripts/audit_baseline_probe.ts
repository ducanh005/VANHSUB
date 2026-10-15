import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vanhsub-audit-baseline-'));
  process.env.VANHSUB_SETTINGS_DIR = path.join(root, 'settings');
  process.env.VANHSUB_TASKS_DIR = path.join(root, 'tasks');
  process.env.VANHSUB_AI_STUDIO_DIR = path.join(root, 'studio');
  const originalTmpdir = os.tmpdir;
  os.tmpdir = () => root;
  try {
    const { SettingsStore } = await import('../main/store/settingsStore');
    const { getOrCreateProjectDir } = await import('../main/utils/projectFolder');
    const { WorkflowExecutionEngine } = await import('../main/workflow/executionEngine');
    const { WorkflowStorageManager } = await import('../main/workflow/WorkflowStorageManager');
    const output = path.join(root, 'output'); fs.mkdirSync(output);
    SettingsStore.set('exportDir', output);
    const first = getOrCreateProjectDir({ id: 'one', filePath: path.join(root, 'a', 'clip.mp4'), fileName: 'clip.mp4' });
    const second = getOrCreateProjectDir({ id: 'two', filePath: path.join(root, 'b', 'clip.mp4'), fileName: 'clip.mp4' });
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const engine = new WorkflowExecutionEngine();
    let jobDir = '';
    (engine as any).executeSingleNode = async (_node: any, _inputs: any, context: any) => {
      jobDir = context.tempDir;
      fs.writeFileSync(path.join(jobDir, 'in-flight.txt'), 'active workflow data');
      started(); await hold; return { out: 'finished' };
    };
    const running = engine.execute({ id: 'audit-job', name: 'Audit', nodes: [{ id: 'node', data: { nodeType: 'text-prompt', category: 'input', label: 'Test', config: {} } }], edges: [] }, () => {});
    await entered;
    await new Promise(resolve => setTimeout(resolve, 20));
    await WorkflowStorageManager.getInstance().cleanupOldTempFiles(0);
    const activeFilesDeleted = !fs.existsSync(path.join(jobDir, 'in-flight.txt'));
    release(); await running;
    console.log(JSON.stringify({ standardProjectCollision: first === second, cleanupDeletedRunningJob: activeFilesDeleted }, null, 2));
  } finally {
    os.tmpdir = originalTmpdir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
