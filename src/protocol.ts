import { Block, BlockData, BlockType, MAX_BLOCK_SIZE, DEFAULT_BLOCK_SIZE } from './block';
import { DisconnectReason } from './commander';
import { Logger, LoggerScope } from './logger';
import { Tools } from './tools';
import { Transport } from './transport';
import { Connection } from './connection';

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
    private maxBlockBodySize: number = DEFAULT_BLOCK_SIZE,
  ) {
    this.transport = new Transport(this.connection, this.log, this.maxBlockBodySize);
    if (!Block.validate(this.maxBlockBodySize ?? DEFAULT_BLOCK_SIZE)) {
      this.log.error(`[${LOG_TAG}] block size must be an integer between 0 and ${MAX_BLOCK_SIZE}`, LoggerScope.System);
      return;
    }
    this.transport.onData = (data: Buffer) => this.onData(data);
    this.transport.onDisconnect = () => this.onClose();
  }

  /**
   * Send data to transport
   *
   * @param {BlockType} blockType Type of block to dispatch
   * @param {Buffer} [blockBody] Block body bytes
   */
  dispatch(blockType: BlockType, blockBody?: Buffer): void {
    if (this.state === ProtocolState.Closed) {
      this.log.warn(`[${LOG_TAG}] send data to closed protocol`, LoggerScope.Debug);
      return;
    }
    blockBody = blockBody ? blockBody : Buffer.alloc(0);
    if (blockBody.length > this.maxBlockBodySize) {
      this.log.error(`[${LOG_TAG}] block body exceeds the configured limit: ${this.maxBlockBodySize}`, LoggerScope.Debug);
      return;
    }
    this.log.info(`[${LOG_TAG}] dispatch type: ${blockType}, body: ${blockBody}`, LoggerScope.Debug);
    const encodedBlock = Block.encode(blockType, blockBody);
    if (encodedBlock.length === 0) {
      this.log.error(`[${LOG_TAG}] block body exceeds the maximum: ${MAX_BLOCK_SIZE}`, LoggerScope.Debug);
      return;
    }
    this.transport.dispatch(encodedBlock);
  }

  /**
   * Send data to connection
   *
   * @param {Buffer} serializedPayload Serialized command payload
   */
  send(serializedPayload: Buffer): void {
    this.log.info(`[${LOG_TAG}] send data: ${serializedPayload}`, LoggerScope.Debug);
    this.dispatch(BlockType.Data, serializedPayload);
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
   * @param {Buffer} handshakePayload Handshake payload bytes
   */
  handshake(handshakePayload: Buffer): void {
    this.log.info(`[${LOG_TAG}] send handshake`, LoggerScope.Debug);
    this.state = ProtocolState.Handshake;
    this.dispatch(BlockType.Handshake, handshakePayload);
  }

  /**
   * Send acknowledgement
   * @param {Buffer} acknowledgementPayload Acknowledgement payload bytes
   */
  acknowledge(acknowledgementPayload: Buffer): void {
    this.log.info(`[${LOG_TAG}] send acknowledge`, LoggerScope.Debug);
    this.dispatch(BlockType.HandshakeAcknowledgement, acknowledgementPayload);
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
   * @param {Buffer} encodedFrame Frame received from transport
   */
  private onData(encodedFrame: Buffer): void {
    if (this.state === ProtocolState.Closed) {
      this.log.warn(`[${LOG_TAG}] received data to closed protocol`, LoggerScope.Debug);
      return;
    }
    const receivedBlock = Block.decode(encodedFrame);
    if (!Block.check(receivedBlock.type)) {
      this.logInvalidBlockForState(receivedBlock.type);
      return;
    }
    this.log.info(`[${LOG_TAG}] received block: ${receivedBlock.type}, data: ${receivedBlock.body}, state: ${this.state}`, LoggerScope.Debug);
    switch (this.state) {
      case ProtocolState.Work:
        switch (receivedBlock.type) {
          case BlockType.Heartbeat:
          case BlockType.Kick:
          case BlockType.Data:
            this.onBlock(receivedBlock);
            break;
          default:
            this.logInvalidBlockForState(receivedBlock.type);
            break;
        }
        break;
      case ProtocolState.Start:
        switch (receivedBlock.type) {
          case BlockType.Heartbeat:
            this.onBlock(receivedBlock);
            break;
          case BlockType.Handshake:
            this.onBlock(receivedBlock);
            this.state = ProtocolState.Handshake;
            break;
          default:
            this.logInvalidBlockForState(receivedBlock.type);
            break;
        }
        break;
      case ProtocolState.Handshake:
        switch (receivedBlock.type) {
          case BlockType.HandshakeAcknowledgement:
            this.state = ProtocolState.Work;
            this.onBlock(receivedBlock);
            break;
          case BlockType.Heartbeat:
          case BlockType.Kick:
            this.onBlock(receivedBlock);
            break;
          default:
            this.logInvalidBlockForState(receivedBlock.type);
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
   * @param {BlockType} blockType Received block type
   */
  private logInvalidBlockForState(blockType: BlockType): void {
    this.log.warn(`[${LOG_TAG}] received invalid block type: ${blockType}, state: ${this.state}`, LoggerScope.Debug);
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
