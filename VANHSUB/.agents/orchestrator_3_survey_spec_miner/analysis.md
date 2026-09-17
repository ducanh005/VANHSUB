# Báo Cáo Khảo Sát & Khai Thác Đặc Tả Kỹ Thuật (Specification Mining Report)
## Phân hệ: Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost) cho AI Video Studio

**Người thực hiện**: Spec Miner Agent (Survey Phase - Orchestrator 3)  
**Thời gian**: 2026-09-17T09:15:00Z  
**Dự án**: VANHSUB (Desktop Application - Electron + Next.js + TypeScript)  
**Tài liệu căn cứ**:
- `.agents/ORIGINAL_REQUEST.md` (Mục `2026-09-17T09:05:25Z` & `2026-09-17T06:24:37Z`)
- `AI_STUDIO_SPEC.md` (Đặc tả kiến trúc & quy chuẩn kỹ thuật AI Studio)
- Mã nguồn hiện tại: `main/ai-studio/`, `main/store/`, `renderer/components/ai-studio/`, `renderer/types/aiStudio.ts`, `main/veo/GoogleVeoSessionManager.ts`

---

## 1. TỔNG QUAN YÊU CẦU & BỐI CẢNH DỰ ÁN

### 1.1. Mục tiêu Nghiệp vụ
Tính năng **"Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost)"** cho phép người dùng ứng dụng Vanhsub sản xuất video hoàn chỉnh mà không tốn chi phí API token (OpenAI/DeepSeek API). Bằng cách tận dụng chính tài khoản ChatGPT Web miễn phí (hoặc tài khoản Plus cá nhân) của người dùng thông qua Electron Session & Browser Automation (tương tự tính năng Chế độ Tiết kiệm trên Revo Studio), hệ thống tự động:
1. Duy trì phiên đăng nhập ChatGPT lâu dài qua Electron session partition độc lập.
2. Tự động hóa nhập prompt và trích xuất kịch bản phân cảnh tiếng Việt có cấu trúc (JSON).
3. Hỗ trợ 2 chế độ hiển thị: Chạy ngầm (Offscreen) và Xem trực tiếp (Live Window).
4. Tích hợp liền mạch vào Công đoạn 2 (Kịch bản) của Pipeline 8 bước AI Video Studio.

### 1.2. Hiện trạng Codebase AI Studio
- **Config & Store**: Đã có `AiStudioConfig`, `aiStudioStore.ts` (mã hóa DPAPI an toàn, file `vanhsub-ai-studio.json`), `AiStudioSettingsTab.tsx`.
- **Pipeline Engine**: Đã có `AiStudioPipelineEngine.ts` với kiến trúc 8 bước (`source` $\rightarrow$ `script` $\rightarrow$ `voice` $\rightarrow$ `alignment` $\rightarrow$ `storyboard` $\rightarrow$ `visuals` $\rightarrow$ `render` $\rightarrow$ `metadata`), checkpoint state machine (`session.json`), cơ chế Upstream Preservation & Downstream Eviction.
- **LLM Service**: Đã có `AiStudioLlmService.ts` hỗ trợ gọi DeepSeek / OpenAI API với `jsonrepair` và procedural fallback generator.
- **Session Management mẫu**: Đã có `GoogleVeoSessionManager.ts` làm chuẩn mẫu tham chiếu cho Electron Partition (`persist:google_veo`), offscreen window (`OFFSCREEN_X = -3000, OFFSCREEN_Y = -3000`), user-agent spoofing, anti-detection (`delete navigator.webdriver`), và event-driven cookie synchronization.
- **Điểm còn thiếu để triển khai ChatGPT Web**:
  1. Chưa có kiểu `chatgpt_web` trong `LlmProvider` / `LlmProviderType`.
  2. Chưa có session manager cho ChatGPT (`ChatGptWebSessionManager.ts`) với partition `persist:chatgpt_session`.
  3. Chưa có service tự động hóa DOM (`ChatGptWebAutomationService.ts`) để tương tác với `https://chatgpt.com`.
  4. Chưa có các IPC channels kết nối cho ChatGPT Web (`aiStudio:chatgpt:*`).
  5. UI Cài đặt chưa có tùy chọn chọn ChatGPT Web, nút đăng nhập và chuyển đổi Live Window.

