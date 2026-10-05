import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Socket, Server as SocketServer } from 'net';
import { Logger, LoggerFilter, LoggerScope } from './logger';
import { Tools } from './tools';
import { Service, ServiceOptions } from './service';
import { Client } from './client';
import { TransportType } from './transport';
import { Connection, DEFAULT_SEND_BYTES } from './connection';
import { DisconnectReason } from './commander';
import { Extension, ExtensionMode } from './extension';
import { Block, MAX_BLOCK_SIZE, DEFAULT_BLOCK_SIZE } from './block';
import http from 'http';
import { once } from 'events';

/**
 * Length for id
 */
const ID_LENGTH = 10;

/**
 * Default maximum pending handshakes
 */
const MAX_PENDING_HANDSHAKES = 64;

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
   * Connected clients indexed by connection ID
   *
   * @type {Map<string, Client>}
   */
  private clients: Map<string, Client> = new Map<string, Client>();

  /**
   * Pending handshakes set
   *
   * @type {Set<string>}
   */
  private pendingHandshakes: Set<string> = new Set<string>();

  /**
   * Maximum number of pending handshakes
   *
   * @type {number}
   */
  private maxPendingHandshakes: number;

  /**
   * Client lifecycles map
   *
   * @type {Map<string, Promise<void>>}
   */
  private clientLifecycles: Map<string, Promise<void>> = new Map<string, Promise<void>>();

  /**
   * Disconnecting clients set
   *
   * @type {Set<string>}
   */
  private disconnectingClients: Set<string> = new Set<string>();

  /**
   * Server stop lifecycle promise
   *
   * @type {Promise<void>}
   */
  private stopPromise?: Promise<void>;

  /**
   * Server close lifecycle promise
   *
   * @type {Promise<void>}
   */
  private closeLifecyclePromise: Promise<void> = Promise.resolve();

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
  private httpServer: http.Server;

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
    this.maxPendingHandshakes = this.options.pendings ?? MAX_PENDING_HANDSHAKES;
    this.httpServer = http.createServer();
    this.server = this.service.transport === TransportType.TCP ? new SocketServer() : new WebSocketServer({ server: this.httpServer });
    if (!Block.validate(this.options.block ?? DEFAULT_BLOCK_SIZE)) {
      this.log.error(`block size must be an integer between 0 and ${MAX_BLOCK_SIZE}`, LoggerScope.System);
      return;
    }
    if (!Connection.validate(this.options.bytes ?? DEFAULT_SEND_BYTES)) {
      this.log.error('max send bytes must be a positive safe integer', LoggerScope.System);
      return;
    }
    this.server.on(CONNECTION_EVENT, (socket: SocketType, handshakeRequest: IncomingMessage) => this.onConnect(socket, handshakeRequest));
    this.server.on(LISTENING_EVENT, () => this.onListening());
    this.server.on(ERROR_EVENT, (error: Error) => this.onError(error));
    this.server.on(CLOSE_EVENT, () => {
      this.closeLifecyclePromise = this.onClose();
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
        this.httpServer.listen(this.port, this.host);
      default:
        break;
    }
  }

  /**
   * Stop server
   */
  async stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.shutdownServer();
    }
    return this.stopPromise;
  }

  /**
   * Stop the server and wait for client cleanup
   *
   * @private
   * @returns {Promise<void>}
   */
  private async shutdownServer(): Promise<void> {
    this.log.info(`stop`, LoggerScope.System);
    this.clients.forEach((client: Client) => {
      client.kick(DisconnectReason.ServerDown);
    });
    switch (this.service.transport) {
      case TransportType.TCP:
        if ((this.server as SocketServer).listening) {
          const serverClosePromise = once(this.server, CLOSE_EVENT);
          (this.server as SocketServer).close();
          await serverClosePromise;
        }
        break;
      case TransportType.WebSocket:
        {
          const serverClosePromise = once(this.server, CLOSE_EVENT);
          (this.server as WebSocketServer).close();
          if (this.httpServer.listening) {
            this.httpServer.close();
          }
          await serverClosePromise;
        }
        break;
      default:
        break;
    }
    await Promise.all(this.clientLifecycles.values());
    await this.closeLifecyclePromise;
    await this.log.destroy();
  }

  /**
   * Use extension for service
   *
   * @param extension Extension instance
   */
  async use(extension: Extension): Promise<void> {
    if (extension.mode === ExtensionMode.Before) {
      const extensionIndex = this.extensionsBefore.indexOf(extension, 0);
      if (extensionIndex < 0) {
        await extension.init();
        this.extensionsBefore.push(extension);
      }
    } else {
      const extensionIndex = this.extensionsAfter.indexOf(extension, 0);
      if (extensionIndex < 0) {
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
    this.clients.forEach((client: Client) => {
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
    this.clients.forEach((client: Client) => {
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
   * @param {SocketType} socket Connected socket
   * @param {IncomingMessage} handshakeRequest Incoming HTTP request for WebSocket connections
   */
  private onConnect(socket: SocketType, handshakeRequest: IncomingMessage): void {
    if (this.pendingHandshakes.size >= this.maxPendingHandshakes) {
      this.log.warn(`pendings limit reached: ${this.maxPendingHandshakes}`, LoggerScope.System);
      if (this.service.transport === TransportType.TCP) {
        (socket as Socket).destroy();
      } else {
        (socket as WebSocket).terminate();
      }
      return;
    }
    const remoteAddress = handshakeRequest ? handshakeRequest.socket.remoteAddress! : (socket as Socket).remoteAddress!;
    const connectionId = Tools.generateId(ID_LENGTH);
    const clientLogger = new Logger([connectionId, remoteAddress]);
    clientLogger.setFilter(this.log.getFilter());
    const client = new Client(new Connection(socket, this.service.transport, this.options.bytes), connectionId, clientLogger, this.service, this.options);
    client.onDisconnect = (disconnectedClientId: string, reason: DisconnectReason) => this.onDisconnect(disconnectedClientId, reason);
    client.onReady = () => this.onReady(client);
    this.clients.set(connectionId, client);
    this.pendingHandshakes.add(connectionId);
    this.scheduleLifecycleHooks(
      connectionId,
      this.extensionsBefore
        .map((item) => () => item.onClientConnect(client))
        .concat([() => this.service.onConnect(client)])
        .concat(this.extensionsAfter.map((item) => () => item.onClientConnect(client))),
    );
    this.log.info(`connected ${connectionId}|${remoteAddress}`, LoggerScope.Debug);
  }

  /**
   * Event on server run
   *
   * @private
   */
  private async onListening(): Promise<void> {
    const lifecycleHooks = this.extensionsBefore.map((extension) => () => extension.onServiceListening());
    lifecycleHooks.push(() => this.service.onListening(this.host, this.port));
    lifecycleHooks.push(...this.extensionsAfter.map((extension) => () => extension.onServiceListening()));
    this.log.info(`listening on ${this.host}:${this.port}`, LoggerScope.System);
    await this.runLifecycleHooks(lifecycleHooks);
  }

  /**
   * Event on server throw error
   *
   * @private
   */
  private onError(error: Error): void {
    this.log.error(`error: ${error}`, LoggerScope.System);
    void this.runLifecycleHooks([() => this.service.onError(error)]);
  }

  /**
   * Event on server close
   *
   * @private
   */
  private async onClose(): Promise<void> {
    const lifecycleHooks = this.extensionsBefore.map((extension) => () => extension.onServiceClose());
    lifecycleHooks.push(() => this.service.onClose());
    lifecycleHooks.push(...this.extensionsAfter.map((extension) => () => extension.onServiceClose()));
    this.log.info(`closed`, LoggerScope.System);
    await this.runLifecycleHooks(lifecycleHooks);
  }

  /**
   * Event when client ready for work
   *
   * @private
   * @param {Client} client Client instance
   */
  private onReady(client: Client): void {
    this.pendingHandshakes.delete(client.id);
    this.scheduleLifecycleHooks(
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
   * @param {string} connectionId Client connection ID
   * @param {DisconnectReason} reason Reason for disconnect
   */
  private onDisconnect(connectionId: string, reason: DisconnectReason): void {
    this.pendingHandshakes.delete(connectionId);
    const client = this.clients.get(connectionId);
    if (!client || this.disconnectingClients.has(connectionId)) {
      return;
    }
    this.disconnectingClients.add(connectionId);
    const lifecycleHooks = this.extensionsBefore.map((extension) => () => extension.onClientDisconnect(client, reason));
    lifecycleHooks.push(() => this.service.onDisconnect(client, reason));
    lifecycleHooks.push(...this.extensionsAfter.map((extension) => () => extension.onClientDisconnect(client, reason)));
    const previousLifecycle = this.clientLifecycles.get(connectionId) ?? Promise.resolve();
    const clientLifecycle = previousLifecycle.then(async () => {
      await this.runLifecycleHooks(lifecycleHooks);
      try {
        await client.destroy();
      } catch (error) {
        this.log.error(`disconnect cleanup failed: ${error}`, LoggerScope.System);
      }
      this.clients.delete(connectionId);
      this.clientLifecycles.delete(connectionId);
      this.disconnectingClients.delete(connectionId);
      this.log.info(`disconnected ${connectionId}`, LoggerScope.Debug);
    });
    this.clientLifecycles.set(connectionId, clientLifecycle);
    void clientLifecycle.catch((error) => this.log.error(`disconnect lifecycle failed: ${error}`, LoggerScope.System));
  }

  /**
   * Add lifecycle hooks for a client
   *
   * @private
   * @param {string} connectionId Client connection ID
   * @param {Array<() => Promise<void>>} lifecycleHooks Client lifecycle hooks
   */
  private scheduleLifecycleHooks(connectionId: string, lifecycleHooks: Array<() => Promise<void>>): void {
    const previousLifecycle = this.clientLifecycles.get(connectionId) ?? Promise.resolve();
    const clientLifecycle = previousLifecycle.then(() => this.runLifecycleHooks(lifecycleHooks));
    this.clientLifecycles.set(connectionId, clientLifecycle);
    void clientLifecycle.catch((error) => this.log.error(`lifecycle failed: ${error}`, LoggerScope.System));
  }

  /**
   * Process an array of lifecycle hooks
   *
   * @private
   * @param {Array<() => Promise<void>>} lifecycleHooks Lifecycle hooks to run
   */
  private async runLifecycleHooks(lifecycleHooks: Array<() => Promise<void>>): Promise<void> {
    for (const lifecycleHook of lifecycleHooks) {
      try {
        await lifecycleHook();
      } catch (error) {
        this.log.error(`lifecycle hook failed: ${error}`, LoggerScope.System);
      }
    }
  }
}
