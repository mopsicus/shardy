import { Logger } from './Logger';
import { Commander, CommanderMode, DisconnectReason, ResponseType } from './Commander';
import { PayloadData } from './Payload';
import { Service, ServiceOptions } from './Service';
import { Connection } from './Connection';

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
  public onDisconnect: (id: string, reason: DisconnectReason) => void = () => {};

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
   * @param {string} id Connection ID
   * @param {Logger} log Current logger
   * @param {Service} service Service instance
   * @param {ServiceOptions} options Service options
   * @param {CommanderMode} mode Commander mode for service or bot
   */
  constructor(
    private connection: Connection,
    public id: string,
    public log: Logger,
    private service: Service,
    private options: ServiceOptions,
    private mode: CommanderMode = CommanderMode.Service,
  ) {
    this.commander = new Commander(this.id, this.connection, this.service, this.options, this.log, this.mode);
    this.commander.onDisconnect = (reason: DisconnectReason) => {
      this.isConnected = false;
      this.onDisconnect(this.id, reason);
    };
    this.commander.onReady = () => this.onReady();
    this.connection.setLogger(this.log);
  }

  /**
   * Send command (event) to server
   *
   * @param {string} command Command name
   * @param {Buffer} [data] Payload data
   */
  async command(command: string, data?: Buffer): Promise<void> {
    this.commander.command(command, data);
  }

  /**
   * Send request to server and wait response
   *
   * @param {string} request Request name
   * @param {Buffer} data Payload data
   */
  async fetch(request: string, data?: Buffer): Promise<PayloadData> {
    return this.commander.fetch(request, data);
  }

  /**
   * Send request to server and wait response in callback
   * Return request id, it may be canceled
   *
   * @param {string} request Request name
   * @param {ResponseType} callback Callback with response
   * @param {Buffer} data Payload data
   */
  async request(request: string, callback: ResponseType, data?: Buffer): Promise<number> {
    return this.commander.request(request, callback, data);
  }

  /**
   * Send response on request
   *
   * @param {PayloadData} request Request from with id, etc
   * @param {Buffer} [data] Data to send
   */
  async response(request: PayloadData, data?: Buffer): Promise<void> {
    this.commander.response(request, data);
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
   * @param {Buffer} [body] Custom data for handshake
   */
  async handshake(body?: Buffer): Promise<void> {
    this.commander.handshake(this.options.validator.handshake(body));
  }

  /**
   * Cancel request
   *
   * @param {number} id Request id
   */
  async cancel(id: number): Promise<void> {
    this.commander.cancelRequest(id);
  }

  /**
   *  Subscribe on command from server
   *
   * @param {string} command Command name
   * @param {ResponseType} callback Callback to subscribe
   */
  async on(command: string, callback: ResponseType): Promise<void> {
    this.commander.addCommand(command, callback);
  }

  /**
   * Unsubscribe from command
   * If callback is null -> clear all of them
   *
   * @param {string} command Command name
   * @param {ResponseType} callback Callback to unsubscribe
   */
  async off(command: string, callback?: ResponseType): Promise<void> {
    this.commander.cancelCommand(command, callback);
  }

  /**
   *  Subscribe on request from server that wait response
   *
   * @param {string} request Request name
   * @param {ResponseType} callback Callback to subscribe
   */
  async onRequest(request: string, callback: ResponseType): Promise<void> {
    this.commander.addOnRequest(request, callback);
  }

  /**
   * Unsubscribe on request from server that wait response
   *
   * @param {string} request Request name
   */
  async offRequest(request: string): Promise<void> {
    this.commander.cancelOnRequest(request);
  }

  /**
   * Destroy
   */
  async destroy(): Promise<void> {
    this.commander.destroy();
    this.log.destroy();
  }
}