---

## 2. RÀ SOÁT CÁC ĐỊNH NGHĨA KIỂU DỮ LIỆU & SCHEMA CẦN MỞ RỘNG

### 2.1. Mở rộng `LlmProvider` & `AiStudioLlmConfig`
Cần cập nhật song song ở `main/ai-studio/types.ts` và `renderer/types/aiStudio.ts`:

```typescript
// 1. Mở rộng Provider Type
export type LlmProvider = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web';
export type LlmProviderType = LlmProvider;

// 2. Chế độ hiển thị cửa sổ ChatGPT Web
export type ChatGptWebMode = 'offscreen' | 'visible';

// 3. Mở rộng AiStudioLlmConfig
export interface AiStudioLlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  systemPromptPreset: string;
  
  // Thuộc tính bổ sung cho Chế độ Tiết kiệm
  chatgptWebMode?: ChatGptWebMode;          // Mặc định: 'offscreen'
  chatgptWebTimeoutMs?: number;             // Timeout sinh văn bản (mặc định 90000ms)
  chatgptWebAutoLoginPrompt?: boolean;      // Tự bật popup khi chưa đăng nhập (mặc định true)
}
```

### 2.2. Hợp đồng Trạng thái Phiên (Session State Contracts)

```typescript
export type ChatGptAuthStatus = 
  | 'unauthenticated' 
  | 'authenticating' 
  | 'authenticated' 
  | 'challenge_required' 
  | 'error';

export interface ChatGptWebStatusResult {
  isLoggedIn: boolean;
  authStatus: ChatGptAuthStatus;
  mode: ChatGptWebMode;
  userEmail?: string;
  accountType?: 'free' | 'plus' | 'unknown';
  isReady: boolean;
  errorMessage?: string;
}

export interface ChatGptWebLoginPayload {
  forceVisible?: boolean;
}

export interface ChatGptWebLoginResult {
  success: boolean;
  isLoggedIn: boolean;
  error?: string;
}

export interface ChatGptGenerateScriptPayload {
  topic: string;
  preset?: string;
  timeoutMs?: number;
  multiTurn?: boolean;
}

export interface ChatGptGenerateScriptResult {
  lines: ScriptBeatLine[];
  rawSummary?: string;
  turnCount: number;
  source: 'chatgpt_web';
}
```

---

## 3. THIẾT KẾ KIẾN TRÚC ELECTRON SESSION & BROWSER AUTOMATION

### 3.1. `ChatGptWebSessionManager` (Electron Main Process)
- **Session Partition**: `persist:chatgpt_session`
  - Đảm bảo độc lập hoàn toàn với `persist:google_veo` và partition mặc định của ứng dụng.
  - Lưu giữ cookie đăng nhập (NextAuth session token, Cloudflare tokens) vĩnh viễn trên đĩa qua AppData của Electron.
- **Quản lý Cửa sổ (`BrowserWindow`)**:
  - `chatgptWindow: BrowserWindow | null` (Lazy Singleton).
  - WebPreferences:
    ```typescript
    webPreferences: {
      partition: 'persist:chatgpt_session',
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // Bắt buộc: Ngăn Chromium hạ xung nhịp / ngắt timer khi chạy ẩn
    }
    ```
  - **Tọa độ Offscreen**: `x: -3000, y: -3000`, `width: 1200, height: 800`.
  - **Tọa độ Live Window**: Căn giữa màn hình hoặc hiển thị cửa sổ độc lập với tiêu đề `"ChatGPT Web - Chế độ Tiết kiệm Vanhsub"`.
- **Evasion & Anti-bot Stealth**:
  - User-Agent: Chrome Desktop tiêu chuẩn (`CHROME_DESKTOP_UA`).
  - Xóa cờ WebDriver trên `dom-ready`:
    ```javascript
    delete Object.getPrototypeOf(navigator).webdriver;
    if (navigator.webdriver) {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    }
    ```
