# 🗄️ Using DB

You can use any type of database because Shardy does not restrict their use in any way. All interaction with the database will take place using your `Service`, because all commands have access to it. Connect to DB from your service or make some helper/wrapper for DB queries and call it from your commands:

```ts
import { Commander, PayloadData, Service } from 'shardy';

export const users = (commander: Commander, payload: PayloadData, service: Service) => {
    let users = service.DB.getUsers(...);
    commander.response(payload, users);
};
```

In one of the next tutorials I will try to show a simple example of a database with Shardy and some ORM: Sequelize, Prisma or MikroORM. Stay tuned.

# 🏘️ Scalability

As written in the section [linking multiple services together](./welcome.md#-link-multiple-services-together), a common Shardy scalability practice is to create small single-tasking services and link them to each other or to some service locator.

It's also a good idea to wrap your services in Docker for quick deployment and management.

Use [extensions](./reference.md#-extension) to improve your services. Each extension is executed `before` or `after` the service callbacks. Combine them to get more flexible services.

In the future, I plan to implement a **plugin system** into Shardy, which will allow developers to extend the basic functionality and write their own middleware for the core processes. But right now, these are just plans. 🙄

# 🚀 Run in production

When you're ready to launch your new Shardy-service, it's time to start preparing for `production`:

- check all *TODO*
- comment out all debugging code
- configure all parameters in the `.env` file, switch *ENV* to `production`
- set the logging level and filters according to your needs
- run format, lint and build your app (see [scripts examples](./service.md#-debug-and-logging))
- deploy to a server
- use a process manager to run the app: pm2, forever, supervisor, etc.

Using process manager ensures that your app will be restarted when the server reboots or when some errors occur, read the docs to properly configure PM.