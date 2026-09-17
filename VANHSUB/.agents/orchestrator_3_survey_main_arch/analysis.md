# Báo Cáo Khảo Sát Kiến Trúc Electron Main Process Cho ChatGPT Web Automation

**Dự án**: VANHSUB Desktop Application (Nextron: Electron 43.4.1 + Next.js 16.3.2 + React 19)  
**Người thực hiện**: Explorer (Survey Phase - orchestrator_3)  
**Ngày hoàn thành**: 2026-09-17  
**Mục tiêu**: Khảo sát toàn diện kiến trúc Electron Main Process, học tập giải pháp từ `GoogleVeoSessionManager`, và thiết lập kiến trúc tối ưu cho `ChatGptWebSessionManager` cùng `ChatGptAutomationEngine` (tính năng "Chế độ Tiết kiệm - Zero API Cost").

---

## 1. Khảo Sát Cấu Trúc Electron Main Process

### 1.1. Cấu Trúc Thư Mục & Tổ Chức Mã Nguồn
Toàn bộ mã nguồn Main Process của ứng dụng nằm tại thư mục `d:\DEAN\DEAN\VANHSUB\main\`:

```
main/
├── main.ts                     # Entry point chính của Electron Main Process (1088 lines)
├── preload.ts                  # ContextBridge exposure cho Renderer Process (241 lines)
├── helpers/
│   ├── create-window.ts        # Helper khởi tạo BrowserWindow có gắn preload.js
│   ├── logger.ts               # Forwarding log từ Main sang Renderer terminal
│   ├── videoDownloader.ts      # Xử lý download yt-dlp
│   └── voiceFromUrl.ts
├── store/
│   ├── settingsStore.ts        # Lưu trữ cấu hình ứng dụng + mã hóa DPAPI safeStorage
│   ├── aiStudioStore.ts        # Dedicated Store cho AI Video Studio (AiStudioConfig)
│   ├── taskStore.ts            # Quản lý hàng đợi và tác vụ ASR/Dịch/Dubbing
│   └── voiceSampleStore.ts
├── veo/
│   ├── GoogleVeoSessionManager.ts  # Quản lý phiên Google Flow / Veo (2326 lines)
│   ├── GoogleVeoAntiSpamGuard.ts   # Bộ đếm hồi chiêu và giới hạn tần suất
│   └── types.ts
├── ai-studio/
│   ├── AiStudioPipelineEngine.ts   # Pipeline Engine 8 bước Auto-Pilot
│   ├── ipc.ts                      # Router IPC của AI Video Studio
│   ├── types.ts                    # Schemas và interfaces chính thức
│   └── services/
│       ├── AiStudioLlmService.ts   # Tích hợp OpenAI/DeepSeek API
│       ├── AiStudioTtsService.ts   # Tích hợp Edge-TTS
│       ├── AiStudioVisualService.ts# Kết nối Veo Flow sinh ảnh/video
│       └── AiStudioVideoAssembler.ts# Ghép video FFmpeg
├── workflow/
│   ├── ipc.ts                      # Router IPC cho Flow Workflow Graph
│   ├── executionEngine.ts          # Bộ thực thi đồ thị DAG
│   ├── dispatcher/                 # Mutex & Adapters
│   └── flow-engine/                # Động cơ Browser Automation Google Flow
├── tts-providers/
│   └── tiktok/
│       ├── sessionStores.ts        # ElectronTikTokSessionStore (mã hóa DPAPI)
│       └── TikTokTTSProvider.ts
└── asr/, audio/, ocr/, render/, translate/, utils/
```

### 1.2. Vòng Đời Ứng Dụng & Luồng Khởi Động (`main/main.ts`)
1. **Khởi tạo Scheme Privileged (trước khi app ready)**:
   - Scheme `app` (phục vụ Next.js tĩnh ở production qua `net.fetch`).
   - Scheme `vanhmedia` (stream file video/audio local với xử lý header `Range: bytes=...` phục vụ preview 206 Partial Content).
2. **Khởi động Session nền (`app.whenReady()`)**:
   - Dòng 193–197: Gọi `await GoogleVeoSessionManager.getInstance().init()` để đồng bộ cookie phân vùng Electron ngay khi bật app.
   - Gỡ kẹt các tác vụ cũ: `TaskStore.resetStaleRunning()`.
   - Tạo cửa sổ chính `mainWindow = createWindow('main', { ... })` tải URL `http://localhost:8888/home` (dev) hoặc `app://./home` (prod).
