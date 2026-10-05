/**
 * Validator state
 */
export enum ValidatorState {
  /**
   * Handshake passed
   */
  Success,

  /**
   * Handshake failed
   */
  Failed,
}

/**
 * Handshake interface for server-client, server-server validation
 */
export interface Validator {
  /**
   * Validate handshake data
   *
   * @param {Buffer} handshakePayload Handshake payload to validate
   * @returns {ValidatorState} Handshake validation result
   */
  verifyHandshake(handshakePayload: Buffer): ValidatorState;

  /**
   * Validate acknowledgement data
   *
   * @param {Buffer} acknowledgementPayload Acknowledgement payload to validate
   * @returns {ValidatorState} Acknowledgement validation result
   */
  verifyAcknowledgement(acknowledgementPayload: Buffer): ValidatorState;

  /**
   * Get handshake data for send
   *
   * @param {Buffer} [customHandshakePayload] Optional custom handshake payload
   * @returns {Buffer} Encoded handshake payload
   */
  handshake(customHandshakePayload?: Buffer): Buffer;

  /**
   * Get acknowledgement data for send
   *
   * @param {Buffer} handshakePayload Handshake payload to acknowledge
   * @returns {Buffer} Encoded acknowledgement payload
   */
  acknowledgement(handshakePayload: Buffer): Buffer;
}
