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
   * Creates an instance of Connection
   *
   * @param {SocketType} socket Current socket instance
   * @param {TransportType} type Transport type
   */
  constructor(
    private socket: SocketType,
    private type: TransportType,
  ) {
    this.socket.on(this.type === TransportType.TCP ? DATA_EVENT : MESSAGE_EVENT, (data: Buffer) => this.onData(data));
    this.socket.on(ERROR_EVENT, (error: Error) => this.onError(error));
    this.socket.on(CLOSE_EVENT, () => this.onClose());
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
    switch (this.type) {
      case TransportType.TCP:
        (this.socket as Socket).end();
        break;
      case TransportType.WebSocket:
        (this.socket as WebSocket).close(WebSocketCloseCode.Normal);
        break;
      default:
        break;
    }
  }

  /**
   * Destroy socket
   */
  destroy(): void {
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
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
  send(data: Buffer): void {
    switch (this.type) {
      case TransportType.TCP:
        (this.socket as Socket).write(data);
        break;
      case TransportType.WebSocket:
        (this.socket as WebSocket).send(data);
        break;
      default:
        break;
    }
  }
}