3. **Đăng ký IPC Handlers theo Module**:
   - Dòng 233: `registerWorkflowIpc()`
   - Dòng 238–239: `registerAiStudioIpc()` và gán `setAiStudioPipelineEngine(...)`
   - Dòng 710–773: Các IPC handlers của Google Veo (`veo:open-lobby`, `veo:status`, `veo:validate`, `veo:get-credits`, `veo:show-lobby-debug`, `veo:hide-lobby-offscreen`,...).

### 1.3. Cơ Chế Preload & Renderer Bridge (`main/preload.ts`)
- Electron áp dụng mô hình bảo mật chuẩn: `contextIsolation: true`, `nodeIntegration: false`.
- Toàn bộ API gọi từ giao diện React/Next.js đều đi qua đối tượng `window.vanhsub` được inject tại `preload.ts` dòng 239: `contextBridge.exposeInMainWorld('vanhsub', vanhsub)`.
- Các namespace hiện có trên `window.vanhsub`: `tasks`, `settings`, `ai`, `translate`, `export`, `ocr`, `tts`, `dubbing`, `tiktokTts`, `veo`, `models`, `dialog`, `downloader`, `files`, `logs`, `workflow`, `bible`, `aiStudio`.
- Định nghĩa kiểu TypeScript tương ứng nằm tại `renderer/types/electron.d.ts` (giao diện `VanhsubAPI` và mở rộng `declare global { interface Window { vanhsub: VanhsubAPI } }`).

---

## 2. Khảo Sát Chuyên Sâu Các Triển Khai Session Manager Hiện Có

Dự án hiện có 2 mô hình quản lý phiên đáng chú ý:
1. `GoogleVeoSessionManager` (`main/veo/GoogleVeoSessionManager.ts`): Quản lý phiên trình duyệt Google Flow phức tạp với phân vùng Electron, cookie xác thực, cửa sổ đăng nhập, chống bot và tự động hóa DOM.
2. `ElectronTikTokSessionStore` (`main/tts-providers/tiktok/sessionStores.ts`): Quản lý token/session ID đơn lẻ với mã hóa DPAPI an toàn.

### 2.1. Quản Lý Phân Vùng Electron (`session.fromPartition('persist:...')`)
- **Nguyên lý phân vùng**:
  - Khi dùng `session.fromPartition('persist:name')`, Electron cấp một phân vùng độc lập lưu bền vững trên ổ đĩa (trong thư mục `userData/Partitions/<name>`), tách biệt hoàn toàn với session mặc định của ứng dụng.
  - Cookie, LocalStorage, IndexedDB, Cache của phân vùng này không bị xóa khi tắt ứng dụng.
- **Cơ chế Two-Tier Persistence (Lưu trữ 2 tầng đối soát)**:
  - Tầng 1: Phân vùng Electron (`persist:google_veo`) quản lý cookie sống của Chromium.
  - Tầng 2: File cấu hình `vanhsub-settings` (`SettingsStore`) lưu chuỗi cookie đã mã hóa bằng DPAPI (`safeStorage`, tiền tố `enc:v1:`).
  - Khi khởi động (`init()`, dòng 162–183):
    1. Kiểm tra xem partition đã có cookie xác thực chưa (`GOOGLE_AUTH_COOKIE_NAMES`).
    2. Nếu partition trống (ví dụ người dùng xóa cache hoặc sau cập nhật), tự động gọi `restoreCookiesToPartition(ses)` đọc từ `SettingsStore` và dùng `ses.cookies.set(...)` để nạp lại đầy đủ các cookie vào Chromium.
    3. Lắng nghe `ses.cookies.on('changed')` để khi người dùng tương tác trong web, cookie mới được tự động đồng bộ ngược lại vào `SettingsStore`.

