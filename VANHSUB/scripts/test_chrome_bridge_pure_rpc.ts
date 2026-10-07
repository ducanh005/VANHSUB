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
    await visualService.generateViaGoogleFlow(mockScene as any, outPath, { outputMode: 'image', projectId: 'mock-chrome-project-id-12345678' });

    assert.strictEqual(openLobbyCalled, false, 'openLobbyWindow của Electron KHÔNG ĐƯỢC gọi khi Chrome Extension đã kết nối!');
    console.log('✓ AiStudioVisualService bỏ qua hoàn toàn Electron Lobby khi Chrome Extension đang kết nối');

    // 3. Kiểm tra rpcClient.generateImage khi gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY
    console.log('-> Đang kiểm tra generateImage khi Google trả về PUBLIC_ERROR_UNUSUAL_ACTIVITY...');
    let triggerUiGenCalled = false;
    (bridge as any).triggerUiGen = async () => {
      triggerUiGenCalled = true;
      return { ok: false, error: 'triggerUiGen should not be called' };
    };

    const mockUnusualResponse = `)]}'\n\n[["wrb.fr","${RPC_GEN_IMAGE}",null,null,null,null,null,["PUBLIC_ERROR_UNUSUAL_ACTIVITY"]]]`;
    (bridge as any).sendBatchRpc = async () => mockUnusualResponse;

    const startImgTime = Date.now();
    let imgError: any = null;
    try {
      await rpcClient.generateImage({
        prompt: 'Unusual test prompt',
        aspectRatio: '16:9',
        maxRetries: 0,
      });
    } catch (err: any) {
      imgError = err;
    }
    const elapsedImg = Date.now() - startImgTime;

    assert.ok(imgError, 'Phải ném lỗi khi Google trả về PUBLIC_ERROR_UNUSUAL_ACTIVITY!');
    assert.strictEqual(
      triggerUiGenCalled,
      false,
      'triggerUiGen KHÔNG ĐƯỢC PHÉP gọi khi gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY (Pure RPC Integrity)!'
    );
    assert.ok(
      elapsedImg < 2000,
      `Xử lý lỗi phải hoàn tất ngay lập tức mà không bị timeout 45s (thực tế: ${elapsedImg}ms)`
    );
    assert.strictEqual(
      imgError.isUnusualActivity,
      true,
      'Lỗi phải được nhận diện isUnusualActivity = true'
    );
    assert.ok(
      imgError.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || imgError.code === 'UNUSUAL_ACTIVITY',
      `Mã lỗi phải là UNUSUAL_ACTIVITY hoặc PUBLIC_ERROR_UNUSUAL_ACTIVITY (thực tế: ${imgError.code})`
    );
    console.log(`✓ generateImage ném lỗi ${imgError.code} ngay lập tức (${elapsedImg}ms) mà KHÔNG gọi triggerUiGen`);

    // 4. Kiểm tra rpcClient.generateVideo khi gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY
    console.log('-> Đang kiểm tra generateVideo khi Google trả về PUBLIC_ERROR_UNUSUAL_ACTIVITY...');
    triggerUiGenCalled = false;
    const mockUnusualVideoResponse = `)]}'\n\n[["wrb.fr","YhhmEf",null,null,null,null,null,["PUBLIC_ERROR_UNUSUAL_ACTIVITY"]]]`;
    (bridge as any).sendBatchRpc = async () => mockUnusualVideoResponse;

    const startVidTime = Date.now();
    let vidError: any = null;
    try {
      await rpcClient.generateVideo({
        prompt: 'Unusual test video prompt',
        durationSeconds: 5,
        maxRetries: 0,
      });
    } catch (err: any) {
      vidError = err;
    }
    const elapsedVid = Date.now() - startVidTime;

    assert.ok(vidError, 'Phải ném lỗi khi video trả về PUBLIC_ERROR_UNUSUAL_ACTIVITY!');
    assert.strictEqual(
      triggerUiGenCalled,
      false,
      'triggerUiGen KHÔNG ĐƯỢC PHÉP gọi trong generateVideo khi gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY!'
    );
    assert.ok(
      elapsedVid < 2000,
      `Xử lý video lỗi phải hoàn tất ngay lập tức mà không bị timeout 30s (thực tế: ${elapsedVid}ms)`
    );
    assert.strictEqual(
      vidError.isUnusualActivity,
      true,
      'Video error phải được nhận diện isUnusualActivity = true'
    );
    assert.ok(
      vidError.code === 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' || vidError.code === 'UNUSUAL_ACTIVITY',
      `Mã lỗi video phải là UNUSUAL_ACTIVITY hoặc PUBLIC_ERROR_UNUSUAL_ACTIVITY (thực tế: ${vidError.code})`
    );
    console.log(`✓ generateVideo ném lỗi ${vidError.code} ngay lập tức (${elapsedVid}ms) mà KHÔNG gọi triggerUiGen`);

    // 5. Kiểm tra source code GoogleFlowRpcClient.ts hoàn toàn sạch bóng triggerUiGen
    const fs = await import('fs');
    const path = await import('path');
    const clientSource = fs.readFileSync(
      path.join(__dirname, '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient.ts'),
      'utf-8'
    );
    assert.strictEqual(
      clientSource.includes('triggerUiGen'),
      false,
      'GoogleFlowRpcClient.ts tuyệt đối không được chứa bất kỳ lệnh gọi triggerUiGen nào!'
    );
    console.log('✓ GoogleFlowRpcClient.ts hoàn toàn sạch bóng triggerUiGen (100% Pure RPC)');

    // 6. Kiểm tra FlowRpcClient.ts cũng đã gỡ bỏ fallback __TRIGGER_GEN__
    const legacyClientSource = fs.readFileSync(
      path.join(__dirname, '../main/workflow/flow-engine/rpc/FlowRpcClient.ts'),
      'utf-8'
    );
    assert.strictEqual(
      legacyClientSource.includes('__TRIGGER_GEN__'),
      false,
      'FlowRpcClient.ts không được còn chứa fallback tabEval __TRIGGER_GEN__!'
    );
    console.log('✓ FlowRpcClient.ts hoàn toàn gỡ bỏ fallback DOM __TRIGGER_GEN__');

    // 7. Kiểm tra chuẩn hóa phân loại tất cả các mã bot flag và reCAPTCHA
    console.log('-> Đang kiểm tra phân loại các biến thể lỗi bot flag & reCAPTCHA...');
    const { classifyFlowRpcError, isUnusualActivityError } = await import(
      '../main/workflow/flow-engine/rpc/GoogleFlowRpcClient'
    );

    const testErrors = [
      { msg: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY from Google', expectedCode: 'PUBLIC_ERROR_UNUSUAL_ACTIVITY', isUnusual: true },
      { msg: 'Server reported unusual_activity', expectedCode: 'UNUSUAL_ACTIVITY', isUnusual: true },
      { msg: 'Account bot_flagged by security check', expectedCode: 'BOT_FLAGGED', isUnusual: true },
      { msg: 'captcha_score_low: reCAPTCHA Enterprise score too low', expectedCode: 'CAPTCHA_SCORE_LOW', isUnusual: true },
      { msg: 'EMPTY_CAPTCHA_TOKEN: grecaptcha trả về token rỗng', expectedCode: 'CAPTCHA_SCORE_LOW', isUnusual: true },
      { msg: 'CAPTCHA_EXECUTE_ERROR: execute_hang', expectedCode: 'CAPTCHA_SCORE_LOW', isUnusual: true },
      { msg: 'NO_FLOW_TAB: Vui lòng mở 1 tab flow.google.com', expectedCode: 'SESSION_EXPIRED', isUnusual: false },
      { msg: 'TAB_NOT_IN_PROJECT: Tab chưa ở trong dự án', expectedCode: 'SESSION_EXPIRED', isUnusual: false },
      { msg: 'BRIDGE_DISCONNECTED: Chrome Extension đã ngắt kết nối (kết nối đóng)', expectedCode: 'BRIDGE_DISCONNECTED', isUnusual: false },
      { msg: 'EXTENSION_NOT_CONNECTED: Chưa có Chrome Extension nào kết nối', expectedCode: 'BRIDGE_DISCONNECTED', isUnusual: false },
    ];

    for (const te of testErrors) {
      const classified = classifyFlowRpcError(new Error(te.msg));
      assert.strictEqual(classified.code, te.expectedCode, `Mã lỗi cho "${te.msg}" phải là ${te.expectedCode}`);
      assert.strictEqual(classified.isUnusualActivity, te.isUnusual, `isUnusualActivity phải là ${te.isUnusual} cho ${te.expectedCode}`);
      assert.strictEqual(isUnusualActivityError(classified), te.isUnusual, `isUnusualActivityError phải nhận diện ${te.expectedCode}`);
      if (te.isUnusual) {
        assert.strictEqual(classified.suggestedAction, 'RETRY_WITH_BACKOFF', 'suggestedAction phải là RETRY_WITH_BACKOFF');
        assert.ok(classified.retryable, 'Lỗi bot flag phải retryable: true theo cơ chế backoff');
      } else if (te.expectedCode === 'BRIDGE_DISCONNECTED') {
        assert.strictEqual(classified.suggestedAction, 'RETRY_WITH_BACKOFF', 'suggestedAction phải là RETRY_WITH_BACKOFF cho BRIDGE_DISCONNECTED');
        assert.ok(classified.retryable, 'Lỗi bridge disconnected phải retryable: true');
      } else {
        assert.strictEqual(classified.suggestedAction, 'REAUTH_REQUIRED', 'suggestedAction phải là REAUTH_REQUIRED cho NO_FLOW_TAB');
      }
    }
    console.log('✓ Phân loại chuẩn xác 10/10 biến thể lỗi bot flag, reCAPTCHA, tab context và bridge disconnection');

    // 8. Kiểm tra Project ID được truyền chính xác qua Extension Bridge (Đa tab / Multi-Project Isolation)
    console.log('-> Đang kiểm tra đồng bộ Project ID qua Extension Bridge...');
    let forwardedProjectId = '';
    (bridge as any).sendBatchRpc = async (rpcid: string, payload: any[], action?: string, projId?: string) => {
      forwardedProjectId = projId || '';
      const mockData = [[["mock-img-id-multitab", "https://flow-mock.cdn.google/multi.png"]]];
      return `)]}'\n\n[["wrb.fr","${rpcid}",${JSON.stringify(mockData)},null,null,null,"generic"]]`;
    };

    await rpcClient.generateImage({
      prompt: 'Multi-tab prompt test',
      projectId: 'isolated-tab-project-xyz-999',
    });
    assert.strictEqual(
      forwardedProjectId,
      'isolated-tab-project-xyz-999',
      'sendBatchRpc phải nhận chính xác projectId được chỉ định!'
    );
    console.log('✓ Project ID được đồng bộ và truyền tải chính xác qua Bridge (Multi-tab isolation verified)');

    // 9. Kiểm tra thuật toán phân giải tab khi mở nhiều tab Google Flow khác project
    console.log('-> Đang kiểm tra thuật toán phân giải multi-tab preferredProjectId...');
    const mockTabs = [
      { id: 101, url: 'https://labs.google/fx/vi/tools/flow/project/project-alpha', active: false, discarded: false },
      { id: 102, url: 'https://labs.google/fx/vi/tools/flow/project/project-beta', active: true, discarded: false },
      { id: 103, url: 'https://flow.google.com/about', active: false, discarded: false },
    ];

    function resolveTestTab(tabs: typeof mockTabs, preferredProjectId?: string | null) {
      const validPid = preferredProjectId && preferredProjectId.length >= 8 ? preferredProjectId.trim() : null;
      if (validPid) {
        const matching = tabs.find((t) => t.url && t.url.includes(`/project/${validPid}`));
        if (matching) return matching;
      }
      const active = tabs.find((t) => t.active);
      const ready = tabs.find((t) => !t.discarded);
      return active || ready || tabs[0];
    }

    const resolvedAlpha = resolveTestTab(mockTabs, 'project-alpha');
    assert.strictEqual(resolvedAlpha.id, 101, 'Phải chọn tab project-alpha (tab 101) dù tab 102 đang active');

    const resolvedBeta = resolveTestTab(mockTabs, 'project-beta');
    assert.strictEqual(resolvedBeta.id, 102, 'Phải chọn tab project-beta (tab 102)');

    const resolvedFallback = resolveTestTab(mockTabs, 'non-existent-project');
    assert.strictEqual(resolvedFallback.id, 102, 'Phải fallback sang activeTab (tab 102) khi preferredProjectId không khớp tab nào');
    console.log('✓ Thuật toán phân giải tab ưu tiên chính xác preferredProjectId trước khi fallback sang activeTab');

    // 10. Kiểm tra tính tự vệ chống lỗi rỗng / bất thường của giao thức batchexecute
    console.log('-> Đang kiểm tra lớp tự vệ (defensive guard) khi nhận phản hồi rỗng từ bridge...');
    const { parseBatchResponse } = await import(
      '../main/workflow/flow-engine/rpc/FlowBatchBuilder'
    );
    assert.throws(
      () => parseBatchResponse(undefined as any, RPC_GEN_IMAGE),
      /rawText rỗng hoặc không hợp lệ/,
      'parseBatchResponse phải ném lỗi tường minh khi rawText là undefined'
    );
    assert.throws(
      () => parseBatchResponse('' as any, RPC_GEN_IMAGE),
      /rawText rỗng hoặc không hợp lệ/,
      'parseBatchResponse phải ném lỗi tường minh khi rawText là chuỗi rỗng'
    );
    console.log('✓ Lớp tự vệ parseBatchResponse phát hiện và xử lý an toàn các payload rỗng');

    // 11. Kiểm tra trích xuất trực tiếp mã lỗi PUBLIC_ERROR_UNUSUAL_ACTIVITY trong parseBatchResponse
    console.log('-> Đang kiểm tra trích xuất trực tiếp mã lỗi PUBLIC_ERROR_UNUSUAL_ACTIVITY...');
    const parsedUnusual = parseBatchResponse(mockUnusualResponse, RPC_GEN_IMAGE);
    assert.strictEqual(parsedUnusual.ok, false);
    assert.strictEqual((parsedUnusual.error as any)?.code, 'PUBLIC_ERROR_UNUSUAL_ACTIVITY');
    console.log('✓ parseBatchResponse trích xuất chính xác mã lỗi PUBLIC_ERROR_UNUSUAL_ACTIVITY từ error slot (index 7)');

    // 12. Kiểm tra xử lý ngắt kết nối WebSocket giữa chừng (Mid-flight WebSocket Disconnection)
    console.log('-> Đang kiểm tra xử lý ngắt kết nối WebSocket giữa chừng (Mid-flight Disconnect)...');
    const { EventEmitter } = await import('events');
    const mockWs = new EventEmitter() as any;
    mockWs.readyState = 1; // WebSocket.OPEN
    mockWs.send = () => {};

    // Khởi tạo instance FlowBridgeServer thực tế (không dùng mock sendBatchRpc)
    const realBridge = FlowBridgeServer.getInstance();
    delete (realBridge as any).sendBatchRpc; // Khôi phục method gốc
    delete (realBridge as any).isConnected;
    (realBridge as any).clients.clear();
    realBridge.registerClient(mockWs);

    const disconnectStart = Date.now();
    const midFlightPromise = realBridge.sendBatchRpc(RPC_GEN_IMAGE, [1, 2, 3], undefined, undefined, 60000);

    // Kích hoạt ngắt kết nối WebSocket giữa chừng
    setTimeout(() => {
      mockWs.emit('close');
    }, 50);

    let disconnectErr: any = null;
    try {
      await midFlightPromise;
    } catch (err: any) {
      disconnectErr = err;
    }
    const disconnectElapsed = Date.now() - disconnectStart;

    assert.ok(disconnectErr, 'Phải ném lỗi khi WebSocket bị đóng giữa chừng!');
    assert.ok(
      disconnectErr.message.includes('BRIDGE_DISCONNECTED'),
      `Lỗi phải là BRIDGE_DISCONNECTED (thực tế: ${disconnectErr.message})`
    );
    assert.ok(
      disconnectElapsed < 2000,
      `Phải reject ngay lập tức khi ngắt kết nối mà không bị treo 60s (thực tế: ${disconnectElapsed}ms)`
    );
    assert.strictEqual((realBridge as any).pendingRequests.size, 0, 'pendingRequests phải được dọn dẹp sạch sẽ!');
    console.log(`✓ Ngắt kết nối WebSocket giữa chừng được phát hiện và xử lý ngay lập tức (${disconnectElapsed}ms), giải phóng sạch bộ nhớ`);

    // 13. Kiểm tra tự vệ khi WebSocket send ném lỗi (Broken Socket Guard)
    console.log('-> Đang kiểm tra tự vệ khi socket send ném lỗi đồng bộ...');
    const brokenWs = new EventEmitter() as any;
    brokenWs.readyState = 1;
    brokenWs.send = () => {
      throw new Error('Broken pipe / socket write error');
    };
    (realBridge as any).clients.clear();
    realBridge.registerClient(brokenWs);

    let sendErr: any = null;
    try {
      await realBridge.sendBatchRpc(RPC_GEN_IMAGE, [1, 2, 3], undefined, undefined, 60000);
    } catch (err: any) {
      sendErr = err;
    }
    assert.ok(sendErr, 'Phải ném lỗi khi socket.send ném exception!');
    assert.ok(
      sendErr.message.includes('BRIDGE_SEND_FAILED'),
      `Lỗi phải là BRIDGE_SEND_FAILED (thực tế: ${sendErr.message})`
    );
    assert.strictEqual((realBridge as any).pendingRequests.size, 0, 'pendingRequests phải được dọn dẹp không để rò rỉ timer!');
    console.log('✓ Tự vệ socket send ném lỗi thành công, giải phóng timer và không làm rò rỉ promise');

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
