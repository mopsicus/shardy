import { Block, BlockData, BlockType, MAX_BLOCK_SIZE, DEFAULT_BLOCK_SIZE } from './Block';
import { DisconnectReason } from './Commander';
import { Logger, LoggerScope } from './Logger';
import { Tools } from './Tools';
import { Transport } from './Transport';
import { Connection } from './Connection';

/**
 * Tag for logs
 */
const LOG_TAG = Tools.getTag(module);

/**
 * Protocol state
 */
export enum ProtocolState {
  /**
   * Init state, wait for handshake
   */
  Start,

  /**
   * Handshake is in progress
   */
  Handshake,

  /**
   * Work state after success handshake
   */
  Work,

  /**
   * Protocol closed, any actions ignored
   */
  Closed,
}

/**
 * Protocol to manage all data from transport and send to connection handlers
 *
 * @export
 * @class Protocol
 */
export class Protocol {
  /**
   * Callback on processed block
   */
  public onBlock: (block: BlockData) => void = () => {};

  /**
   * Callback on disconnect
   */
  public onDisconnect: () => void = () => {};

  /**
   * Transport instance
   *
   * @private
   * @type {Transport}
   */
  private transport: Transport;

  /**
   * Current protocol state
   *
   * @type {ProtocolState}
   */
  private state: ProtocolState = ProtocolState.Start;

  /**
   * Creates an instance of Protocol
   *
   * @param {Connection} connection Client connection
   * @param {Logger} log Client logger instance
   */
  constructor(
    private connection: Connection,
    private log: Logger,
    private block: number = DEFAULT_BLOCK_SIZE,
  ) {
    this.transport = new Transport(this.connection, this.log, this.block);
    if (!Block.validate(this.block ?? DEFAULT_BLOCK_SIZE)) {
      this.log.error(`[${LOG_TAG}] block size must be an integer between 0 and ${MAX_BLOCK_SIZE}`, LoggerScope.System);
      return;
    }    
    this.transport.onData = (data: Buffer) => this.onData(data);
    this.transport.onDisconnect = () => this.onClose();
  }

  /**
   * Send data to transport
   *
   * @param {BlockType} type Type of block data
   * @param {Buffer} [body] Buffer for transport
   */
  dispatch(type: BlockType, body?: Buffer): void {
    if (this.state === ProtocolState.Closed) {
      this.log.warn(`[${LOG_TAG}] send data to closed protocol`, LoggerScope.Debug);
      return;
    }
    body = body ? body : Buffer.alloc(0);
    if (body.length > this.block) {
      this.log.error(`[${LOG_TAG}] block body exceeds the configured limit of ${this.block} bytes`, LoggerScope.Debug);
      return;      
    }
    this.log.info(`[${LOG_TAG}] dispatch type: ${type}, body: ${body}`, LoggerScope.Debug);
    const data = Block.encode(type, body);
    if (data.length === 0) {
      this.log.error(`[${LOG_TAG}] block body exceeds the maximum of ${MAX_BLOCK_SIZE} bytes`, LoggerScope.Debug);
      return;
    }
    this.transport.dispatch(data);
  }

  /**
   * Send data to connection
   *
   * @param {Buffer} body Serialized command data
   */
  send(body: Buffer): void {
    this.log.info(`[${LOG_TAG}] send data: ${body}`, LoggerScope.Debug);
    this.dispatch(BlockType.Data, body);
  }

  /**
   * Send heartbeat to connection
   */
  heartbeat(): void {
    this.log.info(`[${LOG_TAG}] send heartbeat`, LoggerScope.Debug);
    this.dispatch(BlockType.Heartbeat);
  }

  /**
   * Send handshake to connection
   * @param {Buffer} body Buffer with handshake data
   */
  handshake(body: Buffer): void {
    this.log.info(`[${LOG_TAG}] send handshake`, LoggerScope.Debug);
    this.state = ProtocolState.Handshake;
    this.dispatch(BlockType.Handshake, body);
  }

  /**
   * Send acknowledgement
   * @param {Buffer} body Buffer with acknowledge data
   */
  acknowledge(body: Buffer): void {
    this.log.info(`[${LOG_TAG}] send acknowledge`, LoggerScope.Debug);
    this.dispatch(BlockType.HandshakeAcknowledgement, body);
  }

  /**
   * Kick from server
   *
   * @param {DisconnectReason} reason Disconnect reason data
   */
  kick(reason: DisconnectReason): void {
    this.log.info(`[${LOG_TAG}] send kick`, LoggerScope.Debug);
    this.dispatch(BlockType.Kick, Buffer.from(reason.toString()));
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.state = ProtocolState.Closed;
    this.log.info(`[${LOG_TAG}] disconnect`, LoggerScope.Debug);
    this.transport.close();
  }

  /**
   * Callback from transport when disconnected
   */
  onClose(): void {
    this.state = ProtocolState.Closed;
    this.onDisconnect();
  }

  /**
   * Process and validate all received blocks
   *
   * @param {Buffer} data Received buffer
   */
  private onData(data: Buffer): void {
    if (this.state === ProtocolState.Closed) {
      this.log.warn(`[${LOG_TAG}] received data to closed protocol`, LoggerScope.Debug);
      return;
    }
    const block = Block.decode(data);
    if (!Block.check(block.type)) {
      this.catchBlockForState(block.type);
      return;
    }
    this.log.info(`[${LOG_TAG}] received block: ${block.type}, data: ${block.body}, state: ${this.state}`, LoggerScope.Debug);
    switch (this.state) {
      case ProtocolState.Work:
        switch (block.type) {
          case BlockType.Heartbeat:
          case BlockType.Kick:
          case BlockType.Data:
            this.onBlock(block);
            break;
          default:
            this.catchBlockForState(block.type);
            break;
        }
        break;
      case ProtocolState.Start:
        switch (block.type) {
          case BlockType.Heartbeat:
            this.onBlock(block);
            break;
          case BlockType.Handshake:
            this.onBlock(block);
            this.state = ProtocolState.Handshake;
            break;
          default:
            this.catchBlockForState(block.type);
            break;
        }
        break;
      case ProtocolState.Handshake:
        switch (block.type) {
          case BlockType.HandshakeAcknowledgement:
            this.state = ProtocolState.Work;
            this.onBlock(block);
            break;
          case BlockType.Heartbeat:
          case BlockType.Kick:
            this.onBlock(block);
            break;
          default:
            this.catchBlockForState(block.type);
            break;
        }
        break;
      default:
        break;
    }
  }

  /**
   * Log when received invalid block type in state
   *
   * @private
   * @param {BlockType} type Received block type
   */
  private catchBlockForState(type: BlockType): void {
    this.log.warn(`[${LOG_TAG}] received invalid block type: ${type}, state: ${this.state}`, LoggerScope.Debug);
  }

  /**
   * Destroy
   */
  destroy(): void {
    this.log.info(`[${LOG_TAG}] destroy`, LoggerScope.Debug);
    this.state = ProtocolState.Closed;
    this.transport.destroy();
  }
}
