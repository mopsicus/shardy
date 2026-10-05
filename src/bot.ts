import net from 'net';
import os from 'node:os';
import { WebSocket } from 'ws';
import { Logger, LoggerScope } from './logger';
import { Client } from './client';
import { TransportType } from './transport';
import { CommanderMode, DisconnectReason, ResponseCallback } from './commander';
import { PayloadData } from './payload';
import { Service, ServiceOptions } from './service';
import { Connection, DEFAULT_SEND_BYTES } from './connection';
import { Tools } from './tools';
import { Block, DEFAULT_BLOCK_SIZE, MAX_BLOCK_SIZE } from './block';

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
   * @param {Buffer} [handshakePayload] Custom handshake payload
   */
  constructor(
    private host: string,
    private port: number,
    private transport: TransportType,
    private options: ServiceOptions,
    private handshakePayload?: Buffer,
  ) {
    if (!Block.validate(this.options.block ?? DEFAULT_BLOCK_SIZE)) {
      this.log.error(`[${Tools.getTag(module)}] block size must be an integer between 0 and ${MAX_BLOCK_SIZE}`, LoggerScope.System);
      return;
    }
    if (!Connection.validate(this.options.bytes ?? DEFAULT_SEND_BYTES)) {
      this.log.error(`[${Tools.getTag(module)}] max send bytes must be a positive safe integer`, LoggerScope.System);
      return;
    }
  }

  /**
   * Start bot, begin connect
   */
  async start(): Promise<void> {
    const socket = this.transport === TransportType.TCP ? net.connect(this.port, this.host, () => this.onClientConnect()) : new WebSocket(`ws://${this.host}:${this.port}`);
    this.connection = new Connection(socket, this.transport, this.options.bytes);
    this.connection.onConnect = () => this.onClientConnect();
  }

  /**
   * Send command (event) to server
   *
   * @param {string} commandName Command name
   * @param {Buffer} commandPayload Command payload bytes
   */
  async command(commandName: string, commandPayload?: Buffer): Promise<void> {
    return this.client.command(commandName, commandPayload);
  }

  /**
   * Send request to server and wait response
   *
   * @param {string} requestName Request name
   * @param {Buffer} requestPayload Request payload bytes
   */
  async fetch(requestName: string, requestPayload?: Buffer): Promise<PayloadData> {
    return this.client.fetch(requestName, requestPayload);
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
    return this.client.request(requestName, responseCallback, requestPayload);
  }

  /**
   * Send response on request
   *
   * @param {PayloadData} requestPayload Request received from the peer
   * @param {Buffer} [responsePayload] Response payload bytes
   */
  async response(requestPayload: PayloadData, responsePayload?: Buffer): Promise<void> {
    this.client.response(requestPayload, responsePayload);
  }

  /**
   *  Subscribe on command from server
   *
   * @param {string} commandName Command name
   * @param {ResponseCallback} commandHandler Handler for the subscribed command
   */
  async on(commandName: string, commandHandler: ResponseCallback): Promise<void> {
    this.client.on(commandName, commandHandler);
  }

  /**
   * Unsubscribe from command
   * If no handler is supplied, clear all handlers
   *
   * @param {string} commandName Command name
   * @param {ResponseCallback} commandHandler Handler to unsubscribe
   */
  async off(commandName: string, commandHandler?: ResponseCallback): Promise<void> {
    this.client.off(commandName, commandHandler);
  }

  /**
   * Cancel request
   *
   * @param {number} requestId Request id
   */
  async cancel(requestId: number): Promise<void> {
    this.client.cancel(requestId);
  }

  /**
   *  Subscribe on request from server that wait response
   *
   * @param {string} requestName Request name
   * @param {ResponseCallback} requestHandler Handler for the subscribed request
   */
  async onRequest(requestName: string, requestHandler: ResponseCallback): Promise<void> {
    this.client.onRequest(requestName, requestHandler);
  }

  /**
   * Unsubscribe from request from server that wait response
   *
   * @param {string} requestName Request name
   */
  async offRequest(requestName: string): Promise<void> {
    this.client.offRequest(requestName);
  }

  /**
   * Start client handshake
   *
   * @param {Buffer} [handshakePayload] Custom handshake payload
   */
  async handshake(handshakePayload?: Buffer): Promise<void> {
    this.client.handshake(handshakePayload);
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
    await this.client.destroy();
  }

  /**
   * Event when connected
   */
  private onClientConnect(): void {
    const connectionId = Tools.generateId(ID_LENGTH);
    const remoteAddress = this.getLocalAddress();
    this.log.setLabel([connectionId, remoteAddress]);
    this.isConnected = true;
    this.client = new Client(this.connection, connectionId, this.log, {} as Service, this.options, CommanderMode.Bot);
    this.client.onDisconnect = (_connectionId: string, reason: DisconnectReason) => this.onClientDisconnect(reason);
    this.client.onReady = () => this.onReady();
    this.onConnect();
    if (this.handshakePayload) {
      this.handshake(this.handshakePayload);
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

  /**
   * Get local IP address
   *
   * @private
   * @returns {string} Local IP address
   */
  private getLocalAddress(): string {
    const interfaces = Object.values(os.networkInterfaces()).flatMap((addresses) => addresses ?? []);
    return interfaces.find(({ family, address }) => family.toString().toLowerCase() === 'ipv4' && !address.startsWith('127.'))?.address ?? '127.0.0.1';
  }
}
