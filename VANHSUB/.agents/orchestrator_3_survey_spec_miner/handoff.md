# Handoff Report: Khảo Sát & Khai Thác Đặc Tả Chế Độ Tiết Kiệm (ChatGPT Web Automation)

**Tác giả**: Spec Miner (Survey Phase - Orchestrator 3)  
**Ngày thực hiện**: 2026-09-17  
**Loại Handoff**: Hard Handoff (Hoàn tất khảo sát đặc tả)

---

## 1. Observation (Những gì trực tiếp quan sát được)

1. **Yêu cầu người dùng trong `ORIGINAL_REQUEST.md`** (`lines 103-155`):
   - Ngày giao: `2026-09-17T09:05:25Z`.
   - Mục tiêu: Triển khai "Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost)" cho AI Video Studio.
   - Các yêu cầu kỹ thuật cốt lõi:
     - R1: `ChatGptWebSessionManager` trên Electron Main process với partition vĩnh viễn `persist:chatgpt_session`, hỗ trợ cửa sổ offscreen (`-3000, -3000`) và Live Window.
     - R2: DOM automation tương tác an toàn với `#prompt-textarea`, `button[data-testid="send-button"]`, theo dõi `button[data-testid="stop-button"]`, trích xuất `[data-message-author-role="assistant"]`, và thuật toán Multi-turn Chunking.
     - R3: Mở rộng `AiStudioConfig.llm` với `provider: 'chatgpt_web'`, `chatgptWebMode: 'offscreen' | 'visible'`, tích hợp vào công đoạn 2 của `AiStudioPipelineEngine`.
     - R4: Nâng cấp UI Settings (`AiStudioSettingsTab`), nút Đăng nhập, đèn báo trạng thái, checkbox Live Window, và huy hiệu "⚡ Chế độ tiết kiệm" trên AutoPilot & Custom Studio.
     - Acceptance Criteria: Typecheck `npx tsc --noEmit` đạt 100%, có script kiểm thử `scripts/test_chatgpt_web_automation.ts`.

2. **Cấu trúc kiểu dữ liệu hiện tại trong `main/ai-studio/types.ts` & `renderer/types/aiStudio.ts`**:
   - `main/ai-studio/types.ts:10`: `export type LlmProvider = 'deepseek' | 'openai' | 'custom';`
   - `main/ai-studio/types.ts:12-25`: `AiStudioLlmConfig` gồm `provider`, `apiKey`, `model`, `baseUrl`, `temperature`, `systemPromptPreset`. Chưa có `'chatgpt_web'` và `chatgptWebMode`.
   - `main/ai-studio/types.ts:254-265`: Pipeline gồm 8 stage: `1: source`, `2: script`, `3: voice`, `4: alignment`, `5: storyboard`, `6: visuals`, `7: render`, `8: metadata`.
   - `main/ai-studio/types.ts:268-283`: `ScriptBeatLine` định nghĩa `{ id, index, text, startMs, endMs, durationMs, estimatedDurationSec, beatType }`.

3. **Kiến trúc Session & Window Automation tham chiếu trong `main/veo/GoogleVeoSessionManager.ts`**:
   - `line 44-45`: Định nghĩa hằng số offscreen `OFFSCREEN_X = -3000; OFFSCREEN_Y = -3000;`.
   - `line 317-322`: Khởi tạo `BrowserWindow` với `partition: 'persist:google_veo'`, `nodeIntegration: false`, `contextIsolation: true`, `backgroundThrottling: false`.
   - `line 326`: Thiết lập User-Agent desktop tiêu chuẩn `CHROME_DESKTOP_UA`.
   - `line 332-340`: Loại bỏ cờ WebDriver: `delete Object.getPrototypeOf(navigator).webdriver;`.
   - `line 344-348`: Lắng nghe sự kiện cookie thay đổi qua `ses.cookies.on('changed')` để tự động đồng bộ trạng thái xác thực.

4. **Trạng thái lưu trữ cấu hình trong `main/store/aiStudioStore.ts`**:
   - Lưu trữ riêng biệt tại `vanhsub-ai-studio.json`.
   - Mã hóa khóa bí mật bằng hardware DPAPI (`safeStorage.encryptString`) hoặc headless base64 fallback (`enc:v1:`).
   - Cơ chế deep merge `updateAiStudioConfig` giữ nguyên các sibling fields khi cập nhật từng phần.

5. **Trạng thái điều phối Pipeline trong `main/ai-studio/AiStudioPipelineEngine.ts`**:
   - `line 431-438`: Stage 2 hiện tại chỉ gọi `aiStudioLlmService.generateScript(session.topic, config.llm)` qua HTTP API.
   - Chưa có nhánh rẽ cho `config.llm.provider === 'chatgpt_web'`.

---

## 2. Logic Chain (Chuỗi suy luận logic từ quan sát tới kết luận)

