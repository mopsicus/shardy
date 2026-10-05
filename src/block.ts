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
  Handshake = 0x00,

  /**
   * Acknowledgement for success verify
   */
  HandshakeAcknowledgement = 0x01,

  /**
   * Ping
   */
  Heartbeat = 0x02,

  /**
   * Data for command, request, response
   */
  Data = 0x03,

  /**
   * Kick from server, disconnect
   */
  Kick = 0x04,
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
   * @param {BlockType} blockType Block type: data, kick or heartbeat
   * @param {Buffer} blockBody Body to send
   * @returns {Buffer} Encoded block bytes
   */
  static encode(blockType: BlockType, blockBody: Buffer): Buffer {
    const bodyLength = blockBody ? blockBody.length : 0;
    if (bodyLength > MAX_BLOCK_SIZE) {
      return Buffer.alloc(0);
    }
    const bodyBuffer = Buffer.from(blockBody);
    const encodedBlock = Buffer.alloc(BLOCK_HEAD + bodyLength);
    let offset = 0;
    encodedBlock[offset++] = blockType & 0xff;
    encodedBlock[offset++] = (bodyLength >> 16) & 0xff;
    encodedBlock[offset++] = (bodyLength >> 8) & 0xff;
    encodedBlock[offset++] = bodyLength & 0xff;
    bodyBuffer.copy(encodedBlock, offset, 0, bodyLength);
    return encodedBlock;
  }

  /**
   * Decode block data
   *
   * @param {Buffer} encodedData Buffer with data to decode
   * @returns {BlockData} Decoded block type and body
   */
  static decode(encodedData: Buffer): BlockData {
    const blockBuffer = Buffer.from(encodedData);
    const blockType = <BlockType>blockBuffer[0];
    let offset = 1;
    const bodyLength = ((blockBuffer[offset++] << 16) | (blockBuffer[offset++] << 8) | blockBuffer[offset++]) >>> 0;
    const bodyBuffer = bodyLength ? Buffer.alloc(bodyLength) : Buffer.alloc(0);
    blockBuffer.copy(bodyBuffer, 0, BLOCK_HEAD, BLOCK_HEAD + bodyLength);
    return { type: blockType, body: bodyBuffer };
  }

  /**
   * Check received block
   *
   * @param {BlockType} blockType Block type to validate
   * @returns {boolean} True when the block type is supported
   */
  static check(blockType: BlockType): boolean {
    return Object.values(BlockType).includes(blockType);
  }

  /**
   * Validate block body limit
   *
   * @param blockBodySize Size of the block body to validate
   * @returns {boolean} True if the size is valid, false otherwise
   */
  static validate(blockBodySize: number): boolean {
    return Number.isInteger(blockBodySize) && blockBodySize >= 0 && blockBodySize <= MAX_BLOCK_SIZE;
  }
}