- **Phát hiện Trạng thái Đăng nhập (`checkLoginStatus`)**:
  - Tiêu chí 1 (Cookies): Kiểm tra tồn tại các cookie `__Secure-next-auth.session-token`, `__Host-next-auth.csrf-token`.
  - Tiêu chí 2 (DOM probe): Kiểm tra sự hiện diện của `#prompt-textarea` hoặc nút hồ sơ người dùng (`data-testid="profile-button"`), đồng thời không xuất hiện form "Log in" / "Sign up".

### 3.2. Động cơ Tự Động Hóa DOM & Trích Xuất Kịch Bản (`ChatGptWebAutomationEngine`)
1. **Bộ chọn phần tử (Self-Healing DOM Selectors)**:
   - Ô nhập chat: `#prompt-textarea`, `div[contenteditable="true"]`, `textarea[data-id="root"]`.
   - Nút gửi: `button[data-testid="send-button"]`, `button[aria-label="Send prompt"]`, `button[aria-label="Send message"]`.
   - Nút dừng sinh (Stop button): `button[data-testid="stop-button"]`, `button[aria-label="Stop generating"]`.
   - Khối câu trả lời Assistant: `[data-message-author-role="assistant"]`, `article[data-testid^="conversation-turn"] .markdown`.
2. **Kích hoạt React Synthetic Event**:
   - ChatGPT sử dụng React 18 controlled components, việc chỉ gán `textarea.value = ...` sẽ bị bỏ qua.
   - Cơ chế giải quyết: Sử dụng prototype setter bản địa kết hợp dispatch `input`, `change` và `keydown`:
     ```javascript
     const proto = window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : Object.getPrototypeOf(el);
     const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
     if (setter) setter.call(el, promptText);
     else el.innerText = promptText;
     el.dispatchEvent(new Event('input', { bubbles: true }));
     el.dispatchEvent(new Event('change', { bubbles: true }));
     ```
   - Dự phòng (Fallback): Sử dụng Electron `webContents.sendInputEvent` để truyền phím thực tế.
3. **Vòng lặp Lắng nghe Hoàn thành (Completion Loop)**:
   - Chờ `stop-button` xuất hiện (xác nhận AI bắt đầu sinh).
   - Polling mỗi 400ms kiểm tra:
     - `stop-button` biến mất.
     - Nút copy / thumbs-up xuất hiện ở message cuối.
     - Chiều dài văn bản của khối phản hồi ổn định trong 2 lượt kiểm tra liên tiếp.
4. **Thuật toán Multi-Turn Chunking (Revo Studio Strategy)**:
   - Bản web miễn phí có giới hạn độ dài phản hồi (max output tokens) và dễ bị ngắt giữa chừng nếu yêu cầu viết 50-70 câu cùng lúc kèm JSON.
   - Thuật toán chia nhịp:
     - **Lượt 1 (Hook & Mở đầu)**: Yêu cầu 4-6 câu đầu (Hook + Intro).
     - **Lượt 2 (Thân bài & Cao trào)**: Gửi tiếp câu lệnh nối tiếp trong cùng session chat: `"Viết tiếp các câu tiếp theo từ index X đến Y theo đúng định dạng JSON..."`.
     - **Lượt 3 (Kết bài & CTA)**: Gửi câu kết và Outro.
   - Bộ ghép kịch bản (Stitcher): Nối các mảng JSON, chuẩn hóa lại chỉ số `index: 1..N`, tính toán thời lượng ước tính `estimatedDurationSec` nếu chưa có.

---

## 4. DANH SÁCH IPC CHANNELS CẦN THIẾT

Hệ thống bổ sung 6 kênh IPC mới chuyên trách cho ChatGPT Web, được đăng ký tại `main/ai-studio/ipc.ts` và bộc lộ qua `main/preload.ts`:

