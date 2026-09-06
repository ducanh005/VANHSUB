// Catalog voice TikTok TTS.
//
// NGUỒN: bảng speaker công khai trong README các client TikTok TTS đang hoạt
// động (Steve0929/tiktok-tts, Weilbyte/tiktok-tts) — chụp tháng 9/2026.
// TikTok KHÔNG có endpoint liệt kê voice được biết đến, nên đây là catalog tĩnh:
// có thể trôi so với server (voice bị gỡ/thêm mới). Voice sai sẽ bị server từ
// chối bằng status_code 4 → client trả lỗi INVALID_VOICE, người dùng chọn khác.
// Nếu sau này tìm được endpoint liệt kê voice, thay hàm getCatalog() là đủ.

import type { TikTokVoice } from './types';

function voice(id: string, label: string, language: string, gender: TikTokVoice['gender'] = 'unknown'): TikTokVoice {
  return { id, label, language, gender };
}

/** Danh sách voice đã biết, nhóm theo ngôn ngữ. 2 giọng tiếng Việt đứng đầu. */
const CATALOG: TikTokVoice[] = [
  // ---- Tiếng Việt ----
  voice('BV074_streaming', 'Tiếng Việt — Nữ', 'vi', 'female'),
  voice('BV075_streaming', 'Tiếng Việt — Nam', 'vi', 'male'),

  // ---- Tiếng Anh (US/UK/AU) — giọng gốc ----
  voice('en_us_001', 'English US — Female (mặc định TikTok)', 'en', 'female'),
  voice('en_us_002', 'Jessie (English US)', 'en', 'female'),
  voice('en_us_006', 'Joey (English US)', 'en', 'male'),
  voice('en_us_007', 'Professor (English US)', 'en', 'male'),
  voice('en_us_009', 'Scientist (English US)', 'en', 'male'),
  voice('en_us_010', 'Confidence (English US)', 'en', 'male'),
  voice('en_uk_001', 'Narrator (English UK)', 'en', 'male'),
  voice('en_uk_003', 'English UK — Male', 'en', 'male'),
  voice('en_au_001', 'Metro (English AU)', 'en', 'female'),
  voice('en_au_002', 'Smooth (English AU)', 'en', 'male'),

  // ---- Tiếng Anh — giọng nhân vật / kể chuyện ----
  voice('en_male_narration', 'Story Teller', 'en', 'male'),
  voice('en_male_jomboy', 'Game On', 'en', 'male'),
  voice('en_male_funny', 'Wacky', 'en', 'male'),
  voice('en_us_ghostface', 'Scream (Ghost Face)', 'en', 'male'),
  voice('en_female_samc', 'Empathetic', 'en', 'female'),
  voice('en_male_cody', 'Serious', 'en', 'male'),
  voice('en_female_makeup', 'Beauty Guru', 'en', 'female'),
  voice('en_female_richgirl', 'Bestie', 'en', 'female'),
  voice('en_male_grinch', 'Trickster', 'en', 'male'),
  voice('en_male_deadpool', 'Mr. GoodGuy', 'en', 'male'),
  voice('en_male_jarvis', 'Alfred', 'en', 'male'),
  voice('en_male_ashmagic', 'ashmagic', 'en', 'male'),
  voice('en_male_olantekkers', 'olantekkers', 'en', 'male'),
  voice('en_male_ukneighbor', 'Lord Cringe', 'en', 'male'),
  voice('en_male_ukbutler', 'Mr. Meticulous', 'en', 'male'),
  voice('en_female_shenna', 'Debutante', 'en', 'female'),
  voice('en_female_pansino', 'Varsity', 'en', 'female'),
  voice('en_male_trevor', 'Marty', 'en', 'male'),
  voice('en_female_betty', 'Bae', 'en', 'female'),
  voice('en_male_cupid', 'Cupid', 'en', 'male'),
  voice('en_female_grandma', 'Granny', 'en', 'female'),
  voice('en_male_wizard', 'Magician', 'en', 'male'),
  voice('en_female_emotional', 'Peaceful', 'en', 'female'),

  // ---- Tiếng Anh — hiệu ứng / hát ----
  voice('en_female_f08_twinkle', 'Pop Lullaby', 'en', 'female'),
  voice('en_male_m03_classical', 'Classic Electric', 'en', 'male'),
  voice('en_male_m2_xhxs_m03_christmas', 'Cozy', 'en', 'male'),
  voice('en_male_santa_narration', 'Author (Santa)', 'en', 'male'),
  voice('en_male_sing_deep_jingle', 'Caroler', 'en', 'male'),
  voice('en_male_santa_effect', 'Santa', 'en', 'male'),
  voice('en_female_ht_f08_newyear', 'NYE 2023', 'en', 'female'),
  voice('en_female_ht_f08_halloween', 'Opera', 'en', 'female'),
  voice('en_female_ht_f08_glorious', 'Euphoric', 'en', 'female'),
  voice('en_female_ht_f08_wonderful_world', 'Melodrama', 'en', 'female'),
  voice('en_male_sing_funny_it_goes_up', 'Hypetrain (It Goes Up)', 'en', 'male'),
  voice('en_male_m2_xhxs_m03_silly', 'Chipmunk (Quirky)', 'en', 'male'),
  voice('en_male_m03_sunshine_soon', 'Toon Beat', 'en', 'male'),
  voice('en_female_f08_warmy_breeze', 'Open Mic', 'en', 'female'),
  voice('en_male_m03_lobby', 'Jingle', 'en', 'male'),
  voice('en_male_sing_funny_thanksgiving', 'Thanksgiving', 'en', 'male'),
  voice('en_female_f08_salut_damour', 'Cottagecore', 'en', 'female'),

  // ---- Disney ----
  voice('en_us_chewbacca', 'Chewbacca', 'en', 'male'),
  voice('en_us_c3po', 'C3PO', 'en', 'male'),
  voice('en_us_stitch', 'Stitch', 'en', 'male'),
  voice('en_us_stormtrooper', 'Stormtrooper', 'en', 'male'),
  voice('en_us_rocket', 'Rocket', 'en', 'male'),
  voice('en_female_madam_leota', 'Madame Leota', 'en', 'female'),
  voice('en_male_ghosthost', 'Ghost Host', 'en', 'male'),
  voice('en_male_pirate', 'Pirate', 'en', 'male'),

  // ---- Châu Âu ----
  voice('fr_001', 'Français — Homme 1', 'fr', 'male'),
  voice('fr_002', 'Français — Homme 2', 'fr', 'male'),
  voice('es_002', 'Español (Spain) — Hombre', 'es', 'male'),
  voice('es_mx_002', 'Español (México) — Cálido', 'es', 'male'),
  voice('de_001', 'Deutsch — Weiblich', 'de', 'female'),
  voice('de_002', 'Deutsch — Männlich', 'de', 'male'),
  voice('it_001', 'Italiano — Femminile', 'it', 'female'),
  voice('it_002', 'Italiano — Maschile', 'it', 'male'),

  // ---- Bồ Đào Nha (BR) ----
  voice('br_001', 'Português BR — Feminino 1', 'pt', 'female'),
  voice('br_003', 'Português BR — Feminino 3', 'pt', 'female'),
  voice('br_004', 'Português BR — Feminino 4', 'pt', 'female'),
  voice('br_005', 'Português BR — Masculino', 'pt', 'male'),
  voice('bp_female_ivete', 'Ivete Sangalo', 'pt', 'female'),
  voice('bp_female_ludmilla', 'Ludmilla', 'pt', 'female'),
  voice('pt_female_lhays', 'Lhays Macedo', 'pt', 'female'),
  voice('pt_female_laizza', 'Laizza', 'pt', 'female'),
  voice('pt_male_bueno', 'Galvão Bueno', 'pt', 'male'),

  // ---- Châu Á ----
  voice('id_001', 'Bahasa Indonesia — Perempuan', 'id', 'female'),
  voice('jp_001', '日本語 — 女性 1', 'ja', 'female'),
  voice('jp_003', '日本語 — 女性 2', 'ja', 'female'),
  voice('jp_005', '日本語 — 女性 3', 'ja', 'female'),
  voice('jp_006', '日本語 — 男性', 'ja', 'male'),
  voice('jp_male_hikakin', 'ヒカキン', 'ja', 'male'),
  voice('jp_female_rei', '丸山礼', 'ja', 'female'),
  voice('jp_male_shuichiro', '修一朗', 'ja', 'male'),
  voice('jp_female_fujicochan', 'りーさ', 'ja', 'female'),
  voice('jp_male_matsuo', 'モジャオ', 'ja', 'male'),
  voice('jp_male_osada', 'モリスケ', 'ja', 'male'),
  voice('kr_002', '한국어 — 남성 1', 'ko', 'male'),
  voice('kr_003', '한국어 — 여성', 'ko', 'female'),
  voice('kr_004', '한국어 — 남성 2', 'ko', 'male'),
];

export class TikTokVoiceService {
  /** Catalog tĩnh — nếu sau này có endpoint liệt kê voice thì thay tại đây */
  static getCatalog(): TikTokVoice[] {
    return CATALOG.map((v) => ({ ...v }));
  }

  static isKnownVoice(id: string): boolean {
    return CATALOG.some((v) => v.id === id);
  }

  /** Voice mặc định — giọng Việt nữ (thử đầu tiên khi cấu hình) */
  static get defaultVoice(): string {
    return 'BV074_streaming';
  }
}
