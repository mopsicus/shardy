import { Block, BLOCK_HEAD } from './Block';
import { Logger, LoggerScope } from './Logger';
import { Tools } from './Tools';
import { Connection } from './Connection';

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
 * Transport data structure
 *
 * @export
 * @interface TransportData
 */
interface TransportData {
  /**
   * Current package buffer
   */
  buffer: Buffer;

  /**
   * Offset to copy data
   */
  offset: number;

  /**
   * Size for current package
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
   * Callback on received data
   */
  public onData: (data: Buffer) => void = () => {};

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
   * @type {TransportData}
   */
  private head: TransportData;

  /**
   * Package data
   *
   * @type {TransportData}
   */
  private package: TransportData;

  /**
   * Creates an instance of Transport
   *
   * @param {Connection} connection Connection for transport data
   * @param {Logger} log Connection logger instance
   */
  constructor(
    private connection: Connection,
    private log: Logger,
  ) {
    this.state = TransportState.Head;
    this.head = { buffer: Buffer.alloc(BLOCK_HEAD), offset: 0, size: BLOCK_HEAD };
    this.package = { buffer: Buffer.alloc(0), offset: 0, size: 0 };
    this.connection.onData = (data: Buffer) => this.processData(data);
    this.connection.onClose = () => this.onClose();
    this.connection.onError = (error: Error) => this.onError(error);
  }

  /**
   * Event on connection error
   */
  onError(error: Error): void {
    this.log.error(`[${LOG_TAG}] error: ${error.message}`, LoggerScope.Debug);
    this.close();
    this.onDisconnect();
  }

  /**
   * Event on connection close
   */
  onClose(): void {
    this.log.info(`[${LOG_TAG}] close`, LoggerScope.Debug);
    this.close();
    this.onDisconnect();
  }

  /**
   * Detect what to read and read it
   *
   * @param {Buffer} buffer Data to receive
   */
  processData(buffer: Buffer): void {
    if (this.state === TransportState.Closed) {
      this.log.warn(`[${LOG_TAG}] received data when state closed: ${buffer}`, LoggerScope.Debug);
      return;
    }
    if (!Buffer.isBuffer(buffer)) {
      this.log.warn(`[${LOG_TAG}] received not buffer data: ${typeof buffer}`, LoggerScope.Debug);
      return;
    }
    const end = buffer.length;
    let offset = 0;
    while (offset < end) {
      if (this.state === TransportState.Head) {
        offset = this.readHead(buffer, offset);
      }
      if (this.state === TransportState.Body) {
        offset = this.readBody(buffer, offset);
      }
    }
  }

  /**
   * Read head of package, find length
   * Prepare to read body
   *
   * @param {Buffer} buffer Header data
   * @param {number} offset Offset
   * @return {*}  {number} Offset for next chunk
   */
  readHead(buffer: Buffer, offset: number): number {
    const length = Math.min(this.head.size - this.head.offset, buffer.length - offset);
    let result = offset + length;
    buffer.copy(this.head.buffer, this.head.offset, offset, result);
    this.head.offset += length;
    if (this.head.offset >= this.head.size) {
      const size = this.getPackageSize(this.head.buffer);
      if (size < 0) {
        this.log.warn(`[${LOG_TAG}] invalid package size: ${size}`, LoggerScope.Debug);
        result = 0;
      }
      if (Block.check(this.head.buffer[0])) {
        this.package.size = size + this.head.size;
        this.package.buffer = Buffer.alloc(this.package.size);
        this.head.buffer.copy(this.package.buffer, 0, 0, this.head.size);
        this.package.offset = this.head.size;
        this.state = TransportState.Body;
      } else {
        result = buffer.length;
        this.log.warn(`[${LOG_TAG}] invalid block type: ${this.head.buffer[0]}`, LoggerScope.Debug);
      }
    }
    return result;
  }

  /**
   * Read body of package
   *
   * @param {Buffer} buffer Buffer data from connection
   * @param {number} offset Offset for read
   * @return {*}  {number} Offset for next chunk
   */
  readBody(buffer: Buffer, offset: number): number {
    const length = Math.min(this.package.size - this.package.offset, buffer.length - offset);
    const result = offset + length;
    buffer.copy(this.package.buffer, this.package.offset, offset, result);
    this.package.offset += length;
    if (this.package.offset === this.package.size) {
      const buffer = this.package.buffer;
      this.onData(buffer);
      this.reset();
    }
    return result;
  }

  /**
   * Reset all data after receive full package
   */
  reset(): void {
    this.head = { buffer: Buffer.alloc(BLOCK_HEAD), offset: 0, size: BLOCK_HEAD };
    this.package = { buffer: Buffer.alloc(0), offset: 0, size: 0 };
    if (this.state !== TransportState.Closed) {
      this.state = TransportState.Head;
    }
  }

  /**
   * Get package size from header
   *
   * @param {Buffer} buffer Header buffer
   * @return {*}  {number} Package lenght
   */
  getPackageSize(buffer: Buffer): number {
    let result = 0;
    for (let i = 1; i < BLOCK_HEAD; i++) {
      if (i > 1) {
        result <<= 8;
      }
      result += buffer.readUInt8(i);
    }
    return result;
  }

  /**
   * Send data to connection
   *
   * @param {Buffer} data Data to send
   */
  dispatch(data: Buffer): void {
    if (this.state !== TransportState.Closed) {
      this.connection.send(data);
    } else {
      this.log.warn(`[${LOG_TAG}] send data when state closed: ${data}`, LoggerScope.Debug);
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
