# Báo Cáo Khảo Sát Kiến Trúc Backend — Vanhsub AI Video Studio

> **Phiên bản:** 1.0.0  
> **Ngày thực hiện:** 2026-09-17  
> **Người thực hiện:** Backend Architecture Explorer  
> **Phạm vi khảo sát:** `d:\DEAN\DEAN\VANHSUB` (Electron Main Process, IPC, Stores, Flow Engine, Media Pipelines, Test Harness)

---

## 1. TỔNG QUAN KHẢO SÁT & ĐÁNH GIÁ MỨC ĐỘ SẴN SÀNG

Qua quá trình rà soát toàn diện mã nguồn backend của Vanhsub, phân hệ backend đã sở hữu nền tảng vững chắc và sẵn sàng cao để triển khai **AI Video Studio** theo đúng đặc tả `AI_STUDIO_SPEC.md`.

### 1.1. Bảng tóm tắt hiện trạng các trụ cột kỹ thuật

| Trụ cột | Hiện trạng trong Codebase | Mức độ tương thích với AI Studio | Hành động kiến trúc đề xuất |
| :--- | :--- | :--- | :--- |
| **Main Process & Nextron** | Nextron v10.3.0 + Next.js v16.3.2 + Electron v43.4.1. Webpack bundle cho Main process. | 🟢 100% | Tách module AI Studio thành thư mục riêng `main/ai-studio/`, đăng ký IPC qua router `registerAiStudioIpc()`. |
| **IPC Registration** | Phân tách rõ ràng: Handler đơn lẻ trong `main/main.ts`, router module như `main/workflow/ipc.ts`. Expose qua `main/preload.ts` vào `window.vanhsub.*`. | 🟢 100% | Bổ sung namespace `aiStudio` vào `preload.ts` và khai báo type trong `renderer/types/electron.d.ts`. |
| **Hệ thống Lưu trữ (Store)** | `electron-store` v11.0.2 lazy-singleton. Lưu độc lập theo tên file JSON. Có mã hóa `safeStorage` (DPAPI Windows). Hỗ trợ headless test ngoài Electron. | 🟢 100% | Tạo `main/store/aiStudioStore.ts` với file `vanhsub-ai-studio.json` độc lập 100% với `vanhsub-settings.json` và `workflowStore`. |
| **Google Flow / Veo Engine** | `GoogleVeoSessionManager` (lobbyWindow, cookie/token), `GoogleFlowBrowserMutex`, `GoogleVeoAntiSpamGuard`, `FlowStateMachine`, `FlowTaskQueue`, `FlowCrashResumeCoordinator`. | 🟡 Sẵn sàng nhưng phụ thuộc Session | Tạo chế độ kép (Dual Mode): Real Mode khi session valid; Mock / Synthetic Asset Mode (FFmpeg canvas) khi chưa đăng nhập hoặc chạy test. |
| **TTS (Edge TTS)** | `msedge-tts` v2.0.7 đã cài đặt. Có sẵn `main/tts-providers/edge/EdgeTTSClient.ts` hỗ trợ giọng Hoài My & Nam Minh. Hỗ trợ metadata Word-Boundary gốc. | 🟢 100% | Mở rộng `EdgeTTSClient` để trích xuất mốc thời gian Word-Boundary và Sentence-Boundary phục vụ Step 3 & 4. |
| **Speech Alignment / ASR** | `whisperEngine.ts` gọi trực tiếp binary `whisper-cli` (nodejs-whisper v0.3.1). | 🟢 100% | Dùng word-boundary của Edge TTS làm nguồn chính; dùng Whisper làm phương án dự phòng khi cần căn chỉnh audio ngoài. |
| **Video Assembly (FFmpeg)** | `fluent-ffmpeg` v2.1.3 + `@ffmpeg-installer/ffmpeg` + `@ffprobe-installer/ffprobe`. Có helper escape path Windows, `assCompiler.ts`, `videoProcessor.ts`. | 🟢 100% | Xây dựng `AiStudioVideoAssembler` áp dụng hiệu ứng Ken Burns (zoompan filter), Audio Ducking (sidechaincompress / amix), phụ đề ASS. |
| **TypeScript & Test Harness** | TypeScript v5.9.3, `npx tsc --noEmit` đạt 0 lỗi (Exit Code 0). Pattern test qua terminal bằng `npx tsx scripts/*.ts`. | 🟢 100% | Viết script kiểm thử độc lập `scripts/test_ai_studio_pipeline.ts` chạy trực tiếp qua `npx tsx`. |

