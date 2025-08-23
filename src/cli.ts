#!/usr/bin/env node

import chalk from 'chalk';
import { ProcessWrapper } from './process-wrapper';
import { WindowsUtils } from './windows-utils';
import * as os from 'os';
import * as path from 'path';

const isWindows = os.platform() === 'win32';

// Check if this is a subcommand
const subcommands = ['cleanup', 'list', 'migrate', 'migrate-all', 'help', '--help', '-h', '--version', '-V'];
const isSubcommand = process.argv.length > 2 && subcommands.includes(process.argv[2]);

if (!isSubcommand) {
  // Main wrapper functionality
  runWrapper();
} else {
  // Handle subcommands
  runSubcommands();
}

async function runWrapper() {
  const dashIndex = process.argv.indexOf('--');
  
  if (dashIndex === -1 || dashIndex === process.argv.length - 1) {
    console.error(chalk.red('Error: No command specified after --'));
    console.error(chalk.yellow('Usage: reliable-mcp [options] -- <command> [args...]'));
    console.error(chalk.yellow('Example: reliable-mcp --label my-server -- npx @modelcontextprotocol/server-memory'));
    console.error(chalk.yellow('\nOther commands:'));
    console.error(chalk.yellow('  reliable-mcp cleanup    - Find and kill orphaned MCP processes'));
    console.error(chalk.yellow('  reliable-mcp list       - List all MCP-related processes'));
    process.exit(1);
  }

  // Parse options manually
  const options: any = {
    label: undefined,
    timeout: undefined,
    cwd: undefined,
    verbose: false,
    detached: false,
    shell: undefined,
    windowsHide: true,
  };

  for (let i = 2; i < dashIndex; i++) {
    const arg = process.argv[i];
    const next = process.argv[i + 1];
    
    switch (arg) {
      case '-l':
      case '--label':
        options.label = next;
        i++;
        break;
      case '-t':
      case '--timeout':
        options.timeout = parseInt(next);
        i++;
        break;
      case '-c':
      case '--cwd':
        options.cwd = next;
        i++;
        break;
      case '-v':
      case '--verbose':
        options.verbose = true;
        break;
      case '-d':
      case '--detached':
        options.detached = true;
        break;
      case '-s':
      case '--shell':
        options.shell = next && !next.startsWith('-') ? next : true;
        if (next && !next.startsWith('-')) i++;
        break;
      case '--no-hide':
        options.windowsHide = false;
        break;
    }
  }

  const commandArgs = process.argv.slice(dashIndex + 1);
  const command = commandArgs[0];
  const args = commandArgs.slice(1);

  if (!command) {
    console.error(chalk.red('Error: Command cannot be empty'));
    process.exit(1);
  }

  // Resolve command path if it's npx on Windows
  let resolvedCommand = command;
  if (isWindows && command === 'npx') {
    // Try to find npx.cmd in npm global or local installation
    const npmPath = process.env.npm_config_prefix || path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs');
    const npxCmd = path.join(npmPath, 'npx.cmd');
    const npxBat = path.join(npmPath, 'npx.bat');
    
    // Check which one exists
    const fs = require('fs');
    if (fs.existsSync(npxCmd)) {
      resolvedCommand = npxCmd;
    } else if (fs.existsSync(npxBat)) {
      resolvedCommand = npxBat;
    }
  }

  const wrapper = new ProcessWrapper({
    command: resolvedCommand,
    args,
    label: options.label || path.basename(command),
    timeout: options.timeout,
    cwd: options.cwd,
    verbose: options.verbose,
    detached: options.detached,
    shell: options.shell,
    windowsHide: options.windowsHide,
  });

  if (options.verbose) {
    console.log(chalk.cyan(`[reliable-mcp] Starting: ${command} ${args.join(' ')}`));
    console.log(chalk.cyan(`[reliable-mcp] Platform: ${os.platform()}`));
    console.log(chalk.cyan(`[reliable-mcp] Process label: ${options.label || path.basename(command)}`));
    if (options.timeout) {
      console.log(chalk.cyan(`[reliable-mcp] Timeout: ${options.timeout}ms`));
    }
  }

  try {
    const exitCode = await wrapper.start();
    
    if (options.verbose) {
      console.log(chalk.green(`[reliable-mcp] Process exited with code ${exitCode}`));
    }
    
    process.exit(exitCode);
  } catch (error: any) {
    console.error(chalk.red(`[reliable-mcp] Error: ${error.message}`));
    process.exit(1);
  }
}

