# Handoff Report: Renderer Store & Typings (Milestone 1)

## 1. Observation
- **Tài liệu đặc tả & Yêu cầu**:
  - `d:\DEAN\DEAN\VANHSUB\AI_STUDIO_SPEC.md` (Dòng 104–206): Định nghĩa chi tiết schema TypeScript cho `AiStudioConfig` gồm 5 nhóm thuộc tính: `llm` (6 fields), `voice` (6 fields), `flowEngine` (7 fields), `rendering` (8 fields), `subtitles` (8 fields), cùng bộ giá trị mặc định tại §5.2.
  - `d:\DEAN\DEAN\VANHSUB\.agents\ORIGINAL_REQUEST.md` (Header `## 2026-09-17T06:24:37Z`, dòng 54–63): Yêu cầu kho lưu trữ cấu hình độc lập `aiStudioStore` (Zustand ở Renderer, `electron-store` ở Main), tuyệt đối không gây xung đột với `settingsStore` và `workflowStore`.
  - `d:\DEAN\DEAN\VANHSUB\.agents\orchestrator_2\PROJECT.md` (Dòng 81–155): Đặc tả interface contracts, IPC channels (`aiStudio:config:get`, `aiStudio:config:set`, `aiStudio:config:reset`), và cấu trúc thư mục phân hệ.
- **Hiện trạng Codebase**:
  - `package.json`: Sử dụng `zustand: "^5.0.15"`, `react: "^19.2.8"`, `typescript: "^5.9.3"`.
  - `tsconfig.json`: Bật chế độ `"strict": true`, target `ES2022`, bao quát toàn bộ `renderer/**/*.ts(x)` và `main/**/*.ts`. Bắt buộc code phải pass 100% type check khắt khe.
  - `renderer/lib/store/workflowStore.ts` (Dòng 1–15, 314): Sử dụng cú pháp `create` từ `zustand` và kiểm tra môi trường bằng `if (typeof window !== 'undefined' && window.vanhsub?.workflow?.runNode)`.
  - `renderer/types/electron.d.ts` (Dòng 155–393): Chứa interface `VanhsubAPI` gắn vào `Window.vanhsub`.
  - `main/preload.ts` (Dòng 1–196): Đóng gói `vanhsub` và phơi bày ra Main World qua `contextBridge.exposeInMainWorld('vanhsub', vanhsub)`.

## 2. Logic Chain
1. **Phân tách trách nhiệm & Khử xung đột**: Để phân hệ AI Video Studio hoạt động hoàn toàn độc lập với phần phụ đề hiện hữu của Vanhsub, toàn bộ kiểu dữ liệu cấu hình và IPC contracts được tập trung trong `renderer/types/aiStudio.ts`, và state management được đóng gói trong `renderer/lib/store/aiStudioStore.ts`.
2. **Khắc phục lỗi ghi đè dữ liệu lồng nhau (Section-aware Deep Merge)**: `AiStudioConfig` gồm 5 object con lồng nhau. Nếu thực hiện shallow merge `{ ...base, ...partial }`, việc update 1 trường (ví dụ `{ llm: { temperature: 0.8 } }`) sẽ làm mất toàn bộ các trường `apiKey`, `provider`, `model`. Do đó, hàm thuần khiết `mergeAiStudioConfig` được thiết kế để kết hợp an toàn từng phân hệ độc lập.
3. **Phòng thủ đa môi trường (Browser Dev Fallback)**: Trong giai đoạn phát triển giao diện (chạy `next dev` hoặc unit tests không có Electron context), `window.vanhsub` sẽ là `undefined`. Store được thiết kế để tự động nhận diện môi trường qua `isElectronAiStudioAvailable()`, fallback về `DEFAULT_AI_STUDIO_CONFIG` trong bộ nhớ, cho phép UI hiển thị và tương tác bình thường mà không bị crash.
4. **Đồng bộ 2 chiều (2-Way Sync) với Electron Main**:
   - Khi khởi động: `loadConfig()` gọi `window.vanhsub.aiStudio.getConfig()` để kéo cấu hình chính thống từ `vanhsub-ai-studio.json`.
   - Khi chỉnh sửa: `updateConfig(partial)` thực hiện cập nhật lạc quan (optimistic) trên state Zustand trước để UI phản hồi tức thì, sau đó chuyển payload xuống Main qua `window.vanhsub.aiStudio.updateConfig(partial)` để lưu vào đĩa và nhận lại kết quả đã thẩm định/mã hoá DPAPI.
   - Khi đặt lại: `resetConfig()` gọi `window.vanhsub.aiStudio.resetConfig()` để khôi phục cấu hình gốc.
