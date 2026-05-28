import { spawn } from 'node:child_process';
import log from 'electron-log';

const logger = log.scope('sound-service');

const SYSTEM_SOUNDS = {
  start: '/System/Library/Sounds/Glass.aiff',
  stop: '/System/Library/Sounds/Glass.aiff',
} as const;

export class SoundService {
  playStartCue(): void {
    this.playSystemSound(SYSTEM_SOUNDS.start, 'start');
  }

  playStopCue(): void {
    this.playSystemSound(SYSTEM_SOUNDS.stop, 'stop');
  }

  private playSystemSound(filePath: string, cue: 'start' | 'stop'): void {
    if (process.platform !== 'darwin') {
      return;
    }

    try {
      const child = spawn('afplay', [filePath], {
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
      logger.debug('Played system sound cue', { cue, filePath });
    } catch (error) {
      logger.warn('Failed to play system sound cue', {
        cue,
        filePath,
        error,
      });
    }
  }
}

export const soundService = new SoundService();