1. **Từ Observation 1 & 2**: Để hệ thống nhận diện được tùy chọn ChatGPT Web, `LlmProvider` và `LlmProviderType` tại cả backend (`main/ai-studio/types.ts`) và frontend (`renderer/types/aiStudio.ts`) phải được nới rộng thêm union value `'chatgpt_web'`. Đồng thời `AiStudioLlmConfig` cần bổ sung trường `chatgptWebMode?: 'offscreen' | 'visible'`.
2. **Từ Observation 3**: Codebase Vanhsub đã giải quyết hoàn chỉnh bài toán Chromium Browser Automation không bị phát hiện bot trong `GoogleVeoSessionManager.ts`. Mô hình này (`BrowserWindow` với tọa độ `-3000, -3000`, `backgroundThrottling: false`, xóa `navigator.webdriver`, lắng nghe cookie `ses.cookies.on('changed')`) có thể tái sử dụng trực tiếp để xây dựng `ChatGptWebSessionManager.ts` với phân vùng `persist:chatgpt_session`.
3. **Từ Observation 1 & 4**: Do ChatGPT Web là giải pháp Zero API Cost, khi người dùng chọn `chatgpt_web`, không cần yêu cầu `apiKey`. Giao diện Cài đặt cần ẩn các trường API Key, Model, Base URL và hiển thị bảng điều khiển trạng thái đăng nhập session.
4. **Từ Observation 1 & 5**: Tại công đoạn 2 (`script`) của `AiStudioPipelineEngine.ts`, cần chèn logic kiểm tra `config.llm.provider === 'chatgpt_web'`. Nếu đúng, kiểm tra trạng thái `checkLoginStatus()`. Nếu đã đăng nhập, ủy quyền tác vụ cho `ChatGptWebAutomationService.generateScript()`; nếu chưa đăng nhập, kích hoạt popup đăng nhập và tạm dừng/báo lỗi có hướng dẫn người dùng.
5. **Từ Observation 1 & Edge Cases E1-E6**: Web miễn phí của ChatGPT thường gặp các thách thức: Cloudflare Turnstile, timeout khi mạng giật, React 18 bỏ qua input thông thường, và token limit cắt cụt JSON. Do đó, hệ thống bắt buộc phải có: (a) Cơ chế tự động đưa cửa sổ lên màn hình khi gặp Captcha, (b) Sử dụng native prototype setter + dispatch input events, (c) Multi-turn Chunking chia nhỏ kịch bản, và (d) Thư viện `jsonrepair` vá cú pháp JSON.

---

## 3. Caveats (Khu vực chưa khảo sát, Giả định, Diễn giải thay thế)

- **Giả định về DOM của ChatGPT**: Giao diện của ChatGPT Web thay đổi định kỳ (A/B testing của OpenAI). Do đó, bộ selectors (`#prompt-textarea`, `button[data-testid="send-button"]`, `button[data-testid="stop-button"]`) cần hỗ trợ danh sách fallback linh hoạt (self-healing array of selectors).
- **Khu vực chưa can thiệp trong survey**: Không chạy trực tiếp trình duyệt thật để tương tác với tài khoản live của người dùng trong bước khảo sát này nhằm tuân thủ nguyên tắc read-only. Thay vào đó, toàn bộ đặc tả được trích xuất dựa trên cơ chế automation mẫu đã kiểm chứng của `GoogleVeoSessionManager.ts`.
- **Phạm vi tính năng**: Bản đặc tả tập trung vào Stage 2 (Kịch bản). Stage 1 (Dữ kiện) và Stage 8 (SEO) vẫn có thể dùng procedural generator hoặc mở rộng sau nếu người dùng muốn.

---

## 4. Conclusion (Kết luận đánh giá kỹ thuật)

1. Yêu cầu triển khai "Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost)" hoàn toàn khả thi và đã có nền tảng vững chắc trong kiến trúc hiện tại của Vanhsub.
2. Việc triển khai chỉ cần mở rộng thêm các module chuyên biệt:
   - File Types: `main/ai-studio/types.ts` & `renderer/types/aiStudio.ts`.
   - File Session & Engine mới: `main/ai-studio/services/ChatGptWebSessionManager.ts` & `ChatGptWebAutomationService.ts`.
   - File IPC: `main/ai-studio/ipc.ts` (thêm 6 channels) & `main/preload.ts`.
   - Pipeline Hook: Cập nhật nhánh Stage 2 trong `main/ai-studio/AiStudioPipelineEngine.ts`.
   - UI Components: Cập nhật `AiStudioSettingsTab.tsx`, `AutoPilotView.tsx`, `CustomStudioView.tsx`.
   - Test Script: Tạo `scripts/test_chatgpt_web_automation.ts`.
3. Toàn bộ tài liệu phân tích chi tiết đã được biên soạn đầy đủ tại:  
   `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_spec_miner\analysis.md`.

---

## 5. Verification Method (Phương pháp kiểm chứng độc lập)

1. **Kiểm tra sự tồn tại và tính đầy đủ của báo cáo phân tích**:
   - File: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_spec_miner\analysis.md`
   - Kiểm tra các mục: 8 Mục báo cáo, Bảng 14 Features Discovered, Bảng 7 Edge Cases & Mitigation.
2. **Kiểm tra tính toàn vẹn của mã nguồn hiện tại (Bảo đảm Read-Only)**:
   - Lệnh kiểm tra: `git status --porcelain`
   - Tiêu chí: Không có file source code nào trong `main/` hay `renderer/` bị thay đổi.
3. **Kiểm tra biên dịch Type Check hiện tại**:
   - Lệnh: `npx tsc --noEmit`
   - Xác nhận trạng thái nền tảng sạch lỗi trước khi các agent triển khai bước tiếp theo.
