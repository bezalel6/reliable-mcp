#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { glob } from 'glob';

interface MCPServer {
  command: string;
  args?: string[];
  type?: string;
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
}

interface MCPServers {
  [key: string]: MCPServer;
}

interface ClaudeProject {
  mcpServers?: MCPServers;
  enabledMcpjsonServers?: string[];
  disabledMcpjsonServers?: string[];
}

interface ClaudeJSON {
  projects?: {
    [path: string]: ClaudeProject;
  };
  mcpServers?: MCPServers;
  [key: string]: any;
}

interface MCPJsonFile {
  mcpServers?: MCPServers;
}

interface MigrationResult {
  file: string;
  changes: string[];
  backed_up: boolean;
  error?: string;
}

class MCPServerMigrator {
  private results: MigrationResult[] = [];
  private processedServers = 0;
  private isGloballyInstalled: boolean = false;
  private options: {
    dryRun: boolean;
    force: boolean;
    verbose: boolean;
    pattern?: string;
  };

  constructor(options: any) {
    this.options = {
      dryRun: options.dryRun || false,
      force: options.force || false,
      verbose: options.verbose || false,
      pattern: options.pattern
    };
    
    // Check if reliable-mcp is installed globally
    try {
      const { execSync } = require('child_process');
      const isWindows = process.platform === 'win32';
      const checkCommand = isWindows ? 'where reliable-mcp 2>nul' : 'which reliable-mcp 2>/dev/null';
      execSync(checkCommand, { encoding: 'utf8' });
      this.isGloballyInstalled = true;
      if (this.options.verbose) {
        console.log(chalk.green('✓ Detected global reliable-mcp installation'));
      }
    } catch {
      this.isGloballyInstalled = false;
      if (this.options.verbose) {
        console.log(chalk.yellow('⚠ Global reliable-mcp not found, will use npx'));
      }
    }
  }

  /**
   * Find all Claude-related config files
   */
  async findConfigFiles(): Promise<string[]> {
    const patterns = [
      // User-level configs
      path.join(os.homedir(), '.claude.json'),
      path.join(os.homedir(), '.mcp.json'),
      path.join(os.homedir(), '.claude', 'settings.local.json'),
      path.join(os.homedir(), '.claude', 'settings.json'),
      
      // AppData configs (Windows)
      path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', '*.json'),
      path.join(os.homedir(), 'AppData', 'Local', 'Claude', '*.json'),
      
      // Project-level configs (if pattern specified)
      ...(this.options.pattern ? [
        path.join(this.options.pattern, '.mcp.json'),
        path.join(this.options.pattern, '.claude', '*.json'),
        path.join(this.options.pattern, '**', '.mcp.json'),
        path.join(this.options.pattern, '**', '.claude', '*.json')
      ] : [])
    ];

    const files = new Set<string>();
    
    for (const pattern of patterns) {
      try {
        const matches = await glob(pattern.replace(/\\/g, '/'), { 
          ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
          nodir: true
        });
        matches.forEach(file => files.add(file));
      } catch (e) {
        // Pattern didn't match, continue
      }
    }

    // Also check for direct file existence
    const directChecks = [
      path.join(os.homedir(), '.claude.json'),
      path.join(os.homedir(), '.mcp.json'),
      path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
    ];

    for (const file of directChecks) {
      if (fs.existsSync(file)) {
        files.add(file);
      }
    }

    return Array.from(files);
  }

