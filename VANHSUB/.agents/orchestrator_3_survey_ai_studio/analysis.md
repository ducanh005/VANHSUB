# BÁO CÁO KHẢO SÁT CHUYÊN SÂU PHÂN HỆ AI VIDEO STUDIO (PIPELINE & FRONTEND UI)
## Tích hợp Chế độ Tiết kiệm: ChatGPT Web Automation (Zero API Cost)

- **Người thực hiện:** Explorer phụ trách Phân hệ AI Video Studio (orchestrator_3_survey_ai_studio)
- **Ngày khảo sát:** 2026-09-17
- **Phạm vi khảo sát:** Codebase `d:\DEAN\DEAN\VANHSUB` — Các thư mục `main/ai-studio/`, `main/store/`, `renderer/components/ai-studio/`, `renderer/lib/store/`, `renderer/types/`
- **Mục tiêu:** Xác định hiện trạng kiến trúc và tất cả các điểm cần can thiệp để tích hợp chế độ chạy kịch bản video qua phiên ChatGPT Web miễn phí thay vì HTTP API có tính phí.

---

## 1. Tóm tắt cốt lõi (Executive Summary)

Phân hệ AI Video Studio của Vanhsub hiện đã hoàn thiện kiến trúc 2 tầng (Main Process & Renderer) với hệ thống cấu hình độc lập (`vanhsub-ai-studio.json`), động cơ điều phối 8 công đoạn (`AiStudioPipelineEngine`), và 3 màn hình UI chuyên trách (`AutoPilotView`, `CustomStudioView`, `AiStudioSettingsTab`).

Hiện tại, công đoạn 2 (Kịch bản - Script Generation) đang được gọi độc quyền qua `AiStudioLlmService`, phụ thuộc vào API Key trả phí (DeepSeek / OpenAI). Để tích hợp "Chế độ Tiết kiệm ChatGPT Web":
1. **Tại tầng Cấu hình:** Mở rộng `LlmProvider` thêm `'chatgpt_web'`, bổ sung cấu hình `chatgptWebMode: 'offscreen' | 'visible'` trong cả Main và Renderer store.
2. **Tại tầng Pipeline Engine:** Can thiệp bước 2 (Stage 2: `script`) trong `AiStudioPipelineEngine.ts` để phân nhánh: nếu `provider === 'chatgpt_web'`, ủy quyền sinh kịch bản cho `ChatGptAutomationEngine` / `ChatGptWebSessionManager` với cơ chế nhắc đăng nhập tự động và trích xuất JSON kịch bản an toàn.
3. **Tại tầng Giao diện:** Bổ sung tùy chọn Provider, nút đăng nhập kèm trạng thái kết nối và checkbox Live Window trong `AiStudioSettingsTab`; đồng thời hiển thị huy hiệu *"⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí"* trên `AutoPilotView` và `CustomStudioView`.

---

## 2. Bản đồ hiện trạng Phân hệ AI Video Studio (Codebase Inventory)

### 2.1. Hệ thống Lưu trữ & Cấu hình (Store & Types)

