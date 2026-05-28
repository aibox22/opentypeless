/**
 * Status Indicator Component.
 * Displays the current ASR status with appropriate visual feedback.
 */

import type { ReactNode } from 'react';
import type { ASRStatus } from '../../../../../shared/types/asr';

interface StatusIndicatorProps {
  /** Current ASR status */
  status: ASRStatus;
  /** Optional override label */
  label?: string;
}

/**
 * Status configuration for display.
 * Labels and CSS class names for each ASR status.
 */
const STATUS_CONFIG: Record<ASRStatus, { label: string; className: string }> = {
  idle: { label: 'Hold Right Option / Tap to toggle rewrite', className: 'status-indicator--idle' },
  connecting: { label: 'Listening...', className: 'status-indicator--connecting' },
  listening: { label: 'Listening...', className: 'status-indicator--listening' },
  processing: { label: 'Thinking...', className: 'status-indicator--processing' },
  done: { label: 'Done', className: 'status-indicator--done' },
  error: { label: 'Error', className: 'status-indicator--error' },
};

/**
 * Displays the current ASR status with an animated indicator.
 *
 * @example
 * ```tsx
 * <StatusIndicator status="listening" />
 * ```
 */
export function StatusIndicator({ status, label }: StatusIndicatorProps): ReactNode {
  const config = STATUS_CONFIG[status];

  return (
    <div className={`status-indicator ${config.className}`}>
      <span className="status-indicator__dot" />
      <span className="status-indicator__label">{label ?? config.label}</span>
    </div>
  );
}
