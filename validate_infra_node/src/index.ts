#!/usr/bin/env node
/**
 * validate-infra - Infrastructure Validation Suite for DigitalOcean App Platform
 *
 * Usage:
 *     validate-infra [command] [options]
 *
 * Commands:
 *     all             Run all validations (default)
 *     network         Test network connectivity (DNS, HTTPS, registries)
 *     database        Test database connections (PostgreSQL, MySQL, MongoDB)
 *     cache           Test Redis/Valkey cache
 *     kafka           Test Kafka connectivity
 *     opensearch      Test OpenSearch cluster
 *     spaces          Test DigitalOcean Spaces (S3)
 *     gradient        Test Gradient AI (Serverless Inference)
 *     env             Validate environment variables
 *
 * Options:
 *     -v, --verbose   Show detailed output
 *     -h, --help      Show this help message
 *     --required VAR1,VAR2  Specify required env vars (for 'env' command)
 *
 * Examples:
 *     validate-infra all                    # Run all checks
 *     validate-infra database -v            # Verbose database checks
 *     validate-infra env --required DATABASE_URL,REDIS_URL
 */

import { BOLD, CYAN, NC, RED } from './utils';

const HELP_TEXT = `
validate-infra - Infrastructure Validation Suite for DigitalOcean App Platform

Usage:
    validate-infra [command] [options]

Commands:
    all             Run all validations (default)
    network         Test network connectivity (DNS, HTTPS, registries)
    database        Test database connections (PostgreSQL, MySQL, MongoDB)
    cache           Test Redis/Valkey cache
    kafka           Test Kafka connectivity
    opensearch      Test OpenSearch cluster
    spaces          Test DigitalOcean Spaces (S3)
    gradient        Test Gradient AI (Serverless Inference)
    env             Validate environment variables

Options:
    -v, --verbose   Show detailed output
    -h, --help      Show this help message
    --required VAR1,VAR2  Specify required env vars (for 'env' command)

Examples:
    validate-infra all                    # Run all checks
    validate-infra database -v            # Verbose database checks
    validate-infra env --required DATABASE_URL,REDIS_URL
`;

function printBanner(): void {
  console.log(`
${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}
${BOLD}${CYAN}║     Infrastructure Validation Suite for App Platform          ║${NC}
${BOLD}${CYAN}║                    DigitalOcean Debug Container               ║${NC}
${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}
`);
}

function printHelp(): void {
  console.log(HELP_TEXT);
}

interface ModuleInfo {
  name: string;
  runChecks: (verbose: boolean) => Promise<number>;
}

async function runAll(verbose: boolean): Promise<number> {
  // Dynamic imports to avoid loading all modules if not needed
  const network = await import('./network');
  const database = await import('./database');
  const cache = await import('./cache');
  const kafka = await import('./kafka');
  const opensearch = await import('./opensearch');
  const spaces = await import('./spaces');
  const gradient = await import('./gradient');
  const env = await import('./env');

  let exitCode = 0;
  const failedModules: string[] = [];

  const modules: ModuleInfo[] = [
    { name: 'Network', runChecks: network.runChecks },
    { name: 'Database', runChecks: (v: boolean) => database.runChecks(undefined, v) },
    { name: 'Cache', runChecks: cache.runChecks },
    { name: 'Kafka', runChecks: kafka.runChecks },
    { name: 'OpenSearch', runChecks: opensearch.runChecks },
    { name: 'Spaces', runChecks: spaces.runChecks },
    { name: 'Gradient AI', runChecks: gradient.runChecks },
    { name: 'Environment', runChecks: (v: boolean) => env.runChecks(undefined, v) },
  ];

  for (const module of modules) {
    try {
      const result = await module.runChecks(verbose);
      if (result !== 0) {
        exitCode = 1;
        failedModules.push(module.name);
      }
    } catch (err) {
      const error = err as Error;
      console.log(`\n[ERROR] ${module.name} validation failed: ${error.message}`);
      if (verbose) {
        console.error(error.stack);
      }
      exitCode = 1;
      failedModules.push(module.name);
    }
  }

  // Print final overall summary
  console.log('\n' + '='.repeat(60));
  console.log('                    OVERALL RESULT');
  console.log('='.repeat(60));

  if (exitCode === 0) {
    console.log(`\n  \x1b[0;32m✓ ALL CHECKS PASSED\x1b[0m\n`);
  } else {
    console.log(`\n  ${RED}✗ VALIDATION FAILED${NC}`);
    console.log(`\n  Failed modules (${failedModules.length}):`);
    for (const mod of failedModules) {
      console.log(`    - ${mod}`);
    }
    console.log();
  }
  console.log('='.repeat(60) + '\n');

  return exitCode;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  // Parse options
  const verbose = args.includes('-v') || args.includes('--verbose');
  const filteredArgs = args.filter((arg) => arg !== '-v' && arg !== '--verbose');

  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    return 0;
  }

  // Get command (default to 'all')
  const command = filteredArgs.find((arg) => !arg.startsWith('-')) || 'all';

  try {
    switch (command) {
      case 'all': {
        printBanner();
        return await runAll(verbose);
      }

      case 'network': {
        const network = await import('./network');
        return await network.runChecks(verbose);
      }

      case 'database': {
        const database = await import('./database');
        // Check for database type argument
        let dbType: string | undefined;
        for (const arg of filteredArgs.slice(1)) {
          if (['postgresql', 'mysql', 'mongodb', 'pg', 'postgres', 'mongo'].includes(arg)) {
            dbType = arg;
            break;
          }
        }
        return await database.runChecks(dbType, verbose);
      }

      case 'cache': {
        const cache = await import('./cache');
        return await cache.runChecks(verbose);
      }

      case 'kafka': {
        const kafka = await import('./kafka');
        return await kafka.runChecks(verbose);
      }

      case 'opensearch': {
        const opensearch = await import('./opensearch');
        return await opensearch.runChecks(verbose);
      }

      case 'spaces': {
        const spaces = await import('./spaces');
        return await spaces.runChecks(verbose);
      }

      case 'gradient': {
        const gradient = await import('./gradient');
        return await gradient.runChecks(verbose);
      }

      case 'env': {
        const env = await import('./env');
        // Parse --required
        let required: string[] | undefined;
        const requiredIdx = args.findIndex((arg) => arg === '--required');
        if (requiredIdx !== -1 && args[requiredIdx + 1]) {
          required = args[requiredIdx + 1].split(',');
        }
        return await env.runChecks(required, verbose);
      }

      default: {
        console.log(`Unknown command: ${command}`);
        printHelp();
        return 1;
      }
    }
  } catch (err) {
    const error = err as Error;
    console.log(`[ERROR] Failed to run validation: ${error.message}`);
    if (verbose) {
      console.error(error.stack);
    }
    return 1;
  }
}

// Run main
main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
