import type { AwsCredentialIdentity } from '@smithy/types';
import * as vscode from 'vscode';

const SECRET_ACCESS_KEY_ID = 'emrServerless.aws.accessKeyId';
const SECRET_SECRET_ACCESS_KEY = 'emrServerless.aws.secretAccessKey';
const SECRET_SESSION_TOKEN = 'emrServerless.aws.sessionToken';

let secrets: vscode.SecretStorage | undefined;
let cachedCredentials: AwsCredentialIdentity | undefined;
let cacheLoaded = false;
let onCredentialsChanged: (() => void) | undefined;

export function initializeExtensionCredentials(
  context: vscode.ExtensionContext,
  onChanged?: () => void
): void {
  secrets = context.secrets;
  onCredentialsChanged = onChanged;
  cacheLoaded = false;
  cachedCredentials = undefined;

  context.subscriptions.push(
    context.secrets.onDidChange((event) => {
      if (
        event.key === SECRET_ACCESS_KEY_ID ||
        event.key === SECRET_SECRET_ACCESS_KEY ||
        event.key === SECRET_SESSION_TOKEN
      ) {
        invalidateExtensionCredentialsCache();
        onCredentialsChanged?.();
      }
    })
  );
}

function invalidateExtensionCredentialsCache(): void {
  cacheLoaded = false;
  cachedCredentials = undefined;
}

async function requireSecrets(): Promise<vscode.SecretStorage> {
  if (!secrets) {
    throw new Error('Extension credentials store is not initialized.');
  }
  return secrets;
}

export async function getExtensionCredentials(): Promise<AwsCredentialIdentity | undefined> {
  if (!secrets) {
    return undefined;
  }
  if (cacheLoaded) {
    return cachedCredentials;
  }

  const accessKeyId = (await secrets.get(SECRET_ACCESS_KEY_ID))?.trim();
  const secretAccessKey = (await secrets.get(SECRET_SECRET_ACCESS_KEY))?.trim();
  const sessionToken = (await secrets.get(SECRET_SESSION_TOKEN))?.trim();

  if (!accessKeyId || !secretAccessKey) {
    cachedCredentials = undefined;
    cacheLoaded = true;
    return undefined;
  }

  cachedCredentials = {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
  cacheLoaded = true;
  return cachedCredentials;
}

export async function hasExtensionCredentials(): Promise<boolean> {
  return Boolean(await getExtensionCredentials());
}

export async function setExtensionCredentials(creds: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}): Promise<void> {
  const store = await requireSecrets();
  const accessKeyId = creds.accessKeyId.trim();
  const secretAccessKey = creds.secretAccessKey.trim();
  const sessionToken = creds.sessionToken?.trim();

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Access key ID and secret access key are required.');
  }

  await store.store(SECRET_ACCESS_KEY_ID, accessKeyId);
  await store.store(SECRET_SECRET_ACCESS_KEY, secretAccessKey);
  if (sessionToken) {
    await store.store(SECRET_SESSION_TOKEN, sessionToken);
  } else {
    await store.delete(SECRET_SESSION_TOKEN);
  }

  cachedCredentials = {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
  cacheLoaded = true;
  onCredentialsChanged?.();
}

export async function clearExtensionCredentials(): Promise<void> {
  const store = await requireSecrets();
  await Promise.all([
    store.delete(SECRET_ACCESS_KEY_ID),
    store.delete(SECRET_SECRET_ACCESS_KEY),
    store.delete(SECRET_SESSION_TOKEN),
  ]);
  cachedCredentials = undefined;
  cacheLoaded = true;
  onCredentialsChanged?.();
}

/**
 * Prompt to set or clear extension-stored AWS credentials (SecretStorage).
 * Useful on Windows when ~/.aws shared config files are not visible to the extension host.
 */
export async function promptExtensionCredentials(): Promise<boolean> {
  const hasCreds = await hasExtensionCredentials();

  type ActionItem = vscode.QuickPickItem & { action: 'set' | 'clear' };

  const items: ActionItem[] = [
    {
      action: 'set',
      label: '$(key) Set access keys',
      description: hasCreds ? 'Replace stored credentials' : 'Store in extension secrets',
      detail:
        'Access key ID + secret access key (+ optional session token). Stored in VS Code Secret Storage, not settings.json.',
    },
  ];

  if (hasCreds) {
    items.push({
      action: 'clear',
      label: '$(trash) Clear extension credentials',
      description: 'Fall back to ~/.aws profile / env',
      detail: 'Removes keys stored by this extension.',
    });
  }

  const action = await vscode.window.showQuickPick(items, {
    title: 'AWS credentials (extension)',
    placeHolder: hasCreds
      ? 'Extension credentials are set — they override ~/.aws profiles'
      : 'No extension credentials — using profile / env chain',
  });

  if (!action) {
    return false;
  }

  if (action.action === 'clear') {
    await clearExtensionCredentials();
    void vscode.window.showInformationMessage(
      'Cleared extension AWS credentials. Using profile / environment chain.'
    );
    return true;
  }

  const accessKeyId = await vscode.window.showInputBox({
    title: 'AWS Access Key ID',
    prompt: 'AKIA… or ASIA…',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Access key ID is required'),
  });
  if (accessKeyId === undefined) {
    return false;
  }

  const secretAccessKey = await vscode.window.showInputBox({
    title: 'AWS Secret Access Key',
    prompt: 'Stored in VS Code Secret Storage (not settings.json)',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Secret access key is required'),
  });
  if (secretAccessKey === undefined) {
    return false;
  }

  const sessionToken = await vscode.window.showInputBox({
    title: 'AWS Session Token (optional)',
    prompt: 'Leave empty for long-term IAM user keys; required for temporary / SSO-exported keys',
    password: true,
    ignoreFocusOut: true,
  });
  if (sessionToken === undefined) {
    return false;
  }

  await setExtensionCredentials({
    accessKeyId,
    secretAccessKey,
    sessionToken: sessionToken.trim() || undefined,
  });

  void vscode.window.showInformationMessage(
    'AWS credentials saved in extension Secret Storage. They override ~/.aws profiles until cleared.'
  );
  return true;
}
