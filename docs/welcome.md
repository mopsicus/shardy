# 🙌 Welcome to Shardy

Once again, Shardy is a simple backend framework for Node.js written on TypeScript. So, all you need to start developing with Shardy is: Node.js, TypeScript and some skills.

Also, TypeScript is very similar to C#, so if you have experience with that language (and I hope you do :), it will be easy for you to understand and use this framework.

Check out the [API](./reference.md) and tutorials and you can write your own backend for a game or app.

# 🔩 Command structure

Each command is a function of type `Task`:

```ts
/**
 * Type for loaded commands and requests
 */
export type Task = (commander: Commander, payload: PayloadData, service: Service) => void;
```

All commands/requests script export a named function. Shardy passes all the necessary objects to your commands.

- [**commander**](./reference.md#-commander) – current connection controller
- [**payload**](./reference.md#️-payload) – received data and meta data about the command/request
- [**service**](./reference.md#️-service) – reference to your service instance, for communication with your objects, DB, etc

Example:

```ts
import { Commander, PayloadData, Service } from 'shardy';

export const status = (commander: Commander, payload: PayloadData, service: Service) => {

    // process received data
    console.log('data', payload.data);

    // to make a response to request
    commander.response(payload); 

    // to make an error on request
    commander.error(payload); 

    // request users from DB
    let users = service.getUsers(...);
};
```

Thus, each command has access to: the received data in `payload`, the `service` for read/write operations, and the `commander` for sending a response to the client. And it's good practice to separate commands by file, I guess.

Small notice about [using DB in Shardy](./next.md#️-using-db).

# ✨ Run HelloWorld

Let's create a simple project:

```bash
mkdir new-project
cd new-project
npm init -y
npm install shardy
```

To implement `Validator`, `Serializer` and `Service`, see [API](./reference.md) and for project structure – [Make service from scratch](./service.md#️-make-service-from-scratch). For testing, you can use handshake stubs and JSON for data serialization.

Pass them to Shardy, import commands and run server:

```ts
import { Server } from 'shardy';

const validator = new MyValidator();
const serializer = new MySerializer();
const service = new MyService();
const server = new Server(process.env.SERVICE_HOST, process.env.SERVICE_PORT, service, { validator, serializer, commands });
server.start();
```

The commands here are a map of [Task](./reference.md#-commander): 

```ts
export interface ServiceOptions {
  /**
   * List of available service commads and requests
   */
  commands?: Map<string, Task>;
  ...
}
```

So, you can fill map manually, or write a function to load them from the directory, see how to [load commands](./service.md#-load-commands).

Another way is to [use the Shardy template](./service.md#-using-template) and edit it to fit the needs of your project. 

# 🔑 Environment variables

Shardy uses the `.env` file to load some variables. There are some required parameters for Shardy to work, below is a list with descriptions.

```ts
# Environment: development or production
ENV=development

# Service name
SERVICE_NAME=shardy

# Host or IP to launch service
SERVICE_HOST=127.0.0.1

# Port for service
SERVICE_PORT=3000

# Type of service transport: tcp or websocket
SERVICE_TRANSPORT=tcp

# Number of intervals before kick
PULSE_LIMIT=3

# Interval for checking heartbeat, ms
PULSE_INTERVAL=1000

# Timeout for RPC requests, ms
REQUEST_TIMEOUT=10000

# Path to logs directory
LOGS_DIR=../../logs
```

# 🔗 Link multiple services together

Shardy provides a built-in client for connecting to other Shardy-services and calling commands and requests.

Import `Bot` from Shardy, create instance, input params to connect and pass the [service options](./reference.md#serviceoptions). Invoke `start` to connect.

> [!IMPORTANT] 
> Make sure that `options` such as the serializer and handshake validator are the same as the service you are connecting to.  

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

What it means: 
1) you can create small separated services, connect them to each other, and be confident that if one of them fails (like a chat service), the others will work fine 
2) game client can connect to one main service, but this service can request data from another service or through another service and send it to the client
3) small services are easier to create and refactor than one large game service

These seem to be obvious things and they sound good, but at the same time you should realize that it may not be easy to support the whole infrastructure of a large number of services, the architecture should be well thought out and tested. But that's another story altogether.