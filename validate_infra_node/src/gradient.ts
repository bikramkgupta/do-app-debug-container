/**
 * Gradient AI (DigitalOcean Serverless Inference) validation module.
 */

import * as https from 'https';
import {
  printHeader,
  printCheck,
  printInfo,
  printWarning,
  printSummary,
  maskSecret,
  tcpCheck,
  dnsCheck,
  CheckResult,
} from './utils';

interface GradientConfig {
  accessKey: string | undefined;
  endpoint: string;
}

/**
 * Get Gradient AI configuration from environment variables.
 */
function getGradientConfig(): GradientConfig {
  return {
    accessKey:
      process.env.MODEL_ACCESS_KEY ||
      process.env.GRADIENT_ACCESS_KEY ||
      process.env.DO_AI_ACCESS_KEY,
    endpoint:
      process.env.INFERENCE_ENDPOINT ||
      process.env.GRADIENT_ENDPOINT ||
      'https://inference.do-ai.run',
  };
}

/**
 * Validate Gradient AI connectivity and API access.
 */
async function validateGradient(
  config: GradientConfig,
  verbose: boolean = false
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  printInfo(`Endpoint: ${config.endpoint}`);
  if (config.accessKey) {
    printInfo(`Access Key: ${maskSecret(config.accessKey)}`);
  } else {
    printInfo('Access Key: not configured');
  }

  // Parse endpoint for host
  const parsed = new URL(config.endpoint);
  const host = parsed.hostname;
  const port = parsed.port ? parseInt(parsed.port, 10) : 443;

  // DNS check
  const [dnsSuccess, dnsResult] = await dnsCheck(host);
  checks.push({
    name: 'Gradient DNS',
    passed: dnsSuccess,
    message: dnsSuccess
      ? `Resolved: ${Array.isArray(dnsResult) ? dnsResult.join(', ') : dnsResult}`
      : String(dnsResult),
  });
  printCheck(
    'DNS Resolution',
    dnsSuccess,
    verbose || !dnsSuccess
      ? String(Array.isArray(dnsResult) ? dnsResult.join(', ') : dnsResult).substring(0, 60)
      : undefined
  );

  if (!dnsSuccess) {
    return checks;
  }

  // TCP connectivity
  const [tcpSuccess, tcpMsg] = await tcpCheck(host, port);
  checks.push({ name: 'Gradient TCP', passed: tcpSuccess, message: tcpMsg });
  printCheck('TCP Connectivity', tcpSuccess, verbose || !tcpSuccess ? tcpMsg : undefined);

  if (!tcpSuccess) {
    return checks;
  }

  // HTTPS check
  const httpsResult = await new Promise<[boolean, string]>((resolve) => {
    const req = https.request(
      `${config.endpoint}/`,
      {
        method: 'HEAD',
        timeout: 10000,
      },
      (res) => {
        resolve([true, `HTTPS working (HTTP ${res.statusCode})`]);
      }
    );

    req.on('error', (err) => {
      resolve([false, err.message]);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve([false, 'Request timed out']);
    });

    req.end();
  });

  checks.push({ name: 'Gradient HTTPS', passed: httpsResult[0], message: httpsResult[1] });
  printCheck('HTTPS Connection', httpsResult[0], httpsResult[0] ? undefined : httpsResult[1]);

  if (!httpsResult[0]) {
    return checks;
  }

  // API authentication check
  if (!config.accessKey) {
    printInfo('MODEL_ACCESS_KEY not configured - skipping API checks');
    printInfo('Network connectivity verified. To enable API checks, set:');
    printInfo('  - MODEL_ACCESS_KEY');
    // Return only the successful network checks (DNS, TCP, HTTPS)
    return checks;
  }

  // Use axios if available, otherwise fall back to https
  try {
    const axios = (await import('axios')).default;

    const headers = {
      Authorization: `Bearer ${config.accessKey}`,
      'Content-Type': 'application/json',
    };

    // Test API - list models
    const modelsUrl = `${config.endpoint}/v1/models`;
    try {
      const response = await axios.get(modelsUrl, { headers, timeout: 10000 });

      if (response.status === 200) {
        const models = response.data.data || [];
        const modelCount = models.length;
        checks.push({
          name: 'Gradient API',
          passed: true,
          message: `API accessible, ${modelCount} models`,
        });
        printCheck('API Access', true, verbose ? `${modelCount} models available` : undefined);

        // List available models
        if (models.length > 0 && verbose) {
          printInfo('Available models:');
          for (const model of models.slice(0, 5)) {
            const modelId = model.id || 'unknown';
            printInfo(`  - ${modelId}`);
          }
        }

        // Test specific model availability
        const testModels = [
          'meta-llama/Llama-3.3-70B-Instruct',
          'meta-llama/Llama-3.1-8B-Instruct',
          'mistralai/Mistral-7B-Instruct-v0.3',
        ];

        let foundModel = false;
        for (const testModel of testModels) {
          const modelIds = models.map((m: any) => m.id || '');
          if (modelIds.includes(testModel)) {
            checks.push({ name: 'Gradient Model', passed: true, message: `${testModel} available` });
            printCheck(`Model: ${testModel.split('/').pop()}`, true);
            foundModel = true;
            break;
          }
        }

        if (!foundModel && models.length > 0) {
          const firstModel = models[0].id || 'unknown';
          checks.push({ name: 'Gradient Model', passed: true, message: `Found model: ${firstModel}` });
          printCheck('Model Available', true, firstModel.substring(0, 40));
        }
      }
    } catch (err) {
      const error = err as any;
      if (error.response?.status === 401) {
        checks.push({ name: 'Gradient Auth', passed: false, message: 'Invalid access key' });
        printCheck('Authentication', false, 'Invalid MODEL_ACCESS_KEY');
        printWarning('Check MODEL_ACCESS_KEY in DigitalOcean console');
      } else if (error.response?.status === 403) {
        checks.push({ name: 'Gradient Auth', passed: false, message: 'Access forbidden' });
        printCheck('Authentication', false, 'Access forbidden');
        printWarning('Check MODEL_ACCESS_KEY permissions');
      } else if (error.code === 'ECONNABORTED') {
        checks.push({ name: 'Gradient API', passed: false, message: 'Request timed out' });
        printCheck('API Access', false, 'Timeout');
      } else {
        const statusCode = error.response?.status || 'unknown';
        const errorMsg = error.message || String(error);
        checks.push({ name: 'Gradient API', passed: false, message: `HTTP ${statusCode}: ${errorMsg}` });
        printCheck('API Access', false, `HTTP ${statusCode}`);
      }
    }
  } catch {
    // Fall back to native https
    const apiResult = await new Promise<CheckResult>((resolve) => {
      const req = https.request(
        `${config.endpoint}/v1/models`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${config.accessKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const parsed = JSON.parse(data);
                const models = parsed.data || [];
                resolve({
                  name: 'Gradient API',
                  passed: true,
                  message: `${models.length} models available`,
                });
              } catch {
                resolve({ name: 'Gradient API', passed: true, message: 'API accessible' });
              }
            } else if (res.statusCode === 401) {
              resolve({ name: 'Gradient Auth', passed: false, message: 'Invalid access key' });
            } else {
              resolve({ name: 'Gradient API', passed: false, message: `HTTP ${res.statusCode}` });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({ name: 'Gradient API', passed: false, message: err.message });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ name: 'Gradient API', passed: false, message: 'Timeout' });
      });

      req.end();
    });

    checks.push(apiResult);
    printCheck(apiResult.name.replace('Gradient ', ''), apiResult.passed, apiResult.message);

    if (!apiResult.passed && apiResult.name === 'Gradient Auth') {
      printWarning('Check MODEL_ACCESS_KEY in DigitalOcean console');
    }
  }

  return checks;
}

/**
 * Run Gradient AI validation checks.
 */
export async function runChecks(verbose: boolean = false): Promise<number> {
  printHeader('Gradient AI (Serverless Inference) Validation');

  const config = getGradientConfig();

  if (!config.endpoint) {
    printWarning('Gradient AI endpoint not configured');
    config.endpoint = 'https://inference.do-ai.run';
    printInfo(`Using default endpoint: ${config.endpoint}`);
  }

  const checks = await validateGradient(config, verbose);

  return printSummary(checks);
}

// Allow running as standalone
if (require.main === module) {
  const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
  runChecks(verbose).then((code) => process.exit(code));
}
