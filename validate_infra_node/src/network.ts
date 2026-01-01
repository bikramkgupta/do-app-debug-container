/**
 * Network connectivity validation module.
 */

import * as https from 'https';
import * as tls from 'tls';
import {
  printHeader,
  printCheck,
  printInfo,
  printSummary,
  hasVpcInterface,
  getVpcIp,
  tcpCheck,
  dnsCheck,
  CheckResult,
} from './utils';

/**
 * Check external DNS resolution.
 */
async function checkDnsResolution(): Promise<[boolean, string]> {
  const testHosts = ['google.com', 'api.digitalocean.com', 'registry.digitalocean.com'];

  for (const host of testHosts) {
    const [success, result] = await dnsCheck(host);
    if (!success) {
      return [false, `DNS resolution failed for ${host}: ${result}`];
    }
  }

  return [true, `DNS resolution working (tested: ${testHosts.join(', ')})`];
}

/**
 * Check external HTTPS connectivity.
 */
async function checkExternalHttps(): Promise<[boolean, string]> {
  const testUrls: [string, string][] = [
    ['https://api.digitalocean.com/v2/', 'DigitalOcean API'],
    ['https://www.google.com/', 'Google'],
  ];

  for (const [url, name] of testUrls) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = https.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
          resolve();
        });
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Timeout'));
        });
        req.end();
      });
    } catch (err) {
      // HTTP errors mean we connected successfully
      const error = err as NodeJS.ErrnoException;
      if (!error.message.includes('HTTP')) {
        return [false, `Failed to connect to ${name} (${url}): ${error.message}`];
      }
    }
  }

  return [true, 'External HTTPS connectivity working'];
}

/**
 * Check DigitalOcean API accessibility.
 */
async function checkDoApi(): Promise<[boolean, string]> {
  const url = 'https://api.digitalocean.com/v2/';

  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        // 401, 403, 404 all mean we reached the API
        if (res.statusCode && [401, 403, 404].includes(res.statusCode)) {
          resolve([true, 'DigitalOcean API reachable (auth required, as expected)']);
        } else if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve([true, 'DigitalOcean API reachable']);
        } else {
          resolve([false, `DigitalOcean API returned unexpected error: ${res.statusCode}`]);
        }
      }
    );

    req.on('error', (err) => {
      resolve([false, `Failed to reach DigitalOcean API: ${err.message}`]);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve([false, 'DigitalOcean API request timed out']);
    });

    req.end();
  });
}

/**
 * Check DigitalOcean Container Registry connectivity.
 */
async function checkContainerRegistry(): Promise<[boolean, string]> {
  const host = 'registry.digitalocean.com';
  const port = 443;

  const [success, msg] = await tcpCheck(host, port);
  if (!success) {
    return [false, msg];
  }

  // Try TLS connection
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        timeout: 10000,
      },
      () => {
        socket.destroy();
        resolve([true, 'Container Registry reachable (TLS verified)']);
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      resolve([false, `Container Registry TLS failed: ${err.message}`]);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve([false, 'Container Registry connection timed out']);
    });
  });
}

/**
 * Check GitHub Container Registry connectivity.
 */
async function checkGhcr(): Promise<[boolean, string]> {
  const host = 'ghcr.io';
  const port = 443;

  const [success, msg] = await tcpCheck(host, port);
  if (!success) {
    return [false, msg];
  }

  // Try TLS connection
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        timeout: 10000,
      },
      () => {
        socket.destroy();
        resolve([true, 'GitHub Container Registry reachable (TLS verified)']);
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      resolve([false, `GHCR TLS failed: ${err.message}`]);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve([false, 'GHCR connection timed out']);
    });
  });
}

/**
 * Check internal service discovery (if in VPC).
 */
async function checkInternalDns(): Promise<[boolean, string]> {
  if (!hasVpcInterface()) {
    return [true, 'Not in VPC - internal DNS check skipped'];
  }

  // Check for internal DO metadata service
  try {
    const [success] = await tcpCheck('169.254.169.254', 80, 2000);
    if (success) {
      return [true, 'Internal metadata service reachable'];
    }
    return [true, 'Internal DNS - metadata service not available (may be normal)'];
  } catch {
    return [true, 'Internal DNS check skipped'];
  }
}

/**
 * Check VPC configuration.
 */
function checkVpcConnectivity(): [boolean, string] {
  const vpcIp = getVpcIp();

  if (vpcIp) {
    return [true, `VPC interface detected: ${vpcIp}`];
  } else {
    return [true, 'No VPC interface detected (using public network)'];
  }
}

/**
 * Run all network checks and return exit code.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('Network Connectivity Validation');

  // Show VPC status
  const vpcIp = getVpcIp();
  if (vpcIp) {
    printInfo(`VPC detected: ${vpcIp}`);
  } else {
    printInfo('No VPC interface - using public network');
  }

  console.log();

  const checks: CheckResult[] = [];

  // DNS Resolution
  const [dnsSuccess, dnsMsg] = await checkDnsResolution();
  checks.push({ name: 'DNS Resolution', passed: dnsSuccess, message: dnsMsg });
  printCheck('DNS Resolution', dnsSuccess, verbose || !dnsSuccess ? dnsMsg : undefined);

  // External HTTPS
  const [httpsSuccess, httpsMsg] = await checkExternalHttps();
  checks.push({ name: 'External HTTPS', passed: httpsSuccess, message: httpsMsg });
  printCheck('External HTTPS', httpsSuccess, verbose || !httpsSuccess ? httpsMsg : undefined);

  // DigitalOcean API
  const [doApiSuccess, doApiMsg] = await checkDoApi();
  checks.push({ name: 'DigitalOcean API', passed: doApiSuccess, message: doApiMsg });
  printCheck('DigitalOcean API', doApiSuccess, verbose || !doApiSuccess ? doApiMsg : undefined);

  // Container Registry
  const [docrSuccess, docrMsg] = await checkContainerRegistry();
  checks.push({ name: 'DO Container Registry', passed: docrSuccess, message: docrMsg });
  printCheck('DO Container Registry', docrSuccess, verbose || !docrSuccess ? docrMsg : undefined);

  // GitHub Container Registry
  const [ghcrSuccess, ghcrMsg] = await checkGhcr();
  checks.push({ name: 'GitHub Container Registry', passed: ghcrSuccess, message: ghcrMsg });
  printCheck('GitHub Container Registry', ghcrSuccess, verbose || !ghcrSuccess ? ghcrMsg : undefined);

  // Internal DNS (VPC)
  const [internalSuccess, internalMsg] = await checkInternalDns();
  checks.push({ name: 'Internal DNS', passed: internalSuccess, message: internalMsg });
  printCheck('Internal DNS', internalSuccess, verbose || !internalSuccess ? internalMsg : undefined);

  // VPC Connectivity
  const [vpcSuccess, vpcMsg] = checkVpcConnectivity();
  checks.push({ name: 'VPC Connectivity', passed: vpcSuccess, message: vpcMsg });
  printCheck('VPC Connectivity', vpcSuccess, verbose || !vpcSuccess ? vpcMsg : undefined);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
