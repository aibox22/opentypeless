/**
 * ASR (Automatic Speech Recognition) type definitions.
 * Used by both main process and renderer process.
 */

/**
 * ASR configuration for Volcengine service.
 */
export interface ASRConfig {
  appId: string;
  accessToken: string;
  resourceId: string; // "volc.bigasr.sauc.duration"
}

/**
 * ASR result from speech recognition.
 */
export interface ASRResult {
  type: 'interim' | 'final';
  text: string;
  isFinal: boolean;
}

export type DictationMode = 'realtime' | 'integrated';

export interface StructuredRewriteResult {
  rawText: string;
  rewrittenText: string;
  mode: DictationMode;
}

export interface DictationUiState {
  mode: DictationMode | null;
}

/**
 * ASR status states.
 * - idle: Not started
 * - connecting: Establishing connection to ASR service
 * - listening: Actively listening for audio
 * - processing: Processing final audio
 * - done: Recognition complete
 * - error: An error occurred
 */
export type ASRStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'processing'
  | 'done'
  | 'error';

/**
 * Audio chunk data (PCM format).
 */
export interface AudioChunk {
  data: Int16Array;
  sampleRate: 16000;
  channels: 1;
}
