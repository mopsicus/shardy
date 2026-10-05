import { PayloadData } from './payload';

/**
 * Serializer interface, uses in Payload
 */
export interface Serializer {
  /**
   *
   * Serialize data to buffer
   *
   * @param {PayloadData} payload Payload to serialize
   * @returns {Buffer} Serialized payload bytes
   */
  encode(payload: PayloadData): Buffer;

  /**
   * Deserialize buffer
   *
   * @param {Buffer} encodedPayload Serialized payload bytes
   * @returns {PayloadData} Decoded payload
   */
  decode(encodedPayload: Buffer): PayloadData;
}
