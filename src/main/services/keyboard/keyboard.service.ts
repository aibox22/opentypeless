/**
 * Keyboard Service.
 * Provides global keyboard monitoring using uiohook-napi.
 *
 * This service enables detection of keyboard events globally,
 * even when the application is not focused. Used primarily for
 * Push-to-Talk functionality.
 */

import { uIOhook, UiohookKey } from 'uiohook-napi';
import log from 'electron-log';

const logger = log.scope('keyboard-service');

/**
 * Configuration for keyboard service.
 */
export interface KeyboardConfig {
  /** Key code to trigger push-to-talk (default: Right Alt/Option) */
  triggerKey: number;
  /** Debounce time in milliseconds to prevent duplicate events */
  debounceMs: number;
  /** Minimum recording duration in milliseconds */
  minRecordingMs: number;
  /** Threshold used to distinguish short press vs long press */
  holdThresholdMs: number;
}

/**
 * Default configuration values.
 */
const DEFAULT_CONFIG: KeyboardConfig = {
  triggerKey: UiohookKey.AltRight, // Right Option on macOS
  debounceMs: 50,
  minRecordingMs: 200,
  holdThresholdMs: 250,
};

/**
 * Internal state for keyboard service.
 */
interface KeyboardState {
  isKeyHeld: boolean;
  lastKeyDownTime: number;
  lastKeyUpTime: number;
  recordingStartTime: number;
  longPressTriggered: boolean;
  holdTimer: NodeJS.Timeout | null;
}

export interface KeyboardGestureHandlers {
  onShortPress?: () => void;
  onLongPressStart?: () => void;
  onLongPressEnd?: () => void;
  onCancel?: () => void;
}

/**
 * Keyboard Service for global keyboard monitoring.
 *
 * Uses uiohook-napi to detect key press/release events globally.
 * Handles debouncing and minimum recording duration.
 *
 * @example
 * ```typescript
 * keyboardService.register({
 *   onShortPress: () => console.log('Toggle integrated dictation'),
 *   onLongPressStart: () => console.log('Start realtime dictation'),
 *   onLongPressEnd: () => console.log('Stop realtime dictation'),
 * });
 * ```
 */
export class KeyboardService {
  private config: KeyboardConfig;
  private state: KeyboardState = {
    isKeyHeld: false,
    lastKeyDownTime: 0,
    lastKeyUpTime: 0,
    recordingStartTime: 0,
    longPressTriggered: false,
    holdTimer: null,
  };

  private handlers: KeyboardGestureHandlers = {};
  private isStarted = false;

  // Bound handlers for proper cleanup
  private boundKeyDownHandler: ((e: { keycode: number }) => void) | null = null;
  private boundKeyUpHandler: ((e: { keycode: number }) => void) | null = null;

  constructor(config: Partial<KeyboardConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info('KeyboardService created', {
      triggerKey: this.config.triggerKey,
      debounceMs: this.config.debounceMs,
      minRecordingMs: this.config.minRecordingMs,
      holdThresholdMs: this.config.holdThresholdMs,
    });
  }

  /**
   * Register callbacks for keyboard gestures.
   *
   * @param handlers - Gesture handlers
   */
  register(handlers: KeyboardGestureHandlers): void {
    if (this.isStarted) {
      logger.warn('KeyboardService already registered, unregistering first');
      this.unregister();
    }

    this.handlers = handlers;

    // Create bound handlers
    this.boundKeyDownHandler = (e) => this.handleKeyDown(e.keycode);
    this.boundKeyUpHandler = (e) => this.handleKeyUp(e.keycode);

    // Register event listeners
    uIOhook.on('keydown', this.boundKeyDownHandler);
    uIOhook.on('keyup', this.boundKeyUpHandler);

    // Start the hook
    uIOhook.start();
    this.isStarted = true;

    logger.info('KeyboardService registered: Right Option short/long press enabled');
  }

