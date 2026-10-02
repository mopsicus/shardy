import assert from 'node:assert/strict';
import { test } from 'node:test';
import shardy from '../dist/index.js';

test('exports the documented Block API with stable wire values', () => {
  const { Block, BlockType, BLOCK_HEAD, DEFAULT_BLOCK_SIZE, MAX_BLOCK_SIZE } = shardy;

  assert.equal(typeof Block, 'function');
  assert.equal(BLOCK_HEAD, 4);
  assert.equal(DEFAULT_BLOCK_SIZE, 1024 * 1024);
  assert.equal(MAX_BLOCK_SIZE, 0xffffff);
  assert.equal(BlockType.Handshake, 0x00);
  assert.equal(BlockType.HandshakeAcknowledgement, 0x01);
  assert.equal(BlockType.Heartbeat, 0x02);
  assert.equal(BlockType.Data, 0x03);
  assert.equal(BlockType.Kick, 0x04);
  assert.deepEqual(shardy.PayloadType, { 0: 'Request', 1: 'Command', 2: 'Response', Request: 0, Command: 1, Response: 2 });

  const frame = Block.encode(BlockType.Heartbeat, Buffer.alloc(0));
  assert.equal(frame[0], 0x02);
  assert.equal(frame.length, BLOCK_HEAD);
});
