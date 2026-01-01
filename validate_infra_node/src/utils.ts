/**
 * Shared utilities for infrastructure validation.
 */

import * as os from 'os';
import * as net from 'net';
import * as dns from 'dns';
import { URL } from 'url';
import { promisify } from 'util';

const dnsLookup = promisify(dns.lookup);
const dnsResolve = promisify(dns.resolve);

// ANSI color codes
export const RED = '\x1b[0;31m';
export const GREEN = '\x1b[0;32m';
export const YELLOW = '\x1b[1;33m';
export const BLUE = '\x1b[0;34m';
export const CYAN = '\x1b[0;36m';
export const BOLD = '\x1b[1m';
export const NC = '\x1b[0m'; // No Color

// Check result type
export interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
}

// Parsed URL type
export interface ParsedUrl {
  scheme: string;
  username: string;
  password: string;
  host: string;
  port: number | null;
  database: string;
  params: Record<string, string>;
}

/**
 * Mask a secret, showing only the first N characters.
 */
export function maskSecret(secret: string, show: number = 4): string {
  if (!secret) {
    return '<empty>';
  }
  if (secret.length <= show) {
    return '*'.repeat(secret.length);
  }
  return secret.substring(0, show) + '*'.repeat(secret.length - show);
}

/**
 * Print a section header.
 */
export function printHeader(title: string): void {
  const line = '='.repeat(60);
  console.log(`\n${BOLD}${CYAN}${line}${NC}`);
  console.log(`${BOLD}${CYAN}${title.padStart(30 + title.length / 2).padEnd(60)}${NC}`);
  console.log(`${BOLD}${CYAN}${line}${NC}\n`);
}

/**
 * Print a check result with color coding.
 */
export function printCheck(name: string, passed: boolean, message?: string): void {
  const status = passed ? `${GREEN}PASS${NC}` : `${RED}FAIL${NC}`;
  console.log(`  [${status}] ${name}`);
  if (message) {
    const indent = '        ';
    for (const line of message.split('\n')) {
      console.log(`${indent}${line}`);
    }
  }
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
  console.log(`  [${YELLOW}WARN${NC}] ${message}`);
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
  console.log(`  [${BLUE}INFO${NC}] ${message}`);
}

/**
 * Print a summary of all checks.
 * Returns exit code: 0 if all passed, 1 if any failed.
 */
export function printSummary(checks: CheckResult[]): number {
  const passed = checks.filter(c => c.passed).length;
  const failed = checks.filter(c => !c.passed).length;
  const total = checks.length;

  const line = '='.repeat(60);
  console.log(`\n${BOLD}${line}${NC}`);
  console.log(`${BOLD}Summary:${NC} ${passed}/${total} checks passed`);

  if (failed > 0) {
    console.log(`\n${RED}Failed checks:${NC}`);
    for (const check of checks) {
      if (!check.passed) {
        console.log(`  - ${check.name}`);
        if (check.message) {
          console.log(`    ${check.message}`);
        }
      }
    }
  }

  console.log(`${line}\n`);

  return failed === 0 ? 0 : 1;
}

/**
 * Check if container has VPC network interface.
 * VPC IPs in DigitalOcean start with 10.x.x.x
 */
export function hasVpcInterface(): boolean {
  try {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      const addrs = interfaces[name];
      if (addrs) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && addr.address.startsWith('10.')) {
            return true;
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the VPC IP address if available.
 */
export function getVpcIp(): string | null {
  try {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
      const addrs = interfaces[name];
      if (addrs) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && addr.address.startsWith('10.')) {
            return addr.address;
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the appropriate connection URL based on VPC configuration.
 * Priority:
 * 1. Private URL if VPC detected and private URL available
 * 2. Public URL otherwise
 */
export function getConnectionUrl(urlKey: string, privateUrlKey?: string): string | undefined {
  if (privateUrlKey && hasVpcInterface()) {
    const privateUrl = process.env[privateUrlKey];
    if (privateUrl) {
      return privateUrl;
    }
  }
  return process.env[urlKey];
}

/**
 * Parse a database URL into components.
 * Supports formats:
 * - postgresql://user:pass@host:port/dbname?sslmode=require
 * - mysql://user:pass@host:port/dbname?ssl-mode=REQUIRED
 * - mongodb+srv://user:pass@host/dbname?tls=true
 * - redis://:pass@host:port
 * - rediss://:pass@host:port (TLS)
 */
export function parseUrl(urlString: string): ParsedUrl {
  const url = new URL(urlString);

  const result: ParsedUrl = {
    scheme: url.protocol.replace(':', ''),
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    host: url.hostname || '',
    port: url.port ? parseInt(url.port, 10) : null,
    database: url.pathname.replace(/^\//, '') || '',
    params: {},
  };

  // Parse query parameters
  url.searchParams.forEach((value, key) => {
    result.params[key] = value;
  });

  // Set default ports based on scheme
  if (result.port === null) {
    const defaults: Record<string, number> = {
      'postgresql': 5432,
      'postgres': 5432,
      'mysql': 3306,
      'mongodb': 27017,
      'mongodb+srv': 27017,
      'redis': 6379,
      'rediss': 6379,
    };
    result.port = defaults[result.scheme] || null;
  }

  return result;
}

/**
 * Check TCP connectivity to a host:port.
 * Returns [success, message].
 */
export async function tcpCheck(host: string, port: number, timeout: number = 5000): Promise<[boolean, string]> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      resolve([false, `TCP connection to ${host}:${port} timed out after ${timeout}ms`]);
    }, timeout);

    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve([true, `TCP connection to ${host}:${port} successful`]);
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      if (err.code === 'ENOTFOUND') {
        resolve([false, `DNS resolution failed for ${host}: ${err.message}`]);
      } else if (err.code === 'ECONNREFUSED') {
        resolve([false, `TCP connection to ${host}:${port} refused`]);
      } else {
        resolve([false, `TCP connection error: ${err.message}`]);
      }
    });

    socket.connect(port, host);
  });
}

/**
 * Check DNS resolution for a hostname.
 * Returns [success, ips or error message].
 */
export async function dnsCheck(hostname: string): Promise<[boolean, string[] | string]> {
  try {
    const result = await dnsLookup(hostname, { all: true });
    const ips = Array.isArray(result) ? result.map(r => r.address) : [result.address];
    return [true, ips];
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return [false, `DNS resolution failed: ${error.message}`];
  }
}

/**
 * Run a shell command and return the result.
 * Returns [success, stdout, stderr].
 */
export async function runCommand(cmd: string[], timeout: number = 30000): Promise<[boolean, string, string]> {
  const { execFile } = await import('child_process');

  return new Promise((resolve) => {
    const child = execFile(cmd[0], cmd.slice(1), { timeout }, (error, stdout, stderr) => {
      if (error) {
        resolve([false, stdout, stderr || error.message]);
      } else {
        resolve([true, stdout, stderr]);
      }
    });
  });
}
