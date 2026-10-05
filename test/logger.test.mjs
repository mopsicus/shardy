import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Logger, LoggerType } from '../dist/logger.js';

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

test('flushes production file transports on final release', async () => {
  const previousEnvironment = process.env.ENV;
  const previousLogDirectory = process.env.LOGS_DIR;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-logger-'));
  const logDirectory = path.relative(path.resolve('dist'), temporaryDirectory);
  process.env.ENV = 'production';
  process.env.LOGS_DIR = logDirectory;
  const logger = new Logger(['flush-test']);

  try {
    assert.equal(logger.runtime.files.length, 3);
    logger.info('flush sentinel');
    await logger.destroy();

    const infoLog = fs.readFileSync(path.join(temporaryDirectory, 'info.log'), 'utf8');
    assert.match(infoLog, /flush sentinel/);
    assert.equal(logger.runtime.logger.transports.length, 0);
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
