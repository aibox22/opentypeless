/**
 * Main window renderer process.
 * Handles automatic audio recording when ASR status changes.
 */

import './index.css';
import { AudioRecorder } from './renderer/src/modules/asr';

console.log(
  '👋 This message is being logged by "renderer.ts", included via Vite',
);

// Audio recorder instance
let recorder: AudioRecorder | null = null;

/**
 * Initialize audio recorder with callback to send chunks to main process.
 */
function initRecorder(): AudioRecorder {
  return new AudioRecorder(
    (chunk) => {
      // Send audio chunk to main process via IPC
      window.api.asr.sendAudio(chunk);
    },
    (state) => {
      console.log('[Renderer] AudioRecorder state:', state);
    },
    (level) => {
      window.api.asr.sendAudioLevel(level);
    }
  );
}

async function prepareRecorder(): Promise<void> {
  if (!recorder) {
    recorder = initRecorder();
  }

  try {
    console.log('[Renderer] Preparing audio recorder...');
    await recorder.prepare();
    console.log('[Renderer] Audio recorder prepared');
  } catch (error) {
    console.error('[Renderer] Failed to prepare recorder:', error);
  }
}

/**
 * Start recording audio.
 */
async function startRecording(): Promise<void> {
  if (!recorder) {
    recorder = initRecorder();
  }

  if (recorder.isRecording) {
    return;
  }

  try {
    console.log('[Renderer] Starting audio recording...');
    await recorder.start();
    console.log('[Renderer] Audio recording started');
  } catch (error) {
    console.error('[Renderer] Failed to start recording:', error);
  }
}

/**
 * Stop recording audio.
 */
function stopRecording(): void {
  if (recorder) {
    console.log('[Renderer] Stopping audio recording...');
    recorder.stop();
    window.api.asr.sendAudioLevel(0);
    console.log('[Renderer] Audio recording stopped');
  }
}

// Track current status to avoid duplicate operations
let currentStatus = 'idle';

// Listen for ASR status changes from main process
window.api.asr.onStatus((status) => {
  console.log('[Renderer] ASR status changed:', status);

  // Avoid duplicate handling
  if (status === currentStatus) return;
  currentStatus = status;

  if (status === 'listening') {
    // Start recording when ASR is ready to accept live audio
    startRecording();
  } else if (status === 'connecting') {
    // Prewarm microphone/audio context while ASR connects
    void prepareRecorder();
    void startRecording();
  } else {
    // Stop recording for any other status
    stopRecording();
  }
});

// Cleanup on window unload
window.addEventListener('beforeunload', () => {
  if (recorder) {
    recorder.destroy();
    recorder = null;
  }
});

console.log('[Renderer] Auto-recording initialized, waiting for ASR status...');
void prepareRecorder();
