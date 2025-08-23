# reliable-mcp 🛡️

**Stop MCP servers from becoming zombies on Windows.** A smart process wrapper that ensures proper cleanup when Claude Code exits.

## The Problem

MCP servers spawned via `cmd.exe` become orphaned when Claude Code closes, leading to:
- 🧟 Hundreds of zombie Node.js processes
- 💾 Gigabytes of wasted RAM  
- 🔍 Processes impossible to identify in Task Manager

## The Solution

```bash
# Instead of this (creates zombies):
cmd /c npx @modelcontextprotocol/server-memory

# Use this:
npx -y reliable-mcp -- npx -y @modelcontextprotocol/server-memory
```

## Quick Start

```bash
# Auto-migrate your existing Claude config
npx -y reliable-mcp migrate

# Or install globally
npm install -g reliable-mcp
```

## Features

✅ **Proper signal forwarding** - SIGTERM, SIGINT, SIGBREAK on Windows  
✅ **Process tree termination** - Kills entire tree, not just parent  
✅ **Easy identification** - Shows as `reliable-mcp: [name]` in Task Manager  
✅ **Auto-migration** - Converts existing configs with one command  
✅ **Efficient for large files** - Streaming processor for >10MB configs  
✅ **Cleanup utilities** - Find and kill existing zombies  

## Commands

```bash
# Wrap any command
reliable-mcp -- <command> [args...]

# Clean up existing zombies
reliable-mcp cleanup

# List MCP processes
reliable-mcp list

# Migrate Claude Desktop config only
reliable-mcp migrate [--dry-run]

# Migrate ALL Claude configs (.claude.json, .mcp.json, etc.)
reliable-mcp migrate-all [--dry-run] [--verbose]
```

### The `migrate-all` Command

This powerful command finds and migrates MCP servers across ALL Claude configuration files:
- `~/.claude.json` - Claude Code workspace config
- `~/.mcp.json` - Dedicated MCP server config
- `~/.claude/settings*.json` - Local settings
- `%APPDATA%\Claude\*.json` - Desktop app configs
- Project-level `.mcp.json` files

It uses concurrent file searching and efficient parsing to handle even complex multi-project setups.

## How It Works

1. **No cmd.exe intermediary** - Direct process spawning eliminates broken signal chain
2. **Windows-aware** - Uses `tree-kill` and WMI for reliable termination
3. **Proper cleanup handlers** - Registers handlers for all termination signals
4. **Smart config migration** - Automatically wraps all MCP servers

## Example Claude Config

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "reliable-mcp", "--label", "memory", "--", "npx", "-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

## Why This Exists

This tool was created after discovering 19 zombie MCP processes consuming ~1GB RAM from old Claude Code sessions. The root cause: Windows `cmd.exe` doesn't forward termination signals to child processes, leaving them orphaned when the parent dies.

## License

MIT

---

**Built to solve a real problem.** If you use Claude Code with MCP servers on Windows, you need this.