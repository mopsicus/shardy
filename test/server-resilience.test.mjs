import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { Block, BlockType } from '../dist/block.js';
import { Bot } from '../dist/bot.js';
import { DefaultSerializer } from '../dist/default/default-serializer.js';
import { DefaultValidator } from '../dist/default/default-validator.js';
import { Server } from '../dist/server.js';
import { TransportType } from '../dist/transport.js';

function withTimeout(promise, label, milliseconds = 10000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitForFrame(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) {
        return;
      }
      const bodyLength = (buffer[1] << 16) | (buffer[2] << 8) | buffer[3];
      const frameLength = 4 + bodyLength;
      if (buffer.length >= frameLength) {
        cleanup();
        resolve(Block.decode(buffer.subarray(0, frameLength)));
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Socket closed before handshake acknowledgement'));
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function connectRawClient(port, validator) {
  const socket = net.createConnection(port, '127.0.0.1');
  await withTimeout(once(socket, 'connect'), 'raw client connect');
  const acknowledgementPromise = waitForFrame(socket);
  socket.write(Block.encode(BlockType.Handshake, validator.handshake(Buffer.from('raw-test'))));
  const acknowledgement = await withTimeout(acknowledgementPromise, 'raw handshake');
  assert.equal(acknowledgement.type, BlockType.HandshakeAcknowledgement);
  socket.write(Block.encode(BlockType.HandshakeAcknowledgement, validator.acknowledgement(acknowledgement.body)));
  return socket;
}

test('serves ten Bots and survives malformed payloads, unknown commands, and fake packet flood', { timeout: 30000 }, async () => {
  const originalEnvironment = {
    ENV: process.env.ENV,
    LOGS_DIR: process.env.LOGS_DIR,
    PULSE_INTERVAL: process.env.PULSE_INTERVAL,
    PULSE_LIMIT: process.env.PULSE_LIMIT,
    REQUEST_TIMEOUT: process.env.REQUEST_TIMEOUT,
  };
  const logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shardy-resilience-'));
  process.env.ENV = 'development';
  process.env.LOGS_DIR = path.relative(path.resolve('dist'), logDirectory);
  process.env.PULSE_INTERVAL = '60000';
  process.env.PULSE_LIMIT = '3';
  process.env.REQUEST_TIMEOUT = '60000';

  const validator = new DefaultValidator();
  const serializer = new DefaultSerializer();
  const bots = [];
  const rawSockets = [];
  let resolveMessageCount;
  const service = {
    name: 'resilience-integration',
    transport: TransportType.TCP,
    async onConnect() {},
    async onDisconnect() {},
    async onReady() {},
    async onListening() {},
    async onError(error) {
      console.error(`[integration-service] ${error.message}`);
    },
    async onClose() {},
    messages: [],
  };
  const commands = new Map([
    [
      'echo',
      (commander, payload, targetService) => {
        const message = payload.data.toString('utf8');
        targetService.messages.push(message);
        server.log.info(`[integration-service] accepted ${message}`);
        if (targetService.messages.length >= 20) {
          resolveMessageCount?.();
        }
      },
    ],
  ]);
  const server = new Server('127.0.0.1', 0, service, {
    validator,
    serializer,
    block: 256,
    bytes: 4096,
    pendings: 64,
    commands,
  });
  server.log.info('[integration-service] starting resilience test');

  try {
    const listening = once(server.server, 'listening');
    await server.start();
    await withTimeout(listening, 'server listen');
    const port = server.server.address().port;

    const readyPromises = Array.from({ length: 10 }, (_, index) => {
      const bot = new Bot('127.0.0.1', port, TransportType.TCP, { validator, serializer }, Buffer.from(`bot-${index}`));
      bots.push(bot);
      const ready = new Promise((resolve, reject) => {
        bot.onReady = resolve;
        bot.onDisconnect = (reason) => reject(new Error(`Bot ${index} disconnected before ready: ${reason}`));
      });
      return { bot, ready };
    });

    await Promise.all(readyPromises.map(({ bot }) => bot.connect()));
    await Promise.all(readyPromises.map(({ ready }) => withTimeout(ready, 'Bot handshake')));
    server.log.info('[integration-service] all ten Bots are ready');

    let resolveInitialMessages;
    const initialMessages = new Promise((resolve) => {
      resolveInitialMessages = resolve;
    });
    const originalCommand = commands.get('echo');
    commands.set('echo', (commander, payload, targetService) => {
      originalCommand(commander, payload, targetService);
      if (targetService.messages.length >= 10) {
        resolveInitialMessages();
      }
    });

    await Promise.all(
      readyPromises.map(({ bot }, index) => bot.command('echo', Buffer.from(`from-bot-${index}`))),
    );
    await withTimeout(initialMessages, 'ten Bot command deliveries');
    assert.equal(new Set(service.messages).size, 10);

    await Promise.all(readyPromises.map(({ bot }) => bot.command('missing-command', Buffer.from('bad command'))));
    await Promise.all(
      readyPromises.map(({ bot }, index) => bot.command('echo', Buffer.from(`after-unknown-${index}`))),
    );
    await withTimeout(
      new Promise((resolve) => {
        resolveMessageCount = resolve;
        if (service.messages.length >= 20) {
          resolve();
        }
      }),
      'continued valid traffic',
    );
    assert.ok(readyPromises.every(({ bot }) => bot.isConnected));
    server.log.info('[integration-service] ten Bots remained healthy after unknown commands');

    for (const invalidBody of [Buffer.from('{'), Buffer.from('{}')]) {
      const socket = await connectRawClient(port, validator);
      rawSockets.push(socket);
      const closed = withTimeout(once(socket, 'close'), 'malformed peer close');
      socket.write(Block.encode(BlockType.Data, invalidBody));
      await closed;
      server.log.info('[integration-service] malformed peer was rejected');
    }

    const fakeSockets = await Promise.all(Array.from({ length: 24 }, () => connectRawClient(port, validator)));
    rawSockets.push(...fakeSockets);
    const fakeCloses = fakeSockets.map((socket) => withTimeout(once(socket, 'close'), 'oversized fake packet close'));
    const oversizedHeader = Buffer.from([BlockType.Data, 0, 1, 1]);
    for (const socket of fakeSockets) {
      socket.write(oversizedHeader);
    }
    await Promise.all(fakeCloses);

    assert.equal(server.server.listening, true);
    server.log.info('[integration-service] 24 oversized fake packets rejected; listener remains active');

    await readyPromises[0].bot.command('echo', Buffer.from('server-still-alive'));
    await withTimeout(
      new Promise((resolve) => {
        const check = () => {
          if (service.messages.includes('server-still-alive')) {
            resolve();
          } else {
            setImmediate(check);
          }
        };
        check();
      }),
      'post-flood valid command',
    );
    assert.ok(service.messages.includes('server-still-alive'));
  } finally {
    for (const socket of rawSockets) {
      socket.destroy();
    }
    await server.stop();
    await Promise.allSettled(bots.map((bot) => (bot.client ? bot.destroy() : Promise.resolve())));
    server.log.info('[integration-service] resilience test complete');
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(logDirectory, { recursive: true, force: true });
  }
});