| Tệp nguồn | Vai trò & Công nghệ | Chi tiết triển khai hiện tại |
|---|---|---|
| `main/store/aiStudioStore.ts` | Backend Store (Electron Main) qua `electron-store` | - Lưu file riêng biệt: `vanhsub-ai-studio.json` (hoàn toàn cách ly khỏi `vanhsub-settings.json`).<br>- Bảo mật phần cứng DPAPI: `encryptSecret()` / `decryptSecret()` qua `safeStorage` (tiền tố `enc:v1:`), fallback sang headless base64 (`enc:v1:headless:`).<br>- Cung cấp các hàm: `getAiStudioConfig()`, `getDecryptedAiStudioConfig()`, `updateAiStudioConfig()`, `resetAiStudioConfig()`. |
| `renderer/lib/store/aiStudioStore.ts` | Frontend Store (Renderer) qua Zustand | - Hook `useAiStudioStore` quản lý state: `config`, `isLoading`, `isSaving`, `error`, `hasLoaded`.<br>- Cơ chế Cập nhật lạc quan (Optimistic Update) cục bộ trước, sau đó đồng bộ 2 chiều với Main Process qua IPC bridge `window.vanhsub.aiStudio.updateConfig()`.<br>- Các hàm tiện ích con: `updateLlmConfig`, `updateVoiceConfig`, `updateFlowConfig`, `updateRenderingConfig`, `updateSubtitleConfig`. |
| `main/ai-studio/types.ts` | Types & Constants (Main Process) | - `LlmProvider`: `'deepseek' \| 'openai' \| 'custom'` (dòng 10).<br>- `AiStudioLlmConfig`: `provider`, `apiKey`, `model`, `baseUrl`, `temperature`, `systemPromptPreset` (dòng 12-25).<br>- `DEFAULT_LLM_CONFIG`: mặc định `deepseek-chat` (dòng 135-142).<br>- Hợp đồng Pipeline Session: `PipelineSessionState`, `ScriptBeatLine`, `PipelineProgressEvent`. |
| `renderer/types/aiStudio.ts` | Types Mirroring (Renderer) | - Định nghĩa song song `LlmProviderType = 'deepseek' \| 'openai' \| 'custom'`.<br>- Mirror `AiStudioConfig` và `DEFAULT_AI_STUDIO_CONFIG`. |
| `main/preload.ts` & `renderer/types/electron.d.ts` | IPC Bridge Preload & Typing | - Expose namespace `window.vanhsub.aiStudio` với 10 phương thức chuẩn.<br>- TypeScript global interface `VanhsubAPI.aiStudio`. |

### 2.2. Động cơ Điều phối Pipeline (`AiStudioPipelineEngine.ts`)

- **Vị trí file:** `main/ai-studio/AiStudioPipelineEngine.ts` (659 dòng).
- **Trách nhiệm:** Điều phối chuỗi 8 công đoạn liên hoàn:
  - Công đoạn 1: `source` (Dữ kiện / Idea Blueprint)
  - Công đoạn 2: `script` (Kịch bản - Script Generation)
  - Công đoạn 3: `voice` (Lồng tiếng - Edge-TTS)
  - Công đoạn 4: `alignment` (Trích xuất Time / Word-boundary)
  - Công đoạn 5: `storyboard` (Visual Prompts cho Google Flow)
  - Công đoạn 6: `visuals` (Ảnh tĩnh / Video phân cảnh)
  - Công đoạn 7: `render` (Dựng phim ghép Audio + Visual + Subtitle qua FFmpeg)
  - Công đoạn 8: `metadata` (SEO Title, Description, Hashtags)
- **Cơ chế Checkpoint State Machine:**
  - Lưu trạng thái nguyên tử vào `session.json` sau mỗi bước hoàn thành (`persistSessionStateAtomic()`).
  - Cho phép khôi phục qua `resume({ sessionId, fromStage })` với quy tắc bảo toàn bước trước (Upstream Preservation) và dọn sạch bước sau (Downstream Eviction).
  - Quản lý hủy bỏ tác vụ qua `AbortController` và hủy tiến trình FFmpeg con qua `activeProcesses`.

#### Khảo sát chi tiết Công đoạn 2 (Kịch bản - Script Generation):
Trong `AiStudioPipelineEngine.ts` (dòng 430-438):
```typescript
case 2: {
  // Stage 2: Kịch bản (Script Generation)
  const scriptLines = await aiStudioLlmService.generateScript(
    session.topic,
    config.llm
  );
  session.artifacts.scriptLines = scriptLines;
  break;
}
```
Tại `main/ai-studio/services/AiStudioLlmService.ts` (dòng 122-189):
- Hàm `generateScript(topic, config)` gọi `createClient(config)`.
- `createClient()` (dòng 37-59) khởi tạo SDK `new OpenAI({ apiKey, baseURL })`.
- Nếu `apiKey` rỗng hoặc không hợp lệ, hệ thống nhảy vào hàm fallback ngoại tuyến `generateFallbackScript()`.
- Kết quả phản hồi từ HTTP LLM được làm sạch bằng `jsonrepair`, bóc tách thành mảng các đối tượng `ScriptBeatLine`:
  ```typescript
  export interface ScriptBeatLine {
    id: string;
    index: number;
    speaker?: string;
    text: string;
    startMs?: number;
    endMs?: number;
    durationMs?: number;
    audioPath?: string;
    visualPromptEn?: string;
    assetPath?: string;
    assetType?: 'image' | 'video';
    estimatedDurationSec?: number;
    beatType?: 'hook' | 'intro' | 'body' | 'climax' | 'outro';
  }
  ```

