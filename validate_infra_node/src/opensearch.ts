/**
 * OpenSearch validation module.
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
  tcpCheck,
  CheckResult,
} from './utils';

interface OpenSearchConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  useSsl: boolean;
  url: string | null;
}

/**
 * Get OpenSearch configuration from environment variables.
 */
function getOpenSearchConfig(): OpenSearchConfig | null {
  // Try full URL first
  const url = getConnectionUrl('OPENSEARCH_URL', 'OPENSEARCH_PRIVATE_URL');

  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 25060,
      username: decodeURIComponent(parsed.username || 'doadmin'),
      password: decodeURIComponent(parsed.password || ''),
      useSsl: parsed.protocol === 'https:',
      url,
    };
  }

  // Try individual vars
  const host = process.env.OPENSEARCH_HOST || process.env.OPENSEARCH_HOSTNAME;
  if (host) {
    return {
      host,
      port: parseInt(process.env.OPENSEARCH_PORT || '25060', 10),
      username: process.env.OPENSEARCH_USERNAME || 'doadmin',
      password: process.env.OPENSEARCH_PASSWORD || '',
      useSsl: true,
      url: null,
    };
  }

  return null;
}

/**
 * Validate OpenSearch connectivity and operations.
 */
async function validateOpenSearch(
  config: OpenSearchConfig,
  verbose: boolean = false
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  printInfo(`Host: ${config.host}:${config.port}`);
  printInfo(`Username: ${config.username}`);
  printInfo(`Password: ${maskSecret(config.password)}`);
  printInfo(`TLS: ${config.useSsl ? 'enabled' : 'disabled'}`);

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(config.host, config.port);
  checks.push({ name: 'OpenSearch TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    return checks;
  }

  try {
    const { Client } = await import('@opensearch-project/opensearch');

    // Create client
    const client = new Client({
      node: `https://${config.host}:${config.port}`,
      auth: {
        username: config.username,
        password: config.password,
      },
      ssl: {
        rejectUnauthorized: true,
      },
    });

    // Connection test - cluster health
    try {
      const { body: health } = await client.cluster.health();
      const status = health.status;
      const clusterName = health.cluster_name;

      const statusOk = status === 'green' || status === 'yellow';
      checks.push({
        name: 'OpenSearch Health',
        passed: statusOk,
        message: `Status: ${status}, Cluster: ${clusterName}`,
      });

      if (status === 'green') {
        printCheck('Cluster Health', true, `Status: ${status}`);
      } else if (status === 'yellow') {
        printCheck('Cluster Health', true, `Status: ${status} (replicas may be missing)`);
      } else {
        printCheck('Cluster Health', false, `Status: ${status}`);
      }
    } catch (err) {
      const error = err as any;
      if (error.statusCode === 401 || error.message?.includes('401')) {
        checks.push({ name: 'OpenSearch Auth', passed: false, message: 'Authentication failed' });
        printCheck('Authentication', false, error.message);
        printWarning('Check OPENSEARCH_USERNAME and OPENSEARCH_PASSWORD');
        return checks;
      }

      checks.push({ name: 'OpenSearch Connection', passed: false, message: error.message });
      printCheck('Connection', false, error.message);
      return checks;
    }

    // Cluster info
    try {
      const { body: info } = await client.info();
      const version = info.version?.number || 'unknown';
      checks.push({ name: 'OpenSearch Version', passed: true, message: `Version: ${version}` });
      printCheck('Server Info', true, verbose ? `Version: ${version}` : undefined);
    } catch {
      // Ignore - server info is optional
    }

    // List indices
    try {
      const { body: indices } = await client.cat.indices({ format: 'json' });
      const indexCount = Array.isArray(indices) ? indices.length : 0;
      checks.push({ name: 'OpenSearch Indices', passed: true, message: `${indexCount} indices found` });
      printCheck('List Indices', true, verbose ? `${indexCount} indices` : undefined);
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'OpenSearch Indices', passed: false, message: error.message });
      printCheck('List Indices', false, error.message);
    }

    // Index operations test
    // Note: OpenSearch doesn't allow index names starting with underscore
    const testIndex = 'validate-infra-test';
    try {
      // Delete if exists
      try {
        await client.indices.delete({ index: testIndex });
      } catch {
        // Ignore - index might not exist
      }

      // Create index
      await client.indices.create({
        index: testIndex,
        body: {
          settings: { number_of_shards: 1, number_of_replicas: 0 },
          mappings: { properties: { test_field: { type: 'text' } } },
        },
      });
      checks.push({ name: 'OpenSearch CREATE', passed: true, message: `Created index ${testIndex}` });
      printCheck('CREATE Index', true);

      // Index document
      const { body: indexResult } = await client.index({
        index: testIndex,
        body: { test_field: 'test_value' },
        refresh: true,
      });
      const docId = indexResult._id;
      checks.push({ name: 'OpenSearch INDEX', passed: true, message: 'Indexed document' });
      printCheck('INDEX Document', true);

      // Search
      const { body: searchResult } = await client.search({
        index: testIndex,
        body: { query: { match_all: {} } },
      });
      const hitCount = searchResult.hits.total.value;
      checks.push({ name: 'OpenSearch SEARCH', passed: true, message: `Found ${hitCount} documents` });
      printCheck('SEARCH', true);

      // Delete document
      await client.delete({ index: testIndex, id: docId, refresh: true });
      checks.push({ name: 'OpenSearch DELETE', passed: true, message: 'Deleted document' });
      printCheck('DELETE Document', true);

      // Cleanup - delete index
      await client.indices.delete({ index: testIndex });
      printCheck('Cleanup', true, 'Deleted test index');
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'OpenSearch Operations', passed: false, message: error.message });
      printCheck('Operations', false, error.message);

      // Try to clean up anyway
      try {
        await client.indices.delete({ index: testIndex });
      } catch {
        // Ignore
      }
    }

    await client.close();
  } catch {
    checks.push({ name: 'OpenSearch Driver', passed: false, message: 'opensearch-py not installed' });
    printCheck('Driver', false, 'npm install @opensearch-project/opensearch');
  }

  return checks;
}

/**
 * Run OpenSearch validation checks.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('OpenSearch Validation');

  // Show VPC status
  if (hasVpcInterface()) {
    printInfo('VPC detected - will prefer private URLs');
  } else {
    printInfo('No VPC - using public URLs');
  }
  console.log();

  const config = getOpenSearchConfig();

  if (!config) {
    printInfo('No OpenSearch configuration found - skipping OpenSearch checks');
    printInfo('To enable, set these environment variables:');
    printInfo('  - OPENSEARCH_URL (https://user:pass@host:port)');
    printInfo('  OR');
    printInfo('  - OPENSEARCH_HOST, OPENSEARCH_PORT');
    printInfo('  - OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD');
    return 0; // Skip gracefully when not configured
  }

  const checks = await validateOpenSearch(config, verbose);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
