import React, { useState } from 'react';
import { X, Copy, Check, FileText, Sparkles, SlidersHorizontal } from 'lucide-react';
import type { ChannelProfileConfig } from '../../types/aiStudio';

interface ChannelSkillModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelProfile?: Partial<ChannelProfileConfig>;
}

export const RAW_SKILL_TEMPLATE = `Bạn là chuyên gia viết PRODUCTION MASTER PROMPT cho kênh YouTube kể chuyện dài.

Nhiệm vụ: từ mô tả kênh dưới đây, viết ra MỘT master prompt hoàn chỉnh — loại prompt mà người ta dán
vào AI cùng với một nguồn (bài báo, hồ sơ, chủ đề) và nhận về kịch bản lồng tiếng hoàn chỉnh.

Bạn KHÔNG viết kịch bản. Bạn viết cái prompt sinh ra kịch bản đó.

==================================================
PHẦN A — KHUÔN BẮT BUỘC
==================================================

Master prompt bạn viết phải có đủ 10 mục, đúng thứ tự này:

1. SYSTEM ROLE — model đóng vai ai, viết cho kênh nào (GỌI ĐÚNG TÊN KÊNH), khán giả nào, hứa hẹn gì
   với người xem.
2. INPUT — vùng nhận nguồn, bọc bằng marker (xem PHẦN B).
3. PRIMARY OBJECTIVE — độ dài mục tiêu theo phút và theo số từ; phải giống cái gì, và phải KHÔNG
   giống cái gì (nêu 3-5 thứ cụ thể như "một bài báo đọc to", "truyện Reddit đổi tên").
4. CHANNEL DNA — 3-4 dòng ngắn định nghĩa kênh này khác kênh cùng ngách ở chỗ nào.
4B. BRAND IDENTITY — nhận diện thương hiệu, xem PHẦN B4.
5. SIGNATURE BEAT — MỘT đoạn đặc trưng mà người xem quen chờ đợi ở mỗi tập. Đây là tài sản nhận diện
   mạnh nhất của kênh; mô tả rõ nó nằm ở đâu trong tập và làm gì.
6. NGUỒN & SỰ THẬT — phân loại dữ kiện (A = có trong nguồn, B = bối cảnh chung có thể kiểm chứng,
   C = suy diễn, cấm). Nêu rõ được thêm gì và tuyệt đối không được thêm gì.
7. CẤU TRÚC TẬP — chia theo mốc thời gian hoặc theo beat, nói rõ mỗi phần làm gì.
8. NARRATION & DELIVERY — viết cho TAI, không cho mắt (xem PHẦN B).
9. STRICT OUTPUT FORMAT — chép nguyên văn từ PHẦN B, không sửa một ký tự.

==================================================
PHẦN B — VÙNG CẤM SỬA
==================================================

Ba khối dưới đây là hợp đồng kỹ thuật với phần mềm chạy master prompt này. Chép NGUYÊN VĂN vào master
prompt bạn viết. Không diễn đạt lại, không rút gọn, không dịch, không gộp vào mục khác.

--- B1. VÙNG NHẬN NGUỒN (đặt ở mục 2 INPUT) ---

CHANNEL NAME:

{{CHANNEL_NAME}}

=== SOURCE START ===

{{SOURCE_MATERIAL}}

=== SOURCE END ===

Everything inside the markers is the universe of established fact. You may add general, verifiable
context about how a system or process works, because that context is the transformation. You may never
add facts about these specific people or events.

--- B2. LUẬT ĐỌC THÀNH TIẾNG (đặt trong mục 8 NARRATION) ---

- Spell every number as spoken: "two hundred and eleven thousand dollars", "nine days", "nineteen
  eighty-three". Never emit raw digits.
- No symbols at all: no dollar sign, percent sign, ampersand, slash, or arrow.
- The SCRIPT section contains narration and nothing else: no headings, no timestamps, no stage
  directions, no speaker labels, no bracketed cues.

--- B4. NHẬN DIỆN THƯƠNG HIỆU (mục 4B) ---

Viết mục 4B theo đúng bộ luật này, thay [[CHANNEL_NAME]] bằng tên kênh thật ở phần mô tả, nhưng giữ
{{CHANNEL_NAME}} ở mọi CÂU MẪU mà người dẫn sẽ đọc trên sóng:

- BRAND COMPASS: một câu nội bộ tóm gọn kênh này đứng ở đâu. Không bao giờ đọc nguyên văn trên sóng.
  Người xem phải nhận ra kênh qua CÁCH LÀM trước, qua cái tên sau.
- KHÔNG nhắc tên kênh trong 40 giây đầu. Đó là đoạn tụt người xem mạnh nhất; đặt tên ở đó là mất
  người xem có thể đo được.
- MỘT câu giới thiệu thương hiệu trong khoảng 0:40–1:30, dài 8–12 giây khi đọc. Ba việc rồi thôi:
  tên kênh + lời hứa của kênh diễn đạt riêng cho tập này + quay lại câu chuyện ngay. Mỗi tập viết
  một câu khác nhau, không lặp lại câu của tập trước. Cho 2–3 câu MẪU dùng {{CHANNEL_NAME}}.
- MỘT câu ký tên ở 30 giây cuối. Cho 2–3 câu mẫu, cũng dùng {{CHANNEL_NAME}}.
- Tối đa HAI lần nhắc tên trong cả tập, tuyệt đối không quá ba.
- CẤM nhắc tên bên trong: đoạn dẫn chứng, signature beat, và cao trào cảm xúc.
- Tối đa MỘT lời kêu gọi, gắn vào câu hỏi kết. Không xếp chồng like–đăng ký–chuông.
- PHÉP THỬ ĐỘ SÂU: bỏ hẳn tên kênh đi, người xem quen có nhận ra kênh này qua hai phút bất kỳ không?
  Nếu không thì nhận diện đang là trang trí — sửa giọng và signature beat, ĐỪNG thêm lần nhắc tên.

--- B3. HỢP ĐỒNG OUTPUT (mục 9, luôn là mục CUỐI CÙNG) ---

STRICT OUTPUT FORMAT

IF REJECTED:

STATUS: REJECTED
REASON: [one concise line]

IF ACCEPTED:

TITLE: [final title]

SCRIPT:

[complete narration script, plain text, no headings, no timestamps, no stage directions]

--- END OF SCRIPT ---

NARRATION DIRECTION:
[3 to 6 lines: register, target words per minute, the two places to slow down, phonetic notes for any
name or place]

Output NOTHING else. No analysis, no planning, no alternative titles, no word counts, no visual or
music instructions, no commentary.

==================================================
PHẦN C — CỔNG NGUỒN: ĐỂ NHẸ
==================================================

Master prompt được phép trả \`STATUS: REJECTED\`, nhưng bạn phải đặt ngưỡng NHẸ:

- Reject KHI: vùng nguồn trống, hoặc nội dung không liên quan gì tới ngách của kênh.
- KHÔNG reject vì: nguồn ngắn, nguồn thiếu chi tiết, nguồn chỉ có vài đoạn.

Lý do: người dùng chạy kênh hằng ngày. Ngưỡng khắt khe làm video dừng liên tục và họ tưởng phần mềm
hỏng. Khi nguồn mỏng, hãy dặn model thu hẹp phạm vi và viết ngắn hơn mục tiêu — đừng từ chối, và cũng
đừng bịa cho đủ thời lượng.

==================================================
PHẦN D — CHẤT LƯỢNG VĂN
==================================================

Nhét các luật này vào mục 8, diễn đạt theo giọng của kênh:

- Mở bằng một danh từ riêng hoặc một con số cụ thể. Cấm mở bằng câu hỏi tu từ, cấm chào, cấm "trong
  video này".
- Cấm nói trước cấu trúc ("đầu tiên chúng ta sẽ…", "tóm lại…"). Nói thẳng vào việc.
- Tối đa 2 câu giải thích liên tiếp. Câu thứ ba phải là một cảnh, một người, một con số, một đồ vật.
- Cụ thể thắng trừu tượng: "ông ấy đếm ba lần rồi mới ký" thay vì "ông ấy rất cẩn thận".
- Nhịp câu phải đổi. Xen câu dài với câu rất ngắn.
- Cấm nhắc lại một ý đã nói bằng cách diễn đạt khác.
- Cao trào cảm xúc phải là câu văn ĐƠN GIẢN nhất trong tập, không phải câu hoa mỹ nhất.
- Kết bằng chi tiết riêng của câu chuyện này. Nếu đoạn kết có thể gắn vào mười tập khác thì viết lại.

==================================================
PHẦN E — ĐẦU VÀO
==================================================

Thông tin kênh (dùng dấu [[…]] để KHÔNG lẫn với placeholder runtime {{…}} ở PHẦN B):

- Tên kênh: [[CHANNEL_NAME]]
- Kiểu video (engine): [[ENGINE_NAME]]
- Ngách: [[NICHE]]
- Mô tả kênh: [[CHANNEL_BRIEF]]
- Định hướng / nhấn mạnh: [[CHANNEL_ORIENTATION]]
- Ngôn ngữ kịch bản: [[LANGUAGE]]
- Độ dài mục tiêu: [[TARGET_MINUTES]] phút
- Loại nguồn thường dùng: [[SOURCE_KIND]]

Tên kênh ở trên là TÊN THẬT. Viết nó thẳng vào mục 1 (SYSTEM ROLE), mục 4 (CHANNEL DNA) và mục 4B
(BRAND IDENTITY) của master prompt bạn tạo ra, để prompt đọc lên là ra ngay kênh nào.

Nhưng ở mục 2 (INPUT) và ở CÁC CÂU MẪU mà người dẫn sẽ đọc trên sóng thì phải giữ nguyên chuỗi
{{CHANNEL_NAME}} — đó là chỗ phần mềm tự điền lúc chạy. Đổi tên kênh sau này thì mọi câu đọc tự cập
nhật, không phải viết lại master prompt.

==================================================
PHẦN F — CÁCH TRẢ LỜI
==================================================

Viết master prompt bằng ngôn ngữ {{LANGUAGE}} (vì kịch bản nó sinh ra sẽ ở ngôn ngữ đó), TRỪ ba khối
ở PHẦN B — chép nguyên văn tiếng Anh.

Độ dài master prompt: 150–250 dòng. Đủ chặt để chạy được, không dài tới mức không ai đọc nổi.

Trả về DUY NHẤT nội dung master prompt. Không lời dẫn, không giải thích, không bọc trong khối code.
Bắt đầu ngay bằng mục 1 SYSTEM ROLE.`;