---

## 2. KIẾN TRÚC MAIN PROCESS & BỐ CỤC THƯ MỤC

### 2.1. Cấu trúc thư mục Main (`d:\DEAN\DEAN\VANHSUB\main`)

```
d:\DEAN\DEAN\VANHSUB\main
├── ai/                      # OpenAI / Gemini API Client (geminiClient.ts)
├── asr/                     # Trích xuất âm thanh và Whisper Engine (whisperEngine.ts, audioExtractor.ts)
├── audio/                   # Tách âm Demucs và xử lý nhạc (vocalSeparation.ts, stemExportRunner.ts)
├── helpers/                 # Window manager, logger, downloader, URL extract
├── lib/                     # SRT parser, đường dẫn paths, token cancel
├── ocr/                     # Quét phụ đề video (Tesseract / PaddleOCR)
├── render/                  # FFmpeg rendering (videoRenderer.ts, assCompiler.ts, dubbingEngine.ts)
├── store/                   # Electron-store singletons (settingsStore, taskStore, bibleStore, voiceSampleStore)
├── translate/               # Translate runner
├── tts-providers/           # Nhà cung cấp giọng đọc (edge/EdgeTTSClient.ts, tiktok/)
├── utils/                   # Project folder utils
├── veo/                     # Google Veo Session Manager & Anti-Spam Guard
├── workflow/                # Graph workflow execution & flow-engine automation
│    ├── adapters/           # Adapters cho Google Flow, Imagen 3, Veo
│    ├── dispatcher/         # Mutex và Task dispatcher
│    ├── flow-engine/        # State Machine, Checkpoint, TaskQueue, VisualFallback
│    ├── executionEngine.ts  # Node execution DAG engine
│    ├── ipc.ts              # IPC registration cho workflow
│    └── videoProcessor.ts   # Concat, trim, FFmpeg video tools
├── main.ts                  # Entry point chính của Electron Main Process (1,080 lines)
└── preload.ts               # Preload script bảo mật qua contextBridge (196 lines)
```

### 2.2. Vòng đời khởi tạo & Custom Protocols trong `main.ts`

1. **Đăng ký Scheme đặc quyền (`main.ts:39-61`):**
   - `app`: Phục vụ load tài nguyên HTML/JS của Nextron khi chạy Production (`app://./home`).
   - `vanhmedia`: Custom protocol stream file media nội bộ (video, audio, ảnh) cho các thẻ `<video>`, `<audio>`, `<img>` ở Renderer:
     ```typescript
     // main/main.ts:120-176
     protocol.handle('vanhmedia', async (request) => { ... })
     ```
     - Hỗ trợ đầy đủ header `Range` và mã HTTP `206 Partial Content` để tua video/audio trơn tru.
     - Hỗ trợ tất cả đuôi file: `.mp4`, `.mp3`, `.wav`, `.png`, `.jpg`, `.webp`...
     - **Ứng dụng cho AI Studio:** Trình xem trước Audio Player, Video Player, Storyboard Visual Cards sẽ dùng định dạng URL `vanhmedia://local/<URI_encoded_absolute_path>` để stream trực tiếp không cần base64 tốn RAM.

2. **Khởi tạo khi App Ready (`main.ts:187-222`):**
   - `GoogleVeoSessionManager.getInstance().init()` nạp cookie và trạng thái sảnh.
   - `TaskStore.resetStaleRunning()` giải phóng các task bị kẹt do crash phiên trước.
   - Tạo cửa sổ chính `createWindow('main', { webPreferences: { preload: path.join(__dirname, 'preload.js') } })`.

3. **Cấu hình Webpack Bundling (`nextron.config.js`):**
   - Webpack biên dịch `main/` ra `app/main.js`.
   - Các thư viện native hoặc module lớn được đưa vào `externals`:
     `electron`, `electron-store`, `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe`, `nodejs-whisper`, `tesseract.js`, `uuid`.
   - Điều này cho phép `electron-store` và `fluent-ffmpeg` đọc file nhị phân và dữ liệu cục bộ chuẩn xác mà không bị Webpack gom mã làm sai lệch đường dẫn.

---

## 3. MÔ HÌNH ĐĂNG KÝ IPC & GIAO TIẾP MAIN - RENDERER

### 3.1. Cơ chế đăng ký hiện hành

