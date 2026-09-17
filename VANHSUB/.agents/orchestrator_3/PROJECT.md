# Project: Chế độ Tiết kiệm (ChatGPT Web Automation - Zero API Cost)

## Architecture
Hệ thống "Chế độ Tiết kiệm" cho phép phân hệ AI Video Studio của Vanhsub sinh kịch bản video tự động thông qua giao diện ChatGPT Web của người dùng mà không tốn chi phí API token (Zero API Cost).

Kiến trúc bao gồm 4 tầng:
1. **Session & Window Management (Main Process - `main/chatgpt/ChatGptWebSessionManager.ts`)**:
   - Sử dụng Electron session với phân vùng vĩnh viễn `persist:chatgpt_session`.
   - Quản lý cửa sổ `BrowserWindow` với kỹ thuật Virtual Offscreen `(-3000, -3000)` bảo toàn layout render của Chromium mà không bóp nghẽn JS (`backgroundThrottling: false`).
   - Hỗ trợ chuyển đổi sang Live Window `(100, 100)` cho phép người dùng trực tiếp quan sát AI gõ chữ hoặc giải Captcha / Cloudflare.
   - Xóa cờ `navigator.webdriver`, giả lập Chrome Desktop User-Agent, xóa headers sec-ch-ua để chống Bot detection.
   - Quản lý trạng thái xác thực (`isLoggedIn`), lưu trữ cookies bền vững.

2. **DOM Automation & Chunking Engine (Main Process - `main/chatgpt/ChatGptAutomationEngine.ts`)**:
   - Self-Healing DOM Selectors (`#prompt-textarea`, `div[contenteditable="true"]`, `button[data-testid="send-button"]`, `button[data-testid="stop-button"]`, `[data-message-author-role="assistant"]`).
   - Vượt qua React 18 controlled component bằng native prototype property setter kết hợp dispatch `input`/`change` events và `webContents.sendInputEvent`.
   - Lắng nghe chu trình sinh văn bản qua nút `stop-button` (chờ xuất hiện và biến mất khi hoàn thành).
   - Thuật toán Multi-turn Chunking: Gửi nối tiếp các đoạn kịch bản ngắn trong cùng một phiên chat để tránh bị cắt cụt do giới hạn token đầu ra của bản web miễn phí.
   - Vá và chuẩn hóa cấu trúc JSON thành mảng `ScriptBeatLine[]`.

3. **IPC Bridge & Pipeline Integration (`main/ai-studio/`, `main/chatgpt/ipc.ts`, `main/preload.ts`)**:
   - Mở rộng kiểu dữ liệu `AiStudioConfig.llm`: thêm provider `'chatgpt_web'`, tùy chọn `chatgptWebMode: 'offscreen' | 'visible'`.
   - Cung cấp các kênh IPC an toàn: `aiStudio:chatgpt:checkStatus`, `aiStudio:chatgpt:openLogin`, `aiStudio:chatgpt:setMode`, `aiStudio:chatgpt:generateScript`, v.v.
   - Tích hợp vào `AiStudioPipelineEngine` tại Stage 2 (Kịch bản): tự động điều hướng sang ChatGPT Web Session khi cấu hình là `chatgpt_web`. Tự động bật cửa sổ đăng nhập nếu chưa xác thực.