export function generateFilledSkillPrompt(channelProfile?: Partial<ChannelProfileConfig>): string {
  const channelName = channelProfile?.projectName || channelProfile?.channelNiche || 'kênh test';
  let engineName = 'Google Flow (Veo & Imagen)';
  if (channelProfile?.aiProvider === 'gemini_web') {
    engineName = 'Gemini Web (Google DeepMind)';
  } else if (channelProfile?.aiProvider === 'chatgpt_web') {
    engineName = 'ChatGPT Web (OpenAI)';
  } else if (channelProfile?.aiProvider === 'deepseek') {
    engineName = 'DeepSeek AI';
  } else if (channelProfile?.aiProvider === 'openai') {
    engineName = 'OpenAI GPT-4o';
  }
  const niche = channelProfile?.channelNiche || 'Chưa thiết lập ngách';
  const brief = channelProfile?.channelDescription || 'Kênh tài liệu, khám phá và câu chuyện chuyên sâu.';
  const orientation = channelProfile?.channelOrientation || 'Kịch tính, lôi cuốn, đào sâu dữ kiện lịch sử và nhân vật.';
  const language = 'Tiếng Việt';

  let targetMinutes = '3–5';
  if (channelProfile?.targetLongDuration === '1_3_min') targetMinutes = '1–3';
  else if (channelProfile?.targetLongDuration === '5_8_min') targetMinutes = '5–8';
  else if (channelProfile?.targetLongDuration === '8_12_min') targetMinutes = '8–12';
  else if (channelProfile?.targetLongDuration === '12_18_min') targetMinutes = '12–18';
  else if (channelProfile?.targetLongDuration === '18_28_min') targetMinutes = '18–28';

  const sourceKind = 'Bài báo, tư liệu lịch sử, tài liệu điều tra, chủ đề nóng';

  return RAW_SKILL_TEMPLATE
    .replace('[[CHANNEL_NAME]]', channelName)
    .replace('[[ENGINE_NAME]]', engineName)
    .replace('[[NICHE]]', niche)
    .replace('[[CHANNEL_BRIEF]]', brief)
    .replace('[[CHANNEL_ORIENTATION]]', orientation)
    .replace('[[LANGUAGE]]', language)
    .replace('[[TARGET_MINUTES]]', targetMinutes)
    .replace('[[SOURCE_KIND]]', sourceKind);
}