| # | IPC Channel | Chiều | Payload Đầu Vào | Kết Quả Đầu Ra | Mục Đích |
|---|---|---|---|---|---|
| **1** | `aiStudio:chatgpt:checkStatus` | Renderer $\rightarrow$ Main | `{}` | `ChatGptWebStatusResult` | Kiểm tra trạng thái đăng nhập, partition và chế độ hiển thị |
| **2** | `aiStudio:chatgpt:openLogin` | Renderer $\rightarrow$ Main | `{ forceVisible?: boolean }` | `ChatGptWebLoginResult` | Mở cửa sổ đăng nhập ChatGPT để người dùng thao tác |
| **3** | `aiStudio:chatgpt:closeLogin` | Renderer $\rightarrow$ Main | `{}` | `{ success: boolean }` | Ẩn hoặc đóng cửa sổ đăng nhập khi hoàn thành |
| **4** | `aiStudio:chatgpt:generateScript`| Renderer $\rightarrow$ Main | `ChatGptGenerateScriptPayload` | `ChatGptGenerateScriptResult` | Yêu cầu sinh kịch bản trực tiếp qua ChatGPT Web |
| **5** | `aiStudio:chatgpt:setMode` | Renderer $\rightarrow$ Main | `{ mode: 'offscreen' \| 'visible' }` | `{ success: boolean; mode: string }` | Chuyển đổi giữa chế độ chạy ngầm và xem trực tiếp |
| **6** | `aiStudio:chatgpt:clearSession` | Renderer $\rightarrow$ Main | `{}` | `{ success: boolean }` | Xóa cookies phiên ChatGPT Web (Đăng xuất) |

*Ghi chú*: Khi trạng thái xác thực thay đổi, Main process phát sự kiện push:  
`event.sender.send('aiStudio:chatgpt:statusChanged', statusPayload)`.

---

## 5. TÍCH HỢP VÀO PIPELINE ENGINE & GIAO DIỆN NGƯỜI DÙNG

### 5.1. Tích hợp Công đoạn 2 trong `AiStudioPipelineEngine`
Tại `runPipelineLoop` bước `stage === 2` (`script`):
```typescript
if (config.llm.provider === 'chatgpt_web') {
  onProgress({
    sessionId: session.sessionId,
    stage: 2,
    stageName: 'Kịch bản (ChatGPT Web - Chế độ Tiết kiệm)',
    progress: 15,
    status: 'running',
    message: '⚡ Đang ủy quyền sinh kịch bản qua ChatGPT Web (Zero API Cost)...',
  });
  
  // Kiểm tra đăng nhập
  const auth = await chatGptWebSessionManager.checkLoginStatus();
  if (!auth.isLoggedIn) {
    if (config.llm.chatgptWebAutoLoginPrompt !== false) {
      await chatGptWebSessionManager.openLoginWindow();
    }
    throw new Error('Chưa đăng nhập ChatGPT Web. Vui lòng hoàn tất đăng nhập trên cửa sổ ChatGPT để tiếp tục.');
  }

  // Thực thi sinh qua trình duyệt
  const scriptLines = await chatGptWebAutomationService.generateScript(session.topic, config.llm);
  session.artifacts.scriptLines = scriptLines;
} else {
  // Chạy qua API truyền thống (DeepSeek / OpenAI)
  const scriptLines = await aiStudioLlmService.generateScript(session.topic, config.llm);
  session.artifacts.scriptLines = scriptLines;
}
```

### 5.2. Nâng cấp Giao diện (UI Enhancements)
1. **Tab Cài đặt (`AiStudioSettingsTab.tsx`)**:
   - Thêm lựa chọn vào combobox: `<option value="chatgpt_web">ChatGPT Web (Chế độ tiết kiệm - Miễn phí 100%)</option>`.
   - Khi chọn `chatgpt_web`, ẩn các ô nhập API Key / Base URL / Model.
   - Hiển thị bảng điều khiển phiên ChatGPT Web:
     - Huy hiệu trạng thái: Xanh (Đã đăng nhập) / Xám hoặc Vàng (Chưa đăng nhập).
     - Nút "Đăng nhập ChatGPT Web" (mở cửa sổ).
     - Checkbox: "Xem trực tiếp AI gõ chữ (Live Window)".
