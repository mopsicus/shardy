import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Server } from '../dist/Server.js';
import { TransportType } from '../dist/Transport.js';
import { DisconnectReason } from '../dist/Commander.js';

function createServer(service = {}) {
  const originalEnvironment = {
    ENV: process.env.ENV,
    LOGS_DIR: process.env.LOGS_DIR,
  };
  process.env.ENV = 'development';
  process.env.LOGS_DIR = '.';
  const defaultService = {
    name: 'lifecycle-test',
    transport: TransportType.TCP,
    async onConnect() {},
    async onDisconnect() {},
    async onReady() {},
    async onListening() {},
    async onError() {},
    async onClose() {},
  };
  const server = new Server('127.0.0.1', 0, { ...defaultService, ...service }, { validator: {}, serializer: {} });
  server.log.disable();
  return {
    server,
    async restore() {
      await server.log.destroy();
      for (const [key, value] of Object.entries(originalEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
}

test('awaits lifecycle hooks in Before, Service, After order and continues after rejection', async () => {
  const trace = [];
  const { server, restore } = createServer({
    async onListening() {
      trace.push('service');
    },
  });
  server.extensionsBefore.push({
    async onServiceListening() {
      trace.push('before:start');
      await Promise.resolve();
      trace.push('before:end');
      throw new Error('extension failure');
    },
  });
  server.extensionsAfter.push({
    async onServiceListening() {
      trace.push('after');
    },
  });

  try {
    await server.onListening();
    assert.deepEqual(trace, ['before:start', 'before:end', 'service', 'after']);
  } finally {
    await restore();
  }
});

test('runs disconnect cleanup once and removes the client after hooks finish', async () => {
  const trace = [];
  let destroys = 0;
  const { server, restore } = createServer({
    async onDisconnect() {
      trace.push('service');
    },
  });
  const client = {
    id: 'client-1',
    log: { setFilter() {}, clearFilter() {} },
    async destroy() {
      destroys++;
      trace.push('destroy');
    },
  };
  server.list.set(client.id, client);
  server.pendings.add(client.id);
  server.extensionsBefore.push({
    async onClientDisconnect() {
      trace.push('before');
    },
  });
  server.extensionsAfter.push({
    async onClientDisconnect() {
      trace.push('after');
    },
  });

  try {
    server.onDisconnect(client.id, DisconnectReason.Normal);
    server.onDisconnect(client.id, DisconnectReason.Normal);
    await server.lifecycles.get(client.id);

    assert.deepEqual(trace, ['before', 'service', 'after', 'destroy']);
    assert.equal(destroys, 1);
    assert.equal(server.list.has(client.id), false);
    assert.equal(server.pendings.has(client.id), false);
  } finally {
    await restore();
  }
});
