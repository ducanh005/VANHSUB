# Báo Cáo Handoff: Khảo Sát Kiến Trúc Electron Main Process Cho ChatGPT Web Automation

**Dự án**: VANHSUB Desktop Application  
**Tác giả**: Explorer (Survey Phase - orchestrator_3)  
**Tệp phân tích chi tiết**: `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_main_arch\analysis.md`  
**Ngày**: 2026-09-17  

---

## 1. Observation (Quan Sát Thực Nghiệm)

1. **Cấu trúc khởi động Main Process (`main/main.ts`)**:
   - Dòng 193–197: Session khởi tạo sớm ngay khi app ready:
     ```ts
     await GoogleVeoSessionManager.getInstance().init()
     ```
   - Dòng 206–214: Main Window được khởi tạo qua `createWindow('main', ...)` có nạp preload: `path.join(__dirname, 'preload.js')`.
   - Dòng 233–240: IPC được đăng ký theo hàm router module hóa:
     ```ts
     registerWorkflowIpc()
     registerAiStudioIpc()
     setAiStudioPipelineEngine(new AiStudioPipelineEngine())
     ```
   - Dòng 710–773: Toàn bộ IPC tương tác với browser session của Google Veo đăng ký trực tiếp trên `ipcMain.handle`: `veo:open-lobby`, `veo:status`, `veo:validate`, `veo:save-session`, `veo:clear-session`, `veo:show-lobby-debug`, `veo:hide-lobby-offscreen`.

2. **Cơ chế Preload & Renderer Bridge (`main/preload.ts` & `renderer/types/electron.d.ts`)**:
   - `preload.ts` dòng 239: `contextBridge.exposeInMainWorld('vanhsub', vanhsub)`.
   - Các API được gom nhóm theo namespace (`vanhsub.veo`, `vanhsub.aiStudio`, `vanhsub.tasks`, `vanhsub.settings`...).
   - `renderer/types/electron.d.ts` dòng 245–296: Định nghĩa đầy đủ kiểu dữ liệu của `veo`, và dòng 392–429: định nghĩa kiểu `aiStudio`.

3. **Cơ chế Phân vùng & Quản lý Cửa sổ trong `GoogleVeoSessionManager.ts` (`main/veo/GoogleVeoSessionManager.ts`)**:
   - **Partition**: Dòng 167: `session.fromPartition('persist:google_veo')`.
   - **Cấu hình cửa sổ không bóp nghẽn JS**: Dòng 317–322:
     ```ts
     webPreferences: {
       partition: 'persist:google_veo',
       nodeIntegration: false,
       contextIsolation: true,
       backgroundThrottling: false,
     }
     ```
   - **Tọa độ Offscreen**: Dòng 44–45:
     ```ts
     export const OFFSCREEN_X = -3000;
     export const OFFSCREEN_Y = -3000;
     ```
   - **Điều khiển Offscreen vs Live Window**:
     - Dòng 2286–2304 (`showLobbyForDebug`): Kéo cửa sổ về `setPosition(100, 100); show(); focus();`.
     - Dòng 2307–2312 (`hideLobbyOffscreen`): Đưa cửa sổ trở lại `setPosition(OFFSCREEN_X, OFFSCREEN_Y)`.
   - **Chống Bot & Xóa Webdriver**:
     - Dòng 268: `ses.setUserAgent(CHROME_DESKTOP_UA);`
     - Dòng 273–301: Xóa headers `sec-ch-ua` qua `onBeforeSendHeaders`.
     - Dòng 332–341: Xóa thuộc tính `navigator.webdriver` trên `dom-ready`.
   - **Lưu trữ 2 tầng (Two-tier persistence)**: Phân vùng Electron đồng bộ 2 chiều với `SettingsStore` (được mã hóa DPAPI safeStorage `enc:v1:` tại `main/store/settingsStore.ts`).
   - **Phát hiện đăng nhập**: Lắng nghe `did-navigate` (dòng 351–367) và kiểm tra cookie/probe request (`executeHealthProbe`, dòng 674–855).

4. **Hiện trạng tích hợp AI Studio (`main/ai-studio/AiStudioPipelineEngine.ts`)**:
   - Dòng 430–438: Bước 2 (Kịch bản) hiện tại gọi trực tiếp qua HTTP API:
     ```ts
     case 2: {
       const scriptLines = await aiStudioLlmService.generateScript(session.topic, config.llm);
       session.artifacts.scriptLines = scriptLines;
       break;
     }
     ```
   - `AiStudioLlmConfig` (`main/ai-studio/types.ts` dòng 10–25) hiện chỉ có `provider: 'deepseek' | 'openai' | 'custom'`.

---

## 2. Logic Chain (Chuỗi Lập Luận)

1. **Từ Quan sát 1 & 3**: Vanhsub đã có một kiến trúc session manager rất hoàn thiện và được kiểm chứng trong thực tế qua `GoogleVeoSessionManager`. Việc tái sử dụng các mẫu thiết kế: (1) phân vùng vĩnh viễn `persist:...`, (2) `backgroundThrottling: false`, (3) tọa độ ảo ngoài màn hình `(-3000, -3000)` thay vì `show: false`, (4) xóa `navigator.webdriver` sẽ đảm bảo 100% tính ổn định cho ChatGPT Web mà không gặp phải rào cản Chromium throttling hay Cloudflare Bot Detection.
2. **Từ Quan sát 1 & 2**: Để đảm bảo nguyên tắc Modular Architecture và tránh phình to file `main/main.ts` (đã có 1088 dòng), việc tách riêng thư mục `main/chatgpt/` chứa:
   - `ChatGptWebSessionManager.ts` (quản lý session, partition, cookies, window),
   - `ChatGptAutomationEngine.ts` (DOM automation, stop-button, multi-turn chunking),
   - `ipc.ts` (đăng ký IPC qua hàm `registerChatGptIpc` với helper `safeHandle`),
   - `types.ts` (schemas và interfaces),
   là giải pháp sạch sẽ nhất, đồng bộ hoàn toàn với kiến trúc của `main/veo/` và `main/ai-studio/`.
