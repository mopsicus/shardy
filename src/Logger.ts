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
const makeFormat = () => {
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
}

/**
 * Request a logger runtime
 * 
 * @returns An object containing the key and the logger runtime
 */
const requestLogger = (): { key: string; runtime: LoggerRuntime } => {
  const environment = process.env.ENV ?? '';
  const directory = process.env.LOGS_DIR ?? '';
  const key = `${environment}\0${path.resolve(__dirname, directory)}`;
  let runtime = runtimes.get(key);
  if (runtime?.closing) {
    throw new Error('[logger] runtime is closing');
  }
  if (!runtime) {
    const logger = createLogger({ format: makeFormat(), exitOnError: false });
    const files: FileTransport[] = [];
    const ready: Promise<void>[] = [];
    logger.on('error', (error: Error) => {
      process.stderr.write(`[logger] transport error: ${error.message}\n`);
    });
    const addFile = (filename: string, level?: LoggerType, handleExceptions = false) => {
      const file = new transports.File({ filename, level, handleExceptions });
      files.push(file);
      ready.push(
        new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          file.once('open', finish);
          file.once('error', finish);
        }),
      );
      logger.add(file);
    };
    if (environment === 'development') {
      logger.add(new transports.Console());
      addFile(path.join(__dirname, directory, 'all.log'));
    } else {
      addFile(path.join(__dirname, directory, 'info.log'), LoggerType.Info);
      addFile(path.join(__dirname, directory, 'warnings.log'), LoggerType.Warning);
      addFile(path.join(__dirname, directory, 'errors.log'), LoggerType.Error, true);
    }
    runtime = { logger, files, references: 0, ready: Promise.all(ready).then(() => undefined) };
    runtimes.set(key, runtime);
  }
  runtime.references++;
  return { key, runtime };
};

/**
 * Free a logger runtime
 * 
 * @param key The key of the logger runtime
 * @param runtime The logger runtime to free
 * @returns A promise that resolves when the logger runtime is freed
 */
const freeLogger = (key: string, runtime: LoggerRuntime): Promise<void> => {
  runtime.references--;
  if (runtime.references > 0) {
    return Promise.resolve();
  }
  if (runtime.closing) {
    return runtime.closing;
  }
  runtime.closing = (async () => {
    try {
      await runtime.ready;
      const closed = runtime.files.map((file) =>
          new Promise<void>((resolve) => {
            file.once('closed', resolve);
          }),
      );
      runtime.logger.close();
      await Promise.all(closed);
    } finally {
      runtimes.delete(key);
    }
  })();
  return runtime.closing;
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
  private id: string;

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
    const acquired = requestLogger();
    this.id = acquired.key;
    this.runtime = acquired.runtime;
    if (label) {
      this.setLabel(this.tags, label);
    }
    if (process.env.ENV === 'development') {
      this.filter.type = [LoggerType.All];
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
    let label = '-';
    if (this.tags.length > 0) {
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
  private checkFilter(type: LoggerType, scope: LoggerScope, message: string): boolean {
    if (this.isFilterEmpty(this.filter)) {
      return true;
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
        conditions.push(this.filter.scope.includes(scope));
      }
    }
    if (this.filter.type) {
      if (this.filter.type.includes(LoggerType.All)) {
        conditions.push(true);
      } else {
        conditions.push(this.filter.type.includes(type));
      }
    }
    if (this.filter.tags && this.tags) {
      for (let i = 0; i < this.filter.tags.length; i++) {
        conditions.push(this.filter.tags[i] === this.tags[i]);
      }
    }
    if (this.filter.contains) {
      conditions.push(message.indexOf(this.filter.contains) >= 0);
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
    return isPassed;
  }

  /**
   * Write log message
   *
   * @private
   * @param {LoggerType} level Log level
   * @param {string} message Log message
   * @param {LoggerScope} scope Log scope
   */
  private write(level: LoggerType, message: string, scope: LoggerScope): void {
    if (!this.destroyAction && this.checkFilter(level, scope, message)) {
      this.runtime.logger.log({ level, message, type: level, scope, label: this.label ?? this.formatLabelTag() });
    }
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
    this.label = label || undefined;
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
    this.write(LoggerType.Info, message, scope);
  }

  /**
   * Log warning
   *
   * @param {string} message Warning message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  warn(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.write(LoggerType.Warning, message, scope);
  }

  /**
   * Log error
   *
   * @param {string} message Error message
   * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
   */
  error(message: string, scope: LoggerScope = LoggerScope.User): void {
    this.write(LoggerType.Error, message, scope);
  }

  /**
   * Destroy
   */
  destroy(): Promise<void> {
    if (!this.destroyAction) {
      this.destroyAction = freeLogger(this.id, this.runtime);
    }
    return this.destroyAction;
  }
}
