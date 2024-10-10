import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Socket, Server as SocketServer } from 'net';
import { Logger, LoggerFilter, LoggerScope } from './Logger';
import { Tools } from './Tools';
import { Service, ServiceOptions } from './Service';
import { Client } from './Client';
import { TransportType } from './Transport';
import { Connection } from './Connection';
import { DisconnectReason } from './Commander';
import http from 'http';

/**
 * Tag for logs
 */
const LOG_TAG = Tools.getTag(module);

/**
 * Length for id
 */
const ID_LENGTH = 10;

/**
 * Event for new connection
 */
const CONNECTION_EVENT = 'connection';

/**
 * Event when server run
 */
const LISTENING_EVENT = 'listening';

/**
 * Event when error occurs
 */
const ERROR_EVENT = 'error';

/**
 * Event when server close
 */
const CLOSE_EVENT = 'close';

/**
 * Event when app get uncaught expeption
 */
const UNCAUGHT_EXCEPTIONS = 'uncaughtException';

/**
 * Event when app get unhandled rejection
 */
const UNHANDLED_REJECTION = 'unhandledRejection';

/**
 * Socket type
 */
export type SocketType = Socket | WebSocket;

/**
 * Server type
 */
export type ServerType = SocketServer | WebSocketServer;

/**
 * Server class
 * Controls all connection
 * Pass events to service
 *
 * @export
 * @class Server
 */
export class Server {
  /**
   * Logger instance
   *
   * @type {Logger}
   */
  log: Logger = new Logger([], Tools.getTag(module));

  /**
   * Server instance
   *
   * @type {ServerType}
   */
  private server: ServerType;

  /**
   * List of connected
   *
   * @private
   * @type {Map<string, Client>}
   */
  private list: Map<string, Client> = new Map<string, Client>();

  /**
   * HTTP server for Websocket server
   *
   * @private
   * @type {http.Server}
   */
  private http: http.Server;

  /**
   * Creates an instance of Server
   *
   * @param {string} host Server host
   * @param {number} port Server port
   * @param {Service} service Service instance
   * @param {ServiceOptions} options Service options
   */
  constructor(
    private host: string,
    private port: number,
    private service: Service,
    private options: ServiceOptions,
  ) {
    this.catchExceptions();
    this.http = http.createServer();
    this.server = this.service.transport === TransportType.TCP ? new SocketServer() : new WebSocketServer({ server: this.http });
    this.server.on(CONNECTION_EVENT, (socket: SocketType, message: IncomingMessage) => this.onConnect(socket, message));
    this.server.on(LISTENING_EVENT, () => this.onListening());
    this.server.on(ERROR_EVENT, (error: Error) => this.onError(error));
    this.server.on(CLOSE_EVENT, () => this.onClose());
  }

  /**
   * Start listening server
   */
  async start(): Promise<void> {
    this.log.info(`${this.service.name} (${this.service.transport}) start`, LoggerScope.System);
    switch (this.service.transport) {
      case TransportType.TCP:
        (this.server as SocketServer).listen(this.port, this.host);
        break;
      case TransportType.WebSocket:
        this.http.listen(this.port, this.host);
      default:
        break;
    }
  }

  /**
   * Stop server
   */
  async stop(): Promise<void> {
    this.log.info(`stop`, LoggerScope.System);
    this.list.forEach((client: Client) => {
      client.kick(DisconnectReason.ServerDown);
    });
    this.list.clear();
    switch (this.service.transport) {
      case TransportType.TCP:
        (this.server as SocketServer).close();
        break;
      case TransportType.WebSocket:
        this.http.close();
      default:
        break;
    }
  }

  /**
   * Set filter for all connected clients
   *
   * @param {LoggerFilter} filter Filter data
   */
  async setFilter(filter: LoggerFilter): Promise<void> {
    this.log.setFilter(filter);
    this.list.forEach((client: Client) => {
      client.log.setFilter(filter);
    });
  }

  /**
   * Clear all log filters for all connected clients
   */
  async clearFilter(): Promise<void> {
    this.log.clearFilter();
    this.list.forEach((client: Client) => {
      client.log.clearFilter();
    });
  }

  /**
   * Event when client connected to server
   *
   * @private
   * @param {SocketType} socket Connected instance for server
   * @param {IncomingMessage} message Incoming message for websockets
   */
  private onConnect(socket: SocketType, message: IncomingMessage): void {
    const ip = message ? message.socket.remoteAddress! : (socket as Socket).remoteAddress!;
    const id = Tools.generateId(ID_LENGTH);
    const logger = new Logger([id, ip]);
    logger.setFilter(this.log.getFilter());
    const client = new Client(new Connection(socket, this.service.transport), id, logger, this.service, this.options);
    client.onDisconnect = (id: string, reason: DisconnectReason) => this.onDisconnect(id, reason);
    client.onReady = () => this.service.onReady(client);
    this.list.set(id, client);
    this.service.onConnect(client);
    this.log.info(`[${LOG_TAG}] connected ${id}|${ip}`, LoggerScope.Debug);
  }

  /**
   * Event on server run
   *
   * @private
   */
  private onListening(): void {
    this.service.onListening(this.host, this.port);
    this.log.info(`listening on ${this.host}:${this.port}`, LoggerScope.System);
  }

  /**
   * Event on server throw error
   *
   * @private
   */
  private onError(error: Error): void {
    this.service.onError(error);
    this.log.error(`error: ${error}`, LoggerScope.System);
  }

  /**
   * Event on server close
   *
   * @private
   */
  private onClose(): void {
    this.service.onClose();
    this.log.info(`closed`, LoggerScope.System);
  }

  /**
   * Event when client disconnected
   *
   * @private
   * @param {string} id Client connection id
   * @param {DisconnectReason} reason Reason for disconnect
   */
  private onDisconnect(id: string, reason: DisconnectReason): void {
    const client = this.list.get(id)!;
    this.service.onDisconnect(client, reason);
    client.destroy();
    this.list.delete(id);
    this.log.info(`[${LOG_TAG}] disconnected ${id}`, LoggerScope.Debug);
  }

  /**
   * Event when get exception
   *
   * @param {Error} error Unexpected exception
   */
  private onException(error: Error): void {
    new Logger([], Tools.getTag(module)).error(`unexpected exception: ${error.stack}`, LoggerScope.All);
  }

  /**
   * Register handlers for exceptions
   */
  private catchExceptions(): void {
    process.on(UNCAUGHT_EXCEPTIONS, this.onException);
    process.on(UNHANDLED_REJECTION, this.onException);
  }
}
