#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { Transform } from 'stream';

interface MCPServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

const CONFIG_PATHS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
  path.join(os.homedir(), '.config', 'claude', 'claude_desktop_config.json'),
  path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
];

/**
 * Efficient streaming JSON processor that only modifies the mcpServers section
 * without loading the entire file into memory
 */
class MCPConfigTransformer extends Transform {
  private buffer = '';
  private inMcpServers = false;
  private depth = 0;
  private mcpServersDepth = -1;
  private changes: string[] = [];
  private currentServerName = '';
  private bracketStack: string[] = [];

  constructor() {
    super({ encoding: 'utf8' });
  }

  _transform(chunk: any, encoding: string, callback: Function) {
    this.buffer += chunk;
    
    // Process buffer line by line for better memory efficiency
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // Keep incomplete line in buffer
    
    for (const line of lines) {
      const processedLine = this.processLine(line);
      this.push(processedLine + '\n');
    }
    
    callback();
  }

  _flush(callback: Function) {
    if (this.buffer) {
      this.push(this.processLine(this.buffer));
    }
    callback();
  }

  private processLine(line: string): string {
    // Track if we're in mcpServers section
    if (line.includes('"mcpServers"')) {
      this.inMcpServers = true;
      this.mcpServersDepth = this.depth;
      return line;
    }

    // Track depth with brackets
    const openBrackets = (line.match(/[{[]/g) || []).length;
    const closeBrackets = (line.match(/[}\]]/g) || []).length;
    this.depth += openBrackets - closeBrackets;

    // Exit mcpServers when we close its bracket
    if (this.inMcpServers && this.depth <= this.mcpServersDepth) {
      this.inMcpServers = false;
      this.mcpServersDepth = -1;
    }

    // Only process lines within mcpServers
    if (!this.inMcpServers) {
      return line;
    }

    // Detect server names
    const serverNameMatch = line.match(/^\s*"([^"]+)"\s*:\s*\{/);
    if (serverNameMatch) {
      this.currentServerName = serverNameMatch[1];
    }

    // Transform command patterns
    return this.transformMCPServerLine(line);
  }

  private transformMCPServerLine(line: string): string {
    // Pattern 1: "command": "cmd" -> "command": "npx"
    if (line.includes('"command"') && line.includes('"cmd"')) {
      this.changes.push(`${this.currentServerName}: Changed command from cmd to npx`);
      return line.replace('"cmd"', '"npx"');
    }

    // Pattern 2: Transform args array for cmd /c patterns
    if (line.includes('"args"') && line.includes('[')) {
      const argsMatch = line.match(/"args"\s*:\s*(\[.*\])/);
      if (argsMatch) {
        const argsStr = argsMatch[1];
        try {
          const args = JSON.parse(argsStr);
          const transformed = this.transformArgs(args);
          if (transformed) {
            const newArgsStr = JSON.stringify(transformed);
            this.changes.push(`${this.currentServerName}: Wrapped with reliable-mcp`);
            return line.replace(argsStr, newArgsStr);
          }
        } catch (e) {
          // If we can't parse inline, might be multiline - fall back to original
        }
      }
    }

    return line;
  }

  private transformArgs(args: string[]): string[] | null {
    // Check for cmd /c pattern
    if (args[0] === '/c' || (args.includes('/c') && args[0].startsWith('/'))) {
      const cIndex = args.indexOf('/c');
      const commandArgs = args.slice(cIndex + 1);
      
      // Add npx -y if the command after /c is npx
      if (commandArgs[0] === 'npx') {
        return [
          '-y',
          'reliable-mcp',
          '--label',
          this.currentServerName,
          '--',
          'npx',
          '-y',
          ...commandArgs.slice(1)
        ];
      }
      
      return [
        '-y',
        'reliable-mcp',
        '--label',
        this.currentServerName,
        '--',
        ...commandArgs
      ];
    }

    // Check for direct npx without reliable-mcp
    if (args[0]?.includes('@modelcontextprotocol') || args[0]?.includes('mcp')) {
      if (!args.includes('reliable-mcp')) {
        return [
          '-y',
          'reliable-mcp',
          '--label',
          this.currentServerName,
          '--',
          'npx',
          '-y',
          ...args.filter(arg => arg !== '-y')
        ];
      }
    }

    return null;
  }

  getChanges(): string[] {
    return this.changes;
  }
}

