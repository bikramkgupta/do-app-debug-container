/**
 * Redis/Valkey cache validation module.
 */

import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  hasVpcInterface,
  getConnectionUrl,
  parseUrl,
  tcpCheck,
  CheckResult,
} from './utils';

/**
 * Validate Redis/Valkey connectivity and operations.
 */
async function validateRedis(url: string, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const parsed = parseUrl(url);

  // Handle redis:// vs rediss:// (TLS)
  const useSsl = parsed.scheme === 'rediss';

  printInfo(`Host: ${parsed.host}:${parsed.port}`);
  printInfo(`TLS: ${useSsl ? 'enabled' : 'disabled'}`);
  if (parsed.password) {
    printInfo(`Password: ${maskSecret(parsed.password)}`);
  }

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(parsed.host, parsed.port!);
  checks.push({ name: 'Redis TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    return checks;
  }

  try {
    const Redis = (await import('ioredis')).default;

    try {
      const client = new Redis({
        host: parsed.host,
        port: parsed.port!,
        password: parsed.password || undefined,
        tls: useSsl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 10000,
        commandTimeout: 10000,
        lazyConnect: true,
      });

      await client.connect();

      // PING test
      const response = await client.ping();
      if (response === 'PONG') {
        checks.push({ name: 'Redis PING', passed: true, message: 'PONG received' });
        printCheck('PING', true);
      } else {
        checks.push({ name: 'Redis PING', passed: false, message: 'No response' });
        printCheck('PING', false, 'No response');
        await client.quit();
        return checks;
      }

      // Server info
      try {
        const info = await client.info('server');
        const versionMatch = info.match(/redis_version:(\S+)/);
        if (versionMatch) {
          const version = versionMatch[1];
          checks.push({ name: 'Redis Server', passed: true, message: `Version: ${version}` });
          printCheck('Server Info', true, verbose ? `Version: ${version}` : undefined);
        }
      } catch {
        // Ignore - server info is optional
      }

      // SET/GET test
      const testKey = '_validate_infra_test';
      const testValue = 'test_value_12345';

      try {
        // SET
        await client.set(testKey, testValue, 'EX', 60); // 60 second expiry
        checks.push({ name: 'Redis SET', passed: true, message: `Set key ${testKey}` });
        printCheck('SET', true);

        // GET
        const result = await client.get(testKey);
        if (result === testValue) {
          checks.push({ name: 'Redis GET', passed: true, message: 'Retrieved correct value' });
          printCheck('GET', true);
        } else {
          checks.push({ name: 'Redis GET', passed: false, message: `Value mismatch: ${result}` });
          printCheck('GET', false, 'Value mismatch');
        }

        // DELETE
        await client.del(testKey);
        checks.push({ name: 'Redis DELETE', passed: true, message: 'Deleted test key' });
        printCheck('DELETE', true);

        // Verify deletion
        const deleted = await client.get(testKey);
        if (deleted === null) {
          printCheck('Cleanup', true, 'Key removed');
        }
      } catch (err) {
        const error = err as Error;
        const errorMsg = error.message;
        checks.push({ name: 'Redis Operations', passed: false, message: errorMsg });
        printCheck('Operations', false, errorMsg);

        if (errorMsg.includes('NOAUTH') || errorMsg.includes('Authentication')) {
          printWarning('Authentication required - check REDIS_URL has password');
        } else if (errorMsg.includes('READONLY')) {
          printWarning('Connected to read-only replica');
        }
      }

      await client.quit();
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message;
      checks.push({ name: 'Redis Connection', passed: false, message: errorMsg });
      printCheck('Connection', false, errorMsg);

      if (errorMsg.includes('Connection refused')) {
        printWarning('Check if Redis is running and firewall rules');
      } else if (errorMsg.includes('Connection timed out')) {
        printWarning('Check network connectivity and trusted sources');
      } else if (errorMsg.includes('NOAUTH') || errorMsg.includes('ERR AUTH')) {
        checks.push({ name: 'Redis Auth', passed: false, message: errorMsg });
        printCheck('Authentication', false, errorMsg);
        printWarning('Check password in REDIS_URL');
      }
    }
  } catch {
    checks.push({ name: 'Redis Driver', passed: false, message: 'ioredis not installed' });
    printCheck('Driver (ioredis)', false, 'npm install ioredis');
  }

  return checks;
}

/**
 * Run Redis/Valkey validation checks.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('Redis/Valkey Cache Validation');

  // Environment variable mappings
  const urlConfigs: [string, string][] = [
    ['REDIS_URL', 'REDIS_PRIVATE_URL'],
    ['VALKEY_URL', 'VALKEY_PRIVATE_URL'],
    ['CACHE_URL', 'CACHE_PRIVATE_URL'],
  ];

  // Show VPC status
  if (hasVpcInterface()) {
    printInfo('VPC detected - will prefer private URLs');
  } else {
    printInfo('No VPC - using public URLs');
  }
  console.log();

  let url: string | undefined;
  let urlSource: string | undefined;

  for (const [urlKey, privateKey] of urlConfigs) {
    url = getConnectionUrl(urlKey, privateKey);
    if (url) {
      urlSource = urlKey;
      break;
    }
  }

  if (!url) {
    printInfo('No Redis/Valkey URL found - skipping cache checks');
    printInfo('To enable, set one of these environment variables:');
    for (const [urlKey] of urlConfigs) {
      printInfo(`  - ${urlKey}`);
    }
    return 0; // Skip gracefully when not configured
  }

  printInfo(`Found Redis URL in ${urlSource}`);
  console.log();

  const checks = await validateRedis(url, verbose);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
