import path from 'path';
import { createLogger, format, transports, Logger as WinstonLogger } from 'winston';
import { TransformableInfo } from 'logform';

/**
 * Mode for filter
 * Compare all filters items by mode
 * AND for default
 *
 * @export
 */
export enum LoggerFilterMode {
  And,
  Or,
  Ignore,
}

/**
 * Logger type
 *
 * @export
 */
export enum LoggerType {
  All = 'all',
  Info = 'info',
  Warning = 'warn',
  Error = 'error',
}

/**
 * Scope for logging
 *
 * @export
 */
export enum LoggerScope {
  None,
  User,
  System,
  Debug,
  All,
}

/**
 * Logger filter
 * Pass params in [] to enable filtering
 *
 * @export
 * @interface LoggerFilter
 */
export interface LoggerFilter {
  type?: LoggerType[];
  scope?: LoggerScope[];
  mode?: LoggerFilterMode;
  tags?: string[];
  contains?: string;
}

/**
 * Custom logger
 *
 * @export
 * @class Logger
 */
export class Logger {
  /**
   * Instance Winston logger
   *
   * @private
   * @type {WinstonLogger}
   */
  private logger: WinstonLogger;

  /**
   * Current filter for logger
   *
   * @private
   * @type {LoggerFilter}
   */
  private filter: LoggerFilter = {};

  /**
   * Creates an instance of Logger
   *
   * @param {string[]} [tags=[]] Info with connection and client data
   * @param {string} [label] Custom label, if exists -> replace data
   */
  constructor(
    private tags: string[],
    label?: string,
  ) {
    this.logger = createLogger({ format: this.logFormat(), exitOnError: false });
    if (label) {
      this.setLabel(this.tags, label);
    }
    if (process.env.ENV === 'development') {
      this.filter.type = [LoggerType.All];
      this.logger.add(new transports.Console());
      this.logger.add(new transports.File({ filename: path.join(__dirname, process.env.LOGS_DIR, 'all.log') }));
    } else {
      this.logger.add(
        new transports.File({
          filename: path.join(__dirname, process.env.LOGS_DIR, 'info.log'),
          level: LoggerType.Info,
        }),
      );
      this.logger.add(
        new transports.File({
          filename: path.join(__dirname, process.env.LOGS_DIR, 'warnings.log'),
          level: LoggerType.Warning,
        }),
      );
      this.logger.add(
        new transports.File({
          filename: path.join(__dirname, process.env.LOGS_DIR, 'errors.log'),
          level: LoggerType.Error,
          handleExceptions: true,
        }),
      );
    }
  }

  /**
   * Fastest way to check filter empty
   *
   * @static
   * @param {*} filter Object to check
   * @return {*}  {boolean} Empty or not
   */
  private isFilterEmpty(filter: LoggerFilter): boolean {
    for (const i in filter) {
      return false;
    }
    return true;
  }

  /**
   * Format label with connection info
   *
   * @return {*}  {string} Formatted label
   */
  private formatLabelTag(): string {
    let label = '';
    if (this.tags) {
      label = this.tags[0];
      for (let i = 1; i < this.tags.length; i++) {
        label = label.concat(`|${this.tags[i]}`);
      }
    }
    return label;
  }

  /**
   * Check filter and enable log if need
   *
   * @private
   * @type {*}
   */
  private checkFilter = format((info: TransformableInfo) => {
    if (this.isFilterEmpty(this.filter)) {
      return false;
    }
    const mode = this.filter.mode ? this.filter.mode : LoggerFilterMode.And;
    const conditions: boolean[] = [];
    if (this.filter.scope) {
      if (this.filter.scope.includes(LoggerScope.None)) {
        return false;
      }
      if (this.filter.scope.includes(LoggerScope.All)) {
        conditions.push(true);
      } else {
        conditions.push(this.filter.scope.includes(info.scope));
      }
    }
    if (this.filter.type) {
      if (this.filter.type.includes(LoggerType.All)) {
        conditions.push(true);
      } else {
        conditions.push(this.filter.type.includes(info.type));
      }
    }
    if (this.filter.tags && this.tags) {
      for (let i = 0; i < this.filter.tags.length; i++) {
        conditions.push(this.filter.tags[i] === this.tags[i]);
      }
    }
    if (this.filter.contains) {
      conditions.push(info.message.indexOf(this.filter.contains) >= 0);
    }
    let isPassed = false;
    switch (mode) {
      case LoggerFilterMode.And:
        isPassed = conditions.every((item) => item === true);
        break;
      case LoggerFilterMode.Or:
        isPassed = conditions.some((item) => item === true);
        break;
      case LoggerFilterMode.Ignore:
        isPassed = conditions.every((item) => item === false);
        break;
      default:
        break;
    }
    return isPassed ? info : false;
  });

  /**
   * Format options for logger
   *
   * @param {string} [label] Label for logger
   */
  private logFormat(label?: string) {
    return format.combine(
      format.label({ label: label ? label : this.formatLabelTag() }),
      format.colorize(),
      format.timestamp(),
      format.prettyPrint(),
      format.splat(),
      this.checkFilter(),
      format.printf((info: TransformableInfo) => {
        return `${info.timestamp} [${info.label}] ${info.level} ${info.message}`;
      }),
    );
  }

  /**
   * Update label info
   *
   * If label exists it will replace data info
   *
   * @param {string[]} [data=[]] Info with connection and data
   * @param {string} [label] Custom label
   */
  setLabel(data: string[] = [], label?: string): void {
    this.tags = data;
    this.logger.format = this.logFormat(label);
  }

  /**
   * Update filter
   *
   * @param {LoggerFilter} data Filter options
   */
  setFilter(data: LoggerFilter): void {
    this.filter = data;
  }

  /**
   * Clear filter
   */
  clearFilter(): void {
    this.filter = {};
  }

  /**
   * Disable filter
   */
  disable(): void {
    this.filter = { scope: [LoggerScope.None] };
  }

  /**
   * Get current filter
   *
   * @return {*}  {LoggerFilter} Logger filter
   */
  getFilter(): LoggerFilter {
    return this.filter;
  }

  /**
   * Return aray of tags, for modify, e.g.
   *
   * @return {*}  {string[]} Array of tags
   */
  getTags(): string[] {
    return this.tags;
  }

  /**
   * Log info message
   *
   * @param {string} message Info message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  info(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.logger.info(message, { type: LoggerType.Info, scope });
  }

  /**
   * Log warning
   *
   * @param {string} message Warning message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  warn(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.logger.warn(message, { type: LoggerType.Warning, scope });
  }

  /**
   * Log error
   *
   * @param {string} message Error message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  error(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.logger.error(message, { type: LoggerType.Error, scope });
  }

  /**
   * Destroy
   */
  destroy(): void {
    this.logger.destroy();
  }
}
