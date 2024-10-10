# 🧱 Block

The `Block` is one of the main parts of Shardy - it encodes and decodes raw data.

Block is composed of two parts: **header** and **body**. The header part describes type and length of the block while body contains the binary payload.

### Structure

*type* – block type, 1 byte
- 0x01: handshake – handshake request from client to server and handshake response
- 0x02: handshake acknowledgement – handshake acknowledgement on request
- 0x03: heartbeat – empty block for check connection heartbeat
- 0x04: data – block with some data
- 0x05: kick – disconnect signal
  
*length* – length of body, 3 bytes big-endian integer

*body* – binary payload

All transmitted data encoded to `Buffer` and decoded to `BlockData` in [Protocol](#️-protocol), from where it is futher passed to [Commander](#-commander).

```ts
/**
 * Block result structure after decode
 */
export interface BlockData {
  type: BlockType;
  body: Buffer;
}

/**
 * Block type to encode
 */
export enum BlockType {
  /**
   * Handshake process
   */
  Handshake,

  /**
   * Acknowledgement for success verify
   */
  HandshakeAcknowledgement,

  /**
   * Ping
   */
  Heartbeat,

  /**
   * Data for command, request, response
   */
  Data,

  /**
   * Kick from server, disconnect
   */
  Kick,
}
```

The [`Protocol`](#️-protocol) receives the type of received block and switch [`ProtocolState`](#protocolstate) if necessary, or passes the data to the `Commander` for block processing, handshaking or disconnection.

`Block` contains 3 static methods:

```ts
/**
 * Encode block for transporting
 *
 * @param {BlockType} type Block type: data, kick or heartbeat
 * @param {Buffer} body Body to send
 * @return {*}  {Buffer} Encoded type + body
 */
static encode(type: BlockType, body: Buffer): Buffer;

/**
 * Decode block data
 *
 * @param {Buffer} data Buffer with data to decode
 * @return {*}  {BlockData} Result with type as BlockType and body as Buffer
 */
static decode(data: Buffer): BlockData;

/**
 * Check received block
 *
 * @param {BlockType} type Byte index for BlockType
 * @return {*}  {boolean} Is correct block or not
 */
static check(type: BlockType): boolean;  

```

# 🤖 Bot

`Bot` is a wrapper for the [`Client`](#-client) and [`Connection`](#-connection) classes with a few useful methods to make connecting to another Shardy service more convenient.

```ts
import { Bot } from 'shardy';

const bot = new Bot("127.0.0.1", 3001, TransportType.TCP, options);
bot.onConnect = () => {
  // connect event
  // send handshake here or pass it as last param
};
bot.onDisconnect = (reason) => {
  // disconnect event with reason
};
bot.onReady = () => {
  // ready event, client has successfully completed the handshake
  // and ready for receive and send data
  bot.request('status', (response) => {
    // response from another service
  });
};
bot.start();
```

Here `options` is an instance of [`ServiceOptions`](#serviceoptions) that contains a validator, serializer and list of commands (not normally used in Bot).

Available methods:

```ts
/**
 * Start bot, begin connect
 */
async start(): Promise<void>;

/**
 * Send command (event) to server
 *
 * @param {string} command Command name
 * @param {Buffer} data Payload data
 */
async command(command: string, data?: Buffer): Promise<void>;

/**
 * Send request to server and wait response
 *
 * @param {string} request Request name
 * @param {Buffer} data Payload data
 */
async fetch(request: string, data?: Buffer): Promise<PayloadData>;

/**
 * Send request to server and wait response in callback
 * Return request id, it may be canceled
 *
 * @param {string} request Request name
 * @param {ResponseType} callback Callback with response
 * @param {Buffer} data Payload data
 */
async request(request: string, callback: ResponseType, data?: Buffer): Promise<number>;

/**
 * Send response on request
 *
 * @param {PayloadData} request Request from with id, etc
 * @param {Buffer} [data] Data to send
 */
async response(request: PayloadData, data?: Buffer): Promise<void>;

/**
 *  Subscribe on command from server
 *
 * @param {string} command Command name
 * @param {ResponseType} callback Callback to subscribe
 */
async on(command: string, callback: ResponseType): Promise<void>;

/**
 * Unsubscribe from command
 * If callback is null -> clear all of them
 *
 * @param {string} command Command name
 * @param {ResponseType} callback Callback to unsubscribe
 */
async off(command: string, callback?: ResponseType): Promise<void>;

/**
 * Cancel request
 *
 * @param {number} id Request id
 */
async cancel(id: number): Promise<void>;

/**
 *  Subscribe on request from server that wait response
 *
 * @param {string} request Request name
 * @param {ResponseType} callback Callback
 */
async onRequest(request: string, callback: ResponseType): Promise<void>;

/**
 * Unsubscribe from request from server that wait response
 *
 * @param {string} request Rommand name
 */
async offRequest(request: string): Promise<void>;

/**
 * Start client handshake
 * 
 * @param {Buffer} [body] Custom data for handshake
 */
async handshake(body?: Buffer): Promise<void>;

/**
 * Disconnect from server
 */
async disconnect(): Promise<void>;

/**
 * Destroy bot
 */
async destroy(): Promise<void>;
```

And it has 3 callback methods:

```ts
/**
 * Callback on disconnect
 */
public onDisconnect: (reason: DisconnectReason) => void = () => {};

/**
 * Callback on connect
 */
public onConnect: () => void = () => {};

/**
 * Callback when bot ready for work
 */
public onReady: () => void = () => {};
```

There is also a property to check the current state of the connection:

```ts
/**
 * Current connection status
 *
 * @type {boolean}
 */
isConnected: boolean = false;
```

# 👤 Client

`Client` is an internal class for all connections in the service. It provides all methods as in [`Bot`](#-bot) and some additional ones:

```ts
/**
 * Kick from server
 */
async kick(reason: DisconnectReason): Promise<void> {
  this.commander.kick(reason);
}
```

When a `Bot` from another server or Unity client connects to your service, a new `Client` class is created, and all further processes you will have to perform with this class.

# 🔩 Commander

The `Commander` is the next important part of Shardy – it controls how to receive and send blocks, what command or request to invoke, and when to kick a client or send a heartbeat.

### Request and commands

Each `Сlient` has its own `Commander` with its own requests counter and subscription list for various events.

Each command is a function of type `Task`:

```ts
/**
 * Type for loaded commands and requests
 */
export type Task = (commander: Commander, payload: PayloadData, service: Service) => void;
```

Well, this means you have access to `Commander` (sending a response or error), to [`Payload`](#-payload) (processing data), to [`Service`](#️-service) (reading/writing to the DB or elsewhere) from any your command.

When you make a request, you need to set the callback method to get the result with the received data. For requests and subscriptions, there is a `ResponseType`. This is the method that returns `PayloadData`.

```ts
/**
 * Type for requests callbacks
 */
export type ResponseType = (data: PayloadData) => void;

/**
 * Make request and process the response in an anonymous method
 */
bot.request('status', (response) => {
  // response here is PayloadData
});

/**
 * Handler for subscription is ResponseType
 */
callback = async (data: PayloadData) => {
  // process data here
};

/**
 * Subscribe on event
 */
bot.on('timer', this.callback);

/**
 * Unsubscribe from event
 */
bot.off('timer', this.callback);
```

### CommanderMode

`Commander` is a common part for [`Service`](#️-service) and for [`Bot`](#-bot). There is a slight difference, which is determined by `CommanderMode` – when to send heartbeat and how to handle handshake. But this option is private and is used under the hood.

```ts
/**
 * Mode for commander
 */
export enum CommanderMode {
  /**
   * For service instance
   */
  Service,

  /**
   * For bot
   */
  Bot,
}
```

Also, `Commander` manages heartbeat via the [`Pulse`](#-pulse) class and detects and manages request timeouts.

# 🌐 Connection

`Сonnection` determines how to read and write to the socket depending on which [`TransportType`](#transporttype) is selected.

Shardy supports two types of transport: `TCP` and `WebSocket`. You can use either of them in your projects. The [Unity client](https://github.com/mopsicus/shardy-unity) also supports these transport types, so you can make WebGL builds with `WebSocket` transport and they will work out of the box.

# 📝 Logger

Shardy provides advanced `Logger` with tags, filters and scopes based on Winston.

You can combine different filter options and show only what you want in the log. Each [`Client`](#-client) (in [`Bot`](#-bot) or [`Server`](#️-server)) has its own logger, so you can be very flexible in filtering all your connections.

To set new filter, pass `LoggerFilter` to `Logger`:

```ts
this.log.setFilter({ scope: [LoggerScope.System], type: [LoggerType.Warning] });
```

All parameters for the filter:

```ts
/**
 * Logger filter
 * Pass params in [] to enable filtering
 *
 * @export
 * @interface LoggerFilter
 */
export interface LoggerFilter {
  type?: LoggerType[];
  scope?: LoggerScope[];
  mode?: LoggerFilterMode;
  tags?: string[];
  contains?: string;
}
```

You can also filter by keywords in the log message via the `contains` parameter or via `tags` to filter by tags.

Available methods:

```ts
/**
 * Update label info
 *
 * If label exists it will replace data info
 *
 * @param {string[]} [data=[]] Info with connection and data
 * @param {string} [label] Custom label
 */
setLabel(data: string[] = [], label?: string): void;

/**
 * Update filter
 *
 * @param {LoggerFilter} data Filter options
 */
setFilter(data: LoggerFilter): void;

/**
 * Clear filter
 */
clearFilter(): void;

/**
 * Disable filter
 */
disable(): void;

/**
 * Get current filter
 *
 * @return {*}  {LoggerFilter} Logger filter
 */
getFilter(): LoggerFilter;

/**
 * Return aray of tags, for modify, e.g.
 *
 * @return {*}  {string[]} Array of tags
 */
getTags(): string[];

/**
 * Log info message
 *
 * @param {string} message Info message
 * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
 */
info(message: string, scope: LoggerScope = LoggerScope.User): void;

/**
 * Log warning
 *
 * @param {string} message Warning message
 * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
 */
warn(message: string, scope: LoggerScope = LoggerScope.User): void;

/**
 * Log error
 *
 * @param {string} message Error message
 * @param {LoggerScope} [scope=LoggerScope.User] Scope for logging
 */
error(message: string, scope: LoggerScope = LoggerScope.User): void;
```

If environment is `development`, logs are written to the console and the `all.log` file.

# ℹ️ Payload

`Payload` is a static class that handles the encoding and decoding of raw data to and from [`PayloadData`](#payloaddata). It is a private class for [`Commander`](#-commander), which encodes data before sending it and decodes it after receiving it.

```ts
/**
 * Encode data for transfer
 *
 * @static
 * @param {Serializer} serializer Service serializer
 * @param {PayloadType} type Type of data
 * @param {string} name Command or request name
 * @param {number} id Request id
 * @param {Buffer} [data] Data
 * @param {string} [error] Error message or code
 * @return {*}  {Buffer} Encoded buffer data
 */
static encode(serializer: Serializer, type: PayloadType, name: string, id: number, data?: Buffer, error?: string): Buffer;

/**
 * Decode received block
 *
 * @static
 * @param {Serializer} serializer Service serializer
 * @param {Buffer} data Encoded buffer data
 * @return {*}  {PayloadData} Payload data to use in commander
 */
static decode(serializer: Serializer, data: Buffer): PayloadData;

/**
 * Create payload data manually without serialization
 *
 * @static
 * @param {PayloadType} type Type of data
 * @param {string} name Command or request name
 * @param {number} id Request id
 * @param {Buffer} [data] Data
 * @param {string} [error] Error message or code
 * @return {*}  {PayloadData} Not encoded payload data
 */
static create(type: PayloadType, name: string, id: number, data?: Buffer, error?: string): PayloadData;

/**
 * Check payload for available type
 *
 * @static
 * @param {PayloadData} payload Payload data to check
 * @return {*}  {boolean} Correct or not
 */
static check(payload: PayloadData): boolean;
```

The `check` method controls that the received data is correct and available for processing.

### PayloadData

`PayloadData` is the data containing the command/request meta-info and the received data, if it exists.

```ts
/**
 * Payload after decode
 */
export interface PayloadData {
  /**
   * Type of data
   */
  type: PayloadType;
  /**
   * Command or request name
   */
  name: string;
  /**
   * Request id
   */
  id: number;
  /**
   * Data
   */
  data: Buffer;
  /**
   * Error message or code
   */
  error: string;
}
```

The `PayloadType` defines how the data will be processed.

```ts
/**
 * Payload type
 */
export enum PayloadType {
  /**
   * Request and expect answer
   */
  Request,
  /**
   * Command without answer, event
   */
  Command,
  /**
   * Response on request
   */
  Response,
}
```

# ⛓️ Protocol

`Protocol` is an another internal class that links [`Commander`](#-commander) with [`Transport`](#-transport) and determines state of app: start, handshake or work. Each received [`Block`](#-block) from [`Transport`](#-transport) is detected, decoded to `BlockData` and passed to the `Commander` depending on the current [`Protocol State`](#-protocolstate).

`Commander` can invoke these public methods:

```ts
/**
 * Send data to connection
 *
 * @param {Buffer} body Serialized command data
 */
send(body: Buffer): void;

/**
 * Send heartbeat to connection
 */
heartbeat(): void;

/**
 * Send handshake to connection
 * @param {Buffer} body Buffer with handshake data
 */
handshake(body: Buffer): void;

/**
 * Send acknowledgement
 * @param {Buffer} body Buffer with acknowledge data
 */
acknowledge(body: Buffer): void;

/**
 * Kick from server
 *
 * @param {DisconnectReason} reason Disconnect reason data
 */
kick(reason: DisconnectReason): void;

/**
 * Disconnect from server
 */
disconnect(): void;
```

### ProtocolState

The `Commander` can only accept requests and commands if the client has passed the handshake and the protocol state is set to `Work`.

```ts
/**
 * Protocol state
 */
export enum ProtocolState {
  /**
   * Init state, wait for handshake
   */
  Start,

  /**
   * Handshake is in progress
   */
  Handshake,

  /**
   * Work state after success handshake
   */
  Work,

  /**
   * Protocol closed, any actions ignored
   */
  Closed,
}
```

# 💓 Pulse

`Pulse` is an internal class for handling the heartbeat of a connection. It uses two params from the `.env` file:

```ts
# Number of intervals before kick
PULSE_LIMIT=3

# Interval for checking heartbeat, ms
PULSE_INTERVAL=1000
```

When Shardy receives any command, handshake or heartbeat, the `checks` counter in `Pulse` is reset. Every `PULSE_INTERVAL` this class checks the `checks` counter and if the counter value is greater than `PULSE_LIMIT`, it invokes a callback to kick or send a heartbeat.

# 🏗️ Serializer

Shardy supports custom serialization of transmitted data. You can use JSON, MessagePack, Protobuf, FlatBuffers, etc. or your own serializer. `Serializer` is just an interface for your own serializer implementation.

The main goal of this class is to encode [`PayloadData`](#payloaddata) to `Buffer` and decode it back.

```ts
/**
 * Serializer interface, uses in Payload
 */
export interface Serializer {
  /**
   *
   * Serialize data to buffer
   *
   * @param {PayloadData} body Target data
   * @return {*}  {Buffer} Encoded data
   */
  encode(body: PayloadData): Buffer;

  /**
   * Deserialize buffer
   *
   * @param {Buffer} body Encoded data
   * @return {*}  {PayloadData} Data to use
   */
  decode(body: Buffer): PayloadData;
}
```

# 🖥️ Server

The `Server` class is the main part of Shardy - it is the wrapper for all the other parts and links them together. To start a new Shardy-service, you need to create an instance of `Server`, pass host, port, your [service](#️-service) instance and [options](#serviceoptions) to the constructor, and `start` it.

```ts
const server = new Server(process.env.SERVICE_HOST, process.env.SERVICE_PORT, service, { validator, serializer, commands });
server.start();
```

You can control logging for all connected clients from `Server` - call `setFilter` or `clearFilter` and it will be applied to all of them.

```ts
/**
 * Creates an instance of Server
 *
 * @param {string} host Server host
 * @param {number} port Server port
 * @param {Service} service Service instance
 * @param {ServiceOptions} options Service options
 */
constructor(
  private host: string,
  private port: number,
  private service: Service,
  private options: ServiceOptions,
);

/**
 * Start listening server
 */
async start(): Promise<void>;

/**
 * Stop server
 */
async stop(): Promise<void>;

/**
 * Set filter for all connected clients
 *
 * @param {LoggerFilter} filter Filter data
 */
async setFilter(filter: LoggerFilter): Promise<void>;

/**
 * Clear all log filters for all connected clients
 */
async clearFilter(): Promise<void>;
```

To stop your server, call `stop` - all connected clients will be disconnected with reason `ServerDown` and the server will be gracefully stopped.

# ⚙️ Service

`Service` is the interface to your own service class. You have to implement all methods for your needs. This is the main class of your app that manages all connections.

```ts
/**
 * Service interface
 *
 * Service instance must implements it
 *
 * @export
 * @interface Service
 */
export interface Service {
  /**
   * Service name
   */
  name: string;

  /**
   * Transport type for service
   */
  transport: TransportType;

  /**
   * Event when new client connected
   */
  onConnect(client: Client): Promise<void>;

  /**
   * Event when client disconnected
   */
  onDisconnect(client: Client, reason: DisconnectReason): Promise<void>;

  /**
   * Event when client made a handshake
   */
  onReady(client: Client): Promise<void>;

  /**
   * Event when service started
   */
  onListening(host: string, port: number): Promise<void>;

  /**
   * Event when service get error
   */
  onError(error: Error): Promise<void>;

  /**
   * Event when service closed
   */
  onClose(): Promise<void>;
}
```

The two public fields `name` and `transport` are used for internal processes, you can configure them from the `.env` file:

```ts
/**
 * Current service name
 */
name = process.env.SERVICE_NAME;

/**
 * Service transport type
 */
transport = process.env.SERVICE_TRANSPORT as TransportType;
```

### ServiceOptions

`ServiceOptions` contains a validator, serializer and list of commands (uses in [`Service`](#️-service), not in [`Bot`](#-bot)).

Before you can run your service or connect to any Shardy-service via [`Bot`](#-bot), you need to configure `ServiceOptions` and pass it to the constructor. There is a simple example in [Run HelloWorld](./welcome.md#-run-helloworld).

```ts
/**
 * Service options to pass in Commander
 *
 * @export
 * @interface ServiceOptions
 */
export interface ServiceOptions {
  /**
   * List of available service commads and requests
   */
  commands?: Map<string, Task>;

  /**
   * Handshake service instance
   */
  validator: Validator;

  /**
   * Service data serializer
   */
  serializer: Serializer;
}
```

> [!IMPORTANT] 
> Make sure the serializer and handshake validator are the same as the service you are connecting to.  

# 🛠️ Tools

`Tools` is a small static class with a few useful functions. 

```ts
/**
 * Generate random string id
 *
 * @static
 * @param {number} length Length for string
 * @returns {string} randomized id
 */
static generateId(length: number): string;

/**
 * Get tag from module filename
 *
 * @static
 * @param {NodeModule} item Node module
 * @return {*} {string} short name lowercased
 */

static getTag(item: NodeModule): string;

/**
 * Find all files in directory (recursive)
 *
 * @static
 * @param {string} directory Path to begin walk and find
 * @return {*}  {string[]} Array of paths
 */
static walk(directory: string): string[];
```

# 🚄 Transport

`Transport` is one of the main parts of Shardy – it controls how data will be sent and received.

`Transport` receives data from [`Connection`](#-connection), determines the size of the [`Block`](#-block), checks its type, and starts receiving its entire length. Once received, it passes the data to [`Protocol`](#️-protocol).

The [`Protocol`](#️-protocol) can use these public methods or `Transport`: the `dispatch` method is used to send data, the `close` method is used to terminate transmission, and the `destroy` method is used when the connection is destroyed.

```ts
/**
 * Send data to connection
 *
 * @param {Buffer} data Data to send
 */
dispatch(data: Buffer): void;

/**
 * Close transport
 */
close(): void;

/**
 * Destroy
 */
destroy(): void;
```

Under the hood, the `Transport` monitors its `TransportState` and reads the right part of the data or stops the transmission.

```ts
/**
 * Transport state
 */
export enum TransportState {
  /**
   * Receive head data
   */
  Head,

  /**
   * Receive body data
   */
  Body,

  /**
   * Transport is closed, no more data received
   */
  Closed,
}
```

### TransportType

Shardy can work with TCP sockets or WebSockets. When you configure your service, set in the `.env` file the desired transport type to work.

```ts
/**
 * Type of transport
 */
export enum TransportType {
  TCP = 'tcp',
  WebSocket = 'websocket',
}
```

> [!NOTE]
> Shardy cannot handle TCP and WebSockets at the same time, you must select the transport type before running it.

# 🪪 Validator

Shardy provides an interface for handshake validation. You can implement your own handshake data structure and validation for all stages.

Encode and validate any client-side or server-side data in the handshake process to control connected users and allow or deny them to invoke commands.

```ts
/**
 * Handshake interface for server-client, server-server validation
 */
export interface Validator {
  /**
   * Validate handshake data
   *
   * @param {Buffer} body Data for validate
   * @return {*}  {ValidatorState} Validation result
   */
  verifyHandshake(body: Buffer): ValidatorState;

  /**
   * Validate acknowledgement data
   *
   * @param {Buffer} body Data for validate
   * @return {*}  {ValidatorState} Validation result
   */
  verifyAcknowledgement(body: Buffer): ValidatorState;

  /**
   * Get handshake data for send
   *
   * @param {Buffer} [body] Custom data for handshake
   * @return {*}  {Buffer} Data from handshake
   */
  handshake(body?: Buffer): Buffer;

  /**
   * Get acknowledgement data for send
   *
   * @param {Buffer} body Data from handshake
   * @return {*}  {Buffer} Data for acknowledge
   */
  acknowledgement(body: Buffer): Buffer;
}
```

> [!IMPORTANT] 
> If your implementation does not need to do a two-step handshake, you can set "stubs" on these methods.

Each verify method must return a typed `ValidatorState` response after processing.

```ts
/**
 * Validator state
 */
export enum ValidatorState {
  /**
   * Handshake passed
   */
  Success,

  /**
   * Handshake failed
   */
  Failed,
}
```