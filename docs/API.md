# API Reference

MCWSLoader exposes several programmatic APIs for Mod development and a REST API for the WebUI.

---

## Table of Contents

- [Mod System](#mod-system)
- [Client Utils](#client-utils)
- [Event Bus](#event-bus)
- [Storage](#storage)
- [Permission Manager](#permission-manager)
- [Current State](#current-state)
- [HTTP API](#http-api)

---

## Mod System

### ClientModManager

Manages client-side Mods. One instance per WebSocket connection.

**Static Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `ClientModManager.loadedMod` | `Object<string, Function>` | Map of loaded Mod class definitions |

**Static Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `ClientModManager.load()` | `Promise<void>` | Load all client Mods from `config.mods.client` |
| `ClientModManager.reloadAllClients()` | `Promise<{ success: string[], failed: string[] }>` | Reload all Mods on all connected clients |

**Instance Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `clientMod.client` | `Object` | The WebSocket connection |
| `clientMod.sapi` | `SAPIMessageHandler` | Shared SAPI polling handler |
| `clientMod.modInstances` | `Object<string, Object>` | Map of Mod name → instance |
| `clientMod.commands` | `{ normal: [], user: [], op: [], owner: [] }` | Commands grouped by permission level |

**Instance Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `clientMod.reload(name)` | `Promise<{ success: boolean, message: string }>` | Reload a single client Mod by name |
| `clientMod.reloadAll()` | `Promise<{ success: string[], failed: string[] }>` | Reload all client Mods on this connection |
| `clientMod.getMod(name)` | `Object \| null` | Get a Mod instance by name |
| `clientMod.getAllMods()` | `Object<string, Object>` | Get all Mod instances |
| `clientMod.callModMethod(method, ...args)` | `void` | Call a method on all Mod instances |
| `clientMod.destroy()` | `void` | Destroy all Mod instances and clean up |

**Mod Lifecycle:**

A client Mod class receives the WebSocket client in its constructor. Infrastructure is injected after construction:

```js
class MyMod {
	constructor(client) {
		this.client = client; // WebSocket connection
	}
	// Injected after construction:
	// this.modName, this.config, this.storage, this.logger
	// this.emit(event, data), this.on(event, callback), this.off(event)
	// this.sapi.on(type, cb), this.sapi.off(type), this.sapi.send(type, data)

	onStart() { /* called after injection */ }
	onDestroy() { /* called on unload */ }
	onPocket(data) { /* called on every WebSocket message */ }

	commands() {
		return {
			normal: [ /* commands */ ],
			user: [ /* commands */ ],
			op: [ /* commands */ ],
			owner: [ /* commands */ ]
		};
	}
}
```

---

### ServerModManager

Singleton manager for server-side Mods (one per server, not per connection).

**Static Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `ServerModManager.loadedMod` | `Object<string, Function>` | Map of loaded Mod class definitions |
| `ServerModManager.modInstances` | `Object<string, Object>` | Map of Mod name → instance |

**Static Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `ServerModManager.load()` | `Promise<void>` | Load all server Mods from `config.mods.server` |
| `ServerModManager.reload(modName)` | `Promise<{ success: boolean, message: string }>` | Reload a single server Mod |
| `ServerModManager.reloadAll()` | `Promise<{ success: string[], failed: string[] }>` | Reload all server Mods |
| `ServerModManager.getMod(name)` | `Object \| null` | Get a Mod instance by name |
| `ServerModManager.getAllMods()` | `Object<string, Object>` | Get all Mod instances |
| `ServerModManager.getLoadedModNames()` | `string[]` | Get all loaded Mod names |
| `ServerModManager.getModPath(name)` | `string \| null` | Get the file path for a Mod |
| `ServerModManager.destroy()` | `void` | Destroy all server Mods |

**Server Mod Lifecycle:**

Server Mods are singletons. Infrastructure is injected onto both the instance and the class:

```js
class MyServerMod {
	constructor() { /* no client arg */ }

	// Injected:
	// this.modName, this.config, this.storage, this.logger
	// this.emit(event, data) — sends to Current.client's client Mods
	// this.on(event, cb) — listens on Current.client events
	// this.onAll(event, cb) — listens on ALL clients via EventBus
	// this.off(event)
	// this.sapi — bound to Current.client's SAPI polling

	onStart() { /* called on load */ }
	onDestroy() { /* called on unload */ }
	onClientConnect(client, isMainClient) { /* new client connected */ }
	onClientDisconnect(client, isMainClient) { /* client disconnected */ }
	onMainClientConnect(client) { /* main client connected */ }
	onMainClientDisconnect() { /* main client disconnected */ }
	onMainClientSwitch(oldClient, newClient) { /* main client switched */ }
	onMessage(client, data) { /* raw WebSocket message from any client */ }
}
```

---

## Client Utils

The `Utils` class (`lib/utils.js`) is bound to each WebSocket connection as `client.utils`. Methods are also directly available on the `client` object.

### Command Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `client.sendCommand(command)` | `Promise<string \| undefined>` | Send command silently (no error) |
| `client.runCommand(command, timeout?)` | `Promise<Object>` | Execute command and return response (default 10s timeout) |

### Subscription Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `client.subscribe(event, callback?, owner?)` | `boolean` | Subscribe to a Bedrock event |
| `client.unsubscribe(event)` | `void` | Unsubscribe from an event |

### Messaging Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `client.tell(msg, target?, isPrefix?)` | `void` | Send tellraw message (OP required) |
| `client.tellAll(msg)` | `void` | Broadcast message to all players |

### Query Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `client.getLocation(target?)` | `Promise<{ x, y, z, dimension } \| null>` | Get player location |
| `client.getPosition(target?)` | `Promise<{ x, y, z } \| null>` | Get player position |
| `client.getDimension(target?)` | `Promise<string \| null>` | Get player dimension |
| `client.getInventory(target?)` | `Promise<Object \| undefined>` | Get player inventory |
| `client.getLocalPlayer()` | `Promise<string \| undefined>` | Get local player name via `getlocalplayername` |
| `client.getPermission()` | `number` | Get permission level (0–3) |
| `client.closechat()` | `Promise<boolean>` | Close the chat window |

---

## Event Bus

Global pub/sub for inter-Mod communication (`lib/mods.js` → `eventBus`).

| Method | Description |
|--------|-------------|
| `eventBus.on(event, modName, callback)` | Subscribe to an event |
| `eventBus.off(event, modName)` | Unsubscribe from an event |
| `eventBus.emit(event, data, excludeMod?)` | Publish an event (optionally exclude one Mod) |
| `eventBus.clearMod(modName)` | Remove all subscriptions for a Mod |
| `eventBus.clear()` | Remove all subscriptions |

---

## Storage

Per-Mod persistent key-value storage (`lib/mods.js` → `StorageManager`).

| Method | Description |
|--------|-------------|
| `StorageManager.getStore(modName)` | Get (or create) a Mod's storage instance |

**ModStorage instance:**

| Method | Returns | Description |
|--------|---------|-------------|
| `storage.get(key, default?)` | `*` | Get a value |
| `storage.set(key, value)` | `void` | Set a value |
| `storage.delete(key)` | `boolean` | Delete a key |
| `storage.has(key)` | `boolean` | Check if key exists |
| `storage.clear()` | `void` | Clear all data |
| `storage.keys()` | `string[]` | Get all keys |
| `storage.values()` | `*[]` | Get all values |
| `storage.entries()` | `[string, *][]` | Get all entries |

---

## Permission Manager

File-based permission system (`lib/permission.js`).

| Method | Returns | Description |
|--------|---------|-------------|
| `PermissionManager.get(object?)` | `Promise<Object \| Array>` | Get full config or specific group (`"all"`, `"owner"`, `"op"`, `"user"`, `"blocker"`) |
| `PermissionManager.set(newPermission)` | `Promise<true \| Error>` | Overwrite entire permission config |
| `PermissionManager.add(group, value)` | `Promise<true \| Error>` | Add a player to a group (`"op"`, `"user"`, `"blocker"`) |
| `PermissionManager.remove(group, value)` | `Promise<true \| Error>` | Remove a player from a group |
| `PermissionManager.query(queried)` | `Promise<number \| Error>` | Query permission level: `-1`=blocker, `0`=normal, `1`=user, `2`=op, `3`=owner |

---

## Current State

Global runtime state (`lib/current.js`).

| Property/Method | Type | Description |
|-----------------|------|-------------|
| `Current.client` | `Object \| null` | Current main client WebSocket connection |
| `Current.clientMods` | `Map<Object, ClientModManager>` | All connected clients → their Mod managers |
| `Current.properties` | `Object` | Runtime key-value properties |
| `Current.has(key)` | `boolean` | Check if a property exists |
| `Current.get(key)` | `*` | Get a property value |
| `Current.set(key, value)` | `*` | Set a property value |
| `Current.reset()` | `void` | Reset all state (called on main client disconnect) |

---

## HTTP API

REST API served by the WebUI backend. All endpoints require `X-Auth-Token` header except `/api/login`.

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `GET` | `/api/login?pwd=<password>` | No | Login, returns `{ ok, token }` |

### Status

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Server status, connections, mods, SAPI state |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Get config (`apiKey` masked) |
| `PUT` | `/api/config` | Save config to disk and reload |

### Permissions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/permissions` | Get full permission config |
| `PUT` | `/api/permissions` | Overwrite permission config |
| `POST` | `/api/permissions/:group/:player` | Add player to group (`owner`, `op`, `user`, `blocker`) |
| `DELETE` | `/api/permissions/:group/:player` | Remove player from group |

### Mods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/mods` | List all loaded Mods |
| `POST` | `/api/mods/reload-all` | Reload config + all Mods |
| `POST` | `/api/mods/:name/enable` | Enable a Mod |
| `POST` | `/api/mods/:name/disable` | Disable a Mod |
| `POST` | `/api/mods/:name/reload` | Reload a single Mod |
| `GET` | `/api/mods/:name/config` | Get Mod config |
| `PUT` | `/api/mods/:name/config` | Save Mod config |
| `GET` | `/api/mods/:name/manifest` | Get Mod manifest |
| `GET` | `/api/mods/:name/readme` | Get Mod README |

### Commands

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/commands` | List all registered commands |
| `POST` | `/api/command` | Execute a Bedrock command (`{ command }`) |

### Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/clients` | List connected clients (includes `localPlayerName`) |
| `POST` | `/api/clients/:id/tell` | Send tell to a client (`{ message }`) |
| `POST` | `/api/clients/:id/set-main` | Set a client as main |
| `POST` | `/api/clients/:id/disconnect` | Disconnect a client |

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/logs?name=app&lines=200` | Read log file |
| `GET` | `/api/logs/live` | Recent in-memory log buffer |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/chat` | Read last 100 chat lines |
| `POST` | `/api/chat` | Send chat via main client (`{ message }`) |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/system/process` | Node.js process info (pid, memory, uptime) |
| `POST` | `/api/system/kill` | Kill the server process |
| `POST` | `/api/system/restart` | Gracefully restart the server |

### Update

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/update/check` | Check for latest version on GitHub |
| `GET` | `/api/update/tags` | List available release versions |
| `POST` | `/api/update/do` | Update to latest version |
| `POST` | `/api/update/rollback` | Rollback to a specific version (`{ tag }`) |
