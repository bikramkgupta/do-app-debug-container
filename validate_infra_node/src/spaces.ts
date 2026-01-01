/**
 * DigitalOcean Spaces (S3-compatible) validation module.
 */

import { randomUUID } from 'crypto';
import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  CheckResult,
} from './utils';

interface SpacesConfig {
  accessKey: string | undefined;
  secretKey: string | undefined;
  bucket: string | undefined;
  region: string;
  endpoint: string;
}

/**
 * Get Spaces configuration from environment variables.
 */
function getSpacesConfig(): SpacesConfig {
  // Get region - try multiple formats
  const region =
    process.env.SPACES_REGION ||
    process.env.DO_SPACES_REGION ||
    process.env.AWS_REGION ||
    'syd1'; // Default to Sydney

  // Get endpoint
  const endpoint =
    process.env.SPACES_ENDPOINT ||
    process.env.DO_SPACES_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL ||
    `https://${region}.digitaloceanspaces.com`;

  return {
    accessKey:
      process.env.SPACES_ACCESS_KEY ||
      process.env.DO_SPACES_KEY ||
      process.env.AWS_ACCESS_KEY_ID,
    secretKey:
      process.env.SPACES_SECRET_KEY ||
      process.env.DO_SPACES_SECRET ||
      process.env.AWS_SECRET_ACCESS_KEY,
    bucket:
      process.env.SPACES_BUCKET ||
      process.env.DO_SPACES_BUCKET ||
      process.env.S3_BUCKET,
    region,
    endpoint,
  };
}

/**
 * Validate Spaces connectivity and operations.
 */
