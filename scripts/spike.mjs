/**
 * Phase 0 spike: validate AWS credentials, list Livy apps, optional Livy session test.
 *
 * Usage:
 *   node scripts/spike.mjs
 *   EMR_APPLICATION_ID=00fxxxxx node scripts/spike.mjs
 */
import { EMRServerlessClient, ListApplicationsCommand, GetApplicationCommand, GetResourceDashboardCommand } from '@aws-sdk/client-emr-serverless';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { HttpRequest } from '@smithy/protocol-http';

async function getRegion() {
  if (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION) {
    return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  }
  const { configFile } = await loadSharedConfigFiles();
  const profile = process.env.AWS_PROFILE ?? 'default';
  return configFile[profile]?.region;
}

async function livyFetch(region, applicationId, credentials, method, path, body) {
  const hostname = `${applicationId}.livy.emr-serverless-services.${region}.amazonaws.com`;
  const bodyText = body !== undefined ? JSON.stringify(body) : undefined;
  const request = new HttpRequest({
    method,
    protocol: 'https:',
    hostname,
    path,
    headers: {
      'Content-Type': 'application/json',
      host: hostname,
    },
    body: bodyText,
  });
  const signer = new SignatureV4({
    credentials,
    region,
    service: 'emr-serverless',
    sha256: Sha256,
  });
  const signed = await signer.sign(request);
  const headers = Object.fromEntries(
    Object.entries(signed.headers).map(([k, v]) => [k, String(v)])
  );
  const url = `https://${hostname}${path}`;
  const response = await fetch(url, { method, headers, body: bodyText });
  const text = await response.text();
  return { status: response.status, text: text ? JSON.parse(text) : null };
}

async function main() {
  const region = await getRegion();
  if (!region) {
    console.error('FAIL: No AWS region configured');
    process.exit(1);
  }
  console.log(`Region: ${region}`);

  const credentials = await fromNodeProviderChain()();
  if (!credentials.accessKeyId) {
    console.error('FAIL: No AWS credentials');
    process.exit(1);
  }
  console.log('OK: Credentials resolved');

  const client = new EMRServerlessClient({ region, credentials: fromNodeProviderChain() });
  const list = await client.send(new ListApplicationsCommand({ maxResults: 50 }));
  const livyApps = [];
  for (const summary of list.applications ?? []) {
    if (!summary.id) continue;
    const detail = await client.send(new GetApplicationCommand({ applicationId: summary.id }));
    if (detail.application?.interactiveConfiguration?.livyEndpointEnabled) {
      livyApps.push({
        id: summary.id,
        name: summary.name,
        state: summary.state,
      });
    }
  }
  console.log(`OK: Found ${livyApps.length} Livy-enabled application(s)`);
  livyApps.forEach((a) => console.log(`  - ${a.name} (${a.id}) [${a.state}]`));

  const appId = process.env.EMR_APPLICATION_ID ?? livyApps.find((a) => a.state === 'STARTED')?.id;
  if (!appId) {
    console.log('SKIP: No STARTED application for Livy test (set EMR_APPLICATION_ID)');
    return;
  }

  const listSessions = await livyFetch(region, appId, credentials, 'GET', '/sessions');
  console.log(`OK: Livy GET /sessions → ${listSessions.status}`, listSessions.text);

  const roleArn = process.env.EMR_EXECUTION_ROLE_ARN;
  if (roleArn) {
    const create = await livyFetch(region, appId, credentials, 'POST', '/sessions', {
      kind: 'pyspark',
      heartbeatTimeoutInSecond: 60,
      conf: { 'emr-serverless.session.executionRoleArn': roleArn },
    });
    console.log(`OK: Livy POST /sessions → ${create.status}`, create);
    const sessionId = create.text?.id;
    if (sessionId) {
      const stmt = await livyFetch(
        region,
        appId,
        credentials,
        'POST',
        `/sessions/${sessionId}/statements`,
        { code: '1 + 1', kind: 'pyspark' }
      );
      console.log(`OK: Statement submit → ${stmt.status}`);

      try {
        const dash = await client.send(
          new GetResourceDashboardCommand({
            applicationId: appId,
            resourceId: String(sessionId),
            resourceType: 'SESSION',
          })
        );
        console.log('OK: GetResourceDashboard URL:', dash.url ? 'received' : 'empty');
      } catch (e) {
        console.log('WARN: GetResourceDashboard:', e.message);
      }

      await livyFetch(region, appId, credentials, 'DELETE', `/sessions/${sessionId}`);
      console.log('OK: Session deleted');
    }
  } else {
    console.log('SKIP: Session create test (set EMR_EXECUTION_ROLE_ARN)');
  }
}

main().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
