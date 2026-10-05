import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Commander, DisconnectReason } from '../dist/commander.js';
import { Payload, PayloadType } from '../dist/payload.js';

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
  assert.equal(commander.responseCallbacks.size, 0);
  assert.equal(commander.requestStartTimes.size, 0);
  commander.destroy();
});

test('passes disconnect payload to callback requests after removing pending state', () => {
  const commander = createCommander();
  let response;
  let requestId;
  requestId = commander.request('status', (payload) => {
    assert.equal(commander.responseCallbacks.has(requestId), false);
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
  const id = Array.from(commander.responseCallbacks.keys())[0];
  const rejection = assert.rejects(pending, { message: 'cancelled' });

  commander.cancelRequest(id);

  await rejection;
  assert.equal(commander.responseCallbacks.has(id), false);
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

test('preserves the reason when sending a kick', () => {
  const commander = createCommander();
  let disconnectReason;
  commander.onDisconnect = (reason) => (disconnectReason = reason);

  commander.kick(DisconnectReason.ServerDown);
  commander.onClose();

  assert.equal(disconnectReason, DisconnectReason.ServerDown);
  commander.destroy();
});

test('decodes the reason from a received kick block', () => {
  const commander = createCommander();
  let disconnectReason;
  commander.onDisconnect = (reason) => (disconnectReason = reason);

  commander.onKick({ body: Buffer.from(String(DisconnectReason.ServerDown)) });
  commander.onClose();

  assert.equal(disconnectReason, DisconnectReason.ServerDown);
  commander.destroy();
});

test('maps an invalid received kick reason to Unknown', () => {
  const commander = createCommander();
  let disconnectReason;
  commander.onDisconnect = (reason) => (disconnectReason = reason);

  commander.onKick({ body: Buffer.from('invalid') });
  commander.onClose();

  assert.equal(disconnectReason, DisconnectReason.Unknown);
  commander.destroy();
});

test('removes response callbacks before invoking them even when they throw', () => {
  const commander = createCommander();
  const id = commander.request('status', () => {
    throw new Error('consumer failure');
  });

  commander.onPayload(Payload.create(PayloadType.Response, 'status', id));

  assert.equal(commander.responseCallbacks.has(id), false);
  assert.equal(commander.requestStartTimes.has(id), false);
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
