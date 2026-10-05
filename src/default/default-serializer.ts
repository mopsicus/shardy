import { Serializer } from '../serializer';
import { PayloadData } from '../payload';
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
   * @param {PayloadData} payload Payload to serialize
   * @returns {Buffer} Serialized payload bytes
   */
  encode(payload: PayloadData): Buffer {
    const serializedPayload = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, key === 'data' ? value.toString('base64') : value]));
    const serializedJson = JSON.stringify(serializedPayload);
    return Buffer.from(serializedJson, 'utf-8');
  }

  /**
   * Deserialize buffer
   *
   * @param {Buffer} encodedPayload Serialized payload bytes
   * @returns {PayloadData} Decoded payload
   */
  decode(encodedPayload: Buffer): PayloadData {
    const payloadJson = encodedPayload.toString('utf-8');
    const parsedPayload: unknown = JSON.parse(payloadJson);
    if (typeof parsedPayload !== 'object' || parsedPayload === null || Array.isArray(parsedPayload)) {
      throw new TypeError(`payload must be a JSON object`);
    }
    const decodedPayload = Object.fromEntries(
      Object.entries(parsedPayload as Record<string, unknown>).map(([key, value]) => {
        if (key !== 'data') {
          return [key, value];
        }
        if (typeof value !== 'string') {
          throw new TypeError(`payload data must be a base64 string`);
        }
        return [key, Buffer.from(value, 'base64')];
      }),
    );
    return decodedPayload as unknown as PayloadData;
  }
}
