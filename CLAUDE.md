# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

reliable-mcp is a process wrapper for MCP (Model Context Protocol) servers that solves the zombie process problem on Windows. It ensures proper signal forwarding and process cleanup when Claude Code exits.

## Development Commands

```bash
# Build TypeScript to JavaScript
npm run build

# Watch mode for development
npm run dev

# Run tests
npm test

# Run a specific test file
npx jest src/process-wrapper.test.ts

# Start the CLI directly
npm start
```

## Architecture

### Core Components

1. **ProcessWrapper** (`src/process-wrapper.ts`)
   - Main class that spawns and manages child processes
   - Handles signal forwarding (SIGTERM, SIGINT, SIGBREAK) 
   - Uses `tree-kill` for reliable process tree termination on Windows
   - Implements timeout management and verbose logging

2. **CLI Entry Point** (`src/cli.ts`)
   - Parses command-line arguments and routes to subcommands
   - Subcommands: `migrate`, `migrate-all`, `cleanup`, `list`
   - When no subcommand is provided, acts as a process wrapper

3. **Migration System**
   - **migrate-config.ts**: Handles single file migration, delegates to MCPServerMigrator for .claude.json/.mcp.json files
   - **migrate-claude-json.ts**: Contains MCPServerMigrator class that handles all Claude config formats
   - **migrate-config-streaming.ts**: Handles large config files (>10MB) with streaming JSON processing
   - Migration patterns: cmd /c wrapping, npx wrapping, node/python MCP server wrapping

4. **Windows Utilities** (`src/windows-utils.ts`)
   - Windows-specific process management using WMI
   - Process discovery and cleanup functionality
   - Only used when platform is Windows

### File Formats Handled

- `.claude.json` - Claude Code workspace config with project-level mcpServers
- `.mcp.json` - Dedicated MCP server configurations
- `claude_desktop_config.json` - Claude Desktop application config
- All configs can have nested `mcpServers` objects that get migrated

### Key Design Decisions

- The tool acts as a transparent wrapper - it spawns the actual command and forwards all I/O
- Uses `require()` instead of ES modules for CLI commands to maintain compatibility
- Migration functions are exposed as public methods to allow reuse between migrate and migrate-all
- Process title is set to `reliable-mcp: [label]` for easy identification in Task Manager

## Testing

Tests use Jest with ts-jest for TypeScript support. The main test file is `process-wrapper.test.ts`.

## Publishing

The package is published to npm as `reliable-mcp`. The `prepublishOnly` script ensures the code is built before publishing.

Binary entry points:
- `reliable-mcp` - Main CLI command
- `rmcp` - Shorter alias
- `reliable-mcp-migrate` - Direct migration script (legacy)

## Important Implementation Details

- When parsing arguments in migration commands, need to skip the command name itself (e.g., 'migrate') from process.argv
- The tool detects if it's being run as a subcommand by checking process.argv[2] against known subcommands
- File paths with backslashes on Windows need to be quoted when passed as arguments
- The migrator checks for existing reliable-mcp wrapping to avoid double-wrapping