### 2.3. Cấu trúc Giao diện Người dùng (Frontend UI Components)

1. **`AiStudioWorkspace.tsx`** (`renderer/components/ai-studio/AiStudioWorkspace.tsx`, 83 dòng):
   - Shell tổng thể, thanh header trên cùng chứa logo Pro Studio và bộ chuyển đổi 3 chế độ (`AiStudioMode = 'auto' | 'custom' | 'settings'`).
   - Hiển thị tương ứng `AutoPilotView`, `CustomStudioView`, hoặc `AiStudioSettingsTab`.

2. **`AiStudioSettingsTab.tsx`** (`renderer/components/ai-studio/AiStudioSettingsTab.tsx`, 440 dòng):
   - Grid 2 cột chia làm 4 khối cấu hình: (1) Mô hình Ngôn ngữ LLM, (2) Giọng đọc Edge TTS, (3) Google Flow Engine, (4) Dựng phim & Phụ đề.
   - Quản lý local state qua `form: AiStudioConfig` đồng bộ với Zustand `useAiStudioStore()`.
   - Nút "Lưu cấu hình" gọi `updateConfig(form)`, nút "Khôi phục mặc định" gọi `resetConfig()`.

3. **`AutoPilotView.tsx`** (`renderer/components/ai-studio/AutoPilotView.tsx`, 388 dòng):
   - Chế độ One-Click Auto Pilot: Tiếp nhận chủ đề video (`topic`), nút "Bắt đầu sản xuất".
   - Bộ theo dõi 8 bước hiển thị trực quan dạng thẻ lưới và thanh tiến trình thời gian thực.
   - Lắng nghe sự kiện đẩy `window.vanhsub.aiStudio.onPipelineProgress` để cập nhật trạng thái từng bước và các artifact sinh ra (audio preview, video player, gói SEO metadata).

4. **`CustomStudioView.tsx`** (`renderer/components/ai-studio/CustomStudioView.tsx`, 543 dòng):
   - Giao diện can thiệp sâu với 3 Sub-tab:
     - Sub-tab 1: *Kịch bản & Giọng* (chỉnh sửa text câu thoại, nghe thử audio, tạo lại giọng từng câu qua `renderSingleLineVoice`, nút "Chấm điểm kịch bản").
     - Sub-tab 2: *Phân cảnh Visual (Storyboard)* (sửa visual prompt, sinh lại ảnh từng scene qua `regenerateSceneAsset`).
     - Sub-tab 3: *Dựng phim & Phụ đề* (chọn nhạc nền, tùy biến Ken Burns, preset phụ đề, nút xuất video qua `renderVideo`).
   - Đã kết nối sẵn `const { config } = useAiStudioStore();`.

---

## 3. Các điểm can thiệp & Kế hoạch Tích hợp Chi tiết

### 3.1. Mở rộng Kiểu Dữ liệu & Cấu hình (Types & Schema)

Cần can thiệp vào cả `main/ai-studio/types.ts` và `renderer/types/aiStudio.ts`:

1. **Mở rộng danh sách Provider:**
   ```typescript
   // Trước:
   export type LlmProvider = 'deepseek' | 'openai' | 'custom';

   // Sau:
   export type LlmProvider = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web';
   ```

2. **Bổ sung tham số cấu hình hiển thị trình duyệt trong `AiStudioLlmConfig`:**
   ```typescript
   export interface AiStudioLlmConfig {
     provider: LlmProvider;
     apiKey: string;
     model: string;
     baseUrl?: string;
     temperature: number;
     systemPromptPreset: string;
     /** Chế độ hiển thị trình duyệt khi dùng ChatGPT Web: 'offscreen' (ngầm) | 'visible' (nổi xem trực tiếp) */
     chatgptWebMode?: 'offscreen' | 'visible';
   }
   ```

3. **Cập nhật hằng số mặc định:**
   - Trong `DEFAULT_LLM_CONFIG`: Bổ sung `chatgptWebMode: 'offscreen'`.
   - Cập nhật cả `DEFAULT_AI_STUDIO_CONFIG` trong `main/ai-studio/types.ts` và `renderer/types/aiStudio.ts`.