export default function ChannelSkillModal({
  isOpen,
  onClose,
  channelProfile,
}: ChannelSkillModalProps) {
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'filled' | 'template'>('filled');

  if (!isOpen) return null;

  const contentToDisplay =
    viewMode === 'filled'
      ? generateFilledSkillPrompt(channelProfile)
      : RAW_SKILL_TEMPLATE;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(contentToDisplay);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // Fallback if clipboard API is restricted
      const textarea = document.createElement('textarea');
      textarea.value = contentToDisplay;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-800 bg-[#0B0F17] shadow-2xl">
        {/* HEADER */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800/80 px-6">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-5 w-5 text-brand-cyan" />
            <h2 className="text-base font-bold text-white tracking-wide">
              Skill tạo master prompt
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* SUB-HEADER / INSTRUCTIONS BAR (Match Screenshot) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/60 bg-[#090D14] px-6 py-3 text-xs">
          <p className="text-slate-400">
            1. Sao chép toàn bộ skill. 2. Dán vào ChatGPT/Claude/Gemini kèm mô tả kênh của bạn. 3. Dán kết quả nhận được vào ô Master prompt.
          </p>
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('filled')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                viewMode === 'filled'
                  ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Đã điền thông tin kênh
            </button>
            <button
              type="button"
              onClick={() => setViewMode('template')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                viewMode === 'template'
                  ? 'bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/30'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Template gốc
            </button>
          </div>
        </div>

        {/* CONTENT (Scrollable code-like container) */}
        <div className="flex-1 overflow-y-auto p-6 font-mono text-[13px] leading-relaxed text-slate-200 selection:bg-brand-cyan/30 selection:text-white">
          <pre className="whitespace-pre-wrap font-sans break-words bg-transparent select-text">
            {contentToDisplay}
          </pre>
        </div>

        {/* FOOTER ACTION BAR */}
        <div className="flex h-16 shrink-0 items-center justify-between border-t border-slate-800/80 bg-[#0B0F17]/95 px-6">
          <div className="flex items-center gap-2 text-xs">
            {copied ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold animate-pulse">
                <Check className="h-4 w-4" /> Đã sao chép vào bộ nhớ tạm!
              </span>
            ) : (
              <span className="text-slate-400 text-xs">
                {viewMode === 'filled'
                  ? '✓ Đã tự động thay thế tên kênh, ngách và định hướng của bạn'
                  : '✓ Bản template chuẩn chứa các biến giữ chỗ [[...]]'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700/80 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
            >
              Đóng
            </button>

            {/* Coral/Orange "Sao chép" button exactly matching the user's screenshot */}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-2 rounded-xl bg-[#FA5252] hover:bg-[#E03131] px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-500/20 active:scale-95 transition cursor-pointer"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