  /**
   * Transform MCP server configuration
   */
  transformMCPServer(name: string, server: MCPServer): { server: MCPServer; changed: boolean; description: string } {
    let changed = false;
    let description = '';
    const newServer = { ...server };

    // Pattern 1: cmd /c wrapper
    if (server.command === 'cmd' || server.command === 'cmd.exe') {
      if (server.args?.includes('/c')) {
        const cIndex = server.args.indexOf('/c');
        const commandArgs = server.args.slice(cIndex + 1);
        
        if (commandArgs[0] === 'npx') {
          // Filter out existing -y flags to avoid duplication
          const npxArgs = commandArgs.slice(1).filter(arg => arg !== '-y');
          if (this.isGloballyInstalled) {
            newServer.command = 'reliable-mcp';
            newServer.args = ['--label', name, '--', 'npx', '-y', ...npxArgs];
            changed = true;
            description = `Converted cmd /c npx to global reliable-mcp wrapper`;
          } else {
            newServer.command = 'npx';
            newServer.args = ['-y', 'reliable-mcp', '--label', name, '--', 'npx', '-y', ...npxArgs];
            changed = true;
            description = `Converted cmd /c npx to npx reliable-mcp wrapper`;
          }
        } else {
          if (this.isGloballyInstalled) {
            newServer.command = 'reliable-mcp';
            newServer.args = ['--label', name, '--', ...commandArgs];
            changed = true;
            description = `Converted cmd /c to global reliable-mcp wrapper`;
          } else {
            newServer.command = 'npx';
            newServer.args = ['-y', 'reliable-mcp', '--label', name, '--', ...commandArgs];
            changed = true;
            description = `Converted cmd /c to npx reliable-mcp wrapper`;
          }
        }
      }
    }
    // Pattern 2: Direct npx without reliable-mcp
    else if (server.command === 'npx' && !server.args?.includes('reliable-mcp')) {
      if (server.args?.some(arg => arg.includes('mcp') || arg.includes('modelcontextprotocol'))) {
        const originalArgs = server.args || [];
        if (this.isGloballyInstalled) {
          newServer.command = 'reliable-mcp';
          newServer.args = ['--label', name, '--', 'npx', '-y', ...originalArgs.filter(arg => arg !== '-y')];
          changed = true;
          description = `Wrapped npx command with global reliable-mcp`;
        } else {
          newServer.args = ['-y', 'reliable-mcp', '--label', name, '--', 'npx', '-y', ...originalArgs.filter(arg => arg !== '-y')];
          changed = true;
          description = `Wrapped npx command with npx reliable-mcp`;
        }
      }
    }
    // Pattern 3: Node executing MCP servers
    else if (server.command === 'node' || server.command?.endsWith('node.exe')) {
      if (server.args?.[0]?.includes('mcp')) {
        if (this.isGloballyInstalled) {
          newServer.command = 'reliable-mcp';
          newServer.args = ['--label', name, '--', server.command, ...(server.args || [])];
          changed = true;
          description = `Wrapped node MCP server with global reliable-mcp`;
        } else {
          newServer.command = 'npx';
          newServer.args = ['-y', 'reliable-mcp', '--label', name, '--', server.command, ...(server.args || [])];
          changed = true;
          description = `Wrapped node MCP server with npx reliable-mcp`;
        }
      }
    }
    // Pattern 4: Python MCP servers
    else if (server.command === 'python' || server.command?.includes('python')) {
      if (server.args?.some(arg => arg.includes('mcp'))) {
        if (this.isGloballyInstalled) {
          newServer.command = 'reliable-mcp';
          newServer.args = ['--label', name, '--', server.command, ...(server.args || [])];
          changed = true;
          description = `Wrapped Python MCP server with global reliable-mcp`;
        } else {
          newServer.command = 'npx';
          newServer.args = ['-y', 'reliable-mcp', '--label', name, '--', server.command, ...(server.args || [])];
          changed = true;
          description = `Wrapped Python MCP server with npx reliable-mcp`;
        }
      }
    }

    return { server: newServer, changed, description };
  }

  /**
   * Process a .claude.json file
   */
  public async processClaudeJson(filePath: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      file: filePath,
      changes: [],
      backed_up: false
    };

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config: ClaudeJSON = JSON.parse(content);
      let modified = false;

      // Process top-level mcpServers
      if (config.mcpServers) {
        for (const [name, server] of Object.entries(config.mcpServers)) {
          const { server: newServer, changed, description } = this.transformMCPServer(name, server);
          if (changed) {
            config.mcpServers[name] = newServer;
            result.changes.push(`${name}: ${description}`);
            modified = true;
            this.processedServers++;
          }
        }
      }

      // Process project-level mcpServers
      if (config.projects) {
        for (const [projPath, project] of Object.entries(config.projects)) {
          if (project.mcpServers) {
            for (const [name, server] of Object.entries(project.mcpServers)) {
              const { server: newServer, changed, description } = this.transformMCPServer(name, server);
              if (changed) {
                project.mcpServers[name] = newServer;
                result.changes.push(`[${projPath}] ${name}: ${description}`);
                modified = true;
                this.processedServers++;
              }
            }
          }
        }
      }

