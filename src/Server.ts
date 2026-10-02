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
import { Extension, ExtensionMode } from './Extension';
import { Block, MAX_BLOCK_SIZE, DEFAULT_BLOCK_SIZE } from './Block';
import http from 'http';
import { once } from 'events';

/**
 * Length for id
 */
const ID_LENGTH = 10;

/**
 * Default maximum pending handshakes
 */
const MAX_PENDINGS = 64;

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
   * @type {Map<string, Client>}
   */
  private list: Map<string, Client> = new Map<string, Client>();

  /**
   * Pending handshakes set
   *
   * @type {Set<string>}
   */
  private pendings: Set<string> = new Set<string>();

  /**
   * Maximum number of pending handshakes
   *
   * @type {number}
   */
  private limit: number;

  /**
   * Client lifecycles map
   *
   * @type {Map<string, Promise<void>>}
   */
  private lifecycles: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  /**
   * Disconnecting clients set
   *
   * @type {Set<string>}
   */
  private disconnecting: Set<string> = new Set<string>();

  /**
   * Server stop lifecycle promise
   *
   * @type {Promise<void>}
   */
  private stopAction?: Promise<void>;

  /**
   * Server close lifecycle promise
   *
   * @type {Promise<void>}
   */
  private closeAction: Promise<void> = Promise.resolve();

  /**
   * Extensions array (before)
   *
   * @type {Array<Extension>}
   */
  private extensionsBefore: Array<Extension> = new Array<Extension>();

  /**
   * Extensions array (after)
   *
   * @type {Array<Extension>}
   */
  private extensionsAfter: Array<Extension> = new Array<Extension>();

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
    this.limit = this.options.pendings ?? MAX_PENDINGS;
    this.http = http.createServer();
    this.server = this.service.transport === TransportType.TCP ? new SocketServer() : new WebSocketServer({ server: this.http });
    if (!Block.validate(this.options.block ?? DEFAULT_BLOCK_SIZE)) {
      this.log.error(`block size must be an integer between 0 and ${MAX_BLOCK_SIZE}`, LoggerScope.System);
      return;
    }
    this.server.on(CONNECTION_EVENT, (socket: SocketType, message: IncomingMessage) => this.onConnect(socket, message));
    this.server.on(LISTENING_EVENT, () => this.onListening());
    this.server.on(ERROR_EVENT, (error: Error) => this.onError(error));
    this.server.on(CLOSE_EVENT, () => {
      this.closeAction = this.onClose();
    });
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
    if (!this.stopAction) {
      this.stopAction = this.stopInner();
    }
    return this.stopAction;
  }

  /**
   * Stop server internal method
   *
   * @private
   * @returns {Promise<void>}
   */
  private async stopInner(): Promise<void> {
    this.log.info(`stop`, LoggerScope.System);
    this.list.forEach((client: Client) => {
      client.kick(DisconnectReason.ServerDown);
    });
    switch (this.service.transport) {
      case TransportType.TCP:
        if ((this.server as SocketServer).listening) {
          const closed = once(this.server, CLOSE_EVENT);
          (this.server as SocketServer).close();
          await closed;
        }
        break;
      case TransportType.WebSocket:
        {
          const closed = once(this.server, CLOSE_EVENT);
          (this.server as WebSocketServer).close();
          if (this.http.listening) {
            this.http.close();
          }
          await closed;
        }
        break;
      default:
        break;
    }
    await Promise.all(this.lifecycles.values());
    await this.closeAction;
    await this.log.destroy();
  }

  /**
   * Use extension for service
   *
   * @param extension Extension instance
   */
  async use(extension: Extension): Promise<void> {
    if (extension.mode === ExtensionMode.Before) {
      const index = this.extensionsBefore.indexOf(extension, 0);
      if (index < 0) {
        await extension.init();
        this.extensionsBefore.push(extension);
      }
    } else {
      const index = this.extensionsAfter.indexOf(extension, 0);
      if (index < 0) {
        await extension.init();
        this.extensionsAfter.push(extension);
      }
    }
    this.log.info(`use extension ${extension.name}`, LoggerScope.System);
  }

  /**
   * Set filter for all connected clients and extensions
   *
   * @param {LoggerFilter} filter Filter data
   */
  async setFilter(filter: LoggerFilter): Promise<void> {
    this.log.setFilter(filter);
    this.list.forEach((client: Client) => {
      client.log.setFilter(filter);
    });
    this.extensionsBefore.forEach((extension: Extension) => {
      extension.log.setFilter(filter);
    });
    this.extensionsAfter.forEach((extension: Extension) => {
      extension.log.setFilter(filter);
    });
  }

  /**
   * Clear all log filters for all connected clients and extensions
   */
  async clearFilter(): Promise<void> {
    this.log.clearFilter();
    this.list.forEach((client: Client) => {
      client.log.clearFilter();
    });
    this.extensionsBefore.forEach((extension: Extension) => {
      extension.log.clearFilter();
    });
    this.extensionsAfter.forEach((extension: Extension) => {
      extension.log.clearFilter();
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
    if (this.pendings.size >= this.limit) {
      this.log.warn(`pendings limit reached: ${this.limit}`, LoggerScope.System);
      if (this.service.transport === TransportType.TCP) {
        (socket as Socket).destroy();
      } else {
        (socket as WebSocket).terminate();
      }
      return;
    }
    const ip = message ? message.socket.remoteAddress! : (socket as Socket).remoteAddress!;
    const id = Tools.generateId(ID_LENGTH);
    const logger = new Logger([id, ip]);
    logger.setFilter(this.log.getFilter());
    const client = new Client(new Connection(socket, this.service.transport), id, logger, this.service, this.options);
    client.onDisconnect = (id: string, reason: DisconnectReason) => this.onDisconnect(id, reason);
    client.onReady = () => this.onReady(client);
    this.list.set(id, client);
    this.pendings.add(id);
    this.addHooks(
      id,
      this.extensionsBefore
        .map((item) => () => item.onClientConnect(client))
        .concat([() => this.service.onConnect(client)])
        .concat(this.extensionsAfter.map((item) => () => item.onClientConnect(client))),
    );
    this.log.info(`connected ${id}|${ip}`, LoggerScope.Debug);
  }

  /**
   * Event on server run
   *
   * @private
   */
  private async onListening(): Promise<void> {
    const hooks = this.extensionsBefore.map((item) => () => item.onServiceListening());
    hooks.push(() => this.service.onListening(this.host, this.port));
    hooks.push(...this.extensionsAfter.map((item) => () => item.onServiceListening()));
    this.log.info(`listening on ${this.host}:${this.port}`, LoggerScope.System);
    await this.processHooks(hooks);
  }

  /**
   * Event on server throw error
   *
   * @private
   */
  private onError(error: Error): void {
    this.log.error(`error: ${error}`, LoggerScope.System);
    void this.processHooks([() => this.service.onError(error)]);
  }

  /**
   * Event on server close
   *
   * @private
   */
  private async onClose(): Promise<void> {
    const hooks = this.extensionsBefore.map((item) => () => item.onServiceClose());
    hooks.push(() => this.service.onClose());
    hooks.push(...this.extensionsAfter.map((item) => () => item.onServiceClose()));
    this.log.info(`closed`, LoggerScope.System);
    await this.processHooks(hooks);
  }

  /**
   * Event when client ready for work
   *
   * @private
   * @param {Client} client Client instance
   */
  private onReady(client: Client): void {
    this.pendings.delete(client.id);
    this.addHooks(
      client.id,
      this.extensionsBefore
        .map((item) => () => item.onClientReady(client))
        .concat([() => this.service.onReady(client)])
        .concat(this.extensionsAfter.map((item) => () => item.onClientReady(client))),
    );
  }

  /**
   * Event when client disconnected
   *
   * @private
   * @param {string} id Client connection id
   * @param {DisconnectReason} reason Reason for disconnect
   */
  private onDisconnect(id: string, reason: DisconnectReason): void {
    this.pendings.delete(id);
    const client = this.list.get(id);
    if (!client || this.disconnecting.has(id)) {
      return;
    }
    this.disconnecting.add(id);
    const hooks = this.extensionsBefore.map((item) => () => item.onClientDisconnect(client, reason));
    hooks.push(() => this.service.onDisconnect(client, reason));
    hooks.push(...this.extensionsAfter.map((item) => () => item.onClientDisconnect(client, reason)));
    const previous = this.lifecycles.get(id) ?? Promise.resolve();
    const lifecycle = previous.then(async () => {
      await this.processHooks(hooks);
      try {
        await client.destroy();
      } catch (error) {
        this.log.error(`disconnect cleanup failed: ${error}`, LoggerScope.System);
      }
      this.list.delete(id);
      this.lifecycles.delete(id);
      this.disconnecting.delete(id);
      this.log.info(`disconnected ${id}`, LoggerScope.Debug);
    });
    this.lifecycles.set(id, lifecycle);
    void lifecycle.catch((error) => this.log.error(`disconnect lifecycle failed: ${error}`, LoggerScope.System));
  }

  /**
   * Add lifecycle hooks for a client
   *
   * @private
   * @param {string} id Client connection id
   * @param {Array<() => Promise<void>>} hooks Array of lifecycle hooks
   */
  private addHooks(id: string, hooks: Array<() => Promise<void>>): void {
    const previous = this.lifecycles.get(id) ?? Promise.resolve();
    const lifecycle = previous.then(() => this.processHooks(hooks));
    this.lifecycles.set(id, lifecycle);
    void lifecycle.catch((error) => this.log.error(`lifecycle failed: ${error}`, LoggerScope.System));
  }

  /**
   * Process an array of lifecycle hooks
   *
   * @private
   * @param {Array<() => Promise<void>>} hooks Array of lifecycle hooks
   */
  private async processHooks(hooks: Array<() => Promise<void>>): Promise<void> {
    for (const hook of hooks) {
      try {
        await hook();
      } catch (error) {
        this.log.error(`process hooks failed: ${error}`, LoggerScope.System);
      }
    }
  }
}
