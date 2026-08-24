English | [简体中文](./README.md)

# MCWSLoader

Minecraft Bedrock Edition WebSocket bridge server. Connects clients via the built-in WebSocket API and injects commands and automation through a Mod system.

## Features

- In-game command execution and automation (Litematic building import, image to pixel art, .mcfunction, etc.)
- AI chat and AI command execution (OpenAI-compatible API)
- MIDI music playback, region fill/copy, permission management, QQ group bridge
- Client/Server layered Mod loading system
- Web management interface (port 18889), with online config, Mod management, log viewer, and version updates

## Quick Start

```bash
npm start
```

On first run, `config.json` is automatically initialized from `config.example.json`. After startup, visit the WebUI at `http://127.0.0.1:18889` to configure settings online.

In-game, connect with `/connect 127.0.0.1:8080`.

## WebUI Features

After startup, visit `http://127.0.0.1:18889` to open the management panel:

- **Dashboard**: server status, uptime, connected clients, process info
- **Mods**: enable/disable/reload Mods, view manifest and readme
- **Commands**: execute Bedrock commands and view results
- **Clients**: view connected clients, switch main client
- **Logs**: view runtime logs and chat history
- **Config**: edit server, WebUI, SAPI, rate limit settings online
- **Update**: check GitHub latest release, select version to update or rollback

## Self-Update

The WebUI has a built-in updater that detects the latest GitHub Release version, with support for:
- One-click update to the latest version
- Rollback to any selected Release version from the version list
- Automatic restart prompt after update

## Commands

Type `t:help` in the game chat for command help. Full command reference in [docs](./docs/).

## License

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
