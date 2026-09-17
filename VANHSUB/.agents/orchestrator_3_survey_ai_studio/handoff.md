# HANDOFF REPORT — Khảo sát Phân hệ AI Video Studio (Pipeline & Frontend UI)

## 1. Observation (Quan sát trực tiếp)

- **Cấu hình & Store Main Process (`main/store/aiStudioStore.ts`):**
  - Quản lý file `vanhsub-ai-studio.json` qua `electron-store` độc lập hoàn toàn với `vanhsub-settings.json`.
  - Dòng 48-102: Khóa API `llm.apiKey` được mã hóa phần cứng Windows DPAPI qua `safeStorage` (tiền tố `enc:v1:`), fallback sang headless base64 (`enc:v1:headless:`).
  - Dòng 229-277: `getAiStudioConfig()` và `getDecryptedAiStudioConfig()` đọc cấu hình và tự động merge với `DEFAULT_AI_STUDIO_CONFIG`.
  - Dòng 284-355: `updateAiStudioConfig()` hỗ trợ `DeepPartial<AiStudioConfig>` và tự động mã hóa lại key nếu có thay đổi.

- **Cấu hình & Store Renderer Process (`renderer/lib/store/aiStudioStore.ts`):**
  - Dòng 109-167: Hook Zustand `useAiStudioStore` nạp cấu hình ban đầu qua IPC bridge `window.vanhsub.aiStudio.getConfig()`.
  - Dòng 175-226: `updateConfig()` thực hiện Optimistic Update cục bộ, sau đó đồng bộ với Main process qua `window.vanhsub.aiStudio.updateConfig()`.
  - Dòng 289: Cung cấp `updateLlmConfig(partial)`.

- **Định nghĩa Kiểu dữ liệu (`main/ai-studio/types.ts` & `renderer/types/aiStudio.ts`):**
  - `main/ai-studio/types.ts:10`: `export type LlmProvider = 'deepseek' | 'openai' | 'custom';`
  - `main/ai-studio/types.ts:12-25`: `export interface AiStudioLlmConfig { provider: LlmProvider; apiKey: string; model: string; baseUrl?: string; temperature: number; systemPromptPreset: string; }`
  - `main/ai-studio/types.ts:135-142`: `DEFAULT_LLM_CONFIG` với `provider: 'deepseek'`, `model: 'deepseek-chat'`.
  - `renderer/types/aiStudio.ts:34-49`: `LlmProviderType = 'deepseek' | 'openai' | 'custom';` và `AiStudioLlmConfig` song song.

- **Động cơ Pipeline Bước 2 (`main/ai-studio/AiStudioPipelineEngine.ts`):**
  - Dòng 53-65: Định nghĩa 8 công đoạn (`STAGE_CONFIG`), trong đó bước 2 là `script: 'Kịch bản (Script Generation)'`.
  - Dòng 430-438:
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
  - Trong `main/ai-studio/services/AiStudioLlmService.ts` (dòng 37-59 & 122-189): `generateScript()` khởi tạo client `new OpenAI()` dựa trên `config.apiKey` và `config.baseUrl`. Nếu không có `apiKey`, hệ thống tự động rơi vào hàm offline fallback `generateFallbackScript()`.

- **Frontend UI Components (`renderer/components/ai-studio/`):**
  - `AiStudioSettingsTab.tsx:105-118`: `<select value={form.llm.provider}>` chỉ có 3 options `deepseek`, `openai`, `custom`.
  - `AutoPilotView.tsx:128-136`: Header thẻ One-Click Auto Pilot hiện chưa kết nối `useAiStudioStore` và chưa có badge hiển thị chế độ tiết kiệm.
  - `CustomStudioView.tsx:26`: Đã có `const { config } = useAiStudioStore();`. Dòng 248: Sub-tab 1 *Kịch bản & Giọng đọc* hiện chưa có badge tiết kiệm ChatGPT Web.

- **Kiến trúc Session & BrowserWindow mẫu (`main/veo/GoogleVeoSessionManager.ts`):**
  - Dòng 44-45: Sử dụng tọa độ ẩn `OFFSCREEN_X = -3000`, `OFFSCREEN_Y = -3000` để chạy browser automation ngầm.
  - Dòng 306-320: Mở `BrowserWindow` với `partition: 'persist:google_veo'`, can thiệp user-agent và request headers qua `webRequest.onBeforeSendHeaders`.

---

## 2. Logic Chain (Chuỗi lập luận)

1. **Từ Quan sát Cấu hình & Store:**
   - Hệ thống cấu hình đã được thiết kế phân lớp và độc lập hoàn hảo. Cả `electron-store` (Main) và Zustand (Renderer) đều dựa trên schema `AiStudioConfig.llm`.
   - Do đó, việc bổ sung `'chatgpt_web'` vào `LlmProvider` và thuộc tính `chatgptWebMode?: 'offscreen' | 'visible'` vào `AiStudioLlmConfig` sẽ được tự động đồng bộ và lưu đĩa một cách trơn tru mà không làm gián đoạn các phân hệ cấu hình khác.

