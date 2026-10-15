import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('extension/background.js', 'utf8');
const fn = source.slice(source.indexOf('async function ensureTabInProject('), source.indexOf('\nasync function runBatchRpc('));
async function main() {
  for (const active of [false, true]) {
    const userTab = { id: 1, active, url: 'https://labs.google/fx/vi/tools/flow/project/user-project-123' };
    const tabs = new Map<number, any>([[1, { ...userTab }]]);
    const owned = new Map();
    let created = 10;
    const touched: number[] = [];
    const context: any = {
      automationOwnedTabs: owned,
      extractProjectIdFromUrl: (url: string) => url?.match(/\/project\/([^/?]+)/)?.[1] || null,
      isValidProjectId: (id: string) => Boolean(id), log() {}, warn() {},
      setTimeout: (callback: Function) => { callback(); return 0; }, waitForTabReady: async () => {},
      chrome: { tabs: {
        create: async ({ url }: any) => { const tab = { id: ++created, url, active: false }; tabs.set(tab.id, tab); return { ...tab }; },
        update: async (id: number, data: any) => { touched.push(id); Object.assign(tabs.get(id), data); },
        get: async (id: number) => ({ ...tabs.get(id) }),
      }, scripting: { executeScript: async ({ target }: any) => {
        touched.push(target.tabId);
        tabs.get(target.tabId).url = 'https://labs.google/fx/vi/tools/flow/project/audit-new-project';
        return [{ result: true }];
      } } },
    };
    vm.createContext(context); vm.runInContext(fn + '\nthis.ensure = ensureTabInProject;', context);
    const result = await context.ensure({ ...userTab }, undefined, true);
    assert.equal(result.projectId, 'audit-new-project');
    assert.notEqual(result.tab.id, userTab.id);
    assert.deepEqual(tabs.get(1), userTab);
    assert.equal(touched.includes(1), false, 'Background manual tabs are protected as well as active tabs');
    assert.ok(owned.has(result.tab.id));
    const existing = await context.ensure({ ...userTab }, 'audit-existing-project', false);
    assert.notEqual(existing.tab.id, 1);
    assert.deepEqual(tabs.get(1), userTab);
  }
  console.log('PASS: create project and navigate to another project never mutate active or background unowned tabs');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
