import { BlockData, BlockType } from './Block';
import { Payload, PayloadData, PayloadType } from './Payload';
import { Protocol } from './Protocol';
import { Logger, LoggerScope } from './Logger';
import { Tools } from './Tools';
import { Pulse } from './Pulse';
import { ValidatorState } from './Validator';
import { Service, ServiceOptions } from './Service';
import { Connection } from './Connection';

/**
 * Tag for logs
 */
const LOG_TAG = Tools.getTag(module);

/**
 * Interval for timeout timer, ms
 */
const TIMEOUT_INTERVAL = 1000;

/**
 * Default timeout error code
 */
const TIMEOUT_ERROR = 'timeout';

/**
 * Type for loaded commands and requests
 */
export type Task = (commander: Commander, payload: PayloadData, service: Service) => void;

/**
 * Type for requests callbacks
 */
export type ResponseType = (data: PayloadData) => void;

/**
 * Mode for commander
 */
export enum CommanderMode {
  /**
   * For service instance
   */
  Service,

  /**
   * For bot
   */
  Bot,
}

/**
 * Disconnect reasons
 */
export enum DisconnectReason {
  /**
   * Normal disconnect
   */
  Normal,

  /**
   * Have no answer on ping command
   */
  Timeout,

  /**
   * Handshake validation failed
   */
  Handshake,

  /**
   * Server is closed
   */
  ServerDown,

  /**
   * Some error occured
   */
  Unknown,
}

/**
 * Client commander to send/receive commands and requests
 *
 * @export
 * @class Commander
 */
export class Commander {
  /**
   * Callback on disconnect
   */
  public onDisconnect: (reason: DisconnectReason) => void = () => {};

  /**
   * Callback when ready for work
   */
  public onReady: () => void = () => {};

  /**
   * Connection ID
   *
   * @type {string}
   */
  public cid: string = 'unknown';

  /**
   * Current request id counter
   *
   * @private
   * @type {number}
   */
  private counter: number = 1;

  /**
   * Pulse instance
   *
   * @private
   * @type {Pulse}
   */
  private pulse: Pulse;

  /**
   * List of callbacks for commands
   *
   * @type {Map<string, Array<ResponseType>>}
   */
  private commands: Map<string, Array<ResponseType>> = new Map<string, Array<ResponseType>>();

  /**
   * List of callbacks for requests
   *
   * @type {Map<number, ResponseType>}
   */
  private callbacks: Map<number, ResponseType> = new Map<number, ResponseType>();

  /**
   * List of callbacks for requests for bot
   *
   * @type {Map<string, ResponseType>}
   */
  private requests: Map<string, ResponseType> = new Map<string, ResponseType>();

  /**
   * List of timeouts callbacks for requests
   *
   * @type {Map<number, number>}
   */
  private timeouts: Map<number, number> = new Map<number, number>();

  /**
   * List of requests names
   *
   * @type {Map<number, string>}
   */
  private names: Map<number, string> = new Map<number, string>();

  /**
   * Requests timeout timer
   *
   * @private
   * @type {NodeJS.Timeout}
   */
  private timer: NodeJS.Timeout;

  /**
   * Protocol instance
   *
   * @private
   * @type {Protocol}
   */
  private protocol: Protocol;

  /**
   * Current disconnect reason
   *
   * @private
   * @type {DisconnectReason}
   */
  private reason: DisconnectReason = DisconnectReason.Normal;

  /**
   * Creates an instance of Commander
   *
   * @param {string} id Connection ID
   * @param {Connection} connection Client connection
   * @param {Service} service Service instance
   * @param {ServiceOptions} options Service options: validator, commands, serializer, etc
   * @param {Logger} log Client logger
   * @param {CommanderMode} [mode=CommanderMode.Service] mode Commander mode for service or bot
   */
  constructor(
    private id: string,
    private connection: Connection,
    private service: Service,
    private options: ServiceOptions,
    private log: Logger,
    private mode: CommanderMode = CommanderMode.Service,
  ) {
    this.cid = this.id;
    this.protocol = new Protocol(this.connection, this.log);
    this.protocol.onBlock = (block: BlockData) => this.onBlock(block);
    this.protocol.onDisconnect = () => this.onClose();
    this.pulse = new Pulse(mode);
    this.pulse.onPulse = () => this.onPulse();
    this.timer = setInterval(() => this.onCheckTimeout(), TIMEOUT_INTERVAL);
    this.counter = 0;
  }