2. **AutoPilotView & CustomStudioView**:
   - Hiển thị huy hiệu thông báo: `⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí`.
   - Kiểm tra sớm: Nếu cấu hình là `chatgpt_web` mà chưa đăng nhập, hiển thị nút bấm nhắc đăng nhập ngay trên banner trước khi bấm "Bắt đầu sản xuất".

---

## 6. DANH MỤC CÁC TÍNH NĂNG KHAI THÁC (FEATURES DISCOVERED)

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Configuration | `chatgpt_web` Provider Enum | Cho phép cấu hình LLM chọn chế độ ChatGPT Web miễn phí | Chuỗi `'chatgpt_web'` trong `AiStudioConfig.llm.provider` | Config hợp lệ được lưu trong `vanhsub-ai-studio.json` | Ném lỗi nếu giá trị không thuộc enum hợp lệ | `ORIGINAL_REQUEST.md:130` & `types.ts:10` |
| 2 | Configuration | `chatgptWebMode` Setting | Thiết lập hiển thị cửa sổ: offscreen (-3000, -3000) hoặc visible | `'offscreen' \| 'visible'` | Áp dụng vào vị trí BrowserWindow | Mặc định quay về `'offscreen'` nếu null/undefined | `ORIGINAL_REQUEST.md:132` |
| 3 | Session Management | Partition `persist:chatgpt_session` | Lưu trữ vĩnh viễn cookie, LocalStorage, auth token của tài khoản ChatGPT | Đường dẫn userData Electron | Phân vùng session tách biệt hoàn toàn với Google Veo | Tạo thư mục partition mới nếu chưa tồn tại | `ORIGINAL_REQUEST.md:113` & `GoogleVeoSessionManager.ts:82` |
| 4 | Session Management | Login Window Lifecycle | Mở cửa sổ đăng nhập hỗ trợ Google, Microsoft, Apple, Email/Password | `openLoginWindow({ forceVisible: true })` | Cửa sổ BrowserWindow hiển thị `https://chatgpt.com` | Tự bắt lỗi crash, kích hoạt crash watchdog | `ORIGINAL_REQUEST.md:114` |
| 5 | Session Management | Auto Login Detection | Tự động phát hiện khi người dùng đăng nhập thành công qua cookie và DOM | Lắng nghe `ses.cookies.on('changed')` & `did-navigate` | Trạng thái `isLoggedIn: true` kèm thông báo UI | Giữ trạng thái `isLoggedIn: false` nếu chưa thấy token | `ORIGINAL_REQUEST.md:115` |
| 6 | DOM Automation | Dynamic Prompt Textarea Injection | Nhập nội dung prompt vào `#prompt-textarea` bằng React native setter | Chuỗi text prompt phân cảnh | Textarea nhận text, kích hoạt state React | Fallback sang `webContents.sendInputEvent` | `ORIGINAL_REQUEST.md:122` & `FlowElementFinder.ts` |
| 7 | DOM Automation | Send Button Trigger | Tự kích hoạt nút gửi sau khi text được nhận diện | Nút `button[data-testid="send-button"]` | Kích hoạt sự kiện submit, bắt đầu sinh | Báo lỗi nếu nút gửi bị disable sau 3s thử lại | `ORIGINAL_REQUEST.md:124` |
| 8 | DOM Automation | Stop Button Monitoring | Lắng nghe trạng thái sinh văn bản qua sự xuất hiện và biến mất của stop-button | Nút `button[data-testid="stop-button"]` | Báo hiệu hoàn tất sinh câu trả lời | Timeout 90s kích hoạt Abort nếu stop-button kẹt | `ORIGINAL_REQUEST.md:125` |
| 9 | DOM Automation | Assistant Content Extractor | Trích xuất toàn bộ câu trả lời từ khối `[data-message-author-role="assistant"]` | Thẻ DOM phản hồi của AI | Chuỗi raw text chứa JSON kịch bản | Báo lỗi nếu khối phản hồi rỗng hoặc bị xóa | `ORIGINAL_REQUEST.md:126` |
| 10 | Script Processing | Multi-turn Chunking Engine | Chia kịch bản dài thành các phân đoạn nhỏ gửi liên tiếp trong cùng 1 hội thoại | Danh sách ý tưởng / số câu yêu cầu | Kịch bản 4-8 câu hoàn chỉnh không bị cắt ngắn | Tự động thử lại lượt sinh bị thiếu câu | `ORIGINAL_REQUEST.md:127` |
| 11 | Script Processing | Resilient JSON Repair | Sửa lỗi cú pháp JSON chưa đóng ngoặc hoặc lẫn markdown fence | Chuỗi văn bản từ ChatGPT Assistant | Mảng `ScriptBeatLine[]` hợp lệ | Fallback sang procedural generator nếu hỏng nặng | `AiStudioLlmService.ts:161` & `jsonrepair` |
| 12 | Pipeline Integration | Stage 2 Provider Router | Tự động chuyển tiếp luồng sinh kịch bản qua ChatGPT Web khi provider được chọn | `config.llm.provider === 'chatgpt_web'` | Chuyển dữ liệu sang `session.artifacts.scriptLines` | Nhắc đăng nhập nếu chưa có session | `ORIGINAL_REQUEST.md:133` & `AiStudioPipelineEngine.ts:431` |
| 13 | UI Components | Zero API Cost Badge | Hiển thị huy hiệu thông báo chế độ tiết kiệm trên giao diện | Trạng thái cấu hình đang dùng `chatgpt_web` | Badge trực quan kèm icon tia sét ⚡ | Ẩn badge nếu chuyển sang DeepSeek/OpenAI | `ORIGINAL_REQUEST.md:141` |
| 14 | UI Components | Live Window Toggle Checkbox | Cho phép người dùng bật/tắt cửa sổ trực tiếp xem AI gõ chữ thời gian thực | Checkbox state (boolean) | Thay đổi tọa độ x, y của cửa sổ ChatGPT tức thời | Đảm bảo không mất focus cửa sổ chính | `ORIGINAL_REQUEST.md:139` |