1. **Phương pháp trực tiếp trong `main.ts`:**
   Dùng cho các chức năng nền tảng (`tasks:*`, `settings:*`, `tts:*`, `veo:*`, `dialog:*`, `models:*`).
2. **Phương pháp Module Router (Chuẩn kiến trúc khuyến nghị):**
   Được áp dụng ở `main/workflow/ipc.ts`:
   ```typescript
   // main/main.ts:28 & 231
   import { registerWorkflowIpc } from './workflow/ipc'
   registerWorkflowIpc()
   ```
   *Đánh giá:* Cách làm này giữ `main.ts` gọn gàng, tránh biến file thành monolithic. Phân hệ AI Studio **bắt buộc** áp dụng mô hình này qua `main/ai-studio/ipc.ts`.

### 3.2. Cầu nối bảo mật `preload.ts` & Typings

1. **`main/preload.ts`:**
   Nhóm API thành các đối tượng có ngữ cảnh (`tasks`, `settings`, `tts`, `veo`, `workflow`):
   ```typescript
   // main/preload.ts:194
   contextBridge.exposeInMainWorld('vanhsub', vanhsub)
   ```
2. **Đồng bộ TypeScript tại `renderer/types/electron.d.ts`:**
   Giao diện `VanhsubAPI` định nghĩa các hàm trả về `Promise<T>`.

### 3.3. Thiết kế IPC cho Phân hệ AI Video Studio

Xây dựng router `main/ai-studio/ipc.ts` đăng ký các kênh:

```typescript
// Danh sách kênh IPC cho AI Studio:
// 1. Cấu hình (Configuration)
'aiStudio:config:get'         -> () => Promise<AiStudioConfig>
'aiStudio:config:set'         -> (config: Partial<AiStudioConfig>) => Promise<AiStudioConfig>
'aiStudio:config:reset'       -> () => Promise<AiStudioConfig>

// 2. Điều phối Pipeline (One-Click Auto-Pilot)
'aiStudio:pipeline:start'     -> (params: { topicOrSource: string; mode?: 'auto' | 'custom' }) => Promise<{ projectId: string }>
'aiStudio:pipeline:pause'     -> (projectId: string) => Promise<boolean>
'aiStudio:pipeline:resume'    -> (projectId: string, fromStep?: number) => Promise<boolean>
'aiStudio:pipeline:cancel'    -> (projectId: string) => Promise<boolean>
'aiStudio:pipeline:getProject'-> (projectId: string) => Promise<AiStudioProject | null>

// 3. Can thiệp từng bước (Custom Studio Actions)
'aiStudio:step:generateScript'-> (projectId: string, topic: string) => Promise<AiStudioScript>
'aiStudio:step:synthesizeVoice'->(projectId: string, lineIndex?: number) => Promise<{ audioPath: string }>
'aiStudio:step:alignTimestamps'->(projectId: string) => Promise<AiStudioTimestampAlignment>
'aiStudio:step:buildStoryboard'->(projectId: string) => Promise<AiStudioScene[]>
'aiStudio:step:renderVisual'   ->(projectId: string, sceneIndex: number, promptOverride?: string) => Promise<{ visualPath: string }>
'aiStudio:step:renderVideo'    ->(projectId: string, options?: Partial<AiStudioConfig['rendering']>) => Promise<{ videoPath: string }>
'aiStudio:step:generateSeo'    ->(projectId: string) => Promise<AiStudioSeoData>

// 4. Tiện ích trợ giúp (Quality Audit & Assets)
'aiStudio:util:scoreScript'    -> (scriptText: string) => Promise<ScriptAuditResult>
'aiStudio:dialog:pickMedia'    -> (type: 'image' | 'video' | 'audio') => Promise<string | null>
```

**Sự kiện phản hồi thời gian thực từ Main về Renderer:**
```typescript
mainWindow.webContents.send('aiStudio:pipeline:event', {
  projectId: string,
  stepIndex: number,       // 1 đến 8
  stepName: string,
  status: 'pending' | 'running' | 'success' | 'error',
  progress: number,        // 0 đến 100
  data?: any,
  errorMessage?: string,
})
```

---

## 4. HỆ THỐNG CẤU HÌNH & THIẾT KẾ STORE ĐỘC LẬP (`aiStudioStore`)

### 4.1. Cơ chế hoạt động của Store hiện tại trong Vanhsub

