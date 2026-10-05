import { Block, BLOCK_HEAD, DEFAULT_BLOCK_SIZE, MAX_BLOCK_SIZE } from './block';
import { Logger, LoggerScope } from './logger';
import { Tools } from './tools';
import { Connection } from './connection';

/**
 * Tag for logs
 */
const LOG_TAG = Tools.getTag(module);

/**
 * Type of transport
 */
export enum TransportType {
  TCP = 'tcp',
  WebSocket = 'websocket',
}

/**
 * Buffer read state
 *
 * @export
 * @interface BufferReadState
 */
interface BufferReadState {
  /**
   * Current frame buffer
   */
  buffer: Buffer;

  /**
   * Offset to copy data
   */
  offset: number;

  /**
   * Total frame size
   */
  size: number;
}

/**
 * Transport state
 */
export enum TransportState {
  /**
   * Receive head data
   */
  Head,

  /**
   * Receive body data
   */
  Body,

  /**
   * Transport is closed, no more data received
   */
  Closed,
}

/**
 * Transport for protocol
 * Manage how data should send and receive to protocol
 *
 * @export
 * @class Transport
 */
export class Transport {
  /**
   * Callback with a complete received frame
   */
  public onData: (frameBuffer: Buffer) => void = () => {};

  /**
   * Callback on disconnect
   */
  public onDisconnect: () => void = () => {};

  /**
   * Current transport state
   *
   * @type {TransportState}
   */
  private state: TransportState;

  /**
   * Head data
   *
   * @type {BufferReadState}
   */
  private frameHeader: BufferReadState;

  /**
   * Current frame data
   *
   * @type {BufferReadState}
   */
  private currentFrame: BufferReadState;

  /**
   * Flag to indicate if the transport has been disconnected
   */
  private isDisconnected: boolean = false;

  /**
   * Creates an instance of Transport
   *
   * @param {Connection} connection Connection for transport data
   * @param {Logger} log Connection logger instance
   */
  constructor(
    private connection: Connection,
    private log: Logger,
    private maxBlockBodySize: number = DEFAULT_BLOCK_SIZE,
  ) {
    this.state = TransportState.Head;
    this.frameHeader = { buffer: Buffer.alloc(BLOCK_HEAD), offset: 0, size: BLOCK_HEAD };
    this.currentFrame = { buffer: Buffer.alloc(0), offset: 0, size: 0 };
    if (!Block.validate(this.maxBlockBodySize ?? DEFAULT_BLOCK_SIZE)) {
      this.log.error(`[${LOG_TAG}] block size must be an integer between 0 and ${MAX_BLOCK_SIZE}`, LoggerScope.System);
      return;
    }
    this.connection.onData = (incomingChunk: Buffer) => this.receiveData(incomingChunk);
    this.connection.onClose = () => this.onClose();
    this.connection.onError = (error: Error) => this.onError(error);
  }

  /**
   * Event on connection error
   */
  onError(error: Error): void {
    this.log.error(`[${LOG_TAG}] error: ${error.message}`, LoggerScope.Debug);
    this.close();
    this.notifyDisconnect();
  }

  /**
   * Event on connection close
   */
  onClose(): void {
    if (this.isDisconnected) {
      return;
    }
    this.log.info(`[${LOG_TAG}] close`, LoggerScope.Debug);
    this.close();
    this.notifyDisconnect();
  }

  /**
   * Consume an incoming chunk and dispatch complete frames
   *
   * @param {Buffer} incomingChunk Bytes received from the socket
   */
  receiveData(incomingChunk: Buffer): void {
    if (this.state === TransportState.Closed) {
      this.log.warn(`[${LOG_TAG}] received data when state closed: ${incomingChunk}`, LoggerScope.Debug);
      return;
    }
    if (!Buffer.isBuffer(incomingChunk)) {
      this.log.warn(`[${LOG_TAG}] received not buffer data: ${typeof incomingChunk}`, LoggerScope.Debug);
      return;
    }
    const chunkLength = incomingChunk.length;
    let chunkOffset = 0;
    while (chunkOffset < chunkLength) {
      if (this.state === TransportState.Head) {
        chunkOffset = this.readHead(incomingChunk, chunkOffset);
      }
      if (this.state === TransportState.Body) {
        chunkOffset = this.readBody(incomingChunk, chunkOffset);
      }
    }
  }

