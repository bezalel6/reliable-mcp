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

# Use this (with global install - no Claude warnings!):
reliable-mcp -- npx -y @modelcontextprotocol/server-memory

# Or without installing:
npx -y reliable-mcp -- npx -y @modelcontextprotocol/server-memory
```

## Quick Start

```bash
# Install globally (recommended - avoids Claude Code warnings!)
npm install -g reliable-mcp

# Auto-migrate ALL your Claude configs at once
reliable-mcp migrate-all

# Or migrate a specific config file
reliable-mcp migrate .claude.json

# Or use without installing
npx -y reliable-mcp migrate-all
```

## Features

✅ **Proper signal forwarding** - SIGTERM, SIGINT, SIGBREAK on Windows  
✅ **Process tree termination** - Kills entire tree, not just parent  
✅ **Easy identification** - Shows as `reliable-mcp: [name]` in Task Manager  
✅ **Smart migration** - Handles all Claude config formats (.claude.json, .mcp.json, etc.)  
✅ **Bulk migration** - Update all configs at once with `migrate-all`  
✅ **Undo migrations** - Restore configs from automatic backups with `restore` commands  
✅ **Efficient for large files** - Streaming processor for >10MB configs  
✅ **Cleanup utilities** - Find and kill existing zombies  
✅ **Project-aware** - Migrates project-level MCP servers in .claude.json  
✅ **Windows npx support** - Automatically handles npx batch file execution on Windows  
✅ **No Claude warnings** - Global install eliminates "invalid configuration" warnings  

## Commands

```bash
# Wrap any command
reliable-mcp -- <command> [args...]

# Clean up existing zombies
reliable-mcp cleanup

# List MCP processes
reliable-mcp list

# Migrate a specific config file (supports all Claude config types)
reliable-mcp migrate <path-to-config> [--dry-run] [--verbose]

# Migrate ALL Claude configs automatically
reliable-mcp migrate-all [--dry-run] [--verbose]

# Restore a config from backup (undo migration)
reliable-mcp restore <path-to-config> [--dry-run] [--force]

# Restore ALL configs from backups (undo all migrations)
reliable-mcp restore-all [--dry-run] [--force]
```

### Migration Commands

#### `migrate` - Migrate specific config files

The `migrate` command now intelligently handles all Claude configuration formats:

```bash
# Migrate a project's .claude.json (includes project-level servers)
reliable-mcp migrate .claude.json --dry-run

# Migrate a specific config with full path
reliable-mcp migrate "C:\Users\name\.claude.json" --dry-run

# Migrate Claude Desktop config
reliable-mcp migrate claude_desktop_config.json --dry-run

# Migrate an MCP-specific config
reliable-mcp migrate .mcp.json --dry-run
```

**Supports:**
- `.claude.json` files with project-level MCP servers
- `.mcp.json` dedicated MCP configurations
- `claude_desktop_config.json` Claude Desktop settings
- Any Claude-related JSON config with MCP servers

#### `migrate-all` - Comprehensive migration

Finds and migrates MCP servers across ALL Claude configuration files automatically:

```bash
# Preview all changes
reliable-mcp migrate-all --dry-run --verbose

# Apply migrations to all configs
reliable-mcp migrate-all

# Search specific directory tree
reliable-mcp migrate-all ./my-project --dry-run
```

**Searches for:**
- `~/.claude.json` - Claude Code workspace config
- `~/.mcp.json` - Dedicated MCP server config
- `~/.claude/settings*.json` - Local settings
- `%APPDATA%\Claude\*.json` - Desktop app configs
- Project-level `.mcp.json` files
- Any nested `.claude` directories

**Migration patterns handled:**
- `cmd /c npx` → Wrapped with reliable-mcp
- Direct `npx` commands → Wrapped with reliable-mcp
- `node` MCP servers → Wrapped with reliable-mcp
- `python` MCP servers → Wrapped with reliable-mcp
- Already wrapped servers → Skipped (no double-wrapping)

**Options:**
- `--dry-run` / `-d` - Preview changes without modifying files
- `--verbose` / `-v` - Show detailed processing information
- `--force` / `-f` - Skip confirmation prompts

### Restore Commands

#### `restore` - Restore a specific config from backup

Restore a single configuration file from its most recent backup (created during migration):

```bash
# Restore a specific file
reliable-mcp restore .claude.json

# Preview what would be restored
reliable-mcp restore .claude.json --dry-run

# Restore without confirmation prompt
reliable-mcp restore "C:\Users\name\.claude.json" --force
```

#### `restore-all` - Bulk restoration

Restore ALL configuration files from their most recent backups:

```bash
# Find and restore all configs with backups
reliable-mcp restore-all

# Preview all restorations
reliable-mcp restore-all --dry-run

# Restore all without prompts
reliable-mcp restore-all --force
```

**Important notes:**
- Backups are created automatically during migration with timestamp (e.g., `.claude.json.backup.1703123456789`)
- The restore commands use the most recent backup for each file
- A safety backup is created before restoration (`.before-restore.timestamp`)
- Multiple backups are kept, sorted by timestamp

## How It Works

1. **No cmd.exe intermediary** - Direct process spawning eliminates broken signal chain
2. **Windows-aware** - Uses `tree-kill` and WMI for reliable termination
3. **Proper cleanup handlers** - Registers handlers for all termination signals
4. **Smart config migration** - Automatically wraps all MCP servers

## Usage Examples

### Basic wrapping
```bash
# Wrap an MCP server
reliable-mcp --label my-server -- npx -y @modelcontextprotocol/server-memory

# With custom timeout
reliable-mcp --timeout 30000 -- node ./my-mcp-server.js

# With verbose logging
reliable-mcp --verbose -- python mcp_server.py
```

### Migration examples
```bash
# Migrate your user .claude.json
reliable-mcp migrate ~/.claude.json

# Preview changes to all configs
reliable-mcp migrate-all --dry-run

# Migrate with detailed output
reliable-mcp migrate-all --verbose

# Force migration without prompts
reliable-mcp migrate-all --force
```

## Example Claude Config

After migration with global install, your configs will look like this:

```json
{
  "mcpServers": {
    "memory": {
      "command": "reliable-mcp",
      "args": ["--label", "memory", "--", "npx", "-y", "@modelcontextprotocol/server-memory"]
    }
  }
}
```

**Note:** When `reliable-mcp` is installed globally, the migrator uses it directly without `npx`, eliminating Claude Code's "invalid configuration" warnings about npx commands.

For `.claude.json` with project-level servers (with global install):

```json
{
  "projects": {
    "C:/my-project": {
      "mcpServers": {
        "filesystem": {
          "command": "reliable-mcp",
          "args": ["--label", "filesystem", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem"]
        }
      }
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