1. **`main/store/settingsStore.ts` (`vanhsub-settings.json`):**
   - Khởi tạo theo mô hình **Lazy Singleton**: Chỉ khởi tạo khi gọi hàm `getStore()`.
   - Định vị đường dẫn linh hoạt:
     ```typescript
     let cwd: string | undefined = process.env.VANHSUB_SETTINGS_DIR;
     if (!cwd) {
       try {
         const electron = require('electron');
         if (!electron.app?.name && !electron.app?.getPath) {
           cwd = path.join(os.tmpdir(), 'vanhsub-settings');
         }
       } catch {
         cwd = path.join(os.tmpdir(), 'vanhsub-settings');
       }
     }
     ```
     *Lợi ích cốt lõi:* Cho phép chạy các script test bằng `npx tsx` trong môi trường headless ngoài Electron mà không bị lỗi crash `Please specify the projectName option`.
   - **Bảo mật Secret:** Dùng `safeStorage` (mã hóa DPAPI của Windows) với tiền tố `enc:v1:` và fallback sang plaintext an toàn nếu runtime không hỗ trợ.

2. **`renderer/lib/store/workflowStore.ts`:**
   - Dùng Zustand tạo client state cho đồ thị `@xyflow/react`.
   - Không chứa cấu hình persistent toàn cục mà tập trung vào graph nodes, edges, history snapshot.

### 4.2. Thiết kế Cách ly Tuyệt đối (100% Isolation) cho `aiStudioStore`

Để tuân thủ nghiêm ngặt **R1** trong `AI_STUDIO_SPEC.md` và không làm xung đột cấu hình gốc của Vanhsub:

1. **Tên file riêng biệt trên đĩa:** `vanhsub-ai-studio.json` (tách biệt hoàn toàn với `vanhsub-settings.json`, `vanhsub-tasks.json`, `vanhsub-bible.json`).
2. **Cấu trúc lưu trữ tại Main Process:** `main/store/aiStudioStore.ts`
   ```typescript
   export interface AiStudioConfig {
     llm: {
       provider: 'deepseek' | 'openai' | 'custom';
       apiKey: string;
       model: string;
       baseUrl?: string;
       temperature: number;
       systemPromptPreset: string;
     };
     voice: {
       provider: 'edge_tts' | 'local_onnx';
       voiceId: string;
       rate: string;
       pitch: string;
       volume: string;
       autoWordAlignment: boolean;
     };
     flowEngine: {
       aspectRatio: '16:9' | '9:16' | '1:1';
       outputMode: 'image' | 'video';
       stylePromptPrefix: string;
       negativePrompt: string;
       outputsPerScene: 1 | 2 | 4;
       downloadDir: string;
       concurrency: number;
     };
     rendering: {
       resolution: '1080p' | '720p' | '4k';
       fps: 30 | 60;
       kenBurnsEffect: boolean;
       kenBurnsScale: number;
       transitionDuration: number;
       defaultBgmPath?: string;
       bgmVolume: number;
       autoAudioDucking: boolean;
     };
     subtitles: {
       enabled: boolean;
       preset: 'tiktok_bold' | 'minimalist' | 'classic_bar' | 'karaoke_glow';
       fontSize: number;
       primaryColor: string;
       outlineColor: string;
       outlineWidth: number;
       positionY: number;
     };
   }
   ```
3. **Mã hóa trường nhạy cảm:** Tự động mã hóa `llm.apiKey` thông qua `safeStorage` khi lưu và giải mã khi đọc.
4. **Cấu trúc Store tại Renderer (`renderer/lib/store/aiStudioStore.ts`):**
   - Tạo Zustand store chứa cấu hình cục bộ, đồng bộ hai chiều với Main Store qua IPC.
   - Quản lý trạng thái giao diện: Mode (Auto-Pilot / Custom / Settings), Tab Custom (Kịch bản, Storyboard, Dựng phim), Project đang mở, tiến độ 8 bước.

---

## 5. ĐỘNG CƠ GOOGLE FLOW & PHƯƠNG ÁN DỰ PHÒNG TÀI NGUYÊN (FALLBACK ASSETS)

### 5.1. Kiến trúc phân tầng của Google Flow Engine

Hệ thống Google Flow hiện tại trong Vanhsub là hệ thống tự động hóa trình duyệt chuyên sâu bao gồm 6 lớp:

