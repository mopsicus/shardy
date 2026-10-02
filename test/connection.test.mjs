import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import net from 'node:net';
import { test } from 'node:test';
import { Connection, DEFAULT_SEND_BYTES } from '../dist/Connection.js';
import { TransportType } from '../dist/Transport.js';

const logger = {
  info() {},
  warn() {},
  error() {},
};

class FakeWebSocket extends EventEmitter {
  bufferedAmount = 0;
  sent = [];
  pending = [];
  closeCode;
  terminated = false;

  send(data, callback) {
    this.bufferedAmount += data.length;
    this.sent.push(data);
    this.pending.push({ data, callback });
  }

  completeNext() {
    const item = this.pending.shift();
    this.bufferedAmount -= item.data.length;
    item.callback();
  }

  close(code) {
    this.closeCode = code;
  }

  terminate() {
    this.terminated = true;
  }
}

test('bounds TCP writable buffering when the peer stops reading', async () => {
  let receiver;
  let acceptReceiver;
  const accepted = new Promise((resolve) => {
    acceptReceiver = resolve;
  });
  const server = net.createServer((socket) => {
    receiver = socket;
    socket.pause();
    acceptReceiver();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const clientSocket = net.createConnection(server.address().port, '127.0.0.1');
  try {
    await once(clientSocket, 'connect');
    await accepted;

    const connection = new Connection(clientSocket, TransportType.TCP, 128 * 1024);
    connection.setLogger(logger);
    let queueError;
    connection.onError = (error) => (queueError = error);
    const message = Buffer.alloc(64 * 1024);
    const sends = [];
    for (let index = 0; index < 2000 && !queueError; index++) {
      sends.push({ accepted: connection.send(message), writableLength: clientSocket.writableLength });
    }

    assert.ok(queueError, JSON.stringify(sends));
    assert.match(queueError.message, /outbound queue limit exceeded/);
    assert.equal(clientSocket.destroyed, true);
  } finally {
    receiver?.destroy();
    clientSocket.destroy();
    const closed = once(server, 'close');
    server.close();
    await closed;
  }
});

test('serializes WebSocket sends and closes after queued frames drain', () => {
  const socket = new FakeWebSocket();
  const connection = new Connection(socket, TransportType.WebSocket, 32);
  connection.setLogger(logger);

  connection.send(Buffer.from('first'));
  connection.send(Buffer.from('second'));
  assert.deepEqual(socket.sent.map((data) => data.toString()), ['first']);

  socket.completeNext();
  assert.deepEqual(socket.sent.map((data) => data.toString()), ['first', 'second']);
  connection.close();
  assert.equal(socket.closeCode, undefined);

  socket.completeNext();
  assert.equal(socket.closeCode, 1000);
});

test('terminates a WebSocket when queued bytes exceed the configured cap', () => {
  const socket = new FakeWebSocket();
  const connection = new Connection(socket, TransportType.WebSocket, 8);
  connection.setLogger(logger);
  let error;
  connection.onError = (value) => (error = value);

  assert.equal(connection.send(Buffer.alloc(4)), true);
  assert.equal(connection.send(Buffer.alloc(4)), true);
  assert.equal(connection.send(Buffer.alloc(1)), false);

  assert.match(error.message, /outbound queue limit exceeded/);
  assert.equal(socket.terminated, true);
});

test('uses a bounded default send queue', () => {
  assert.equal(DEFAULT_SEND_BYTES, 4 * 1024 * 1024);
});
