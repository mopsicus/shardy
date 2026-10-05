import WebSocket from 'ws';
import { Socket } from 'net';
import { SocketType } from './server';
import { TransportType } from './transport';
import { Logger, LoggerScope } from './logger';
import { Tools } from './tools';

/**
 * Tag for logs
 */
const LOG_TAG = Tools.getTag(module);

/**
 * Event when websocket open
 */
const OPEN_EVENT = 'open';

/**
 * Event receiving new message
 */
const MESSAGE_EVENT = 'message';

/**
 * Event receiving new data
 */
const DATA_EVENT = 'data';

/**
 * Event if errors occurs
 */
const ERROR_EVENT = 'error';

/**
 * Event on connection close
 */
const CLOSE_EVENT = 'close';

/**
 * Default maximum send queue bytes
 */
export const DEFAULT_SEND_BYTES = 4 * 1024 * 1024;

/**
 * Codes for websocket close
 */
enum WebSocketCloseCode {
  NotSet = 0,
  Normal = 1000,
  Away = 1001,
  ProtocolError = 1002,
  UnsupportedData = 1003,
  Undefined = 1004,
  NoStatus = 1005,
  Abnormal = 1006,
  InvalidData = 1007,
  PolicyViolation = 1008,
  TooBig = 1009,
  MandatoryExtension = 1010,
  ServerError = 1011,
  TlsHandshakeFailure = 1015,
}

/**
 * Common connection class
 *
 * @export
 * @class Connection
 */
export class Connection {
  /**
   * Callback on connect
   */
  public onConnect: () => void = () => {};

  /**
   * Callback on get data
   */
  public onData: (incomingBuffer: Buffer) => void = () => {};

  /**
   * Callback when error occurs
   */
  public onError: (error: Error) => void = () => {};

  /**
   * Callback on connection close
   */
  public onClose: () => void = () => {};

  /**
   * Logger instance
   *
   * @type {Logger}
   */
  log!: Logger;

  /**
   * Outgoing data queue
   *
   * @type {Buffer[]}
   */
  outgoing: Buffer[] = [];

  /**
   * Number of bytes in the outgoing data queue
   */
  outgoingBytes: number = 0;

  /**
   * Whether the connection is blocked due to backpressure
   *
   * @type {boolean}
   */
  isBlocked: boolean = false;

  /**
   * Whether the connection is currently sending data through the WebSocket
   *
   * @type {boolean}
   */
  isSending: boolean = false;

  /**
   * Whether the connection is in the process of closing
   *
   * @type {boolean}
   */
  isClosing: boolean = false;

  /**
   * Whether the connection has been closed
   *
   * @type {boolean}
   */
  isClosed: boolean = false;

  /**
   * Creates an instance of Connection
   *
   * @param {SocketType} socket Current socket instance
   * @param {TransportType} transportType Transport type
   */
  constructor(
    private socket: SocketType,
    private transportType: TransportType,
    private maxSendBytes: number = DEFAULT_SEND_BYTES,
  ) {
    if (!Connection.validate(this.maxSendBytes)) {
      this.log.error(`[${LOG_TAG}] max send bytes must be a positive safe integer`, LoggerScope.Debug);
      return;
    }
    this.socket.on(this.transportType === TransportType.TCP ? DATA_EVENT : MESSAGE_EVENT, (incomingBuffer: Buffer) => this.onData(incomingBuffer));
    this.socket.on(ERROR_EVENT, (error: Error) => this.onSocketError(error));
    this.socket.on(CLOSE_EVENT, () => this.onSocketClose());
    if (this.transportType === TransportType.TCP) {
      this.socket.on('drain', () => {
        this.isBlocked = false;
        this.flush();
      });
    }
    if (this.transportType === TransportType.WebSocket) {
      this.socket.on(OPEN_EVENT, () => this.onConnect());
    }
  }

  /**
   * Set logger from client
   *
   * @param {Logger} log Client logger
   */
  setLogger(log: Logger): void {
    this.log = log;
  }

  /**
   * Close socket
   */
  close(): void {
    if (this.isClosing || this.isClosed) {
      return;
    }
    this.isClosing = true;
    this.flush();
  }

