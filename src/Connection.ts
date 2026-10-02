import WebSocket from 'ws';
import { Socket } from 'net';
import { SocketType } from './Server';
import { TransportType } from './Transport';
import { Logger, LoggerScope } from './Logger';
import { Tools } from './Tools';

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
  public onData: (data: Buffer) => void = () => {};

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
   *
   * @type {number}
   */
  outgone: number = 0;

  /**
   * Whether the connection is blocked due to backpressure
   *
   * @type {boolean}
   */
  blocked: boolean = false;

  /**
   * Whether the connection is currently sending data through the WebSocket
   *
   * @type {boolean}
   */
  sending: boolean = false;

  /**
   * Whether the connection is in the process of closing
   *
   * @type {boolean}
   */
  closing: boolean = false;

  /**
   * Whether the connection has been closed
   *
   * @type {boolean}
   */
  closed: boolean = false;

  /**
   * Creates an instance of Connection
   *
   * @param {SocketType} socket Current socket instance
   * @param {TransportType} type Transport type
   */
  constructor(
    private socket: SocketType,
    private type: TransportType,
    private bytes: number = DEFAULT_SEND_BYTES,
  ) {
    if (!Connection.validate(this.bytes)) {
      this.log.error(`[${LOG_TAG}] max send bytes must be a positive safe integer`, LoggerScope.Debug);
      return;
    }
    this.socket.on(this.type === TransportType.TCP ? DATA_EVENT : MESSAGE_EVENT, (data: Buffer) => this.onData(data));
    this.socket.on(ERROR_EVENT, (error: Error) => this.onSocketError(error));
    this.socket.on(CLOSE_EVENT, () => this.onSocketClose());
    if (this.type === TransportType.TCP) {
      this.socket.on('drain', () => {
        this.blocked = false;
        this.flush();
      });
    }
    if (this.type === TransportType.WebSocket) {
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
    if (this.closing || this.closed) {
      return;
    }
    this.closing = true;
    this.flush();
  }

  /**
   * Destroy socket
   */
  destroy(): void {
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.outgoing = [];
    this.outgone = 0;
    switch (this.type) {
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
   * @param {Buffer} data Data to send
   */
  send(data: Buffer): boolean {
    if (this.closing || this.closed) {
      return false;
    }
    if (this.pending() + data.length > this.bytes) {
      this.processError(new Error(`outbound queue limit exceeded (${this.bytes} bytes)`));
      return false;
    }
    this.outgoing.push(data);
    this.outgone += data.length;
    this.flush();
    return !this.closed;
  }

  /**
   * Validate maximum send queue bytes
   *
   * @param {number} value Value to validate
   * @returns {boolean} True if valid, false otherwise
   */
  static validate = (value: number): boolean => {
    return Number.isSafeInteger(value) && value > 0;
  };   

  /**
   * Get the number of pending bytes in the send queue and socket buffer
   *
   * @returns {number} Number of pending bytes
   */
  private pending(): number {
    const size = this.type === TransportType.TCP ? (this.socket as Socket).writableLength : (this.socket as WebSocket).bufferedAmount;
    return size + this.outgone;
  }  

  /**
   * Flush the outgoing data to the socket
   */
  private flush(): void {
    if (this.closed) {
      return;
    }
    if (this.type === TransportType.TCP) {
      this.flushTCP();
    } else {
      this.flushWebSocket();
    }
  }

  /**
   * Flush the outgoing data to the TCP socket
   */
  private flushTCP(): void {
    const socket = this.socket as Socket;
    while (!this.blocked && this.outgoing.length > 0 && !this.closed) {
      const data = this.outgoing.shift()!;
      this.outgone -= data.length;
      try {
        if (!socket.write(data)) {
          this.blocked = true;
        }
      } catch (error) {
        this.processError(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (this.closing && !this.blocked && this.outgoing.length === 0 && !socket.writableEnded && !this.closed) {
      socket.end();
    }
  }

  /**
   * Flush the outgoing data to the WebSocket
   */
  private flushWebSocket(): void {
    if (this.sending || this.closed) {
      return;
    }
    const data = this.outgoing.shift();
    if (!data) {
      if (this.closing) {
        (this.socket as WebSocket).close(WebSocketCloseCode.Normal);
      }
      return;
    }
    this.outgone -= data.length;
    this.sending = true;
    try {
      (this.socket as WebSocket).send(data, (error?: Error) => {
        this.sending = false;
        if (error) {
          this.processError(error);
        } else {
          this.flushWebSocket();
        }
      });
    } catch (error) {
      this.sending = false;
      this.processError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Handle a failed send operation
   *
   * @param error The error that occurred during the send operation
   */
  private processError(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.outgoing = [];
    this.outgone = 0;
    if (this.type === TransportType.TCP) {
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
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.outgoing = [];
    this.outgone = 0;
    if (this.type === TransportType.TCP) {
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
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.outgoing = [];
    this.outgone = 0;
    this.onClose();
  }
}
