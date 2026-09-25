import assert from 'assert';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';
import { GoogleFlowRpcClient } from '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient';
import { AiStudioVisualService } from '../main/ai-studio/services/AiStudioVisualService';
import { GoogleVeoSessionManager } from '../main/veo/GoogleVeoSessionManager';
import { RPC_GEN_IMAGE, CAPTCHA_ACTION_IMAGE } from '../main/workflow/flow-engine/rpc/FlowBatchConstants';

async function runTest() {
  console.log('=== TEST: Chrome Extension Pure RPC & Electron Lobby Bypass ===');

  const bridge = FlowBridgeServer.getInstance();
  let sendBatchRpcCalled = false;
  let tabEvalCalled = false;
  let capturedRpcId = '';
  let capturedAction: any = '';

  // Mock bridge methods
  (bridge as any).isConnected = () => true;
  (bridge as any).getFlowTabInfo = async () => ({
    connected: true,
    hasFlowTab: true,
    projectId: 'mock-chrome-project-id-12345678',
  });
  (bridge as any).sendBatchRpc = async (rpcid: string, payload: any[], action?: string, projId?: string) => {
    sendBatchRpcCalled = true;
    capturedRpcId = rpcid;
    capturedAction = action;
    // Mock response batch format
    const mockData = [[["mock-image-media-id-999", "https://flow-mock.cdn.google/image999.png"]]];
    return `)]}'\n\n[["wrb.fr","${rpcid}",${JSON.stringify(mockData)},null,null,null,"generic"]]`;
  };
  (bridge as any).tabEval = async (code: string) => {
    if (code.includes('__TRIGGER_GEN__')) {
      tabEvalCalled = true;
    }
    return { ok: true };
  };

  // Track if GoogleVeoSessionManager.openLobbyWindow was called
  const sessionMgr = GoogleVeoSessionManager.getInstance();
  let openLobbyCalled = false;
  const originalOpenLobby = sessionMgr.openLobbyWindow;
  sessionMgr.openLobbyWindow = async () => {
    openLobbyCalled = true;
    return {} as any;
  };

  try {
    const rpcClient = new GoogleFlowRpcClient();

    // 1. Kiểm tra rpcClient.generateImage gọi sendBatchRpc chứ KHÔNG gọi tabEval
    console.log('-> Đang kiểm tra generateImage qua Chrome Bridge...');
    const result = await rpcClient.generateImage({
      prompt: 'A cute watercolor cat',
      aspectRatio: '16:9',
    });

    assert.strictEqual(sendBatchRpcCalled, true, 'sendBatchRpc phải được gọi!');
    assert.strictEqual(tabEvalCalled, false, 'tabEval (__TRIGGER_GEN__) KHÔNG ĐƯỢC PHÉP gọi!');
    assert.strictEqual(capturedRpcId, RPC_GEN_IMAGE, 'RPC ID phải là ogiZ0b');
    assert.strictEqual(capturedAction, CAPTCHA_ACTION_IMAGE, 'Action phải là IMAGE_GENERATION');
    assert.strictEqual(result.images.length, 1);
    assert.strictEqual(result.images[0].mediaId, 'mock-image-media-id-999');
    console.log('✓ generateImage hoạt động theo Pure Web RPC hoàn hảo, không còn phụ thuộc DOM .ProseMirror');

    // 2. Kiểm tra AiStudioVisualService bỏ qua mở cửa sổ Electron Lobby khi Chrome Extension đã kết nối
    console.log('-> Đang kiểm tra AiStudioVisualService.generateViaGoogleFlow bỏ qua Electron Lobby...');
    openLobbyCalled = false;

    // Giả lập downloadMediaAsset để không fetch mạng
    const visualService = AiStudioVisualService.getInstance();
    visualService.setRpcClient(rpcClient);
    (visualService as any).downloadMediaAsset = async (url: string, dest: string) => dest;
    (visualService as any).validateMediaFile = () => true;

    const mockScene = {
      id: 'sc_test_1',
      shotId: 'shot_1',
      motionType: 'ken_burns' as const,
      lineText: 'A cute watercolor cat',
      visualPrompt: 'A cute watercolor cat in sunlit garden',
      order: 1,
      durationMs: 4000,
    };

    const outPath = 'D:/DEAN/DEAN/VANHSUB/temp_test_output.png';
    await visualService.generateViaGoogleFlow(mockScene as any, outPath, { outputMode: 'image' });

    assert.strictEqual(openLobbyCalled, false, 'openLobbyWindow của Electron KHÔNG ĐƯỢC gọi khi Chrome Extension đã kết nối!');
    console.log('✓ AiStudioVisualService bỏ qua hoàn toàn Electron Lobby khi Chrome Extension đang kết nối');

    console.log('\n================================================================');
    console.log('  TẤT CẢ CÁC BÀI TEST CHROME BRIDGE PURE RPC ĐỀU THÀNH CÔNG!');
    console.log('================================================================');
  } finally {
    sessionMgr.openLobbyWindow = originalOpenLobby;
  }
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