```
[Renderer Process / User Request]
              │
              ▼
[GoogleVeoAntiSpamGuard] (FIFO Queue, Mutex, Cooldown 8-45s, Jitter 2-4s)
              │
              ▼
[GoogleVeoSessionManager] (lobbyWindow BrowserView, Session/Cookie Validation, Credit Watchdog)
              │
              ▼
[FlowStateMachine] (18 Explicit States: OPEN_FLOW -> ... -> GENERATE -> EXTRACT_OUTPUT)
              │
              ├── [FlowSmartWait] (Adaptive Polling, 5-layer Element Stability Checks)
              ├── [FlowElementFinder] (4-Tier Fallback: Accessibility -> Strict -> Contextual -> Text)
              ├── [FlowVisualFallback] (Relative Geometric Anchor Probe elementFromPoint)
              └── [FlowCheckpointManager] & [FlowCrashResumeCoordinator] (Lá chắn lũy đẳng Idempotency Jump)
```

### 5.2. Vấn đề phát hiện khi khảo sát thực nghiệm

Khi chạy thử nghiệm script độc lập (`scripts/test-google-flow-nodes.ts`), kết quả ghi nhận:
```
[Google Flow Browser] Sảnh Google Flow chưa sẵn sàng.
Error: [Google Flow] Không nhận được ảnh từ Google Flow sau thời gian chờ.
```
**Nguyên nhân gốc rễ:**
- Chế độ `free_session` đòi hỏi `GoogleVeoSessionManager` phải có phiên đăng nhập hợp lệ (`validateSession().valid === true`), và cần cửa sổ Electron `lobbyWindow` để kết nối DOM Google Labs.
- Khi người dùng mới chưa đăng nhập Google, hoặc khi chạy test tự động terminal (`npx tsx`), sảnh này ở trạng thái `unauthenticated`.

### 5.3. Giải pháp Kiến trúc Real Mode vs Mock / Fallback Asset Mode

Để bảo đảm quy trình 8 bước **One-Click Auto-Pilot** và script kiểm thử tự động **hoạt động trơn tru 100% không bao giờ bị dừng giữa chừng**:

1. **Kiểm tra điều kiện trước khi sinh phân cảnh (Step 6):**
   - Đọc cấu hình `aiStudioConfig.flowEngine`.
   - Kiểm tra `GoogleVeoSessionManager.getInstance().validateSession()`.
2. **Nhánh 1 — Real Mode (Khi đã có phiên Google Flow):**
   - Đưa task vào `FlowTaskQueue`.
   - Gọi `sessionMgr.generateImageViaBrowserContext({ prompt, aspectRatio, ... })`.
   - Tải file về thư mục `downloadDir`.
3. **Nhánh 2 — Fallback / Synthetic Asset Mode (Khi chưa đăng nhập hoặc test):**
   - Kích hoạt bộ sinh ảnh giả lập chất lượng cao bằng FFmpeg (tương tự `GoogleFlowAdapter.ts:978` `generateSyntheticImage`).
   - Tạo ảnh nền gradient điện ảnh (1920x1080 hoặc 1080x1920 tùy `aspectRatio`), đè text mô tả phân cảnh và watermark demo.
   - Nếu môi trường không có font hoặc FFmpeg gặp lỗi, tạo PNG base64 hợp lệ để đảm bảo luôn có file ảnh thật trên đĩa cho bước dựng phim (Step 7).
4. **Cơ chế Checkpoint khôi phục lỗi:**
   - Sử dụng cơ chế lưu checkpoint trạng thái JSON cho từng dự án AI Studio (`projectDir/checkpoint.json`).
   - Nếu bước sinh ảnh qua Google Flow bị gián đoạn do Captcha hoặc mạng: lưu lại checkpoint ở Step 5; khi người dùng đăng nhập lại và bấm "Tiếp tục", hệ thống **chỉ chạy tiếp từ Step 6** mà không sinh lại kịch bản (Step 2) hay giọng đọc (Step 3).

---

## 6. KHẢO SÁT TTS, WHISPER & DỰNG PHIM FFMPEG

### 6.1. Edge TTS & Trích xuất Word-Boundary Alignment

Khảo sát package `msedge-tts` (v2.0.7):
- File client hiện tại: `main/tts-providers/edge/EdgeTTSClient.ts`.
- **Phát hiện quan trọng:** Thư viện `msedge-tts` hỗ trợ **Word-Boundary Metadata gốc** thông qua tùy chọn `MetadataOptions`:
  ```typescript
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
    sentenceBoundaryEnabled: true,
  });
  const { audioStream, metadataStream } = tts.toStream(text, prosodyOptions);
  ```
