/**
 * Length of block head
 */
export const BLOCK_HEAD = 4;

/**
 * Maximum body size representable by the three-byte block length
 */
export const MAX_BLOCK_SIZE = 0xffffff;

/**
 * Default body size limit for incoming and outgoing blocks.
 */
export const DEFAULT_BLOCK_SIZE = 1024 * 1024;

/**
 * Block result structure after decode
 */
export interface BlockData {
  type: BlockType;
  body: Buffer;
}

/**
 * Block type to encode
 */
export enum BlockType {
  /**
   * Handshake process
   */
  Handshake,

  /**
   * Acknowledgement for success verify
   */
  HandshakeAcknowledgement,

  /**
   * Ping
   */
  Heartbeat,

  /**
   * Data for command, request, response
   */
  Data,

  /**
   * Kick from server, disconnect
   */
  Kick,
}

/**
 * Block data for transport
 *
 * @export
 * @class Block
 */
export class Block {
  /**
   * Encode block for transporting
   *
   * @param {BlockType} type Block type: data, kick or heartbeat
   * @param {Buffer} body Body to send
   * @return {*}  {Buffer} Encoded type + body
   */
  static encode(type: BlockType, body: Buffer): Buffer {
    const length = body ? body.length : 0;
    if (length > MAX_BLOCK_SIZE) {
      return Buffer.alloc(0);
    }
    const data = Buffer.from(body);
    const buffer = Buffer.alloc(BLOCK_HEAD + length);
    let index = 0;
    buffer[index++] = type & 0xff;
    buffer[index++] = (length >> 16) & 0xff;
    buffer[index++] = (length >> 8) & 0xff;
    buffer[index++] = length & 0xff;
    data.copy(buffer, index, 0, length);
    return buffer;
  }

  /**
   * Decode block data
   *
   * @param {Buffer} data Buffer with data to decode
   * @return {*}  {BlockData} Result with type as BlockType and body as Buffer
   */
  static decode(data: Buffer): BlockData {
    const bytes = Buffer.from(data);
    const type = <BlockType>bytes[0];
    let index = 1;
    const length = ((bytes[index++] << 16) | (bytes[index++] << 8) | bytes[index++]) >>> 0;
    const body = length ? Buffer.alloc(length) : Buffer.alloc(0);
    bytes.copy(body, 0, BLOCK_HEAD, BLOCK_HEAD + length);
    return { type, body };
  }

  /**
   * Check received block
   *
   * @param {BlockType} type Byte index for BlockType
   * @return {*}  {boolean} Is correct block or not
   */
  static check(type: BlockType): boolean {
    return Object.values(BlockType).includes(type);
  }

  /**
   * Validate block body limit
   *
   * @param size Size of the block body to validate
   * @returns {boolean} True if the size is valid, false otherwise
   */
  static validate(size: number): boolean {
    return Number.isInteger(size) && size >= 0 && size <= MAX_BLOCK_SIZE;
  }
}
