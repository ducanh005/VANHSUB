/**
 * verify_sniffer_dump.ts
 *
 * Tiện ích CLI kiểm tra tính toàn vẹn của payload f.req và rpcids trong sniffer_dump.json.
 *
 * Sử dụng:
 *   npx tsx scripts/verify_sniffer_dump.ts [đường_dẫn_sniffer_dump.json]
 */

import path from 'path';
import fs from 'fs';
import { FlowBridgeServer } from '../main/workflow/flow-engine/rpc/FlowBridgeServer';

const targetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), 'sniffer_dump.json');

console.log('================================================================');
console.log('  VANHSUB FLOWKIT: SNIFFER CAPTURE & RPC PAYLOAD VERIFIER      ');
console.log('================================================================');
console.log(`Kiểm tra file: ${targetPath}\n`);

if (!fs.existsSync(targetPath)) {
  console.log(`⚠️  File không tồn tại: ${targetPath}`);
  console.log('Tạo mẫu kiểm tra giả lập (mock verification test)...');

  // Chạy test xác minh với dữ liệu mẫu chuẩn của Google Flow batchexecute
  const mockSample = [
    {
      type: 'fetch',
      url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=ogiZ0b&f.sid=123',
      body: 'f.req=' + encodeURIComponent(JSON.stringify([[['ogiZ0b', JSON.stringify(['A majestic landscape', 3, 1]), null, 'generic']]])) + '&at=xyz',
      response: ")]}'\n[[[\"wrb.fr\",\"ogiZ0b\",null,null,null,null,null,1]]]",
      timestamp: Date.now(),
    },
    {
      type: 'fetch',
      url: 'https://flow.google.com/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=MZZa6b',
      body: 'f.req=' + encodeURIComponent(JSON.stringify([[['MZZa6b', JSON.stringify(['Animate this scene', 8]), null, 'generic']]])) + '&at=xyz',
      response: ")]}'\n[[[\"wrb.fr\",\"MZZa6b\",\"op-123\",null,null,null,null,1]]]",
      timestamp: Date.now() + 1000,
    },
  ];

  const result = FlowBridgeServer.verifySnifferDump(mockSample);
  console.log('Kết quả kiểm tra dữ liệu mẫu:');
  console.log(`- Tổng số gói tin batchexecute: ${result.batchExecuteCount}`);
  console.log(`- Gói tin hợp lệ: ${result.validPayloadCount}/${result.batchExecuteCount}`);
  console.log(`- Thống kê RPC IDs:`, JSON.stringify(result.rpcidCounts));
  console.log(`- Tính toàn vẹn: ${result.valid ? '✅ HỢP LỆ 100%' : '❌ CÓ LỖI'}`);
  process.exit(result.valid ? 0 : 1);
}

const report = FlowBridgeServer.verifySnifferDump(targetPath);

console.log(`- Tổng số bản ghi trong sniffer dump: ${report.totalEntries}`);
console.log(`- Tổng số yêu cầu batchexecute: ${report.batchExecuteCount}`);
console.log(`- Số payload hợp lệ: ${report.validPayloadCount}`);
console.log(`- Số payload lỗi/hỏng: ${report.corruptedPayloadCount}`);
console.log(`- Phát hiện PUBLIC_ERROR_UNUSUAL_ACTIVITY: ${report.unusualActivityDetected ? '⚠️ CÓ' : '✅ KHÔNG'}`);
console.log('\nPhân bổ RPC IDs bắt được:');
for (const [rpcid, count] of Object.entries(report.rpcidCounts)) {
  console.log(`  • ${rpcid}: ${count} lượt gọi`);
}

if (report.errors.length > 0) {
  console.log('\n❌ Danh sách lỗi phát hiện:');
  report.errors.forEach((e) => console.log(`  - ${e}`));
}

if (report.valid) {
  console.log('\n✅ TẤT CẢ PAYLOAD F.REQ VÀ RPCIDS TRONG SNIFFER DUMP HOÀN TOÀN HỢP LỆ!');
  process.exit(0);
} else {
  console.log('\n⚠️  PHÁT HIỆN GÓI TIN BỊ SAI HOẶC BỊ HỎNG TRONG SNIFFER DUMP!');
  process.exit(1);
}
