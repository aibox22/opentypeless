/**
 * Floating Window Component.
 * The main component for the ASR floating window that displays status and transcription.
 */

import type { ReactNode } from 'react';
import { useASRStatus } from '../hooks';
import { StatusIndicator } from './StatusIndicator';
import { TranscriptDisplay } from './TranscriptDisplay';
import { ErrorDisplay } from './ErrorDisplay';

/**
 * Main floating window component that displays ASR status and transcription results.
 *
 * The window shows:
 * - Status indicator (connecting, listening, processing, done)
 * - Transcript text (interim in gray, final in black)
 * - Error messages when something goes wrong
 *
 * @example
 * ```tsx
 * // In the floating window entry point
 * ReactDOM.createRoot(document.getElementById('root')!).render(
 *   <FloatingWindow />
 * );
 * ```
 */
export function FloatingWindow(): ReactNode {
  const { status, result, error, mode, modeLabel } = useASRStatus();

  const statusLabel =
    status === 'processing' && mode === 'integrated'
      ? 'Thinking'
      : modeLabel;

  const showStatusIndicator = Boolean(statusLabel);
  const showTranscript =
    Boolean(result?.text) &&
    (status === 'listening' || status === 'done' || status === 'processing');

  return (
    <div className="floating-window">
      <div className="floating-window__content">
        {showStatusIndicator && <StatusIndicator status={status} label={statusLabel ?? ''} />}

        {showTranscript && result && (
          <TranscriptDisplay text={result.text} interim={!result.isFinal} />
        )}

        {error && <ErrorDisplay message={error} />}
      </div>
    </div>
  );
}
