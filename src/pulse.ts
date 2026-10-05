import { CommanderMode } from './commander';

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
  private pulseCheckCount: number = 0;

  /**
   * Current pulse timer
   *
   * @private
   * @type {NodeJS.Timeout}
   */
  private pulseTimer: NodeJS.Timeout;

  /**
   * Local limit cached
   *
   * @private
   * @type {number}
   */
  private maxPulseChecks: number;

  /**
   * Creates an instance of Pulse
   * If bot -> pulse every check, if service -> pulse if limit expired
   *
   * @param {CommanderMode} mode Commander mode for service or bot
   */
  constructor(private mode: CommanderMode) {
    this.pulseTimer = setInterval(() => this.onCheckPulse(), process.env.PULSE_INTERVAL);
    this.maxPulseChecks = this.mode === CommanderMode.Bot ? 1 : process.env.PULSE_LIMIT;
  }

  /**
   * Pulse checker
   */
  onCheckPulse(): void {
    this.pulseCheckCount++;
    if (this.pulseCheckCount > this.maxPulseChecks) {
      this.reset();
      this.onPulse();
    }
  }

  /**
   *  Reset timer when commands received
   */
  reset(): void {
    this.pulseCheckCount = 0;
  }

  /**
   * Stop and switch off service
   */
  clear(): void {
    this.reset();
    clearInterval(this.pulseTimer);
  }
}