2. **Từ Quan sát Bước 2 của Pipeline Engine:**
   - `AiStudioPipelineEngine.ts` là nơi điều phối trung tâm của cả 8 công đoạn. Hiện tại, bước 2 gọi trực tiếp `aiStudioLlmService.generateScript(session.topic, config.llm)`.
   - Khi `config.llm.provider === 'chatgpt_web'`, việc gọi `aiStudioLlmService` sẽ thất bại hoặc rơi vào fallback vì không có HTTP API Key.
   - Do đó, điểm phân nhánh lý tưởng nhất là ngay tại `case 2` trong `AiStudioPipelineEngine.ts` (dòng 430): Kiểm tra `if (config.llm.provider === 'chatgpt_web')`, kiểm tra trạng thái đăng nhập qua `ChatGptWebSessionManager`, nếu chưa đăng nhập thì tự động mở cửa sổ đăng nhập, sau đó kích hoạt `ChatGptAutomationEngine.generateScript()` để tự động hóa DOM và trích xuất kịch bản thành mảng `ScriptBeatLine[]`.

3. **Từ Quan sát Giao diện Người dùng:**
   - Trong `AiStudioSettingsTab.tsx`, khi thêm option `chatgpt_web`, người dùng cần trực quan hóa việc không cần nhập API Key, đồng thời cần nút đăng nhập, đèn báo trạng thái đăng nhập và checkbox Live Window.
   - Trong `AutoPilotView.tsx` và `CustomStudioView.tsx`, việc hiển thị huy hiệu *"⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí"* sẽ gia tăng sự tin cậy và minh bạch cho người dùng về việc hệ thống đang tận dụng tài khoản web miễn phí thay vì tiêu tốn token.

---

## 3. Caveats (Lưu ý & Điểm mở)

- **Phạm vi khảo sát:** Khảo sát tập trung vào phân hệ AI Video Studio (Pipeline, Store và Frontend UI). Phần chi tiết kiến trúc tầng thấp của Electron BrowserWindow, session cookies, và bộ selector DOM ChatGPT Web được khảo sát chuyên sâu bởi các agent chuyên trách khác (`orchestrator_3_survey_main_arch` và `orchestrator_3_survey_spec_miner`).
- **Giả định:** Giả định rằng `ChatGptAutomationEngine` trả về kết quả định dạng `ScriptBeatLine[]` tương thích hoàn toàn với schema của `AiStudioLlmService.generateScript()`.
- **Phương án thay thế đã cân nhắc:** Cân nhắc việc đưa logic ChatGPT Web vào bên trong `AiStudioLlmService.generateScript()` thay vì phân nhánh ở `AiStudioPipelineEngine.ts`. Tuy nhiên, phân nhánh ở `AiStudioPipelineEngine.ts` giúp tách bạch rõ ràng giữa HTTP API Service (stateless, pure network) và Browser Automation Engine (stateful, quản lý BrowserWindow, cửa sổ offscreen/onscreen).

---

## 4. Conclusion (Kết luận)

Kiến trúc hiện tại của AI Video Studio rất đồng bộ, nhất quán và sẵn sàng 100% cho việc tích hợp Chế độ Tiết kiệm ChatGPT Web mà không cần tái cấu trúc nền tảng.
Kế hoạch can thiệp bao gồm 4 điểm chạm chính:
1. Mở rộng type `LlmProvider` (`chatgpt_web`) và `AiStudioLlmConfig` (`chatgptWebMode`).
2. Nâng cấp giao diện cấu hình `AiStudioSettingsTab.tsx` (tùy chọn provider, nút đăng nhập, đèn báo, checkbox Live window).
3. Hiển thị huy hiệu Chế độ Tiết kiệm trên `AutoPilotView.tsx` và `CustomStudioView.tsx`.
4. Điều hướng bước 2 trong `AiStudioPipelineEngine.ts` sang `ChatGptAutomationEngine` / `ChatGptWebSessionManager` khi provider là `chatgpt_web`.

---

## 5. Verification Method (Phương pháp xác minh độc lập)

1. **Kiểm tra cú pháp & tính toàn vẹn kiểu dữ liệu:**
   - Lệnh: `npx tsc --noEmit`
   - Điều kiện đạt: 0 lỗi biên dịch trên toàn bộ codebase TypeScript.
2. **Kiểm tra cấu hình độc lập:**
   - Lệnh: `npx tsx scripts/test_adversarial_ai_studio_store.ts`
   - Điều kiện đạt: Các bài test đọc, ghi, mã hóa DPAPI và reset của `aiStudioStore` đều đạt 100% PASS.
3. **Kiểm thử tích hợp Pipeline:**
   - Lệnh: `npx tsx scripts/test_ai_studio_pipeline.ts`
   - Điều kiện đạt: Chuỗi 9 bài kiểm thử E2E của AI Video Studio đều PASS.
4. **Kiểm tra tài liệu báo cáo:**
   - Đọc trực tiếp file `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_ai_studio\analysis.md`.
