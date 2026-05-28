import type { ReactNode } from 'react';

export function ThinkingProgress(): ReactNode {
  return (
    <div className="thinking-progress" aria-label="Thinking progress">
      <div className="thinking-progress__fill" />
      <span className="thinking-progress__label">Thinking</span>
    </div>
  );
}