  /**
   * Unregister callbacks and stop keyboard monitoring.
   */
  unregister(): void {
    if (!this.isStarted) {
      return;
    }

    // Remove event listeners before stopping
    if (this.boundKeyDownHandler) {
      uIOhook.off('keydown', this.boundKeyDownHandler);
    }
    if (this.boundKeyUpHandler) {
      uIOhook.off('keyup', this.boundKeyUpHandler);
    }

    // Stop the hook
    uIOhook.stop();

    // Clean up state
    this.handlers = {};
    this.boundKeyDownHandler = null;
    this.boundKeyUpHandler = null;
    this.isStarted = false;
    this.resetState();

    logger.info('KeyboardService unregistered');
  }

  /**
   * Check if keyboard service is currently active.
   */
  get isActive(): boolean {
    return this.isStarted;
  }

  /**
   * Check if the trigger key is currently held.
   */
  get isKeyCurrentlyHeld(): boolean {
    return this.state.isKeyHeld;
  }

  /**
   * Reset internal state.
   */
  private resetState(): void {
    if (this.state.holdTimer) {
      clearTimeout(this.state.holdTimer);
    }

    this.state = {
      isKeyHeld: false,
      lastKeyDownTime: 0,
      lastKeyUpTime: 0,
      recordingStartTime: 0,
      longPressTriggered: false,
      holdTimer: null,
    };
  }

  private clearHoldTimer(): void {
    if (this.state.holdTimer) {
      clearTimeout(this.state.holdTimer);
      this.state.holdTimer = null;
    }
  }

  /**
   * Check if an event should be debounced.
   */
  private isDebounced(lastTime: number): boolean {
    return Date.now() - lastTime < this.config.debounceMs;
  }

  /**
   * Handle key down event.
   */
  private handleKeyDown(keycode: number): void {
    if (keycode === UiohookKey.Escape) {
      logger.debug('Escape pressed - cancelling gesture/session');
      this.clearHoldTimer();
      this.state.isKeyHeld = false;
      this.handlers.onCancel?.();
      return;
    }

    // Ignore if not our trigger key
    if (keycode !== this.config.triggerKey) {
      return;
    }

    // Ignore if debounced (auto-repeat prevention)
    if (this.isDebounced(this.state.lastKeyDownTime)) {
      return;
    }

    // Ignore if already held (prevents duplicate events)
    if (this.state.isKeyHeld) {
      return;
    }

    // Update state
    this.state.isKeyHeld = true;
    this.state.lastKeyDownTime = Date.now();
    this.state.recordingStartTime = Date.now();
    this.state.longPressTriggered = false;

    logger.debug('Trigger key pressed');

    this.clearHoldTimer();
    this.state.holdTimer = setTimeout(() => {
      if (!this.state.isKeyHeld || this.state.longPressTriggered) {
        return;
      }

      this.state.longPressTriggered = true;
      logger.debug('Trigger key entered long-press mode');
      this.handlers.onLongPressStart?.();
    }, this.config.holdThresholdMs);
  }

  /**
   * Handle key up event.
   */
  private handleKeyUp(keycode: number): void {
    // Ignore if not our trigger key
    if (keycode !== this.config.triggerKey) {
      return;
    }

    // Ignore if not currently held
    if (!this.state.isKeyHeld) {
      return;
    }

    // Ignore if debounced
    if (this.isDebounced(this.state.lastKeyUpTime)) {
      return;
    }

    // Calculate recording duration
    const recordingDuration = Date.now() - this.state.recordingStartTime;
    const wasLongPress = this.state.longPressTriggered;

    // Update state
    this.state.isKeyHeld = false;
    this.state.lastKeyUpTime = Date.now();
    this.clearHoldTimer();

    if (wasLongPress && recordingDuration < this.config.minRecordingMs) {
      logger.debug('Recording too short, ignoring', {
        duration: recordingDuration,
        minRequired: this.config.minRecordingMs,
      });
      return;
    }

    logger.debug('Trigger key released', { duration: recordingDuration });

    if (wasLongPress) {
      this.handlers.onLongPressEnd?.();
      return;
    }

    this.handlers.onShortPress?.();
  }
}

/**
 * Singleton instance of the keyboard service.
 */
export const keyboardService = new KeyboardService();
