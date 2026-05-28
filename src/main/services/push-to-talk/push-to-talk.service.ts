/**
 * Push-to-Talk Service.
 * Orchestrates keyboard hooks, ASR, and text insertion for voice input.
 *
 * Flow:
 * 1. User holds Right Option key
 * 2. KeyboardService detects keydown -> triggers handleKeyDown
 * 3. ASR session starts, floating window shows
 * 4. Renderer starts recording, sends audio chunks
 * 5. User releases Right Option key
 * 6. KeyboardService detects keyup -> triggers handleKeyUp
 * 7. ASR session stops, gets final result
 * 8. Text is inserted at cursor position
 * 9. Floating window hides
 */

import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { keyboardService } from '../keyboard';
import { textInputService } from '../text-input';
import { asrService } from '../asr';
import { doubaoFormatterService } from '../llm';
import { soundService } from '../sound';
import { permissionsService } from '../permissions';
import { floatingWindow } from '../../windows';
import { IPC_CHANNELS } from '../../../shared/constants/channels';
import type { DictationMode } from '../../../shared/types/asr';

const logger = log.scope('push-to-talk-service');

/**
 * Push-to-Talk Service configuration.
 */
export interface PushToTalkConfig {
  /** Whether to auto-insert text after recognition */
  autoInsertText: boolean;
  /** Delay before hiding floating window after done (ms) */
  hideDelayMs: number;
  /** Delay before text insertion after the floating window yields focus */
  insertDelayMs: number;
  /** How long to keep the final realtime result visible before hiding */
  realtimeResultPreviewMs: number;
  /** How long to keep the final integrated result visible before hiding */
  integratedResultPreviewMs: number;
}

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: PushToTalkConfig = {
  autoInsertText: true,
  hideDelayMs: 500,
  insertDelayMs: 100,
  realtimeResultPreviewMs: 320,
  integratedResultPreviewMs: 450,
};

/**
 * Push-to-Talk Service orchestrates the voice input flow.
 *
 * Coordinates:
 * - KeyboardService: Global keyboard hook for trigger key
 * - ASRService: Speech recognition
 * - TextInputService: Text insertion at cursor
 * - FloatingWindow: Visual feedback
 *
 * @example
 * ```typescript
 * // Initialize on app ready
 * pushToTalkService.initialize();
 *
 * // Cleanup on app quit
 * pushToTalkService.dispose();
 * ```
 */
export class PushToTalkService {
  private config: PushToTalkConfig;
  private isActive = false;
  private isInitialized = false;
  private mode: DictationMode | null = null;

