const PACKAGE_SPEC_PATTERN = /^[^\s,;&|`$()]+$/;
export const SPARK_JARS_PACKAGES_KEY = 'spark.jars.packages';

export function normalizeSparkPackages(packages?: string[]): string[] {
  if (!packages?.length) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const pkg of packages) {
    const spec = typeof pkg === 'string' ? pkg.trim() : '';
    if (!spec || seen.has(spec)) {
      continue;
    }
    seen.add(spec);
    normalized.push(spec);
  }
  return normalized;
}

export function assertValidSparkPackageSpecs(packages: string[]): void {
  const invalid = packages.filter((spec) => !PACKAGE_SPEC_PATTERN.test(spec));
  if (invalid.length > 0) {
    throw new Error(`Invalid Spark package spec(s): ${invalid.join(', ')}`);
  }
}

export function isValidSparkPackageSpec(spec: string): boolean {
  return PACKAGE_SPEC_PATTERN.test(spec.trim());
}

/** Merge preset Spark packages into session conf as spark.jars.packages. */
export function applySparkPackagesToConf(
  conf: Record<string, string>,
  packages?: string[]
): void {
  const normalized = normalizeSparkPackages(packages);
  const existingRaw = conf[SPARK_JARS_PACKAGES_KEY]?.trim();
  const existing = existingRaw
    ? existingRaw
        .split(',')
        .map((spec) => spec.trim())
        .filter(Boolean)
    : [];
  const merged = normalizeSparkPackages([...existing, ...normalized]);
  if (merged.length === 0) {
    return;
  }
  conf[SPARK_JARS_PACKAGES_KEY] = merged.join(',');
}
