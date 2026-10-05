import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import { Block, BlockType, DEFAULT_BLOCK_SIZE, MAX_BLOCK_SIZE } from '../dist/block.js';
import { Protocol } from '../dist/protocol.js';
import { Server } from '../dist/server.js';
import { Transport, TransportType } from '../dist/transport.js';

function createConnection() {
  return {
    onData: null,
    onClose: null,
    onError: null,
    destroyed: false,
    send() {},
    close() {},
    destroy() {
      this.destroyed = true;
    },
  };
}

const logger = {
  info() {},
  warn() {},
  error() {},
};

test('dispatches a zero-length frame when its header arrives alone', () => {
  const connection = createConnection();
  const transport = new Transport(connection, logger);
  const received = [];
  transport.onData = (frame) => received.push(frame);

  connection.onData(Buffer.from([BlockType.Heartbeat, 0, 0, 0]));

  assert.equal(received.length, 1);
  assert.equal(received[0][0], BlockType.Heartbeat);
});

test('dispatches a zero-length frame after a fragmented header is completed', () => {
  const connection = createConnection();
  const transport = new Transport(connection, logger);
  const received = [];
  transport.onData = (frame) => received.push(frame);

  connection.onData(Buffer.from([BlockType.Heartbeat, 0]));
  assert.equal(received.length, 0);
  connection.onData(Buffer.from([0, 0]));

  assert.equal(received.length, 1);
  assert.equal(received[0][0], BlockType.Heartbeat);
});

test('parses a zero-length frame followed by a data frame in one chunk', () => {
  const connection = createConnection();
  const transport = new Transport(connection, logger);
  const received = [];
  transport.onData = (frame) => received.push(frame);

  connection.onData(Buffer.from([BlockType.Heartbeat, 0, 0, 0, BlockType.Data, 0, 0, 1, 42]));

  assert.equal(received.length, 2);
  assert.equal(received[0][0], BlockType.Heartbeat);
  assert.equal(received[1][4], 42);
});

test('destroys a peer that advertises a frame above the configured limit', () => {
  const connection = createConnection();
  const transport = new Transport(connection, logger, 8);
  let disconnects = 0;
  transport.onDisconnect = () => disconnects++;

  connection.onData(Buffer.from([BlockType.Data, 0, 0, 9]));
  connection.onClose();

  assert.equal(connection.destroyed, true);
  assert.equal(disconnects, 1);
});

test('does not send outgoing frames above the configured limit', () => {
  const connection = createConnection();
  const sent = [];
  connection.send = (data) => sent.push(data);
  const protocol = new Protocol(connection, logger, 4);

  protocol.send(Buffer.alloc(5));
  assert.equal(sent.length, 0);
  protocol.destroy();
});

test('rejects a frame limit larger than the wire format supports', () => {
  assert.equal(Block.validate(MAX_BLOCK_SIZE), true);
  assert.equal(Block.validate(MAX_BLOCK_SIZE + 1), false);
});

test('uses the documented default frame limit', () => {
  assert.equal(DEFAULT_BLOCK_SIZE, 1024 * 1024);
});

test('rejects connections above the pending handshake limit', { timeout: 10000 }, async () => {
  const originalEnvironment = {
    ENV: process.env.ENV,
    LOGS_DIR: process.env.LOGS_DIR,
    PULSE_INTERVAL: process.env.PULSE_INTERVAL,
  };
  process.env.ENV = 'development';
  process.env.LOGS_DIR = '.';
  process.env.PULSE_INTERVAL = '3600000';

  let acceptedClient;
  let acceptClient;
  let disconnectClient;
  const accepted = new Promise((resolve) => {
    acceptClient = resolve;
  });
  const disconnected = new Promise((resolve) => {
    disconnectClient = resolve;
  });
  const service = {
    name: 'transport-test',
    transport: TransportType.TCP,
    async onConnect(client) {
      acceptedClient = client;
      acceptClient(client);
    },
    async onDisconnect(client) {
      disconnectClient(client);
    },
    async onReady() {},
    async onListening() {},
    async onError() {},
    async onClose() {},
  };
  const options = {
    validator: {},
    serializer: {},
    block: 128,
    pendings: 1,
  };
  const server = new Server('127.0.0.1', 0, service, options);
  server.log.disable();
  const listening = once(server.server, 'listening');
  let first;
  let second;

  try {
    await server.start();
    await listening;
    const { port } = server.server.address();

    first = net.createConnection(port, '127.0.0.1');
    await once(first, 'connect');
    await accepted;
    assert.equal(server.pendingHandshakes.size, 1);

    second = net.createConnection(port, '127.0.0.1');
    await once(second, 'connect');
    await once(second, 'close');
    assert.equal(server.pendingHandshakes.size, 1);

    first.destroy();
    await once(first, 'close');
    await disconnected;
    assert.equal(server.pendingHandshakes.size, 0);

    const closed = once(server.server, 'close');
    await server.stop();
    await closed;
  } finally {
    first?.destroy();
    second?.destroy();
    if (acceptedClient?.isConnected) {
      await acceptedClient.destroy();
    }
    await server.log.destroy();
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
