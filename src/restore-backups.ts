#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { glob } from 'glob';

interface RestoreResult {
  file: string;
  backupFile?: string;
  restored: boolean;
  error?: string;
}

class BackupRestorer {
  private results: RestoreResult[] = [];
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
  }

  /**
   * Find all backup files for Claude configs
   */
  async findBackupFiles(): Promise<Map<string, string[]>> {
    const patterns = [
      // User-level configs
      path.join(os.homedir(), '.claude.json.backup.*'),
      path.join(os.homedir(), '.mcp.json.backup.*'),
      path.join(os.homedir(), '.claude', '*.json.backup.*'),
      
      // AppData configs (Windows)
      path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', '*.json.backup.*'),
      path.join(os.homedir(), 'AppData', 'Local', 'Claude', '*.json.backup.*'),
      
      // Project-level configs (if pattern specified)
      ...(this.options.pattern ? [
        path.join(this.options.pattern, '.mcp.json.backup.*'),
        path.join(this.options.pattern, '.claude.json.backup.*'),
        path.join(this.options.pattern, '.claude', '*.json.backup.*'),
        path.join(this.options.pattern, '**', '.mcp.json.backup.*'),
        path.join(this.options.pattern, '**', '.claude.json.backup.*')
      ] : [])
    ];

    const backupMap = new Map<string, string[]>();
    
    for (const pattern of patterns) {
      try {
        const matches = await glob(pattern.replace(/\\/g, '/'), {
          ignore: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
          nodir: true
        });
        
        for (const backupFile of matches) {
          // Extract original file name by removing .backup.timestamp
          const originalFile = backupFile.replace(/\.backup\.\d+$/, '');
          
          if (!backupMap.has(originalFile)) {
            backupMap.set(originalFile, []);
          }
          backupMap.get(originalFile)!.push(backupFile);
        }
      } catch (e) {
        // Pattern didn't match, continue
      }
    }

    // Sort backups by timestamp (newest first)
    for (const [file, backups] of backupMap) {
      backups.sort((a, b) => {
        const timestampA = parseInt(a.match(/\.backup\.(\d+)$/)?.[1] || '0');
        const timestampB = parseInt(b.match(/\.backup\.(\d+)$/)?.[1] || '0');
        return timestampB - timestampA;
      });
    }

    return backupMap;
  }

  /**
   * Restore a single file from its most recent backup
   */
  async restoreFile(originalFile: string, backupFile: string): Promise<RestoreResult> {
    const result: RestoreResult = {
      file: originalFile,
      backupFile,
      restored: false
    };

    try {
      if (!fs.existsSync(backupFile)) {
        result.error = 'Backup file not found';
        return result;
      }

      if (!this.options.dryRun) {
        // Create a safety backup of current file before restoring
        if (fs.existsSync(originalFile)) {
          const safetyBackup = `${originalFile}.before-restore.${Date.now()}`;
          fs.copyFileSync(originalFile, safetyBackup);
          if (this.options.verbose) {
            console.log(chalk.gray(`  Created safety backup: ${path.basename(safetyBackup)}`));
          }
        }

        // Restore from backup
        fs.copyFileSync(backupFile, originalFile);
        result.restored = true;
      } else {
        result.restored = true; // Would be restored
      }
    } catch (error: any) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * Restore a specific file from backup
   */
  async restoreSingle(filePath: string): Promise<void> {
    console.log(chalk.cyan('🔄 Backup Restoration Tool\n'));
    
    const absolutePath = path.resolve(filePath);
    console.log(chalk.cyan(`📁 Looking for backups of: ${absolutePath}\n`));

    // Find backups for this specific file
    const pattern = `${absolutePath}.backup.*`;
    const backups = await glob(pattern.replace(/\\/g, '/'), { nodir: true });
    
    if (backups.length === 0) {
      console.log(chalk.red('❌ No backup files found!'));
      console.log(chalk.yellow('\nBackup files are created when you run migrate commands.'));
      return;
    }

    // Sort by timestamp (newest first)
    backups.sort((a, b) => {
      const timestampA = parseInt(a.match(/\.backup\.(\d+)$/)?.[1] || '0');
      const timestampB = parseInt(b.match(/\.backup\.(\d+)$/)?.[1] || '0');
      return timestampB - timestampA;
    });

    console.log(chalk.green(`Found ${backups.length} backup(s):\n`));
    backups.forEach((backup, index) => {
      const timestamp = backup.match(/\.backup\.(\d+)$/)?.[1];
      if (timestamp) {
        const date = new Date(parseInt(timestamp));
        console.log(chalk.gray(`  ${index + 1}. ${date.toLocaleString()} - ${path.basename(backup)}`));
      }
    });

    const latestBackup = backups[0];
    console.log(chalk.yellow(`\n📝 Will restore from latest backup: ${path.basename(latestBackup)}`));

    if (this.options.dryRun) {
      console.log(chalk.cyan('\n🔍 Dry run mode - no changes will be made'));
      return;
    }

    if (!this.options.force) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        rl.question(chalk.yellow('\nRestore from this backup? (y/N): '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.yellow('❌ Restoration cancelled'));
        return;
      }
    }

    const result = await this.restoreFile(absolutePath, latestBackup);
    
    if (result.restored) {
      console.log(chalk.green('\n✅ File restored successfully!'));
      console.log(chalk.yellow('⚠️  Please restart Claude for changes to take effect'));
    } else if (result.error) {
      console.log(chalk.red(`\n❌ Restoration failed: ${result.error}`));
    }
  }

  /**
   * Restore all files from their backups
   */
  async restoreAll(): Promise<void> {
    console.log(chalk.cyan('🔄 Bulk Backup Restoration Tool\n'));
    console.log(chalk.cyan('🔍 Searching for backup files...\n'));
    
    const backupMap = await this.findBackupFiles();
    
    if (backupMap.size === 0) {
      console.log(chalk.yellow('No backup files found.'));
      console.log(chalk.gray('\nBackup files are created when you run migrate commands.'));
      return;
    }

    console.log(chalk.green(`Found backups for ${backupMap.size} file(s):\n`));
    
    for (const [file, backups] of backupMap) {
      console.log(chalk.yellow(`📄 ${path.basename(file)}`));
      const latestTimestamp = backups[0].match(/\.backup\.(\d+)$/)?.[1];
      if (latestTimestamp) {
        const date = new Date(parseInt(latestTimestamp));
        console.log(chalk.gray(`   Latest backup: ${date.toLocaleString()}`));
        console.log(chalk.gray(`   Total backups: ${backups.length}`));
      }
    }

    console.log();

    if (this.options.dryRun) {
      console.log(chalk.cyan('🔍 Dry run mode - no files will be restored'));
      console.log(chalk.gray('Remove --dry-run to apply restorations'));
      return;
    }

    if (!this.options.force) {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise<string>(resolve => {
        rl.question(chalk.yellow('Restore all files from their latest backups? (y/N): '), resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'y') {
        console.log(chalk.yellow('❌ Restoration cancelled'));
        return;
      }
    }

    console.log(chalk.cyan('\n🔄 Restoring files...\n'));

    let restored = 0;
    let failed = 0;

    for (const [file, backups] of backupMap) {
      const result = await this.restoreFile(file, backups[0]);
      this.results.push(result);
      
      if (result.restored) {
        console.log(chalk.green(`✅ Restored: ${path.basename(file)}`));
        restored++;
      } else {
        console.log(chalk.red(`❌ Failed: ${path.basename(file)} - ${result.error}`));
        failed++;
      }
    }

    // Summary
    console.log(chalk.cyan('\n=== Restoration Summary ==='));
    console.log(chalk.green(`Files restored: ${restored}`));
    if (failed > 0) {
      console.log(chalk.red(`Files failed: ${failed}`));
    }
    
    if (restored > 0) {
      console.log(chalk.yellow('\n⚠️  Please restart Claude for changes to take effect'));
    }
  }
}

// Export functions for CLI integration
export async function runRestore(): Promise<void> {
  const args = process.argv.slice(3); // Skip 'node', 'cli.js', and 'restore'
  const filePath = args.find(arg => !arg.startsWith('-'));
  
  const restorer = new BackupRestorer({
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    force: args.includes('--force') || args.includes('-f'),
    verbose: args.includes('--verbose') || args.includes('-v')
  });

  if (filePath) {
    await restorer.restoreSingle(filePath);
  } else {
    console.error(chalk.red('❌ Please specify a file to restore'));
    console.error(chalk.yellow('\nUsage: reliable-mcp restore <file-path> [options]'));
    console.error(chalk.gray('Example: reliable-mcp restore .claude.json'));
    process.exit(1);
  }
}

export async function runRestoreAll(): Promise<void> {
  const args = process.argv.slice(3); // Skip 'node', 'cli.js', and 'restore-all'
  
  const restorer = new BackupRestorer({
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    force: args.includes('--force') || args.includes('-f'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    pattern: args.find(arg => !arg.startsWith('-'))
  });

  await restorer.restoreAll();
}

// Run if called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const isRestoreAll = args.includes('--all') || args.includes('-a');
  
  const restorer = new BackupRestorer({
    dryRun: args.includes('--dry-run') || args.includes('-d'),
    force: args.includes('--force') || args.includes('-f'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    pattern: args.find(arg => !arg.startsWith('-') && arg !== '--all' && arg !== '-a')
  });

  if (isRestoreAll) {
    restorer.restoreAll().catch(error => {
      console.error(chalk.red(`\n❌ Restoration failed: ${error.message}`));
      process.exit(1);
    });
  } else {
    const filePath = args.find(arg => !arg.startsWith('-'));
    if (filePath) {
      restorer.restoreSingle(filePath).catch(error => {
        console.error(chalk.red(`\n❌ Restoration failed: ${error.message}`));
        process.exit(1);
      });
    } else {
      console.error(chalk.red('Please specify a file to restore or use --all flag'));
      process.exit(1);
    }
  }
}

export { BackupRestorer };