4. **Đồng bộ hóa trong `main/store/aiStudioStore.ts`:**
   - Đảm bảo hàm `getAiStudioConfig()` và `updateAiStudioConfig()` giữ nguyên thuộc tính `chatgptWebMode` khi merge với `DEFAULT_AI_STUDIO_CONFIG`.

---

### 3.2. Nâng cấp Tab Cài đặt (`AiStudioSettingsTab.tsx`)

Vị trí can thiệp: Khối **1. Mô hình Ngôn ngữ (LLM Script)** (từ dòng 97 đến 184).

1. **Bổ sung tùy chọn vào Select Provider:**
   ```tsx
   <option value="chatgpt_web">ChatGPT Web (Chế độ tiết kiệm - Miễn phí 100%)</option>
   ```

2. **Điều kiện hiển thị giao diện tùy theo Provider:**
   - Khi người dùng chọn `form.llm.provider === 'chatgpt_web'`:
     - **Ẩn hoặc làm mờ** các ô nhập `API Key` và `Model` (hoặc hiển thị thông báo: *"Không cần API Key — Hệ thống tự động đồng bộ qua tài khoản ChatGPT Web của bạn"*).
     - **Thêm Card điều khiển ChatGPT Web:**
       - **Đèn báo trạng thái đăng nhập:**
         - Đã đăng nhập: Chấm tròn xanh lá `bg-emerald-500 animate-pulse` kèm chữ *"Đã đăng nhập ChatGPT Web"*.
         - Chưa đăng nhập: Chấm tròn màu xám `bg-slate-500` kèm chữ *"Chưa đăng nhập"*.
       - **Nút "Đăng nhập ChatGPT":** Khi bấm sẽ gọi qua IPC bridge `window.vanhsub.chatgpt.openLogin()` để mở cửa sổ trình duyệt đăng nhập tương tác thực tế.
       - **Nút "Kiểm tra lại":** Bấm để làm mới trạng thái phiên.
       - **Checkbox "Xem trực tiếp AI gõ chữ (Live Window)":**
         ```tsx
         <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-800">
           <input
             type="checkbox"
             id="chatgptLiveWindow"
             checked={form.llm.chatgptWebMode === 'visible'}
             onChange={(e) =>
               setForm({
                 ...form,
                 llm: {
                   ...form.llm,
                   chatgptWebMode: e.target.checked ? 'visible' : 'offscreen',
                 },
               })
             }
             className="h-4 w-4 rounded accent-brand-cyan cursor-pointer"
           />
           <label htmlFor="chatgptLiveWindow" className="text-xs text-slate-300 cursor-pointer">
             Xem trực tiếp AI gõ chữ (Live Window nổi trên màn hình)
           </label>
         </div>
         ```

---

### 3.3. Hiển thị Huy hiệu "Chế độ Tiết kiệm" trên AutoPilotView và CustomStudioView

#### 1. Trên `AutoPilotView.tsx`:
- **Thêm kết nối Store:**
  ```tsx
  import { useAiStudioStore } from '../../lib/store/aiStudioStore';
  // ...
  const { config } = useAiStudioStore();
  ```
- **Vị trí hiển thị badge:** Đặt trong phần Header tiếp nhận ý tưởng (ngay cạnh hoặc bên dưới thẻ `⚡ One-Click Auto Pilot` tại dòng 130-136):
  ```tsx
  {config.llm.provider === 'chatgpt_web' && (
    <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300 animate-fade-in shadow-sm">
      <span>⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí</span>
    </div>
  )}
  ```

#### 2. Trên `CustomStudioView.tsx`:
- File này đã có sẵn `const { config } = useAiStudioStore();` (dòng 26).
- **Vị trí hiển thị badge:** Đặt tại thanh tiêu đề của Sub-tab 1: *Kịch bản & Giọng đọc* (dòng 248):
  ```tsx
  <div className="flex items-center gap-3">
    <h3 className="text-base font-bold text-white">Hiệu đính Kịch bản & Giọng đọc AI</h3>
    {config.llm.provider === 'chatgpt_web' && (
      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300">
        ⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí
      </span>
    )}
  </div>
  ```

---

### 3.4. Cơ chế Điều hướng Bước 2 trong `AiStudioPipelineEngine.ts`

Trong `AiStudioPipelineEngine.ts`, tại vòng lặp `runPipelineLoop()` (dòng 430-438):

