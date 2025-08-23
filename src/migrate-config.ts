#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

interface MCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ClaudeConfig {
  mcpServers?: Record<string, MCPServer>;
}

const CONFIG_PATHS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
  path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
];

async function findConfigFile(): Promise<string | null> {
  for (const configPath of CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

function transformConfig(config: ClaudeConfig): { config: ClaudeConfig; changes: string[] } {
  const changes: string[] = [];
  
  if (!config.mcpServers) {
    return { config, changes };
  }

  for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
    let modified = false;
    
    // Pattern 1: cmd /c npx
    if (serverConfig.command === 'cmd' && serverConfig.args?.[0] === '/c' && serverConfig.args?.[1] === 'npx') {
      const npxArgs = serverConfig.args.slice(2);
      serverConfig.command = 'npx';
      serverConfig.args = [
        '-y',
        'reliable-mcp',
        '--label',
        serverName,
        '--',
        'npx',
        '-y',
        ...npxArgs
      ];
      modified = true;
      changes.push(`${serverName}: Converted 'cmd /c npx' to 'npx -y reliable-mcp'`);
    }
    // Pattern 2: cmd.exe /d /s /c <command>
    else if ((serverConfig.command === 'cmd' || serverConfig.command === 'cmd.exe') && 
             serverConfig.args?.some(arg => arg === '/c')) {
      const cIndex = serverConfig.args.indexOf('/c');
      const commandArgs = serverConfig.args.slice(cIndex + 1);
      
      // Check if it's running an MCP server
      if (commandArgs.some(arg => arg.includes('mcp') || arg.includes('modelcontextprotocol'))) {
        serverConfig.command = 'npx';
        serverConfig.args = [
          '-y',
          'reliable-mcp',
          '--label',
          serverName,
          '--',
          ...commandArgs
        ];
        modified = true;
        changes.push(`${serverName}: Converted 'cmd /c ${commandArgs[0]}' to 'npx -y reliable-mcp'`);
      }
    }
    // Pattern 3: Direct npx without reliable-mcp
    else if (serverConfig.command === 'npx' && 
             !serverConfig.args?.includes('reliable-mcp') &&
             serverConfig.args?.some(arg => arg.includes('mcp') || arg.includes('modelcontextprotocol'))) {
      const originalArgs = serverConfig.args || [];
      serverConfig.args = [
        '-y',
        'reliable-mcp',
        '--label',
        serverName,
        '--',
        'npx',
        '-y',
        ...originalArgs.filter(arg => arg !== '-y') // Remove existing -y if present
      ];
      modified = true;
      changes.push(`${serverName}: Wrapped 'npx' with 'reliable-mcp'`);
    }
    // Pattern 4: node with MCP servers
    else if (serverConfig.command === 'node' && 
             serverConfig.args?.[0]?.includes('mcp')) {
      const originalArgs = serverConfig.args || [];
      serverConfig.command = 'npx';
      serverConfig.args = [
        '-y',
        'reliable-mcp',
        '--label',
        serverName,
        '--',
        'node',
        ...originalArgs
      ];
      modified = true;
      changes.push(`${serverName}: Wrapped 'node' command with 'reliable-mcp'`);
    }
  }

  return { config, changes };
}

async function main() {
  console.log(chalk.cyan('🔄 MCP Configuration Migration Tool\n'));
  
  // Parse arguments
  const args = process.argv.slice(2);
  const configPath = args[0] || await findConfigFile();
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const force = args.includes('--force') || args.includes('-f');
  
  // Check file size and delegate to streaming version if needed
  if (configPath && fs.existsSync(configPath)) {
    const stats = fs.statSync(configPath);
    const sizeMB = stats.size / (1024 * 1024);
    
    // For files over 10MB, use streaming processor
    if (sizeMB > 10) {
      const { migrateConfig } = require('./migrate-config-streaming');
      return migrateConfig(configPath, { dryRun, force });
    }
  }
  
  if (!configPath) {
    console.error(chalk.red('❌ No Claude configuration file found!'));
    console.error(chalk.yellow('\nPlease specify the path to your claude_desktop_config.json:'));
    console.error(chalk.gray('  npx reliable-mcp migrate <path-to-config>'));
    process.exit(1);
  }

  if (!fs.existsSync(configPath)) {
    console.error(chalk.red(`❌ Configuration file not found: ${configPath}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`📁 Config file: ${configPath}\n`));

  // Read config
  let config: ClaudeConfig;
  try {
    const configContent = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configContent);
  } catch (error: any) {
    console.error(chalk.red(`❌ Failed to read config: ${error.message}`));
    process.exit(1);
  }

  // Create backup
  const backupPath = `${configPath}.backup.${Date.now()}`;
  if (!dryRun) {
    fs.copyFileSync(configPath, backupPath);
    console.log(chalk.green(`✅ Backup created: ${backupPath}\n`));
  }

  // Transform config
  const { config: newConfig, changes } = transformConfig(config);

  if (changes.length === 0) {
    console.log(chalk.green('✨ No changes needed - config is already optimized!'));
    return;
  }

  // Show changes
  console.log(chalk.yellow(`📝 Changes to be made:\n`));
  changes.forEach(change => {
    console.log(`  • ${change}`);
  });
  console.log();

  if (dryRun) {
    console.log(chalk.cyan('🔍 Dry run mode - no changes were made'));
    console.log(chalk.gray('\nNew configuration would be:'));
    console.log(JSON.stringify(newConfig, null, 2));
    return;
  }

  // Confirm changes
  if (!force) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise<string>(resolve => {
      rl.question(chalk.yellow('Apply these changes? (y/N): '), resolve);
    });
    rl.close();

    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.yellow('❌ Migration cancelled'));
      fs.unlinkSync(backupPath);
      console.log(chalk.gray('Backup removed'));
      return;
    }
  }

  // Write new config
  try {
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    console.log(chalk.green('\n✅ Configuration migrated successfully!'));
    console.log(chalk.gray(`\nBackup saved at: ${backupPath}`));
    console.log(chalk.cyan('\n⚠️  Please restart Claude for changes to take effect'));
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Failed to write config: ${error.message}`));
    console.log(chalk.yellow(`\nRestoring from backup...`));
    fs.copyFileSync(backupPath, configPath);
    console.log(chalk.green('✅ Original configuration restored'));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red(`\n❌ Unexpected error: ${error.message}`));
    process.exit(1);
  });
}

export { transformConfig, findConfigFile };