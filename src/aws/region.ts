import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import * as vscode from 'vscode';
import { getConfiguredAwsRegion, getExtensionConfig } from './config';
import { getEffectiveAwsProfile, resetAwsClients } from './credentials';
import { resetEmrServerlessService } from './emrServerlessClient';
import { AWS_REGIONS } from './regions';

export async function getProfileDefaultRegion(profile?: string): Promise<string | undefined> {
  const effectiveProfile = profile ?? getEffectiveAwsProfile();
  const { configFile } = await loadSharedConfigFiles();
  const profileRegion = configFile[effectiveProfile]?.region;
  if (profileRegion) {
    return profileRegion;
  }
  return process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
}

export async function syncRegionFromProfile(profile?: string): Promise<void> {
  const region = await getProfileDefaultRegion(profile);
  if (!region) {
    return;
  }
  const current = getConfiguredAwsRegion();
  if (current === region) {
    return;
  }
  await getExtensionConfig().update(
    'awsRegion',
    region,
    vscode.ConfigurationTarget.Global
  );
}

type RegionPickItem = vscode.QuickPickItem & {
  region: string | undefined;
  custom?: boolean;
};

export async function promptAwsRegionSelection(): Promise<boolean> {
  const current = getConfiguredAwsRegion();
  const profileDefault = await getProfileDefaultRegion();

  const items: RegionPickItem[] = [
    {
      region: undefined,
      label: '$(law) Auto (from AWS profile)',
      description: profileDefault ?? 'uses AWS_REGION or ~/.aws/config',
      detail: profileDefault
        ? `Falls back to ${profileDefault} for the current profile`
        : 'Set region in ~/.aws/config or AWS_REGION',
      picked: current === undefined,
    },
    ...AWS_REGIONS.map((name) => ({
      region: name,
      label: name,
      description: profileDefault === name ? 'profile default' : undefined,
      picked: current === name,
    })),
    {
      region: undefined,
      custom: true,
      label: '$(edit) Enter custom region…',
      description: 'Type any AWS region code',
    },
  ];

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Select AWS region',
    placeHolder: `Current: ${current ?? profileDefault ?? 'auto (from profile)'}`,
  });
  if (picked === undefined) {
    return false;
  }

  if (picked.custom) {
    const custom = await vscode.window.showInputBox({
      title: 'AWS region',
      placeHolder: 'e.g. us-east-1',
      value: current ?? profileDefault ?? '',
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Region is required';
        }
        if (!/^[a-z]{2}(-gov)?-[a-z]+-\d+$/.test(trimmed)) {
          return 'Enter a valid AWS region code (e.g. us-east-1)';
        }
        return undefined;
      },
    });
    if (custom === undefined) {
      return false;
    }
    const next = custom.trim();
    if (next === current) {
      return false;
    }
    await getExtensionConfig().update(
      'awsRegion',
      next,
      vscode.ConfigurationTarget.Global
    );
    return true;
  }

  const nextRegion = picked.region;
  if (nextRegion === current) {
    return false;
  }

  await getExtensionConfig().update(
    'awsRegion',
    nextRegion ?? '',
    vscode.ConfigurationTarget.Global
  );
  return true;
}

export async function applyAwsRegionChange(
  onRefresh: () => void | Promise<void>
): Promise<void> {
  resetAwsClients();
  resetEmrServerlessService();

  const configured = getConfiguredAwsRegion();
  const profileDefault = await getProfileDefaultRegion();
  const label = configured ?? profileDefault ?? 'auto';
  void vscode.window.showInformationMessage(`AWS region set to ${label}.`);

  await onRefresh();
}
