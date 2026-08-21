English | [简体中文](./README.md)

# StarWS

Minecraft Bedrock Edition WebSocket bridge server. Connects clients via the built-in WebSocket API and injects commands and automation through a Mod system.

## Features

- In-game command execution and automation (Litematic building import, image to pixel art, .mcfunction, etc.)
- AI chat and AI command execution (OpenAI-compatible API)
- MIDI music playback, region fill/copy, permission management, QQ group bridge
- Client/Server layered Mod loading system

## Quick Start

```bash
npm install
npm start
```

On first run, a web-based setup wizard will start. Follow the prompts and restart the server.

In-game, connect with `/connect 127.0.0.1:8080`.

## Commands

Type `t:help` in the game chat for command help. Full command reference in [docs](./docs/).

## License

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