- Luồng `metadataStream` trả về các sự kiện JSON định dạng:
  ```json
  {
    "Type": "WordBoundary",
    "Data": {
      "Offset": 1500000,
      "Duration": 3200000,
      "text": { "Text": "chào", "Length": 4 }
    }
  }
  ```
  *(Đơn vị Offset/Duration tính bằng 100ns; quy đổi sang mili-giây bằng cách chia cho 10,000).*
- **Đánh giá:** Tính năng này cho phép hoàn thành đồng thời cả **Bước 3 (Lồng tiếng)** và **Bước 4 (Trích xuất Time Alignment)** trong một lần gọi mạng duy nhất, đạt độ chính xác mili-giây tuyệt đối mà không cần chạy mô hình Whisper nặng nề.

### 6.2. Whisper Engine (`main/asr/whisperEngine.ts`)

- Dự án tích hợp `nodejs-whisper` (v0.3.1) và thực thi nhị phân `whisper-cli` thông qua `child_process.spawn`.
- Tự động định vị model trong `node_modules/nodejs-whisper/cpp/whisper.cpp/models`.
- Vai trò trong AI Studio: Đóng vai trò làm công cụ căn chỉnh thứ cấp (Secondary Aligner) khi người dùng tải tệp âm thanh bên ngoài vào (Custom Studio Audio Import).

### 6.3. FFmpeg Binary Resolution & Windows Path Escaping

1. **Định vị Binary an toàn (`main/render/videoRenderer.ts:8-29`):**
   - Sử dụng `@ffmpeg-installer/ffmpeg` và `@ffprobe-installer/ffprobe`.
   - Chuẩn hóa đường dẫn khi đóng gói ứng dụng: `.replace('app.asar', 'app.asar.unpacked')`.
   - Giúp các lệnh execFile hoạt động ổn định cả trong môi trường dev lẫn sau khi đóng gói installer.
2. **Quy tắc thoát đường dẫn Windows (Windows Path Escaping):**
   - Trong filter FFmpeg, ký tự `:` trong ổ đĩa `C:\` và dấu `\` gây lỗi nghiêm trọng nếu không xử lý.
   - Codebase đã có sẵn giải pháp chuẩn mực:
     ```typescript
     function escapeFfmpegSubtitlesPath(srtPath: string): string {
       let escaped = srtPath.replace(/\\/g, '/');
       escaped = escaped.replace(/^([A-Za-z]):/, '$1\\:');
       return escaped;
     }
     ```

### 6.4. Kỹ thuật Dựng phim FFmpeg cho Step 7 (Video Assembly)

Để thực thi Step 7 trong pipeline 8 bước, dịch vụ `AiStudioVideoAssembler` cần kết hợp 4 lớp kỹ thuật:

1. **Hiệu ứng Ken Burns cho ảnh tĩnh (Pan/Zoom):**
   Sử dụng filter `zoompan` của FFmpeg:
   ```
   zoompan=z='min(zoom+0.0015,1.15)':d=${durationFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}
   ```
2. **Tạo chuỗi phân cảnh (Scene Concat):**
   Ghép các clip/ảnh của từng câu thoại qua FFmpeg Concat Demuxer hoặc Filter Complex.
3. **Trộn nhạc nền & Tự động hạ âm (Audio Ducking):**
   Kết hợp giọng đọc `voiceover.mp3` và nhạc nền `bgm.mp3`:
   ```
   [1:a]volume=0.12[bgm];[0:a][bgm]sidechaincompress=threshold=0.1:ratio=4:attack=50:release=300[ducked_bgm];[0:a][ducked_bgm]amix=inputs=2:duration=first[aout]
   ```
4. **Gắn phụ đề động (Dynamic Subtitles):**
   - Biên dịch mốc thời gian thành tệp `.ass` qua `assCompiler.ts`.
   - Áp filter `-vf "ass='escaped_path.ass'"` để render phụ đề chất lượng cao (TikTok Bold viền đen chữ vàng, Minimalist chữ trắng bóng đổ, hoặc Karaoke highlight).

---

## 7. BIÊN DỊCH TYPESCRIPT & CHIẾN LƯỢC KIỂM THỬ TỰ ĐỘNG

### 7.1. Trạng thái Biên dịch TypeScript

- Thực thi lệnh kiểm tra: `npx tsc --noEmit`
- **Kết quả:** `Exit Code: 0` (100% Type-Safe, hoàn toàn không có lỗi biên dịch).
- Cả `main/` và `renderer/` đều được kiểm soát chặt chẽ bởi `tsconfig.json` gốc (`strict: true`).

### 7.2. Phương thức kiểm thử hiện hữu trong dự án

- Không sử dụng Jest/Vitest/Mocha cồng kềnh.
- Toàn bộ codebase Vanhsub chuẩn hóa phương pháp kiểm thử thông qua các script độc lập chạy bằng `npx tsx scripts/<script_name>.ts` (ví dụ `test-render.ts`, `test-google-flow-nodes.ts`, `test-ocr.ts`...).

### 7.3. Thiết kế Script Kiểm thử Tự động `scripts/test_ai_studio_pipeline.ts`

Tuân thủ tiêu chí nghiệm thu tự động (Acceptance Criteria), script kiểm thử độc lập sẽ thực thi theo chu trình khép kín:

```
[Khởi tạo thư mục tạm os.tmpdir()]
              │
              ▼