```typescript
case 2: {
  // Stage 2: Kịch bản (Script Generation)
  let scriptLines: ScriptBeatLine[];

  if (config.llm.provider === 'chatgpt_web') {
    // 1. Ghi log tiến trình
    onProgress({
      sessionId: session.sessionId,
      stage: 2,
      stageName: STAGE_CONFIG[2].label,
      progress: 15,
      status: 'running',
      message: 'Đang kết nối phiên ChatGPT Web để sinh kịch bản miễn phí...',
    });

    // 2. Kiểm tra trạng thái đăng nhập; nếu chưa đăng nhập thì tự động mở cửa sổ nhắc đăng nhập
    const isAuthed = await chatGptWebSessionManager.isLoggedIn();
    if (!isAuthed) {
      onProgress({
        sessionId: session.sessionId,
        stage: 2,
        stageName: STAGE_CONFIG[2].label,
        progress: 18,
        status: 'running',
        message: 'Chưa đăng nhập ChatGPT Web. Đang mở cửa sổ đăng nhập...',
      });
      await chatGptWebSessionManager.openLoginWindow();
      // Đợi người dùng hoàn tất đăng nhập hoặc ném lỗi nếu timeout
      await chatGptWebSessionManager.waitForLogin(120_000);
    }

    // 3. Thực thi sinh kịch bản qua DOM Automation Engine
    // Tự động đồng bộ chế độ hiển thị visible vs offscreen
    scriptLines = await chatGptAutomationEngine.generateScript({
      topic: session.topic,
      preset: config.llm.systemPromptPreset,
      mode: config.llm.chatgptWebMode || 'offscreen',
      signal,
      onProgress: (stepMsg) => {
        onProgress({
          sessionId: session.sessionId,
          stage: 2,
          stageName: STAGE_CONFIG[2].label,
          progress: 20,
          status: 'running',
          message: stepMsg,
        });
      },
    });
  } else {
    // Luồng cũ qua HTTP OpenAI / DeepSeek API
    scriptLines = await aiStudioLlmService.generateScript(
      session.topic,
      config.llm
    );
  }

  session.artifacts.scriptLines = scriptLines;
  break;
}
```

#### Xử lý tương thích Stage 1 và Stage 8:
- Ở Stage 1 (`analyzeIdeaBlueprint`), nếu không có API key (`provider === 'chatgpt_web'`), `aiStudioLlmService` đã có sẵn cơ chế fallback an toàn `generateFallbackBlueprint(topic)` sinh ra cấu trúc blueprint rất tốt mà không gây lỗi dừng pipeline.
- Tương tự ở Stage 8 (`generateSeoMetadata`), `aiStudioLlmService` cũng đã có fallback `generateFallbackSeo(topic, scriptLines)`.
- (Khuyến nghị nâng cao): Trong tương lai có thể cho phép `chatGptAutomationEngine` sinh luôn cả Stage 1 và Stage 8 nếu muốn tối ưu hóa hoàn toàn nội dung.

---

## 4. Hợp đồng IPC & Giao tiếp Main-Renderer

Để Frontend UI và Backend tương tác nhịp nhàng, cần đăng ký các IPC Handlers sau trong Main Process:

| Kênh IPC (Channel) | Chiều gọi | Dữ liệu đầu vào (Payload) | Dữ liệu trả về (Response) | Mô tả |
|---|---|---|---|---|
| `chatgpt:status` | Renderer $\rightarrow$ Main | `{}` | `{ isLoggedIn: boolean; email?: string; error?: string }` | Kiểm tra trạng thái cookie/session trong phân vùng `persist:chatgpt_session`. |
| `chatgpt:open-login` | Renderer $\rightarrow$ Main | `{}` | `{ success: boolean }` | Mở cửa sổ đăng nhập ChatGPT Web (`https://chatgpt.com`). |
| `chatgpt:set-mode` | Renderer $\rightarrow$ Main | `{ mode: 'offscreen' \| 'visible' }` | `{ success: boolean }` | Chuyển đổi vị trí cửa sổ trình duyệt automation (ngoài màn hình `-3000, -3000` hoặc nổi trên màn hình). |
| `chatgpt:generate-script` | Renderer $\rightarrow$ Main | `{ topic: string; preset?: string }` | `{ scriptLines: ScriptBeatLine[] }` | Gọi sinh kịch bản trực tiếp bằng ChatGPT Web (dùng cho CustomStudio hoặc kiểm thử độc lập). |

