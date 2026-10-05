<a href="./README.md">![Static Badge](https://img.shields.io/badge/english-118027)</a>
<a href="./README.ru.md">![Static Badge](https://img.shields.io/badge/russian-0390fc)</a>
<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/logo-dark.png">
        <source media="(prefers-color-scheme: light)" srcset="media/logo.png">
        <img alt="Shardy" height="256" width="256" src="media/logo.png">
    </picture>
</p>
<h3 align="center">Фреймворк для онлайн игр и приложений</h3>
<p align="center">
    <a href="#быстрый-старт">Быстрый старт</a> · <a href="./docs/index.md">Документация</a> · <a href="https://github.com/mopsicus/shardy-template">Пример сервиса</a> · <a href="https://github.com/mopsicus/shardy-unity">Unity клиент</a> · <a href="https://github.com/mopsicus/shardy/issues">Отчёт об ошибке</a>
</p>

# 💬 Описание

Shardy – это фреймворк для онлайн игр и приложений на Node.js 24 или новее. Он предоставляет базовую функциональность для построения микросервисных решений: мобильных, социальных, веб, многопользовательских игр, приложений реального времени, чатов, middleware сервисов и т.п.

Основная цель Shardy – предоставить простое бесплатное решение для создания почти любого интернет-проекта. 💪

# ✨ Возможности

- Микросервисная парадигма
- Простой API: запросы, команды, подписки и т.п.
- Транспорт данных через сокеты и вебсокеты
- Легкость и быстрота: Node.js и TypeScript
- Поддержка пользовательской сериализации
- Поддержка пользовательской валидации рукопожатий (handshake)
- Продвинутый логгер: теги, фильтры, области
- Гибкое расширение
- Справочные материалы: документация, сниппеты, примеры
- Почти нулевая конфигурация

# 🚀 Использование

### Зачем использовать Shardy?

Начните свой проект или backend для мобильной игры с Shardy и будьте уверены в:

- **простоте использования:** работайте с удобным API и не задумывайтесь о том, как это работает под капотом
- **масштабируемой архитектуре:** используйте существующие или создавайте свои собственные микросервисы, связывайте их вместе и масштабируйте свое приложение
- **быстродействии и легкости:** основная сетевая архитектура, основанная на Node.js, без использования сторонних библиотек
- **полноте документации:** Shardy предоставляет хорошую документацию со всеми необходимыми разделами и ссылками на API, также весь код снабжен комментариями

### Быстрый старт

Начать разработку своего проекта с помощью Shardy очень просто:

1. Склонируйте шаблон сервиса или создайте новый
    ```
    git clone git@github.com:mopsicus/shardy-template.git
    ```
2. Установите Shardy и все зависимости
    ```
    npm install
    ```
3. Измените `.env.dev`
4. Запустить дебаг режим
    ```
    npm run debug
    ```

Все методы и примеры API приведены в [документации](./docs/index.md).

### Интерфейс сервиса

Ваш (микро)сервис должен использовать интерфейс `Service` для обработки основных событий. Это место где вы контролируете подключенных и отключенных пользователей и передаете их в своё приложение.

Все ваши остальные объекты, классы, БД и т.д. должны быть связаны с этим классом, иначе вы не сможете получить к ним доступ из команд\запросов.

```ts
import { TransportType, Service, Client, DisconnectReason } from 'shardy';

export class MyService implements Service {

    //
    //  добавляйте свои объекты, базы данных или что-нибудь ещё в этот класс
    //

    // укажите название сервиса
    name = process.env.SERVICE_NAME; 

    // укажите тип транспорта
    transport = process.env.SERVICE_TRANSPORT as TransportType; 

    async onConnect(client: Client): Promise<void> {
    // новый клиент подключился
    }

    async onDisconnect(client: Client, reason: DisconnectReason): Promise<void> {
    // клиент отключился
    }

    async onReady(client: Client): Promise<void> {
    // клиент готов к работе
    }       

    async onListening(host: string, port: number): Promise<void> {
    // сервис запущен
    }

    async onError(error: Error): Promise<void> {
    // произошла какая-то ошибка
    }

    async onClose(): Promise<void> {
    // сервис остановлен
    }

}
```

### Запросы и команды

Shardy API удобен в использовании, он предоставляет RPC-фреймворк для межпроцессных взаимодействий. Приведенные ниже фрагменты показывают, как можно использовать каждый из них.

Основное различие между запросами и командами в том, что вызываемая сторона должна отвечать на запросы и не отвечает на команды. Это означает, что когда вы делаете запрос, у вас есть обратный вызов с данными ответа. А когда вы посылаете команду, вы просто уведомляете другую сторону о чём-то.

Запрос:

```ts
client.request('status', (response) => {
// отправка запроса и получение ответа с данными
});
```

```ts
client.request('status', (response) => {
// отправка запроса с данными
}, payload);
```

Команда:

```ts
client.command('status'); // отправка команды/события
```

```ts
client.command('status', payload); // отправка команды с данными
```

Подписка:

```ts
client.on('status', (payload) => {
// подписка на команду и обработка при каждом получении
});
```

Можно также передавать запрос от сервера к клиенту, об этом см. в [документации](./docs/index.md).

### Структура команды

Все команды/запросы экспортируют именованную функцию. Shardy передает все необходимые объекты внутрь ваших команд:

- **commander** – контроллер текущего соединения
- **payload** – полученные данные и данные о команде или запросе
- **service** – ссылка на ваш экземпляр сервиса, для взаимодействия с вашими объектами, базами данных, и т.п.

> [!IMPORTANT]
> Если ваша команда это запрос, то убедитесь, что вы ответили на него, иначе у вызывающей стороны будет таймаут.

```ts
import { Commander, PayloadData, Service } from 'shardy';

export const status = (commander: Commander, payload: PayloadData, service: Service) => {

    // работа с полученными данными
    console.log('data', payload.data);

    // ответ на запрос
    commander.response(payload); 

    // ответ ошибкой на запрос
    commander.error(payload); 
};
```

### Валидация

Когда клиент подключается к серверу, он должен успешно завершить рукопожатие (handshake) перед началом работы. В Shardy используется двухэтапное рукопожатие для соединений.

Этапы рукопожатия:

1. Клиент отправляет данные рукопожатия на сервер
2. Сервер получает и проверяет их:
    - Отравляет подтверждение клиенту
    - Отключает клиента, если проверка не прошла
3.  Клиент получает данные подтверждения и тоже проверяет их:
    - Отправляет ответ на подтверждение серверу
    - Отключается, если проверка не прошла
4. После успешного рукопожатия и подтверждения, клиент и сервер могут отправлять друг другу запросы и команды.

Если в вашей реализации нет необходимости делать двухэтапное рукопожатие, вы можете установить "заглушки" на этих методах.

Shardy предоставляет интерфейс для валидации рукопожатия. Вы можете реализовать собственную структуру данных рукопожатия и валидацию для всех этих этапов. Реализуйте интерфейс `Validator` и передайте эту реализацию сервису и клиенту.

```ts
import { Validator, ValidatorState } from 'shardy';

export class MyHandshake implements Validator {

    verifyHandshake(handshakePayload: Buffer): ValidatorState {
    // проверка первоначального рукопожатия
    }

    verifyAcknowledgement(acknowledgementPayload: Buffer): ValidatorState {
    // проверка данных подтверждения
    }

    acknowledgement(handshakePayload: Buffer): Buffer {
    // данные для подтверждения после успешного первичного рукопожатия
    }

    handshake(customHandshakePayload?: Buffer): Buffer {
    // данные для первичного рукопожатия
    }

}
```

> [!NOTE]
> Вы можете использовать простой встроенный валидатор `DefaultValidator`.

### Сериализация

Shardy поддерживает пользовательскую сериализацию передаваемых данных. Вы можете использовать JSON, MessagePack, Protobuf, FlatBuffers и т.д. или свой собственный сериализатор.

Реализуйте интерфейс `Serializer`, предоставьте методы `encode` и `decode` и передайте эту реализацию сервису и клиенту.

```ts
import { PayloadData, Serializer } from 'shardy';

export class MyJsonSerializer implements Serializer {

    encode(payload: PayloadData): Buffer {
    // перекодируйте PayloadData в Buffer для отправки
    }

    decode(encodedPayload: Buffer): PayloadData {
    // декодируйте полученные данные и сериализуйте в PayloadData
    }

}
```

> [!NOTE]
> Вы можете использовать простой встроенный сериализатор `DefaultSerializer`.

### Расширения

Вы можете улучшить свои Shardy-сервисы с помощью расширений. Реализуйте интерфейс `Extension`, выберите режим `ExtensionMode` для вызова до или после методов сервиса и зарегистрируйте расширение до запуска сервера.

```ts
const server = new Server(process.env.SERVICE_HOST, process.env.SERVICE_PORT, service, { validator, serializer, commands });
server.use(new MyExtension());
server.use(new MyExtension2());
server.use(new MyExtension3());
...
server.start();
```

Все методы в расширении такие же как и в `Service`. 

> [!NOTE]
> Вы можете использовать готовые расширения среди свои сервисов или сделать их публичными с помощью реестра NPM.

```ts
import { Extension, ExtensionMode } from 'shardy';

export class MyExtension implements Extension {
  /**
   * Название расширения
   */
  name: string = 'my-extension';

  /**
   * Режим обработки, до или после
   */
  mode: ExtensionMode = ExtensionMode.After;

  /**
   * Встроенный логгер
   *
   * @type {Logger}
   */
  log!: Logger;

  async init(): Promise<void> {
  // инициализация
  }

  async onClientConnect(client: Client): Promise<void> {
  // новый клиент подключился
  }

  async onClientDisconnect(client: Client, reason: DisconnectReason): Promise<void> {
  // клиент отключился
  }

  async onClientReady(client: Client): Promise<void> {
  // клиент готов к работе
  }

  async onServiceListening(): Promise<void> {
  // сервис запущен
  }

  async onServiceClose(): Promise<void> {
  // сервис остановлен
  }
}
```

# 🗓️ Планы

Планы реально грандиозные! Развитие экосистемы для разработчиков, которые смогут создавать свои игры на основе существующих или собственных Shardy-сервисов, почти как из готовых блоков.

Ниже список сервисов которые планирую сделать:
- сервис обнаружения
- мониторинг
- резервное копирование

В дальнейшем, по мере необходимости, планируется делать сервисы, необходимые практически для любого многопользовательского игрового проекта:
- сервис статики
- liveops
- авторизация
- уведомления
- чаты
- покупки
- достижения
- реклама

На самом деле список бесконечный... Следите за новостями.

# 🏗️ Развитие

Мы приглашаем вас внести свой вклад и помочь улучшить Shardy. Пожалуйста, ознакомьтесь с [документом](./CONTRIBUTING.md). 🤗

Вы также можете внести свой вклад в проект Shardy:

- Помогая другим пользователям
- Мониторя список существующих проблем
- Рассказав о проекте в своих соцсетях
- Используя его в своих проектах

# 🤝 Поддержка

Вы можете поддержать проект любым из способов ниже:

* Bitcoin (BTC): bc1qaejavqm0r2fnx3d6mhvt8r6uqzwzun5vwkryn2
* USDT (TRC20): TLDPntuWNZRZTiWmtaKvZH7cVFXuf5TQvS
* TON: UQBrv16QN-6y2Jba0IgoKJEGB4u7_0ilPw8BXDH7M9NnExhw
* Карты Visa, Mastercard через [Boosty](https://boosty.to/mopsicus/donate)
* Карты МИР через [CloudTips](https://pay.cloudtips.ru/p/9f507669)

# ✉️ Контактная информация

Перед тем как задать вопрос, лучшим решением будет посмотреть уже существующие [проблемы](https://github.com/mopsicus/shardy/issues), это может помочь. В любом случае, вы можете задать любой вопрос или отправить предложение по [email](mailto:mail@mopsicus.ru) или [Telegram](https://t.me/mopsicus).

# 🔑 Лицензия

Shardy выпущен под лицензией [MIT](./LICENSE). Используйте бесплатно и радуйтесь. 🎉