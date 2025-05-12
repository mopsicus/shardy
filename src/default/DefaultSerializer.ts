import { Serializer } from '../Serializer';
import { PayloadData } from '../Payload';
import { Buffer } from 'buffer';

/**
 * Default serializer
 *
 * @export
 * @implements {Serializer}
 */
export class DefaultSerializer implements Serializer {
  /**
   *
   * Serialize data to buffer
   *
   * @param {PayloadData} body Target data
   * @return {*}  {Buffer} Encoded data
   */
  encode(body: PayloadData): Buffer {
    const data = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, key === 'data' ? value.toString('base64') : value]));
    const json = JSON.stringify(data);
    return Buffer.from(json, 'utf-8');
  }

  /**
   * Deserialize buffer
   *
   * @param {Buffer} body Encoded data
   * @return {*}  {PayloadData} Data to use
   */
  decode(body: Buffer): PayloadData {
    const json = body.toString('utf-8');
    const data = Object.fromEntries(Object.entries(JSON.parse(json)).map(([key, value]) => [key, key === 'data' ? Buffer.from(String(value), 'base64') : value]));
    return data as unknown as PayloadData;
  }
}
