import path from 'path';
import { createLogger, format, transports, Logger as WinstonLogger } from 'winston';
import { TransformableInfo } from 'logform';

/**
 * File transport type for Winston logger
 */
type FileTransport = InstanceType<typeof transports.File>;

/**
 * Logger runtime interface
 */
interface LoggerRuntime {
  /**
   * Winston logger instance
   *
   * @type {WinstonLogger}
   */
  logger: WinstonLogger;
  /**
   * Array of file transports for the logger
   *
   * @type {FileTransport[]}
   */
  files: FileTransport[];
  /**
   * Number of references to this runtime
   *
   * @type {number}
   */
  references: number;
  /**
   * Promise that resolves when the runtime is ready
   *
   * @type {Promise<void>}
   */
  ready: Promise<void>;
  /**
   * Promise that resolves when the runtime is closing
   *
   * @type {Promise<void>}
   */
  closing?: Promise<void>;
}

/**
 * Map of logger runtimes keyed by environment and log directory
 */
const runtimes = new Map<string, LoggerRuntime>();

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
 * Create runtime format for Winston logger
 *
 * @returns The Winston logger format configuration
 */
const createLogFormat = () => {
  return format.combine(
    format.colorize(),
    format.timestamp(),
    format.prettyPrint(),
    format.splat(),
    format.printf((info: TransformableInfo) => {
      const label = typeof info.label === 'string' ? info.label : '-';
      return `${info.timestamp} [${label}] ${info.level} ${info.message}`;
    }),
  );
};

/**
 * Request a logger runtime
 *
 * @returns The runtime key and acquired logger runtime
 */
const acquireLoggerRuntime = (): { runtimeKey: string; runtime: LoggerRuntime } => {
  const environment = process.env.ENV ?? '';
  const logDirectory = process.env.LOGS_DIR ?? '';
  const runtimeKey = `${environment}\0${path.resolve(__dirname, logDirectory)}`;
  let loggerRuntime = runtimes.get(runtimeKey);
  if (loggerRuntime?.closing) {
    throw new Error('[logger] runtime is closing');
  }
  if (!loggerRuntime) {
    const logger = createLogger({ format: createLogFormat(), exitOnError: false });
    const files: FileTransport[] = [];
    const fileReadyPromises: Promise<void>[] = [];
    logger.on('error', (error: Error) => {
      process.stderr.write(`[logger] transport error: ${error.message}\n`);
    });
    const addFile = (filePath: string, logLevel?: LoggerType, shouldHandleExceptions = false) => {
      const fileTransport = new transports.File({ filename: filePath, level: logLevel, handleExceptions: shouldHandleExceptions });
      files.push(fileTransport);
      fileReadyPromises.push(
        new Promise<void>((resolve) => {
          let isSettled = false;
          const resolveWhenReady = () => {
            if (!isSettled) {
              isSettled = true;
              resolve();
            }
          };
          fileTransport.once('open', resolveWhenReady);
          fileTransport.once('error', resolveWhenReady);
        }),
      );
      logger.add(fileTransport);
    };
    if (environment === 'development') {
      logger.add(new transports.Console());
      addFile(path.join(__dirname, logDirectory, 'all.log'));
    } else {
      addFile(path.join(__dirname, logDirectory, 'info.log'), LoggerType.Info);
      addFile(path.join(__dirname, logDirectory, 'warnings.log'), LoggerType.Warning);
      addFile(path.join(__dirname, logDirectory, 'errors.log'), LoggerType.Error, true);
    }
    loggerRuntime = { logger, files, references: 0, ready: Promise.all(fileReadyPromises).then(() => undefined) };
    runtimes.set(runtimeKey, loggerRuntime);
  }
  loggerRuntime.references++;
  return { runtimeKey, runtime: loggerRuntime };
};

/**
 * Free a logger runtime
 *
 * @param runtimeKey The key of the logger runtime
 * @param loggerRuntime The logger runtime to free
 * @returns A promise that resolves when the logger runtime is freed
 */
const releaseLoggerRuntime = (runtimeKey: string, loggerRuntime: LoggerRuntime): Promise<void> => {
  loggerRuntime.references--;
  if (loggerRuntime.references > 0) {
    return Promise.resolve();
  }
  if (loggerRuntime.closing) {
    return loggerRuntime.closing;
  }
  loggerRuntime.closing = (async () => {
    try {
      await loggerRuntime.ready;
      const transportClosePromises = loggerRuntime.files.map(
        (fileTransport) =>
          new Promise<void>((resolve) => {
            fileTransport.once('closed', resolve);
          }),
      );
      loggerRuntime.logger.close();
      await Promise.all(transportClosePromises);
    } finally {
      runtimes.delete(runtimeKey);
    }
  })();
  return loggerRuntime.closing;
};

/**
 * Custom logger
 *
 * @export
 * @class Logger
 */
export class Logger {
  /**
   * Current filter for logger
   *
   * @private
   * @type {LoggerFilter}
   */
  private filter: LoggerFilter = {};

  /**
   * Logger instance ID
   *
   * @private
   * @type {string}
   */
  private runtimeKey: string;

  /**
   * Logger runtime instance
   *
   * @private
   * @type {LoggerRuntime}
   */
  private runtime: LoggerRuntime;

