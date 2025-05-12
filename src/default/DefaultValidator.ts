import { Validator, ValidatorState } from '../Validator';

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
   * @param {Buffer} [body] Custom data for handshake
   * @return {*}  {Buffer} Data from handshake
   */
  handshake(body?: Buffer): Buffer {
    const data: HandshakeDTO = { version: 1, timestamp: Date.now(), nonce: crypto.randomUUID().replace(/-/g, ''), payload: body ? body.toString('utf-8') : undefined };
    return Buffer.from(JSON.stringify(data), 'utf-8');
  }

  /**
   * Get acknowledgement data for send
   *
   * @param {Buffer} body Data from handshake
   * @return {*}  {Buffer} Data for acknowledge
   */
  acknowledgement(body: Buffer): Buffer {
    const json = JSON.parse(body.toString('utf-8')) as HandshakeDTO;
    const ack: AcknowledgementDTO = { received: true, nonce: json.nonce };
    return Buffer.from(JSON.stringify(ack), 'utf-8');
  }

  /**
   * Validate handshake data
   *
   * @param {Buffer} body Data for validate
   * @return {*}  {ValidatorState} Validation result
   */
  verifyHandshake(body: Buffer): ValidatorState {
    const json = JSON.parse(body.toString('utf-8')) as HandshakeDTO;
    if (json.version === 1 && json.nonce && typeof json.timestamp === 'number') {
      return ValidatorState.Success;
    }
    return ValidatorState.Failed;
  }

  /**
   * Validate acknowledgement data
   *
   * @param {Buffer} body Data for validate
   * @return {*}  {ValidatorState} Validation result
   */
  verifyAcknowledgement(body: Buffer): ValidatorState {
    const json = JSON.parse(body.toString('utf-8')) as AcknowledgementDTO;
    if (json.received && json.nonce) {
      return ValidatorState.Success;
    }
    return ValidatorState.Failed;
  }
}
