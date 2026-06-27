const PACKAGE_SPEC_PATTERN = /^[^\s;&|`$()]+$/;

export function normalizePythonPackages(packages?: string[]): string[] {
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

export function assertValidPythonPackageSpecs(packages: string[]): void {
  const invalid = packages.filter((spec) => !PACKAGE_SPEC_PATTERN.test(spec));
  if (invalid.length > 0) {
    throw new Error(`Invalid Python package spec(s): ${invalid.join(', ')}`);
  }
}

export function isValidPythonPackageSpec(spec: string): boolean {
  return PACKAGE_SPEC_PATTERN.test(spec.trim());
}
