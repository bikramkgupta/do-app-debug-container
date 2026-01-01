/**
 * Kafka validation module.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  tcpCheck,
  CheckResult,
} from './utils';

interface KafkaConfig {
  broker: string | undefined;
  username: string | undefined;
  password: string | undefined;
  caCert: string | undefined;
}

/**
 * Get Kafka configuration from environment variables.
 */
function getKafkaConfig(): KafkaConfig {
  let broker = process.env.KAFKA_BROKER || process.env.KAFKA_BROKERS;

  // Handle multiple formats for broker
  if (!broker) {
    const host = process.env.KAFKA_HOST || process.env.KAFKA_HOSTNAME;
    const port = process.env.KAFKA_PORT || '25073';
    if (host) {
      broker = `${host}:${port}`;
    }
  }

  return {
    broker,
    username: process.env.KAFKA_USERNAME,
    password: process.env.KAFKA_PASSWORD,
    caCert: process.env.KAFKA_CA_CERT || process.env.CA_CERT,
  };
}

/**
 * Write CA certificate to a temporary file and return the path.
 */
function writeCaCert(caCert: string | undefined): string | null {
  if (!caCert) {
    return null;
  }

  // Handle certificate that might be escaped or have literal \n
  const certContent = caCert.replace(/\\n/g, '\n');

  // Write to temp file
  const tempDir = os.tmpdir();
  const certPath = path.join(tempDir, `kafka_ca_${Date.now()}.pem`);
  fs.writeFileSync(certPath, certContent);

  return certPath;
}

/**
 * Validate Kafka connectivity and operations.
 */