4. **Renderer UI & User Status (`renderer/components/ai-studio/`)**:
   - `AiStudioSettingsTab`: Thêm provider "ChatGPT Web (Chế độ tiết kiệm - Miễn phí 100%)", nút Đăng nhập kèm đèn báo trạng thái (xanh/xám), checkbox Live Window.
   - `AutoPilotView` & `CustomStudioView`: Huy hiệu *"⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí"*.

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Persistent Partition `persist:chatgpt_session` | Lưu trữ cookie, session đăng nhập ChatGPT lâu dài qua Electron session | M1 | ORIGINAL_REQUEST R1 |
| 2 | Login Window Mechanism | Mở BrowserWindow `https://chatgpt.com`, hỗ trợ Google/Microsoft/Apple/Email login | M1 | ORIGINAL_REQUEST R1 |
| 3 | Session State Detection (`isLoggedIn`) | Kiểm tra cookie/DOM để phát hiện trạng thái đã đăng nhập hay chưa | M1 | ORIGINAL_REQUEST R1 |
| 4 | Dual Display Mode (Offscreen & Live Window) | Chuyển đổi linh hoạt giữa chạy ngầm `(-3000, -3000)` và hiển thị live `(100, 100)` | M1 | ORIGINAL_REQUEST R1 |
| 5 | Anti-Bot & Webdriver Clean | Xóa `navigator.webdriver`, desktop UA, chống Cloudflare detection | M1 | Survey Spec |
| 6 | IPC Bridge & Types (`vanhsub.chatgptWeb`) | 6 kênh IPC kết nối giữa Electron Main và Renderer qua preload | M1 | Survey Arch |
| 7 | Self-Healing DOM Selectors | Định vị ô nhập prompt `#prompt-textarea`, fallback contenteditable | M2 | ORIGINAL_REQUEST R2 |
| 8 | React 18 Event Dispatching | Kích hoạt React state nội bộ bằng native property descriptor setter và sendInputEvent | M2 | ORIGINAL_REQUEST R2 |
| 9 | Send Button & Stop Button Watcher | Tự động bấm send và lắng nghe stop-button xuất hiện/biến mất để biết hoàn thành | M2 | ORIGINAL_REQUEST R2 |
| 10 | Assistant Response Extractor | Trích xuất nội dung văn bản từ `[data-message-author-role="assistant"]` và làm sạch markdown | M2 | ORIGINAL_REQUEST R2 |
| 11 | Multi-turn Chunking Algorithm | Chia kịch bản dài thành các đoạn nhỏ gửi nối tiếp trong cùng một URL chat | M2 | ORIGINAL_REQUEST R2 |
| 12 | JSON Repair & BeatLine Normalizer | Vá JSON và chuẩn hóa sang cấu trúc `ScriptBeatLine[]` tiêu chuẩn của AI Studio | M2 | Survey Spec |
| 13 | Extended AiStudioConfig & Store Schema | Bổ sung provider `'chatgpt_web'`, `chatgptWebMode` vào `AiStudioLlmConfig` và store | M3 | ORIGINAL_REQUEST R3 |
| 14 | Pipeline Engine Stage 2 Hook | Điều hướng Stage 2 kịch bản sang `ChatGptAutomationEngine`, auto-prompt login | M3 | ORIGINAL_REQUEST R3 |
| 15 | Settings UI Provider & Login Controls | Dropdown chọn provider, nút Đăng nhập, đèn báo trạng thái, checkbox Live Window | M4 | ORIGINAL_REQUEST R4 |
| 16 | AutoPilotView & CustomStudioView Badges | Huy hiệu "⚡ Chế độ tiết kiệm: Đang chạy kịch bản qua ChatGPT Web miễn phí" | M4 | ORIGINAL_REQUEST R4 |
| 17 | Test Automation Script | `scripts/test_chatgpt_web_automation.ts` kiểm thử partition, prompt, stop-button, JSON | M5 | Acceptance Criteria |
| 18 | TypeScript Zero-Error Verification | Toàn bộ dự án vượt qua `npx tsc --noEmit` với 0 lỗi | M5 | Acceptance Criteria |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Session Manager & Partition Core | `main/chatgpt/ChatGptWebSessionManager.ts`, `main/chatgpt/types.ts`, `main/chatgpt/ipc.ts`, `main/preload.ts`, `renderer/types/electron.d.ts` | none | IN_PROGRESS |
| M2 | DOM Automation Engine & Chunking | `main/chatgpt/ChatGptAutomationEngine.ts` | M1 | PLANNED |
| M3 | Pipeline & Settings Integration | `main/ai-studio/types.ts`, `renderer/types/aiStudio.ts`, `main/ai-studio/AiStudioPipelineEngine.ts`, `main/store/aiStudioStore.ts` | M1, M2 | PLANNED |
| M4 | UI Enhancements & Status Indicators | `renderer/components/ai-studio/AiStudioSettingsTab.tsx`, `AutoPilotView.tsx`, `CustomStudioView.tsx` | M1, M3 | PLANNED |
| M5 | Verification & E2E Testing Script | `scripts/test_chatgpt_web_automation.ts`, `npx tsc --noEmit` | M1, M2, M3, M4 | PLANNED |

