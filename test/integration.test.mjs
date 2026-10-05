import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { Bot } from '../dist/bot.js';
import { DefaultSerializer } from '../dist/default/default-serializer.js';
import { DefaultValidator } from '../dist/default/default-validator.js';
import { DisconnectReason } from '../dist/commander.js';
import { ExtensionMode } from '../dist/extension.js';
import { Server } from '../dist/server.js';
import { TransportType } from '../dist/transport.js';

const TEST_TIMEOUT = 12000;
const ENVIRONMENT_KEYS = ['ENV', 'LOGS_DIR', 'PULSE_INTERVAL', 'PULSE_LIMIT', 'REQUEST_TIMEOUT'];

function captureEnvironment() {
  return Object.fromEntries(ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnvironment(previousEnvironment) {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function withTimeout(promise, label, milliseconds = TEST_TIMEOUT) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function createHarness(name, { host = '127.0.0.1', port = 0, transport = TransportType.TCP, commands = new Map() } = {}) {
  const logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `shardy-${name}-`));
  process.env.ENV = 'development';
  process.env.LOGS_DIR = path.relative(path.resolve('dist'), logDirectory);
  process.env.PULSE_INTERVAL = '60000';
  process.env.PULSE_LIMIT = '3';
  process.env.REQUEST_TIMEOUT = '60000';

  const validator = new DefaultValidator();
  const serializer = new DefaultSerializer();
  const events = [];
  const listeningSignal = deferred();
  const readySignal = deferred();
  const disconnectSignal = deferred();
  const errorSignal = deferred();
  const service = {
    name,
    transport,
    events,
    async onConnect(client) {
      events.push(['connect', client]);
    },
    async onDisconnect(client, reason) {
      events.push(['disconnect', client, reason]);
      disconnectSignal.resolve({ client, reason });
    },
    async onReady(client) {
      events.push(['ready', client]);
      readySignal.resolve(client);
    },
    async onListening(host, port) {
      events.push(['listening', host, port]);
      listeningSignal.resolve({ host, port });
    },
    async onError(error) {
      events.push(['error', error]);
      errorSignal.resolve(error);
    },
    async onClose() {
      events.push(['close']);
    },
  };
  const server = new Server(host, port, service, { validator, serializer, commands });
  server.log.disable();

  return {
    server,
    service,
    validator,
    serializer,
    events,
    listening: listeningSignal.promise,
    ready: readySignal.promise,
    disconnected: disconnectSignal.promise,
    error: errorSignal.promise,
    async start() {
      const listening = once(server.server, 'listening');
      await server.start();
      await withTimeout(listening, `${name} listening`);
      return server.server.address().port;
    },
    async close() {
      if (server.server.listening) {
        await withTimeout(server.stop(), `${name} shutdown`);
      } else {
        await server.log.destroy();
      }
      fs.rmSync(logDirectory, { recursive: true, force: true });
    },
  };
}

function botFor(harness, port, handshakePayload = Buffer.from('integration-client')) {
  const bot = new Bot('127.0.0.1', port, harness.service.transport, {
    validator: harness.validator,
    serializer: harness.serializer,
  }, handshakePayload);
  bot.log.disable();
  return bot;
}

test('exchanges commands and requests over a real TCP connection and cleans up', { timeout: 30000 }, async () => {
  const previousEnvironment = captureEnvironment();
  const receivedCommand = deferred();
  const holdReceived = deferred();
  const releaseHeldRequest = deferred();
  const heldRequestCompleted = deferred();
  const serviceRequest = deferred();
  const serverRequestPayload = Buffer.from('server-question');
  const commands = new Map([
    ['notify', (_commander, payload) => receivedCommand.resolve(payload.data.toString())],
    ['echo', (commander, payload) => commander.response(payload, payload.data)],
    [
      'client-echo',
      (_commander, payload, targetService) => {
        const client = targetService.events.find(([event]) => event === 'ready')?.[1];
        client.response(payload, payload.data);
      },
    ],
    ['fail', (commander, payload) => commander.error(payload, 'rejected-by-service')],
    [
      'hold',
      async (commander, payload) => {
        holdReceived.resolve();
        await releaseHeldRequest.promise;
        commander.response(payload, payload.data);
        heldRequestCompleted.resolve();
      },
    ],
  ]);
  const harness = await createHarness('rpc-integration', { commands });
  const bots = [];

  try {
    const port = await harness.start();
    const bot = botFor(harness, port);
    bots.push(bot);
    const ready = new Promise((resolve, reject) => {
      bot.onReady = resolve;
      bot.onDisconnect = (reason) => reject(new Error(`Disconnected before ready: ${reason}`));
    });
    await bot.start();
    await withTimeout(ready, 'bot handshake readiness');
    await withTimeout(harness.ready, 'server client readiness');

    const logFilter = { contains: 'rpc-integration' };
    const connectedClient = harness.events.find(([event]) => event === 'ready')?.[1];
    assert.ok(connectedClient);
    await harness.server.setFilter(logFilter);
    assert.deepEqual(connectedClient.log.getFilter(), logFilter);
    await harness.server.clearFilter();
    assert.deepEqual(connectedClient.log.getFilter(), {});

    assert.equal(bot.isConnected, true);
    assert.ok(harness.events.some(([event]) => event === 'connect'));
    assert.ok(harness.events.some(([event]) => event === 'ready'));

    await bot.command('notify', Buffer.from('command-data'));
    assert.equal(await withTimeout(receivedCommand.promise, 'command delivery'), 'command-data');

    const echoed = await withTimeout(bot.fetch('echo', Buffer.from('request-data')), 'request response');
    assert.equal(echoed.name, 'echo');
    assert.equal(echoed.error, '');
    assert.equal(echoed.data.toString(), 'request-data');
    const clientResponse = await withTimeout(bot.fetch('client-echo', Buffer.from('Client.response')), 'Client.response result');
    assert.equal(clientResponse.data.toString(), 'Client.response');

    const concurrentResponses = await withTimeout(
      Promise.all([bot.fetch('echo', Buffer.from('parallel-one')), bot.fetch('echo', Buffer.from('parallel-two'))]),
      'concurrent request responses',
    );
    assert.deepEqual(concurrentResponses.map((response) => response.data.toString()), ['parallel-one', 'parallel-two']);
    assert.notEqual(concurrentResponses[0].id, concurrentResponses[1].id);

    const failedRequest = await withTimeout(bot.fetch('fail'), 'error response');
    assert.equal(failedRequest.error, 'rejected-by-service');
    const unknownRequest = await withTimeout(bot.fetch('unknown-request'), 'unknown request response');
    assert.equal(unknownRequest.error, 'unknown request');

    await bot.onRequest('server-question', async (payload) => {
      await bot.response(payload, Buffer.from('client-answer'));
    });
    const serverPeer = harness.events.find(([event]) => event === 'ready')?.[1];
    assert.ok(serverPeer);
    const clientRequest = serverPeer.fetch('server-question', serverRequestPayload);
    serviceRequest.resolve(await withTimeout(clientRequest, 'server-to-client request'));
    const serverResponse = await withTimeout(serviceRequest.promise, 'server request result');
    assert.equal(serverResponse.name, 'server-question');
    assert.equal(serverResponse.data.toString(), 'client-answer');

    let callbackResponse;
    const callbackResult = deferred();
    const requestId = await bot.request('echo', (payload) => {
      callbackResponse = payload;
      callbackResult.resolve();
    }, Buffer.from('callback-data'));
    assert.ok(Number.isSafeInteger(requestId));
    await withTimeout(callbackResult.promise, 'callback request response');
    assert.equal(callbackResponse.data.toString(), 'callback-data');

    let cancelledCallbackInvoked = false;
    const cancelledRequestId = await bot.request('hold', () => {
      cancelledCallbackInvoked = true;
    }, Buffer.from('cancelled-data'));
    await withTimeout(holdReceived.promise, 'cancellable request received');
    await bot.cancel(cancelledRequestId);
    releaseHeldRequest.resolve();
    await withTimeout(heldRequestCompleted.promise, 'cancelled request handler completion');
    assert.equal(cancelledCallbackInvoked, false);

    const disconnect = new Promise((resolve) => {
      bot.onDisconnect = resolve;
    });
    await bot.disconnect();
    assert.equal(await withTimeout(disconnect, 'bot disconnect'), DisconnectReason.Normal);
    assert.equal(bot.isConnected, false);
    assert.ok(harness.events.some(([event, _client, reason]) => event === 'disconnect' && reason === DisconnectReason.Normal));
  } finally {
    releaseHeldRequest.resolve();
    await Promise.allSettled(bots.map((bot) => bot.destroy()));
    await harness.close();
    restoreEnvironment(previousEnvironment);
  }
});

test('connects two independent servers through Bot and exchanges both RPC directions', { timeout: 30000 }, async () => {
  const previousEnvironment = captureEnvironment();
  const serverACommandsSeen = deferred();
  const serverBCommandsSeen = deferred();
  const serverACommands = new Map([
    ['from-b', (_commander, payload) => serverACommandsSeen.resolve(payload.data.toString())],
  ]);
  const serverBCommands = new Map([
    ['from-a', (_commander, payload) => serverBCommandsSeen.resolve(payload.data.toString())],
    ['b-echo', (commander, payload) => commander.response(payload, payload.data)],
  ]);
  const serverA = await createHarness('server-a', { commands: serverACommands });
  const serverB = await createHarness('server-b', { commands: serverBCommands });
  let link;

  try {
    const [portA, portB] = await Promise.all([serverA.start(), serverB.start()]);
    link = botFor(serverA, portB, Buffer.from('server-a-link'));
    const linkReady = new Promise((resolve, reject) => {
      link.onReady = resolve;
      link.onDisconnect = (reason) => reject(new Error(`Server link disconnected before readiness: ${reason}`));
    });
    await link.start();
    await withTimeout(linkReady, 'server A Bot readiness');
    await withTimeout(serverB.ready, 'server B client readiness');

    assert.equal(link.isConnected, true);
    assert.ok(serverB.events.some(([event]) => event === 'connect'));
    assert.ok(serverB.events.some(([event]) => event === 'ready'));

    await link.command('from-a', Buffer.from('A-to-B-command'));
    assert.equal(await withTimeout(serverBCommandsSeen.promise, 'A-to-B command'), 'A-to-B-command');

    const response = await withTimeout(link.fetch('b-echo', Buffer.from('A-to-B-request')), 'A-to-B request');
    assert.equal(response.data.toString(), 'A-to-B-request');

    await link.on('from-b', (payload) => serverACommandsSeen.resolve(payload.data.toString()));
    await link.onRequest('a-echo', (payload) => link.response(payload, Buffer.from(`A:${payload.data.toString()}`)));

    const clientAtB = serverB.events.find(([event]) => event === 'ready')?.[1];
    assert.ok(clientAtB);
    let removedHandlerCalls = 0;
    const removedHandler = () => removedHandlerCalls++;
    const retainedHandlerResult = deferred();
    await link.on('server-event', removedHandler);
    await link.on('server-event', (payload) => retainedHandlerResult.resolve(payload.data.toString()));
    await link.off('server-event', removedHandler);
    await clientAtB.command('server-event', Buffer.from('remaining-handler'));
    assert.equal(await withTimeout(retainedHandlerResult.promise, 'retained subscription handler'), 'remaining-handler');
    assert.equal(removedHandlerCalls, 0);

    await clientAtB.command('from-b', Buffer.from('B-to-A-command'));
    assert.equal(await withTimeout(serverACommandsSeen.promise, 'B-to-A command'), 'B-to-A-command');

    const reverseResponse = await withTimeout(clientAtB.fetch('a-echo', Buffer.from('B-to-A-request')), 'B-to-A request');
    assert.equal(reverseResponse.data.toString(), 'A:B-to-A-request');

    const clientCallbackResponse = deferred();
    const clientRequestId = await clientAtB.request(
      'a-echo',
      (payload) => clientCallbackResponse.resolve(payload),
      Buffer.from('B-to-A-callback-request'),
    );
    const clientCallbackPayload = await withTimeout(clientCallbackResponse.promise, 'Client callback request response');
    assert.ok(Number.isSafeInteger(clientRequestId));
    assert.equal(clientCallbackPayload.data.toString(), 'A:B-to-A-callback-request');

    await link.offRequest('a-echo');
    const unhandledServerRequest = await withTimeout(clientAtB.fetch('a-echo'), 'unsubscribed server request');
    assert.equal(unhandledServerRequest.error, 'unknown request');

    const disconnect = new Promise((resolve) => {
      link.onDisconnect = resolve;
    });
    await clientAtB.disconnect();
    assert.equal(await withTimeout(disconnect, 'server link disconnect'), DisconnectReason.Normal);
    const serverDisconnect = await withTimeout(serverB.disconnected, 'server B client disconnect');
    assert.equal(serverDisconnect.reason, DisconnectReason.Normal);
    assert.equal(link.isConnected, false);
    assert.ok(serverB.events.some(([event, _client, reason]) => event === 'disconnect' && reason === DisconnectReason.Normal));
    assert.equal(serverA.server.server.listening, true);
    assert.equal(serverB.server.server.listening, true);
    assert.notEqual(portA, portB);
  } finally {
    await Promise.allSettled([link?.destroy()]);
    await Promise.all([serverA.close(), serverB.close()]);
    restoreEnvironment(previousEnvironment);
  }
});

test('connects a Bot over the documented WebSocket transport', { timeout: 30000 }, async () => {
  const previousEnvironment = captureEnvironment();
  const received = deferred();
  const commands = new Map([['websocket-echo', (_commander, payload) => received.resolve(payload.data.toString())]]);
  const harness = await createHarness('websocket-integration', { transport: TransportType.WebSocket, commands });
  let bot;

  try {
    const port = await harness.start();
    bot = botFor(harness, port);
    const ready = new Promise((resolve, reject) => {
      bot.onReady = resolve;
      bot.onDisconnect = (reason) => reject(new Error(`WebSocket Bot disconnected before readiness: ${reason}`));
    });
    await bot.start();
    await withTimeout(ready, 'WebSocket handshake readiness');
    await bot.command('websocket-echo', Buffer.from('websocket-data'));
    assert.equal(await withTimeout(received.promise, 'WebSocket command delivery'), 'websocket-data');
    assert.equal(bot.isConnected, true);
  } finally {
    await Promise.allSettled([bot?.destroy()]);
    await harness.close();
    restoreEnvironment(previousEnvironment);
  }
});

test('stopping a server disconnects its connected Bot with ServerDown reason', { timeout: 30000 }, async () => {
  const previousEnvironment = captureEnvironment();
  const harness = await createHarness('shutdown-integration');
  let bot;

  try {
    const port = await harness.start();
    bot = botFor(harness, port);
    bot.onReady = () => {};
    await bot.start();
    await withTimeout(harness.ready, 'shutdown client readiness');
    const disconnected = new Promise((resolve) => {
      bot.onDisconnect = resolve;
    });
    await withTimeout(harness.server.stop(), 'server graceful shutdown');
    const reason = await withTimeout(disconnected, 'Bot disconnect after server shutdown');
    const serverSideDisconnect = await withTimeout(harness.disconnected, 'server-side shutdown disconnect');
    assert.deepEqual([reason, serverSideDisconnect.reason], [DisconnectReason.ServerDown, DisconnectReason.ServerDown]);
    assert.equal(bot.isConnected, false);
    assert.ok(harness.events.some(([event]) => event === 'close'));
  } finally {
    await Promise.allSettled([bot?.destroy()]);
    await harness.close();
    restoreEnvironment(previousEnvironment);
  }
});

test('runs registered Before and After extension hooks around service callbacks', { timeout: 30000 }, async () => {
  const previousEnvironment = captureEnvironment();
  const harness = await createHarness('extension-lifecycle');
  const extensionTrace = harness.events;
  const makeExtension = (name, mode) => ({
    name,
    mode,
    log: {
      setFilter() {},
      clearFilter() {},
    },
    async init() {
      extensionTrace.push([`${name}-init`]);
    },
    async onClientConnect() {
      extensionTrace.push([`${name}-connect`]);
    },
    async onClientDisconnect() {
      extensionTrace.push([`${name}-disconnect`]);
    },
    async onClientReady() {
      extensionTrace.push([`${name}-ready`]);
    },
    async onServiceListening() {
      extensionTrace.push([`${name}-listening`]);
    },
    async onServiceClose() {
      extensionTrace.push([`${name}-close`]);
    },
  });
  let bot;

  try {
    await harness.server.use(makeExtension('before', ExtensionMode.Before));
    await harness.server.use(makeExtension('after', ExtensionMode.After));
    const port = await harness.start();
    await withTimeout(harness.listening, 'service listening callback');
    bot = botFor(harness, port);
    const ready = new Promise((resolve, reject) => {
      bot.onReady = resolve;
      bot.onDisconnect = (reason) => reject(new Error(`Disconnected before readiness: ${reason}`));
    });
    await bot.start();
    await withTimeout(ready, 'extension client readiness');
    await withTimeout(harness.ready, 'extension service client readiness');

    const disconnect = new Promise((resolve) => {
      bot.onDisconnect = resolve;
    });
    await bot.disconnect();
    await withTimeout(disconnect, 'extension client disconnect');
    await withTimeout(harness.disconnected, 'extension service disconnect');
    await harness.close();

    const names = extensionTrace.map(([name]) => name);
    assert.deepEqual(names, [
      'before-init',
      'after-init',
      'before-listening',
      'listening',
      'after-listening',
      'before-connect',
      'connect',
      'after-connect',
      'before-ready',
      'ready',
      'after-ready',
      'before-disconnect',
      'disconnect',
      'after-disconnect',
      'before-close',
      'close',
      'after-close',
    ]);
  } finally {
    await Promise.allSettled([bot?.destroy()]);
    await harness.close();
    restoreEnvironment(previousEnvironment);
  }
});

test('reports a real listener error through the service lifecycle callback', { timeout: 30000 }, async () => {
  const previousEnvironment = captureEnvironment();
  const occupiedServer = net.createServer();
  occupiedServer.listen(0, '127.0.0.1');
  await withTimeout(once(occupiedServer, 'listening'), 'port reservation');
  const harness = await createHarness('listener-error', { port: occupiedServer.address().port });

  try {
    await harness.server.start();
    const error = await withTimeout(harness.error, 'service onError callback');
    assert.equal(error.code, 'EADDRINUSE');
    assert.ok(harness.events.some(([event, observedError]) => event === 'error' && observedError === error));
  } finally {
    await harness.close();
    const closed = once(occupiedServer, 'close');
    occupiedServer.close();
    await closed;
    restoreEnvironment(previousEnvironment);
  }
});