  /**
   * Send KICK package to client and disconnect
   *
   * @param {DisconnectReason} reason Disconnect reason data
   */
  kick(reason: DisconnectReason): void {
    this.log.info(`-> kick: ${reason}`, LoggerScope.Debug);
    this.protocol.kick(reason);
    this.protocol.disconnect();
    this.pulse.clear();
  }

  /**
   * Send heartbeat (ping) command
   */
  heartbeat(): void {
    this.log.info(`-> heartbeat`, LoggerScope.Debug);
    this.protocol.heartbeat();
  }

  /**
   * Send handshake
   * @param {Buffer} data Data to send
   */
  handshake(data: Buffer): void {
    this.log.info(`-> handshake`, LoggerScope.Debug);
    this.protocol.handshake(data);
  }

  /**
   * Send acknowledge
   * @param {Buffer} data Data to send
   */
  acknowledge(data: Buffer): void {
    this.log.info(`-> acknowledge`, LoggerScope.Debug);
    this.protocol.acknowledge(data);
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.log.info(`-> disconnect`, LoggerScope.Debug);
    this.protocol.disconnect();
  }

  /**
   * Send command (event) to server
   *
   * @param {string} command Command name
   * @param {Buffer} [data] Payload data
   */
  command(command: string, data?: Buffer): void {
    this.log.info(`-> command: ${command}, data: ${data}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Command, command, 0, data);
    this.protocol.send(payload);
  }

  /**
   * Send request to server and wait response
   *
   * @param {string} request Request name
   * @param {Buffer} [data] Payload data
   */
  fetch(request: string, data?: Buffer): Promise<PayloadData> {
    this.log.info(`-> fetch: ${this.counter}.${request}, data: ${data}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Request, request, this.counter, data);
    this.protocol.send(payload);
    const callback = new Promise<PayloadData>((resolve) => this.callbacks.set(this.counter, resolve));
    this.names.set(this.counter, request);
    this.timeouts.set(this.counter, Date.now());
    this.counter++;
    return callback;
  }

  /**
   * Send request to server and wait response in callback
   *
   * @param {string} request Request name
   * @param {ResponseType} callback Callback with response
   * @param {Buffer} [data] Payload data
   */
  request(request: string, callback: ResponseType, data?: Buffer): number {
    this.log.info(`-> request: ${this.counter}.${request}, data: ${data}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Request, request, this.counter, data);
    this.protocol.send(payload);
    this.callbacks.set(this.counter, callback);
    this.names.set(this.counter, request);
    this.timeouts.set(this.counter, Date.now());
    return this.counter++;
  }

  /**
   * Send response on client request
   *
   * @param {PayloadData} request Request from client with id, etc
   * @param {Buffer} [data] Data to send
   */
  response(request: PayloadData, data?: Buffer): void {
    this.log.info(`-> response: ${request.id}.${request.name}, data: ${data}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Response, request.name, request.id, data);
    this.protocol.send(payload);
  }

