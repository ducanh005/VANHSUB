import assert from 'assert';
import { ChromeManager } from '../main/ai-studio/chatgpt/ChromeManager';
import { ChatGptCdpClient } from '../main/ai-studio/chatgpt/ChatGptCdpClient';

async function run() {
  console.log('Testing ChromeManager & ChatGptCdpClient...');

  // 1. ChromeManager tests
  const chromeMgr = ChromeManager.getInstance();
  const chromePath = chromeMgr.detectChromePath();
  console.log('Detected Chrome Path:', chromePath);
  assert(chromePath && chromePath.toLowerCase().includes('chrome.exe'), 'Chrome path must point to chrome.exe');

  const profileDir = chromeMgr.getProfileDir();
  console.log('Profile Dir:', profileDir);
  assert(profileDir.includes('chrome_chatgpt_profile'), 'Profile dir must include chrome_chatgpt_profile');

  const alive = await chromeMgr.isPortAlive(9223, 200);
  console.log('Port 9223 alive:', alive);
  assert.strictEqual(alive, false, 'Port 9223 should be initially free');

  let port9222Threw = false;
  try {
    await chromeMgr.launchChrome({ port: 9222 });
  } catch (err: any) {
    port9222Threw = true;
    assert(err.message.includes('9222'), 'Error must mention port 9222');
  }
  assert(port9222Threw, 'ChromeManager.launchChrome must throw on port 9222');
  console.log('✓ ChromeManager port 9222 guard verified');

  // 2. ChatGptCdpClient tests
  const cdpClient = ChatGptCdpClient.getInstance();
  assert.strictEqual(cdpClient.isConnected(), false, 'CDP client should not be connected initially');

  let cdpPort9222Threw = false;
  try {
    await cdpClient.connect(9222);
  } catch (err: any) {
    cdpPort9222Threw = true;
    assert(err.message.includes('9222'), 'Error must mention port 9222');
  }
  assert(cdpPort9222Threw, 'ChatGptCdpClient.connect must throw on port 9222');
  console.log('✓ ChatGptCdpClient port 9222 guard verified');

  await cdpClient.disconnect();
  console.log('✓ ChatGptCdpClient disconnect lifecycle verified');

  console.log('ALL CHROME & CDP TESTS PASSED! ✅');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