---

## 7. CÁC TRƯỜNG HỢP BIÊN & PHÒNG THỦ LỖI (EDGE CASES & MITIGATION)

| # | Feature | Input / Tình Huống | Hành Vi Quan Sát Được & Rủi Ro | Chiến Lược Phòng Thủ Đề Xuất (Mitigation) |
|---|---|---|---|---|
| **E1** | **Cloudflare / Turnstile Challenge** | Cửa sổ đang chạy ở chế độ ngầm (`offscreen`) gặp xác minh "Verify you are human" | Trình duyệt bị chặn vô thời hạn, không vào được ô chat, pipeline bị treo timeout. | Phát hiện iframe Cloudflare / Turnstile qua DOM probe. Lập tức chuyển tọa độ cửa sổ về màn hình chính (`x: 100, y: 100`), đưa lên trên (focus) và thông báo: *"Vui lòng hoàn thành xác minh Cloudflare trên cửa sổ vừa hiện"*. Khi xác minh xong, tự động đưa về offscreen. |
| **E2** | **Hết hạn Phiên Đăng Nhập (Session Expired)** | Token hết hạn, ChatGPT tự điều hướng về `/auth/login` giữa lúc đang chạy pipeline | Không tìm thấy `#prompt-textarea`, thao tác gửi prompt thất bại. | Lắng nghe sự kiện `did-navigate`: nếu URL chứa `/auth/` hoặc nút "Log in" xuất hiện, cập nhật `isLoggedIn = false`, dừng công đoạn 2 và hiển thị popup yêu cầu đăng nhập lại kèm checkpoint phục hồi. |
| **E3** | **Giới hạn Tần suất (Rate Limit / "You've reached our limit")** | Tài khoản Free gửi quá nhiều tin nhắn trong 1 giờ hoặc hết hạn mức GPT-4o free | Assistant trả về thông báo lỗi màu đỏ hoặc văn bản "You've reached our limit for today". | Bắt mẫu chuỗi lỗi trong tin nhắn của Assistant (`limit`, `too many requests`). Đánh dấu lỗi `RATE_LIMIT_EXCEEDED` và hiển thị khuyến nghị: *"Đã hết lượt miễn phí của phiên này, bạn có thể chờ hoặc tạm chuyển sang DeepSeek API"*. |
| **E4** | **Nút Dừng Sinh Bị Treo (Stop-button Hanging)** | Mạng chập chờn hoặc bản web gặp lỗi streaming, nút stop không biến mất sau thời gian dài | Pipeline kẹt vô tận ở công đoạn 2. | Thiết lập Hard Timeout (90 giây). Nếu sau 90s vẫn còn `stop-button`, tự động click vào `stop-button` để dừng, kiểm tra xem nội dung đã sinh đủ điều kiện parse chưa; nếu chưa, kích hoạt retry 1 lần. |
| **E5** | **React 18 State Bỏ Qua Thao Tác DOM** | Gán `.value` thuần túy bằng JavaScript không kích hoạt React Synthetic onChange | Nút Send vẫn bị xám (`disabled`), không gửi được prompt. | Áp dụng `nativeInputValueSetter` trên prototype của `HTMLTextAreaElement` kèm dispatch sự kiện `input` và `change`. Đồng thời dự phòng bằng cách gửi phím mô phỏng `sendInputEvent` từ `webContents`. |
| **E6** | **Ngắt Cụt JSON do Giới Hạn Token (Token Truncation)** | ChatGPT trả về JSON dài nhưng bị ngắt cụt ở giữa dòng (thiếu dấu đóng `]}`) | `JSON.parse` tiêu chuẩn bị sụp đổ (SyntaxError). | Sử dụng thư viện `jsonrepair` đã tích hợp sẵn trong dự án để tự động vá các ngoặc bị khuyết. Nếu số câu hợp lệ < 3 câu, tự động kích hoạt bộ sinh dự phòng `generateFallbackScript` để pipeline không bị đứt đoạn. |
| **E7** | **Sự Cố Crash Cửa Sổ Trình Duyệt (Renderer Process Crash)** | Tab web của ChatGPT bị lỗi Out-Of-Memory hoặc WebContents crash | BrowserWindow bị destroy, mất kết nối IPC. | Triển khai Crash Watchdog tương tự `GoogleVeoSessionManager.ts`: lắng nghe sự kiện `render-process-gone`, ghi log chẩn đoán và tự động tái tạo lại cửa sổ mới từ partition `persist:chatgpt_session`. |

