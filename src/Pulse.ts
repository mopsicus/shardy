import { CommanderMode } from './Commander';

/**
 * Pulse service for support connection
 *
 * @export
 * @class Pulse
 */
export class Pulse {
  /**
   * Callback if limit expired
   */
  public onPulse: () => void = () => {};

  /**
   * Checks counter
   *
   * @private
   * @type {number}
   */
  private checks: number = 0;

  /**
   * Current pulse timer
   *
   * @private
   * @type {NodeJS.Timeout}
   */
  private timer: NodeJS.Timeout;

  /**
   * Local limit cached
   *
   * @private
   * @type {number}
   */
  private limit: number;

  /**
   * Creates an instance of Pulse
   * If bot -> pulse every check, if service -> pulse if limit expired
   *
   * @param {CommanderMode} mode Commander mode for service or bot
   */
  constructor(private mode: CommanderMode) {
    this.timer = setInterval(() => this.onCheckPulse(), process.env.PULSE_INTERVAL);
    this.limit = this.mode === CommanderMode.Bot ? 1 : process.env.PULSE_LIMIT;
  }

  /**
   * Pulse checker
   */
  onCheckPulse(): void {
    this.checks++;
    if (this.checks > this.limit) {
      this.reset();
      this.onPulse();
    }
  }

  /**
   *  Reset timer when commands received
   */
  reset(): void {
    this.checks = 0;
  }

  /**
   * Stop and switch off service
   */
  clear(): void {
    this.reset();
    clearInterval(this.timer);
  }
}
