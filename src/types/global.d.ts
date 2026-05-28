/**
 * Global type declarations for the Electron application.
 * Extends the Window interface with the exposed API.
 */

import type { ASRConfig, ASRResult, ASRStatus, DictationUiState } from '../shared/types/asr';

/**
 * ASR API interface exposed via contextBridge.
 */
interface ASRApi {
  /**
   * Start ASR session.
   * @param config - Optional partial ASR configuration
   */
  start: (config?: Partial<ASRConfig>) => Promise<{ success: boolean }>;

  /**
   * Stop ASR session.
   */
  stop: () => Promise<{ success: boolean }>;

  /**
   * Send audio chunk to main process.
   * @param chunk - Audio data as ArrayBuffer
   */
  sendAudio: (chunk: ArrayBuffer) => void;

  /**
   * Send current audio level to main process for visualization.
   * @param level - Normalized level from 0 to 1
   */
  sendAudioLevel: (level: number) => void;

  /**
   * Subscribe to ASR results.
   * @param callback - Called when ASR result is received
   * @returns Unsubscribe function
   */
  onResult: (callback: (result: ASRResult) => void) => () => void;

  /**
   * Subscribe to ASR status changes.
   * @param callback - Called when ASR status changes
   * @returns Unsubscribe function
   */
  onStatus: (callback: (status: ASRStatus) => void) => () => void;

  /**
   * Subscribe to ASR errors.
   * @param callback - Called when ASR error occurs
   * @returns Unsubscribe function
   */
  onError: (callback: (error: string) => void) => () => void;

  /**
   * Subscribe to audio level changes for waveform visualization.
   * @param callback - Called when audio level changes
   * @returns Unsubscribe function
   */
  onAudioLevel: (callback: (level: number) => void) => () => void;

  /**
   * Subscribe to dictation UI state changes.
   * @param callback - Called when dictation mode changes
   * @returns Unsubscribe function
   */
  onUiState: (callback: (state: DictationUiState) => void) => () => void;
}

/**
 * Floating Window API interface exposed via contextBridge.
 */
interface FloatingWindowApi {
  /**
   * Show the floating window.
   */
  show: () => Promise<{ success: boolean }>;

  /**
   * Hide the floating window.
   */
  hide: () => Promise<{ success: boolean }>;

  /**
   * Set content height for adaptive window sizing.
   * @param height - Content height in pixels (from scrollHeight)
   */
  setContentHeight: (height: number) => void;
}

/**
 * Application API exposed to the renderer process.
 */
interface AppApi {
  asr: ASRApi;
  floatingWindow: FloatingWindowApi;
}

declare global {
  interface Window {
    api: AppApi;
  }
}

export {};
