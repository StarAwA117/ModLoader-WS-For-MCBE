# Commands

All commands use the prefix defined in `config.json` (`commandPrefix`, default `!`). Parameters in `[brackets]` are optional.

## Permission Levels

| Level | Value | Description |
|-------|:-----:|-------------|
| `normal` | 0 | Default for all players |
| `user` | 1 | Requires `user` or higher |
| `op` | 2 | Requires `op` or higher |
| `owner` | 3 | Server owner only |
| `blocker` | -1 | Blacklisted, all commands denied |

---

## Tool (`t:`)

### normal

| Command | Description | Parameters |
|---------|-------------|------------|
| `t:help [page]` | View command help list | `page` — page number |
| `t:search <keyword> [page]` | Search commands by keyword | `keyword` — search term |

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `t:send <message>` | Broadcast message to all clients | `message` — message content |
| `t:tellall [true/false]` | Toggle tellAll forwarding mode | `true` = forward as tell |
| `t:cmd <command>` | Execute a Bedrock command | `command` — Bedrock command |

### owner

| Command | Description | Parameters |
|---------|-------------|------------|
| `t:ping` | Check server latency | — |
| `t:time` | View current time (Beijing) | — |
| `t:start` | Restart SAPI polling | — |
| `t:move` | Set current client as main | — |
| `t:reload [modName]` | Reload client mods | `modName` — single mod (omit for all) |
| `t:mod` | List all client mods | — |
| `t:exec <command>` | Execute shell command on server | `command` — shell command |

---

## Music (`m:`)

### normal

| Command | Description | Parameters |
|---------|-------------|------------|
| `m:join` | Join music listening | — |
| `m:exit` | Exit music listening | — |
| `m:status` | View playback progress | — |
| `m:list [page]` | View music list | `page` — page number |
| `m:search <keyword> [page]` | Search music files | `keyword` — search term |
| `m:percussion <on/off>` | Toggle percussion instruments | `on` / `off` |

### user

| Command | Description | Parameters |
|---------|-------------|------------|
| `m:run [fileName]` | Play a specific music file | `fileName` — file name |
| `m:next` | Switch to next track | — |
| `m:random` | Play random music | — |
| `m:loop <mode> [song]` | Set loop mode | `next` / `random` / `single`; `song` — for single mode |
| `m:stop [scope]` | Stop playback | `music` / `loop` / `all` (default: all) |

---

## Permission (`p:`)

### normal

| Command | Description | Parameters |
|---------|-------------|------------|
| `p:query [account]` | Query permission level | `account` — player name (default: self) |

### owner

| Command | Description | Parameters |
|---------|-------------|------------|
| `p:add <type> <account>` | Add permission | `type` — op/user/blocker; `account` — player name |
| `p:remove <type> <account>` | Remove permission | `type` — op/user/blocker; `account` — player name |

---

## Position / Region (`p:`)

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `p:a [X Y Z]` | Set point A | `X Y Z` — coordinates (default: self) |
| `p:b [X Y Z]` | Set point B | `X Y Z` — coordinates (default: self) |
| `p:show` | Display A/B coordinates | — |
| `p:distance` | Calculate distance between A and B | — |
| `p:offset` | Calculate offset from A to B | — |
| `p:fill <block> [replace]` | Fill region | `block` — block ID; `replace` — target block to replace |
| `p:copy` | Copy region | — |
| `p:paste [X Y Z]` | Paste structure | `X Y Z` — paste location (default: self) |
| `p:cut` | Cut region (copy + fill air) | — |
| `p:cancel` | Cancel current operation | — |
| `p:status` | View task progress | — |

---

## AI Chat (`ai`)

### normal

| Command | Description | Parameters |
|---------|-------------|------------|
| `ai <message>` | Chat with AI | `message` — chat content |
| `ai:reset` | Reset conversation context | — |

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `ai:c <message>` | Ask AI to execute Bedrock commands | `message` — chat content |