async function runSubcommands() {
  const subcommand = process.argv[2];
  
  switch (subcommand) {
    case '--version':
    case '-V':
      console.log('1.0.0');
      break;
      
    case '--help':
    case '-h':
    case 'help':
      console.log('Usage: reliable-mcp [options] -- <command> [args...]');
      console.log('\nA reliable process wrapper for MCP servers that properly handles termination');
      console.log('\nOptions:');
      console.log('  -l, --label <name>     Process label for identification');
      console.log('  -t, --timeout <ms>     Process timeout in milliseconds');
      console.log('  -c, --cwd <dir>        Working directory for the process');
      console.log('  -v, --verbose          Enable verbose logging');
      console.log('  -d, --detached         Run process detached (Unix only)');
      console.log('  -s, --shell [shell]    Run command in shell');
      console.log('  --no-hide              Show console window on Windows');
      console.log('\nCommands:');
      console.log('  cleanup [options]      Find and kill orphaned MCP server processes');
      console.log('  list [options]         List all MCP-related processes');
      console.log('  migrate [options]      Migrate Claude Desktop config to use reliable-mcp');
      console.log('  migrate-all [options]  Migrate ALL Claude configs (.claude.json, .mcp.json)');
      break;
      
    case 'cleanup':
      await runCleanup();
      break;
      
    case 'list':
      await runList();
      break;
      
    case 'migrate':
      // Launch the migrate script for Claude Desktop
      require('./migrate-config');
      break;
      
    case 'migrate-all':
      // Launch the comprehensive migration for all Claude configs
      require('./migrate-claude-json');
      break;
      
    default:
      console.error(chalk.red(`Unknown command: ${subcommand}`));
      process.exit(1);
  }
}

async function runCleanup() {
  const options = {
    force: process.argv.includes('-f') || process.argv.includes('--force'),
    pattern: 'mcp'
  };
  
  // Check for pattern option
  const patternIndex = process.argv.findIndex(arg => arg === '-p' || arg === '--pattern');
  if (patternIndex !== -1 && process.argv[patternIndex + 1]) {
    options.pattern = process.argv[patternIndex + 1];
  }
  if (!isWindows) {
    console.log(chalk.yellow('Cleanup command is currently Windows-only'));
    process.exit(0);
  }

  console.log(chalk.cyan('Searching for orphaned MCP processes...'));
  
  const processes = await WindowsUtils.findProcesses(options.pattern);
  const mcpProcesses = processes.filter(p => 
    p.commandLine.includes('mcp') || 
    p.commandLine.includes('modelcontextprotocol') ||
    p.commandLine.includes('reliable-mcp')
  );

  if (mcpProcesses.length === 0) {
    console.log(chalk.green('No orphaned MCP processes found'));
    return;
  }

  console.log(chalk.yellow(`Found ${mcpProcesses.length} potential MCP processes:`));
  mcpProcesses.forEach(p => {
    console.log(`  PID ${p.pid}: ${p.name} - ${p.commandLine.substring(0, 100)}${p.commandLine.length > 100 ? '...' : ''}`);
  });

  if (!options.force) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>(resolve => {
      rl.question(chalk.yellow('\nKill these processes? (y/N): '), resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.yellow('Cleanup cancelled'));
      return;
    }
  }

  let killed = 0;
  let failed = 0;

  for (const proc of mcpProcesses) {
    if (WindowsUtils.killProcessTree(proc.pid, true)) {
      console.log(chalk.green(`  ✓ Killed PID ${proc.pid}`));
      killed++;
    } else {
      console.log(chalk.red(`  ✗ Failed to kill PID ${proc.pid}`));
      failed++;
    }
  }

  console.log(chalk.cyan(`\nCleanup complete: ${killed} killed, ${failed} failed`));
}

async function runList() {
  const showAll = process.argv.includes('-a') || process.argv.includes('--all');
  if (!isWindows) {
    console.log(chalk.yellow('List command is currently Windows-only'));
    process.exit(0);
  }

  const pattern = showAll ? 'node' : 'mcp';
  console.log(chalk.cyan(`Searching for ${showAll ? 'Node.js' : 'MCP'} processes...`));
  
  const processes = await WindowsUtils.findProcesses(pattern);
  
  if (processes.length === 0) {
    console.log(chalk.green('No processes found'));
    return;
  }

  console.log(chalk.yellow(`Found ${processes.length} processes:\n`));
  
  for (const proc of processes) {
    const info = await WindowsUtils.getProcessInfo(proc.pid);
    if (info) {
      console.log(chalk.cyan(`PID ${info.pid}:`));
      console.log(`  Name: ${info.name}`);
      console.log(`  Memory: ${info.memoryUsage?.toFixed(2)} MB`);
      console.log(`  CPU Time: ${info.cpuTime?.toFixed(2)} seconds`);
      console.log(`  Command: ${info.commandLine.substring(0, 120)}${info.commandLine.length > 120 ? '...' : ''}`);
      console.log();
    }
  }
}