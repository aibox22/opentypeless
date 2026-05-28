import type { CSSProperties, ReactNode } from 'react';

const BAR_COUNT = 12;

interface ListeningVisualizerProps {
  audioLevel: number;
}

export function ListeningVisualizer({ audioLevel }: ListeningVisualizerProps): ReactNode {
  return (
    <div className="listening-visualizer" aria-label="Listening visualizer">
      <div className="listening-visualizer__bars" aria-hidden="true">
        {Array.from({ length: BAR_COUNT }).map((_, index) => (
          <span
            key={index}
            className="listening-visualizer__bar"
            style={
              {
                '--bar-level': String(computeBarLevel(audioLevel, index)),
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

function computeBarLevel(audioLevel: number, index: number): number {
  const center = (BAR_COUNT - 1) / 2;
  const centerDistance = Math.abs(index - center);
  const normalizedDistance = centerDistance / center;
  const falloff = Math.max(0.18, 1 - normalizedDistance * 0.92);
  const easedAudioLevel = Math.pow(Math.max(0, audioLevel), 0.82);
  const level = Math.min(1, Math.max(0, easedAudioLevel * falloff));
  return Number(level.toFixed(3));
}
