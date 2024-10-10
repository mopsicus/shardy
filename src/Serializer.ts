import { PayloadData } from './Payload';

/**
 * Serializer interface, uses in Payload
 */
export interface Serializer {
  /**
   *
   * Serialize data to buffer
   *
   * @param {PayloadData} body Target data
   * @return {*}  {Buffer} Encoded data
   */
  encode(body: PayloadData): Buffer;

  /**
   * Deserialize buffer
   *
   * @param {Buffer} body Encoded data
   * @return {*}  {PayloadData} Data to use
   */
  decode(body: Buffer): PayloadData;
}
