/**
 * Preload script for Electron.
 * Exposes a safe API to the renderer process via contextBridge.
 *
 * See the Electron documentation for details on how to use preload scripts:
 * https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from './shared/constants/channels';
import type { ASRConfig, ASRResult, ASRStatus, DictationUiState } from './shared/types/asr';

/**
 * ASR API exposed to the renderer process.
 */
const asrApi = {
  /**
   * Start ASR session.
   * @param config - Optional partial ASR configuration
   */
  start: (config?: Partial<ASRConfig>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ASR.START, config),

  /**
   * Stop ASR session.
   */
  stop: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.ASR.STOP),

  /**
   * Send audio chunk to main process.
   * @param chunk - Audio data as ArrayBuffer
   */
  sendAudio: (chunk: ArrayBuffer): void => {
    ipcRenderer.send(IPC_CHANNELS.ASR.SEND_AUDIO, chunk);
  },

  /**
   * Send current audio level to main process for visualization.
   * @param level - Normalized level from 0 to 1
   */
  sendAudioLevel: (level: number): void => {
    ipcRenderer.send(IPC_CHANNELS.ASR.AUDIO_LEVEL, level);
  },

  /**
   * Subscribe to ASR results.
   * @param callback - Called when ASR result is received
   * @returns Unsubscribe function
   */
  onResult: (callback: (result: ASRResult) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: ASRResult): void => {
      callback(result);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.RESULT, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.RESULT, handler);
    };
  },

  /**
   * Subscribe to ASR status changes.
   * @param callback - Called when ASR status changes
   * @returns Unsubscribe function
   */
  onStatus: (callback: (status: ASRStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: ASRStatus): void => {
      callback(status);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.STATUS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.STATUS, handler);
    };
  },

  /**
   * Subscribe to ASR errors.
   * @param callback - Called when ASR error occurs
   * @returns Unsubscribe function
   */
  onError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string): void => {
      callback(error);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.ERROR, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.ERROR, handler);
    };
  },

  onUiState: (callback: (state: DictationUiState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: DictationUiState): void => {
      callback(state);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.UI_STATE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.UI_STATE, handler);
    };
  },

  onAudioLevel: (callback: (level: number) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, level: number): void => {
      callback(level);
    };
    ipcRenderer.on(IPC_CHANNELS.ASR.AUDIO_LEVEL, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ASR.AUDIO_LEVEL, handler);
    };
  },
};

/**
 * Floating Window API exposed to the renderer process.
 */
const floatingWindowApi = {
  /**
   * Show the floating window.
   */
  show: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOATING_WINDOW.SHOW),

  /**
   * Hide the floating window.
   */
  hide: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.FLOATING_WINDOW.HIDE),

  /**
   * Set content height for adaptive window sizing.
   * @param height - Content height in pixels (from scrollHeight)
   */
  setContentHeight: (height: number): void => {
    ipcRenderer.send(IPC_CHANNELS.FLOATING_WINDOW.SET_CONTENT_HEIGHT, height);
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('api', {
  asr: asrApi,
  floatingWindow: floatingWindowApi,
});
