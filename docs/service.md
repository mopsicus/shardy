# 🗒️ Make service from scratch

First of all, you need to create a directory and file structure for your new service. It might look something like this:

```
.
└── new-project/
    ├── src/
    │   ├── commands/
    │   │   ├── command.ts
    │   │   └── ...
    │   ├── app.ts
    │   ├── MyValidator.ts
    │   ├── MySerializer.ts
    │   └── MyService.ts
    ├── .env
    ├── .gitignore
    ├── .tsconfig
    └── package.json
```

Don't forget to install Shardy for your new service:

```bash
npm install shardy
```

1. Edit `.env` file, you have to set [required variables](./welcome.md#-environment-variables) for Shardy to work. 
2. After that, implement validator and serializer, see below how to do it.
3. Create app starter and load commands.
4. Run the app.

```ts
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Server, ServiceOptions, Task, Tools, TransportType } from 'shardy';
import { MySerializer } from './MySerializer';
import { MyHandshake } from './MyHandshake';
import { MyService } from './MyService';

/**
 * Get config and apply
 */
const config = fs.existsSync('.env') ? '.env' : '.env.dev';
dotenv.config({ path: config });

/**
 * Init service and run
 */
const init = async (): Promise<void> => {
  let commands = await loadCommands();
  const validator = new MyHandshake();
  const serializer = new MySerializer();
  const service = new MyService();
  const server = new Server(process.env.SERVICE_HOST, process.env.SERVICE_PORT, service, { validator, serializer, commands });
  server.start();
};

init();
```

Get the [Shardy template](https://github.com/mopsicus/shardy-template) to explore all the details to run app and package.json scripts.

# 🪪 Validator

When a client connects to the server, it must successfully complete the handshake before it can begin. Shardy uses a two-step handshake for connections.

Why are we doing this? There are different ways to identify the client, you need to be sure that the connected client is not a bot, or a hacker, or the version of the app is correct, or something else. Shardy provides a flexible handshake procedure for this purpose. 

1. The client sends a handshake to the server
2. Server receives and verifies it:
    - Sends an acknowledgement to the client
    - Disconnects the client, if the verification fails
3.  The client receives the acknowledgement and verifies it:
    - Sends a reply acknowledgement to the server
    - Disconnects, if the verification fails
4. After verifying the handshake and acknowledgement, the client and server can communicate with each other

```ts
export class MyValidator implements Validator {

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

> [!IMPORTANT] 
> If your implementation does not need to do a two-step handshake, you can set "stubs" on these methods.

# 🧱 Serializer

Shardy uses a custom serializer for all transmitted data. You have to create your own serializer class by inheriting the `Serializer` class, implement encode/decode methods and pass it to your service and client. The main goal – encode `PayloadData` to `Buffer` before sending and back after receiving. See [API](./reference.md#️-payload) for details.

```ts
export class MySerializer implements Serializer {

  encode(body: PayloadData): Buffer {
  // encode PayloadData to Buffer for sending
  }
  
  decode(body: Buffer): PayloadData {
  // decode recevied data and serialize it to PayloadData
  }

}
```

Here you can use any type of serialization you like: MessagePack, Protobuf, FlatBuffers, your own. If you are using Shardy with a Unity client, make sure your C# serializer packs data the same way it does on your backend.

> [!IMPORTANT] 
> Make sure your serialization is the same on the server and client

# 🛠️ Load commands

Shardy load commands on startup. Now you can do this in a few ways:

- autoload from directory
- import manually
- your solution

I prefer to separate each command by file, I think it's a good practice, and that way you can make a command loader, something like this:

```ts
const root = `./src/commands`;
Tools.walk(root).forEach(async (file) => {
  const name = path.basename(file, '.ts');
  const dir = path.parse(file).dir.split(path.sep).slice(1).join(path.sep);
  const task = await import(`./${path.join(dir, name)}`);
  commands.set(name, task[name]);
});
```

`Tools.walk` is a built-in function to find all files in directory (recursive). In the above example, the script finds all the commands in the directory and imports them into the `commands` map. After that, you have to pass commands to service on initialization state.

Another way is to import the commands, fill the map manually and pass to the service:

```ts
import { echo } from './commands/echo';
import { fail } from './commands/fail';
import { notify } from './commands/notify';

const commands = new Map<string, Task>();
commands.set('echo', echo);
commands.set('fail', fail);
commands.set('notify', notify);

const server = new Server(process.env.SERVICE_HOST, process.env.SERVICE_PORT, service, { validator, serializer, commands });
```

Or you can make your own solution to load commands 😄

# 📘 Using template

You can use the [template for your new service](https://github.com/mopsicus/shardy-template) and not have to create it manually. Download it and explore.

Template content:
1. App started
2. Validator stub
3. Simple serializer
4. Service example
5. Requests/commands examples
6. Commands loader

This service template is also used for the [Shardy Unity demo](https://github.com/mopsicus/shardy-unity), so you can run it on your local and try the Unity demo.

# 📝 Debug and logging

Shardy provides advanced logger with tags, filters and scopes based on Winston. You can set path to your log files in the `.env` config. If `ENV` param is set to `development`, all logs will be saved to the `all.log` file. 

By default, the logger writes all logs for development mode. You can enable/disable filters and scopes at any time during runtime via `setFilter` method. This method receives `LoggerFilter` object. See [logger docs](./reference.md#-logger) for more details.

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

Each log string contains date, time, tags, log level and message:

```
[Node] 2024-07-02T11:30:57.841Z [1Tw9n00yk2|192.168.0.134] info -> heartbeat
```

You can set tags as you wish, or you can specify a short module name using the built-in `Tools.getTag(module)` method.

If you are using the Shardy template, you can try the scripts for debugging:

```json
"scripts": {
  "build-ts": "tsc",
  "format": "prettier --config .prettierrc 'src/**/*.ts' --write",
  "build": "npm run build-ts && npm run lint",
  "debug": "npm run build && npm run watch-debug",
  "lint": "tsc --noEmit && eslint \"**/*.{js,ts}\" --quiet --fix && npm run format",
  "serve-debug": "nodemon --inspect dist/app.js",
  "serve": "node dist/app.js",
  "start": "npm run serve",
  "watch-debug": "concurrently -k -p \"[{name}]\" -n \"TypeScript,Node\" -c \"yellow.bold,cyan.bold,green.bold\" \"npm run watch-ts\" \"npm run serve-debug\"",
  "watch-node": "nodemon dist/app.js",
  "watch-ts": "tsc -w",
  "watch": "concurrently -k -p \"[{name}]\" -n \"TypeScript,Node\" -c \"yellow.bold,cyan.bold,green.bold\" \"npm run watch-ts\" \"npm run watch-node\""
}
```

This uses `concurrently` and `nodemon` to run scripts and detect file changes to restart the app. You can add these packages to your project and use them too.