  /**
   * Read the frame header and determine the body length
   * Prepare to read body
   *
   * @param {Buffer} incomingChunk Chunk containing header bytes
   * @param {number} chunkOffset Offset within the incoming chunk
   * @return {number} Next offset within the incoming chunk
   */
  readHead(incomingChunk: Buffer, chunkOffset: number): number {
    const bytesToCopy = Math.min(this.frameHeader.size - this.frameHeader.offset, incomingChunk.length - chunkOffset);
    let nextChunkOffset = chunkOffset + bytesToCopy;
    incomingChunk.copy(this.frameHeader.buffer, this.frameHeader.offset, chunkOffset, nextChunkOffset);
    this.frameHeader.offset += bytesToCopy;
    if (this.frameHeader.offset >= this.frameHeader.size) {
      const bodyLength = this.calculateFrameBodySize(this.frameHeader.buffer);
      if (bodyLength > this.maxBlockBodySize) {
        this.log.warn(`[${LOG_TAG}] frame body size exceeds limit: ${bodyLength}`, LoggerScope.Debug);
        this.state = TransportState.Closed;
        this.connection.destroy();
        this.notifyDisconnect();
        return incomingChunk.length;
      }
      if (Block.check(this.frameHeader.buffer[0])) {
        this.currentFrame.size = bodyLength + this.frameHeader.size;
        this.currentFrame.buffer = Buffer.alloc(this.currentFrame.size);
        this.frameHeader.buffer.copy(this.currentFrame.buffer, 0, 0, this.frameHeader.size);
        this.currentFrame.offset = this.frameHeader.size;
        this.state = TransportState.Body;
        if (bodyLength === 0) {
          const frameBuffer = this.currentFrame.buffer;
          this.reset();
          this.onData(frameBuffer);
        }
      } else {
        nextChunkOffset = incomingChunk.length;
        this.log.warn(`[${LOG_TAG}] invalid block type: ${this.frameHeader.buffer[0]}`, LoggerScope.Debug);
      }
    }
    return nextChunkOffset;
  }

  /**
   * Read body of package
   *
   * @param {Buffer} incomingChunk Chunk containing frame body bytes
   * @param {number} chunkOffset Offset within the incoming chunk
   * @return {number} Next offset within the incoming chunk
   */
  readBody(incomingChunk: Buffer, chunkOffset: number): number {
    const bytesToCopy = Math.min(this.currentFrame.size - this.currentFrame.offset, incomingChunk.length - chunkOffset);
    const nextChunkOffset = chunkOffset + bytesToCopy;
    incomingChunk.copy(this.currentFrame.buffer, this.currentFrame.offset, chunkOffset, nextChunkOffset);
    this.currentFrame.offset += bytesToCopy;
    if (this.currentFrame.offset === this.currentFrame.size) {
      const frameBuffer = this.currentFrame.buffer;
      this.onData(frameBuffer);
      this.reset();
    }
    return nextChunkOffset;
  }

  /**
   * Reset all data after receive full package
   */
  reset(): void {
    this.frameHeader = { buffer: Buffer.alloc(BLOCK_HEAD), offset: 0, size: BLOCK_HEAD };
    this.currentFrame = { buffer: Buffer.alloc(0), offset: 0, size: 0 };
    if (this.state !== TransportState.Closed) {
      this.state = TransportState.Head;
    }
  }

  /**
   * Notify transport disconnection
   */
  notifyDisconnect(): void {
    if (!this.isDisconnected) {
      this.isDisconnected = true;
      this.onDisconnect();
    }
  }

  /**
   * Calculate frame body size from header
   *
   * @param {Buffer} frameHeaderBuffer Frame header buffer
   * @returns {number} Frame body length
   */
  calculateFrameBodySize(frameHeaderBuffer: Buffer): number {
    let bodyLength = 0;
    for (let byteOffset = 1; byteOffset < BLOCK_HEAD; byteOffset++) {
      if (byteOffset > 1) {
        bodyLength <<= 8;
      }
      bodyLength += frameHeaderBuffer.readUInt8(byteOffset);
    }
    return bodyLength;
  }

  /**
   * Send data to connection
   *
   * @param {Buffer} encodedFrame Encoded frame to send
   */
  dispatch(encodedFrame: Buffer): void {
    if (this.state !== TransportState.Closed) {
      this.connection.send(encodedFrame);
    } else {
      this.log.warn(`[${LOG_TAG}] send data when state closed: ${encodedFrame}`, LoggerScope.Debug);
    }
  }

  /**
   * Close transport
   */
  close(): void {
    this.state = TransportState.Closed;
    this.connection.close();
  }

  /**
   * Destroy
   */
  destroy(): void {
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
    this.state = TransportState.Closed;
    this.connection.destroy();
  }
}
