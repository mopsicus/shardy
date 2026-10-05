import { Validator, ValidatorState } from '../validator';

/**
 * DTO for handshake
 */
interface HandshakeDTO {
  /**
   * Handshake version
   */
  version: number;

  /**
   * Timestamp of handshake
   */
  timestamp: number;

  /**
   * Nonce for handshake
   */
  nonce: string;

  /**
   * Custom data for handshake
   */
  payload?: string;
}

/**
 * DTO for acknowledgement
 */
interface AcknowledgementDTO {
  /**
   * Received flag
   */
  received: boolean;

  /**
   * Nonce for acknowledgement
   */
  nonce: string;
}

/**
 * Default validator
 * @export
 * @implements {Validator}
 */
export class DefaultValidator implements Validator {
  /**
   * Get handshake data for send
   *
   * @param {Buffer} [customHandshakePayload] Optional custom handshake payload
   * @returns {Buffer} Encoded handshake payload
   */
  handshake(customHandshakePayload?: Buffer): Buffer {
    const handshakeData: HandshakeDTO = {
      version: 1,
      timestamp: Date.now(),
      nonce: crypto.randomUUID().replace(/-/g, ''),
      payload: customHandshakePayload ? customHandshakePayload.toString('utf-8') : undefined,
    };
    return Buffer.from(JSON.stringify(handshakeData), 'utf-8');
  }

  /**
   * Get acknowledgement data for send
   *
   * @param {Buffer} handshakePayload Handshake payload to acknowledge
   * @return {Buffer} Encoded acknowledgement payload
   */
  acknowledgement(handshakePayload: Buffer): Buffer {
    const handshakeMessage = JSON.parse(handshakePayload.toString('utf-8')) as HandshakeDTO;
    const acknowledgementMessage: AcknowledgementDTO = { received: true, nonce: handshakeMessage.nonce };
    return Buffer.from(JSON.stringify(acknowledgementMessage), 'utf-8');
  }

  /**
   * Validate handshake data
   *
   * @param {Buffer} handshakePayload Handshake payload to validate
   * @returns {ValidatorState} Handshake validation result
   */
  verifyHandshake(handshakePayload: Buffer): ValidatorState {
    try {
      const parsedHandshake: unknown = JSON.parse(handshakePayload.toString('utf-8'));
      if (
        typeof parsedHandshake === 'object' &&
        parsedHandshake !== null &&
        !Array.isArray(parsedHandshake) &&
        (parsedHandshake as HandshakeDTO).version === 1 &&
        typeof (parsedHandshake as HandshakeDTO).nonce === 'string' &&
        (parsedHandshake as HandshakeDTO).nonce.length > 0 &&
        Number.isFinite((parsedHandshake as HandshakeDTO).timestamp)
      ) {
        return ValidatorState.Success;
      }
    } catch {
      return ValidatorState.Failed;
    }
    return ValidatorState.Failed;
  }

  /**
   * Validate acknowledgement data
   *
   * @param {Buffer} acknowledgementPayload Acknowledgement payload to validate
   * @returns {ValidatorState} Acknowledgement validation result
   */
  verifyAcknowledgement(acknowledgementPayload: Buffer): ValidatorState {
    try {
      const parsedAcknowledgement: unknown = JSON.parse(acknowledgementPayload.toString('utf-8'));
      if (
        typeof parsedAcknowledgement === 'object' &&
        parsedAcknowledgement !== null &&
        !Array.isArray(parsedAcknowledgement) &&
        (parsedAcknowledgement as AcknowledgementDTO).received === true &&
        typeof (parsedAcknowledgement as AcknowledgementDTO).nonce === 'string' &&
        (parsedAcknowledgement as AcknowledgementDTO).nonce.length > 0
      ) {
        return ValidatorState.Success;
      }
    } catch {
      return ValidatorState.Failed;
    }
    return ValidatorState.Failed;
  }
}
