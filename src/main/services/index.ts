/**
 * Services module exports.
 * Re-exports all main process services.
 */

// ASR Service
export {
  ASRService,
  asrService,
  startASR,
  stopASR,
  getASRStatus,
  VolcengineClient,
  loadASRConfig,
  isASRConfigured,
  ConfigurationError,
  VOLCENGINE_CONSTANTS,
} from './asr';

export type {
  ASRServiceEvents,
  StartASRResponse,
  StopASRResponse,
  VolcengineClientEvents,
  ASREnvConfig,
  VolcengineClientConfig,
  ConnectionState,
} from './asr';

// Keyboard Service
export { KeyboardService, keyboardService } from './keyboard';
export type { KeyboardConfig } from './keyboard';

// Text Input Service
export { TextInputService, textInputService } from './text-input';
export type { TextInsertResult } from './text-input';

// Permissions Service
export { PermissionsService, permissionsService } from './permissions';
export type { PermissionStatus, PermissionType, MediaAccessStatus } from './permissions';

// Push-to-Talk Service
export { PushToTalkService, pushToTalkService } from './push-to-talk';
export type { PushToTalkConfig } from './push-to-talk';

// LLM Service
export {
  DoubaoFormatterService,
  doubaoFormatterService,
  loadDoubaoConfig,
  DoubaoConfigurationError,
} from './llm';
export type { DoubaoConfig } from './llm';

// Sound Service
export { SoundService, soundService } from './sound';
