import net from 'node:net';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { once } from 'node:events';
import { Connection, DEFAULT_SEND_BYTES } from '../dist/Connection.js';
import { TransportType } from '../dist/Transport.js';

const connectionCount = Number(process.env.BENCH_CONNECTIONS ?? 8);
const messagesPerConnection = Number(process.env.BENCH_MESSAGES ?? 1000);
const payloadSize = Number(process.env.BENCH_PAYLOAD_BYTES ?? 8192);
const bytes = Number(process.env.BENCH_MAX_QUEUE_BYTES ?? DEFAULT_SEND_BYTES);
const expectedBytes = connectionCount * messagesPerConnection * payloadSize;
const receivers = new Set();
const receiverClosePromises = [];
let receivedBytes = 0;

const server = net.createServer((socket) => {
  receivers.add(socket);
  receiverClosePromises.push(once(socket, 'close'));
  socket.pause();
  socket.on('data', (data) => {
    receivedBytes += data.length;
  });
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const clients = Array.from({ length: connectionCount }, () => net.createConnection(port, '127.0.0.1'));
await Promise.all(clients.map((socket) => once(socket, 'connect')));
while (receivers.size < connectionCount) {
  await new Promise((resolve) => setImmediate(resolve));
}

const connections = clients.map((socket) => new Connection(socket, TransportType.TCP, bytes));
const payload = Buffer.alloc(payloadSize, 0x61);
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
const started = performance.now();
let peakPendingBytes = 0;
let sentMessages = 0;
let rejectedConnections = 0;
const active = connections.map(() => true);

for (let message = 0; message < messagesPerConnection; message++) {
  for (let index = 0; index < connections.length; index++) {
    if (!active[index]) {
      continue;
    }
    if (connections[index].send(payload)) {
      sentMessages++;
    } else {
      active[index] = false;
      rejectedConnections++;
    }
  }
  const pendingBytes = connections.reduce((total, connection) => total + connection.pending(), 0);
  peakPendingBytes = Math.max(peakPendingBytes, pendingBytes);
}

const sendCompleted = performance.now();
for (const socket of clients) {
  if (!socket.destroyed) {
    socket.end();
  }
}
for (const receiver of receivers) {
  receiver.resume();
}
await Promise.all(receiverClosePromises);
const finished = performance.now();
delay.disable();

console.log(
  JSON.stringify(
    {
      connectionCount,
      messagesPerConnection,
      payloadSize,
      bytes,
      expectedBytes,
      sentMessages,
      rejectedConnections,
      receivedBytes,
      peakPendingBytes,
      sendDurationMs: Math.round(sendCompleted - started),
      deliveryDurationMs: Math.round(finished - sendCompleted),
      eventLoopDelayMeanMs: Number((delay.mean / 1e6).toFixed(2)),
      eventLoopDelayMaxMs: Number((delay.max / 1e6).toFixed(2)),
    },
    null,
    2,
  ),
);

for (const socket of clients) {
  socket.destroy();
}
for (const socket of receivers) {
  socket.destroy();
}
await new Promise((resolve) => server.close(resolve));
