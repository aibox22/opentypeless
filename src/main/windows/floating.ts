/**
 * Floating Window Manager.
 * Manages the ASR status floating window that displays recording state and transcription.
 */

import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import type { ASRResult, ASRStatus } from '../../shared/types/asr';
import { IPC_CHANNELS } from '../../shared/constants/channels';

/**
 * Floating window layout configuration constants.
 * Based on design spec for ASR floating window.
 *
 * Layout structure:
 * ┌─────────────────────────────────────┐ ─┬─ paddingTop: 10px
 * │  ● Listening...                     │  │  statusBarHeight: 11px
 * │─────────────────────────────────────│  │  statusBarPaddingBottom: 6px
 * │                                     │  │  statusBarBorder: 1px
 * │                                     │  │  gap: 6px
 * ├─────────────────────────────────────┤ ─┼─ chromeHeight: 40px (fixed)
 * │  Transcribed text content           │  │
 * │  Second line...                     │  │  contentHeight: 18-72px (dynamic)
 * │  Third line...                      │  │
 * │  Fourth line...                     │  │
 * ├─────────────────────────────────────┤ ─┴─
 * │                                     │     paddingBottom: 6px
 * └─────────────────────────────────────┘
 *      Total height = chromeHeight + contentHeight
 *                   = 28px + (18px × lines)
 *                   = 46px ~ 92px
 */
const FLOATING_WINDOW_CONFIG = {
  /** Window width in pixels */
  WIDTH: 236,
  /** Minimum window height (chrome + single line) */
  MIN_HEIGHT: 46,
  /** Maximum window height (chrome + 4 lines) */
  MAX_HEIGHT: 92,
  /** Fixed chrome height (padding + status bar + gap) */
  CHROME_HEIGHT: 30,
  /** Single line height (14px font × 1.25 line-height ≈ 18px) */
  LINE_HEIGHT: 18,
  /** Distance from bottom of screen (px) */
  BOTTOM_OFFSET: 80,
  /** Auto-hide delay after recognition is done (ms) */
  AUTO_HIDE_DELAY: 2000,
  /** Debounce threshold for height changes (px) */
  HEIGHT_DEBOUNCE_THRESHOLD: 4,
} as const;

/**
 * Manages the ASR floating window lifecycle and communication.
 */
export class FloatingWindowManager {
  private window: BrowserWindow | null = null;
  private autoHideTimer: NodeJS.Timeout | null = null;
  /** Current window height for debounce comparison */
  private currentHeight: number = FLOATING_WINDOW_CONFIG.MIN_HEIGHT;

  /**
   * Create the floating window.
   * The window is created hidden and shown when needed.
   */
  create(): void {
    if (this.window) {
      return;
    }

    // Get primary display to calculate centered position
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

    // Calculate centered position at bottom of screen
    const x = Math.round((screenWidth - FLOATING_WINDOW_CONFIG.WIDTH) / 2);
    const y = screenHeight - FLOATING_WINDOW_CONFIG.MIN_HEIGHT - FLOATING_WINDOW_CONFIG.BOTTOM_OFFSET;

    this.window = new BrowserWindow({
      width: FLOATING_WINDOW_CONFIG.WIDTH,
      height: FLOATING_WINDOW_CONFIG.MIN_HEIGHT,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false, // Fixed position at bottom center
      show: false,
      hasShadow: false,
      // CRITICAL: Prevent window from stealing focus
      // This allows text insertion to work in the previously focused app
      focusable: false,
      // macOS native vibrancy effect (popover style)
      vibrancy: 'popover',
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // Make window visible on all workspaces (macOS/Linux)
    // This must be called after window creation
    // NOTE: Temporarily disabled - may cause dock icon to hide on macOS
    // this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Load the floating window HTML
    if (FLOATING_WINDOW_VITE_DEV_SERVER_URL) {
      // In dev mode, we need to explicitly load floating.html
      // since Vite serves the root as index.html by default
      const devUrl = FLOATING_WINDOW_VITE_DEV_SERVER_URL.replace(/\/$/, '');
      this.window.loadURL(`${devUrl}/floating.html`);
    } else {
      this.window.loadFile(
        path.join(__dirname, `../renderer/${FLOATING_WINDOW_VITE_NAME}/floating.html`),
      );
    }

    // Prevent the window from being closed, just hide it
    this.window.on('close', (event) => {
      event.preventDefault();
      this.hide();
    });

    // Clean up reference when window is destroyed
    this.window.on('closed', () => {
      this.window = null;
    });
  }

  /**
   * Show the floating window without stealing focus.
   * Uses showInactive() to keep focus on the user's previous app.
   */
  show(): void {
    if (!this.window) {
      this.create();
    }
    this.clearAutoHideTimer();

    // Only reset height if window is NOT currently visible (new session starting)
    // This prevents the "bounce" effect when status changes during recording
    const wasVisible = this.window?.isVisible() ?? false;
    if (!wasVisible) {
      this.resetHeightSync();
    }

    // Use showInactive() to show window without stealing focus
    // This is critical for text insertion to work in the previously focused app
    this.window?.showInactive();
  }

  /**
   * Hide the floating window.
   */
  hide(): void {
    this.clearAutoHideTimer();
    this.window?.hide();
    // Reset height for next show
    this.resetHeight();
  }

  /**
   * Destroy the floating window.
   */
  destroy(): void {
    this.clearAutoHideTimer();
    if (this.window) {
      this.window.removeAllListeners('close');
      this.window.destroy();
      this.window = null;
    }
  }

  /**
   * Send ASR status update to the floating window.
   * @param status - The current ASR status
   */
  sendStatus(status: ASRStatus): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    // Show window for active statuses
    if (status === 'connecting' || status === 'listening' || status === 'processing') {
      this.show();
    }

    // Auto-hide after recognition is done
    if (status === 'done') {
      this.scheduleAutoHide();
    }

    // Hide on idle - hide FIRST before sending status to prevent visual bounce
    // (renderer re-rendering with no content before window hides)
    if (status === 'idle') {
      this.hide();
      // Don't send 'idle' status to renderer - window is already hidden
      return;
    }

    this.window.webContents.send(IPC_CHANNELS.ASR.STATUS, status);
  }

  /**
   * Send ASR result to the floating window.
   * @param result - The ASR result containing transcribed text
   */
  sendResult(result: ASRResult): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.window.webContents.send(IPC_CHANNELS.ASR.RESULT, result);
  }

