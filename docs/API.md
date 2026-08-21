# Web API

REST API served by the WebUI backend on the port configured in `config.web.port` (default `18889`). All responses are JSON. CORS is enabled.

---

## Authentication

All API endpoints (except `/api/login`) require an `X-Auth-Token` header with the server password.

Password is configured in `config.web.auth.password`. If empty, a random password is generated on startup and logged to the console.

### `GET /api/login?pwd=<password>`

Authenticate and receive a token.

**Query params:**
- `pwd` — the server password

**Response (success):**
```json
{ "ok": true, "token": "the_password" }
```

**Response (wrong password):**
```json
{ "ok": false, "locked": false, "remaining": 2 }
```

**Response (locked out):**
```json
{ "ok": false, "locked": true, "waitSec": 45 }
```

Lockout triggers after `maxAttempts` failures within `windowMs` (default: 3 attempts / 60s). Lockout lasts `lockoutMs` (default: 60s).

---

## Status

### `GET /api/status`

Returns server status, connections, mods, and SAPI state.

**Response:**
```json
{
  "server": { "uptime": 12345, "wsPort": 8080, "name": "My Server", "webPort": 18889 },
  "connections": { "count": 2, "mainClient": "abc123", "clients": [{ "id": "abc123", "ip": "127.0.0.1", "isMain": true }] },
  "mods": { "server": ["mod1"], "client": ["mod2"] },
  "sapi": { "commandExists": true, "polling": true },
  "properties": {}
}
```

---

## Configuration

### `GET /api/config`

Returns current config. `apiKey` is masked as `"***"`.

### `PUT /api/config`

Save new config to disk and reload.

**Request body:** Full config JSON object.

**Response:**
```json
{ "ok": true, "message": "配置已保存" }
```

---

## Permissions

### `GET /api/permissions`

Returns full permission configuration.

**Response:**
```json
{ "owner": "PlayerName", "op": ["player1"], "user": ["player2"], "blocker": [] }
```

### `PUT /api/permissions`

Overwrite full permission configuration.

**Request body:** Full permission JSON object.

### `DELETE /api/permissions/:group/:player`

Remove a player from a permission group.

**URL params:**
- `group` — `owner` / `op` / `user` / `blocker`
- `player` — URL-encoded player name

---

## Mods

### `GET /api/mods`

List all loaded mods.

**Response:**
```json
{
  "server": [{ "name": "music", "type": "server" }],
  "client": [{ "name": "tool", "type": "client" }]
}
```

### `POST /api/mods/reload-all`

Reload config and all mods.

**Response:**
```json
{
  "ok": true,
  "server": { "success": ["music"], "failed": [] },
  "client": { "success": 1, "failed": [] }
}
```

---

## Commands

### `GET /api/commands`

List all registered commands with params and permission levels.

**Response:**
```json
[
  {
    "name": "t:help",
    "description": "View command help list",
    "level": "normal",
    "params": [{ "type": "Integer", "desc": "page", "optional": true }]
  }
]
```

### `POST /api/command`

Execute a Bedrock command via main client.

**Request body:**
```json
{ "command": "time set day" }
```

---

## Clients

### `GET /api/clients`

List all connected clients.

**Response:**
```json
[
  { "id": "abc123", "ip": "127.0.0.1", "isMain": true, "connectedAt": 1234567890, "localPlayerName": "Steve" }
]
```

### `POST /api/clients/:id/tell`

Send a tell message to a specific client.

**Request body:**
```json
{ "message": "Hello" }
```

### `POST /api/clients/:id/set-main`

Set a client as the main client.

---

## Logs

### `GET /api/logs`

Read log file.

**Query params:**
- `name` — log name (default: `app`)
- `lines` — number of lines (default: `200`)

**Response:**
```json
{ "lines": ["[2026-01-01 12:00:00] Server started"] }
```

### `GET /api/logs/live`

Get recent in-memory log buffer (last 100 entries).

**Response:**
```json
{ "lines": [{ "time": "12:00:00", "type": "info", "message": "Server started" }] }
```

---

## Chat

### `GET /api/chat`

Read last 100 lines from message.log.

**Response:**
```json
{ "lines": ["<Player> Hello world"] }
```

### `POST /api/chat`

Send a chat message via main client (tellAll).

**Request body:**
```json
{ "message": "Hello everyone" }
```

---

## System

### `GET /api/system/process`

Get Node.js process info.

**Response:**
```json
{
  "pid": 12345,
  "uptime": 600,
  "memory": { "rss": 50000000, "heapUsed": 20000000, "heapTotal": 30000000 },
  "nodeVersion": "v18.17.0",
  "platform": "linux"
}
```

---

## Static Files

Any request not matching `/api/*` is served from `web/frontend/dist/`. Missing files fall back to `index.html` (SPA routing).
