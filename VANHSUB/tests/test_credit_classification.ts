import { FlowErrorClassifier } from '../main/workflow/flow-engine/FlowErrorClassifier';
import type { FlowRecoveryErrorType } from '../main/workflow/flow-engine/FlowRecoveryManager';

function deriveStateMachineErrType(errMsg: string): FlowRecoveryErrorType {
  const lowerMsg = errMsg.toLowerCase();
  const isDomObscured =
    lowerMsg.includes('obscured') ||
    lowerMsg.includes('element_obscured') ||
    lowerMsg.includes('bị che') ||
    lowerMsg.includes('che phủ') ||
    lowerMsg.includes('backdrop') ||
    lowerMsg.includes('dialog') ||
    lowerMsg.includes('credit-cost') ||
    lowerMsg.includes('cost-label');

  if (isDomObscured) {
    return 'OVERLAY_BLOCKING';
  } else if (
    lowerMsg.includes('not found') ||
    lowerMsg.includes('không tìm thấy') ||
    lowerMsg.includes('element_not_found')
  ) {
    return 'ELEMENT_NOT_FOUND';
  } else if (
    (
      lowerMsg.includes('session_expired') ||
      lowerMsg.includes('session expired') ||
      lowerMsg.includes('hết hạn phiên') ||
      lowerMsg.includes('chưa xác thực phiên') ||
      lowerMsg.includes('hết tín dụng') ||
      lowerMsg.includes('hết credit') ||
      lowerMsg.includes('không đủ credit') ||
      lowerMsg.includes('bạn đã hết credit') ||
      lowerMsg.includes('out of credits') ||
      lowerMsg.includes('insufficient credits') ||
      lowerMsg.includes('reauth_required')
    )
  ) {
    return 'SESSION_EXPIRED';
  }
  return 'UNKNOWN_STATE';
}

function runTests() {
  console.log('🧪 BẮT ĐẦU KIỂM THỬ: Phân loại lỗi và chống nhận diện nhầm credit-cost-label...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
      failed++;
    }
  }

  // TEST 1: Message bị che bởi credit-cost-label
  const msgObscured = 'Phần tử [PROMPT_INPUT] đang bị che bởi [SPAN.credit-cost-label] tại toạ độ (712, 724).';
  const c1 = FlowErrorClassifier.classify(new Error(msgObscured));
  assert(
    c1.category === 'RETRYABLE',
    'Case 1.1: credit-cost-label phải được phân loại là RETRYABLE',
    `Nhận được: ${c1.category}`
  );
  assert(
    c1.code === 'ELEMENT_TRANSIENT_BUSY',
    'Case 1.2: credit-cost-label phải có mã lỗi ELEMENT_TRANSIENT_BUSY',
    `Nhận được: ${c1.code}`
  );
  assert(
    c1.code !== 'SESSION_EXPIRED' && c1.code !== 'OUT_OF_CREDITS',
    'Case 1.3: credit-cost-label TUYỆT ĐỐI KHÔNG được gán SESSION_EXPIRED hoặc OUT_OF_CREDITS',
    `Nhận được: ${c1.code}`
  );

  const t1 = deriveStateMachineErrType(msgObscured);
  assert(
    t1 === 'OVERLAY_BLOCKING',
    'Case 1.4: FlowStateMachine phải map credit-cost-label sang OVERLAY_BLOCKING',
    `Nhận được: ${t1}`
  );
  assert(
    t1 !== 'SESSION_EXPIRED',
    'Case 1.5: FlowStateMachine TUYỆT ĐỐI KHÔNG map sang SESSION_EXPIRED',
    `Nhận được: ${t1}`
  );

  // TEST 2: Message VERIFY_FAILED bọc lỗi bị che bởi credit-cost-label
  const msgVerifyFailed = '[VERIFY_FAILED] Kiểm tra trạng thái UI sau hành động tại [FIND_PROMPT_INPUT] không đạt yêu cầu! Chi tiết: Phần tử [PROMPT_INPUT] đang bị che bởi [SPAN.credit-cost-label] tại toạ độ (592, 720).';
  const c2 = FlowErrorClassifier.classify(msgVerifyFailed);
  assert(
    c2.category === 'RETRYABLE' && c2.code === 'ELEMENT_TRANSIENT_BUSY',
    'Case 2.1: VERIFY_FAILED credit-cost-label phải là RETRYABLE / ELEMENT_TRANSIENT_BUSY',
    `Nhận được: ${c2.category} / ${c2.code}`
  );
  const t2 = deriveStateMachineErrType(msgVerifyFailed);
  assert(
    t2 === 'OVERLAY_BLOCKING',
    'Case 2.2: VERIFY_FAILED credit-cost-label errType phải là OVERLAY_BLOCKING',
    `Nhận được: ${t2}`
  );

  // TEST 3: Lỗi THẬT về hết credit (Tiếng Việt)
  const msgRealCreditVi = 'Tài khoản Google Flow của bạn đã hết credit, vui lòng nạp thêm.';
  const c3 = FlowErrorClassifier.classify(new Error(msgRealCreditVi));
  assert(
    c3.category === 'NON_RETRYABLE',
    'Case 3.1: Thông báo hết credit thật (Tiếng Việt) phải là NON_RETRYABLE',
    `Nhận được: ${c3.category}`
  );
  assert(
    c3.code === 'OUT_OF_CREDITS',
    'Case 3.2: Thông báo hết credit thật (Tiếng Việt) phải có mã OUT_OF_CREDITS',
    `Nhận được: ${c3.code}`
  );

  // TEST 4: Lỗi THẬT về hết credit (Tiếng Anh: out of credits / insufficient credits)
  const msgRealCreditEn = 'Google Flow error: Out of credits for model generation.';
  const c4 = FlowErrorClassifier.classify(new Error(msgRealCreditEn));
  assert(
    c4.category === 'NON_RETRYABLE' && c4.code === 'OUT_OF_CREDITS',
    'Case 4.1: Out of credits (Tiếng Anh) phải là NON_RETRYABLE / OUT_OF_CREDITS',
    `Nhận được: ${c4.category} / ${c4.code}`
  );

  // TEST 5: Lỗi THẬT về hết hạn session
  const msgRealSession = 'Phiên làm việc đã hết hạn phiên (session expired). Vui lòng đăng nhập lại.';
  const c5 = FlowErrorClassifier.classify(new Error(msgRealSession));
  assert(
    c5.category === 'NON_RETRYABLE' && c5.code === 'SESSION_EXPIRED',
    'Case 5.1: Hết hạn phiên thật phải là NON_RETRYABLE / SESSION_EXPIRED',
    `Nhận được: ${c5.category} / ${c5.code}`
  );
  const t5 = deriveStateMachineErrType(msgRealSession);
  assert(
    t5 === 'SESSION_EXPIRED',
    'Case 5.2: FlowStateMachine errType cho hết hạn phiên thật phải là SESSION_EXPIRED',
    `Nhận được: ${t5}`
  );

  console.log(`\n📊 KẾT QUẢ: ${passed} PASS, ${failed} FAIL.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