---

## Pi Agent (`pa`)

### normal

| Command | Description | Parameters |
|---------|-------------|------------|
| `pa <message>` | Chat with Pi AI agent | `message` — chat content |
| `pa:new` | Start a new conversation session | — |
| `pa:info` | View AI info (model, tokens, etc.) | — |
| `pa:idle` | Toggle idle messages | `test` — send test idle message |

### owner

| Command | Description | Parameters |
|---------|-------------|------------|
| `pa:status` | View conversation status | — |
| `pa:session` | View session count | `clear` — clear all sessions |

---

## Litematic (`l:`)

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `l:help [command]` | View command help | `command` — specific command name |
| `l:list [page]` | View building file list | `page` — page number |
| `l:search <keyword> [page]` | Search building files | `keyword` — search term |
| `l:create <file> [X Y Z] [mode]` | Import Litematic projection | `file` — file name; `X Y Z` — position; `mode` — trim/raw |
| `l:y` | Confirm import | — |
| `l:n` | Cancel/interrupt | — |
| `l:status` | View progress | — |
| `l:preview <file> [X Y Z] [mode]` | Preview building position | `file` — file name; `X Y Z` — position; `mode` — trim/raw |
| `l:unpreview` | Clear preview | — |
| `l:export <file> [name] [mode]` | Export as .mcstructure | `file` — file name; `name` — export name; `mode` — trim/raw |
| `l:id` | View all task IDs | — |
| `l:verify <id> [mode]` | Check projection vs world | `id` — task ID; `mode` — map/world |
| `l:fix <id> [block]` | Fix broken blocks | `id` — task ID; `block` — replacement block |
| `l:author` | View author info | — |

---

## Image (`i:`)

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `i:create <file> [dir] [X Y Z]` | Convert image to pixel art | `file` — image name; `dir` — x/y/z; `X Y Z` — position |
| `i:raw <file> [dir] [X Y Z]` | Original size conversion | `file` — image name; `dir` — x/z; `X Y Z` — position |
| `i:y` | Confirm conversion | — |
| `i:n` | Cancel/interrupt | — |
| `i:status` | View progress | — |

---

## MCFunction (`f:`)

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `f:function <path>` | Run .mcfunction file | `path` — file path |
| `f:loop <path> <name> <sec>` | Loop-run function | `path` — file path; `name` — loop name; `sec` — interval in seconds |
| `f:stop [name]` | Stop loop(s) | `name` — loop name (omit for all) |

---

## Multi-WebSocket (`c:`)

### op

| Command | Description | Parameters |
|---------|-------------|------------|
| `c:connect <url>` | Connect to another WebSocket server | `url` — WebSocket address |

---

## QQ Bridge (`q:`)

Requires `features.qq.enabled` in config.

### user

| Command | Description | Parameters |
|---------|-------------|------------|
| `q:send <message>` | Send message to QQ group | `message` — message content |

### owner

| Command | Description | Parameters |
|---------|-------------|------------|
| `q:check` | Check and reconnect QQ | — |
| `q:toggle [true/false]` | Enable/disable QQ bridge | `true` / `false` |

---

## Terminal Commands

These are entered in the server terminal (stdin), not in-game.

| Command | Description |
|---------|-------------|
| `!test` | Test command |
| `!p:list` | List all connected clients |
| `!p:reload` | Reload all mods + config |
| `!p:mod` | List all mods |
| `!bye` | Force exit current room |
| `!c:attack` | Start chat spam attack |
| `!c:count` | Chat crash countdown |
| `!c:crash` | Crash client chat |
| `!c:clear` | Clear chat screen |
| `!c:ad` | Push advertisements |
| `!c:repeat <text>` | Spam specified content |
| `!c:stop` | Stop all spamming |
| `!c:line <text>` | Send multi-line message |

Terminal also supports:
- `/command` — forward as Bedrock command (e.g. `/time set day`)
- Plain text — broadcast as chat to all clients