### 2.2. Vượt Rào Chống Bot & Spoofing User-Agent
Để tránh lỗi "Trình duyệt hoặc ứng dụng không an toàn" của Google / Cloudflare:
- **User-Agent Spoofing**: Cài đặt Chrome Desktop chuẩn (`Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36`) cho toàn bộ partition:
  ```ts
  ses.setUserAgent(CHROME_DESKTOP_UA);
  ```
- **Xóa Header Dấu Vết (`ses.webRequest.onBeforeSendHeaders`)**:
  - Dòng 273–304: Can thiệp request headers để loại bỏ các headers client-hints đặc trưng của Electron như `sec-ch-ua`, `sec-ch-ua-mobile`, `sec-ch-ua-platform`, `sec-ch-ua-full-version-list`.
  - Khi vào trang đăng nhập (`accounts.google.com`), tạm chuyển sang User-Agent Firefox sạch để tránh kiểm tra sâu.
- **Loại bỏ thuộc tính `navigator.webdriver`**:
  - Dòng 332–341: Lắng nghe `dom-ready` và tiêm script xóa thuộc tính webdriver:
  ```ts
  this.lobbyWindow.webContents.on('dom-ready', () => {
    this.lobbyWindow.webContents.executeJavaScript(`
      try {
        delete Object.getPrototypeOf(navigator).webdriver;
        if (navigator.webdriver) {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        }
      } catch (e) {}
    `).catch(() => {});
  });
  ```

### 2.3. Mở Cửa Sổ Đăng Nhập & Phát Hiện Thành Công
- **Thiết lập BrowserWindow**:
  - Dòng 306–323: Tạo cửa sổ với `webPreferences`:
    ```ts
    webPreferences: {
      partition: 'persist:...',
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false, // RẤT QUAN TRỌNG: Không bị bóp nghẽn JS khi ở background
    }
    ```
  - Cửa sổ là độc lập (`parent: undefined`, `modal: false`), giúp người dùng có thể thu nhỏ hoặc chuyển đổi cửa sổ mà không bị tắt.
- **Phát hiện đăng nhập thành công**:
  - Dòng 351–367: Lắng nghe sự kiện `did-navigate` của `webContents`:
    - Khi URL điều hướng từ các trang auth (`accounts.google.com` hoặc `/signin`) trở về trang dịch vụ chính (`flow.google.com` hoặc `labs.google`), hệ thống kích hoạt trích xuất cookie và gọi `validateSession()`.
  - Kiểm tra bộ cookie cốt lõi: Cookie phải chứa các token phiên (`SID`, `__Secure-1PSID`).
  - Gửi request probe siêu nhẹ (`executeHealthProbe` dòng 674–855): gửi request HEAD/GET với hard timeout 8 giây kiểm tra HTTP Status Code (200 = active, 302/redirect login = expired, 429 = rate_limited, trang có recaptcha = captcha_required).

### 2.4. Kỹ Thuật Quản Lý Cửa Sổ Ẩn (Offscreen) vs Trực Tiếp (Live Window)
Đây là một trong những phát hiện kiến trúc quan trọng nhất trong codebase Vanhsub:
- **Vấn đề của `show: false` (Headless thực sự)**:
  - Khi một `BrowserWindow` có thuộc tính `show: false`, Chromium sẽ kích hoạt cơ chế tiết kiệm tài nguyên nghiêm ngặt:
    1. Tạm dừng / giảm tần suất gọi `requestAnimationFrame` và `setTimeout`/`setInterval`.
    2. Không tính toán Layout/Reflow hoàn chỉnh, hàm `getBoundingClientRect()` của các phần tử DOM sẽ trả về `width = 0, height = 0, x = 0, y = 0`.
    3. Trình soạn thảo React (Lexical, ProseMirror, Slate) không kích hoạt được con trỏ và sự kiện bàn phím.
    4. Cloudflare Turnstile hoặc Captcha tự động gắn cờ bot vì cửa sổ không render pixel.