---

## Interface Contracts

### `main/chatgpt/types.ts` ↔ `renderer/types/electron.d.ts`
```typescript
export interface ChatGptWebStatus {
  isLoggedIn: boolean;
  email?: string;
  displayMode: 'offscreen' | 'visible';
  isReady: boolean;
  lastChecked?: number;
}

export interface ChatGptScriptOptions {
  topic: string;
  stylePrompt?: string;
  targetDurationSec?: number;
  displayMode?: 'offscreen' | 'visible';
}

export interface ChatGptWebAPI {
  getStatus: () => Promise<ChatGptWebStatus>;
  openLogin: (mode?: 'offscreen' | 'visible') => Promise<ChatGptWebStatus>;
  closeLogin: () => Promise<boolean>;
  setDisplayMode: (mode: 'offscreen' | 'visible') => Promise<boolean>;
  validateSession: () => Promise<boolean>;
  clearSession: () => Promise<boolean>;
  generateScript: (topic: string, options?: ChatGptScriptOptions) => Promise<ScriptBeatLine[]>;
}
```

### `AiStudioLlmConfig` (`main/ai-studio/types.ts` & `renderer/types/aiStudio.ts`)
```typescript
export type LlmProvider = 'deepseek' | 'openai' | 'custom' | 'chatgpt_web';

export interface AiStudioLlmConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature: number;
  systemPromptPreset: string;
  chatgptWebMode?: 'offscreen' | 'visible';
}
```

### `ChatGptAutomationEngine` ↔ `AiStudioPipelineEngine`
```typescript
export interface IChatGptAutomationEngine {
  generateScript(topic: string, options?: ChatGptScriptOptions): Promise<ScriptBeatLine[]>;
  ensureSessionReady(): Promise<boolean>;
}
```

---

## Code Layout
- `main/chatgpt/`
  - `ChatGptWebSessionManager.ts`: Quản lý Electron partition `persist:chatgpt_session`, BrowserWindow (offscreen/visible), cookies, login state.
  - `ChatGptAutomationEngine.ts`: Self-healing DOM automation, React event injection, stop-button wait, multi-turn chunking, JSON repair.
  - `types.ts`: Interface hợp đồng dữ liệu cho module ChatGPT Web.
  - `ipc.ts`: Đăng ký IPC handlers an toàn cho `aiStudio:chatgpt:*` và `chatgpt:*`.
- `main/preload.ts`: Expose `vanhsub.chatgptWeb` qua contextBridge.
- `renderer/types/electron.d.ts`: Cập nhật interface `ChatGptWebAPI`.
- `main/ai-studio/types.ts` & `renderer/types/aiStudio.ts`: Bổ sung `'chatgpt_web'` và `chatgptWebMode`.
- `main/ai-studio/AiStudioPipelineEngine.ts`: Nhánh rẽ Stage 2 cho ChatGPT Web.
- `renderer/components/ai-studio/`:
  - `AiStudioSettingsTab.tsx`: Bổ sung provider option, Login button, status indicator, Live Window checkbox.
  - `AutoPilotView.tsx`: Badge Chế độ Tiết kiệm.
  - `CustomStudioView.tsx`: Badge Chế độ Tiết kiệm.
- `scripts/test_chatgpt_web_automation.ts`: Script kiểm thử tự động.