[1. Lưu & Đọc cấu hình aiStudioStore] (Xác minh ghi đĩa và giải mã apiKey)
              │
              ▼
[2. Sinh kịch bản mẫu 3 phân cảnh] (Xác minh kịch bản cấu trúc JSON)
              │
              ▼
[3. Gọi msedge-tts tạo voiceover.mp3] (Tạo file âm thanh thật tiếng Việt)
              │
              ▼
[4. Trích xuất Word-Boundary Time Alignment] (Xác minh mốc thời gian start/end)
              │
              ▼
[5. Tạo Visual Assets (Fallback Mode)] (Tạo 3 ảnh phân cảnh bằng FFmpeg)
              │
              ▼
[6. Dựng Video Hoàn Chỉnh qua FFmpeg] (Ghép audio + visual Ken Burns + sub ASS)
              │
              ▼
[7. Assert & Verify File Output] (Kiểm tra MP4 tồn tại, duration > 0, size > 50KB)
```

---

## 8. SƠ ĐỒ KIẾN TRÚC TỔNG THỂ PHÂN HỆ AI VIDEO STUDIO

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                   RENDERER PROCESS                                    │
│                                                                                       │
│  ┌─────────────────────────┐  ┌───────────────────────────┐  ┌─────────────────────┐  │
│  │   Chế độ 1: Auto-Pilot  │  │ Chế độ 2: Custom Studio   │  │   Cấu hình AI Studio│  │
│  │   (One-Click Pipeline)  │  │ (3 Tabs: Script, Story,   │  │   (Dedicated Store) │  │
│  │   - Topic Input         │  │  Video Editor)            │  │   - LLM, Voice,     │  │
│  │   - 8-Step Progress Bar │  │ - Inline Text/Time Edit   │  │     Flow, Rendering,│  │
│  │   - Preview Player      │  │ - Regerate Visual/Voice   │  │     Subtitles       │  │
│  └───────────┬─────────────┘  └─────────────┬─────────────┘  └──────────┬──────────┘  │
│              │                              │                           │             │
│              └──────────────────────┬───────┴───────────────────────────┘             │
│                                     ▼                                                 │
│                     Zustand Store: `useAiStudioStore`                                 │
│                                     │                                                 │
│                      window.vanhsub.aiStudio.* (IPC)                                  │
└─────────────────────────────────────┼─────────────────────────────────────────────────┘
                                      │ IPC Invoke / Events
┌─────────────────────────────────────┼─────────────────────────────────────────────────┐
│                                     ▼                                                 │
│                                MAIN PROCESS                                           │
│                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│  │                       IPC Router: `main/ai-studio/ipc.ts`                       │  │
│  └──────────────────────────────────┬──────────────────────────────────────────────┘  │
│                                     │                                                 │
│         ┌───────────────────────────┼───────────────────────────┐                     │
│         ▼                           ▼                           ▼                     │
│  ┌──────────────┐          ┌───────────────────┐       ┌───────────────────────────┐  │
│  │aiStudioStore │          │AiStudioProjectMgr │       │ AiStudioPipelineService   │  │
│  │(vanhsub-ai-  │          │(Project Checkpoint│       │ (8-Step Orchestrator)     │  │
│  │studio.json)  │          │ State Machine)    │       └─────────────┬─────────────┘  │
│  └──────────────┘          └───────────────────┘                     │                │
│                                                                      ▼                │
│                  ┌───────────────────────────────────────────────────┴─────────────┐  │
│                  │           CÁC SUB-SERVICE THỰC THI CHUYÊN TRÁCH                 │  │
│                  ├─────────────────────────────────────────────────────────────────┤  │
│                  │ 1. AiStudioLlmService     -> OpenAI / DeepSeek API (Script, SEO)│  │
│                  │ 2. AiStudioTtsService     -> MsEdgeTTS (Voice + Word Boundary)  │  │
│                  │ 3. AiStudioVisualService  -> Google Flow Engine / Fallback Mode │  │
│                  │ 4. AiStudioAssembler      -> FFmpeg (Ken Burns + Ducking + ASS) │  │
│                  └─────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. ĐỀ XUẤT KẾ HOẠCH TRIỂN KHAI BACKEND (SPRINT 1 & 2)

### 9.1. Danh mục các file Backend cần tạo mới

1. **Store & Types:**
   - `main/store/aiStudioStore.ts`: Store cấu hình độc lập qua `electron-store`, tích hợp `safeStorage`.
   - `main/ai-studio/types.ts`: Toàn bộ type definitions cho Project, Script, Timeline, Scene, PipelineState.
2. **Pipeline Services (`main/ai-studio/services/`):**
   - `AiStudioLlmService.ts`: Xử lý sinh kịch bản (70 câu / beat), visual prompts và chấm điểm kịch bản.
   - `AiStudioTtsService.ts`: Xử lý sinh giọng đọc qua `msedge-tts` và bóc tách mốc thời gian Word-Boundary.
   - `AiStudioVisualService.ts`: Cầu nối với Google Flow (`GoogleVeoSessionManager`) kèm bộ sinh Synthetic Assets FFmpeg khi chưa đăng nhập.
   - `AiStudioVideoAssembler.ts`: Dựng video hoàn chỉnh (ghép audio, visual, hiệu ứng Ken Burns, audio ducking, sub ASS).
   - `AiStudioPipelineService.ts`: Điều phối 8 công đoạn liên hoàn, hỗ trợ Pause, Resume, Checkpoint.
3. **IPC Controller:**
   - `main/ai-studio/ipc.ts`: Định nghĩa và đăng ký toàn bộ kênh IPC cho AI Studio.
4. **Preload & Renderer Typings:**
   - Cập nhật `main/preload.ts`: Thêm namespace `vanhsub.aiStudio`.
   - Cập nhật `renderer/types/electron.d.ts`: Bổ sung interface `AiStudioAPI`.
5. **Test Harness:**
   - `scripts/test_ai_studio_pipeline.ts`: Script kiểm thử độc lập 100% không giao diện.

### 9.2. Ma trận Rủi ro & Giải pháp Phòng vệ

| Rủi ro kỹ thuật | Mức độ | Biện pháp phòng vệ |
| :--- | :--- | :--- |
| Xung đột cấu hình với tính năng phụ đề cũ của Vanhsub | Cao | Cách ly 100% file lưu trữ (`vanhsub-ai-studio.json`), tuyệt đối không đụng vào `vanhsub-settings.json`. |
| Google Flow bị gián đoạn (hết credit, captcha, mạng) | Cao | Triển khai Dual Mode (Real + Synthetic Fallback) và Checkpoint Manager cho phép Resume từ bước lỗi mà không chạy lại LLM/TTS. |
| Edge TTS bị ngắt kết nối WebSocket | Trung bình | Tích hợp Exponential Retry (tối đa 3 lần), timeout 25s, tự hủy stream khi lỗi. |
| FFmpeg lỗi đường dẫn trên Windows | Trung bình | Dùng `escapeFfmpegSubtitlesPath` cho đường dẫn phụ đề `.ass` và bọc nháy đơn các filter complex. |
| Lệch timestamp khi sửa câu thoại trong Custom Studio | Thấp | Khi người dùng sửa text của một câu, chỉ kích hoạt TTS và trích xuất lại time cho riêng câu đó rồi cập nhật offset các câu sau. |

---

## 10. KẾT LUẬN

Backend của Vanhsub có kiến trúc module hoá tốt, đã tích hợp sẵn hầu hết các công nghệ lõi cần thiết (Edge TTS, Whisper, FFmpeg, Google Flow Automation, Electron-store). Việc triển khai phân hệ AI Video Studio theo tài liệu `AI_STUDIO_SPEC.md` là hoàn toàn khả thi, có thể thực hiện độc lập và an toàn mà không gây bất kỳ tác dụng phụ nào tới các tính năng hiện hữu của ứng dụng.