- **Giải pháp Tọa Độ Ngoài Màn Hình (Virtual Offscreen Positioning)**:
  - Định nghĩa tọa độ âm sâu ngoài màn hình:
    ```ts
    export const OFFSCREEN_X = -3000;
    export const OFFSCREEN_Y = -3000;
    ```
  - Cửa sổ vẫn được tạo với `show: true` (hoặc vị trí âm mặc định) và `backgroundThrottling: false`:
    ```ts
    this.lobbyWindow = new BrowserWindow({
      width: 1100,
      height: 800,
      x: OFFSCREEN_X,
      y: OFFSCREEN_Y,
      // ...
    });
    ```
  - **Lợi ích vượt trội**:
    - Đối với Chromium và hệ điều hành, đây là một cửa sổ bình thường đang hiển thị: Layout đầy đủ, tọa độ DOM chính xác, React State hoạt động hoàn hảo.
    - Đối với người dùng: Hoàn toàn vô hình vì tọa độ `(-3000, -3000)` nằm ngoài mọi màn hình vật lý.
  - **Chuyển đổi sang Live Window (Xem trực tiếp)**:
    - Khi người dùng muốn xem AI gõ chữ hoặc debug (dòng 2286–2304):
      ```ts
      this.lobbyWindow.setPosition(100, 100);
      this.lobbyWindow.show();
      this.lobbyWindow.focus();
      ```
    - Khi muốn đưa lại về chế độ ẩn (dòng 2307–2312):
      ```ts
      this.lobbyWindow.setPosition(OFFSCREEN_X, OFFSCREEN_Y);
      ```

### 2.5. Crash Watchdog & Tự Động Phục Hồi (AC-7)
- Dòng 393–434: `attachCrashWatchdog` lắng nghe sự kiện `render-process-gone`:
  - Nếu Chromium renderer bị crash (OOM, GPU hang), kiểm tra tần suất crash trong 30 giây (tránh crash-loop vô hạn).
  - Tự động hủy window cũ và gọi `openLobbyWindow()` để tạo mới lại một cách trong suốt (`handleRendererCrash`).

---

## 3. Thiết Kế Kiến Trúc Cho ChatGPT Web Automation

Dựa trên các yêu cầu tại `ORIGINAL_REQUEST.md` (R1 – R4) và khảo sát kiến trúc hiện tại, dưới đây là đề xuất chi tiết để triển khai Chế độ Tiết kiệm.