---

## 8. KẾT LUẬN & ĐỀ XUẤT CHO CÁC PHA TIẾP THEO

1. **Tính khả thi**: Dự án Vanhsub đã có đầy đủ nền tảng kiến trúc (Electron Session isolation, Window coordinates management, DPAPI storage, resilient JSON parsing) nên việc triển khai Chế độ Tiết kiệm hoàn toàn tương thích và không phá vỡ bất kỳ thành phần hiện hữu nào.
2. **Kế hoạch triển khai đề xuất cho Dev Team**:
   - **Giai đoạn 1 (Types & Store)**: Mở rộng `LlmProvider` có `'chatgpt_web'`, bổ sung `chatgptWebMode` vào schema, đảm bảo type-check 100%.
   - **Giai đoạn 2 (Session Manager & DOM Engine)**: Viết `ChatGptWebSessionManager.ts` và `ChatGptWebAutomationService.ts` trong `main/ai-studio/services/`.
   - **Giai đoạn 3 (IPC & Pipeline Routing)**: Đăng ký 6 channels IPC, tích hợp nhánh `chatgpt_web` vào Stage 2 của `AiStudioPipelineEngine.ts`.
   - **Giai đoạn 4 (UI Integration)**: Nâng cấp `AiStudioSettingsTab.tsx`, `AutoPilotView.tsx`, `CustomStudioView.tsx`.
   - **Giai đoạn 5 (Verification Suite)**: Viết `scripts/test_chatgpt_web_automation.ts` kiểm thử toàn diện kịch bản mock và session partition.