      // Save changes if modified
      if (modified && !this.options.dryRun) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        fs.copyFileSync(filePath, backupPath);
        result.backed_up = true;
        
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      }

    } catch (error: any) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * Process a .mcp.json file
   */
  public async processMCPJson(filePath: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      file: filePath,
      changes: [],
      backed_up: false
    };

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config: MCPJsonFile = JSON.parse(content);
      let modified = false;

      if (config.mcpServers) {
        for (const [name, server] of Object.entries(config.mcpServers)) {
          const { server: newServer, changed, description } = this.transformMCPServer(name, server);
          if (changed) {
            config.mcpServers[name] = newServer;
            result.changes.push(`${name}: ${description}`);
            modified = true;
            this.processedServers++;
          }
        }
      }

      // Save changes if modified
      if (modified && !this.options.dryRun) {
        const backupPath = `${filePath}.backup.${Date.now()}`;
        fs.copyFileSync(filePath, backupPath);
        result.backed_up = true;
        
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
      }

    } catch (error: any) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * Run the migration
   */
  async run(): Promise<void> {
    console.log(chalk.cyan('🔍 Searching for Claude configuration files...\n'));
    
    const files = await this.findConfigFiles();
    
    if (files.length === 0) {
      console.log(chalk.yellow('No configuration files found.'));
      return;
    }

    console.log(chalk.green(`Found ${files.length} configuration file(s):\n`));
    files.forEach(file => {
      console.log(chalk.gray(`  • ${file}`));
    });
    console.log();

    // Process each file
    for (const file of files) {
      if (this.options.verbose) {
        console.log(chalk.cyan(`Processing: ${file}`));
      }

      let result: MigrationResult;
      
      if (file.endsWith('.mcp.json')) {
        result = await this.processMCPJson(file);
      } else {
        result = await this.processClaudeJson(file);
      }

      this.results.push(result);

      // Display results for this file
      if (result.error) {
        console.log(chalk.red(`❌ ${path.basename(file)}: ${result.error}`));
      } else if (result.changes.length > 0) {
        console.log(chalk.yellow(`📝 ${path.basename(file)}:`));
        result.changes.forEach(change => {
          console.log(chalk.green(`   ✓ ${change}`));
        });
        if (result.backed_up) {
          console.log(chalk.gray(`   → Backup created`));
        }
      } else if (this.options.verbose) {
        console.log(chalk.gray(`✓ ${path.basename(file)}: No changes needed`));
      }
    }

    // Summary
    console.log(chalk.cyan('\n=== Migration Summary ==='));
    console.log(chalk.green(`Files processed: ${this.results.length}`));
    console.log(chalk.green(`MCP servers migrated: ${this.processedServers}`));
    
    const filesWithChanges = this.results.filter(r => r.changes.length > 0);
    if (filesWithChanges.length > 0) {
      console.log(chalk.yellow(`Files modified: ${filesWithChanges.length}`));
      
      if (this.options.dryRun) {
        console.log(chalk.cyan('\n🔍 Dry run mode - no files were actually modified'));
        console.log(chalk.gray('Remove --dry-run to apply changes'));
      } else {
        console.log(chalk.green('\n✅ Migration complete!'));
        console.log(chalk.yellow('⚠️  Restart Claude Code for changes to take effect'));
      }
    } else {
      console.log(chalk.green('\n✨ All configurations are already optimized!'));
    }
  }
}

// CLI entry point function
export async function runMigrateAll(): Promise<void> {
  const args = process.argv.slice(3); // Skip 'node', 'cli.js', and 'migrate-all'
  
  const migrator = new MCPServerMigrator({
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    force: args.includes('--force') || args.includes('-f'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    pattern: args.find(arg => !arg.startsWith('-'))
  });

  try {
    await migrator.run();
  } catch (error: any) {
    console.error(chalk.red(`\n❌ Migration failed: ${error.message}`));
    process.exit(1);
  }
}

// Run if called directly as a script
if (require.main === module) {
  const args = process.argv.slice(2);
  
  const migrator = new MCPServerMigrator({
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    force: args.includes('--force') || args.includes('-f'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    pattern: args.find(arg => !arg.startsWith('-'))
  });

  migrator.run().catch(error => {
    console.error(chalk.red(`\n❌ Migration failed: ${error.message}`));
    process.exit(1);
  });
}

export { MCPServerMigrator };