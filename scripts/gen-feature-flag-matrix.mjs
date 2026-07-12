#!/usr/bin/env node
/**
 * Generate the RCA-24 feature flag environment matrix.
 *
 * Source of truth:
 *   - packages/lib/src/flags/registries/*.ts declare flag names.
 *   - packages/lib/src/flags/defaults.ts declares the known default posture.
 *
 * The generated matrix is intentionally deterministic and environment-neutral:
 * staging/production intent mirrors the committed default until a reviewed
 * rollout explicitly changes it and records evidence.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const REGISTRY_ROOT = join(REPO_ROOT, 'packages', 'lib', 'src', 'flags', 'registries');
const DEFAULTS_PATH = join(REPO_ROOT, 'packages', 'lib', 'src', 'flags', 'defaults.ts');
const OVERRIDES_PATH = join(REPO_ROOT, 'scripts', 'feature-flag-matrix.overrides.json');
const OUT_PATH = join(REPO_ROOT, 'scripts', 'feature-flag-matrix.json');

function registryFiles() {
  return readdirSync(REGISTRY_ROOT)
    .map((name) => join(REGISTRY_ROOT, name))
    .filter((file) => statSync(file).isFile() && file.endsWith('.ts'))
    .sort();
}

function parseRegistries() {
  const constants = new Map();
  for (const file of registryFiles()) {
    const source = readFileSync(file, 'utf8');
    const objectRe = /export const ([A-Z0-9_]+)\s*=\s*\{([\s\S]*?)\}\s+as const;/g;
    let objectMatch;
    while ((objectMatch = objectRe.exec(source)) !== null) {
      const objectName = objectMatch[1];
      const body = objectMatch[2];
      const propRe = /([A-Z0-9_]+)\s*:\s*'([^']+)'/g;
      let propMatch;
      while ((propMatch = propRe.exec(body)) !== null) {
        constants.set(`${objectName}.${propMatch[1]}`, {
          name: propMatch[2],
          source: relative(REPO_ROOT, file).replace(/\\/g, '/'),
          registry: basename(file, '.ts'),
        });
      }
    }
  }
  return constants;
}

function parseDefaults(registryConstants) {
  const source = readFileSync(DEFAULTS_PATH, 'utf8');
  const entryRe = /\[([A-Z0-9_]+\.[A-Z0-9_]+)\]\s*:\s*(true|false)\s*,?\s*(?:\/\/\s*(.*))?/g;
  const entries = [];
  let match;
  while ((match = entryRe.exec(source)) !== null) {
    const key = match[1];
    const resolved = registryConstants.get(key);
    if (!resolved) {
      throw new Error(`FLAG_DEFAULTS references unknown registry constant: ${key}`);
    }
    const defaultEnabled = match[2] === 'true';
    const comment = (match[3] ?? '').trim();
    entries.push({
      name: resolved.name,
      defaultEnabled,
      stagingEnabled: defaultEnabled,
      productionEnabled: defaultEnabled,
      owner: ownerFor(resolved.registry),
      rationale: rationaleFor(defaultEnabled, comment),
      source: resolved.source,
      ...(defaultEnabled
        ? { enablementEvidence: comment || 'FLAG_DEFAULTS intentionally enables this flag.' }
        : {}),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function validateOverrideRolloutPercentage(override) {
  if (!Object.hasOwn(override, 'rolloutPercentage')) return undefined;
  const rolloutPercentage = override.rolloutPercentage;
  if (
    typeof rolloutPercentage !== 'number'
    || !Number.isInteger(rolloutPercentage)
    || rolloutPercentage < 0
    || rolloutPercentage > 100
  ) {
    throw new Error(
      `Invalid rolloutPercentage for ${override.name ?? '<unnamed flag>'}: expected an integer between 0 and 100, received ${String(rolloutPercentage)}.`,
    );
  }

  const enabledSomewhere = Boolean(override.stagingEnabled) || Boolean(override.productionEnabled);
  if (enabledSomewhere && rolloutPercentage === 0) {
    throw new Error(
      `Invalid rolloutPercentage for ${override.name ?? '<unnamed flag>'}: an enabled environment requires a value between 1 and 100.`,
    );
  }
  if (!enabledSomewhere && rolloutPercentage !== 0) {
    throw new Error(
      `Invalid rolloutPercentage for ${override.name ?? '<unnamed flag>'}: a flag disabled in every environment must declare 0.`,
    );
  }
  return rolloutPercentage;
}

export function mergeFeatureFlagMatrixOverrides(entries, overrides) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));

  for (const override of overrides.flags ?? []) {
    const rolloutPercentage = validateOverrideRolloutPercentage(override);
    const current = byName.get(override.name);
    const merged = {
      ...(current ?? {
        name: override.name,
        defaultEnabled: Boolean(override.defaultEnabled),
      }),
      stagingEnabled: Boolean(override.stagingEnabled),
      productionEnabled: Boolean(override.productionEnabled),
      owner: override.owner,
      rationale: override.rationale,
      source: 'scripts/feature-flag-matrix.overrides.json',
      ...(override.productionEnabled || override.stagingEnabled
        ? { enablementEvidence: override.enablementEvidence }
        : {}),
      ...(rolloutPercentage !== undefined
        ? { rolloutPercentage }
        : {}),
    };
    byName.set(override.name, merged);
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parseOverrides(entries) {
  if (!existsSync(OVERRIDES_PATH)) return entries;
  const overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));
  return mergeFeatureFlagMatrixOverrides(entries, overrides);
}

function ownerFor(registry) {
  const owners = {
    consumer: 'consumer-experience',
    foxy: 'ai-learning-backend',
    payment: 'billing-backend',
    pedagogy: 'learning-platform',
    platform: 'platform-ops',
    school: 'school-admin-backend',
    teacher: 'teacher-backend',
  };
  return owners[registry] ?? 'core-backend';
}

function rationaleFor(defaultEnabled, comment) {
  if (defaultEnabled) {
    return `Intended ON according to FLAG_DEFAULTS${comment ? ` (${comment})` : ''}.`;
  }
  return `Default OFF until an operator or reviewed rollout enables it${comment ? ` (${comment})` : ''}.`;
}

function main() {
  if (!existsSync(REGISTRY_ROOT)) throw new Error(`missing registry root: ${REGISTRY_ROOT}`);
  if (!existsSync(DEFAULTS_PATH)) throw new Error(`missing defaults file: ${DEFAULTS_PATH}`);

  const constants = parseRegistries();
  const flags = parseOverrides(parseDefaults(constants));
  mkdirSync(join(REPO_ROOT, 'scripts'), { recursive: true });
  writeFileSync(
    OUT_PATH,
    JSON.stringify(
      {
        source: 'packages/lib/src/flags/defaults.ts',
        registryRoot: 'packages/lib/src/flags/registries',
        flagCount: flags.length,
        flags,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  process.stdout.write(`feature flag matrix generated with ${flags.length} flags -> ${relative(REPO_ROOT, OUT_PATH)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
