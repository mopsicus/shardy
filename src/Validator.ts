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
   * @param {Buffer} body Data for validate
   * @return {*}  {ValidatorState} Validation result
   */
  verifyHandshake(body: Buffer): ValidatorState;

  /**
   * Validate acknowledgement data
   *
   * @param {Buffer} body Data for validate
   * @return {*}  {ValidatorState} Validation result
   */
  verifyAcknowledgement(body: Buffer): ValidatorState;

  /**
   * Get handshake data for send
   *
   * @param {Buffer} [body] Custom data for handshake
   * @return {*}  {Buffer} Data from handshake
   */
  handshake(body?: Buffer): Buffer;

  /**
   * Get acknowledgement data for send
   *
   * @param {Buffer} body Data from handshake
   * @return {*}  {Buffer} Data for acknowledge
   */
  acknowledgement(body: Buffer): Buffer;
}
