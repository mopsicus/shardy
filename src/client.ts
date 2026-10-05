import { Logger } from './logger';
import { Commander, CommanderMode, DisconnectReason, ResponseCallback } from './commander';
import { PayloadData } from './payload';
import { Service, ServiceOptions } from './service';
import { Connection } from './connection';

/**
 * Client class connected to server
 *
 * @export
 * @class Client
 */
export class Client {
  /**
   * Callback on disconnect
   */
  public onDisconnect: (connectionId: string, reason: DisconnectReason) => void = () => {};

  /**
   * Callback when ready for work
   */
  public onReady: () => void = () => {};

  /**
   * Current connection status
   *
   * @type {boolean}
   */
  isConnected: boolean = true;

  /**
   * Client commander
   *
   * @type {Commander}
   */
  private commander: Commander;

  /**
   * Creates an instance of Client
   *
   * @param {Connection} connection Current connection
   * @param {string} connectionId Connection ID
   * @param {Logger} log Current logger
   * @param {Service} service Service instance
   * @param {ServiceOptions} options Service options
   * @param {CommanderMode} mode Commander mode for service or bot
   */
  constructor(
    private connection: Connection,
    public connectionId: string,
    public log: Logger,
    private service: Service,
    private options: ServiceOptions,
    private mode: CommanderMode = CommanderMode.Service,
  ) {
    this.commander = new Commander(this.connectionId, this.connection, this.service, this.options, this.log, this.mode);
    this.commander.onDisconnect = (reason: DisconnectReason) => {
      this.isConnected = false;
      this.onDisconnect(this.connectionId, reason);
    };
    this.commander.onReady = () => this.onReady();
    this.connection.setLogger(this.log);
  }

  /**
   * Send command (event) to server
   *
   * @param {string} commandName Command name
   * @param {Buffer} [commandPayload] Command payload bytes
   */
  async command(commandName: string, commandPayload?: Buffer): Promise<void> {
    this.commander.command(commandName, commandPayload);
  }

  /**
   * Send request to server and wait response
   *
   * @param {string} requestName Request name
   * @param {Buffer} requestPayload Request payload bytes
   */
  async fetch(requestName: string, requestPayload?: Buffer): Promise<PayloadData> {
    return this.commander.fetch(requestName, requestPayload);
  }

  /**
   * Send request to server and wait response in callback
   * Return request id, it may be canceled
   *
   * @param {string} requestName Request name
   * @param {ResponseCallback} responseCallback Callback with response
   * @param {Buffer} requestPayload Request payload bytes
   */
  async request(requestName: string, responseCallback: ResponseCallback, requestPayload?: Buffer): Promise<number> {
    return this.commander.request(requestName, responseCallback, requestPayload);
  }

  /**
   * Send response on request
   *
   * @param {PayloadData} requestPayload Request received from the peer
   * @param {Buffer} [responsePayload] Response payload bytes
   */
  async response(requestPayload: PayloadData, responsePayload?: Buffer): Promise<void> {
    this.commander.response(requestPayload, responsePayload);
  }

  /**
   * Send error on request
   *
   * @param {PayloadData} requestPayload Request received from the peer
   * @param {string} errorMessage Error message or code
   * @param {Buffer} [responsePayload] Response payload bytes
   */
  async error(requestPayload: PayloadData, errorMessage: string, responsePayload?: Buffer): Promise<void> {
    this.commander.error(requestPayload, errorMessage, responsePayload);
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    this.commander.disconnect();
  }

  /**
   * Kick from server
   */
  async kick(reason: DisconnectReason): Promise<void> {
    this.commander.kick(reason);
  }

  /**
   * Handshake to verify connection
   *
   * @param {Buffer} [handshakePayload] Custom handshake payload
   */
  async handshake(handshakePayload?: Buffer): Promise<void> {
    this.commander.handshake(this.options.validator.handshake(handshakePayload));
  }

  /**
   * Cancel request
   *
   * @param {number} requestId Request id
   */
  async cancel(requestId: number): Promise<void> {
    this.commander.cancelRequest(requestId);
  }

  /**
   *  Subscribe on command from server
   *
   * @param {string} commandName Command name
   * @param {ResponseCallback} commandHandler Handler for the subscribed command
   */
  async on(commandName: string, commandHandler: ResponseCallback): Promise<void> {
    this.commander.addCommand(commandName, commandHandler);
  }

  /**
   * Unsubscribe from command
   * If no handler is supplied, clear all handlers
   *
   * @param {string} commandName Command name
   * @param {ResponseCallback} commandHandler Handler to unsubscribe
   */
  async off(commandName: string, commandHandler?: ResponseCallback): Promise<void> {
    this.commander.cancelCommand(commandName, commandHandler);
  }

  /**
   *  Subscribe on request from server that wait response
   *
   * @param {string} requestName Request name
   * @param {ResponseCallback} requestHandler Handler for the subscribed request
   */
  async onRequest(requestName: string, requestHandler: ResponseCallback): Promise<void> {
    this.commander.addOnRequest(requestName, requestHandler);
  }

  /**
   * Unsubscribe on request from server that wait response
   *
   * @param {string} requestName Request name
   */
  async offRequest(requestName: string): Promise<void> {
    this.commander.cancelOnRequest(requestName);
  }

  /**
   * Destroy
   */
  async destroy(): Promise<void> {
    this.commander.destroy();
    await this.log.destroy();
  }
}