/**
 * Efficient processor for large files using streaming
 */
async function processLargeConfig(inputPath: string, outputPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const transformer = new MCPConfigTransformer();
    const readStream = fs.createReadStream(inputPath, { encoding: 'utf8' });
    const writeStream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

    readStream
      .pipe(transformer)
      .pipe(writeStream)
      .on('finish', () => resolve(transformer.getChanges()))
      .on('error', reject);
  });
}

/**
 * Check file size and decide strategy
 */
async function migrateConfig(configPath: string, options: { dryRun?: boolean; force?: boolean } = {}) {
  const stats = fs.statSync(configPath);
  const sizeMB = stats.size / (1024 * 1024);
  
  console.log(chalk.cyan(`📁 Config file: ${configPath}`));
  console.log(chalk.gray(`   Size: ${sizeMB.toFixed(2)} MB`));

  // For large files (>10MB), use streaming
  if (sizeMB > 10) {
    console.log(chalk.yellow('⚡ Using streaming processor for large file...'));
    
    const tempPath = `${configPath}.tmp.${Date.now()}`;
    const backupPath = `${configPath}.backup.${Date.now()}`;
    
    if (!options.dryRun) {
      fs.copyFileSync(configPath, backupPath);
      console.log(chalk.green(`✅ Backup created: ${backupPath}`));
    }
    
    try {
      const changes = await processLargeConfig(configPath, tempPath);
      
      if (changes.length === 0) {
        console.log(chalk.green('✨ No changes needed!'));
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        return;
      }
      
      console.log(chalk.yellow(`\n📝 Changes made:`));
      changes.forEach(change => console.log(`  • ${change}`));
      
      if (!options.dryRun && !options.force) {
        // Ask for confirmation
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        const answer = await new Promise<string>(resolve => {
          rl.question(chalk.yellow('\nApply changes? (y/N): '), resolve);
        });
        rl.close();
        
        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.yellow('Cancelled'));
          fs.unlinkSync(tempPath);
          if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
          return;
        }
      }
      
      if (!options.dryRun) {
        // Replace original with transformed
        fs.renameSync(tempPath, configPath);
        console.log(chalk.green('\n✅ Configuration migrated!'));
        console.log(chalk.gray(`Backup: ${backupPath}`));
      } else {
        console.log(chalk.cyan('\n🔍 Dry run - no changes made'));
        fs.unlinkSync(tempPath);
      }
      
    } catch (error: any) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      throw error;
    }
  } else {
    // For smaller files, use the original in-memory approach
    console.log(chalk.gray('📄 Using in-memory processor...'));
    // Delegate to original migrate-config.ts
    const { transformConfig } = require('./migrate-config');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const { config: newConfig, changes } = transformConfig(config);
    
    if (changes.length === 0) {
      console.log(chalk.green('✨ No changes needed!'));
      return;
    }
    
    console.log(chalk.yellow(`\n📝 Changes to make:`));
    changes.forEach((change: string) => console.log(`  • ${change}`));
    
    if (options.dryRun) {
      console.log(chalk.cyan('\n🔍 Dry run - no changes made'));
      return;
    }
    
    const backupPath = `${configPath}.backup.${Date.now()}`;
    fs.copyFileSync(configPath, backupPath);
    fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2));
    console.log(chalk.green('\n✅ Configuration migrated!'));
    console.log(chalk.gray(`Backup: ${backupPath}`));
  }
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  const configPath = args.find(arg => !arg.startsWith('-')) || CONFIG_PATHS.find(p => fs.existsSync(p));
  const options = {
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    force: args.includes('--force') || args.includes('-f')
  };
  
  if (!configPath) {
    console.error(chalk.red('❌ No config file found'));
    process.exit(1);
  }
  
  migrateConfig(configPath, options).catch(error => {
    console.error(chalk.red(`\n❌ Failed: ${error.message}`));
    process.exit(1);
  });
}

export { migrateConfig, processLargeConfig };