3. **Từ Quan sát 4**: Tại bước 2 (Stage 2: Kịch bản) của `AiStudioPipelineEngine.ts`, chỉ cần thêm một nhánh kiểm tra `if (config.llm.provider === 'chatgpt_web')`, gọi sang `ChatGptAutomationEngine.getInstance().generateDialogueScript(...)`. Nếu chưa đăng nhập, tự động bật cửa sổ đăng nhập nhắc nhở người dùng.
4. **Từ Quan sát 2**: Để UI React có thể kích hoạt đăng nhập và đọc trạng thái, chỉ cần bổ sung `chatgptWeb` vào `main/preload.ts` và khai báo interface `ChatGptWebAPI` trong `renderer/types/electron.d.ts`.

---

## 3. Caveats (Các Điểm Lưu Ý & Giới Hạn)

1. **Cloudflare Turnstile & Captcha**: Mặc dù việc xóa `navigator.webdriver` và giả lập Chrome Desktop UA giúp vượt qua hầu hết các bài kiểm tra bot thông thường, OpenAI vẫn có thể thỉnh thoảng kích hoạt Cloudflare Turnstile tương tác người dùng (checkbox hoặc puzzle). Do đó, cửa sổ đăng nhập (`openLoginWindow`) bắt buộc phải là cửa sổ hiển thị trực tiếp (`visible`) để người dùng có thể giải captcha bằng tay nếu cần.
2. **Thay đổi giao diện DOM của ChatGPT Web**: OpenAI thường xuyên cập nhật giao diện web (thay đổi CSS class hoặc DOM tree). Vì vậy, `ChatGptAutomationEngine` phải áp dụng cơ chế Self-Healing đa tầng (ID `#prompt-textarea`, `div[contenteditable="true"]`, `data-testid="send-button"`), đồng thời nạp văn bản qua `document.execCommand('insertText')` hoặc `sendInputEvent` để kích hoạt React internal state.
3. **Giới hạn Output Token của bản Web miễn phí**: Bản ChatGPT Web miễn phí có thể dừng sinh giữa chừng đối với kịch bản quá dài. Giải pháp Multi-turn Chunking (chia làm 2 lượt: Lượt 1 tạo khung, Lượt 2 viết chi tiết JSON) trong cùng một URL hội thoại là bắt buộc để đảm bảo kết quả JSON toàn vẹn.

---

## 4. Conclusion (Kết Luận)

1. **Vị trí tệp lý tưởng**:
   - `main/chatgpt/ChatGptWebSessionManager.ts`
   - `main/chatgpt/ChatGptAutomationEngine.ts`
   - `main/chatgpt/ipc.ts`
   - `main/chatgpt/types.ts`
2. **Kênh IPC cần đăng ký**:
   - `chatgpt:open-login`: Mở cửa sổ đăng nhập `https://chatgpt.com`.
   - `chatgpt:get-status`: Trả về trạng thái phiên, email, chế độ offscreen/visible.
   - `chatgpt:validate-session`: Kiểm tra cookie sống và khả năng kết nối.
   - `chatgpt:set-display-mode`: Chuyển đổi giữa Chạy ngầm (`-3000, -3000`) và Xem trực tiếp (`100, 100`).
   - `chatgpt:clear-session`: Xóa cookie phân vùng và đăng xuất.
   - `chatgpt:generate-script`: Thực thi sinh kịch bản độc lập hoặc kiểm thử.
3. **Điểm nối Preload & Renderer**:
   - `main/preload.ts`: Thêm namespace `vanhsub.chatgptWeb`.
   - `renderer/types/electron.d.ts`: Thêm `ChatGptWebAPI` vào `VanhsubAPI`.
4. **Điểm nối AI Studio**:
   - `main/ai-studio/types.ts`: Bổ sung `'chatgpt_web'` vào `LlmProvider` và thuộc tính `chatgptWebMode?: 'offscreen' | 'visible'`.
   - `main/ai-studio/AiStudioPipelineEngine.ts`: Nhánh rẽ Stage 2 ủy quyền cho `ChatGptAutomationEngine`.

---

## 5. Verification Method (Phương Pháp Xác Minh Độc Lập)

1. **Kiểm tra cú pháp & cấu trúc kiểu**:
   ```powershell
   npx tsc --noEmit
   ```
   *Yêu cầu*: Hoàn thành với 0 lỗi biên dịch.
2. **Kiểm tra tệp báo cáo chi tiết**:
   Xem tệp `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_3_survey_main_arch\analysis.md` để nắm đầy đủ giải pháp kỹ thuật, phân tích mã nguồn và các mẫu code mẫu.
3. **Kịch bản kiểm thử tự động giai đoạn sau**:
   Thực thi `npx tsx scripts/test_chatgpt_web_automation.ts` để kiểm tra phân vùng `persist:chatgpt_session`, điều hướng tọa độ cửa sổ và trích xuất JSON kịch bản.