### 3.1. Vị Trí Lưu Trữ Tệp Đề Xuất
Tạo thư mục mới độc lập: `d:\DEAN\DEAN\VANHSUB\main\chatgpt\`:

```
main/chatgpt/
├── ChatGptWebSessionManager.ts   # Quản lý phiên, BrowserWindow, persist:chatgpt_session
├── ChatGptAutomationEngine.ts    # DOM Automation (#prompt-textarea, stop-button, Multi-turn Chunking)
├── ipc.ts                        # IPC router với helper safeHandle()
└── types.ts                      # Interface, types, status enums
```

**Lý do chọn `main/chatgpt/` thay vì đặt trong `main/ai-studio/services/`**:
1. **Phân tách trách nhiệm (Separation of Concerns)**: `main/ai-studio/` đóng vai trò điều phối pipeline 8 bước (Orchestrator). Các dịch vụ nền tảng cấp thấp (Veo, TikTok, ChatGPT) nên nằm ở các module domain riêng biệt.
2. **Khả năng tái sử dụng**: `ChatGptAutomationEngine` có thể được sử dụng trong tương lai cho các tính năng khác của Vanhsub (như Dịch phụ đề phụ trợ, Sửa lỗi chính tả Gemini fallback, hoặc Workflow custom nodes).
3. **Tính nhất quán cấu trúc**: Tuân thủ hoàn toàn mô hình kiến trúc của `main/veo/` và `main/tts-providers/tiktok/`.

### 3.2. Thiết Kế `ChatGptWebSessionManager.ts` (R1)
- **Cấu hình Phân vùng**:
  - Sử dụng partition vĩnh viễn: `persist:chatgpt_session`.
  - Tên cửa sổ: `ChatGPT Web - Chế độ Tiết Kiệm`.
  - Tọa độ ẩn: `OFFSCREEN_X = -3000, OFFSCREEN_Y = -3000`.
- **Vượt rào bảo vệ (Anti-Detection)**:
  - User-Agent Chrome Desktop chuẩn, cấu hình `backgroundThrottling: false`.
  - Xóa cờ `navigator.webdriver` trên `dom-ready`.
- **Cơ chế Quản lý Cửa sổ & Trạng thái Đăng nhập**:
  - Trạng thái phiên: `'unauthenticated' | 'logging_in' | 'active' | 'expired' | 'captcha_required'`.
  - Phương thức `openLoginWindow()`:
    - Khi người dùng bấm "Đăng nhập ChatGPT" từ UI Cài đặt, cửa sổ LUÔN được đưa về tọa độ màn hình nhìn thấy được (`x: 100, y: 100`, kích thước `1200x800`) và `focus()`.
    - Hỗ trợ toàn bộ hình thức đăng nhập của OpenAI: Google SSO, Microsoft, Apple, Email/Password.
  - Phương thức `ensureSessionReady(mode: 'offscreen' | 'visible')`:
    - Đảm bảo cửa sổ đã mở tại `https://chatgpt.com`.
    - Nếu `mode === 'offscreen'`, đặt cửa sổ tại `(-3000, -3000)`.
    - Nếu `mode === 'visible'`, đặt cửa sổ tại `(100, 100)`.
  - Phát hiện đăng nhập thành công:
    - Lắng nghe `did-navigate` & `did-navigate-in-page`: Khi URL là `https://chatgpt.com/` (hoặc `https://chatgpt.com/c/...`) và không còn chứa `/auth/`.
    - Kiểm tra DOM: Sự xuất hiện của `#prompt-textarea` hoặc profile button, không có nút `data-testid="login-button"`.
    - Trích xuất email tài khoản nếu có (`SettingsStore` hoặc `aiStudioStore`).
    - Nếu phát hiện thành công: chuyển trạng thái sang `'active'`.
  - Phương thức `clearSession()`: Xóa dữ liệu phân vùng `ses.clearStorageData()`.

### 3.3. Thiết Kế `ChatGptAutomationEngine.ts` (R2)
- **Self-Healing DOM Selectors**:
  - **Ô nhập (Prompt Input)**:
    - Tier 1: `#prompt-textarea`
    - Tier 2: `div#prompt-textarea[contenteditable="true"]`
    - Tier 3: `div[contenteditable="true"][data-placeholder]`
    - Tier 4: `textarea[data-id="root"]`
  - **Nút gửi (Send Button)**:
    - Tier 1: `button[data-testid="send-button"]`
    - Tier 2: `button[aria-label*="Send" i]`, `button[aria-label*="Gửi" i]`
    - Tier 3: Phím tắt bàn phím `Enter` (thông qua `sendInputEvent`).
  - **Dấu hiệu đang sinh (In-flight indicator)**:
    - Nút dừng: `button[data-testid="stop-button"]`, `button[aria-label*="Stop" i]`, `button[aria-label*="Dừng" i]`.
  - **Khối câu trả lời của trợ lý (Assistant Message Turn)**:
    - Tier 1: `[data-message-author-role="assistant"]`
    - Tier 2: `div.agent-turn`
    - Tier 3: Khối code `pre code.language-json` (nếu trả về JSON).
- **Cơ chế Input An toàn cho React/Lexical Editor**:
  - Tránh gán trực tiếp `.value = ...` vì Lexical/ProseMirror của ChatGPT sẽ không cập nhật Virtual DOM.
  - Sử dụng phối hợp:
    1. Focus vào phần tử `#prompt-textarea`.
    2. Kích hoạt lệnh `document.execCommand('selectAll', false, null)`.
    3. Gọi `document.execCommand('insertText', false, text)` hoặc sử dụng `webContents.insertText(text)`.
    4. Bắn sự kiện `new Event('input', { bubbles: true })` và `new Event('change', { bubbles: true })`.
