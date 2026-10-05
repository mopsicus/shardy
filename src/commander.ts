import { BlockData, BlockType } from './block';
import { Payload, PayloadData, PayloadType } from './payload';
import { Protocol } from './protocol';
import { Logger, LoggerScope } from './logger';
import { Tools } from './tools';
import { Pulse } from './pulse';
import { ValidatorState } from './validator';
import { Service, ServiceOptions } from './service';
import { Connection } from './connection';

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
 * Handler for commands and requests loaded by a service
 */
export type CommandHandler = (commander: Commander, payload: PayloadData, service: Service) => void | Promise<void>;

/**
 * Handler invoked with a response payload
 */
export type ResponseCallback = (payload: PayloadData) => void | Promise<void>;

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
  private requestIdCounter: number = 1;

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
   * @type {Map<string, Array<ResponseCallback>>}
   */
  private commandHandlers: Map<string, Array<ResponseCallback>> = new Map<string, Array<ResponseCallback>>();

  /**
   * List of callbacks for requests
   *
   * @type {Map<number, ResponseCallback>}
   */
  private responseCallbacks: Map<number, ResponseCallback> = new Map<number, ResponseCallback>();

  /**
   * List of reject callbacks for requests
   *
   * @type {Map<number, (error: Error) => void>}
   */
  private requestRejectors: Map<number, (error: Error) => void> = new Map<number, (error: Error) => void>();

  /**
   * List of callbacks for requests for bot
   *
   * @type {Map<string, ResponseCallback>}
   */
  private requestHandlers: Map<string, ResponseCallback> = new Map<string, ResponseCallback>();

  /**
   * List of timeouts callbacks for requests
   *
   * @type {Map<number, number>}
   */
  private requestStartTimes: Map<number, number> = new Map<number, number>();

  /**
   * List of requests names
   *
   * @type {Map<number, string>}
   */
  private requestNames: Map<number, string> = new Map<number, string>();

  /**
   * Requests timeout timer
   *
   * @private
   * @type {NodeJS.Timeout}
   */
  private requestTimeoutTimer: NodeJS.Timeout;

  /**
   * Unique identifier for the commander instance
   *
   * @private
   * @type {string}
   */
  private id: string;

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
   * Indicates whether the commander is closed
   *
   * @private
   * @type {boolean}
   */
  private isClosed: boolean = false;

  /**
   * Creates an instance of Commander
   *
   * @param {string} connectionId Connection ID
   * @param {Connection} connection Client connection
   * @param {Service} service Service instance
   * @param {ServiceOptions} options Service options: validator, commands, serializer, etc
   * @param {Logger} log Client logger
   * @param {CommanderMode} [mode=CommanderMode.Service] mode Commander mode for service or bot
   */
  constructor(
    connectionId: string,
    private connection: Connection,
    private service: Service,
    private options: ServiceOptions,
    private log: Logger,
    private mode: CommanderMode = CommanderMode.Service,
  ) {
    this.id = connectionId;
    this.cid = this.id;
    this.protocol = new Protocol(this.connection, this.log, this.options.block);
    this.protocol.onBlock = (block: BlockData) => this.onBlock(block);
    this.protocol.onDisconnect = () => this.onClose();
    this.pulse = new Pulse(mode);
    this.pulse.onPulse = () => this.onPulse();
    this.requestTimeoutTimer = setInterval(() => this.onCheckTimeout(), TIMEOUT_INTERVAL);
    this.requestIdCounter = 0;
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
   * @param {Buffer} handshakePayload Handshake payload bytes
   */
  handshake(handshakePayload: Buffer): void {
    this.log.info(`-> handshake`, LoggerScope.Debug);
    this.protocol.handshake(handshakePayload);
  }

  /**
   * Send acknowledge
   * @param {Buffer} acknowledgementPayload Acknowledgement payload bytes
   */
  acknowledge(acknowledgementPayload: Buffer): void {
    this.log.info(`-> acknowledge`, LoggerScope.Debug);
    this.protocol.acknowledge(acknowledgementPayload);
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
   * @param {string} commandName Command name
   * @param {Buffer} [commandPayload] Command payload bytes
   */
  command(commandName: string, commandPayload?: Buffer): void {
    this.log.info(`-> command: ${commandName}, data: ${commandPayload}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Command, commandName, 0, commandPayload);
    this.protocol.send(payload);
  }

  /**
   * Send request to server and wait response
   *
   * @param {string} requestName Request name
   * @param {Buffer} [requestPayload] Request payload bytes
   */
  fetch(requestName: string, requestPayload?: Buffer): Promise<PayloadData> {
    const requestId = this.requestIdCounter++;
    this.log.info(`-> fetch: ${requestId}.${requestName}, data: ${requestPayload}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Request, requestName, requestId, requestPayload);
    const responsePromise = new Promise<PayloadData>((resolve, reject) => {
      this.responseCallbacks.set(requestId, resolve);
      this.requestRejectors.set(requestId, reject);
      this.requestNames.set(requestId, requestName);
      this.requestStartTimes.set(requestId, Date.now());
    });
    try {
      this.protocol.send(payload);
    } catch (error) {
      this.cancelRequest(requestId);
      return Promise.reject(error);
    }
    return responsePromise;
  }

  /**
   * Send request to server and wait response in callback
   *
   * @param {string} requestName Request name
   * @param {ResponseCallback} responseCallback Callback with response
   * @param {Buffer} [requestPayload] Request payload bytes
   */
  request(requestName: string, responseCallback: ResponseCallback, requestPayload?: Buffer): number {
    const requestId = this.requestIdCounter++;
    this.log.info(`-> request: ${requestId}.${requestName}, data: ${requestPayload}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Request, requestName, requestId, requestPayload);
    this.responseCallbacks.set(requestId, responseCallback);
    this.requestNames.set(requestId, requestName);
    this.requestStartTimes.set(requestId, Date.now());
    try {
      this.protocol.send(payload);
    } catch (error) {
      this.removeRequest(requestId);
      throw error;
    }
    return requestId;
  }

  /**
   * Send response on client request
   *
   * @param {PayloadData} requestPayload Request received from the client
   * @param {Buffer} [responsePayload] Response payload bytes
   */
  response(requestPayload: PayloadData, responsePayload?: Buffer): void {
    this.log.info(`-> response: ${requestPayload.id}.${requestPayload.name}, data: ${responsePayload}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Response, requestPayload.name, requestPayload.id, responsePayload);
    this.protocol.send(payload);
  }

  /**
   * Send error on client request
   *
   * @param {PayloadData} requestPayload Request received from the client
   * @param {string} errorMessage Error message or code
   * @param {Buffer} [responsePayload] Response payload bytes
   */
  error(requestPayload: PayloadData, errorMessage: string, responsePayload?: Buffer): void {
    this.log.info(`-> error: ${requestPayload.id}.${requestPayload.name}, error: ${errorMessage}, data: ${responsePayload}`, LoggerScope.Debug);
    const payload = Payload.encode(this.options.serializer, PayloadType.Response, requestPayload.name, requestPayload.id, responsePayload, errorMessage);
    this.protocol.send(payload);
  }

  /**
   * Clear all events
   */
  clear(): void {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    clearInterval(this.requestTimeoutTimer);
    this.pulse.clear();
    const pendingResponses = Array.from(this.responseCallbacks.entries());
    const requestRejectors = new Map(this.requestRejectors);
    const requestNames = new Map(this.requestNames);
    this.requestNames.clear();
    this.requestStartTimes.clear();
    this.commandHandlers.clear();
    this.requestHandlers.clear();
    this.responseCallbacks.clear();
    this.requestRejectors.clear();
    for (const [requestId, responseCallback] of pendingResponses) {
      const rejectRequest = requestRejectors.get(requestId);
      if (rejectRequest) {
        rejectRequest(new Error('closed'));
      } else {
        try {
          responseCallback(Payload.create(PayloadType.Response, requestNames.get(requestId) ?? '', requestId, undefined, 'closed'));
        } catch (error) {
          this.log.error(`[${LOG_TAG}] request callback failed: ${error}`, LoggerScope.Debug);
        }
      }
    }
  }

  /**
   * Invoke a task with the given payload
   *
   * @param {CommandHandler} commandHandler Handler to invoke
   * @param {PayloadData} payload Command or request payload
   */
  processTask(commandHandler: CommandHandler, payload: PayloadData): void {
    try {
      const handlerPromise = commandHandler(this, payload, this.service);
      if (handlerPromise) {
        void handlerPromise.catch((error) => this.handleError(payload, error));
      }
    } catch (error) {
      this.handleError(payload, error);
    }
  }

  /**
   * Invoke a response callback with the given payload
   *
   * @param {ResponseCallback} responseCallback Response callback to invoke
   * @param {PayloadData} payload Payload passed to the response callback
   * @param {(error: unknown) => void} [onError] Optional error handler
   */
  processResponse(responseCallback: ResponseCallback, payload: PayloadData, onError?: (error: unknown) => void): void {
    try {
      const callbackPromise = responseCallback(payload);
      if (callbackPromise) {
        void callbackPromise.catch((error) => {
          if (onError) {
            onError(error);
          } else {
            this.log.error(`[${LOG_TAG}] response callback failed: ${error}`, LoggerScope.Debug);
          }
        });
      }
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        this.log.error(`[${LOG_TAG}] response callback failed: ${error}`, LoggerScope.Debug);
      }
    }
  }

  /**
   * Cancel request
   *
   * @param {number} requestId Request id
   */
  cancelRequest(requestId: number): void {
    const reject = this.requestRejectors.get(requestId);
    this.removeRequest(requestId);
    reject?.(new Error('cancelled'));
  }

  /**
   * Remove request by ID
   *
   * @param {number} requestId Request ID
   */
  removeRequest(requestId: number): void {
    this.requestNames.delete(requestId);
    this.requestStartTimes.delete(requestId);
    this.responseCallbacks.delete(requestId);
    this.requestRejectors.delete(requestId);
  }

  /**
   * Handle error for a given payload
   *
   * @param {PayloadData} payloadData Payload associated with the error
   * @param {unknown} handlerError Error to handle
   */
  handleError(payloadData: PayloadData, handlerError: unknown): void {
    this.log.info(`[${LOG_TAG}] handle error: ${handlerError}`, LoggerScope.Debug);
    if (payloadData.type === PayloadType.Request) {
      try {
        this.error(payloadData, handlerError instanceof Error ? handlerError.message : String(handlerError));
      } catch (responseError) {
        this.log.error(`[${LOG_TAG}] failed to handle error: ${responseError}`, LoggerScope.Debug);
      }
    }
  }

  /**
   * Subscribe callback on command
   *
   * @param {string} commandName Command name
   * @param {ResponseCallback} commandHandler Handler for the command
   */
  addCommand(commandName: string, commandHandler: ResponseCallback): void {
    let commandHandlers = new Array<ResponseCallback>();
    if (this.commandHandlers.has(commandName)) {
      commandHandlers = this.commandHandlers.get(commandName)!;
    }
    commandHandlers.push(commandHandler);
    this.commandHandlers.set(commandName, commandHandlers);
  }

  /**
   * Unsubscribe callback on command
   * If no handler is supplied, clear all handlers
   *
   * @param {string} commandName Command name
   * @param {ResponseCallback} commandHandler Handler to remove
   */
  cancelCommand(commandName: string, commandHandler?: ResponseCallback): void {
    if (this.commandHandlers.has(commandName)) {
      if (!commandHandler) {
        const commandHandlers = new Array<ResponseCallback>();
        this.commandHandlers.set(commandName, commandHandlers);
      } else {
        const commandHandlers = this.commandHandlers.get(commandName)!;
        const handlerIndex = commandHandlers.indexOf(commandHandler, 0);
        if (handlerIndex > -1) {
          commandHandlers.splice(handlerIndex, 1);
        }
        this.commandHandlers.set(commandName, commandHandlers);
      }
    }
  }

  /**
   * Add callback for request
   *
   * @param {string} requestName Request name
   * @param {ResponseCallback} requestHandler Handler for the request
   */
  addOnRequest(requestName: string, requestHandler: ResponseCallback): void {
    if (this.requestHandlers.has(requestName)) {
      this.log.warn(`request already exists: ${requestName}, method: ${this.requestHandlers.get(requestName)}`, LoggerScope.Debug);
      return;
    }
    this.requestHandlers.set(requestName, requestHandler);
  }

  /**
   * Remove callback for request
   *
   * @param {string} requestName Request name
   */
  cancelOnRequest(requestName: string): void {
    if (this.requestHandlers.has(requestName)) {
      this.requestHandlers.delete(requestName);
    }
  }

  /**
   * Timeout checker
   */
  onCheckTimeout(): void {
    for (const [requestId, requestStartTime] of this.requestStartTimes) {
      const elapsedMilliseconds = Date.now() - requestStartTime;
      if (elapsedMilliseconds > process.env.REQUEST_TIMEOUT) {
        const payload = Payload.create(PayloadType.Response, this.requestNames.get(requestId)!, requestId, undefined, TIMEOUT_ERROR);
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
        try {
          const payload: unknown = Payload.decode(this.options.serializer, block.body);
          if (!Payload.check(payload)) {
            this.log.warn(`[${LOG_TAG}] invalid payload`, LoggerScope.Debug);
            this.reason = DisconnectReason.Unknown;
            this.disconnect();
            return;
          }
          this.onPayload(payload);
        } catch (error) {
          this.log.error(`[${LOG_TAG}] payload decode failed: ${error}`, LoggerScope.Debug);
          this.reason = DisconnectReason.Unknown;
          this.disconnect();
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
          const commandHandler = this.options.commands?.get(payload.name);
          if (commandHandler) {
            this.processTask(commandHandler, payload);
          } else {
            this.log.warn(`[${LOG_TAG}] unknown command: ${payload.name}`, LoggerScope.Debug);
          }
        } else {
          const commandHandlers = this.commandHandlers.get(payload.name);
          if (commandHandlers) {
            for (const commandHandler of commandHandlers) {
              this.processResponse(commandHandler, payload);
            }
          }
        }
        break;
      case PayloadType.Request:
        this.log.info(`<- request: ${payload.id}.${payload.name}, data: ${payload.data}`, LoggerScope.Debug);
        if (this.mode === CommanderMode.Service) {
          const requestHandler = this.options.commands?.get(payload.name);
          if (requestHandler) {
            this.processTask(requestHandler, payload);
          } else {
            this.log.warn(`[${LOG_TAG}] unknown request: ${payload.id}.${payload.name}`, LoggerScope.Debug);
            this.error(payload, 'unknown request');
          }
        } else {
          const requestHandler = this.requestHandlers.get(payload.name);
          if (requestHandler) {
            this.processResponse(requestHandler, payload, (error) => this.handleError(payload, error));
          } else {
            this.log.warn(`[${LOG_TAG}] unknown request: ${payload.id}.${payload.name}`, LoggerScope.Debug);
            this.error(payload, 'unknown request');
          }
        }
        break;
      case PayloadType.Response:
        if (payload.error.trim().length === 0) {
          this.log.info(`<- response: ${payload.id}.${payload.name}, data: ${payload.data}`, LoggerScope.Debug);
        } else {
          this.log.info(`<- error: ${payload.id}.${payload.name}, error: ${payload.error}, data: ${payload.data}`, LoggerScope.Debug);
        }
        const responseCallback = this.responseCallbacks.get(payload.id);
        if (responseCallback) {
          this.removeRequest(payload.id);
          this.processResponse(responseCallback, payload);
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
    if (this.isClosed) {
      return;
    }
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
    try {
      const state = this.options.validator.verifyHandshake(block.body);
      this.log.info(`[${LOG_TAG}] handshake validation state: ${state}, data: ${block.body}`, LoggerScope.Debug);
      if (state === ValidatorState.Success) {
        this.acknowledge(this.options.validator.acknowledgement(block.body));
        return;
      }
    } catch (error) {
      this.log.error(`[${LOG_TAG}] handshake validation failed: ${error}`, LoggerScope.Debug);
    }
    this.kick(DisconnectReason.Handshake);
  }

  /**
   * Process acknowledgement
   *
   * @param {BlockData} block Acknowledgement data
   */
  onAcknowledgement(block: BlockData): void {
    this.log.info(`<- acknowledge`, LoggerScope.Debug);
    this.pulse.reset();
    try {
      const state = this.options.validator.verifyAcknowledgement(block.body);
      this.log.info(`[${LOG_TAG}] acknowledgement data: ${block.body}, validation state: ${state}`, LoggerScope.Debug);
      if (state !== ValidatorState.Success) {
        this.reason = DisconnectReason.Handshake;
        this.disconnect();
        return;
      }
      if (this.mode === CommanderMode.Bot) {
        this.acknowledge(this.options.validator.acknowledgement(block.body));
      }
    } catch (error) {
      this.log.error(`[${LOG_TAG}] acknowledgement validation failed: ${error}`, LoggerScope.Debug);
      this.reason = DisconnectReason.Handshake;
      this.disconnect();
      return;
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
    const shouldNotifyDisconnect = !this.isClosed;
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
    this.clear();
    this.protocol.destroy();
    if (shouldNotifyDisconnect) {
      this.onDisconnect(this.reason);
    }
  }
}
