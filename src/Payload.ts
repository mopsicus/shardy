import { Serializer } from './Serializer';

/**
 * Payload type
 */
export enum PayloadType {
  /**
   * Request and expect answer
   */
  Request,
  /**
   * Command without answer, event
   */
  Command,
  /**
   * Response on request
   */
  Response,
}

/**
 * Payload after decode
 */
export interface PayloadData {
  /**
   * Type of data
   */
  type: PayloadType;
  /**
   * Command or request name
   */
  name: string;
  /**
   * Request id
   */
  id: number;
  /**
   * Data
   */
  data: Buffer;
  /**
   * Error message or code
   */
  error: string;
}

/**
 * Payload encode and decode block data to use in commander
 *
 * @export
 * @class Payload
 */
export class Payload {
  /**
   * Encode data for transfer
   *
   * @static
   * @param {Serializer} serializer Service serializer
   * @param {PayloadType} type Type of data
   * @param {string} name Command or request name
   * @param {number} id Request id
   * @param {Buffer} [data] Data
   * @param {string} [error] Error message or code
   * @return {*}  {Buffer} Encoded buffer data
   */
  static encode(serializer: Serializer, type: PayloadType, name: string, id: number, data?: Buffer, error?: string): Buffer {
    data = data ? data : Buffer.alloc(0);
    error = error ? error : '';
    return serializer.encode({ type, name, id, data, error });
  }

  /**
   * Decode received block
   *
   * @static
   * @param {Serializer} serializer Service serializer
   * @param {Buffer} data Encoded buffer data
   * @return {*}  {PayloadData} Payload data to use in commander
   */
  static decode(serializer: Serializer, data: Buffer): PayloadData {
    return serializer.decode(data);
  }

  /**
   * Create payload data manually without serialization
   *
   * @static
   * @param {PayloadType} type Type of data
   * @param {string} name Command or request name
   * @param {number} id Request id
   * @param {Buffer} [data] Data
   * @param {string} [error] Error message or code
   * @return {*}  {PayloadData} Not encoded payload data
   */
  static create(type: PayloadType, name: string, id: number, data?: Buffer, error?: string): PayloadData {
    data = data ? data : Buffer.alloc(0);
    error = error ? error : '';
    return { type, name, id, data, error };
  }

  /**
   * Check payload for available type
   *
   * @static
   * @param {PayloadData} payload Payload data to check
   * @return {*}  {boolean} Correct or not
   */
  static check(payload: PayloadData): boolean {
    return Object.values(PayloadType).includes(payload.type);
  }
}
