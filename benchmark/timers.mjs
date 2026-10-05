import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Client } from '../dist/Client.js';
import { Connection } from '../dist/Connection.js';
import { Logger } from '../dist/Logger.js';
import { TransportType } from '../dist/Transport.js';

const clientCount = Number(process.env.BENCH_CLIENTS ?? 1000);
const previousEnvironment = {
  ENV: process.env.ENV,
  LOGS_DIR: process.env.LOGS_DIR,
  PULSE_INTERVAL: process.env.PULSE_INTERVAL,
  PULSE_LIMIT: process.env.PULSE_LIMIT,
  REQUEST_TIMEOUT: process.env.REQUEST_TIMEOUT,
};
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-timers-'));
process.env.ENV = 'development';
process.env.LOGS_DIR = path.relative(path.resolve('dist'), temporaryDirectory);
process.env.PULSE_INTERVAL = '60000';
process.env.PULSE_LIMIT = '3';
process.env.REQUEST_TIMEOUT = '60000';

class FakeSocket extends EventEmitter {
  write() {
    return true;
  }

  end() {}

  destroy() {}
}

const options = {
  block: 128,
  commands: new Map(),
  serializer: { encode: () => Buffer.alloc(0), decode: () => ({}) },
  validator: {},
};
const clients = [];
const delay = monitorEventLoopDelay({ resolution: 10 });
const before = process.memoryUsage();
delay.enable();
const started = performance.now();

try {
  for (let index = 0; index < clientCount; index++) {
    const logger = new Logger([`timer-bench-${index}`]);
    logger.disable();
    clients.push(new Client(new Connection(new FakeSocket(), TransportType.TCP), `timer-${index}`, logger, {}, options));
  }
  const created = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterHold = process.memoryUsage();
  const teardownStarted = performance.now();
  await Promise.all(clients.map((client) => client.destroy()));
  const finished = performance.now();
  delay.disable();

  console.log(
    JSON.stringify(
      {
        clientCount,
        timersPerClient: 2,
        createDurationMs: Math.round(created - started),
        teardownDurationMs: Math.round(finished - teardownStarted),
        rssDeltaBytes: afterHold.rss - before.rss,
        heapUsedDeltaBytes: afterHold.heapUsed - before.heapUsed,
        externalDeltaBytes: afterHold.external - before.external,
        eventLoopDelayMeanMs: Number.isFinite(delay.mean) ? Number((delay.mean / 1e6).toFixed(2)) : null,
        eventLoopDelayMaxMs: Number.isFinite(delay.max) ? Number((delay.max / 1e6).toFixed(2)) : null,
      },
      null,
      2,
    ),
  );
} finally {
  delay.disable();
  await Promise.all(clients.map((client) => client.destroy()));
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