async function validateKafka(config: KafkaConfig, verbose: boolean = false): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  const broker = config.broker;
  if (!broker) {
    checks.push({ name: 'Kafka Config', passed: false, message: 'No broker configured' });
    printCheck('Configuration', false, 'KAFKA_BROKER not set');
    return checks;
  }

  // Parse broker host:port
  let host: string;
  let port: number;
  if (broker.includes(':')) {
    const parts = broker.split(':');
    host = parts.slice(0, -1).join(':');
    port = parseInt(parts[parts.length - 1], 10);
  } else {
    host = broker;
    port = 9092;
  }

  printInfo(`Broker: ${host}:${port}`);
  if (config.username) {
    printInfo(`Username: ${config.username}`);
  }
  if (config.password) {
    printInfo(`Password: ${maskSecret(config.password)}`);
  }
  if (config.caCert) {
    printInfo(`CA Cert: configured (${config.caCert.length} bytes)`);
  }

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(host, port);
  checks.push({ name: 'Kafka TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    printWarning('Kafka uses port 25073 on DigitalOcean - verify KAFKA_BROKER');
    return checks;
  }

  let caCertPath: string | null = null;
  try {
    const { Kafka, logLevel } = await import('kafkajs');

    // Write CA cert if provided
    caCertPath = writeCaCert(config.caCert);

    // Build SSL configuration
    const ssl: any = {
      rejectUnauthorized: true,
    };
    if (caCertPath) {
      ssl.ca = [fs.readFileSync(caCertPath, 'utf-8')];
    }

    // Build SASL configuration
    const sasl = config.username && config.password
      ? {
          mechanism: 'scram-sha-256' as const,
          username: config.username,
          password: config.password,
        }
      : undefined;

    const kafka = new Kafka({
      clientId: 'validate-infra',
      brokers: [`${host}:${port}`],
      ssl,
      sasl,
      connectionTimeout: 10000,
      requestTimeout: 10000,
      logLevel: logLevel.NOTHING,
    });

    // Admin client for metadata
    const admin = kafka.admin();

    try {
      await admin.connect();

      // List topics (tests connectivity)
      const topics = await admin.listTopics();
      checks.push({
        name: 'Kafka Connection',
        passed: true,
        message: `Connected, ${topics.length} topics found`,
      });
      printCheck('Connection', true, verbose ? `${topics.length} topics available` : undefined);

      // List some topics
      if (topics.length > 0) {
        const displayTopics = topics.slice(0, 5);
        printInfo(`Topics (first 5): ${displayTopics.join(', ')}`);
      }

      await admin.disconnect();
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message;
      checks.push({ name: 'Kafka Connection', passed: false, message: errorMsg });
      printCheck('Connection', false, errorMsg);

      if (errorMsg.includes('Authentication') || errorMsg.includes('SASL')) {
        printWarning('Check KAFKA_USERNAME and KAFKA_PASSWORD');
      } else if (errorMsg.includes('SSL') || errorMsg.toLowerCase().includes('certificate')) {
        printWarning('Check KAFKA_CA_CERT - may need valid CA certificate');
      }
      return checks;
    }

    // Producer test
    const testTopic = '_validate_infra_test';
    try {
      const producer = kafka.producer();
      await producer.connect();

      try {
        await producer.send({
          topic: testTopic,
          messages: [{ key: 'test-key', value: 'test-value' }],
        });
        checks.push({ name: 'Kafka Produce', passed: true, message: `Produced to ${testTopic}` });
        printCheck('Produce Message', true);
      } catch (err) {
        const error = err as Error;
        const errorMsg = error.message;
        // Topic might not exist and auto-create is disabled
        // Various error messages for this: UNKNOWN_TOPIC, does not exist, does not host this topic-partition
        if (
          errorMsg.includes('UNKNOWN_TOPIC') ||
          errorMsg.includes('does not exist') ||
          errorMsg.includes('does not host this topic-partition')
        ) {
          checks.push({
            name: 'Kafka Produce',
            passed: true,
            message: "Producer working (test topic doesn't exist)",
          });
          printCheck('Produce Message', true, verbose ? 'Working (no auto-create)' : undefined);
        } else {
          checks.push({ name: 'Kafka Produce', passed: false, message: errorMsg });
          printCheck('Produce Message', false, errorMsg);
        }
      }

      await producer.disconnect();
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'Kafka Produce', passed: false, message: error.message });
      printCheck('Produce Message', false, error.message);
    }

    // Consumer test
    try {
      const consumer = kafka.consumer({ groupId: 'validate-infra-consumer' });
      await consumer.connect();

      try {
        await consumer.subscribe({ topic: testTopic, fromBeginning: false });
        checks.push({ name: 'Kafka Subscribe', passed: true, message: `Subscribed to ${testTopic}` });
        printCheck('Subscribe', true);
      } catch (err) {
        const error = err as Error;
        const errorMsg = error.message;
        // Various error messages for missing topic
        if (
          errorMsg.includes('UNKNOWN_TOPIC') ||
          errorMsg.includes('does not exist') ||
          errorMsg.includes('does not host this topic-partition')
        ) {
          checks.push({ name: 'Kafka Subscribe', passed: true, message: 'Consumer working' });
          printCheck('Subscribe', true, "Working (test topic doesn't exist)");
        } else {
          throw err;
        }
      }

      await consumer.disconnect();
    } catch (err) {
      const error = err as Error;
      checks.push({ name: 'Kafka Subscribe', passed: false, message: error.message });
      printCheck('Subscribe', false, error.message);
    }
  } catch (importErr) {
    checks.push({ name: 'Kafka Driver', passed: false, message: 'kafkajs not installed' });
    printCheck('Driver', false, 'npm install kafkajs');
  } finally {
    // Clean up temp CA cert file
    if (caCertPath && fs.existsSync(caCertPath)) {
      try {
        fs.unlinkSync(caCertPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return checks;
}

/**
 * Run Kafka validation checks.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('Kafka Validation');

  printInfo('Note: Kafka does NOT support trusted sources on DigitalOcean');
  printInfo('It uses SASL/SCRAM authentication instead');
  console.log();

  const config = getKafkaConfig();

  if (!config.broker) {
    printInfo('No Kafka broker configured - skipping Kafka checks');
    printInfo('To enable, set these environment variables:');
    printInfo('  - KAFKA_BROKER (host:port)');
    printInfo('  - KAFKA_USERNAME');
    printInfo('  - KAFKA_PASSWORD');
    printInfo('  - KAFKA_CA_CERT (optional)');
    return 0; // Skip gracefully when not configured
  }

  const checks = await validateKafka(config, verbose);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
