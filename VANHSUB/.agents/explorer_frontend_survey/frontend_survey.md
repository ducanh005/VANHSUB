# Báo Cáo Khảo Sát Kiến Trúc Frontend: Tích Hợp AI Video Studio (Vanhsub)

**Dự án:** Vanhsub Desktop (Electron + Nextron + Next.js + React + TailwindCSS + TypeScript)  
**Tài liệu tham chiếu:** `d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md` & `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md`  
**Vai trò chuyên trách:** Frontend Architecture Explorer  
**Thời gian khảo sát:** 2026-09-17  
**Vị trí tài liệu:** `d:\DEAN\DEAN\VANHSUB\.agents\explorer_frontend_survey\frontend_survey.md`

---

## 📑 MỤC LỤC
1. [Tóm Tắt Khảo Sát (Executive Summary)](#1-tóm-tắt-khảo-sát-executive-summary)
2. [Cấu Trúc Thư Mục & Phân Tầng Component (Renderer Directory Layout)](#2-cấu-trúc-thư-mục--phân-tầng-component-renderer-directory-layout)
3. [Cơ Chế Điều Hướng & Thanh Sidebar (Sidebar & Navigation Architecture)](#3-cơ-chế-điều-hướng--thanh-sidebar-sidebar--navigation-architecture)
4. [Quản Lý State & Đồng Bộ IPC (Renderer State Management & IPC Sync)](#4-quản-lý-state--đồng-bộ-ipc-renderer-state-management--ipc-sync)
5. [Hệ Thống Thiết Kế Giao Diện (UI Design System & Styling Tokens)](#5-hệ-thống-thiết-kế-giao-diện-ui-design-system--styling-tokens)
6. [Hệ Thống Xem Trước Đa Phương Tiện (Media Preview & Subtitle Overlay)](#6-hệ-thống-xem-trước-đa-phương-tiện-media-preview--subtitle-overlay)
7. [Bản Thiết Kế Tích Hợp Chi Tiết Phân Hệ AI Studio (Detailed Integration Blueprint)](#7-bản-thiết-kế-tích-hợp-chi-tiết-phân-hệ-ai-studio-detailed-integration-blueprint)
   - 7.1. Main Container & Mode Switcher (`AiStudioContainer.tsx`)
   - 7.2. Chế độ 1: Auto-Pilot One-Click Pipeline (`AutoPilotView.tsx`)
   - 7.3. Chế độ 2: Custom Workflow Studio (`CustomStudioView.tsx`)
     - Tab 1: Kịch bản & Giọng Đọc (`ScriptVoiceTab.tsx`)
     - Tab 2: Phân Cảnh Trực Quan Storyboard (`StoryboardTab.tsx`)
     - Tab 3: Dựng Phim & Phụ Đề & BGM (`AssemblyTab.tsx`)
   - 7.4. Màn Hình Cấu Hình Riêng (`AiStudioSettingsTab.tsx`)
8. [Kế Hoạch & Danh Sách Tệp Cần Tạo / Chỉnh Sửa (File Creation & Edit Roadmap)](#8-kế-hoạch--danh-sách-tệp-cần-tạo--chỉnh-sửa-file-creation--edit-roadmap)

---

## 1. TÓM TẮT KHẢO SÁT (EXECUTIVE SUMMARY)

Ứng dụng **Vanhsub** là phần mềm desktop xây dựng trên nền tảng **Nextron 10.3.0** (Next.js 16.3.2 Pages Router + Electron 43.4.1 + React 19.2.8 + TailwindCSS 4.3.3 + TypeScript 5.9.3). 

### Các Điểm Khảo Sát Nổi Bật:
1. **Mô hình SPA (Single Page Application) trong Nextron**: Toàn bộ UI chính của ứng dụng được mount tập trung tại `renderer/pages/home.tsx`. Các trang chức năng (`home`, `workflow`, `subtitles`, `editor`, `dubbing`, `export`, `settings`) **luôn được mount đồng thời trong DOM** và chỉ chuyển đổi hiển thị bằng CSS class `hidden`. Quy chuẩn này giúp bảo toàn 100% trạng thái hoạt động (như tiến trình phát audio xem thử, dữ liệu form đang nhập dở, scroll position) khi người dùng chuyển đổi qua lại giữa các menu.
2. **Cơ chế Sidebar linh hoạt**: Sidebar nằm trực tiếp trong `home.tsx` (dòng 418-544), điều phối trạng thái qua state `activeTab` (`useState('home')`). Hỗ trợ co gọn (collapsed: 68px) và mở rộng (expanded: 240px), có Zen Mode (ẩn toàn bộ thanh điều hướng khi cần không gian làm việc tối đa). Việc bổ sung tab **"AI Studio"** vào mảng `getNavItems()` là hoàn toàn khả thi, cực kỳ sạch sẽ và không gây side-effect cho các tab hiện hữu.
3. **Quản lý trạng thái Zustand & IPC Bridge**: Phía renderer đã có `renderer/lib/store/workflowStore.ts` sử dụng `zustand ^5.0.15`. IPC giao tiếp với main process được định nghĩa chặt chẽ qua `main/preload.ts` và `renderer/types/electron.d.ts` trên namespace `window.vanhsub`. Tương ứng, việc thiết lập `useAiStudioStore` độc lập ở `renderer/lib/store/aiStudioStore.ts` đồng bộ với `main/store/aiStudioStore.ts` (dùng `electron-store`) hoàn toàn ăn khớp với quy chuẩn hiện tại.
4. **Design System đồng nhất**: TailwindCSS v4 cấu hình qua `@import "tailwindcss"; @plugin "tailwindcss-animate";` tại `renderer/styles/globals.css`. Hệ màu tối hiện đại **Obsidian AI Space** (`bg-[#080D1A]`, `bg-[#0B1120]`, `bg-slate-900/60`, border `border-slate-800/80`), hiệu ứng neon gradient thương hiệu (`--brand-cyan: #0EA5E9`, `--brand-indigo: #6366F1`, `--brand-rose: #F43F5E`), các tiện ích `.btn-vanh-gradient`, `.card-glass`, `.card-glass-hover`. Sử dụng trực tiếp các component không style của `@radix-ui` (`dialog`, `tabs`, `slider`, `select`, `switch`, `progress`, `collapsible`, `tooltip`) kết hợp icon `lucide-react` và toast `sonner`.
5. **Thành phần Video/Audio Preview sẵn có**: Đã có sẵn thành phần `VideoPreviewCanvas.tsx` (tại `renderer/components/export/VideoPreviewCanvas.tsx`) hỗ trợ xem trước video theo tỉ lệ (`16:9`, `9:16`, `1:1`), phát file nội bộ qua custom protocol `vanhmedia://local/`, render phụ đề thời gian thực với đầy đủ font, size, outline shadow, drag-and-drop vị trí. Audio engine có `renderer/lib/fullPreviewPlayer.ts` là singleton player sống ngoài vòng đời React, cho phép nghe thử kịch bản/lồng tiếng xuyên suốt kể cả khi đổi tab.
6. **Mô hình Storyboard Card tham khảo sẵn có**: `renderer/components/workflow/StoryboardDirectorStudio.tsx` đã chứng minh tính hiệu quả của mô hình quản lý kịch bản $\rightarrow$ chia shot phân cảnh $\rightarrow$ tạo ảnh Imagen 3 $\rightarrow$ inpainting $\rightarrow$ diễn hoạt video. Module Custom Studio của AI Video Studio có thể kế thừa trực tiếp pattern này.

---

## 2. CẤU TRÚC THƯ MỤC & PHÂN TẦNG COMPONENT (RENDERER DIRECTORY LAYOUT)

Cấu trúc thư mục nguồn của phân hệ Renderer tại `d:\DEAN\DEAN\VANHSUB\renderer`:

```
renderer/
├── pages/                          # Điểm vào Next.js Pages Router
│   ├── _app.tsx                    # Root App Wrapper (nhập styles/globals.css)
│   └── home.tsx                    # SPA Container chính (chứa Sidebar, Header, Tab Views)
│
├── components/                     # Các phân hệ giao diện chính
│   ├── ASRModelSelector.tsx        # Modal/Dropdown chọn Whisper model
│   ├── ASRWorkspace.tsx            # Không gian tạo phụ đề & phiên âm ASR
│   ├── ExportPage.tsx              # Trang xuất video (hardsub/softsub/audio)
│   ├── OcrConfigModal.tsx          # Modal cấu hình OCR quét phụ đề cứng
│   ├── OnboardingModal.tsx         # Popup hướng dẫn 5 bước người dùng mới
│   ├── SettingsPage.tsx            # Cài đặt hệ thống chung (Gemini, VietTTS, Whisper, OCR)
│   ├── SubtitleEditor.tsx          # Trình hiệu đính phụ đề chuyên sâu theo từng dòng
│   ├── TTSPage.tsx                 # Trang lồng tiếng AI (TikTok TTS / VietTTS)
│   ├── TerminalPanel.tsx           # Panel log hệ thống thời gian thực
│   │
│   ├── download/                   # Phân hệ tải video từ link
│   │   └── DownloadModal.tsx       # Modal phân tích & tải video Douyin/YouTube/TikTok
│   │
│   ├── export/                     # Các công cụ dựng & xuất video
│   │   ├── ExportFormatPanel.tsx   # Tùy chọn định dạng render
│   │   ├── OverlayMaskEditor.tsx   # Trình vẽ dải che / vùng che mờ (mask)
│   │   ├── SubtitlesStyleEditor.tsx# Bảng tùy biến style chữ phụ đề (preset, màu, viền)
│   │   └── VideoPreviewCanvas.tsx  # Trình phát video live preview kèm lớp phụ đề động
│   │
│   ├── workflow/                   # Phân hệ Node Graph Canvas & Storyboard
│   │   ├── ApiKeyConfigModal.tsx   # Quản lý Session Google Veo / Gemini API Key
│   │   ├── CharacterBibleModal.tsx # Quản lý hồ sơ nhân vật nhất quán
│   │   ├── SceneBibleModal.tsx     # Quản lý bối cảnh & ánh sáng
│   │   ├── ImageInpaintModal.tsx   # Cọ vẽ inpainting sửa chi tiết ảnh
│   │   ├── StoryboardDirectorStudio.tsx # Studio phân rã kịch bản thành các shot
│   │   ├── MasterTimeline.tsx      # Thanh timeline đa track
│   │   ├── WorkflowCanvas.tsx      # Canvas kéo thả node @xyflow/react
│   │   └── nodes/                  # Định nghĩa các Node thực thi
│   │
│   └── ai-studio/                  # [PHÂN HỆ MỚI ĐỀ XUẤT]
│       ├── AiStudioContainer.tsx   # Container chính phân hệ AI Studio
│       ├── AutoPilotView.tsx       # Chế độ 1: AI Tự Sản Xuất One-Click
│       ├── CustomStudioView.tsx    # Chế độ 2: Người Dùng Tự Workflow (3 Tab)
│       ├── AiStudioSettingsTab.tsx # Tab Cấu Hình Riêng Biệt của AI Studio
│       ├── autopilot/              # Component phụ của Auto-Pilot
│       │   ├── IdeaInputCard.tsx
│       │   ├── PipelineStatusTracker.tsx
│       │   └── QuickPreviewPanel.tsx
│       └── custom/                 # Component phụ của Custom Studio
│           ├── ScriptVoiceTab.tsx
│           ├── StoryboardTab.tsx
│           └── AssemblyTab.tsx
│
├── lib/                            # Thư viện tiện ích, stores và helpers
│   ├── fullPreviewPlayer.ts        # Singleton audio player phát kịch bản không ngắt quãng
│   ├── i18n.ts                     # Hàm dịch đa ngôn ngữ t(...)
│   ├── modelSelector.ts            # Quản lý tải / xóa mô hình Whisper
│   ├── srt.ts                      # Re-export parser SRT từ main/lib/srt.ts
│   ├── ttsOptions.ts               # Định nghĩa các tùy chọn giọng & tốc độ TTS
│   ├── store/                      # Zustand Stores
│   │   ├── workflowStore.ts        # Store quản lý graph node canvas
│   │   └── aiStudioStore.ts        # [MỚI] Store quản lý cấu hình & pipeline AI Studio
│   └── workflow/                   # Logic registry & presets cho workflow
│
├── locales/
│   └── vi.json                     # Từ điển tiếng Việt
├── styles/
│   └── globals.css                 # TailwindCSS v4 tokens & custom classes
└── types/
    ├── electron.d.ts               # Window.vanhsub API contracts
    ├── task.ts                     # Task data model
    ├── workflow.ts                 # Workflow graph model
    └── aiStudio.ts                 # [MỚI] TypeScript types cho AI Studio
```

---

## 3. CƠ CHẾ ĐIỀU HƯỚNG & THANH SIDEBAR (SIDEBAR & NAVIGATION ARCHITECTURE)

### 3.1. Vị Trí Triển Khai Hiện Tại
Toàn bộ logic điều hướng được đặt tại file `renderer/pages/home.tsx`:
- Khởi tạo state: dòng 82:
  ```typescript
  const [activeTab, setActiveTab] = useState('home');
  ```
- Danh sách các mục điều hướng: dòng 49-64:
  ```typescript
  type NavItem = {
    id: string;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: string;
  };

  const getNavItems = (): NavItem[] => [
    { id: 'home', label: t('sidebar.home'), icon: Film },
    { id: 'workflow', label: 'Workflow AI', icon: Workflow, badge: 'MỚI' },
    { id: 'subtitles', label: t('sidebar.subtitles'), icon: Subtitles },
    { id: 'editor', label: t('sidebar.editor'), icon: MessageSquareText },
    { id: 'dubbing', label: t('sidebar.dubbing'), icon: Mic },
    { id: 'export', label: t('sidebar.export'), icon: Layers },
    { id: 'settings', label: t('sidebar.settings'), icon: Settings },
  ];
  ```

### 3.2. Cấu Trúc DOM Thanh Sidebar
Nằm ở dòng 418-544 trong `home.tsx`:
- Khung ngoài `<aside>`:
  - Width chuyển đổi mượt: `w-[68px]` (khi `isSidebarCollapsed = true`) hoặc `w-[240px]` (khi expanded).
  - Background: `bg-[#0B1120]`, viền phải `border-r border-slate-800/80`.
  - Hỗ trợ Zen Mode: `isZenMode && activeTab === 'workflow'` ẩn hoàn toàn sidebar để nhường chỗ cho canvas.
- Nút bấm danh mục:
  - Khi active: `bg-gradient-to-r from-brand-indigo/25 to-brand-cyan/15 text-white border border-brand-indigo/40 shadow-sm`.
  - Khi inactive: `text-slate-400 hover:bg-slate-800/60 hover:text-slate-200`.
  - Icon active: `text-brand-cyan`.
  - Badge: Hỗ trợ hiển thị badge (ví dụ: `MỚI`, `HOT`) với màu `bg-brand-rose/20 text-brand-rose`.
- Widget AI Engine: Phía đáy sidebar hiển thị trạng thái hoạt động của Whisper model, Gemini Flash, TTS Voice.

### 3.3. Cơ Chế Chuyển Đổi Tab & Header
- Header chính (dòng 550-608):
  Hiển thị tiêu đề động theo `activeTab`:
  ```tsx
  <h2 className="text-lg font-semibold text-white tracking-tight">
    {activeTab === 'workflow'
      ? 'Workflow AI Studio'
      : activeTab === 'editor'
      ? 'Hiệu đính Phụ đề'
      : activeTab === 'dubbing'
      ? 'Lồng tiếng AI'
      : activeTab === 'export'
      ? 'Xuất Video'
      : activeTab === 'settings'
      ? 'Cài đặt Hệ thống'
      : activeTab === 'subtitles'
      ? 'Không gian Phụ đề'
      : activeTab === 'ai_studio'
      ? 'Xưởng Video AI (AI Studio)'
      : 'Studio Trang chủ'}
  </h2>
  ```
- Khu vực Body (dòng 613-656):
  **Nguyên tắc cốt lõi: Tất cả các tab luôn giữ trạng thái mounted trong DOM, chỉ ẩn bằng class `hidden`:**
  ```tsx
  <div className={activeTab === 'workflow' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
    <WorkflowCanvas ... />
  </div>
  <div className={activeTab === 'editor' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
    <SubtitleEditor ... />
  </div>
  ...
  ```

### 3.4. Điểm Tích Hợp Thêm Mục "AI Studio" Cực Kỳ Sạch Sẽ:
Để bổ sung "AI Studio" theo đúng đặc tả `AI_STUDIO_SPEC.md` mục 2:
1. **Cập nhật `getNavItems()`** trong `home.tsx`:
   ```typescript
   import { Sparkles, Video, Bot } from 'lucide-react';
   // Chèn ngay dưới 'home' hoặc ngay sau 'workflow'
   { id: 'ai_studio', label: 'AI Video Studio', icon: Bot, badge: 'HOT' }
   ```
2. **Cập nhật Header Title** trong `home.tsx`:
   Thêm nhánh `activeTab === 'ai_studio' ? 'Xưởng Video AI (AI Studio)' : ...`
3. **Cập nhật Body Container** trong `home.tsx`:
   ```tsx
   <div className={activeTab === 'ai_studio' ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'hidden'}>
     <AiStudioContainer
       onNavigateTab={setActiveTab}
       tasks={tasks}
       isActive={activeTab === 'ai_studio'}
     />
   </div>
   ```

---

## 4. QUẢN LÝ STATE & ĐỒNG BỘ IPC (RENDERER STATE MANAGEMENT & IPC SYNC)

### 4.1. Khảo Sát Kiến Trúc Zustand Hiện Hữu
Tại `renderer/lib/store/workflowStore.ts`:
- Sử dụng thư viện `zustand ^5.0.15` tạo store dạng hook: `export const useWorkflowStore = create<WorkflowState>((set, get) => ({ ... }))`.
- Tách biệt rõ ràng giữa **State** (dữ liệu) và **Actions** (hàm biến đổi).
- Cơ chế Undo/Redo bằng 2 mảng snapshot `historyPast` và `historyFuture`.
- Lưu trữ cục bộ qua `localStorage` (`vanhsub_saved_workflows`).

### 4.2. Khảo Sát IPC Preload Bridge
Tại `main/preload.ts`:
- `contextBridge.exposeInMainWorld('vanhsub', vanhsub)` tạo cầu nối an toàn giữa Chromium Renderer và Node.js Electron Main Process.
- Các module hiện có:
  - `vanhsub.tasks`: `getAll`, `get`, `create`, `update`, `delete`, `start`, `cancel`, `runPipeline`, `onUpdate`.
  - `vanhsub.settings`: `get(key)`, `set(key, value)`.
  - `vanhsub.ai`: `polishLine`, `translateLine`, `cleanSubtitles`.
  - `vanhsub.tts`: `preview`, `start`, `cancel`, `regenerateLine`.
  - `vanhsub.veo`: `openLobby`, `status`, `validate`, `saveSession`, `getAntiSpamStatus`, `setMode`.
  - `vanhsub.workflow`: `run`, `runNode`, `cancel`, `onNodeEvent`.
  - `vanhsub.dialog`: `openMediaFile`, `openImageFile`, `showInFolder`, `chooseDirectory`.

### 4.3. Kiến Trúc Store Đề Xuất Cho AI Studio: `useAiStudioStore`
Để đáp ứng Requirement **R1** trong `ORIGINAL_REQUEST.md` và Mục 5 trong `AI_STUDIO_SPEC.md` mà **không làm xung đột** với `settingsStore` và `workflowStore`, ta xây dựng:
1. Phía Main Process: `main/store/aiStudioStore.ts` (lưu file JSON riêng biệt qua `electron-store`).
2. Phía Preload: bổ sung namespace `vanhsub.aiStudio` vào `main/preload.ts`:
   - `getSettings(): Promise<AiStudioConfig>`
   - `setSettings(partial: Partial<AiStudioConfig>): Promise<boolean>`
   - `runAutoPilot(input: AutoPilotInput): Promise<{ sessionId: string }>`
   - `resumePipeline(sessionId: string, fromStep?: number): Promise<boolean>`
   - `cancelPipeline(sessionId: string): Promise<boolean>`
   - `onPipelineEvent(callback: (event: PipelineEvent) => void): () => void`
3. Phía Renderer: `renderer/lib/store/aiStudioStore.ts` dùng Zustand:

```typescript
import { create } from 'zustand';
import type { AiStudioConfig, PipelineSession, PipelineStepStatus } from '../../types/aiStudio';

export const DEFAULT_AI_STUDIO_CONFIG: AiStudioConfig = {
  llm: {
    provider: 'deepseek',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.6,
    systemPromptPreset: 'youtube_story',
  },
  voice: {
    provider: 'edge_tts',
    voiceId: 'vi-VN-HoaiMyNeural',
    rate: '+0%',
    pitch: '+0Hz',
    volume: '+0%',
    autoWordAlignment: true,
  },
  flowEngine: {
    aspectRatio: '16:9',
    outputMode: 'image',
    stylePromptPrefix: 'Cinematic lighting, high resolution, detailed photorealistic, 4k',
    negativePrompt: 'watermark, text, blurry, distortion, lowres',
    outputsPerScene: 1,
    downloadDir: '',
    concurrency: 1,
  },
  rendering: {
    resolution: '1080p',
    fps: 30,
    kenBurnsEffect: true,
    kenBurnsScale: 1.15,
    transitionDuration: 0.5,
    bgmVolume: 0.12,
    autoAudioDucking: true,
  },
  subtitles: {
    enabled: true,
    preset: 'tiktok_bold',
    fontSize: 24,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 3,
    positionY: 80,
  },
};

interface AiStudioState {
  // Navigation State inside AI Studio
  activeMode: 'auto-pilot' | 'custom-studio' | 'settings';
  customStudioTab: 'script-voice' | 'storyboard' | 'assembly';

  // Config
  config: AiStudioConfig;
  isConfigLoaded: boolean;
  isSavingConfig: boolean;

  // Active Auto-Pilot Session
  currentSession: PipelineSession | null;
  isRunningPipeline: boolean;

  // Actions
  setActiveMode: (mode: 'auto-pilot' | 'custom-studio' | 'settings') => void;
  setCustomStudioTab: (tab: 'script-voice' | 'storyboard' | 'assembly') => void;
  loadConfig: () => Promise<void>;
  updateConfig: <K extends keyof AiStudioConfig>(section: K, values: Partial<AiStudioConfig[K]>) => Promise<void>;
  startAutoPilot: (ideaText: string, preset?: string) => Promise<void>;
  retryStep: (stepNumber: number) => Promise<void>;
  cancelPipeline: () => Promise<void>;
  updateCustomScriptLine: (lineId: string, text: string) => void;
  updateStoryboardCard: (cardId: string, updates: any) => void;
}
```

---

## 5. HỆ THỐNG THIẾT KẾ GIAO DIỆN (UI DESIGN SYSTEM & STYLING TOKENS)

### 5.1. TailwindCSS v4 Setup
- Tại `renderer/styles/globals.css`, ứng dụng sử dụng kiến trúc CSS Variables và `@theme inline` của TailwindCSS v4:
  - `@import "tailwindcss";`
  - `@plugin "tailwindcss-animate";`
- **Bảng Màu Chủ Đạo (Obsidian AI Space Dark Theme)**:
  - Nền toàn ứng dụng: `bg-[#080D1A]`
  - Nền Sidebar & Header: `bg-[#0B1120]`
  - Nền Card phân cảnh / Panel: `bg-slate-900/60` đến `bg-slate-900/80`
  - Nền Input / Textarea: `bg-slate-950`
  - Đường viền chia tách: `border-slate-800/80` hoặc `border-slate-700/60`
- **Gradient & Glow Thương Hiệu**:
  - `--brand-cyan`: `#0EA5E9` (Sky Blue)
  - `--brand-indigo`: `#6366F1` (Indigo Neon)
  - `--brand-rose`: `#F43F5E` (Rose Coral)
  - `btn-vanh-gradient`: Nút bấm có gradient chéo 3 màu kèm box-shadow phát sáng nhẹ và hiệu ứng nâng nhẹ `translateY(-1px)` khi hover.
  - `text-gradient-brand`: Chữ phủ gradient chuyển màu đẹp mắt.
  - `card-glass` & `card-glass-hover`: Khung kính mờ mờ `backdrop-filter: blur(16px)` tạo cảm giác công nghệ cao.

### 5.2. Các Radix UI Primitives Đã Cài Đặt Sẵn
Ứng dụng đã cài đặt đầy đủ các gói primitive chất lượng cao từ `@radix-ui` trong `package.json`:
- `@radix-ui/react-dialog`: Dùng cho modal (xem ví dụ chuẩn tại `renderer/components/download/DownloadModal.tsx`).
- `@radix-ui/react-tabs`: Tab chuyển đổi chế độ hoặc tab chức năng (`Tabs.Root`, `Tabs.List`, `Tabs.Trigger`, `Tabs.Content`).
- `@radix-ui/react-slider`: Thanh trượt điều chỉnh âm lượng BGM, tỉ lệ Ken Burns, tốc độ giọng, kích thước phụ đề.
- `@radix-ui/react-select`: Menu thả xuống chọn LLM Provider, Voice ID, Video Resolution, Subtitle Preset.
- `@radix-ui/react-switch`: Công tắc bật/tắt Ken Burns, Auto Audio Ducking, Word Alignment.
- `@radix-ui/react-progress`: Thanh tiến trình chạy % render hoặc download.
- `@radix-ui/react-tooltip`: Hiển thị giải thích thuật ngữ khi di chuột.

### 5.3. Icon & Toast Notification
- Toàn bộ icon được lấy từ gói `lucide-react ^1.34.0` với kích cỡ chuẩn `h-4 w-4` hoặc `h-3.5 w-3.5`.
- Toast thông báo hệ thống dùng `sonner ^2.0.8`: `toast.success()`, `toast.error()`, `toast.loading()`.

---

## 6. HỆ THỐNG XEM TRƯỚC ĐA PHƯƠNG TIỆN (MEDIA PREVIEW & SUBTITLE OVERLAY)

### 6.1. Trình Phát Video Preview (`VideoPreviewCanvas.tsx`)
Tại `renderer/components/export/VideoPreviewCanvas.tsx`:
1. **Giao thức tải media nội bộ an toàn**:
   Thay vì dùng `file://` (bị Chromium chặn vì lý do bảo mật), ứng dụng dùng custom protocol:
   ```typescript
   const videoSrc = videoPath ? `vanhmedia://local/${encodeURIComponent(videoPath)}` : '';
   ```
2. **Khung tỉ lệ linh hoạt**:
   Tính toán tỉ lệ canvas tự động theo thuộc tính `aspectRatio` (`'16:9' | '9:16' | '1:1'`):
   ```typescript
   const targetRatio = useMemo(() => {
     if (aspectRatio === '9:16') return 9 / 16;
     if (aspectRatio === '1:1') return 1;
     return 16 / 9;
   }, [aspectRatio]);
   ```
   Tự động giới hạn chiều cao tối đa (`maxPreviewH = 460px` cho dọc, `440px` cho ngang) để không làm vỡ bố cục giao diện.
3. **Đồng hồ thời gian mượt mà 60 FPS**:
   Dùng `requestAnimationFrame` đồng bộ `smoothTime` liên tục với `videoRef.current.currentTime`, giúp lớp watermark và phụ đề hiển thị chính xác theo từng frame.

### 6.2. Lớp Phụ Đề Động (Subtitle Overlay)
Tại `VideoPreviewCanvas.tsx` (dòng 767-820):
1. **Tìm dòng phụ đề đang phát**:
   ```typescript
   const activeLine = srtLines.find(
     (l) => currentTime >= l.startMs / 1000 && currentTime <= l.endMs / 1000
   );
   ```
2. **Hệ tọa độ Numpad 1-9 & Kéo thả (Drag-and-Drop)**:
   - Hỗ trợ căn chỉnh 9 hướng theo bàn phím Numpad (1: Đáy-Trái, 2: Đáy-Giữa, 3: Đáy-Phải, 7: Đỉnh-Trái, 8: Đỉnh-Giữa, v.v.).
   - Hỗ trợ chuột bắt sự kiện `onMouseDown` để kéo thả trực tiếp phụ đề tới vị trí mong muốn trên khung hình (`posPercent: { x, y }`).
3. **Hiệu ứng viền chữ (Text Outline Shadow)**:
   Hỗ trợ tạo viền nét đen bằng bóng đa hướng:
   `textShadow: '2px 0 0 #000, 0 2px 0 #000, -2px 0 0 #000, 0 -2px 0 #000, 1.5px 1.5px 0 #000, ...'`

### 6.3. Audio Singleton Player (`fullPreviewPlayer.ts`)
Tại `renderer/lib/fullPreviewPlayer.ts`:
- Player được thiết kế độc lập ngoài vòng đời React component.
- Cho phép nghe thử chuỗi audio kịch bản liên tục mà **không bị dừng khi người dùng chuyển sang tab khác**.
- Có cơ chế prefetch audio dòng kế tiếp (`next = fetchAudio(i + 1)`) trong khi dòng hiện tại đang phát, giảm thiểu tối đa khoảng lặng giữa các câu.

---

## 7. BẢN THIẾT KẾ TÍCH HỢP CHI TIẾT PHÂN HỆ AI STUDIO (DETAILED INTEGRATION BLUEPRINT)

Toàn bộ phân hệ AI Studio được tổ chức trong thư mục mới `renderer/components/ai-studio/`:

```
renderer/components/ai-studio/
├── AiStudioContainer.tsx          # Component cha điều phối chế độ
├── AutoPilotView.tsx              # Chế độ 1: Auto-Pilot One-Click
├── CustomStudioView.tsx           # Chế độ 2: Custom Workflow Studio
├── AiStudioSettingsTab.tsx        # Cấu hình độc lập AI Studio
├── autopilot/
│   ├── IdeaInputCard.tsx          # Nhập ý tưởng, chọn tỷ lệ, nút bấm CTA
│   ├── PipelineStatusTracker.tsx  # Bảng theo dõi 8 bước thời gian thực
│   └── QuickPreviewPanel.tsx      # Nghe thử audio, xem video thành phẩm, tải về
└── custom/
    ├── ScriptVoiceTab.tsx         # Tab 1: Soạn kịch bản & Chấm điểm retention
    ├── StoryboardTab.tsx          # Tab 2: Visual Storyboard Cards & Imagen 3
    └── AssemblyTab.tsx            # Tab 3: Dựng phim, Ken Burns, BGM, Subtitle
```

---

### 7.1. Main Container & Mode Switcher (`AiStudioContainer.tsx`)
**Nhiệm vụ:**
Là điểm kết nối với `home.tsx`. Cung cấp thanh chuyển đổi chế độ cao cấp (Segmented Mode Pill Switcher) ở đầu trang:

```tsx
<div className="flex h-full flex-col overflow-hidden bg-[#080D1A]">
  {/* Sub-Header Navigation */}
  <div className="flex items-center justify-between border-b border-slate-800/80 bg-[#0B1120]/60 px-6 py-3">
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-cyan via-brand-indigo to-brand-rose p-0.5">
        <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#0B1120]">
          <Sparkles className="h-4 w-4 text-brand-cyan" />
        </div>
      </div>
      <div>
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          AI Video Studio
          <span className="rounded-full bg-brand-indigo/20 px-2 py-0.5 text-[10px] font-semibold text-brand-cyan border border-brand-cyan/30">
            Pipeline v1.0
          </span>
        </h3>
      </div>
    </div>

    {/* Mode Switcher Buttons */}
    <div className="flex items-center rounded-xl border border-slate-800 bg-slate-900/90 p-1">
      <button
        onClick={() => setActiveMode('auto-pilot')}
        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          activeMode === 'auto-pilot'
            ? 'bg-gradient-to-r from-brand-indigo to-brand-cyan text-white shadow-md'
            : 'text-slate-400 hover:text-white'
        }`}
      >
        <Zap className="h-3.5 w-3.5" />
        <span>⚡ AI Tự Sản Xuất (Auto-Pilot)</span>
      </button>

      <button
        onClick={() => setActiveMode('custom-studio')}
        className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          activeMode === 'custom-studio'
            ? 'bg-gradient-to-r from-brand-indigo to-brand-cyan text-white shadow-md'
            : 'text-slate-400 hover:text-white'
        }`}
      >
        <Sliders className="h-3.5 w-3.5" />
        <span>🎛️ Xưởng Tự Làm (Custom Studio)</span>
      </button>

      <button
        onClick={() => setActiveMode('settings')}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          activeMode === 'settings'
            ? 'bg-slate-800 text-white shadow-md'
            : 'text-slate-400 hover:text-white'
        }`}
      >
        <Settings className="h-3.5 w-3.5" />
        <span>Cấu Hình Studio</span>
      </button>
    </div>
  </div>

  {/* Tab Content Rendering (Mounted with CSS display toggle) */}
  <div className={activeMode === 'auto-pilot' ? 'flex-1 overflow-y-auto p-6' : 'hidden'}>
    <AutoPilotView />
  </div>
  <div className={activeMode === 'custom-studio' ? 'flex-1 overflow-hidden' : 'hidden'}>
    <CustomStudioView />
  </div>
  <div className={activeMode === 'settings' ? 'flex-1 overflow-y-auto p-6' : 'hidden'}>
    <AiStudioSettingsTab />
  </div>
</div>
```

---

### 7.2. Chế Độ 1: Auto-Pilot One-Click Pipeline (`AutoPilotView.tsx`)
**Nhiệm vụ:** Tiếp nhận ý tưởng/chủ đề, kích hoạt 8 công đoạn liên hoàn và hiển thị kết quả thành phẩm.

1. **Thành phần `IdeaInputCard.tsx`**:
   - Khung nhập liệu ý tưởng đa dòng (textarea).
   - Chọn preset kịch bản: `YouTube Kể Chuyện`, `TikTok Kịch Tính / Viral Short`, `Review Sản Phẩm Affiliate`.
   - Chọn tỷ lệ khung hình: `16:9` (Video ngang) hoặc `9:16` (TikTok/Shorts).
   - Nút hành động chính: `btn-vanh-gradient` với chữ "⚡ Bắt Đầu Sản Xuất One-Click".
2. **Thành phần `PipelineStatusTracker.tsx` (Bảng 8 Bước Trực Quan)**:
   Hiển thị đúng 8 bước theo đặc tả `AI_STUDIO_SPEC.md` Section 3.2:
   - **Bước 1: Dữ kiện (Source/Idea)** — LLM Prompt Blueprint
   - **Bước 2: Kịch bản (Script)** — DeepSeek / OpenAI API (~70 câu)
   - **Bước 3: Lồng tiếng (Voice)** — Edge TTS (`vi-VN-HoaiMyNeural` / `vi-VN-NamMinhNeural`)
   - **Bước 4: Trích xuất Time** — Word-boundary / Whisper alignment
   - **Bước 5: Storyboard** — LLM Visual Prompt Splitter
   - **Bước 6: Ảnh / Video** — Google Flow Engine (Veo / Imagen)
   - **Bước 7: Dựng phim (Render)** — `fluent-ffmpeg` ghép Ken Burns, BGM, Audio & Subtitles
   - **Bước 8: SEO & Xuất bản** — Tiêu đề, mô tả, hashtag
   - **Trạng thái từng thẻ bước**:
     - `pending`: Chờ lượt (Icon tròn xám mờ).
     - `running`: Đang xử lý (Icon xoay `Loader2`, viền phát sáng neon `ring-2 ring-brand-cyan animate-pulse`).
     - `success`: Hoàn thành (Icon `CheckCircle2` màu xanh lục `text-emerald-400`).
     - `error`: Gặp sự cố (Icon `AlertCircle` màu đỏ `text-rose-400`, kèm nút "Tiếp tục tại bước này" và "Thử lại").
3. **Thành phần `QuickPreviewPanel.tsx`**:
   - Khi bước 3 hoàn thành: Hiện trình nghe thử audio voiceover.
   - Khi bước 7 hoàn thành: Hiện video player thành phẩm trực tiếp.
   - Khi bước 8 hoàn thành: Hiện bảng SEO metadata kèm nút "Tải Video MP4 Về Máy" và "Mở Thư Mục Chứa".

---

### 7.3. Chế Độ 2: Custom Workflow Studio (`CustomStudioView.tsx`)
**Nhiệm vụ:** Dành cho nhà sáng tạo muốn kiểm soát chi tiết từng khâu trước khi dựng phim. Giao diện chia làm 3 Sub-Tabs điều hướng bằng Radix Tabs:

#### Tab 1: Kịch bản & Giọng Đọc (`ScriptVoiceTab.tsx`)
- **Trình soạn thảo kịch bản theo timeline**:
  - Hiển thị danh sách các câu kịch bản đã sinh.
  - Mỗi hàng gồm: Số thứ tự, Start/End Timecode (`TimeField` chỉnh sửa ms), ô sửa văn bản tiếng Việt.
  - Thao tác nhanh trên từng câu:
    - Nút loa: Nghe thử audio câu này.
    - Nút reload: Tạo lại giọng đọc chỉ riêng cho câu này (không ảnh hưởng cả bài).
    - Nút xóa / thêm câu mới.
- **Bộ điều khiển giọng đọc toàn bài**:
  - Chọn giọng đọc (Edge TTS Nam / Nữ).
  - Thanh trượt tốc độ giọng đọc (`-20%` đến `+20%`).
  - Thanh phát Audio tổng hợp (`fullPreviewPlayer`).
  - Nút **"Trích xuất lại Time Alignment"** khi sửa đổi nội dung câu.
- **Đánh giá kịch bản (Script Quality Retention Audit)**:
  - Nút **"Chấm điểm kịch bản AI"** (gọi LLM chấm theo Hook 5s đầu, Retention loop, Call to action).
  - Thẻ hiển thị điểm số (ví dụ: 88/100) kèm lời khuyên cải thiện từng câu thoại.

#### Tab 2: Phân Cảnh Trực Quan Storyboard (`StoryboardTab.tsx`)
- Bố cục dạng lưới thẻ (Card Grid) hoặc danh sách dọc (List View), kế thừa cấu trúc của `StoryboardDirectorStudio.tsx`.
- Mỗi card tương ứng 1 câu thoại:
  - Mốc thời gian bắt đầu - kết thúc cảnh.
  - Văn bản câu thoại tiếng Việt đối chiếu.
  - Ô soạn thảo **Visual Prompt bằng tiếng Anh** (AI tự dịch và tối ưu hóa từ cảnh quay).
  - Khung ảnh thumbnail cảnh quay:
    - Hiển thị ảnh sinh từ Google Flow.
    - Nút **"Sinh lại ảnh"**: Gọi Google Flow Engine sinh lại riêng cảnh này.
    - Nút **"Tải ảnh thủ công"**: Gọi `window.vanhsub.dialog.openImageFile()` cho phép người dùng thay ảnh riêng của họ từ máy tính.
  - Tùy chọn kiểu phân cảnh:
    - `Ảnh tĩnh + Ken Burns (Zoom/Pan)`
    - `Video chuyển động (Veo)`

#### Tab 3: Dựng Phim & Phụ Đề & BGM (`AssemblyTab.tsx`)
- **Tùy biến phụ đề động**:
  - Chọn Preset: `TikTok Chữ Vàng Đậm (tiktok_bold)`, `Tối Giản Tinh Tế (minimalist)`, `Khối Đen Cổ Điển (classic_bar)`, `Karaoke Phát Sáng (karaoke_glow)`.
  - Chỉnh kích thước chữ (Font size), màu chữ chính, màu viền, độ dày viền (outline width).
  - Chỉnh vị trí xuất hiện (Top / Center / Bottom Y: 80%).
- **Hiệu ứng chuyển động & Nhạc nền (BGM)**:
  - Bật/tắt chuyển động Ken Burns cho ảnh tĩnh, chỉnh tốc độ zoom (1.1x - 1.25x).
  - Chọn file nhạc nền từ máy tính (`window.vanhsub.dialog.openMediaFile()`).
  - Chỉnh âm lượng nhạc nền (BGM Volume) và công tắc **Tự động hạ âm lượng BGM khi có tiếng nói (Auto Audio Ducking)**.
- **Trình phát Live Preview**:
  - Nhúng trực tiếp `VideoPreviewCanvas.tsx` cho phép kéo thanh scrubber xem trước chuyển động và khớp phụ đề.
- **Nút xuất phim**:
  - Nút lớn "🎬 Bắt Đầu Dựng Video Hoàn Chỉnh (FFmpeg Render)".

---

### 7.4. Màn Hình Cấu Hình Riêng (`AiStudioSettingsTab.tsx`)
Khác với cài đặt chung ở `SettingsPage.tsx`, màn hình này chỉ quản lý schema cấu hình `AiStudioConfig` theo đúng quy chuẩn Mục 5 của `AI_STUDIO_SPEC.md`:

| Nhóm Cấu Hình | Các Trường Dữ Liệu | Loại Điều Khiển Giao Diện |
| :--- | :--- | :--- |
| **1. LLM Engine** | `provider`, `apiKey`, `model`, `baseUrl`, `temperature`, `systemPromptPreset` | Select Provider, Password Input (ẩn/hiện key), Model Text Input, Slider Temperature, Dropdown Preset |
| **2. TTS & Voice** | `provider`, `voiceId`, `rate`, `pitch`, `volume`, `autoWordAlignment` | Select Voice (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), Slider Speed/Pitch, Switch Word Alignment, Nút nghe thử mẫu |
| **3. Google Flow** | `aspectRatio`, `outputMode`, `stylePromptPrefix`, `negativePrompt`, `outputsPerScene`, `downloadDir`, `concurrency` | Radio Tỉ lệ khung hình (16:9, 9:16, 1:1), Switch Image/Video, Textarea Style/Negative, Thư mục lưu assets picker |
| **4. Rendering** | `resolution`, `fps`, `kenBurnsEffect`, `kenBurnsScale`, `transitionDuration`, `defaultBgmPath`, `bgmVolume`, `autoAudioDucking` | Select 1080p/720p/4k, Select 30/60 fps, Switch Ken Burns, File Picker BGM, Slider Volume, Switch Ducking |
| **5. Subtitles** | `enabled`, `preset`, `fontSize`, `primaryColor`, `outlineColor`, `outlineWidth`, `positionY` | Switch Subtitle, Select Preset, Slider Font Size, Color Pickers, Slider Y-position |

Có nút **"Khôi phục mặc định"** và cơ chế **Tự động lưu (Auto-save on change)** có thông báo badge xanh "Đã lưu cài đặt AI Studio".

---

## 8. KẾ HOẠCH & DANH SÁCH TỆP CẦN TẠO / CHỈNH SỬA (FILE CREATION & EDIT ROADMAP)

### 8.1. Các Tệp Mới Cần Tạo (Phía Renderer)
1. `renderer/types/aiStudio.ts`:
   Định nghĩa toàn bộ TypeScript Interfaces (`AiStudioConfig`, `PipelineStepId`, `PipelineStepStatus`, `PipelineSession`, `ScriptSentence`, `StoryboardShotItem`).
2. `renderer/lib/store/aiStudioStore.ts`:
   Zustand store quản lý cấu hình, trạng thái session, và hành động UI.
3. `renderer/components/ai-studio/AiStudioContainer.tsx`:
   Root container và mode switcher.
4. `renderer/components/ai-studio/AutoPilotView.tsx`:
   Giao diện chế độ 1 (Auto-Pilot).
5. `renderer/components/ai-studio/autopilot/IdeaInputCard.tsx`:
   Khung nhập ý tưởng & tùy chọn nhanh.
6. `renderer/components/ai-studio/autopilot/PipelineStatusTracker.tsx`:
   Bảng theo dõi 8 bước trực quan.
7. `renderer/components/ai-studio/autopilot/QuickPreviewPanel.tsx`:
   Khung phát nghe thử audio, xem video và nút tải.
8. `renderer/components/ai-studio/CustomStudioView.tsx`:
   Giao diện chế độ 2 (Custom Studio) với 3 Tab.
9. `renderer/components/ai-studio/custom/ScriptVoiceTab.tsx`:
   Tab soạn thảo kịch bản, chỉnh câu thoại và chấm điểm retention.
10. `renderer/components/ai-studio/custom/StoryboardTab.tsx`:
    Tab phân cảnh visual prompt và ảnh Google Flow.
11. `renderer/components/ai-studio/custom/AssemblyTab.tsx`:
    Tab dựng phim, Ken Burns, BGM, phụ đề và preview player.
12. `renderer/components/ai-studio/AiStudioSettingsTab.tsx`:
    Tab cài đặt cấu hình riêng cho AI Studio.

### 8.2. Các Tệp Cần Chỉnh Sửa & Tích Hợp
1. `renderer/pages/home.tsx`:
   - Thêm tab `ai_studio` vào `getNavItems()`.
   - Cập nhật header title và tiêu đề trang.
   - Nhúng `<AiStudioContainer />` vào khu vực main body (dưới dạng persistent mounted div).
2. `renderer/types/electron.d.ts`:
   - Mở rộng interface `Window['vanhsub']` với namespace `aiStudio`:
     - `getSettings`, `saveSettings`, `startAutoPilot`, `resumePipeline`, `cancelPipeline`, `onPipelineEvent`.
3. `renderer/locales/vi.json`:
   - Bổ sung các nhãn tiếng Việt cho AI Studio (`sidebar.aiStudio`, `aiStudio.*`).

---

*Báo cáo khảo sát được hoàn thiện và chuyển tiếp tới Orchestrator để đưa vào kế hoạch phân công triển khai.*
