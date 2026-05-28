/**
 * AudioRecorder class for capturing microphone audio.
 * Uses Web Audio API to capture, process, and convert audio to PCM format.
 *
 * This is a vanilla TypeScript implementation that doesn't require React.
 * Can be used directly or wrapped in a React hook when needed.
 */

import { AUDIO_CONFIG, AUDIO_ERRORS } from '../constants';
import { float32ToArrayBuffer } from './pcm-converter';
import type {
  AudioChunkCallback,
  AudioRecorderState,
  AudioResources,
  StateChangeCallback,
} from '../types';

/**
 * AudioRecorder for capturing microphone audio and converting to PCM format.
 *
 * @example
 * ```typescript
 * const recorder = new AudioRecorder(
 *   (chunk) => {
 *     window.api.asr.sendAudio(chunk);
 *   },
 *   (state) => {
 *     console.log('Recording:', state.isRecording);
 *     if (state.error) console.error(state.error);
 *   }
 * );
 *
 * // Start recording
 * await recorder.start();
 *
 * // Stop recording
 * recorder.stop();
 *
 * // Clean up when done
 * recorder.destroy();
 * ```
 */
export class AudioRecorder {
  private state: AudioRecorderState = {
    isRecording: false,
    error: null,
  };

  private resources: AudioResources | null = null;
  private onAudioChunk: AudioChunkCallback;
  private onStateChange: StateChangeCallback | null;
  private onAudioLevel?: (level: number) => void;
  private isPrepared = false;

  /**
   * Creates a new AudioRecorder instance.
   *
   * @param onAudioChunk - Callback invoked with each audio chunk (PCM 16-bit ArrayBuffer)
   * @param onStateChange - Optional callback invoked when state changes
   */
  constructor(
    onAudioChunk: AudioChunkCallback,
    onStateChange?: StateChangeCallback,
    onAudioLevel?: (level: number) => void
  ) {
    this.onAudioChunk = onAudioChunk;
    this.onStateChange = onStateChange ?? null;
    this.onAudioLevel = onAudioLevel;
  }

  /**
   * Gets the current recorder state.
   */
  public getState(): AudioRecorderState {
    return { ...this.state };
  }

  /**
   * Whether recording is currently in progress.
   */
  public get isRecording(): boolean {
    return this.state.isRecording;
  }

  /**
   * Current error message, or null if no error.
   */
  public get error(): string | null {
    return this.state.error;
  }

  /**
   * Updates the internal state and notifies listeners.
   */
  private setState(newState: Partial<AudioRecorderState>): void {
    this.state = { ...this.state, ...newState };
    this.onStateChange?.(this.getState());
  }

  /**
   * Cleans up all audio resources.
   */
  private cleanupResources(): void {
    if (!this.resources) return;

    // Disconnect and close audio nodes
    this.resources.processorNode.disconnect();
    this.resources.sourceNode.disconnect();

    // Stop all media stream tracks
    this.resources.stream.getTracks().forEach((track: MediaStreamTrack) => {
      track.stop();
    });

    // Close the AudioContext
    void this.resources.audioContext.close();

    this.resources = null;
    this.isPrepared = false;
  }

  private async ensurePrepared(): Promise<void> {
    if (this.resources && this.isPrepared) {
      return;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      this.setState({ error: AUDIO_ERRORS.AUDIO_CONTEXT_NOT_SUPPORTED });
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: AUDIO_CONFIG.sampleRate,
        channelCount: AUDIO_CONFIG.channelCount,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const audioContext = new AudioContextClass({
      sampleRate: AUDIO_CONFIG.sampleRate,
    });

    const sourceNode = audioContext.createMediaStreamSource(stream);
    const processorNode = audioContext.createScriptProcessor(
      AUDIO_CONFIG.bufferSize,
      AUDIO_CONFIG.channelCount,
      AUDIO_CONFIG.channelCount
    );

    const onChunk = this.onAudioChunk;
    processorNode.onaudioprocess = (event: AudioProcessingEvent): void => {
      const inputData = event.inputBuffer.getChannelData(0);
      this.onAudioLevel?.(this.state.isRecording ? this.calculateAudioLevel(inputData) : 0);

      if (!this.state.isRecording) {
        return;
      }

      const pcmBuffer = float32ToArrayBuffer(inputData);
      onChunk(pcmBuffer);
    };

    sourceNode.connect(processorNode);
    processorNode.connect(audioContext.destination);

    this.resources = {
      stream,
      audioContext,
      sourceNode,
      processorNode,
    };

    await audioContext.suspend();
    this.isPrepared = true;
  }

  public async prepare(): Promise<void> {
    this.setState({ error: null });

    try {
      await this.ensurePrepared();
    } catch (err) {
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
            this.setState({ error: AUDIO_ERRORS.PERMISSION_DENIED });
            break;
          case 'NotFoundError':
          case 'DevicesNotFoundError':
            this.setState({ error: AUDIO_ERRORS.DEVICE_NOT_AVAILABLE });
            break;
          default:
            this.setState({ error: `Microphone error: ${err.message}` });
        }
      } else if (err instanceof Error) {
        this.setState({ error: `Failed to prepare recording: ${err.message}` });
      } else {
        this.setState({
          error: 'An unknown error occurred while preparing recording',
        });
      }

      this.cleanupResources();
    }
  }

  /**
   * Starts recording audio from the microphone.
   *
   * @returns Promise that resolves when recording starts, or rejects on error
   */
  public async start(): Promise<void> {
    // Check if already recording
    if (this.state.isRecording) {
      this.setState({ error: AUDIO_ERRORS.ALREADY_RECORDING });
      return;
    }

    // Clear any previous error
    this.setState({ error: null });

    try {
      await this.ensurePrepared();

      if (!this.resources) {
        return;
      }

      if (this.resources.audioContext.state === 'suspended') {
        await this.resources.audioContext.resume();
      }

      this.setState({ isRecording: true });
    } catch (err) {
      // Handle specific error types
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
          case 'PermissionDeniedError':
            this.setState({ error: AUDIO_ERRORS.PERMISSION_DENIED });
            break;
          case 'NotFoundError':
          case 'DevicesNotFoundError':
            this.setState({ error: AUDIO_ERRORS.DEVICE_NOT_AVAILABLE });
            break;
          default:
            this.setState({ error: `Microphone error: ${err.message}` });
        }
      } else if (err instanceof Error) {
        this.setState({ error: `Failed to start recording: ${err.message}` });
      } else {
        this.setState({
          error: 'An unknown error occurred while starting recording',
        });
      }

      // Clean up any partially created resources
      this.cleanupResources();
    }
  }

  /**
   * Stops the current recording.
   */
  public stop(): void {
    if (!this.state.isRecording) {
      return;
    }

    this.setState({ isRecording: false });
    this.onAudioLevel?.(0);

    if (this.resources && this.resources.audioContext.state === 'running') {
      void this.resources.audioContext.suspend();
    }
  }

  /**
   * Cleans up all resources. Call this when the recorder is no longer needed.
   */
  public destroy(): void {
    this.stop();
    this.onStateChange = null;
    this.onAudioLevel = undefined;
  }

  private calculateAudioLevel(inputData: Float32Array): number {
    let sumSquares = 0;
    for (let i = 0; i < inputData.length; i++) {
      const sample = inputData[i];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / inputData.length);
    return Math.min(1, rms * 6);
  }
}
