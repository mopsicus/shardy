import ip from 'ip';
import net from 'net';
import { WebSocket } from 'ws';
import { Logger } from './Logger';
import { Client } from './Client';
import { TransportType } from './Transport';
import { CommanderMode, DisconnectReason, ResponseType } from './Commander';
import { PayloadData } from './Payload';
import { Service, ServiceOptions } from './Service';
import { Connection } from './Connection';
import { Tools } from './Tools';

/**
 * Length for id
 */
const ID_LENGTH = 10;

/**
 * Bot class to connect to services as client
 *
 * @export
 * @class Bot
 */
export class Bot {
  /**
   * Callback on disconnect
   */
  public onDisconnect: (reason: DisconnectReason) => void = () => {};

  /**
   * Callback on connect
   */
  public onConnect: () => void = () => {};

  /**
   * Callback when bot ready for work
   */
  public onReady: () => void = () => {};

  /**
   * Logger instance
   *
   * @type {Logger}
   */
  log: Logger = new Logger([]);

  /**
   * Current connection status
   *
   * @type {boolean}
   */
  isConnected: boolean = false;

  /**
   * Client instance
   *
   * @type {Client}
   */
  private client!: Client;

  /**
   * Client connection
   *
   * @private
   * @type {Connection}
   */
  private connection!: Connection;

  /**
   * Creates an instance of Bot
   *
   * @param {string} host Server host
   * @param {number} port Server port
   * @param {TransportType} transport Trasport type
   * @param {ServiceOptions} options Service options
   * @param {Buffer} [handshakeBody] Handshake data
   */
  constructor(
    private host: string,
    private port: number,
    private transport: TransportType,
    private options: ServiceOptions,
    private handshakeBody?: Buffer,
  ) {}

  /**
   * Start bot, begin connect
   */
  async start(): Promise<void> {
    const socket = this.transport === TransportType.TCP ? net.connect(this.port, this.host, () => this.onClientConnect()) : new WebSocket(`ws://${this.host}:${this.port}`);
    this.connection = new Connection(socket, this.transport);
    this.connection.onConnect = () => this.onClientConnect();
  }

  /**
   * Send command (event) to server
   *
   * @param {string} command Command name
   * @param {Buffer} data Payload data
   */
  async command(command: string, data?: Buffer): Promise<void> {
    return this.client.command(command, data);
  }

  /**
   * Send request to server and wait response
   *
   * @param {string} request Request name
   * @param {Buffer} data Payload data
   */
  async fetch(request: string, data?: Buffer): Promise<PayloadData> {
    return this.client.fetch(request, data);
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
    return this.client.request(request, callback, data);
  }

  /**
   * Send response on request
   *
   * @param {PayloadData} request Request from with id, etc
   * @param {Buffer} [data] Data to send
   */
  async response(request: PayloadData, data?: Buffer): Promise<void> {
    this.client.response(request, data);
  }

  /**
   *  Subscribe on command from server
   *
   * @param {string} command Command name
   * @param {ResponseType} callback Callback to subscribe
   */
  async on(command: string, callback: ResponseType): Promise<void> {
    this.client.on(command, callback);
  }

  /**
   * Unsubscribe from command
   * If callback is null -> clear all of them
   *
   * @param {string} command Command name
   * @param {ResponseType} callback Callback to unsubscribe
   */
  async off(command: string, callback?: ResponseType): Promise<void> {
    this.client.off(command, callback);
  }

  /**
   * Cancel request
   *
   * @param {number} id Request id
   */
  async cancel(id: number): Promise<void> {
    this.client.cancel(id);
  }

  /**
   *  Subscribe on request from server that wait response
   *
   * @param {string} request Request name
   * @param {ResponseType} callback Callback
   */
  async onRequest(request: string, callback: ResponseType): Promise<void> {
    this.client.onRequest(request, callback);
  }

  /**
   * Unsubscribe from request from server that wait response
   *
   * @param {string} request Rommand name
   */
  async offRequest(request: string): Promise<void> {
    this.client.offRequest(request);
  }

  /**
   * Start client handshake
   *
   * @param {Buffer} [body] Custom data for handshake
   */
  async handshake(body?: Buffer): Promise<void> {
    this.client.handshake(body);
  }

  /**
   * Disconnect from server
   */
  async disconnect(): Promise<void> {
    this.client.disconnect();
  }

  /**
   * Destroy bot
   */
  async destroy(): Promise<void> {
    this.client.destroy();
  }

  /**
   * Event when connected
   */
  private onClientConnect(): void {
    const id = Tools.generateId(ID_LENGTH);
    this.log.setLabel([id, ip.address()]);
    this.isConnected = true;
    this.client = new Client(this.connection, id, this.log, {} as Service, this.options, CommanderMode.Bot);
    this.client.onDisconnect = (id: string, reason: DisconnectReason) => this.onClientDisconnect(reason);
    this.client.onReady = () => this.onReady();
    this.onConnect();
    if (this.handshakeBody) {
      this.handshake(this.handshakeBody);
    }
  }

  /**
   * Event when client disconnected
   *
   * @private
   * @param {DisconnectReason} reason Reason for disconnect
   */
  private onClientDisconnect(reason: DisconnectReason): void {
    this.isConnected = false;
    this.onDisconnect(reason);
  }
}
