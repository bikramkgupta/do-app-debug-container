/**
 * Environment variable validation module.
 */

import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  CheckResult,
} from './utils';

// Common environment variable patterns
const COMMON_REQUIRED_VARS = ['DATABASE_URL', 'REDIS_URL'];

// URL format patterns
const URL_PATTERNS: Record<string, RegExp> = {
  postgresql: /^postgres(ql)?:\/\/[^:]+:[^@]+@[^:/]+:\d+\/.+/,
  mysql: /^mysql:\/\/[^:]+:[^@]+@[^:/]+:\d+\/.+/,
  mongodb: /^mongodb(\+srv)?:\/\/[^:]+:[^@]+@[^/]+\/.+/,
  redis: /^rediss?:\/\/[^@]*@?[^:/]+:\d+/,
  http: /^https?:\/\/.+/,
};

// Bindable variable pattern (unresolved)
const BINDABLE_PATTERN = /\$\{[^}]+\}/g;

interface VarCheckResult {
  varName: string;
  isSet: boolean;
  preview: string;
}

/**
 * Check that required environment variables are set.
 */
function checkRequiredVars(required: string[]): VarCheckResult[] {
  const results: VarCheckResult[] = [];

  for (const varName of required) {
    const value = process.env[varName];
    if (value) {
      // Check for unresolved bindable variables
      if (BINDABLE_PATTERN.test(value)) {
        results.push({
          varName,
          isSet: false,
          preview: `Unresolved: ${value.substring(0, 50)}`,
        });
      } else {
        results.push({
          varName,
          isSet: true,
          preview: maskSecret(value, 8),
        });
      }
    } else {
      results.push({
        varName,
        isSet: false,
        preview: 'Not set',
      });
    }
  }

  return results;
}

/**
 * Validate URL format for a variable.
 * Returns [isValid, message].
 */
function checkUrlFormat(varName: string, url: string): [boolean, string] {
  if (!url) {
    return [false, 'Empty URL'];
  }

  // Check for unresolved bindable variables
  const matches = url.match(BINDABLE_PATTERN);
  if (matches) {
    return [false, `Unresolved variables: ${matches.slice(0, 3).join(', ')}`];
  }

  // Try to match against known patterns
  for (const [urlType, pattern] of Object.entries(URL_PATTERNS)) {
    if (pattern.test(url)) {
      return [true, `Valid ${urlType} URL format`];
    }
  }

  // Check if it at least looks like a URL
  if (url.includes('://')) {
    return [true, 'URL format (unknown scheme)'];
  }

  return [false, 'Invalid URL format'];
}

/**
 * Check that secrets are not accidentally exposed in non-secret vars.
 */
function checkSecretsNotExposed(): string[] {
  const warnings: string[] = [];

  for (const [varName, value] of Object.entries(process.env)) {
    if (!value) continue;

    // Skip known secret variables
    const secretKeywords = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL'];
    if (secretKeywords.some((s) => varName.toUpperCase().includes(s))) {
      continue;
    }

    // Check for passwords in non-secret vars
    if (value.toLowerCase().includes('password=') && !varName.toUpperCase().includes('URL')) {
      warnings.push(`${varName} may contain exposed password`);
    }
  }

  return warnings;
}

/**
 * Get all DigitalOcean-related environment variables.
 */
function getAllDoVars(): Record<string, string> {
  const prefixes = [
    'DATABASE_',
    'REDIS_',
    'MONGO',
    'MYSQL_',
    'POSTGRES_',
    'PG_',
    'KAFKA_',
    'OPENSEARCH_',
    'SPACES_',
    'DO_',
    'DIGITALOCEAN_',
    'MODEL_',
    'INFERENCE_',
    'GRADIENT_',
    'CA_CERT',
    'APP_',
  ];

  const result: Record<string, string> = {};
  const sortedEntries = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));

  for (const [varName, value] of sortedEntries) {
    if (value && prefixes.some((p) => varName.startsWith(p) || varName.toUpperCase().startsWith(p))) {
      result[varName] = value;
    }
  }

  return result;
}

/**
 * Run environment variable validation checks.
 */
export async function runChecks(
  required?: string[],
  verbose: boolean = false
): Promise<number> {
  printHeader('Environment Variable Validation');

  const checks: CheckResult[] = [];

  // Use provided required vars or defaults
  const requiredVars = required || COMMON_REQUIRED_VARS;

  // Check required variables
  printInfo('Checking required variables...');
  console.log();

  const requiredResults = checkRequiredVars(requiredVars);
  for (const { varName, isSet, preview } of requiredResults) {
    checks.push({
      name: `Env: ${varName}`,
      passed: isSet,
      message: preview,
    });
    printCheck(varName, isSet, verbose || !isSet ? preview : undefined);
  }

  console.log();

  // Show all DO-related vars
  const doVars = getAllDoVars();
  if (Object.keys(doVars).length > 0) {
    printInfo(`Found ${Object.keys(doVars).length} DigitalOcean-related variables:`);
    console.log();

    for (const [varName, value] of Object.entries(doVars)) {
      // Determine if it's a secret
      const secretKeywords = ['PASSWORD', 'SECRET', 'KEY', 'TOKEN', 'CREDENTIAL', 'CERT'];
      const isSecret = secretKeywords.some((s) => varName.toUpperCase().includes(s));

      // Check for issues
      let hasIssue = false;
      let issueMsg: string | undefined;

      if (BINDABLE_PATTERN.test(value)) {
        hasIssue = true;
        issueMsg = `Unresolved: ${value.substring(0, 40)}`;
      }

      if (hasIssue) {
        checks.push({
          name: `Env: ${varName}`,
          passed: false,
          message: issueMsg,
        });
        printCheck(varName, false, issueMsg);
      } else {
        const displayValue = isSecret
          ? maskSecret(value, 8)
          : value.length > 40
          ? value.substring(0, 40) + '...'
          : value;
        if (verbose) {
          printInfo(`  ${varName}=${displayValue}`);
        }
      }
    }
  }

  // Check URL formats
  console.log();
  printInfo('Validating URL formats...');
  console.log();

  const urlVars = [
    'DATABASE_URL',
    'DATABASE_PRIVATE_URL',
    'MYSQL_URL',
    'MYSQL_PRIVATE_URL',
    'REDIS_URL',
    'REDIS_PRIVATE_URL',
    'MONGODB_URI',
    'MONGODB_PRIVATE_URI',
    'OPENSEARCH_URL',
    'OPENSEARCH_PRIVATE_URL',
    'INFERENCE_ENDPOINT',
  ];

  for (const varName of urlVars) {
    const value = process.env[varName];
    if (value) {
      const [isValid, msg] = checkUrlFormat(varName, value);
      checks.push({
        name: `URL: ${varName}`,
        passed: isValid,
        message: msg,
      });
      printCheck(`${varName} format`, isValid, verbose || !isValid ? msg : undefined);
    }
  }

  // Check for exposed secrets
  console.log();
  const warnings = checkSecretsNotExposed();
  for (const warning of warnings) {
    printWarning(warning);
  }

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');

  // Parse --required flag
  let required: string[] | undefined;
  const requiredIdx = process.argv.findIndex((arg) => arg === '--required');
  if (requiredIdx !== -1 && process.argv[requiredIdx + 1]) {
    required = process.argv[requiredIdx + 1].split(',');
  }

  runChecks(required, verbose).then((code) => process.exit(code));
}
