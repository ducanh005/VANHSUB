import { aiStudioStoryboardService } from '../main/ai-studio/services/AiStudioStoryboardService';
import type { ScriptSceneItem, SceneTimingItem } from '../main/ai-studio/types/storage';

const mockScriptScenes: ScriptSceneItem[] = [
  { scene_id: 'scene_01', narration: 'Lịch sử dòng điện tại Nhật Bản bắt đầu từ cuối thế kỷ 19.', visual_note: 'Bối cảnh lịch sử Tokyo thời kỳ Minh Trị' },
  { scene_id: 'scene_02', narration: 'Thời bấy giờ, ánh sáng ban đêm chủ yếu dựa vào đèn dầu và nến.', visual_note: 'Khung cảnh phố phường ban đêm mờ ảo' },
  { scene_id: 'scene_03', narration: 'Năm 1882, trạm phát điện đầu tiên ra đời tại trung tâm Tokyo.', visual_note: 'Công trình trạm phát điện đầu tiên' },
  { scene_id: 'scene_04', narration: 'Sự kiện này đánh dấu bước ngoặt lớn cho nền công nghiệp.', visual_note: 'Các nhà máy dần sử dụng điện' },
  { scene_id: 'scene_05', narration: 'Tuy nhiên, việc cung cấp điện ban đầu gặp rất nhiều khó khăn.', visual_note: 'Đường dây điện sơ khai gặp trục trặc' },
  { scene_id: 'scene_06', narration: 'Hai miền đông tây sử dụng hai tần số điện khác nhau là 50Hz và 60Hz.', visual_note: 'Bản đồ Nhật Bản chia đôi 2 tần số' },
  { scene_id: 'scene_07', narration: 'Sự khác biệt này tồn tại suốt hơn một thế kỷ cho đến ngày nay.', visual_note: 'Hình ảnh trạm biến áp hiện đại' },
  { scene_id: 'scene_08', narration: 'Mạng lưới truyền tải dần được mở rộng ra khắp các tỉnh thành.', visual_note: 'Hệ thống cột điện cao thế trên đồi' },
  { scene_id: 'scene_09', narration: 'Đưa Nhật Bản trở thành một trong những quốc gia có lưới điện tin cậy nhất thế giới.', visual_note: 'Thành phố Tokyo rực rỡ ánh đèn về đêm' },
  { scene_id: 'scene_10', narration: 'Đó là cả một hành trình nỗ lực không ngừng nghỉ.', visual_note: 'Góc nhìn toàn cảnh đất nước Nhật Bản hiện đại' },
];

const mockTimingScenes: SceneTimingItem[] = [
  { scene_id: 'scene_01', start_sec: 0.0, end_sec: 4.5, duration_sec: 4.5 },
  { scene_id: 'scene_02', start_sec: 4.5, end_sec: 9.0, duration_sec: 4.5 },
  { scene_id: 'scene_03', start_sec: 9.0, end_sec: 13.2, duration_sec: 4.2 },
  { scene_id: 'scene_04', start_sec: 13.2, end_sec: 17.5, duration_sec: 4.3 },
  { scene_id: 'scene_05', start_sec: 17.5, end_sec: 22.0, duration_sec: 4.5 },
  { scene_id: 'scene_06', start_sec: 22.0, end_sec: 27.2, duration_sec: 5.2 },
  { scene_id: 'scene_07', start_sec: 27.2, end_sec: 32.0, duration_sec: 4.8 },
  { scene_id: 'scene_08', start_sec: 32.0, end_sec: 36.5, duration_sec: 4.5 },
  { scene_id: 'scene_09', start_sec: 36.5, end_sec: 42.0, duration_sec: 5.5 },
  { scene_id: 'scene_10', start_sec: 42.0, end_sec: 46.0, duration_sec: 4.0 },
];

console.log('🧪 TEST: Granularity Engine V2 Clustering Verification\n');

console.log('--- 1. Testing FAST granularity ---');
const fastClusters = aiStudioStoryboardService.clusterSentencesDeterministically(
  mockScriptScenes,
  mockTimingScenes,
  'fast'
);
console.log(`=> Fast produced: ${fastClusters.length} shots from 10 sentences.\n`);

console.log('--- 2. Testing BALANCED granularity ---');
const balancedClusters = aiStudioStoryboardService.clusterSentencesDeterministically(
  mockScriptScenes,
  mockTimingScenes,
  'balanced'
);
console.log(`=> Balanced produced: ${balancedClusters.length} shots from 10 sentences.\n`);

console.log('--- 3. Testing DETAILED granularity ---');
const detailedClusters = aiStudioStoryboardService.clusterSentencesDeterministically(
  mockScriptScenes,
  mockTimingScenes,
  'detailed'
);
console.log(`=> Detailed produced: ${detailedClusters.length} shots from 10 sentences.\n`);

// Assertions
if (balancedClusters.length === mockScriptScenes.length) {
  console.error('❌ FAIL: Balanced granularity produced 1:1 shots! Merge logic failed.');
  process.exit(1);
}

if (fastClusters.length >= balancedClusters.length || balancedClusters.length >= detailedClusters.length) {
  console.error('❌ FAIL: Granularity scaling hierarchy violated (fast < balanced < detailed)');
  process.exit(1);
}

console.log('🎉 ALL GRANULARITY V2 TESTS PASSED! Shots are properly merged according to pacing!');
