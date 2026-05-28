/**
 * Volcengine ASR WebSocket Client (V3 BigModel API)
 * Binary protocol implementation based on: https://www.volcengine.com/docs/6561/1354869
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import * as zlib from 'zlib';
import log from 'electron-log';
import type { ASRResult, ASRStatus } from '../../../../shared/types/asr';
import type { VolcengineClientConfig, ConnectionState } from '../types';
import { VOLCENGINE_CONSTANTS } from '../types';

const logger = log.scope('volcengine-client');

// ============ Protocol Constants (V3 BigModel) ============

const PROTOCOL = {
  VERSION: 0b0001,
  HEADER_SIZE: 0b0001,

  // Message types
  MSG_FULL_CLIENT_REQUEST: 0b0001,
  MSG_AUDIO_ONLY_REQUEST: 0b0010,
  MSG_FULL_SERVER_RESPONSE: 0b1001,
  MSG_SERVER_ACK: 0b1011,
  MSG_SERVER_ERROR: 0b1111,

  // Message type specific flags
  FLAG_NO_SEQUENCE: 0b0000,
  FLAG_POS_SEQUENCE: 0b0001,
  FLAG_NEG_SEQUENCE: 0b0011,

  // Serialization
  SERIAL_JSON: 0b0001,

  // Compression
  COMPRESS_NONE: 0b0000,
  COMPRESS_GZIP: 0b0001,
};

// ============ Proxy Helper ============

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  if (proxyUrl) {
    logger.info('Using proxy', { proxyUrl });
    return new HttpsProxyAgent(proxyUrl);
  }
  return undefined;
}

// ============ Helper Functions ============

function gzipCompress(data: Buffer): Buffer {
  return zlib.gzipSync(data);
}

function gzipDecompress(data: Buffer): Buffer {
  return zlib.gunzipSync(data);
}

function buildHeader(
  messageType: number,
  messageTypeFlags: number,
  serialization: number,
  compression: number,
): Buffer {
  const header = Buffer.alloc(4);
  header[0] = (PROTOCOL.VERSION << 4) | PROTOCOL.HEADER_SIZE;
  header[1] = (messageType << 4) | messageTypeFlags;
  header[2] = (serialization << 4) | compression;
  header[3] = 0x00;
  return header;
}

function intToBytes(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

function bytesToInt(buf: Buffer, offset = 0): number {
  return buf.readInt32BE(offset);
}

// Build initial request payload (with sequence)
function buildInitRequest(data: object, sequence: number): Buffer {
  const header = buildHeader(
    PROTOCOL.MSG_FULL_CLIENT_REQUEST,
    PROTOCOL.FLAG_POS_SEQUENCE,
    PROTOCOL.SERIAL_JSON,
    PROTOCOL.COMPRESS_GZIP,
  );

  const jsonStr = JSON.stringify(data);
  const jsonBuffer = Buffer.from(jsonStr, 'utf-8');
  const compressedPayload = gzipCompress(jsonBuffer);

  const seqBytes = intToBytes(sequence);
  const payloadSize = intToBytes(compressedPayload.length);

  return Buffer.concat([header, seqBytes, payloadSize, compressedPayload]);
}

// Build audio chunk payload (with sequence)
function buildAudioRequest(
  audioData: Buffer,
  sequence: number,
  isLast: boolean,
): Buffer {
  const flag = isLast ? PROTOCOL.FLAG_NEG_SEQUENCE : PROTOCOL.FLAG_POS_SEQUENCE;
  const header = buildHeader(
    PROTOCOL.MSG_AUDIO_ONLY_REQUEST,
    flag,
    PROTOCOL.SERIAL_JSON,
    PROTOCOL.COMPRESS_GZIP,
  );

  // For last packet, sequence is negative
  const seqValue = isLast ? -sequence : sequence;
  const seqBytes = intToBytes(seqValue);

  const compressedAudio = gzipCompress(audioData);
  const payloadSize = intToBytes(compressedAudio.length);

  return Buffer.concat([header, seqBytes, payloadSize, compressedAudio]);
}

// Parse server response
interface ParsedResponse {
  type: 'ack' | 'result' | 'error';
  sequence: number;
  text?: string;
  isFinal?: boolean;
  error?: string;
}

function parseResponse(data: Buffer): ParsedResponse | null {
  if (data.length < 4) return null;

  const messageType = (data[1] >> 4) & 0x0f;
  const messageFlags = data[1] & 0x0f;
  const compression = data[2] & 0x0f;

  logger.debug('Parse response', { messageType, messageFlags, compression });

  if (messageType === PROTOCOL.MSG_SERVER_ERROR) {
    // Error response: header(4) + code(4) + msgSize(4) + message
    const code = bytesToInt(data, 4);
    const msgSize = bytesToInt(data, 8);
    let message = data.slice(12, 12 + msgSize).toString('utf-8');
    if (compression === PROTOCOL.COMPRESS_GZIP) {
      message = gzipDecompress(data.slice(12, 12 + msgSize)).toString('utf-8');
    }
    logger.error('Server error', { code, message });
    return {
      type: 'error',
      sequence: 0,
      error: message,
    };
  }

  if (messageType === PROTOCOL.MSG_SERVER_ACK) {
    // ACK response: header(4) + sequence(4) + payloadSize(4) + payload
    const sequence = bytesToInt(data, 4);
    logger.debug('Server ACK', { sequence });
    return { type: 'ack', sequence };
  }

  if (messageType === PROTOCOL.MSG_FULL_SERVER_RESPONSE) {
    // Full response: header(4) + sequence(4) + payloadSize(4) + payload
    const sequence = bytesToInt(data, 4);
    const payloadSize = bytesToInt(data, 8);
    const rawPayloadBuf = data.slice(12, 12 + payloadSize);
    const payloadBuf =
      compression === PROTOCOL.COMPRESS_GZIP
        ? gzipDecompress(rawPayloadBuf)
        : rawPayloadBuf;

    const payloadStr = payloadBuf.toString('utf-8');
    logger.debug('Server response', { sequence, payload: payloadStr });

    try {
      const payload = JSON.parse(payloadStr);
      // Check if this is the final result (negative sequence or NEG_SEQUENCE flag)
      const isFinal =
        sequence < 0 || messageFlags === PROTOCOL.FLAG_NEG_SEQUENCE;

      // Extract text from result
      let text = '';
      if (payload.result) {
        text = payload.result.text || '';
        // If no direct text, try to concatenate utterances
        if (!text && payload.result.utterances) {
          text = payload.result.utterances.map((u: { text: string }) => u.text).join('');
        }
      }

      return {
        type: 'result',
        sequence,
        text,
        isFinal,
      };
    } catch (e) {
      logger.error('Failed to parse JSON payload', { error: e });
      return null;
    }
  }

  logger.debug('Unknown message type', { messageType });
  return null;
}

// ============ Event Types ============

export interface VolcengineClientEvents {
  result: (result: ASRResult) => void;
  status: (status: ASRStatus) => void;
  error: (error: Error) => void;
}

export interface VolcengineClient {
  on<K extends keyof VolcengineClientEvents>(
    event: K,
    listener: VolcengineClientEvents[K]
  ): this;
  off<K extends keyof VolcengineClientEvents>(
    event: K,
    listener: VolcengineClientEvents[K]
  ): this;
  emit<K extends keyof VolcengineClientEvents>(
    event: K,
    ...args: Parameters<VolcengineClientEvents[K]>
  ): boolean;
}

// ============ ASR Client Class ============

export class VolcengineClient extends EventEmitter {
  private readonly config: VolcengineClientConfig;
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private requestId = '';
  private sequence = 0;

  constructor(config: VolcengineClientConfig) {
    super();
    this.config = config;
  }

  get isConnected(): boolean {
    return this.connectionState === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  get state(): ConnectionState {
    return this.connectionState;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      logger.warn('Already connected');
      return;
    }

    this.reset();
    this.updateState('connecting');
    this.emitStatus('connecting');

    return new Promise((resolve, reject) => {
      this.requestId = randomUUID();
      this.sequence = 1; // V3 starts with sequence 1

      logger.info('Connecting to Volcengine ASR', {
        endpoint: VOLCENGINE_CONSTANTS.ENDPOINT,
        requestId: this.requestId,
      });

      const headers: Record<string, string> = {
        'X-Api-App-Key': this.config.appId,
        'X-Api-Access-Key': this.config.accessToken,
        'X-Api-Resource-Id': this.config.resourceId,
        'X-Api-Connect-Id': this.requestId,
      };

      const agent = getProxyAgent();
      const wsOptions: WebSocket.ClientOptions = {
        headers,
        ...(agent && { agent }),
      };

      try {
        this.ws = new WebSocket(VOLCENGINE_CONSTANTS.ENDPOINT, wsOptions);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to create WebSocket', { error: err.message });
        this.updateState('error');
        this.emitStatus('error');
        this.emit('error', err);
        reject(err);
        return;
      }

      const connectionTimeout = setTimeout(() => {
        if (this.connectionState === 'connecting') {
          const err = new Error('Connection timeout');
          logger.error('Connection timeout');
          this.cleanup();
          this.updateState('error');
          this.emitStatus('error');
          this.emit('error', err);
          reject(err);
        }
      }, 30000);

      this.ws.on('open', () => {
        logger.info('WebSocket connected', { requestId: this.requestId });
        this.updateState('connected');

        // Send initial request with V3 binary format
        const initRequest = {
          user: { uid: 'electron_user' },
          audio: {
            format: 'pcm',
            sample_rate: 16000,
            channel: 1,
            bits: 16,
            codec: 'raw',
          },
          request: {
            model_name: 'bigmodel',
            enable_punc: true,
            enable_itn: true,
            enable_ddc: true,
            show_utterances: true,
            result_type: 'full',
          },
        };

        logger.debug('Sending init request', initRequest);
        const payload = buildInitRequest(initRequest, this.sequence);
        this.sequence = 2; // Next sequence for audio

        if (this.ws) {
          this.ws.send(payload);
        }

        this.emitStatus('listening');
        clearTimeout(connectionTimeout);
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      this.ws.on('unexpected-response', (_request, response) => {
        logger.error('Unexpected response', {
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          logId: response.headers['x-tt-logid'],
          headers: response.headers,
          resourceId: this.config.resourceId,
        });

        let body = '';
        response.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        response.on('end', () => {
          logger.error('Response body', {
            body,
            logId: response.headers['x-tt-logid'],
            resourceId: this.config.resourceId,
          });
          const err = new Error(`WebSocket upgrade failed: ${response.statusCode} - ${body}`);
          clearTimeout(connectionTimeout);
          this.updateState('error');
          this.emitStatus('error');
          this.emit('error', err);
          reject(err);
        });
      });

      this.ws.on('error', (error: Error) => {
        logger.error('WebSocket error', { error: error.message });
        clearTimeout(connectionTimeout);
        this.emit('error', error);

        if (this.connectionState === 'connecting') {
          reject(error);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.info('WebSocket closed', {
          code,
          reason: reason.toString(),
          requestId: this.requestId,
        });
        clearTimeout(connectionTimeout);

        if (this.connectionState !== 'disconnected') {
          this.updateState('disconnected');
          this.emitStatus('idle');
        }
      });
    });
  }

  disconnect(): void {
    logger.info('Disconnecting', { requestId: this.requestId });
    this.cleanup();
    this.updateState('disconnected');
    this.emitStatus('idle');
  }

  sendAudio(chunk: ArrayBuffer): void {
    if (!this.isConnected) {
      logger.warn('Cannot send audio: not connected');
      return;
    }

    const audioBuffer = Buffer.from(chunk);
    const payload = buildAudioRequest(audioBuffer, this.sequence, false);
    this.sequence++;

    if (this.ws) {
      this.ws.send(payload);
    }
  }

  finishAudio(): void {
    if (!this.isConnected) {
      logger.warn('Cannot finish audio: not connected');
      return;
    }

    logger.info('Sending finish signal', { sequence: this.sequence });
    this.emitStatus('processing');

    // Send final packet with empty audio and negative sequence
    const payload = buildAudioRequest(Buffer.alloc(0), this.sequence, true);
    if (this.ws) {
      this.ws.send(payload);
    }
  }

  // ============ Private Methods ============

  private reset(): void {
    this.requestId = '';
    this.sequence = 0;
  }

  private updateState(state: ConnectionState): void {
    this.connectionState = state;
  }

  private emitStatus(status: ASRStatus): void {
    this.emit('status', status);
  }

  private cleanup(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      } catch {
        // Ignore errors when closing
      }
      this.ws = null;
    }
  }

  private handleMessage(data: Buffer): void {
    const response = parseResponse(data);
    if (!response) return;

    if (response.type === 'error' && response.error) {
      this.emit('error', new Error(response.error));
      this.emitStatus('error');
    } else if (response.type === 'result' && response.text !== undefined) {
      const result: ASRResult = {
        type: response.isFinal ? 'final' : 'interim',
        text: response.text,
        isFinal: response.isFinal ?? false,
      };

      logger.debug('ASR result', {
        type: result.type,
        textLength: result.text.length,
      });

      this.emit('result', result);

      if (response.isFinal) {
        this.emitStatus('done');
      }
    }
    // ACK messages are just logged, no event emitted
  }
}
