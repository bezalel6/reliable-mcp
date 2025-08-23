import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ProcessInfo {
  pid: number;
  name: string;
  commandLine: string;
  parentPid?: number;
  memoryUsage?: number;
  cpuTime?: number;
}

export class WindowsUtils {
  /**
   * Get detailed information about a process
   */
  static async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
    try {
      const { stdout } = await execAsync(
        `wmic process where ProcessId=${pid} get Name,CommandLine,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime /format:csv`
      );
      
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      if (lines.length < 2) return null;
      
      const headers = lines[lines.length - 2].split(',');
      const values = lines[lines.length - 1].split(',');
      
      const getIndex = (header: string) => headers.findIndex(h => h.includes(header));
      
      return {
        pid,
        name: values[getIndex('Name')] || 'unknown',
        commandLine: values[getIndex('CommandLine')] || '',
        parentPid: parseInt(values[getIndex('ParentProcessId')] || '0'),
        memoryUsage: parseInt(values[getIndex('WorkingSetSize')] || '0') / 1024 / 1024,
        cpuTime: (parseInt(values[getIndex('KernelModeTime')] || '0') + parseInt(values[getIndex('UserModeTime')] || '0')) / 10000000
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Find all processes matching a pattern
   */
  static async findProcesses(pattern: string): Promise<ProcessInfo[]> {
    try {
      const { stdout } = await execAsync(
        `wmic process where "CommandLine like '%${pattern}%'" get ProcessId,Name,CommandLine /format:csv`
      );
      
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      if (lines.length < 2) return [];
      
      const headers = lines[0].split(',');
      const pidIndex = headers.findIndex(h => h.includes('ProcessId'));
      const nameIndex = headers.findIndex(h => h.includes('Name'));
      const cmdIndex = headers.findIndex(h => h.includes('CommandLine'));
      
      return lines.slice(1).map(line => {
        const values = line.split(',');
        return {
          pid: parseInt(values[pidIndex] || '0'),
          name: values[nameIndex] || 'unknown',
          commandLine: values[cmdIndex] || ''
        };
      }).filter(p => p.pid > 0);
    } catch (error) {
      return [];
    }
  }

  /**
   * Kill a process tree on Windows
   */
  static killProcessTree(pid: number, force = false): boolean {
    try {
      const flag = force ? '/F' : '';
      execSync(`taskkill ${flag} /T /PID ${pid}`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if a process is running
   */
  static isProcessRunning(pid: number): boolean {
    try {
      const result = execSync(`tasklist /FI "PID eq ${pid}" 2>nul`, { encoding: 'utf8' });
      return result.includes(pid.toString());
    } catch (error) {
      return false;
    }
  }

  /**
   * Get child processes of a parent
   */
  static async getChildProcesses(parentPid: number): Promise<number[]> {
    try {
      const { stdout } = await execAsync(
        `wmic process where ParentProcessId=${parentPid} get ProcessId /format:csv`
      );
      
      const lines = stdout.trim().split('\n').filter(line => line.trim());
      if (lines.length < 2) return [];
      
      return lines.slice(1)
        .map(line => {
          const values = line.split(',');
          return parseInt(values[values.length - 1] || '0');
        })
        .filter(pid => pid > 0);
    } catch (error) {
      return [];
    }
  }

  /**
   * Set process priority on Windows
   */
  static setProcessPriority(pid: number, priority: 'low' | 'normal' | 'high'): boolean {
    try {
      const priorityMap = {
        low: 'BELOWNORMAL',
        normal: 'NORMAL',
        high: 'ABOVENORMAL'
      };
      
      execSync(`wmic process where ProcessId=${pid} CALL setpriority "${priorityMap[priority]}"`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }
}