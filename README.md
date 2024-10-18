<a href="./README.md">![Static Badge](https://img.shields.io/badge/english-118027)</a>
<a href="./README.ru.md">![Static Badge](https://img.shields.io/badge/russian-0390fc)</a>
<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/logo-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="media/logo.png">
        <img alt="Shardy" height="256" width="256" src="media/logo.png">
    </picture>
</p>
<h3 align="center">Framework for online games and apps</h3>
<p align="center">
    <a href="#quick-start">Quick start</a> · <a href="./docs/index.md">Docs</a> · <a href="https://github.com/mopsicus/shardy-template">Service template</a> · <a href="https://github.com/mopsicus/shardy-unity">Unity client</a> · <a href="https://github.com/mopsicus/shardy/issues">Report Bug</a>
</p>

# 💬 Overview

Shardy is a framework for online games and applications on Node.js. It provides the basic functionality for building microservices solutions: mobile, social, web, multiplayer games, realtime applications, chats, middleware services, etc.
 
The main goal of Shardy is to give simple free solution for building almost any kind of online project. 💪

# ✨ Features

- Microservices paradigm
- Simple API: request, response, subscribe, etc
- Socket and Websocket communication
- Lightweight and fast: Node.js & TypeScript
- Support custom serialization
- Support custom handshake validation
- Advanced logger: tags, filters, scopes
- Flexible extension
- Good reference materials: docs, snippets, examples
- Almost zero configuration

# 🚀 Usage

### Why should I use Shardy?

Start your project or backend for mobile game with Shardy and rest assured:

- **easy to use:** work with a user-friendly API and don't worry about how it works under the hood
- **scalable architecture:** get exists or create your own microservices, link them together and scale your app
- **fast & lightweight:** core network architecture, based on Node.js without any 3rd party libs
- **full docs:** Shardy provides good docs with all necessary sections and API references, also all code is coverged by comments

### Quick start

It's really easy to start developing your project with Shardy:

1. Clone a service template or creare a new one
    ```
    git clone git@github.com:mopsicus/shardy-template.git
    ```
5. Install Shardy and all dependencies:
    ```
    npm install
    ```
3. Edit `.env.dev`
4. Run debug mode
    ```
    npm run debug
    ```

See the [documentation](./docs/index.md) section for all API methods and examples.

### Service interface

Your (micro)service must implement `Service` interface to handle general events. This is the main place where you control connected and disconnected users and pass them on to your app.

All your other objects, classes, DBs, etc. should be linked to this class otherwise you won't be able to access them from commands\requests files.

```ts
import { TransportType, Service, Client } from 'shardy';

export class MyService implements Service {

    //
    // add your objects, DB connections or something else in this class
    //

    // set name for your service
    name = process.env.SERVICE_NAME; 

    // set transport type
    transport = process.env.SERVICE_TRANSPORT as TransportType; 

    async onConnect(client: Client): Promise<void> {
    // new client connected
    }

    async onDisconnect(client: Client): Promise<void> {
    // client disconnected
    }

    async onReady(client: Client): Promise<void> {
    // client ready to work
    }    

    async onListening(): Promise<void> {
    // service started
    }

    async onError(error: Error): Promise<void> {
    // some error occured
    }

    async onClose(): Promise<void> {
    // service stopped
    }

}
```

### Requests and commands

Shardy API is really user-friendly, it provides an RPC framework for inter-process communications. The snippets below show how each can be used.

The general difference between requests and commands that is other side must respond to requests and doesn't respond to commands. So this means that when you make a request, you have a callback with response data. And when you send a command, you are simply notifying the other side about something.

Request:

```ts
client.request('status', (data) => {
// send request and work with response in callback
});
```

```ts
client.request('status', (data) => {
// send request with payload
}, payload);
```

Command:

```ts
client.command('status'); // just send command/event
```

```ts
client.command('status', payload); // send command with payload
```

Subscribe:

```ts
client.on('status', (data) => {
// subscribe on command and process data whenever receive
});
```

You can also send request from server to client, see the [documentation](./docs/index.md) for it.

### Command structure

All commands/requests export a named function. Shardy passes all the necessary objects to your commands:

- **commander** – current connection controller
- **payload** – received data and meta data about the command/request
- **service** – reference to your service instance, for communication with your objects, DB, etc

> [!IMPORTANT]
> If your command is request, be sure to make a response to it, otherwise caller will timeout.

```ts
import { Commander, PayloadData, Service } from 'shardy';

export const status = (commander: Commander, payload: PayloadData, service: Service) => {

    // process received data
    console.log('data', payload.data);

    // to make a response to request
    commander.response(payload); 

    // to make an error on request
    commander.error(payload); 
};
```

### Validation

When a client connects to the server, it must successfully complete the handshake before it can begin. Shardy uses a two-step handshake for connections.

Stages of handshake:

1. The client sends a handshake to the server
2. Server receives and verifies it:
    - Sends an acknowledgement to the client
    - Disconnects the client, if the verification fails
3.  The client receives the acknowledgement and verifies it:
    - Sends a reply acknowledgement to the server
    - Disconnects, if the verification fails
4. After verifying the handshake and acknowledgement, the client and server can communicate with each other

If your implementation does not need to do a two-step handshake, you can set "stubs" on these methods.

Shardy provides an interface for handshake validation. You can implement your own handshake data structure and validation for all these stages. Inherit the `Validator` class, implement methods and pass it to your service and client.

```ts
import { Validator, ValidatorState } from 'shardy';

export class MyHandshake implements Validator {

    verifyHandshake(body: Buffer): ValidatorState {
    // vefify initial handshake
    }

    verifyAcknowledgement(body: Buffer): ValidatorState {
    // vefify acknowledgement data
    }

    acknowledgement(body: Buffer): Buffer {
    // data for acknowledgement after handshake validation passed
    }

    handshake(body?: Buffer): Buffer {
    // data for initial handshake
    }

}
```

### Serialization

Shardy supports custom serialization of transmitted data. You can use JSON, MessagePack, Protobuf, FlatBuffers, etc. or your own serializer.

Just inherit the `Serializer` class, implement encode/decode methods and pass it to your service and client.

```ts
import { PayloadData, Serializer } from 'shardy';

export class MyJsonSerializer implements Serializer {

    encode(body: PayloadData): Buffer {
    // encode PayloadData to Buffer for transporting
    }

    decode(body: Buffer): PayloadData {
    // decode recevied data and serialize to PayloadData
    }

}
```

### Extensions

You can enhance your Shardy-services with extensions. Just inherit the `Extension` class, implement methods, choose `ExtensionMode` to handle: before service callbacks or after, and apply it before starting the server.

```ts
const server = new Server(process.env.SERVICE_HOST, process.env.SERVICE_PORT, service, { validator, serializer, commands });
server.use(new MyExtension());
server.use(new MyExtension2());
server.use(new MyExtension3());
...
server.start();
```

The extension callbacks are similar to the `Service` callbacks. 

> [!NOTE]
> You can share your extensions between your services or make them public through the NPM registry.

```ts
import { Extension, ExtensionMode } from 'shardy';

export class MyExtension implements Extension {
  /**
   * Extension name
   */
  name: string = 'my-extension';

  /**
   * Extension mode, before or after
   */
  mode: ExtensionMode = ExtensionMode.After;

  /**
   * Logger instance
   *
   * @type {Logger}
   */
  log!: Logger;

  async init(): Promise<void> {
  // init extension
  }

  async onClientConnect(client: Client): Promise<void> {
  // new client connected
  }

  async onClientDisconnect(client: Client, reason: DisconnectReason): Promise<void> {
  // client disconnected
  }

  async onClientReady(client: Client): Promise<void> {
  // client ready to work
  }

  async onServiceListening(): Promise<void> {
  // service started
  }

  async onServiceClose(): Promise<void> {
  // service stopped
  }
}
```

# 🗓️ Plans

The plans are truly grand! It is to create an ecosystem for developers who will be able to build their game backend out of existing Shardy services like bricks.

Listed below are some of the Shardy-services I plan to make:
- service discovery
- monitoring service
- backup service

Later, as needed, there are plans to make services necessary for almost any game server:
- service for static storage
- liveops service
- authorization service
- notification push service
- chat service
- in-app purchases service
- leaderboards service
- ads services

The list is endless... Be in touch.

# 🏗️ Contributing

We invite you to contribute and help improve Shardy. Please see [contributing document](./CONTRIBUTING.md). 🤗

You also can contribute to the Shardy project by:

- Helping other users 
- Monitoring the issue queue
- Sharing it to your socials
- Referring it in your projects

# 🤝 Support

You can support Shardy by using any of the ways below:

* Bitcoin (BTC): 1VccPXdHeiUofzEj4hPfvVbdnzoKkX8TJ
* USDT (TRC20): TMHacMp461jHH2SHJQn8VkzCPNEMrFno7m
* TON: UQDVp346KxR6XxFeYc3ksZ_jOuYjztg7b4lEs6ulEWYmJb0f
* Visa, Mastercard via [Boosty](https://boosty.to/mopsicus/donate)
* MIR via [CloudTips](https://pay.cloudtips.ru/p/9f507669)

# ✉️ Contact

Before you ask a question, it is best to search for existing [issues](https://github.com/mopsicus/shardy/issues) that might help you. Anyway, you can ask any questions and send suggestions by [email](mailto:mail@mopsicus.ru) or [Telegram](https://t.me/mopsicus).

# 🔑 License

Shardy is licensed under the [MIT License](./LICENSE). Use it for free and be happy. 🎉