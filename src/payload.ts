import { Serializer } from './serializer';

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
  data: unknown;
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
   * @param {PayloadType} payloadType Type of payload
   * @param {string} commandOrRequestName Command or request name
   * @param {number} requestId Request id
   * @param {Buffer} [payloadBuffer] Payload bytes
   * @param {string} [errorMessage] Error message or code
   * @returns {Buffer} Serialized payload bytes
   */
  static encode(serializer: Serializer, payloadType: PayloadType, commandOrRequestName: string, requestId: number, payloadBuffer?: Buffer, errorMessage?: string): Buffer {
    payloadBuffer = payloadBuffer ? payloadBuffer : Buffer.alloc(0);
    errorMessage = errorMessage ? errorMessage : '';
    return serializer.encode({
      type: payloadType,
      name: commandOrRequestName,
      id: requestId,
      data: payloadBuffer,
      error: errorMessage,
    });
  }

  /**
   * Decode a serialized payload
   *
   * @static
   * @param {Serializer} serializer Service serializer
   * @param {Buffer} encodedPayload Encoded payload buffer
   * @returns {PayloadData} Decoded payload
   */
  static decode(serializer: Serializer, encodedPayload: Buffer): PayloadData {
    return serializer.decode(encodedPayload);
  }

  /**
   * Create payload data manually without serialization
   *
   * @static
   * @param {PayloadType} payloadType Type of payload
   * @param {string} commandOrRequestName Command or request name
   * @param {number} requestId Request id
   * @param {Buffer} [payloadBuffer] Payload bytes
   * @param {string} [errorMessage] Error message or code
   * @returns {PayloadData} Payload with default optional values
   */
  static create(payloadType: PayloadType, commandOrRequestName: string, requestId: number, payloadBuffer?: Buffer, errorMessage?: string): PayloadData {
    payloadBuffer = payloadBuffer ? payloadBuffer : Buffer.alloc(0);
    errorMessage = errorMessage ? errorMessage : '';
    return {
      type: payloadType,
      name: commandOrRequestName,
      id: requestId,
      data: payloadBuffer,
      error: errorMessage,
    };
  }

  /**
   * Check payload for available type
   *
   * @static
   * @param {unknown} payloadCandidate Value to validate as a payload
   * @returns {boolean} True when the value is a valid payload
   */
  static check(payloadCandidate: unknown): payloadCandidate is PayloadData {
    if (typeof payloadCandidate !== 'object' || payloadCandidate === null || Array.isArray(payloadCandidate)) {
      return false;
    }
    const payloadFields = payloadCandidate as Record<string, unknown>;
    return (
      (payloadFields.type === PayloadType.Request || payloadFields.type === PayloadType.Command || payloadFields.type === PayloadType.Response) &&
      typeof payloadFields.name === 'string' &&
      payloadFields.name.length > 0 &&
      Number.isSafeInteger(payloadFields.id) &&
      (payloadFields.id as number) >= 0 &&
      Object.hasOwn(payloadFields, 'data') &&
      typeof payloadFields.error === 'string'
    );
  }
}
