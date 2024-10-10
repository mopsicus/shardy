# 💬 Overview

Shardy is a server framework for online games and applications on Node.js. It provides the basic development framework for building microservices solutions: mobile, social, web, multiplayer games, realtime applications, chats, middleware services, etc.

### Why we're talking: "microservices"?

Shardy is a framework, core for something bigger. It provides basic functions for connecting and transmitting data between servers and/or between clients and servers. So you can create small standalone services on it and it will work well.
 
The main goal of Shardy is to give simple free solution for building almost any kind of online project. 💪

# 🥷 For whom and why

Shardy grew out of a few scripts for internal use, as is often the case. It was mostly used as a local game backend. It was inspired by a rather famous old project - Pomelo. The package format and general concept of the RPC framework were taken from there. New features were added - the code became more complex. In the end, it was decided to rewrite everything in TypeScript and make a microkernel for my own services.

I made it alone, primarily for my own needs, after several iterations of rewriting the entire codebase 😄 I'm not claiming that Shardy will work for your project, but it's a really simple solution for adding multiplayer to your game.

If you have minimal knowledge of Node.js and TypeScript, you can easily launch your own service on Shardy and use it as a server for your game or application. At least it was designed for this purpose, so there is a C# [client and Unity demo](https://github.com/mopsicus/shardy-unity) for Shardy. 🙄

# 🧩 Libraries

Shardy doesn't use any third-party libraries for its work, almost. Below is a description of what is used and why:
- dotenv: to work with environment files
- ip: for displaying IP addresses
- winston: for working with the built-in logger
- ws: for working with websockets

And that's it. So, these libraries are used for auxiliary purposes (except ws), all main functions are native. 😎

# 🚀 Why should I use it

Start your project or backend for mobile game with Shardy and rest assured:

- **easy to use:** work with a user-friendly API and don't worry about how it works under the hood
- **scalable architecture:** get exists or create your own microservices, link them together and scale your app
- **fast & lightweight:** core network architecture, based on Node.js without any 3rd party libs
- **full docs:** Shardy provides good docs with all necessary sections and API references, also all code is coverged by comments ✌️

# 🗓️ Plans

The plans are truly grand! (just need free time :) It is to create an ecosystem for developers who will be able to build their game backend out of existing Shardy services like bricks.

First and foremost, services will be done such as:
- service locator
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

The list is endless.

Also in the plans: writing tutorials and more examples.