### Cầu nối Preload Bridge (`main/preload.ts`):
Mở rộng đối tượng `vanhsub` trong `preload.ts`:
```typescript
chatgpt: {
  status: () => ipcRenderer.invoke('chatgpt:status'),
  openLogin: () => ipcRenderer.invoke('chatgpt:open-login'),
  setMode: (mode: 'offscreen' | 'visible') => ipcRenderer.invoke('chatgpt:set-mode', mode),
  generateScript: (payload: { topic: string; preset?: string }) =>
    ipcRenderer.invoke('chatgpt:generate-script', payload),
}
```
Và khai báo bổ sung vào `renderer/types/electron.d.ts` để đảm bảo 100% Type Check không có lỗi biên dịch TypeScript.

---

## 5. Phân tích Rủi ro & Giải pháp Phòng vệ (Edge Cases & Resilience)

1. **Rủi ro Cắt cụt Token khi kịch bản quá dài (Truncation):**
   - *Đặc điểm của bản ChatGPT Web miễn phí:* Giới hạn độ dài câu trả lời ngắn hơn so với API.
   - *Giải pháp (Multi-turn Chunking tương tự Revo Studio):* Prompt chia nhỏ: lượt 1 yêu cầu khung sườn và 3 câu đầu; lượt 2 yêu cầu 3 câu tiếp theo nối tiếp phiên hội thoại (`conversationId` được giữ nguyên trong web session).

2. **Rủi ro Captcha / Cloudflare Check:**
   - Khi Cloudflare xuất hiện, nếu cửa sổ đang ở chế độ `offscreen`, người dùng sẽ bị kẹt không biết.
   - *Cơ chế tự phục hồi (Auto-surfacing):* `ChatGptAutomationEngine` phát hiện iframe Cloudflare / checkbox Turnstile sẽ tự động dời cửa sổ vào màn hình hiển thị (`visible`) và phát thông báo yêu cầu người dùng xác nhận 1 click.

3. **Tính ổn định của DOM Selector:**
   - OpenAI thường xuyên thay đổi class Tailwind và data attributes của ChatGPT Web.
   - *Giải pháp:* Sử dụng kiến trúc đa tầng kế thừa từ `FlowElementFinder`:
     - Ô nhập: `#prompt-textarea`, `div[contenteditable="true"]`, `textarea[tabindex="0"]`.
     - Nút gửi: `button[data-testid="send-button"]`, `button[aria-label="Send prompt"]`.
     - Chờ hoàn thành: Theo dõi `button[data-testid="stop-button"]` xuất hiện rồi biến mất, kết hợp MutationObserver trên khối `[data-message-author-role="assistant"]`.
   - Sử dụng `jsonrepair` bọc ngoài đầu ra để vá lỗi nếu ChatGPT trả về JSON thiếu ngoặc nhọn kết thúc.

---

## 6. Lộ trình Triển khai Đề xuất cho Đội ngũ Developer

- **Bước 1 (Schema & Types):** Cập nhật `main/ai-studio/types.ts` và `renderer/types/aiStudio.ts` (thêm `chatgpt_web`, `chatgptWebMode`).
- **Bước 2 (Main Process Backend):**
  - Xây dựng `ChatGptWebSessionManager.ts` (quản lý session `persist:chatgpt_session`, cookie, login window).
  - Xây dựng `ChatGptAutomationEngine.ts` (DOM interaction, prompt typing, response extraction).
  - Đăng ký các IPC channel trong `main/main.ts` và expose trong `main/preload.ts`.
- **Bước 3 (Pipeline Integration):** Bổ sung nhánh gọi `ChatGptAutomationEngine` tại Stage 2 trong `AiStudioPipelineEngine.ts`.
- **Bước 4 (Frontend UI):**
  - Cập nhật `AiStudioSettingsTab.tsx` (Select option, login status badge, login button, Live Window checkbox).
  - Cập nhật `AutoPilotView.tsx` và `CustomStudioView.tsx` (huy hiệu Chế độ Tiết kiệm).
- **Bước 5 (Kiểm thử độc lập):**
  - Viết script E2E `scripts/test_chatgpt_web_automation.ts`.
  - Chạy `npx tsc --noEmit` xác minh không có bất kỳ lỗi biên dịch nào.
