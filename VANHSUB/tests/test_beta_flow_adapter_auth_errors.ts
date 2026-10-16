import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vanhsub-beta-flow-'));
  process.env.VANHSUB_SETTINGS_DIR=root;
  const {SettingsStore}=await import('../main/store/settingsStore');
  const {GoogleFlowAdapter}=await import('../main/workflow/adapters/GoogleFlowAdapter');
  const {GoogleVeoSessionManager}=await import('../main/veo/GoogleVeoSessionManager');
  const {GoogleVeoAntiSpamGuard}=await import('../main/veo/GoogleVeoAntiSpamGuard');
  const {FlowBridgeServer}=await import('../main/workflow/flow-engine/rpc/FlowBridgeServer');
  const session=GoogleVeoSessionManager.getInstance(), guard=GoogleVeoAntiSpamGuard.getInstance(), bridge=FlowBridgeServer.getInstance();
  const original={get:SettingsStore.get,cookie:session.getEffectiveCookieString,video:session.generateVideoViaBrowserContext,image:session.generateImageViaBrowserContext,validate:session.validateSession,connected:bridge.isConnected,lock:guard.acquireLockAsync,jitter:guard.applyHumanJitter,release:guard.releaseLock};
  let connected=true, videoCalls=0;
  try {
    SettingsStore.get=((key:string)=>key==='veoMode'?'free_session':undefined) as any;
    session.getEffectiveCookieString=async()=>'';
    bridge.isConnected=()=>connected;
    session.generateVideoViaBrowserContext=async()=>{videoCalls++;return {error:'FLOW_PROJECT_REQUIRED',errorDetail:'FLOW_PROJECT_REQUIRED: Link a test project'};};
    session.generateImageViaBrowserContext=async()=>({error:'BLOCKED_REQUIRES_USER',errorDetail:'BLOCKED_REQUIRES_USER: Google requires verification'});
    session.validateSession=async()=>({valid:true,status:'active',detail:'fixture',lastChecked:Date.now()});
    guard.acquireLockAsync=async()=>{};guard.applyHumanJitter=async()=>{};guard.releaseLock=()=>{};
    const adapter=new GoogleFlowAdapter();
    const ctx={tempDir:root,exportDir:root,nodeId:'beta',workflowId:'beta',isCancelled:()=>false,onProgress:()=>{}};
    await assert.rejects((adapter as any).callFreeSessionVeo({prompt:'test'},path.join(root,'video.mp4'),ctx),/FLOW_PROJECT_REQUIRED: Link a test project/);
    assert.equal(videoCalls,1,'Authenticated Chrome bridge does not require copying Chrome cookies into Electron');
    connected=false;
    await assert.rejects((adapter as any).callFreeSessionVeo({prompt:'test'},path.join(root,'video.mp4'),ctx),/Chưa có phiên đăng nhập/);
    assert.equal(videoCalls,1,'Unauthenticated sessions cannot reach the generation transport');
    await assert.rejects(adapter.generateImage({prompt:'test'},ctx),/BLOCKED_REQUIRES_USER: Google requires verification/);
    assert.equal(fs.existsSync(path.join(root,'video.mp4')),false);
    console.log('PASS (offline regression): authenticated bridge video routing; unpaired rejection; image/video preserve actionable provider errors');
  } finally {
    SettingsStore.get=original.get;session.getEffectiveCookieString=original.cookie;session.generateVideoViaBrowserContext=original.video;session.generateImageViaBrowserContext=original.image;session.validateSession=original.validate;bridge.isConnected=original.connected;guard.acquireLockAsync=original.lock;guard.applyHumanJitter=original.jitter;guard.releaseLock=original.release;
    fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