  /**
   * Custom label for the logger
   *
   * @private
   * @type {string}
   */
  private label?: string;

  /**
   * Destroy action promise
   *
   * @private
   * @type {Promise<void>}
   */
  private destroyAction?: Promise<void>;

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
    const acquired = acquireLoggerRuntime();
    this.runtimeKey = acquired.runtimeKey;
    this.runtime = acquired.runtime;
    if (label) {
      this.setLabel(this.tags, label);
    }
    if (process.env.ENV === 'development') {
      this.filter.type = [LoggerType.All];
    }
  }

  /**
   * Check whether the filter has no configured criteria
   *
   * @param {LoggerFilter} loggerFilter Filter to check
   * @returns {boolean} True when the filter is empty
   */
  private isFilterEmpty(loggerFilter: LoggerFilter): boolean {
    for (const filterPropertyName in loggerFilter) {
      return false;
    }
    return true;
  }

  /**
   * Format label with connection info
   *
   * @returns {string} Formatted log label
   */
  private formatLogLabel(): string {
    let label = '-';
    if (this.tags.length > 0) {
      label = this.tags[0];
      for (let tagIndex = 1; tagIndex < this.tags.length; tagIndex++) {
        label = label.concat(`|${this.tags[tagIndex]}`);
      }
    }
    return label;
  }

  /**
   * Check whether a log entry satisfies the configured filters
   *
   * @param {LoggerType} logType Log level
   * @param {LoggerScope} logScope Log scope
   * @param {string} logMessage Log message
   * @returns {boolean} True when the log entry passes the filters
   */
  private matchesFilter(logType: LoggerType, logScope: LoggerScope, logMessage: string): boolean {
    if (this.isFilterEmpty(this.filter)) {
      return true;
    }
    const filterMode = this.filter.mode ? this.filter.mode : LoggerFilterMode.And;
    const conditions: boolean[] = [];
    if (this.filter.scope) {
      if (this.filter.scope.includes(LoggerScope.None)) {
        return false;
      }
      if (this.filter.scope.includes(LoggerScope.All)) {
        conditions.push(true);
      } else {
        conditions.push(this.filter.scope.includes(logScope));
      }
    }
    if (this.filter.type) {
      if (this.filter.type.includes(LoggerType.All)) {
        conditions.push(true);
      } else {
        conditions.push(this.filter.type.includes(logType));
      }
    }
    if (this.filter.tags && this.tags) {
      for (let tagIndex = 0; tagIndex < this.filter.tags.length; tagIndex++) {
        conditions.push(this.filter.tags[tagIndex] === this.tags[tagIndex]);
      }
    }
    if (this.filter.contains) {
      conditions.push(logMessage.indexOf(this.filter.contains) >= 0);
    }
    let isFilterSatisfied = false;
    switch (filterMode) {
      case LoggerFilterMode.And:
        isFilterSatisfied = conditions.every((conditionMet) => conditionMet === true);
        break;
      case LoggerFilterMode.Or:
        isFilterSatisfied = conditions.some((conditionMet) => conditionMet === true);
        break;
      case LoggerFilterMode.Ignore:
        isFilterSatisfied = conditions.every((conditionMet) => conditionMet === false);
        break;
      default:
        break;
    }
    return isFilterSatisfied;
  }

  /**
   * Write log message
   *
   * @private
   * @param {LoggerType} logType Log level
   * @param {string} logMessage Log message
   * @param {LoggerScope} logScope Log scope
   */
  private writeLog(logType: LoggerType, logMessage: string, logScope: LoggerScope): void {
    if (!this.destroyAction && this.matchesFilter(logType, logScope, logMessage)) {
      this.runtime.logger.log({
        level: logType,
        message: logMessage,
        type: logType,
        scope: logScope,
        label: this.label ?? this.formatLogLabel(),
      });
    }
  }

  /**
   * Update label info
   *
   * If a custom label is set, it replaces the tag-based label
   *
   * @param {string[]} [tags=[]] Connection and client tags
   * @param {string} [label] Custom label
   */
  setLabel(tags: string[] = [], label?: string): void {
    this.tags = tags;
    this.label = label || undefined;
  }

  /**
   * Update filter
   *
   * @param {LoggerFilter} filter Logger filter options
   */
  setFilter(filter: LoggerFilter): void {
    this.filter = filter;
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
   * @returns {LoggerFilter} Current logger filter
   */
  getFilter(): LoggerFilter {
    return this.filter;
  }

  /**
   * Return tags for inspection or modification
   *
   * @returns {string[]} Current logger tags
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
    this.writeLog(LoggerType.Info, message, scope);
  }

  /**
   * Log warning
   *
   * @param {string} message Warning message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  warn(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.writeLog(LoggerType.Warning, message, scope);
  }

  /**
   * Log error
   *
   * @param {string} message Error message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  error(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.writeLog(LoggerType.Error, message, scope);
  }

  /**
   * Destroy
   */
  destroy(): Promise<void> {
    if (!this.destroyAction) {
      this.destroyAction = releaseLoggerRuntime(this.runtimeKey, this.runtime);
    }
    return this.destroyAction;
  }
}
