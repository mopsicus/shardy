import { Client } from './Client';
import { DisconnectReason } from './Commander';
import { Logger } from './Logger';

/**
 * Mode for extension processing order
 */
export enum ExtensionMode {
  /**
   * Use before service's callbacks
   */
  Before,

  /**
   * Use after service's callbacks
   */
  After,
}

/**
 * Extension interface for Shardy service
 *
 * @export
 * @interface Extension
 */
export interface Extension {
  /**
   * Extension name
   */
  name: string;

  /**
   * Extension mode
   */
  mode: ExtensionMode;

  /**
   * Logger for extension
   */
  log: Logger;

  /**
   * Init extension
   */
  init(): Promise<void>;

  /**
   * Event when new client connected
   */
  onClientConnect(client: Client): Promise<void>;

  /**
   * Event when client disconnected
   */
  onClientDisconnect(client: Client, reason: DisconnectReason): Promise<void>;

  /**
   * Event when client made a handshake
   */
  onClientReady(client: Client): Promise<void>;

  /**
   * Event when service started
   */
  onServiceListening(): Promise<void>;

  /**
   * Event when service closed
   */
  onServiceClose(): Promise<void>;
}
