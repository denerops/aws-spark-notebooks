import { loadSharedConfigFiles, type ParsedIniData } from '@smithy/shared-ini-file-loader';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfiguredAwsProfile, getConfiguredAwsRegion } from './config';
import {
  getCredentialProvider,
  getDefaultRegion,
  getEffectiveAwsProfile,
  getResolvedAutoProfile,
} from './credentials';
import { getExtensionCredentials, hasExtensionCredentials } from './extensionCredentials';
import { getEmrServerlessService } from './emrServerlessClient';
import { describeProxyForHost } from './proxyConfig';

const OUTPUT_CHANNEL = 'EMR Serverless AWS Diagnostics';

function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

function maskAccessKey(accessKeyId: string): string {
  if (accessKeyId.length <= 4) {
    return '****';
  }
  return `${accessKeyId.slice(0, 4)}…${accessKeyId.slice(-2)}`;
}

function isSsoSection(section: ParsedIniData[string] | undefined): boolean {
  return Boolean(section?.sso_start_url || section?.sso_session);
}

export async function runAwsDiagnostics(): Promise<void> {
  const channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  channel.clear();
  channel.show(true);

  const lines: string[] = [
    'EMR Serverless — AWS credential diagnostics',
    `Time: ${new Date().toISOString()}`,
    '',
    '=== Profile resolution ===',
    line('Configured emrServerless.awsProfile', getConfiguredAwsProfile() ?? '(empty / auto)'),
    line('process.env.AWS_PROFILE (extension host)', process.env.AWS_PROFILE ?? '(not set)'),
    line('Auto-resolved SSO profile', getResolvedAutoProfile() ?? '(none)'),
    line('Effective profile used by extension', getEffectiveAwsProfile()),
    line('Configured emrServerless.awsRegion', getConfiguredAwsRegion() ?? '(empty)'),
    line(
      'Extension Secret Storage credentials',
      (await hasExtensionCredentials()) ? 'SET (override profile / ~/.aws)' : 'not set'
    ),
  ];

  try {
    lines.push(line('Resolved region', await getDefaultRegion()));
  } catch (error) {
    lines.push(line('Resolved region', `ERROR — ${error instanceof Error ? error.message : String(error)}`));
  }

  lines.push(
    '',
    '=== Config / home paths (extension host) ===',
    line('os.homedir()', os.homedir()),
    line('USERPROFILE', process.env.USERPROFILE ?? '(not set)'),
    line('HOME', process.env.HOME ?? '(not set)'),
    line('AWS_CONFIG_FILE', process.env.AWS_CONFIG_FILE ?? '(not set)'),
    line('AWS_SHARED_CREDENTIALS_FILE', process.env.AWS_SHARED_CREDENTIALS_FILE ?? '(not set)'),
    line('Expected config', path.join(os.homedir(), '.aws', 'config')),
    line('Expected credentials', path.join(os.homedir(), '.aws', 'credentials'))
  );

  const { configFile, credentialsFile } = await loadSharedConfigFiles();
  const profile = getEffectiveAwsProfile();
  const profileSection = configFile[profile];
  const credSection = credentialsFile[profile];

  lines.push(
    '',
    '=== Profile details from ~/.aws/config ===',
    line('Profile exists in config', profileSection ? 'yes' : 'no'),
    line('Profile type', isSsoSection(profileSection) ? 'SSO' : profileSection?.role_arn ? 'assume-role' : credSection ? 'static credentials file' : 'unknown'),
    line('sso_start_url', profileSection?.sso_start_url ?? '(none)'),
    line('sso_session', profileSection?.sso_session ?? '(none)'),
    line('region in profile', profileSection?.region ?? '(none)'),
    line('proxy_url in profile', profileSection?.proxy_url ?? '(none)')
  );

  const ssoProfiles = Object.entries(configFile)
    .filter(([name, section]) => isSsoSection(section))
    .map(([name]) => name);

  lines.push(
    '',
    '=== SSO profiles in config ===',
    ssoProfiles.length > 0 ? ssoProfiles.map((name) => `  - ${name}${name === profile ? '  ← extension uses this' : ''}`).join('\n') : '  (none found)'
  );

  if (ssoProfiles.length > 1 && !getConfiguredAwsProfile()) {
    lines.push(
      '',
      '⚠ Multiple SSO profiles found and extension profile is auto.',
      '  Pick the same profile you use with `aws sso login` in the Config sidebar.'
    );
  }

  lines.push(
    '',
    '=== Proxy (extension host) ===',
    line('http.proxy (VS Code)', vscode.workspace.getConfiguration('http').get<string>('proxy', '') || '(empty)'),
    line('http.proxySupport', String(vscode.workspace.getConfiguration('http').get('proxySupport', 'fallback'))),
    line('HTTP_PROXY', process.env.HTTP_PROXY ?? process.env.http_proxy ?? '(not set)'),
    line('HTTPS_PROXY', process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '(not set)'),
    line('NO_PROXY', process.env.NO_PROXY ?? process.env.no_proxy ?? '(not set)'),
    line('EMR API route', describeProxyForHost('emr-serverless.us-east-1.amazonaws.com')),
    line('STS route', describeProxyForHost('sts.us-east-1.amazonaws.com'))
  );

  lines.push('', '=== Resolved credentials (from extension SDK) ===');

  try {
    const extensionCreds = await getExtensionCredentials();
    const creds = await getCredentialProvider()();
    lines.push(
      line(
        'credential source',
        extensionCreds ? 'extension Secret Storage' : 'profile / env (~/.aws or AWS_* env)'
      ),
      line('accessKeyId', creds.accessKeyId ? maskAccessKey(creds.accessKeyId) : '(missing)'),
      line('has sessionToken', creds.sessionToken ? 'yes' : 'no'),
      line('expiration', creds.expiration ? creds.expiration.toISOString() : '(none)')
    );

    if (creds.expiration && creds.expiration.getTime() < Date.now()) {
      lines.push('⚠ Credentials are expired. Run `aws sso login --profile ' + profile + '`.');
    }
  } catch (error) {
    lines.push(`ERROR resolving credentials — ${error instanceof Error ? error.message : String(error)}`);
    lines.push(
      'Tip (Windows): if ~/.aws is missing from the paths above, use Config → AWS Credentials to paste access keys into extension Secret Storage.'
    );
  }

  lines.push('', '=== Glue Interactive Sessions API test ===');

  try {
    const { getGlueSessionService } = await import('../glue/glueSessionService');
    const glueService = getGlueSessionService();
    const glueRegion = await glueService.getRegion();
    lines.push(line('Glue region', glueRegion));
    const sessions = await glueService.listLivySessions();
    lines.push(`OK — listLivySessions succeeded (${sessions.length} Livy session(s))`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`FAILED — ${message}`);
    lines.push('');
    lines.push('Compare with CLI using the SAME profile name shown above:');
    lines.push(`  aws glue list-sessions --profile ${profile} --region <region>`);
  }

  lines.push('', '=== EMR Serverless API test (same call as Applications list) ===');

  try {
    const service = getEmrServerlessService();
    const region = await service.getRegion();
    lines.push(line('EMR region', region));
    const apps = await service.listLivyApplications();
    lines.push(`OK — listLivyApplications succeeded (${apps.length} Livy-enabled app(s))`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`FAILED — ${message}`);
    lines.push('');
    lines.push('Compare with CLI using the SAME profile name shown above:');
    lines.push(`  aws sts get-caller-identity --profile ${profile}`);
    lines.push(`  aws emr-serverless list-applications --profile ${profile} --region <region>`);
  }

  lines.push(
    '',
    '=== How to interpret ===',
    '1. If CLI works but effective profile here differs from your terminal profile → select the correct profile in Config sidebar.',
    '2. If credentials resolve but API test fails with "security token" → run `aws sso login --profile ' + profile + '` then reload the window.',
    '3. If home/config paths differ from where you ran `aws sso login` → extension and CLI are reading different AWS files.',
    '4. On Windows, if Expected credentials path has no file but CLI works → use Config → AWS Credentials (extension Secret Storage).',
    '5. If proxy route is unexpected → align http.proxy / HTTP_PROXY with your corporate proxy settings.'
  );

  channel.appendLine(lines.join('\n'));

  const failed = lines.some((entry) => entry.startsWith('FAILED —') || entry.startsWith('ERROR resolving'));
  if (failed) {
    void vscode.window.showWarningMessage(
      `AWS diagnostics failed for profile "${profile}". See Output → ${OUTPUT_CHANNEL}.`,
      'Open Output'
    ).then((choice) => {
      if (choice === 'Open Output') {
        channel.show(true);
      }
    });
  } else {
    void vscode.window.showInformationMessage(
      `AWS diagnostics passed for profile "${profile}". See Output → ${OUTPUT_CHANNEL}.`
    );
  }
}
