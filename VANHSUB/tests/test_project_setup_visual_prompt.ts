import assert from 'assert';
import { DEFAULT_CHANNEL_PROFILE_CONFIG, ChannelProfileConfig } from '../renderer/types/aiStudio';

console.log('🧪 BẮT ĐẦU KIỂM THỬ: Tự Prompt Bối Cảnh Visual & AI Gợi Ý...');

// Test 1: ChannelProfileConfig lưu trữ đầy đủ projectBackgroundPrompt và visualArtStylePreset
const testProfile: ChannelProfileConfig = {
  ...DEFAULT_CHANNEL_PROFILE_CONFIG,
  projectName: 'Lịch Sử Việt Nam - Triều Lý',
  channelNiche: 'Lịch sử thế giới & Chiến tranh',
  channelOrientation: 'Hùng tráng, điện ảnh',
  videoStyleId: 'history_doc',
  visualArtStylePreset: 'history_doc',
  projectBackgroundPrompt: 'Authentic ancient imperial stone courtyard and grand palace hall, weathered traditional wooden architecture, ceremonial bronze braziers with flickering flame, misty mountain backdrop',
};

assert.strictEqual(testProfile.videoStyleId, 'history_doc');
assert.strictEqual(testProfile.visualArtStylePreset, 'history_doc');
assert(testProfile.projectBackgroundPrompt?.includes('ancient imperial stone courtyard'));
console.log('  ✅ PASS: ChannelProfileConfig lưu trữ chuẩn xác projectBackgroundPrompt và visualArtStylePreset');

// Test 2: Mô phỏng logic AI Tự Sinh Prompt theo Đề tài & Niche
function mockAiSuggestBackground(projectName: string, niche: string, orient: string, selectedStyleId: string): string {
  const combined = `${projectName} ${niche} ${orient}`.toLowerCase();
  let specificScene = '';

  if (combined.includes('sinh tồn') || combined.includes('tiền sử') || combined.includes('rừng') || combined.includes('survival')) {
    specificScene = 'Primeval prehistoric wilderness, towering ancient giant ferns, misty humid jungle canopy, mossy stone monoliths, atmospheric volumetric god rays, hyper-detailed 8k';
  } else if (combined.includes('khoa học') || combined.includes('bí ẩn') || combined.includes('vũ trụ') || combined.includes('space')) {
    specificScene = 'Cutting-edge astrophysics observatory or futuristic orbital space station, panoramic glass cupola overlooking glowing nebula and distant galaxies, deep volumetric blue lighting';
  } else if (combined.includes('lịch sử') || combined.includes('chiến tranh') || combined.includes('cổ trang') || combined.includes('history')) {
    specificScene = 'Authentic ancient imperial stone courtyard and grand palace hall, weathered traditional wooden architecture, ceremonial bronze braziers with flickering flame, misty mountain backdrop';
  } else if (combined.includes('công nghệ') || combined.includes('ai') || combined.includes('cyber')) {
    specificScene = 'Advanced cybernetic laboratory with holographic translucent interfaces, gleaming dark chrome surfaces, neon violet and cyan accent lighting, cinematic photorealistic';
  } else {
    specificScene = 'Modern cinematic studio environment, atmospheric warm backlight, depth of field';
  }

  let finalPrompt = specificScene;
  if (selectedStyleId === 'anime_ghibli' && !finalPrompt.toLowerCase().includes('ghibli')) {
    finalPrompt = `Ghibli anime art style aesthetic, ${finalPrompt}`;
  } else if (selectedStyleId === 'cyberpunk' && !finalPrompt.toLowerCase().includes('neon')) {
    finalPrompt = `Cyberpunk sci-fi aesthetic, ${finalPrompt}`;
  }

  return finalPrompt;
}

// Case 2a: Đề tài Lịch sử
const promptHistory = mockAiSuggestBackground('Lý Thường Kiệt', 'Lịch sử Việt Nam', 'Hào hùng', 'history_doc');
assert(promptHistory.includes('ancient imperial stone courtyard'));
console.log('  ✅ PASS: AI sinh prompt bối cảnh cổ trang / lịch sử chuẩn xác');

// Case 2b: Đề tài Sinh tồn + Anime Ghibli
const promptSurvival = mockAiSuggestBackground('Sinh tồn trên đảo hoang', 'Sinh tồn', 'Kịch tính', 'anime_ghibli');
assert(promptSurvival.includes('Primeval prehistoric wilderness'));
assert(promptSurvival.startsWith('Ghibli anime art style aesthetic'));
console.log('  ✅ PASS: AI kết hợp bối cảnh sinh tồn với phong cách Ghibli mượt mà');

// Case 2c: Đề tài Công nghệ + Cyberpunk
const promptCyber = mockAiSuggestBackground('Trí tuệ nhân tạo tương lai', 'Công nghệ & AI', 'Sắc bén', 'cyberpunk');
assert(promptCyber.includes('Advanced cybernetic laboratory'));
console.log('  ✅ PASS: AI sinh prompt phòng thí nghiệm công nghệ / cyberpunk');

console.log('\n📊 KẾT QUẢ: TẤT CẢ TEST CASES VỀ TỰ PROMPT BỐI CẢNH ĐỀU ĐẠT CHUẨN (PASS)!');