async function validateSpaces(config: SpacesConfig, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  printInfo(`Endpoint: ${config.endpoint}`);
  printInfo(`Region: ${config.region}`);
  printInfo(`Bucket: ${config.bucket}`);
  printInfo(`Access Key: ${maskSecret(config.accessKey || '')}`);
  printInfo(`Secret Key: ${maskSecret(config.secretKey || '')}`);

  // Validate configuration
  if (!config.accessKey) {
    checks.push({ name: 'Spaces Config', passed: false, message: 'SPACES_ACCESS_KEY not set' });
    printCheck('Configuration', false, 'Missing access key');
    return checks;
  }

  if (!config.secretKey) {
    checks.push({ name: 'Spaces Config', passed: false, message: 'SPACES_SECRET_KEY not set' });
    printCheck('Configuration', false, 'Missing secret key');
    return checks;
  }

  if (!config.bucket) {
    checks.push({ name: 'Spaces Config', passed: false, message: 'SPACES_BUCKET not set' });
    printCheck('Configuration', false, 'Missing bucket name');
    return checks;
  }

  try {
    const {
      S3Client,
      HeadBucketCommand,
      PutObjectCommand,
      GetObjectCommand,
      HeadObjectCommand,
      DeleteObjectCommand,
      ListObjectsV2Command,
    } = await import('@aws-sdk/client-s3');

    // Create S3 client for Spaces
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: false, // Spaces uses virtual-hosted style
    });

    // Test bucket access
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }));
      checks.push({
        name: 'Spaces Bucket',
        passed: true,
        message: `Bucket '${config.bucket}' accessible`,
      });
      printCheck('Bucket Access', true);
    } catch (err) {
      const error = err as any;
      const errorCode = error.name || error.$metadata?.httpStatusCode?.toString() || 'Unknown';

      if (errorCode === 'NotFound' || errorCode === '404') {
        checks.push({
          name: 'Spaces Bucket',
          passed: false,
          message: `Bucket '${config.bucket}' not found`,
        });
        printCheck('Bucket Access', false, 'Bucket not found');
        printWarning('Create the bucket or check SPACES_BUCKET name');
      } else if (errorCode === 'Forbidden' || errorCode === '403') {
        checks.push({ name: 'Spaces Bucket', passed: false, message: 'Access denied to bucket' });
        printCheck('Bucket Access', false, 'Access denied');
        printWarning('Check Spaces access key permissions');
      } else {
        checks.push({ name: 'Spaces Bucket', passed: false, message: error.message });
        printCheck('Bucket Access', false, error.message);
      }
      return checks;
    }

    // Test object operations
    const testKey = `_validate_infra_test/${randomUUID()}`;
    const testContent = 'validate-infra test content';

    try {
      // PUT object
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: testKey,
          Body: testContent,
          ContentType: 'text/plain',
        })
      );
      checks.push({ name: 'Spaces PUT', passed: true, message: `Uploaded ${testKey}` });
      printCheck('PUT Object', true);

      // GET object
      const getResponse = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: testKey,
        })
      );
      const retrieved = await getResponse.Body?.transformToString();
      if (retrieved === testContent) {
        checks.push({ name: 'Spaces GET', passed: true, message: 'Retrieved correct content' });
        printCheck('GET Object', true);
      } else {
        checks.push({ name: 'Spaces GET', passed: false, message: 'Content mismatch' });
        printCheck('GET Object', false, 'Content mismatch');
      }

      // HEAD object (check metadata)
      const headResponse = await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: testKey,
        })
      );
      const size = headResponse.ContentLength || 0;
      checks.push({ name: 'Spaces HEAD', passed: true, message: `Object size: ${size} bytes` });
      printCheck('HEAD Object', true, verbose ? `Size: ${size} bytes` : undefined);

      // DELETE object
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: testKey,
        })
      );
      checks.push({ name: 'Spaces DELETE', passed: true, message: 'Deleted test object' });
      printCheck('DELETE Object', true);

      // Verify deletion
      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: config.bucket,
            Key: testKey,
          })
        );
        printCheck('Cleanup', false, 'Object still exists');
      } catch (err) {
        const error = err as any;
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
          printCheck('Cleanup', true, 'Object removed');
        } else {
          throw err;
        }
      }
    } catch (err) {
      const error = err as any;
      const errorCode = error.name || 'Unknown';
      const errorMsg = error.message || String(error);
      checks.push({ name: 'Spaces Operations', passed: false, message: `${errorCode}: ${errorMsg}` });
      printCheck('Operations', false, `${errorCode}: ${errorMsg}`);

      if (errorCode === 'AccessDenied') {
        printWarning('Check Spaces key has write permissions');
      }

      // Try to clean up
      try {
        await client.send(
          new DeleteObjectCommand({
            Bucket: config.bucket,
            Key: testKey,
          })
        );
      } catch {
        // Ignore
      }
    }

    // List objects (optional, shows permissions)
    try {
      const listResponse = await client.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          MaxKeys: 5,
        })
      );
      const objCount = listResponse.KeyCount || 0;
      checks.push({
        name: 'Spaces LIST',
        passed: true,
        message: `Can list objects (${objCount} shown)`,
      });
      printCheck('LIST Objects', true);
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'Spaces LIST', passed: false, message: error.message });
      printCheck('LIST Objects', false, error.message);
    }

    client.destroy();
  } catch (err) {
    const error = err as Error;
    if (error.message?.includes('Cannot find module')) {
      checks.push({ name: 'Spaces Driver', passed: false, message: '@aws-sdk/client-s3 not installed' });
      printCheck('Driver (@aws-sdk/client-s3)', false, 'npm install @aws-sdk/client-s3');
    } else {
      checks.push({ name: 'Spaces Error', passed: false, message: error.message });
      printCheck('Spaces', false, error.message);
    }
  }

  return checks;
}

/**
 * Run Spaces validation checks.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('DigitalOcean Spaces Validation');

  const config = getSpacesConfig();

  if (!config.accessKey || !config.secretKey) {
    printInfo('Spaces credentials not configured - skipping Spaces checks');
    printInfo('To enable, set these environment variables:');
    printInfo('  - SPACES_ACCESS_KEY');
    printInfo('  - SPACES_SECRET_KEY');
    printInfo('  - SPACES_BUCKET');
    printInfo('  - SPACES_REGION (optional, default: syd1)');
    printInfo('  - SPACES_ENDPOINT (optional)');
    return 0; // Skip gracefully when not configured
  }

  const checks = await validateSpaces(config, verbose);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