  constructor(config: Partial<PushToTalkConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the Push-to-Talk service.
   * Registers keyboard hooks and sets up event listeners.
   */
  initialize(): void {
    if (this.isInitialized) {
      logger.warn('PushToTalkService already initialized');
      return;
    }

    logger.info('Initializing PushToTalkService');

    // Log permission status for debugging
    permissionsService.logPermissionStatus();

    // Register keyboard hooks
    keyboardService.register({
      onShortPress: () => this.handleShortPress(),
      onLongPressStart: () => this.handleLongPressStart(),
      onLongPressEnd: () => this.handleLongPressEnd(),
      onCancel: () => this.handleCancel(),
    });

    this.isInitialized = true;
    logger.info('PushToTalkService initialized');
  }

  /**
   * Dispose of the Push-to-Talk service.
   * Unregisters keyboard hooks and cleans up resources.
   */
  dispose(): void {
    if (!this.isInitialized) {
      return;
    }

    logger.info('Disposing PushToTalkService');

    // Stop any active session
    if (this.isActive) {
      this.stopCurrentSession().catch((error) => {
        logger.error('Error during dispose cleanup', { error });
      });
    }

    // Unregister keyboard hooks
    keyboardService.unregister();

    this.isInitialized = false;
    logger.info('PushToTalkService disposed');
  }

  /**
   * Check if the service is currently active (recording).
   */
  get isRecording(): boolean {
    return this.isActive;
  }

  /**
   * Handle key down event (trigger key pressed).
   * Starts ASR session and shows floating window.
   */
  private async handleLongPressStart(): Promise<void> {
    if (this.isActive || this.mode !== null) {
      logger.warn('Already recording, ignoring key down');
      return;
    }

    try {
      await this.startSession('realtime');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to start push-to-talk session', { error: message });
    }
  }

  /**
   * Handle key up event (trigger key released).
   * Stops ASR session, inserts text, and hides floating window.
   */
  private async handleLongPressEnd(): Promise<void> {
    if (!this.isActive) {
      logger.debug('Not recording, ignoring key up');
      return;
    }

    if (this.mode !== 'realtime') {
      logger.debug('Ignoring long-press end for non-realtime session', { mode: this.mode });
      return;
    }

    try {
      await this.stopCurrentSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop push-to-talk session', { error: message });

      // Show error in floating window briefly, then hide
      floatingWindow.sendError(`Error: ${message}`);
      setTimeout(() => {
        floatingWindow.hide();
      }, this.config.hideDelayMs * 2);
    }
  }

  private async handleShortPress(): Promise<void> {
    if (!this.isActive && this.mode === null) {
      try {
        await this.startSession('integrated');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('Failed to start integrated dictation session', { error: message });
      }
      return;
    }

    if (!this.isActive && this.mode !== 'integrated') {
      logger.debug('Ignoring short press while a non-interactive state is active', {
        mode: this.mode,
      });
      return;
    }

    if (this.mode !== 'integrated') {
      logger.debug('Ignoring short press while realtime mode is active');
      return;
    }

    try {
      await this.stopCurrentSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to stop integrated dictation session', { error: message });
      floatingWindow.sendError(`Error: ${message}`);
      setTimeout(() => {
        floatingWindow.hide();
      }, this.config.hideDelayMs * 2);
    }
  }

  private handleCancel(): void {
    if (!this.isActive || !this.mode) {
      logger.debug('Ignoring cancel because there is no active session');
      floatingWindow.hide();
      return;
    }

    this.cancelCurrentSession().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Failed to cancel dictation session', { error: message });
      floatingWindow.sendError(`Cancel failed: ${message}`);
      setTimeout(() => {
        floatingWindow.hide();
      }, this.config.hideDelayMs * 2);
    });
  }

  private async startSession(mode: DictationMode): Promise<void> {
    if (this.isActive || this.mode !== null) {
      logger.warn('Attempted to start a session while one is already active', {
        currentMode: this.mode,
        requestedMode: mode,
      });
      return;
    }

    logger.info('Push-to-talk session start requested', { mode });
    this.isActive = true;
    this.mode = mode;
    this.broadcastUiState();
    soundService.playStartCue();

    try {
      floatingWindow.sendStatus('connecting');
      await asrService.start();
      floatingWindow.sendStatus('listening');
      this.notifyRendererStartRecording();
      logger.info('Push-to-talk session started', { mode });
    } catch (error) {
      this.isActive = false;
      this.mode = null;
      this.broadcastUiState();
      const message = error instanceof Error ? error.message : String(error);
      floatingWindow.sendError(`Failed to start: ${message}`);
      throw error;
    }
  }

  private async stopCurrentSession(): Promise<void> {
    if (!this.isActive || !this.mode) {
      logger.debug('No active session to stop');
      return;
    }

    const mode = this.mode;
    logger.info('Push-to-talk session stop requested', { mode });
    this.isActive = false;
    soundService.playStopCue();

    if (mode === 'integrated') {
      floatingWindow.sendStatus('processing');
    }
    this.notifyRendererStopRecording();

    const result = await asrService.stop({
      finalStatus: mode === 'integrated' ? 'processing' : 'idle',
    });
    const finalText = result?.text?.trim() ?? '';

    if (!finalText) {
      logger.info('No ASR result to insert', { mode });
      if (mode === 'integrated') {
        asrService.setStatusManually('idle');
      }
      this.mode = null;
      this.broadcastUiState();
      floatingWindow.hide();
      return;
    }

    logger.info('ASR result received', {
      textLength: finalText.length,
      isFinal: result?.isFinal,
      mode,
    });

    let outputText = finalText;
    if (mode === 'integrated') {
      outputText = await this.rewriteIntegratedTranscript(finalText);
    }

    floatingWindow.sendResult({
      type: 'final',
      text: outputText,
      isFinal: true,
    });
    if (mode === 'integrated') {
      asrService.setStatusManually('done');
    }

    await new Promise((resolve) =>
      setTimeout(
        resolve,
        mode === 'integrated'
          ? this.config.integratedResultPreviewMs
          : this.config.realtimeResultPreviewMs
      )
    );

    asrService.setStatusManually('idle');
    this.mode = null;
    this.broadcastUiState();
    floatingWindow.hide();

    if (this.config.autoInsertText) {
      await new Promise((resolve) => setTimeout(resolve, this.config.insertDelayMs));
      const insertResult = textInputService.insert(outputText);
      if (!insertResult.success) {
        logger.error('Failed to insert text', { error: insertResult.error });
        floatingWindow.sendError(`Insert failed: ${insertResult.error}`);
      } else {
        logger.info('Text inserted successfully', {
          length: outputText.length,
          mode,
        });
      }
    }

    logger.info('Push-to-talk session completed', { mode });
  }

  private async cancelCurrentSession(): Promise<void> {
    if (!this.isActive || !this.mode) {
      return;
    }

    const mode = this.mode;
    logger.info('Push-to-talk session cancel requested', { mode });
    this.isActive = false;
    this.mode = null;
    this.broadcastUiState();

    try {
      this.notifyRendererStopRecording();
      await asrService.stop({ finalStatus: 'idle' });
    } catch (error) {
      logger.warn('Error while cancelling session', { error });
    } finally {
      floatingWindow.hide();
      logger.info('Push-to-talk session cancelled', { mode });
    }
  }

  private async rewriteIntegratedTranscript(text: string): Promise<string> {
    logger.info('Rewriting integrated transcript with Doubao', {
      textLength: text.length,
    });
    const rewritten = await doubaoFormatterService.rewriteTranscript(text);
    return rewritten.rewrittenText;
  }

  private broadcastUiState(): void {
    const state = { mode: this.mode };
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.ASR.UI_STATE, state);
      }
    });
  }

  /**
   * Notify renderer process to start recording.
   */
  private notifyRendererStartRecording(): void {
    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ASR.STATUS, 'listening');
    }
  }

  /**
   * Notify renderer process to stop recording.
   */
  private notifyRendererStopRecording(): void {
    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.ASR.STATUS, 'processing');
    }
  }

  /**
   * Get the main application window.
   */
  private getMainWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find(
      (win) => !win.isDestroyed()
    ) ?? null;
  }
}

/**
 * Singleton instance of the push-to-talk service.
 */
export const pushToTalkService = new PushToTalkService();
