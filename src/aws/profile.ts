import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import * as vscode from 'vscode';
import { getConfiguredAwsProfile, getExtensionConfig } from './config';
import { getEffectiveAwsProfile, getResolvedAutoProfile, resetAwsClients } from './credentials';
import { resetEmrServerlessService } from './emrServerlessClient';
import { getProfileDefaultRegion, syncRegionFromProfile } from './region';

export interface AwsProfileInfo {
  name: string;
  region?: string;
}

export async function listAwsProfiles(): Promise<AwsProfileInfo[]> {
  const { configFile, credentialsFile } = await loadSharedConfigFiles();
  const names = new Set<string>([
    ...Object.keys(configFile),
    ...Object.keys(credentialsFile),
  ]);
  if (names.size === 0) {
    names.add('default');
  }

  const profiles = [...names].map((name) => ({
    name,
    region: configFile[name]?.region,
  }));

  profiles.sort((a, b) => {
    if (a.name === 'default') {
      return -1;
    }
    if (b.name === 'default') {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });

  return profiles;
}

export async function getProfileDisplayLabel(): Promise<string> {
  const configured = getConfiguredAwsProfile();
  if (configured) {
    return configured;
  }
  const envProfile = process.env.AWS_PROFILE;
  if (envProfile) {
    return `auto:${envProfile}`;
  }
  const autoProfile = getResolvedAutoProfile();
  if (autoProfile) {
    return `auto:${autoProfile}`;
  }
  return 'auto:default';
}

type ProfilePickItem = vscode.QuickPickItem & {
  profile: string | undefined;
};

export async function promptAwsProfileSelection(): Promise<boolean> {
  const profiles = await listAwsProfiles();
  const current = getConfiguredAwsProfile();

  const autoDetail = process.env.AWS_PROFILE
    ? `Uses AWS_PROFILE=${process.env.AWS_PROFILE} and the default credential chain`
    : 'Uses the default AWS credential provider chain (~/.aws/credentials, env vars)';

  const items: ProfilePickItem[] = [
    {
      profile: undefined,
      label: '$(law) Auto (environment)',
      description: process.env.AWS_PROFILE ?? 'default chain',
      detail: autoDetail,
      picked: current === undefined,
    },
    ...profiles.map((p) => ({
      profile: p.name,
      label: p.name,
      description: p.region ?? 'no region in ~/.aws/config',
      detail: p.region
        ? `Profile ${p.name} — region ${p.region}`
        : `Profile ${p.name} — set region in ~/.aws/config`,
      picked: p.name === current,
    })),
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select AWS profile',
    placeHolder: `Current: ${current ?? 'auto (environment)'}`,
  });
  if (picked === undefined) {
    return false;
  }

  const nextProfile = picked.profile;
  if (nextProfile === current) {
    return false;
  }

  await getExtensionConfig().update(
    'awsProfile',
    nextProfile ?? '',
    vscode.ConfigurationTarget.Global
  );
  return true;
}

export async function applyAwsProfileChange(
  onRefresh: () => void | Promise<void>
): Promise<void> {
  await syncRegionFromProfile();
  resetAwsClients();
  resetEmrServerlessService();

  try {
    const profile = getEffectiveAwsProfile();
    const region = await getProfileDefaultRegion(profile);
    const label = getConfiguredAwsProfile() ?? `auto (${process.env.AWS_PROFILE ?? 'default'})`;
    void vscode.window.showInformationMessage(
      region
        ? `AWS profile set to ${label} (${region}).`
        : `AWS profile set to ${label}.`
    );
  } catch {
    // Profile list is best-effort for the toast message.
  }

  await onRefresh();
}
