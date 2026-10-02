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
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new TypeError(`payload must be a JSON object`);
    }
    const data = Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
        if (key !== 'data') {
          return [key, value];
        }
        if (typeof value !== 'string') {
          throw new TypeError(`payload data must be a base64 string`);
        }
        return [key, Buffer.from(value, 'base64')];
      }),
    );
    return data as unknown as PayloadData;
  }
}