- **Cơ chế Chờ Đợi Sinh Văn Bản (Smart Polling & Text Stability Check)**:
  1. Sau khi bấm Send, thăm dò trong tối đa 10s cho tới khi `stop-button` xuất hiện HOẶC text của assistant bắt đầu tăng độ dài.
  2. Tiếp tục chờ cho tới khi `stop-button` biến mất (hoặc send-button xuất hiện trở lại).
  3. **Stability Gate**: Đảm bảo độ dài chuỗi text của assistant không thay đổi trong ít nhất 1500ms (chống trường hợp AI bị ngắt mạng tạm thời rồi sinh tiếp).
- **Thuật toán Multi-turn Chunking (Cho kịch bản dài)**:
  - Bản ChatGPT Web miễn phí có giới hạn ngữ cảnh mỗi lượt trả lời (~1000-1500 tokens). Nếu yêu cầu sinh kịch bản chi tiết 8 phân cảnh cùng lúc, câu trả lời thường bị cắt cụt giữa chừng.
  - Quy trình Chunking 2 lượt trong cùng một phiên chat (`chatgpt.com/c/...`):
    - **Lượt 1 (Outline & Hook)**: Gửi prompt yêu cầu tóm tắt hook và khung các phân cảnh (Beats).
    - **Lượt 2 (Chi tiết phân cảnh JSON)**: Gửi prompt tiếp nối: *"Dựa trên cấu trúc trên, hãy viết chi tiết lời thoại từng câu từ phân cảnh 1 đến hết dưới dạng mảng JSON thuần `[{ "lineIndex": 1, "text": "...", "estimatedDurationSec": 3 }]`"*.
    - Thu thập toàn bộ nội dung JSON, chạy qua `jsonrepair` để vá các lỗi cú pháp JSON thường gặp.

### 3.4. Danh Sách IPC Handlers Cần Đăng Ký (`main/chatgpt/ipc.ts`)
Sử dụng pattern `safeHandle` để chống trùng lặp:

| Channel IPC | Tham số | Kết quả trả về | Mô tả |
| :--- | :--- | :--- | :--- |
| `chatgpt:open-login` | `{ mode?: 'visible' \| 'offscreen' }` | `{ ok: boolean, status: string }` | Mở cửa sổ ChatGPT Web để đăng nhập |
| `chatgpt:get-status` | Không | `ChatGptStatusPayload` | Lấy trạng thái đăng nhập, email, chế độ |
| `chatgpt:validate-session` | Không | `ChatGptValidationResult` | Kiểm tra kết nối và cookie sống |
| `chatgpt:set-display-mode` | `mode: 'offscreen' \| 'visible'` | `{ ok: boolean }` | Chuyển đổi vị trí cửa sổ giữa ẩn và hiện |
| `chatgpt:clear-session` | Không | `{ ok: boolean }` | Xóa phiên đăng nhập và cookie |
| `chatgpt:generate-script` | `{ topic: string, options?: any }` | `{ ok: boolean, scriptLines: ScriptBeatLine[] }` | Gọi sinh kịch bản độc lập |

**Đăng ký trong `main/main.ts`**:
```ts
import { registerChatGptIpc } from './chatgpt/ipc';
import { ChatGptWebSessionManager } from './chatgpt/ChatGptWebSessionManager';

// Trong app.whenReady():
await ChatGptWebSessionManager.getInstance().init();

// Trong phần đăng ký IPC:
registerChatGptIpc(mainWindow);
```

### 3.5. Cầu Nối Preload (`main/preload.ts`) & Renderer Bridge
Tại `main/preload.ts`, mở rộng đối tượng `vanhsub`:
```ts
chatgptWeb: {
  openLogin: (mode?: 'visible' | 'offscreen') => ipcRenderer.invoke('chatgpt:open-login', { mode }),
  getStatus: () => ipcRenderer.invoke('chatgpt:get-status'),
  validateSession: () => ipcRenderer.invoke('chatgpt:validate-session'),
  setDisplayMode: (mode: 'offscreen' | 'visible') => ipcRenderer.invoke('chatgpt:set-display-mode', mode),
  clearSession: () => ipcRenderer.invoke('chatgpt:clear-session'),
  generateScript: (payload: { topic: string; options?: any }) => ipcRenderer.invoke('chatgpt:generate-script', payload),
  onStatusChange: (callback: (status: any) => void) => {
    const sub = (_event: any, data: any) => callback(data);
    ipcRenderer.on('chatgpt:status-changed', sub);
    return () => ipcRenderer.removeListener('chatgpt:status-changed', sub);
  },
}
```

