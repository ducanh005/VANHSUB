/**
 * test_flowkit_standardization.ts
 *
 * Automated verification test suite for FlowKit Standardization of Chrome Extension Bridge:
 * - R1: reCAPTCHA Enterprise Invisible Widget Minting (resolveSitekey, ensureWidget, executeWithRetry with widgetId, captchaMintTail queue)
 * - R2: Preload Bundle & Web Accessible Resources (manifest.json v1.0.3, content.js dynamic injection)
 * - R3: Batch RPC Fetch Headers & Body Envelope (new URLSearchParams, minimal headers, no WAF-triggering headers)
 * - Integration: FlowBridgeServer handshake v1.0.3 & mintCaptcha method
 *
 * Run: npx tsx scripts/test_flowkit_standardization.ts
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';

// Helper to simulate a browser DOM environment for injected.js tests
function createMockBrowserEnv() {
  const listeners: Record<string, Function[]> = {};
  const elements: Record<string, any> = {};

  const doc = {
    getElementById(id: string) {
      return elements[id] || null;
    },
    createElement(tag: string) {
      const el: any = {
        tagName: tag.toUpperCase(),
        id: '',
        style: { cssText: '' },
        childNodes: [],
        hasChildNodes: () => (el.childNodes && el.childNodes.length > 0) || false,
        setAttribute: (k: string, v: string) => { el[k] = v; },
        remove: () => {
          if (el.id && elements[el.id]) delete elements[el.id];
        },
      };
      return el;
    },
    documentElement: {
      appendChild(child: any) {
        if (child.id) elements[child.id] = child;
      },
    },
    head: {
      appendChild(child: any) {
        if (child.id) elements[child.id] = child;
      },
    },
  };

  let renderCallArgs: any = null;
  let executeCallArgs: any = null;
  let nextWidgetId = 42;

  const grecaptcha = {
    enterprise: {
      ready: (fn: Function) => fn(),
      render: (host: any, opts: any) => {
        renderCallArgs = { host, opts };
        return nextWidgetId;
      },
      execute: async (widgetId: any, opts: any) => {
        executeCallArgs = { widgetId, opts };
        return `mock-token-for-widget-${widgetId}-${opts?.action || 'default'}`;
      },
    },
  };

  const win: any = {
    document: doc,
    grecaptcha,
    ___grecaptcha_cfg: {},
    addEventListener: (type: string, fn: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((f) => f !== fn);
      }
    },
    dispatchEvent: (event: any) => {
      const list = listeners[event.type] || [];
      for (const fn of list) {
        fn(event);
      }
    },
    fetch: async function (url: any, init: any) {
      return {
        ok: true,
        status: 200,
        clone: () => ({ text: async () => '{"status":"ok"}' }),
      };
    },
  };

  return {
    win,
    doc,
    elements,
    getRenderCallArgs: () => renderCallArgs,
    getExecuteCallArgs: () => executeCallArgs,
    setNextWidgetId: (id: number) => { nextWidgetId = id; },
    getListeners: (type: string) => listeners[type] || [],
  };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  TEST SUITE: FlowKit Standardization for Chrome Extension Bridge');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    total++;
    try {
      const res = fn();
      if (res && typeof (res as any).then === 'function') {
        return (res as any)
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err: any) => {
            console.error(`  ❌ ${name}`);
            console.error(err);
            process.exit(1);
          });
      }
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}`);
      console.error(err);
      process.exit(1);
    }
  }

  // ────────────────────────────────────────────────────────────
  // SUITE 1: R1 — injected.js Invisible Widget reCAPTCHA Minting
  // ────────────────────────────────────────────────────────────
  console.log('▶ SUITE 1: R1 — Invisible Widget reCAPTCHA Minting (injected.js)');

  const injectedPath = path.resolve(__dirname, '../extension/injected.js');
  const injectedCode = fs.readFileSync(injectedPath, 'utf8');

  test('injected.js code contains resolveSitekey, ensureWidget, executeWithRetry', () => {
    assert(injectedCode.includes('function resolveSitekey()'), 'injected.js phải chứa resolveSitekey');
    assert(injectedCode.includes('function ensureWidget('), 'injected.js phải chứa ensureWidget');
    assert(injectedCode.includes('function executeWithRetry('), 'injected.js phải chứa executeWithRetry');
    assert(injectedCode.includes('flowkit-recaptcha-host'), 'injected.js phải tạo/dùng #flowkit-recaptcha-host');
    assert(injectedCode.includes("size: 'invisible'"), "ensureWidget phải cấu hình size: 'invisible'");
    assert(injectedCode.includes('captchaMintTail'), 'injected.js phải dùng Promise queue captchaMintTail');
  });

  await test('resolveSitekey trích xuất sitekey động từ window.___grecaptcha_cfg.clients hoặc fallback', () => {
    // Test case 1: Fallback default sitekey
    const mock1 = createMockBrowserEnv();
    (global as any).window = mock1.win;
    (global as any).document = mock1.doc;

    // Load module fresh
    delete require.cache[require.resolve('../extension/injected.js')];
    const injected1 = require('../extension/injected.js');

    const key1 = injected1.resolveSitekey();
    assert.strictEqual(key1, '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV', 'Fallback sitekey không đúng');

    // Test case 2: Dynamic sitekey from cfg
    mock1.win.___grecaptcha_cfg = {
      clients: {
        '0': { sitekey: '6Lds_DYNAMIC_TEST_SITE_KEY_1234567890' },
      },
    };
    const key2 = injected1.resolveSitekey();
    assert.strictEqual(key2, '6Lds_DYNAMIC_TEST_SITE_KEY_1234567890', 'Phải trích xuất đúng sitekey từ clients');
  });

  await test('ensureWidget tạo thẻ #flowkit-recaptcha-host và gọi grecaptcha.enterprise.render với invisible size', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    const widgetId = await injected.ensureWidget('test-site-key-1');
    assert.strictEqual(widgetId, 42, 'widgetId trả về phải là 42');

    const host = mock.doc.getElementById('flowkit-recaptcha-host');
    assert(host, 'Thẻ #flowkit-recaptcha-host phải được tạo');
    assert.strictEqual(host.id, 'flowkit-recaptcha-host');
    assert(host.style.cssText.includes('position:fixed'), 'Host phải có CSS invisible fixed');
    assert(host.style.cssText.includes('left:-9999px'), 'Host phải ở tọa độ ngoài màn hình');

    const renderArgs = mock.getRenderCallArgs();
    assert(renderArgs, 'grecaptcha.enterprise.render phải được gọi');
    assert.strictEqual(renderArgs.host, host, 'Host element truyền vào render phải khớp');
    assert.strictEqual(renderArgs.opts.sitekey, 'test-site-key-1');
    assert.strictEqual(renderArgs.opts.size, 'invisible');
  });

  await test('executeWithRetry gọi grecaptcha.enterprise.execute bằng widgetId (KHÔNG truyền sitekey)', async () => {
    const mock = createMockBrowserEnv();
    mock.setNextWidgetId(999);
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    const token = await injected.executeWithRetry('sitekey-abc', 'IMAGE_GENERATION');
    assert(token.includes('mock-token-for-widget-999-IMAGE_GENERATION'), 'Token trả về phải chứa widgetId 999');

    const execArgs = mock.getExecuteCallArgs();
    assert(execArgs, 'grecaptcha.enterprise.execute phải được gọi');
    assert.strictEqual(execArgs.widgetId, 999, 'Tham số thứ nhất của execute PHẢI LÀ widgetId, TUYỆT ĐỐI KHÔNG ĐƯỢC LÀ sitekey!');
    assert.strictEqual(execArgs.opts.action, 'IMAGE_GENERATION', 'Action phải được truyền vào execute');
  });

  await test('mintCaptcha serialize các lượt gọi qua Promise queue captchaMintTail', async () => {
    const mock = createMockBrowserEnv();
    mock.setNextWidgetId(101);
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    const executionOrder: number[] = [];

    // Override execute with small delays to observe serialization
    let counter = 0;
    mock.win.grecaptcha.enterprise.execute = async (widgetId: any, opts: any) => {
      const current = ++counter;
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push(current);
      return `token-${current}-${opts.action}`;
    };

    // Trigger multiple concurrent mint calls
    const [t1, t2, t3] = await Promise.all([
      injected.mintCaptcha('ACTION_1'),
      injected.mintCaptcha('ACTION_2'),
      injected.mintCaptcha('ACTION_3'),
    ]);

    assert.strictEqual(t1, 'token-1-ACTION_1');
    assert.strictEqual(t2, 'token-2-ACTION_2');
    assert.strictEqual(t3, 'token-3-ACTION_3');
    assert.deepStrictEqual(executionOrder, [1, 2, 3], 'Các lượt mint phải được thực thi tuần tự theo đúng thứ tự hàng đợi');
  });

  await test('GET_CAPTCHA CustomEvent kích hoạt mintCaptcha và dispatch CAPTCHA_RESULT với token', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    require('../extension/injected.js');

    let captchaResultReceived: any = null;
    mock.win.addEventListener('CAPTCHA_RESULT', (e: any) => {
      captchaResultReceived = e.detail;
    });

    // Dispatch GET_CAPTCHA
    mock.win.dispatchEvent({
      type: 'GET_CAPTCHA',
      detail: { requestId: 'req-test-99', pageAction: 'VIDEO_GENERATION' },
    });

    // Wait microtasks
    await new Promise((r) => setTimeout(r, 100));

    assert(captchaResultReceived, 'CAPTCHA_RESULT phải được dispatch');
    assert.strictEqual(captchaResultReceived.requestId, 'req-test-99');
    assert(captchaResultReceived.token.includes('mock-token'), 'Token phải được trả về');
  });

  // ────────────────────────────────────────────────────────────
  // SUITE 2: R2 — Extension Manifest & reCAPTCHA Preload Bundle
  // ────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 2: R2 — Extension Manifest & reCAPTCHA Preload Bundle');

  const manifestPath = path.resolve(__dirname, '../extension/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  test('manifest.json: version được bump lên 1.0.4', () => {
    assert.strictEqual(manifest.version, '1.0.4', 'Extension version trong manifest.json phải là 1.0.4');
  });

  test('manifest.json: web_accessible_resources khai báo injected.js', () => {
    assert(Array.isArray(manifest.web_accessible_resources), 'Phải có web_accessible_resources dạng mảng');
    const allResources = manifest.web_accessible_resources.flatMap((r: any) => r.resources || []);
    assert(allResources.includes('injected.js'), 'Phải chứa injected.js');
  });

  const contentJsPath = path.resolve(__dirname, '../extension/content.js');
  const contentJsCode = fs.readFileSync(contentJsPath, 'utf8');

  test('content.js: nạp injected.js vào DOM (loại bỏ recaptcha bundles ngoài luồng tránh lỗi TrustedScriptURL)', () => {
    assert(contentJsCode.includes("addExtScript('injected.js')"), 'content.js phải nạp injected.js');
  });

  test('content.js: hỗ trợ cả GET_CAPTCHA và SOLVE_CAPTCHA cho cầu nối background', () => {
    assert(contentJsCode.includes("msg.type === 'GET_CAPTCHA'") || contentJsCode.includes("'GET_CAPTCHA'"), 'content.js phải xử lý GET_CAPTCHA');
    assert(contentJsCode.includes("msg.action === 'SOLVE_CAPTCHA'") || contentJsCode.includes("'SOLVE_CAPTCHA'"), 'content.js phải hỗ trợ SOLVE_CAPTCHA');
    assert(contentJsCode.includes('maintainKeepAlive'), 'content.js phải duy trì keepAlive port');
  });

  // ────────────────────────────────────────────────────────────
  // SUITE 3: R3 — Standardize Batch RPC Fetch Headers & Body Envelope
  // ────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 3: R3 — Batch RPC Fetch Headers & Body Envelope (background.js)');

  const backgroundJsPath = path.resolve(__dirname, '../extension/background.js');
  const backgroundJsCode = fs.readFileSync(backgroundJsPath, 'utf8');

  test('background.js: HANDSHAKE version là 1.0.4', () => {
    assert(backgroundJsCode.includes("version: '1.0.4'"), 'Handshake version trong background.js phải là 1.0.4');
  });

  test('background.js runBatchRpc: body đóng gói bằng new URLSearchParams({ "f.req": ..., at })', () => {
    assert(backgroundJsCode.includes("new URLSearchParams({ 'f.req':"), 'Body phải được format bằng new URLSearchParams({ "f.req": ... })');
    assert(!backgroundJsCode.includes("`f.req=${encodeURIComponent(finalFreq)}&at=${encodeURIComponent(at)}&`"), 'Đã loại bỏ chuỗi interpolation thủ công có dấu & thừa');
  });

  test('background.js runBatchRpc: headers tối giản chỉ gồm content-type và x-same-domain: 1', () => {
    assert(backgroundJsCode.includes("'content-type': 'application/x-www-form-urlencoded;charset=UTF-8'"), 'Headers phải có content-type chuẩn');
    assert(backgroundJsCode.includes("'x-same-domain': '1'"), 'Headers phải có x-same-domain: 1');
    assert(!backgroundJsCode.includes("'x-browser-channel': 'stable'"), 'Đã loại bỏ x-browser-channel giả lập');
    assert(!backgroundJsCode.includes("'x-browser-copyright':"), 'Đã loại bỏ x-browser-copyright giả lập');
    assert(!backgroundJsCode.includes("'x-browser-year':"), 'Đã loại bỏ x-browser-year giả lập');
  });

  test('background.js runBatchRpc: mint CAPTCHA token dùng window.mintCaptcha hoặc invisible widget', () => {
    assert(backgroundJsCode.includes('window.mintCaptcha(captchaAction)'), 'runBatchRpc phải gọi window.mintCaptcha');
    assert(backgroundJsCode.includes("size: 'invisible'"), 'Fallback captcha minting phải dùng size: invisible');
    assert(backgroundJsCode.includes('execute(widgetId,'), 'Fallback captcha minting phải gọi execute với widgetId');
    assert(!backgroundJsCode.includes('execute(siteKey,'), 'Tuyệt đối KHÔNG còn execute(siteKey, ...)');
  });

  test('URLSearchParams serialize body đúng format và không có trailing &', () => {
    const mockFreq = '[[["ogiZ0b","[[null,null,null]]",null,"generic"]]]';
    const mockAt = 'SNlM0e_TEST_CSRF_TOKEN_VALUE';
    const params = new URLSearchParams({ 'f.req': mockFreq, at: mockAt });
    const serialized = params.toString();

    assert(serialized.startsWith('f.req='), 'Phải bắt đầu bằng f.req=');
    assert(serialized.includes('&at='), 'Phải có &at=');
    assert(!serialized.endsWith('&'), 'Tuyệt đối không được kết thúc bằng dấu & thừa');
    assert.strictEqual(params.get('f.req'), mockFreq, 'Giá trị f.req phải được bảo toàn sau khi decode');
    assert.strictEqual(params.get('at'), mockAt, 'Giá trị at phải được bảo toàn sau khi decode');
  });

  // ────────────────────────────────────────────────────────────
  // SUITE 4: FlowBridgeServer Integration & Version Alignment
  // ────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 4: FlowBridgeServer Handshake & mintCaptcha Integration');

  const flowBridgeServerPath = path.resolve(__dirname, '../main/workflow/flow-engine/rpc/FlowBridgeServer.ts');
  const flowBridgeServerCode = fs.readFileSync(flowBridgeServerPath, 'utf8');

  test('FlowBridgeServer: Handshake chấp nhận extension v1.0.4 không reload loop', () => {
    assert(flowBridgeServerCode.includes("if (ver !== '1.0.4')"), 'FlowBridgeServer phải kiểm tra ver !== 1.0.4');
    assert(flowBridgeServerCode.includes('reload lên v1.0.4...'), 'Log FlowBridgeServer phải đề cập 1.0.4');
  });

  test('FlowBridgeServer: Bổ sung phương thức mintCaptcha(captchaAction)', () => {
    assert(flowBridgeServerCode.includes('public async mintCaptcha('), 'FlowBridgeServer phải có method mintCaptcha');
    assert(flowBridgeServerCode.includes("method: 'solve_captcha'"), 'mintCaptcha phải gửi method solve_captcha qua WebSocket');
  });

  // ────────────────────────────────────────────────────────────
  // SUITE 5: Adversarial Hardening & Robustness (Reviewer R1)
  // ────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 5: Adversarial Hardening & Robustness (Reviewer R1)');

  test('injected.js: KHÔNG được monkey-patch window.grecaptcha.enterprise.execute (tránh bot detection flag)', () => {
    assert(!injectedCode.includes('window.grecaptcha.enterprise.execute = function'), 'Tuyệt đối không được monkey-patch grecaptcha.enterprise.execute');
  });

  await test('ensureWidget: Tự động dọn sạch host khi đã có child nodes từ lần render trước', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    // Tạo sẵn thẻ host có child nodes (mô phỏng lần render trước dở dang)
    const dirtyHost = mock.doc.createElement('div');
    dirtyHost.id = 'flowkit-recaptcha-host';
    dirtyHost.hasChildNodes = () => true;
    mock.elements['flowkit-recaptcha-host'] = dirtyHost;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    const widgetId = await injected.ensureWidget('test-site-key-dirty');
    assert.strictEqual(widgetId, 42, 'Phải tạo lại host sạch và render thành công');
  });

  test('background.js: Có hàm reviveTabIfNeeded để phục hồi các tab bị Chrome freeze/discard', () => {
    assert(backgroundJsCode.includes('async function reviveTabIfNeeded('), 'background.js phải có reviveTabIfNeeded');
  });

  test('background.js: solve_captcha tự động inject content.js khi tab bị mất kết nối (Receiving end does not exist)', () => {
    assert(backgroundJsCode.includes('Receiving end does not exist'), 'Phải xử lý lỗi mất kết nối content script');
    assert(backgroundJsCode.includes("files: ['content.js']"), 'Phải tự động inject content.js khi mất kết nối');
  });

  test('background.js: runBatchRpc sử dụng relative path /_/AiSandboxAngularFrontend/... cùng origin', () => {
    assert(backgroundJsCode.includes("`/_/AiSandboxAngularFrontend/data/batchexecute?rpcids="), 'URL phải là relative path theo chuẩn FlowKit');
  });

  test('FlowBridgeServer: sendBatchRpc an toàn khi res.body bị undefined trong nhánh lỗi', () => {
    assert(flowBridgeServerCode.includes('(res.body || res.error || \'\').slice(0, 300)'), 'res.body phải có fallback an toàn');
  });

  // ────────────────────────────────────────────────────────────
  // SUITE 6: Reviewer 2 Adversarial Edge Cases & Idempotency
  // ────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 6: Adversarial Edge Cases & Idempotency Hardening (Reviewer R2)');

  await test('resolveSitekey: Trích xuất thành công với siteKey camelCase, site_key và nested objects', () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    // Case 1: camelCase siteKey
    mock.win.___grecaptcha_cfg = {
      clients: { '0': { siteKey: '6Lds_CAMELCASE_KEY_AAA' } },
    };
    assert.strictEqual(injected.resolveSitekey(), '6Lds_CAMELCASE_KEY_AAA');

    // Case 2: snake_case site_key
    mock.win.___grecaptcha_cfg = {
      clients: { '0': { site_key: '6Lds_SNAKECASE_KEY_BBB' } },
    };
    assert.strictEqual(injected.resolveSitekey(), '6Lds_SNAKECASE_KEY_BBB');

    // Case 3: nested closure config
    mock.win.___grecaptcha_cfg = {
      clients: { '0': { config: { sitekey: '6Lds_NESTED_KEY_CCC' } } },
    };
    assert.strictEqual(injected.resolveSitekey(), '6Lds_NESTED_KEY_CCC');

    // Case 4: string client directly
    mock.win.___grecaptcha_cfg = {
      clients: { '0': '6Lds_DIRECT_STRING_KEY_DDD' },
    };
    assert.strictEqual(injected.resolveSitekey(), '6Lds_DIRECT_STRING_KEY_DDD');
  });

  await test('injected.js: Nạp nhiều lần (re-injection) không tạo duplicate GET_CAPTCHA listeners hay hook lặp', () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    require('../extension/injected.js');

    assert.strictEqual(mock.win.__VANHSUB_CAPTCHA_LISTENER_REGISTERED__, true);
    assert.strictEqual(mock.win.__VANHSUB_SNIFFER_HOOKS_INSTALLED__, true);

    // Verify count of listeners is strictly 1
    assert.strictEqual(mock.getListeners('GET_CAPTCHA').length, 1, 'Lần nạp đầu tiên phải đăng ký đúng 1 listener');

    // Simulate re-injection of injected.js (e.g. after tab connection recovery)
    delete require.cache[require.resolve('../extension/injected.js')];
    require('../extension/injected.js');

    assert.strictEqual(mock.win.__VANHSUB_CAPTCHA_LISTENER_REGISTERED__, true);
    assert.strictEqual(mock.getListeners('GET_CAPTCHA').length, 1, 'Re-injection KHÔNG được đăng ký thêm GET_CAPTCHA listener thứ hai');
  });

  await test('injected.js: mintCaptcha duy trì hàng đợi Promise queue __VANHSUB_MINT_TAIL__ qua các lần nạp script', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected1 = require('../extension/injected.js');

    assert(mock.win.__VANHSUB_MINT_TAIL__ instanceof Promise, '__VANHSUB_MINT_TAIL__ phải được lưu trên window');

    // Re-require
    delete require.cache[require.resolve('../extension/injected.js')];
    const injected2 = require('../extension/injected.js');

    assert.strictEqual(mock.win.__VANHSUB_MINT_TAIL__, mock.win.__VANHSUB_MINT_TAIL__, 'Hàng đợi phải được bảo toàn');
  });

  await test('ensureWidget: Gắn host vào document.documentElement để cách ly khỏi Angular SPA DOM reconciliation', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    let attachedToDocElement = false;
    mock.doc.documentElement.appendChild = (child: any) => {
      attachedToDocElement = true;
      if (child.id) mock.elements[child.id] = child;
    };

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    await injected.ensureWidget('test-site-key-doc-element');
    assert.strictEqual(attachedToDocElement, true, 'Host phải được append vào document.documentElement');
  });

  test('background.js: runBatchRpc chủ động kiểm tra và tự nạp content.js nếu tab chưa sẵn sàng', () => {
    assert(backgroundJsCode.includes('Tab chưa nạp injected.js / content.js, đang tự động nạp content.js'), 'runBatchRpc phải chủ động inject content.js');
    assert(backgroundJsCode.includes("files: ['content.js']"), 'runBatchRpc phải nạp content.js vào tab');
  });

  test('FlowRpcClient: generateImage sử dụng sendBatchRpc (Pure Web RPC) thay vì phụ thuộc UI click cứng', () => {
    const flowRpcClientPath = path.resolve(__dirname, '../main/workflow/flow-engine/rpc/FlowRpcClient.ts');
    const flowRpcClientCode = fs.readFileSync(flowRpcClientPath, 'utf8');
    assert(flowRpcClientCode.includes('bridge.sendBatchRpc('), 'FlowRpcClient.generateImage phải gọi bridge.sendBatchRpc');
    assert(flowRpcClientCode.includes('buildGenImagePayload('), 'FlowRpcClient.generateImage phải dùng buildGenImagePayload');
  });

  // ────────────────────────────────────────────────────────────
  // SUITE 7: Reviewer 3 Adversarial Hardening & Contract Integrity
  // ────────────────────────────────────────────────────────────
  console.log('\n▶ SUITE 7: Adversarial Hardening & Contract Integrity (Reviewer R3)');

  await test('executeWithRetry: Chấp nhận numeric widgetId = 0 (giá trị mặc định đầu tiên của grecaptcha)', async () => {
    const mock = createMockBrowserEnv();
    mock.setNextWidgetId(0); // WidgetId 0 là giá trị bắt đầu chuẩn của Google reCAPTCHA
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    const token = await injected.executeWithRetry('sitekey-widget-zero', 'IMAGE_GENERATION');
    assert(token.includes('mock-token-for-widget-0-IMAGE_GENERATION'), 'Phải tạo token hợp lệ khi widgetId là 0');
    const execArgs = mock.getExecuteCallArgs();
    assert.strictEqual(execArgs.widgetId, 0, 'widgetId 0 không được bị coi là falsy!');
  });

  await test('ensureWidget: Tái sử dụng cached widgetPromise khi sitekey không đổi, nhưng tái render nếu sitekey đổi', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    let renderCount = 0;
    mock.win.grecaptcha.enterprise.render = (host: any, opts: any) => {
      renderCount++;
      return 100 + renderCount;
    };

    // Call 1 với sitekey A
    const wid1 = await injected.ensureWidget('sitekey-AAA');
    assert.strictEqual(wid1, 101);
    assert.strictEqual(renderCount, 1);

    // Call 2 với cùng sitekey A -> tái sử dụng cache, không render lại
    const wid2 = await injected.ensureWidget('sitekey-AAA');
    assert.strictEqual(wid2, 101);
    assert.strictEqual(renderCount, 1, 'Không được gọi render lần 2 khi cùng sitekey');

    // Call 3 với sitekey B khác -> huỷ cache, render lại widget mới cho sitekey B
    const wid3 = await injected.ensureWidget('sitekey-BBB');
    assert.strictEqual(wid3, 102);
    assert.strictEqual(renderCount, 2, 'Phải render lại widget khi sitekey thay đổi');
  });

  await test('injected.js sniffer: Nhận diện URL và body chính xác khi fetch nhận Request hoặc URL object', async () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    require('../extension/injected.js');

    // Giả lập Request object
    const reqObj = {
      url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b',
      body: 'f.req=%5B%5B%5B%22ogiZ0b%22%5D%5D%5D&at=SNlM0e_TEST',
    };

    await mock.win.fetch(reqObj);

    const history = mock.win.__VANHSUB_SNIFFER__.history;
    assert(history.length > 0, 'Sniffer phải ghi nhận request');
    const lastEntry = history[history.length - 1];
    assert(lastEntry.url.includes('batchexecute'), 'URL từ Request object phải được trích xuất chính xác, không phải [object Object]');
    assert(lastEntry.body.includes('ogiZ0b'), 'Body từ Request object phải được trích xuất');
  });

  await test('resolveSitekey: Phát hiện sitekey 6L... trong các thuộc tính bị minified hoặc lồng sâu', () => {
    const mock = createMockBrowserEnv();
    (global as any).window = mock.win;
    (global as any).document = mock.doc;

    delete require.cache[require.resolve('../extension/injected.js')];
    const injected = require('../extension/injected.js');

    mock.win.___grecaptcha_cfg = {
      clients: {
        '0': {
          a: {
            b: '6Lds_MINIFIED_DEEP_KEY_999999999999999999',
          },
        },
      },
    };

    const key = injected.resolveSitekey();
    assert.strictEqual(key, '6Lds_MINIFIED_DEEP_KEY_999999999999999999', 'Phải tìm thấy sitekey 6L... lồng sâu trong object');
  });

  test('background.js: Fallback reCAPTCHA minting trang bị timeout 8s execute_hang và retry 2 lần', () => {
    const backgroundJsFresh = fs.readFileSync(backgroundJsPath, 'utf8');
    assert(backgroundJsFresh.includes("execute_hang"), 'Inline fallback phải có execute_hang timeout 8s');
    assert(backgroundJsFresh.includes("for (let att = 0; att < 2"), 'Inline fallback phải có vòng lặp retry 2 lần');
  });

  console.log('\n================================================================');
  console.log(`  KẾT QUẢ KIỂM THỬ: ${passed}/${total} TESTS PASSED`);
  console.log('  TẤT CẢ CÁC BÀI TEST CHUẨN HÓA FLOWKIT ĐỀU THÀNH CÔNG 100%!');
  console.log('================================================================');
}

runTestSuite().catch((err) => {
  console.error('TEST RUNNER FAILED:', err);
  process.exit(1);
});
