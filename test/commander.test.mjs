import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Commander, DisconnectReason } from '../dist/Commander.js';
import { Payload, PayloadType } from '../dist/Payload.js';

const logger = {
  info() {},
  warn() {},
  error() {},
};

function createCommander() {
  process.env.PULSE_INTERVAL = '3600000';
  process.env.PULSE_LIMIT = '3';
  process.env.REQUEST_TIMEOUT = '3600000';
  const connection = {
    onData: null,
    onClose: null,
    onError: null,
    send() {},
    close() {},
    destroy() {},
  };
  const options = {
    block: 128,
    commands: new Map(),
    serializer: {
      encode: () => Buffer.from('{}'),
      decode: () => Payload.create(PayloadType.Response, '', 0),
    },
    validator: {},
  };
  return new Commander('test', connection, {}, options, logger);
}

test('rejects fetch when the connection closes and only notifies once', async () => {
  const commander = createCommander();
  const pending = commander.fetch('status');
  const rejection = assert.rejects(pending, { message: 'closed' });
  let disconnects = 0;
  commander.onDisconnect = (reason) => {
    assert.equal(reason, DisconnectReason.Normal);
    disconnects++;
  };

  commander.onClose();
  commander.onClose();

  await rejection;
  assert.equal(disconnects, 1);
  assert.equal(commander.callbacks.size, 0);
  assert.equal(commander.timeouts.size, 0);
  commander.destroy();
});

test('passes disconnect payload to callback requests after removing pending state', () => {
  const commander = createCommander();
  let response;
  let requestId;
  requestId = commander.request('status', (payload) => {
    assert.equal(commander.callbacks.has(requestId), false);
    response = payload;
  });

  commander.onClose();

  assert.equal(response.id, requestId);
  assert.equal(response.name, 'status');
  assert.equal(response.error, 'closed');
  commander.destroy();
});

test('rejects fetch when explicitly cancelled', async () => {
  const commander = createCommander();
  const pending = commander.fetch('status');
  const id = Array.from(commander.callbacks.keys())[0];
  const rejection = assert.rejects(pending, { message: 'cancelled' });

  commander.cancelRequest(id);

  await rejection;
  assert.equal(commander.callbacks.has(id), false);
  commander.destroy();
});

test('notifies disconnect when explicitly destroyed and ignores later close', () => {
  const commander = createCommander();
  let disconnects = 0;
  commander.onDisconnect = () => disconnects++;

  commander.destroy();
  commander.onClose();

  assert.equal(disconnects, 1);
});

test('removes response callbacks before invoking them even when they throw', () => {
  const commander = createCommander();
  const id = commander.request('status', () => {
    throw new Error('consumer failure');
  });

  commander.onPayload(Payload.create(PayloadType.Response, 'status', id));

  assert.equal(commander.callbacks.has(id), false);
  assert.equal(commander.timeouts.has(id), false);
  commander.destroy();
});

test('returns a remote error when an async request task rejects', async () => {
  const commander = createCommander();
  const responses = [];
  try {
    commander.error = (payload, message) => responses.push({ id: payload.id, message });
    commander.options.commands.set('status', async () => {
      throw new Error('service unavailable');
    });

    commander.onPayload(Payload.create(PayloadType.Request, 'status', 7));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(responses, [{ id: 7, message: 'service unavailable' }]);
  } finally {
    commander.destroy();
  }
});

test('returns an error instead of leaving unknown requests to timeout', () => {
  const commander = createCommander();
  const responses = [];
  commander.error = (payload, message) => responses.push({ id: payload.id, message });

  commander.onPayload(Payload.create(PayloadType.Request, 'missing', 8));

  assert.deepEqual(responses, [{ id: 8, message: 'unknown request' }]);
  commander.destroy();
});
