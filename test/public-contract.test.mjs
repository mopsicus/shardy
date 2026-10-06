import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Block, BlockType, MAX_BLOCK_SIZE } from '../dist/block.js';
import { DisconnectReason } from '../dist/commander.js';
import { DefaultSerializer } from '../dist/default/default-serializer.js';
import { DefaultValidator } from '../dist/default/default-validator.js';
import { ExtensionMode } from '../dist/extension.js';
import { Logger, LoggerScope, LoggerType } from '../dist/logger.js';
import { Payload, PayloadType } from '../dist/payload.js';
import { Protocol } from '../dist/protocol.js';
import { Server } from '../dist/server.js';
import { Tools } from '../dist/tools.js';
import { Transport, TransportType } from '../dist/transport.js';
import { ValidatorState } from '../dist/validator.js';

const logger = {
  info() {},
  warn() {},
  error() {},
};

test('encodes and validates protocol blocks at documented boundaries', () => {
  const body = Buffer.from('wire-data');
  const encoded = Block.encode(BlockType.Data, body);

  assert.deepEqual(Block.decode(encoded), { type: BlockType.Data, body });
  assert.equal(Block.check(BlockType.Kick), true);
  assert.equal(Block.check(99), false);
  assert.equal(Block.validate(0), true);
  assert.equal(Block.validate(MAX_BLOCK_SIZE), true);
  assert.equal(Block.validate(-1), false);
  assert.equal(Block.validate(MAX_BLOCK_SIZE + 1), false);
  assert.equal(Block.validate(1.5), false);
  assert.equal(Block.encode(BlockType.Data, Buffer.alloc(MAX_BLOCK_SIZE + 1)).length, 0);
});

test('creates, serializes, decodes, and validates public payload data', () => {
  const serializer = new DefaultSerializer();
  const data = Buffer.from([0, 1, 2, 255]);
  const payload = Payload.create(PayloadType.Request, 'binary', 8, data);
  const encoded = Payload.encode(serializer, payload.type, payload.name, payload.id, payload.data);
  const decoded = Payload.decode(serializer, encoded);

  assert.deepEqual(decoded, payload);
  assert.equal(Payload.check(decoded), true);
  assert.equal(Payload.check({ ...decoded, id: -1 }), false);
  assert.equal(Payload.check({ ...decoded, data: 'custom serializer data' }), true);
  assert.deepEqual(Payload.create(PayloadType.Command, 'empty', 0), {
    type: PayloadType.Command,
    name: 'empty',
    id: 0,
    data: Buffer.alloc(0),
    error: '',
  });
});

test('generates default handshakes and validates their acknowledgements', () => {
  const validator = new DefaultValidator();
  const handshake = validator.handshake(Buffer.from('client-token'));
  const acknowledgement = validator.acknowledgement(handshake);
  const handshakeData = JSON.parse(handshake.toString());

  assert.equal(handshakeData.payload, 'client-token');
  assert.equal(validator.verifyHandshake(handshake), ValidatorState.Success);
  assert.equal(validator.verifyAcknowledgement(acknowledgement), ValidatorState.Success);
  assert.equal(validator.verifyHandshake(Buffer.from('invalid-json')), ValidatorState.Failed);
  assert.equal(validator.verifyAcknowledgement(Buffer.from('[]')), ValidatorState.Failed);
});

test('dispatches documented protocol frames and enforces protocol states', () => {
  const sent = [];
  let closeCount = 0;
  let destroyCount = 0;
  const connection = {
    onData: null,
    onClose: null,
    onError: null,
    send(frame) {
      sent.push(frame);
    },
    close() {
      closeCount++;
    },
    destroy() {
      destroyCount++;
    },
  };
  const protocol = new Protocol(connection, logger, 32);
  const received = [];
  protocol.onBlock = (block) => received.push(block);

  connection.onData(Block.encode(BlockType.Data, Buffer.from('before-handshake')));
  assert.equal(received.length, 0);
  connection.onData(Block.encode(BlockType.Handshake, Buffer.from('hello')));
  assert.equal(received[0].type, BlockType.Handshake);
  connection.onData(Block.encode(BlockType.HandshakeAcknowledgement, Buffer.from('accepted')));
  connection.onData(Block.encode(BlockType.Data, Buffer.from('after-handshake')));
  assert.equal(received.at(-1).body.toString(), 'after-handshake');

  protocol.send(Buffer.from('data'));
  protocol.heartbeat();
  protocol.handshake(Buffer.from('client-handshake'));
  protocol.acknowledge(Buffer.from('server-ack'));
  protocol.kick(DisconnectReason.Normal);
  assert.deepEqual(
    sent.map((frame) => Block.decode(frame).type),
    [BlockType.Data, BlockType.Heartbeat, BlockType.Handshake, BlockType.HandshakeAcknowledgement, BlockType.Kick],
  );
  assert.equal(Block.decode(sent.at(-1)).body.toString(), String(DisconnectReason.Normal));

  protocol.disconnect();
  assert.equal(closeCount, 1);
  protocol.destroy();
  assert.equal(destroyCount, 1);
});