  /**
   * Send error on client request
   *
   * @param {PayloadData} request Request from client with id, etc
   * @param {string} error Error message or code
   * @param {Buffer} [data] Data to send
   */
  error(request: PayloadData, error: string, data?: Buffer): void {
    this.log.info(`-> error: ${request.id}.${request.name}, error: ${error}, data: ${data}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Response, request.name, request.id, data, error);
    this.protocol.send(payload);
  }

  /**
   * Clear all events
   */
  clear(): void {
    clearInterval(this.timer);
    this.pulse.clear();
    this.names.clear();
    this.timeouts.clear();
    this.commands.clear();
    this.requests.clear();
    this.callbacks.clear();
  }

  /**
   * Cancel request
   *
   * @param {number} id Request id
   */
  cancelRequest(id: number): void {
    this.names.delete(id);
    this.callbacks.delete(id);
    this.timeouts.delete(id);
  }

  /**
   * Subscribe callback on command
   *
   * @param {string} command Command name
   * @param {ResponseType} callback Callback for command
   */
  addCommand(command: string, callback: ResponseType): void {
    let list = new Array<ResponseType>();
    if (this.commands.has(command)) {
      list = this.commands.get(command)!;
    }
    list.push(callback);
    this.commands.set(command, list);
  }

  /**
   * Unsubscribe callback on command
   * If callback is null -> clear all of them
   *
   * @param {string} command Command name
   * @param {ResponseType} callback Callback for command
   */
  cancelCommand(command: string, callback?: ResponseType): void {
    if (this.commands.has(command)) {
      if (!callback) {
        const list = new Array<ResponseType>();
        this.commands.set(command, list);
      } else {
        const list = this.commands.get(command)!;
        const index = list.indexOf(callback, 0);
        if (index > -1) {
          list.splice(index, 1);
        }
        this.commands.set(command, list);
      }
    }
  }

  /**
   * Add callback for request
   *
   * @param {string} request Request name
   * @param {ResponseType} callback Callback
   */
  addOnRequest(request: string, callback: ResponseType): void {
    if (this.requests.has(request)) {
      this.log.warn(`request already exists: ${request}, method: ${this.requests.get(request)}`, LoggerScope.Debug);
      return;
    }
    this.requests.set(request, callback);
  }

  /**
   * Remove callback for request
   *
   * @param {string} request Request name
   */
  cancelOnRequest(request: string): void {
    if (this.requests.has(request)) {
      this.requests.delete(request);
    }
  }

  /**
   * Timeout checker
   */
  onCheckTimeout(): void {
    for (const [id, time] of this.timeouts) {
      const diff = Date.now() - time;
      if (diff > process.env.REQUEST_TIMEOUT) {
        const payload = Payload.create(PayloadType.Response, this.names.get(id)!, id, undefined, TIMEOUT_ERROR);
        this.onPayload(payload);
      }
    }
  }

  /**
   * Process data from protocol
   *
   * @param {BlockData} block Block type and possible data
   */
  onBlock(block: BlockData) {
    this.log.info(`[${LOG_TAG}] block: ${block.type}, data: ${block.body}`, LoggerScope.Debug);
    switch (block.type) {
      case BlockType.Handshake:
        this.onHandshake(block);
        break;
      case BlockType.Heartbeat:
        this.onHeartbeat();
        break;
      case BlockType.Kick:
        this.onKick(block);
        break;
      case BlockType.HandshakeAcknowledgement:
        this.onAcknowledgement(block);
        break;
      case BlockType.Data:
        const payload = Payload.decode(this.options.serializer, block.body);
        if (Payload.check(payload)) {
          this.onPayload(payload);
        } else {
          this.log.warn(`[${LOG_TAG}] invalid payload: ${payload}`, LoggerScope.Debug);
        }
        break;
      default:
        this.log.warn(`[${LOG_TAG}] not implemented block type: ${block.type}`, LoggerScope.Debug);
        break;
    }
  }

  /**
   * Process payload with commands/request/responses
   * When received data, send heartbeat for ok (for client)
   *
   * @param {PayloadData} payload Decoded payload data
   */
  onPayload(payload: PayloadData): void {
    this.pulse.reset();
    if (this.mode === CommanderMode.Bot) {
      this.heartbeat();
    }
    switch (payload.type) {
      case PayloadType.Command:
        this.log.info(`<- command: ${payload.name}, data: ${payload.data}`, LoggerScope.Debug);
        if (this.mode === CommanderMode.Service) {
          const command = this.options.commands!.get(payload.name);
          if (command) {
            command(this, payload, this.service);
          } else {
            this.log.warn(`[${LOG_TAG}] unknown command: ${payload.name}`, LoggerScope.Debug);
          }
        } else {
          const list = this.commands.get(payload.name);
          if (list) {
            for (const callback of list) {
              callback(payload);
            }
          }
        }
        break;
      case PayloadType.Request:
        this.log.info(`<- request: ${payload.id}.${payload.name}, data: ${payload.data}`, LoggerScope.Debug);
        if (this.mode === CommanderMode.Service) {
          const request = this.options.commands!.get(payload.name);
          if (request) {
            request(this, payload, this.service);
          } else {
            this.log.warn(`[${LOG_TAG}] unknown request: ${payload.id}.${payload.name}`, LoggerScope.Debug);
          }
        } else {
          const callback = this.requests.get(payload.name);
          if (callback) {
            callback(payload);
          }
        }
        break;
      case PayloadType.Response:
        if (payload.error.trim().length === 0) {
          this.log.info(`<- response: ${payload.id}.${payload.name}, data: ${payload.data}`, LoggerScope.Debug);
        } else {
          this.log.info(`<- error: ${payload.id}.${payload.name}, error: ${payload.error}, data: ${payload.data}`, LoggerScope.Debug);
        }
        const callback = this.callbacks.get(payload.id);
        if (callback) {
          callback(payload);
          this.cancelRequest(payload.id);
        } else {
          this.log.warn(`[${LOG_TAG}] unknown response: ${payload.id}.${payload.name}`, LoggerScope.Debug);
        }
        break;
      default:
        break;
    }
  }

  /**
   * Event from protocol when connection closed
   */
  onClose(): void {
    this.log.info(`<- disconnect`, LoggerScope.Debug);
    this.clear();
    this.onDisconnect(this.reason);
  }

  /**
   * Prepare handshake
   *
   * @param {BlockData} block Handshake data
   */
  onHandshake(block: BlockData): void {
    this.log.info(`<- handshake`, LoggerScope.Debug);
    this.pulse.reset();
    const state = this.options.validator.verifyHandshake(block.body);
    this.log.info(`[${LOG_TAG}] handshake validation state: ${state}, data: ${block.body}`, LoggerScope.Debug);
    if (state === ValidatorState.Success) {
      this.acknowledge(this.options.validator.acknowledgement(block.body));
    } else {
      this.kick(DisconnectReason.Handshake);
    }
  }

  /**
   * Process acknowledgement
   *
   * @param {BlockData} block Acknowledgement data
   */
  onAcknowledgement(block: BlockData): void {
    this.log.info(`<- acknowledge`, LoggerScope.Debug);
    this.pulse.reset();
    if (this.mode === CommanderMode.Bot) {
      const state = this.options.validator.verifyAcknowledgement(block.body);
      this.log.info(`[${LOG_TAG}] acknowledgement data: ${block.body}, validation state: ${state}`, LoggerScope.Debug);
      if (state === ValidatorState.Success) {
        this.acknowledge(this.options.validator.acknowledgement(block.body));
      } else {
        this.reason = DisconnectReason.Handshake;
        this.disconnect();
        return;
      }
    } else {
      this.log.info(`[${LOG_TAG}] acknowledgement data: ${block.body}`, LoggerScope.Debug);
    }
    this.log.info(`ready to work`, LoggerScope.Debug);
    this.onReady();
  }

  /**
   * Process heartbeat
   */
  onHeartbeat(): void {
    this.log.info(`<- heartbeat`, LoggerScope.Debug);
    this.pulse.reset();
    if (this.mode === CommanderMode.Service) {
      this.heartbeat();
    }
  }

  /**
   * Process kick
   *
   * @param {BlockData} block Kick reason data
   */
  onKick(block: BlockData): void {
    this.reason = block.body as unknown as DisconnectReason;
    this.log.info(`<- kick: ${this.reason}`, LoggerScope.Debug);
    this.pulse.reset();
  }

  /**
   * No answer from connection, check it
   */
  onPulse(): void {
    if (this.mode === CommanderMode.Bot) {
      this.log.info(`[${LOG_TAG}] pulse timeout, send heartbeat`, LoggerScope.Debug);
      this.heartbeat();
    } else {
      this.log.info(`pulse timeout, send kick`, LoggerScope.Debug);
      this.kick(DisconnectReason.Timeout);
    }
  }

  /**
   * Destroy
   */
  destroy(): void {
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
    this.clear();
    this.protocol.destroy();
  }
}
