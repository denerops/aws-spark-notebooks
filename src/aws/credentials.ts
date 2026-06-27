import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';
import type { AwsCredentialIdentityProvider } from '@smithy/types';
import { getConfiguredAwsProfile } from './config';

let credentialProvider: AwsCredentialIdentityProvider | undefined;
let cachedRegion: string | undefined;
let cachedRegionProfile: string | undefined;
let activeCredentialProfile: string | undefined;

export function getEffectiveAwsProfile(): string {
  return getConfiguredAwsProfile() ?? process.env.AWS_PROFILE ?? 'default';
}

export function getCredentialProvider(): AwsCredentialIdentityProvider {
  const configuredProfile = getConfiguredAwsProfile();
  if (!credentialProvider || activeCredentialProfile !== configuredProfile) {
    credentialProvider = configuredProfile
      ? fromIni({ profile: configuredProfile })
      : fromNodeProviderChain();
    activeCredentialProfile = configuredProfile;
  }
  return credentialProvider;
}

export async function getDefaultRegion(): Promise<string> {
  const profile = getEffectiveAwsProfile();
  if (cachedRegion && cachedRegionProfile === profile) {
    return cachedRegion;
  }

  const envRegion = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (envRegion && !getConfiguredAwsProfile()) {
    cachedRegion = envRegion;
    cachedRegionProfile = profile;
    return cachedRegion;
  }

  const { configFile } = await loadSharedConfigFiles();
  const section = configFile[profile];
  const region = section?.region;
  if (region) {
    cachedRegion = region;
    cachedRegionProfile = profile;
    return cachedRegion;
  }

  if (envRegion) {
    cachedRegion = envRegion;
    cachedRegionProfile = profile;
    return cachedRegion;
  }

  throw new Error(
    `No AWS region found for profile "${profile}". Set AWS_REGION or add region to ~/.aws/config.`
  );
}

export function resetAwsClients(): void {
  credentialProvider = undefined;
  cachedRegion = undefined;
  cachedRegionProfile = undefined;
  activeCredentialProfile = undefined;
}

/** @deprecated use resetAwsClients */
export function clearAwsCache(): void {
  resetAwsClients();
}