5. **Tiện ích hóa cho UI Component**: Bổ sung các action trợ giúp chuyên biệt (`updateLlmConfig`, `updateVoiceConfig`, `updateFlowConfig`, `updateRenderingConfig`, `updateSubtitleConfig`), giúp các component ở Milestone 3 gọi lệnh cực kỳ ngắn gọn.

## 3. Caveats
- **Phụ thuộc song song ở Milestone 1**: Phía Electron Main (`main/ai-studio/ipc.ts`, `main/preload.ts`, `main/store/aiStudioStore.ts`) đang được khảo sát bởi 2 agent chuyên trách `explorer_m1_ipc` và `explorer_m1_store`. Để đảm bảo tương thích tuyệt đối, `useAiStudioStore` hỗ trợ cả 2 bộ tên method: canonical (`getConfig`, `updateConfig`, `resetConfig`) và aliases (`get`, `set`, `reset`).
- **Milestone 2 Forward-Compatibility**: Các kiểu dữ liệu của Milestone 2 (Pipeline Engine, Storyboard, FFmpeg rendering) đã được định nghĩa sẵn trong `renderer/types/aiStudio.ts` và đánh dấu tùy chọn (`?`) trên `VanhsubAiStudioBridge`, đảm bảo typecheck của M1 pass 100% mà không bị thiếu type khi bước sang M2.

## 4. Conclusion
- Kế hoạch và thiết kế mã nguồn chi tiết cho Milestone 1 Renderer Store đã hoàn thành và được ghi lại đầy đủ trong:
  `d:\DEAN\DEAN\VANHSUB\.agents\explorer_m1_renderer\m1_renderer_plan.md`.
- Sẵn sàng chuyển giao cho implementer để tạo 2 file:
  1. `renderer/types/aiStudio.ts` (Toàn bộ schema, defaults, request/response typings).
  2. `renderer/lib/store/aiStudioStore.ts` (Zustand store `useAiStudioStore` với đầy đủ state, actions, 2-way sync, và browser fallback).
- Kèm theo hướng dẫn mở rộng `renderer/types/electron.d.ts` để đồng bộ namespace `window.vanhsub.aiStudio`.

## 5. Verification Method
1. **Kiểm tra biên dịch tĩnh (Static Type Checking)**:
   ```powershell
   npx tsc --noEmit
   ```
   *Tiêu chí đạt*: 0 lỗi TypeScript trên toàn bộ project.
2. **Kiểm tra Browser Dev Fallback**:
   - Mở ứng dụng trong trình duyệt dev thông thường (không qua Electron).
   - Kiểm tra `useAiStudioStore.getState().config` có đầy đủ các giá trị mặc định từ `DEFAULT_AI_STUDIO_CONFIG`.
   - Gọi `useAiStudioStore.getState().updateConfig({ llm: { temperature: 0.8 } })` -> xác nhận `temperature` thành `0.8` và các trường `provider`, `model` không bị mất.
3. **Kiểm tra Electron IPC 2-Way Sync**:
   - Khởi chạy Electron app qua `npm run dev`.
   - Thay đổi cấu hình trên UI hoặc qua store, kiểm tra file `%APPDATA%/vanhsub/vanhsub-ai-studio.json` được tạo và cập nhật tương ứng.
   - Khởi động lại app, gọi `loadConfig()` và kiểm tra dữ liệu đã lưu được nạp chính xác.