  /**
   * Destroy socket
   */
  destroy(): void {
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.outgoing = [];
    this.outgoingBytes = 0;
    switch (this.transportType) {
      case TransportType.TCP:
        (this.socket as Socket).destroy();
        break;
      case TransportType.WebSocket:
        (this.socket as WebSocket).terminate();
        break;
      default:
        break;
    }
  }

  /**
   * Send data to socket
   *
   * @param {Buffer} outgoingBuffer Buffer to send through the socket
   */
  send(outgoingBuffer: Buffer): boolean {
    if (this.isClosing || this.isClosed) {
      return false;
    }
    if (this.getPendingByteCount() + outgoingBuffer.length > this.maxSendBytes) {
      this.failConnection(new Error(`outbound queue limit exceeded: ${this.maxSendBytes}`));
      return false;
    }
    this.outgoing.push(outgoingBuffer);
    this.outgoingBytes += outgoingBuffer.length;
    this.flush();
    return !this.isClosed;
  }

  /**
   * Validate maximum send queue bytes
   *
   * @param {number} maxSendBytes Maximum queued bytes to validate
   * @returns {boolean} True if valid, false otherwise
   */
  static validate = (maxSendBytes: number): boolean => {
    return Number.isSafeInteger(maxSendBytes) && maxSendBytes > 0;
  };

  /**
   * Get the number of pending bytes in the send queue and socket buffer
   *
   * @returns {number} Number of pending bytes
   */
  private getPendingByteCount(): number {
    const pendingSocketBytes = this.transportType === TransportType.TCP ? (this.socket as Socket).writableLength : (this.socket as WebSocket).bufferedAmount;
    return pendingSocketBytes + this.outgoingBytes;
  }

  /**
   * Flush the outgoing data to the socket
   */
  private flush(): void {
    if (this.isClosed) {
      return;
    }
    if (this.transportType === TransportType.TCP) {
      this.flushTCP();
    } else {
      this.flushWebSocket();
    }
  }

  /**
   * Flush the outgoing data to the TCP socket
   */
  private flushTCP(): void {
    const tcpSocket = this.socket as Socket;
    while (!this.isBlocked && this.outgoing.length > 0 && !this.isClosed) {
      const outgoingBuffer = this.outgoing.shift()!;
      this.outgoingBytes -= outgoingBuffer.length;
      try {
        if (!tcpSocket.write(outgoingBuffer)) {
          this.isBlocked = true;
        }
      } catch (error) {
        this.failConnection(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (this.isClosing && !this.isBlocked && this.outgoing.length === 0 && !tcpSocket.writableEnded && !this.isClosed) {
      tcpSocket.end();
    }
  }

  /**
   * Flush the outgoing data to the WebSocket
   */
  private flushWebSocket(): void {
    if (this.isSending || this.isClosed) {
      return;
    }
    const outgoingBuffer = this.outgoing.shift();
    if (!outgoingBuffer) {
      if (this.isClosing) {
        (this.socket as WebSocket).close(WebSocketCloseCode.Normal);
      }
      return;
    }
    this.outgoingBytes -= outgoingBuffer.length;
    this.isSending = true;
    try {
      (this.socket as WebSocket).send(outgoingBuffer, (error?: Error) => {
        this.isSending = false;
        if (error) {
          this.failConnection(error);
        } else {
          this.flushWebSocket();
        }
      });
    } catch (error) {
      this.isSending = false;
      this.failConnection(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle a failed send operation
   *
   * @param error The error that occurred during the send operation
   */
  private failConnection(error: Error): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.outgoing = [];
    this.outgoingBytes = 0;
    if (this.transportType === TransportType.TCP) {
      (this.socket as Socket).destroy();
    } else {
      (this.socket as WebSocket).terminate();
    }
    this.onError(error);
  }

  /**
   * Handle the socket error event
   *
   * @param error The error that occurred on the socket
   */
  private onSocketError(error: Error): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.outgoing = [];
    this.outgoingBytes = 0;
    if (this.transportType === TransportType.TCP) {
      (this.socket as Socket).destroy();
    } else {
      (this.socket as WebSocket).terminate();
    }
    this.onError(error);
  }

  /**
   * Handle the socket close event
   */
  private onSocketClose(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    this.outgoing = [];
    this.outgoingBytes = 0;
    this.onClose();
  }
}