test('dispatches transport frames and closes or destroys the connection', () => {
  const sent = [];
  let closeCount = 0;
  let destroyCount = 0;
  const connection = {
    onData: null,
    onClose: null,
    onError: null,
    send(frame) {
      sent.push(frame);
    },
    close() {
      closeCount++;
    },
    destroy() {
      destroyCount++;
    },
  };
  const transport = new Transport(connection, logger, 32);
  const frame = Block.encode(BlockType.Data, Buffer.from('transport-data'));

  transport.dispatch(frame);
  assert.deepEqual(sent, [frame]);
  transport.close();
  transport.dispatch(frame);
  assert.equal(closeCount, 1);
  assert.equal(sent.length, 1);
  transport.destroy();
  assert.equal(destroyCount, 1);
});

test('provides stable utility ids, module tags, and recursive file discovery', () => {
  const id = Tools.generateId(32);
  assert.equal(id.length, 32);
  assert.match(id, /^[A-Za-z0-9]+$/);
  assert.equal(Tools.generateId(0), '');
  assert.equal(Tools.getTag({ filename: '/tmp/MyModule.js' }), 'mymodule');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-tools-'));
  try {
    fs.mkdirSync(path.join(directory, 'nested'));
    fs.writeFileSync(path.join(directory, 'root.txt'), 'root');
    fs.writeFileSync(path.join(directory, 'nested', 'child.txt'), 'child');
    fs.writeFileSync(path.join(directory, '.hidden'), 'ignored');
    assert.deepEqual(Tools.walk(directory).sort(), [path.join(directory, 'nested', 'child.txt'), path.join(directory, 'root.txt')]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('registers extensions once and applies server log filters', async () => {
  const previousEnvironment = { ENV: process.env.ENV, LOGS_DIR: process.env.LOGS_DIR };
  const logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-server-api-'));
  process.env.ENV = 'development';
  process.env.LOGS_DIR = path.relative(path.resolve('dist'), logDirectory);
  const service = {
    name: 'server-api-test',
    transport: TransportType.TCP,
    async onConnect() {},
    async onDisconnect() {},
    async onReady() {},
    async onListening() {},
    async onError() {},
    async onClose() {},
  };
  const server = new Server('127.0.0.1', 0, service, {
    validator: {},
    serializer: {},
  });
  server.log.disable();
  let initCount = 0;
  const extensionFilters = [];
  const extension = {
    name: 'api-test-extension',
    mode: ExtensionMode.Before,
    log: {
      setFilter(filter) {
        extensionFilters.push(filter);
      },
      clearFilter() {
        extensionFilters.push(null);
      },
    },
    async init() {
      initCount++;
    },
  };

  try {
    await server.use(extension);
    await server.use(extension);
    const filter = { contains: 'server-api' };
    await server.setFilter(filter);
    assert.deepEqual(server.log.getFilter(), filter);
    assert.deepEqual(extensionFilters, [filter]);
    await server.clearFilter();
    assert.deepEqual(server.log.getFilter(), {});
    assert.deepEqual(extensionFilters, [filter, null]);
    assert.equal(initCount, 1);
  } finally {
    await server.log.destroy();
    fs.rmSync(logDirectory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('updates logger labels, filters, tags, and log levels', async () => {
  const previousEnvironment = { ENV: process.env.ENV, LOGS_DIR: process.env.LOGS_DIR };
  const logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-logger-api-'));
  process.env.ENV = 'development';
  process.env.LOGS_DIR = path.relative(path.resolve('dist'), logDirectory);
  const log = new Logger(['initial-tag']);
  const captured = [];
  const originalLog = log.runtime.logger.log;
  log.runtime.logger.log = (entry) => captured.push(entry);

  try {
    log.setLabel(['service', 'client'], 'custom-label');
    assert.deepEqual(log.getTags(), ['service', 'client']);
    log.setFilter({ contains: 'keep' });
    log.info('discard this message');
    log.info('keep info', LoggerScope.System);
    log.warn('keep warning');
    log.error('keep error');
    assert.deepEqual(captured.map(({ message, type, label }) => [message, type, label]), [
      ['keep info', LoggerType.Info, 'custom-label'],
      ['keep warning', LoggerType.Warning, 'custom-label'],
      ['keep error', LoggerType.Error, 'custom-label'],
    ]);

    log.clearFilter();
    assert.deepEqual(log.getFilter(), {});
    log.disable();
    log.info('disabled');
    assert.equal(captured.length, 3);
  } finally {
    log.runtime.logger.log = originalLog;
    await log.destroy();
    fs.rmSync(logDirectory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});