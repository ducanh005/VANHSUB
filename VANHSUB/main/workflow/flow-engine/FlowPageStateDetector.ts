/**
 * FlowPageStateDetector: Bộ nhận diện trạng thái trang Google Flow
 * Phân loại trang: FLOW_HOME / FLOW_EDITOR / GENERATION_IN_PROGRESS / RESULT_PAGE / LOGIN_PAGE / ERROR_PAGE / UNKNOWN_PAGE
 * Đảm bảo automation KHÔNG thực hiện action nếu trạng thái trang không khớp kỳ vọng.
 */

export type FlowPageState =
  | 'FLOW_HOME'
  | 'FLOW_EDITOR'
  | 'GENERATION_IN_PROGRESS'
  | 'RESULT_PAGE'
  | 'LOGIN_PAGE'
  | 'ERROR_PAGE'
  | 'UNKNOWN_PAGE';

export interface PageStateResult {
  state: FlowPageState;
  currentUrl: string;
  title: string;
  matchedCriteria: string;
  details: Record<string, any>;
  timestamp: number;
}

export class FlowPageStateDetector {
  /**
   * Nhận diện trạng thái trang hiện tại trên BrowserWindow
   */
  static async detect(win: any): Promise<PageStateResult> {
    const timestamp = Date.now();
    if (!win || win.isDestroyed()) {
      return {
        state: 'UNKNOWN_PAGE',
        currentUrl: '',
        title: '',
        matchedCriteria: 'window_destroyed_or_null',
        details: {},
        timestamp,
      };
    }

    const currentUrl = (win.webContents?.getURL?.() || '').trim();
    const title = (win.getTitle?.() || '').trim();
    const lowerUrl = currentUrl.toLowerCase();

    // 1. Kiểm tra LOGIN_PAGE: Google Accounts, ServiceLogin hoặc landing page /about
    if (
      lowerUrl.includes('accounts.google.com') ||
      lowerUrl.includes('servicelogin') ||
      lowerUrl.includes('signin') ||
      lowerUrl.includes('flow.google.com/about')
    ) {
      return {
        state: 'LOGIN_PAGE',
        currentUrl,
        title,
        matchedCriteria: lowerUrl.includes('/about') ? 'about_landing_page' : 'accounts_login_url',
        details: { lowerUrl },
        timestamp,
      };
    }

    // 2. Soi DOM để nhận diện các trạng thái Flow
    const scanJs = `
      (function() {
        try {
          const bodyText = (document.body ? document.body.innerText : '').toLowerCase();
          
          // Kiểm tra ERROR_PAGE
          const isError = 
            Boolean(document.querySelector('.error-page, .error-container, flow-error-banner, .error-banner, [aria-label*="Lỗi" i], [aria-label*="Error" i]')) ||
            bodyText.includes('something went wrong') ||
            bodyText.includes('đã xảy ra lỗi') ||
            bodyText.includes('hết tín dụng') ||
            bodyText.includes('out of credits');
          if (isError) {
            return { type: 'ERROR_PAGE', reason: 'error_element_or_text' };
          }

          // Kiểm tra GENERATION_IN_PROGRESS
          const isGenerating = Boolean(document.querySelector(
            'flow-loading-indicator, flow-progress-bar, mat-progress-spinner, mat-spinner, .generation-in-progress, [role="progressbar"], flow-card[state="generating"], .loading-spinner, flow-generating-card, div[class*="generating"]'
          ));
          if (isGenerating) {
            return { type: 'GENERATION_IN_PROGRESS', reason: 'active_spinner_detected' };
          }

          // Kiểm tra FLOW_EDITOR
          const hasEditor = Boolean(document.querySelector(
            'flow-prompt-box, flow-base-prompt-box, flow-creative-agent-prompt-box, flow-rich-text-editor, .prosemirror-editor, .prompt-box-container'
          ));
          if (hasEditor || window.location.href.includes('/project/')) {
            // Kiểm tra xem đã có media card kết quả chưa
            const mediaCards = document.querySelectorAll('flow-media-card, flow-image-card, flow-card, .media-card');
            const hasResult = mediaCards.length > 0 && !isGenerating;
            return {
              type: hasResult ? 'RESULT_PAGE' : 'FLOW_EDITOR',
              hasEditor,
              mediaCount: mediaCards.length,
              reason: hasResult ? 'media_cards_present_in_editor' : 'editor_prompt_box_present'
            };
          }

          // Kiểm tra FLOW_HOME (Sảnh chính có danh sách project, nút New Project)
          const pathname = window.location.pathname;
          const isHomeUrl = (pathname === '/' || pathname === '') && !window.location.href.includes('/project/');
          const hasLobbyElements = Boolean(document.querySelector(
            'flow-lobby-header, flow-lobby, flow-project-list, button[aria-label*="Tạo dự án" i], button[aria-label*="New project" i]'
          ));
          if (isHomeUrl || hasLobbyElements) {
            return { type: 'FLOW_HOME', reason: 'flow_home_lobby_elements' };
          }

          return { type: 'UNKNOWN_PAGE', reason: 'no_flow_markers_matched' };
        } catch (e) {
          return { type: 'UNKNOWN_PAGE', error: String(e) };
        }
      })()
    `;

    const domScan = await win.webContents.executeJavaScript(scanJs, true).catch(() => null);
    const resolvedState: FlowPageState = (domScan?.type as FlowPageState) || (lowerUrl.includes('/project/') ? 'FLOW_EDITOR' : 'UNKNOWN_PAGE');

    return {
      state: resolvedState,
      currentUrl,
      title,
      matchedCriteria: domScan?.reason || 'fallback_url_resolution',
      details: domScan || {},
      timestamp,
    };
  }

  /**
   * Kiểm tra nhanh xem trang có khớp với một trong các trạng thái kỳ vọng hay không
   */
  static async assertState(
    win: any,
    expectedStates: FlowPageState[]
  ): Promise<{ ok: boolean; actualState: FlowPageState; details: PageStateResult }> {
    const res = await this.detect(win);
    const ok = expectedStates.includes(res.state);
    return {
      ok,
      actualState: res.state,
      details: res,
    };
  }
}
