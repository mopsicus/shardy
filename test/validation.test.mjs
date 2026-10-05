import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Block, BlockType } from '../dist/block.js';
import { Commander, CommanderMode, DisconnectReason } from '../dist/commander.js';
import { Payload, PayloadType } from '../dist/payload.js';
import { DefaultSerializer } from '../dist/default/default-serializer.js';
import { DefaultValidator } from '../dist/default/default-validator.js';
import { ValidatorState } from '../dist/validator.js';

const logger = {
  info() {},
  warn() {},
  error() {},
};

function createCommander({ mode = CommanderMode.Service, serializer, validator } = {}) {
  process.env.PULSE_INTERVAL = '3600000';
  process.env.PULSE_LIMIT = '3';
  process.env.REQUEST_TIMEOUT = '3600000';
  const sent = [];
  const connection = {
    onData: null,
    onClose: null,
    onError: null,
    closeCount: 0,
    send(data) {
      sent.push(data);
    },
    close() {
      this.closeCount++;
    },
    destroy() {},
  };
  const options = {
    block: 128,
    serializer: serializer ?? { encode: () => Buffer.alloc(0), decode: () => ({}) },
    validator: validator ?? {},
    commands: new Map(),
  };
  return {
    commander: new Commander('test', connection, {}, options, logger, mode),
    connection,
    sent,
  };
}

test('validates the runtime payload structure', () => {
  assert.equal(Payload.check({ type: PayloadType.Response, name: 'status', id: 1, data: Buffer.alloc(0), error: '' }), true);
  assert.equal(Payload.check({ type: PayloadType.Response, name: 'status', id: 1, data: Buffer.alloc(0) }), false);
  assert.equal(Payload.check(null), false);
});

test('rejects malformed JSON and non-object payloads in DefaultSerializer', () => {
  const serializer = new DefaultSerializer();

  assert.throws(() => serializer.decode(Buffer.from('{')));
  assert.throws(() => serializer.decode(Buffer.from('[]')), /JSON object/);
  assert.throws(() => serializer.decode(Buffer.from('{"data":42}')), /base64 string/);
});

test('returns Failed for malformed default handshake messages', () => {
  const validator = new DefaultValidator();

  assert.equal(validator.verifyHandshake(Buffer.from('{')), ValidatorState.Failed);
  assert.equal(validator.verifyAcknowledgement(Buffer.from('[]')), ValidatorState.Failed);
});

test('disconnects on a structurally invalid decoded payload', () => {
  const { commander, connection } = createCommander();

  assert.doesNotThrow(() => commander.onBlock({ type: BlockType.Data, body: Buffer.alloc(0) }));
  assert.equal(connection.closeCount, 1);
  commander.destroy();
});

test('validates the final acknowledgement on the service side', () => {
  let readyCount = 0;
  const validator = {
    verifyAcknowledgement: () => ValidatorState.Failed,
  };
  const { commander, connection } = createCommander({ validator });
  commander.onReady = () => readyCount++;

  commander.onAcknowledgement({ type: BlockType.HandshakeAcknowledgement, body: Buffer.from('{}') });

  assert.equal(connection.closeCount, 1);
  assert.equal(readyCount, 0);
  commander.destroy();
});

test('sets handshake failure reason when acknowledgement validation fails', () => {
  let disconnectReason;
  const validator = {
    verifyAcknowledgement: () => ValidatorState.Failed,
  };
  const { commander } = createCommander({ mode: CommanderMode.Bot, validator });
  commander.onDisconnect = (reason) => (disconnectReason = reason);

  commander.onAcknowledgement({ type: BlockType.HandshakeAcknowledgement, body: Buffer.from('{}') });
  commander.onClose();

  assert.equal(disconnectReason, DisconnectReason.Handshake);
  commander.destroy();
});

test('completes the DefaultValidator handshake across bot and service roles', () => {
  const validator = new DefaultValidator();
  const service = createCommander({ validator });
  const bot = createCommander({ mode: CommanderMode.Bot, validator });
  let serviceReady = false;
  let botReady = false;
  service.commander.onReady = () => (serviceReady = true);
  bot.commander.onReady = () => (botReady = true);

  service.commander.onHandshake({ type: BlockType.Handshake, body: validator.handshake() });
  const serverAcknowledgement = Block.decode(service.sent[0]).body;
  bot.commander.onAcknowledgement({ type: BlockType.HandshakeAcknowledgement, body: serverAcknowledgement });
  const clientAcknowledgement = Block.decode(bot.sent[0]).body;
  service.commander.onAcknowledgement({ type: BlockType.HandshakeAcknowledgement, body: clientAcknowledgement });

  assert.equal(botReady, true);
  assert.equal(serviceReady, true);
  service.commander.destroy();
  bot.commander.destroy();
});