Tại `renderer/types/electron.d.ts`, bổ sung interface `ChatGptWebAPI`:
```ts
export interface ChatGptWebAPI {
  openLogin: (mode?: 'visible' | 'offscreen') => Promise<{ ok: boolean; status: string }>;
  getStatus: () => Promise<ChatGptStatusPayload>;
  validateSession: () => Promise<ChatGptValidationResult>;
  setDisplayMode: (mode: 'offscreen' | 'visible') => Promise<{ ok: boolean }>;
  clearSession: () => Promise<{ ok: boolean }>;
  generateScript: (payload: { topic: string; options?: any }) => Promise<{ ok: boolean; scriptLines: ScriptBeatLine[] }>;
  onStatusChange: (callback: (status: any) => void) => () => void;
}
```

### 3.6. Tích Hợp Vào AI Studio Pipeline (`AiStudioPipelineEngine.ts`)
Tại `main/ai-studio/types.ts`:
```ts
export type LlmProvider = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web';

export interface AiStudioLlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  systemPromptPreset: string;
  /** Chế độ hiển thị khi dùng ChatGPT Web: chạy ngầm (offscreen) hoặc xem trực tiếp (visible) */
  chatgptWebMode?: 'offscreen' | 'visible';
}
```

Tại `main/ai-studio/AiStudioPipelineEngine.ts` (Bước 2: Stage 2 Kịch bản):
```ts
case 2: {
  // Stage 2: Kịch bản (Script Generation)
  if (config.llm.provider === 'chatgpt_web') {
    const chatgptEngine = ChatGptAutomationEngine.getInstance();
    const scriptLines = await chatgptEngine.generateDialogueScript({
      topic: session.topic,
      systemPromptPreset: config.llm.systemPromptPreset,
      displayMode: config.llm.chatgptWebMode || 'offscreen',
      signal,
      onProgress: (pct, msg) => {
        onProgress({
          sessionId: session.sessionId,
          stage: 2,
          stageName: STAGE_CONFIG[2].label,
          progress: stageMeta.baseProgress - 5 + Math.round(pct * 0.1),
          status: 'running',
          message: msg,
        });
      },
    });
    session.artifacts.scriptLines = scriptLines;
  } else {
    const scriptLines = await aiStudioLlmService.generateScript(
      session.topic,
      config.llm
    );
    session.artifacts.scriptLines = scriptLines;
  }
  break;
}
```

---

## 4. Kế Hoạch Kiểm Thử & Xác Minh (Verification Strategy)

1. **Kiểm tra biên dịch tĩnh (Type Check)**:
   - Chạy lệnh `npx tsc --noEmit`.
   - Kết quả bắt buộc: 0 lỗi biên dịch trên cả `main/` và `renderer/`.
2. **Kịch bản kiểm thử tự động (`scripts/test_chatgpt_web_automation.ts`)**:
   - Kiểm tra khởi tạo Electron Partition `persist:chatgpt_session`.
   - Kiểm tra mở cửa sổ ẩn `x: -3000, y: -3000` và chuyển sang `x: 100, y: 100`.
   - Mô phỏng input prompt và cơ chế trích xuất JSON kịch bản.
3. **Kiểm thử trải nghiệm thực tế (Functional Acceptance)**:
   - Nút "Đăng nhập ChatGPT" trong Cài đặt mở cửa sổ nhìn thấy được, người dùng đăng nhập tài khoản thật.
   - Tắt ứng dụng Vanhsub và bật lại: kiểm tra session vẫn giữ nguyên (`isLoggedIn === true`).
   - Chạy Auto-Pilot AI Video Studio với provider `chatgpt_web`: kịch bản được tự động sinh và nạp tiếp sang Bước 3 (TTS) trơn tru.
