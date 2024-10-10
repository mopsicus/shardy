import { Client } from './Client';
import { DisconnectReason, Task } from './Commander';
import { Validator } from './Validator';
import { TransportType } from './Transport';
import { Serializer } from './Serializer';

/**
 * Service options to pass in Commander
 *
 * @export
 * @interface ServiceOptions
 */
export interface ServiceOptions {
  /**
   * List of available service commads and requests
   */
  commands?: Map<string, Task>;

  /**
   * Handshake service instance
   */
  validator: Validator;

  /**
   * Service data serializer
   */
  serializer: Serializer;
}

/**
 * Service interface
 *
 * Service instance must implements it
 *
 * @export
 * @interface Service
 */
export interface Service {
  /**
   * Service name
   */
  name: string;

  /**
   * Transport type for service
   */
  transport: TransportType;

  /**
   * Event when new client connected
   */
  onConnect(client: Client): Promise<void>;

  /**
   * Event when client disconnected
   */
  onDisconnect(client: Client, reason: DisconnectReason): Promise<void>;

  /**
   * Event when client made a handshake
   */
  onReady(client: Client): Promise<void>;

  /**
   * Event when service started
   */
  onListening(host: string, port: number): Promise<void>;

  /**
   * Event when service get error
   */
  onError(error: Error): Promise<void>;

  /**
   * Event when service closed
   */
  onClose(): Promise<void>;
}
