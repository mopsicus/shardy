import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Logger, LoggerFilterMode, LoggerScope, LoggerType } from '../dist/logger.js';

test('shares Winston transports while keeping filters and labels scoped', async () => {
  const previousEnvironment = process.env.ENV;
  const previousLogDirectory = process.env.LOGS_DIR;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-logger-'));
  const logDirectory = path.relative(path.resolve('dist'), temporaryDirectory);
  process.env.ENV = 'development';
  process.env.LOGS_DIR = logDirectory;

  const first = new Logger(['first']);
  const second = new Logger(['second']);
  const runtime = first.runtime;
  const logged = [];
  const originalLog = runtime.logger.log;
  runtime.logger.log = (entry) => logged.push(entry);
  first.setFilter({ type: [LoggerType.Warning] });

  try {
    assert.equal(second.runtime, runtime);
    assert.equal(runtime.files.length, 1);
    assert.equal(runtime.references, 2);
    assert.notEqual(first.filter, second.filter);

    first.info('filtered');
    first.warn('first warning');
    second.info('second info');
    assert.deepEqual(
      logged.map(({ message, label }) => [message, label]),
      [
        ['first warning', 'first'],
        ['second info', 'second'],
      ],
    );

    await first.destroy();
    assert.equal(runtime.references, 1);
    second.info('still open');
    assert.equal(logged.at(-1).message, 'still open');

    runtime.logger.log = originalLog;
    await second.destroy();
    assert.equal(runtime.references, 0);
    assert.equal(runtime.logger.transports.length, 0);
  } finally {
    runtime.logger.log = originalLog;
    await first.destroy();
    await second.destroy();
    if (previousEnvironment === undefined) {
      delete process.env.ENV;
    } else {
      process.env.ENV = previousEnvironment;
    }
    if (previousLogDirectory === undefined) {
      delete process.env.LOGS_DIR;
    } else {
      process.env.LOGS_DIR = previousLogDirectory;
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('applies logger filters by type, scope, tags, message, and mode', async () => {
  const previousEnvironment = process.env.ENV;
  const previousLogDirectory = process.env.LOGS_DIR;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-logger-filters-'));
  const logDirectory = path.relative(path.resolve('dist'), temporaryDirectory);
  process.env.ENV = 'development';
  process.env.LOGS_DIR = logDirectory;
  const logger = new Logger(['service', 'client']);
  const captured = [];
  const originalLog = logger.runtime.logger.log;
  logger.runtime.logger.log = (entry) => captured.push(entry);

  try {
    logger.setFilter({
      type: [LoggerType.Warning],
      scope: [LoggerScope.System],
      tags: ['service', 'client'],
      contains: 'accepted',
      mode: LoggerFilterMode.And,
    });
    logger.warn('accepted warning', LoggerScope.System);
    logger.warn('accepted user warning', LoggerScope.User);
    logger.error('accepted system error', LoggerScope.System);
    logger.warn('rejected message', LoggerScope.System);
    assert.deepEqual(captured.map(({ message }) => message), ['accepted warning']);

    captured.length = 0;
    logger.setFilter({ type: [LoggerType.Error], contains: 'or-match', mode: LoggerFilterMode.Or });
    logger.error('error match');
    logger.info('or-match info');
    logger.warn('unmatched warning');
    assert.deepEqual(captured.map(({ message }) => message), ['error match', 'or-match info']);

    captured.length = 0;
    logger.setFilter({ type: [LoggerType.Error], contains: 'blocked', mode: LoggerFilterMode.Ignore });
    logger.info('allowed info');
    logger.error('blocked error');
    logger.info('blocked info');
    assert.deepEqual(captured.map(({ message }) => message), ['allowed info']);
  } finally {
    logger.runtime.logger.log = originalLog;
    await logger.destroy();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    if (previousEnvironment === undefined) {
      delete process.env.ENV;
    } else {
      process.env.ENV = previousEnvironment;
    }
    if (previousLogDirectory === undefined) {
      delete process.env.LOGS_DIR;
    } else {
      process.env.LOGS_DIR = previousLogDirectory;
    }
  }
});

test('writes production warnings and errors to files without console or info logs', async () => {
  const previousEnvironment = process.env.ENV;
  const previousLogDirectory = process.env.LOGS_DIR;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-logger-'));
  const logDirectory = path.relative(path.resolve('dist'), temporaryDirectory);
  process.env.ENV = 'production';
  process.env.LOGS_DIR = logDirectory;
  const logger = new Logger(['flush-test']);
  const runtime = logger.runtime;

  try {
    assert.equal(runtime.files.length, 2);
    assert.equal(runtime.logger.transports.some((transport) => transport.constructor.name === 'Console'), false);
    logger.info('ignored production info');
    logger.warn('production warning sentinel');
    logger.error('production error sentinel');
    await logger.destroy();

    const warningLog = fs.readFileSync(path.join(temporaryDirectory, 'warnings.log'), 'utf8');
    const errorLog = fs.readFileSync(path.join(temporaryDirectory, 'errors.log'), 'utf8');
    assert.match(warningLog, /production warning sentinel/);
    assert.match(errorLog, /production error sentinel/);
    assert.doesNotMatch(warningLog, /ignored production info/);
    assert.doesNotMatch(errorLog, /ignored production info/);
    assert.equal(fs.existsSync(path.join(temporaryDirectory, 'info.log')), false);
    assert.equal(runtime.logger.transports.length, 0);
  } finally {
    await logger.destroy();
    if (previousEnvironment === undefined) {
      delete process.env.ENV;
    } else {
      process.env.ENV = previousEnvironment;
    }
    if (previousLogDirectory === undefined) {
      delete process.env.LOGS_DIR;
    } else {
      process.env.LOGS_DIR = previousLogDirectory;
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