  /**
   * Send error message to the floating window.
   * @param error - The error message
   */
  sendError(error: string): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    // Show window to display error
    this.show();
    this.window.webContents.send(IPC_CHANNELS.ASR.ERROR, error);
    // Auto-hide after showing error
    this.scheduleAutoHide();
  }

  /**
   * Check if the floating window is currently visible.
   */
  isVisible(): boolean {
    return this.window?.isVisible() ?? false;
  }

  /**
   * Get the BrowserWindow instance (for testing purposes).
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Set content height and adapt window size.
   * Window expands upward from its fixed bottom position.
   *
   * Height calculation:
   * - contentHeight <= LINE_HEIGHT (18px): use MIN_HEIGHT (58px)
   * - contentHeight > LINE_HEIGHT: use min(CHROME_HEIGHT + contentHeight, MAX_HEIGHT)
   *
   * @param contentHeight - Content area height in pixels (from scrollHeight)
   */
  setContentHeight(contentHeight: number): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const { CHROME_HEIGHT, LINE_HEIGHT, MIN_HEIGHT, MAX_HEIGHT, HEIGHT_DEBOUNCE_THRESHOLD } =
      FLOATING_WINDOW_CONFIG;

    // Calculate target window height based on content height
    let targetHeight: number;
    if (contentHeight <= LINE_HEIGHT) {
      // Single line or empty: use minimum height
      targetHeight = MIN_HEIGHT;
    } else {
      // Multiple lines: chrome + content, capped at max
      targetHeight = Math.min(CHROME_HEIGHT + contentHeight, MAX_HEIGHT);
    }

    // Debounce: ignore small changes (< 4px)
    if (Math.abs(targetHeight - this.currentHeight) < HEIGHT_DEBOUNCE_THRESHOLD) {
      return;
    }

    // Get current bounds
    const primaryDisplay = screen.getPrimaryDisplay();
    const { height: screenHeight } = primaryDisplay.workAreaSize;
    const bounds = this.window.getBounds();

    // Calculate new Y position to expand upward (keep bottom edge fixed)
    const newY = screenHeight - targetHeight - FLOATING_WINDOW_CONFIG.BOTTOM_OFFSET;

    // Update bounds (position and size together to expand upward)
    this.window.setBounds({
      x: bounds.x,
      y: newY,
      width: FLOATING_WINDOW_CONFIG.WIDTH,
      height: targetHeight,
    });

    // Update current height for next debounce comparison
    this.currentHeight = targetHeight;
  }

  /**
   * Reset window height to minimum.
   * Called when hiding window or clearing content.
   */
  resetHeight(): void {
    this.currentHeight = FLOATING_WINDOW_CONFIG.MIN_HEIGHT;
  }

  /**
   * Reset window height to minimum synchronously.
   * Called before showing window to prevent leftover size from previous session.
   * Actually resizes the window.
   */
  private resetHeightSync(): void {
    const { MIN_HEIGHT, WIDTH, BOTTOM_OFFSET } = FLOATING_WINDOW_CONFIG;

    // Always reset the tracked height
    this.currentHeight = MIN_HEIGHT;

    // If window doesn't exist or is destroyed, just reset the variable
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    // Get screen dimensions for positioning
    const primaryDisplay = screen.getPrimaryDisplay();
    const { height: screenHeight } = primaryDisplay.workAreaSize;
    const bounds = this.window.getBounds();

    // Calculate new Y position to keep bottom edge fixed
    const newY = screenHeight - MIN_HEIGHT - BOTTOM_OFFSET;

    // Actually resize the window to minimum height
    this.window.setBounds({
      x: bounds.x,
      y: newY,
      width: WIDTH,
      height: MIN_HEIGHT,
    });
  }

  /**
   * Schedule auto-hide of the window.
   */
  private scheduleAutoHide(): void {
    this.clearAutoHideTimer();
    this.autoHideTimer = setTimeout(() => {
      this.hide();
    }, FLOATING_WINDOW_CONFIG.AUTO_HIDE_DELAY);
  }

  /**
   * Clear the auto-hide timer.
   */
  private clearAutoHideTimer(): void {
    if (this.autoHideTimer) {
      clearTimeout(this.autoHideTimer);
      this.autoHideTimer = null;
    }
  }
}

/**
 * Singleton instance of the floating window manager.
 */
export const floatingWindow = new FloatingWindowManager();
