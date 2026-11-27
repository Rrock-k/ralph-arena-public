import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import { parseAcceptedSpecArtifact } from '@arena/contracts';
import type { FeedbackSourceEvidence, SpecMigrationFeedbackItem, SpecMigrationSource } from '../config/types.js';

export const SPEC_INPUT_MANIFEST_PATH = '.arena/spec-input.json';

type JsonObject = Record<string, unknown>;

export interface SpecInputManifest {
  schemaVersion: 1;
  aggregateHash: string;
  specs: SpecInputManifestSpec[];
}

export interface SpecInputManifestSpec {
  id: string;
  slug: string;
  hash: string;
  inputHash?: string;
  currentVersion?: JsonObject;
  source?: JsonObject;
  acceptedArtifact?: JsonObject;
  acceptedArtifactBacklog?: SpecInputAcceptedArtifactBacklogEntry[];
  metadataHash?: string;
}

export interface SpecInputAcceptedArtifactBacklogEntry {
  currentVersion?: JsonObject;
  source?: JsonObject;
  acceptedArtifact: JsonObject;
  metadataHash?: string;
}

type ManifestAcceptedArtifactEntry = SpecInputAcceptedArtifactBacklogEntry & {
  spec: SpecInputManifestSpec;
};

export interface AcceptedArtifactFeedbackContext {
  specChangeSource: SpecMigrationSource;
  requiredItems: AcceptedArtifactFeedbackItem[];
  legacyOperatorRepairCutovers?: AcceptedArtifactLegacyOperatorRepairCutover[];
}

export type AcceptedArtifactFeedbackItem = SpecMigrationFeedbackItem & {
  specChangeSource?: SpecMigrationSource;
};

export interface AcceptedArtifactLegacyOperatorRepairCutover {
  system?: string;
  projectId?: string;
  sourceVersion: number;
}

export async function readSpecInputManifest(workDir: string): Promise<SpecInputManifest | null> {
  const manifestPath = path.join(workDir, SPEC_INPUT_MANIFEST_PATH);
  if (!await fs.pathExists(manifestPath)) return null;

  try {
    return normalizeManifest(await fs.readJson(manifestPath));
  } catch (err: any) {
    throw new Error(`Malformed ${SPEC_INPUT_MANIFEST_PATH}: ${err.message}`);
  }
}

export async function resolveSpecInputHash(
  workDir: string,
  specPath: string,
  fallbackContentHash: string,
): Promise<string> {
  if (path.resolve(specPath) !== path.resolve(workDir, 'spec.md')) {
    return fallbackContentHash;
  }

  const manifest = await readSpecInputManifest(workDir);
  if (!manifest || !manifestHasMetadata(manifest)) {
    return fallbackContentHash;
  }

  return `runner:${manifest.aggregateHash}`;
}

export async function hasMetadataAwareSpecInput(workDir: string): Promise<boolean> {
  const manifest = await readSpecInputManifest(workDir);
  return !!manifest && manifestHasMetadata(manifest);
}

export async function readAcceptedArtifactFeedbackContext(workDir: string): Promise<AcceptedArtifactFeedbackContext | null> {
  const manifest = await readSpecInputManifest(workDir);
  if (!manifest) return null;

  const artifactEntries = collectManifestAcceptedArtifactEntries(manifest);

  if (artifactEntries.length > 0) {
    const legacyOperatorRepairCutovers = collectLegacyOperatorRepairCutovers(artifactEntries);
    const requiredItems = artifactEntries.flatMap((entry) => {
      const artifact = entry.acceptedArtifact;
      const acceptedDiff = artifact.acceptedDiff as JsonObject;
      const feedbackById = buildArtifactFeedbackMap(artifact);
      const targetDetailsById = buildArtifactTargetDetailMap(artifact);
      const artifactRequiredItems = readArray(acceptedDiff.items)
        .filter(isArtifactDiffItem)
        .filter(artifactItemRequiresDisposition);
      const specChangeSource = buildSpecChangeSource(
        entry,
        artifact,
        artifactRequiredItems.length,
        manifest.aggregateHash,
      );

      return artifactRequiredItems
        .map((item) => toRequiredFeedbackItemFromArtifact(entry.spec, item, feedbackById, targetDetailsById, specChangeSource));
    });

    const primarySource = selectPrimarySpecChangeSource(requiredItems)
      ?? buildSpecChangeSource(
        artifactEntries[0],
        artifactEntries[0].acceptedArtifact,
        requiredItems.length,
        manifest.aggregateHash,
      );

    return {
      specChangeSource: {
        ...primarySource,
        itemCount: requiredItems.length,
      },
      requiredItems,
      ...(legacyOperatorRepairCutovers.length > 0 ? { legacyOperatorRepairCutovers } : {}),
    };
  }

  return null;
}

function normalizeManifest(value: unknown): SpecInputManifest {
  if (!isObject(value)) throw new Error('root must be an object');
  if (value.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  const aggregateHash = readString(value.aggregateHash);
  if (!aggregateHash) throw new Error('aggregateHash is required');
  if (!Array.isArray(value.specs)) throw new Error('specs must be an array');

  const specs = value.specs.map((entry, index) => {
    if (!isObject(entry)) throw new Error(`specs[${index}] must be an object`);
    const id = readString(entry.id);
    const slug = readString(entry.slug);
    const hash = readString(entry.hash);
    if (!id) throw new Error(`specs[${index}].id is required`);
    if (!slug) throw new Error(`specs[${index}].slug is required`);
    if (!hash) throw new Error(`specs[${index}].hash is required`);
    if (entry.currentVersion !== undefined && !isObject(entry.currentVersion)) {
      throw new Error(`specs[${index}].currentVersion must be an object`);
    }
    if (entry.source !== undefined && !isObject(entry.source)) {
      throw new Error(`specs[${index}].source must be an object`);
    }
    if (entry.acceptedArtifact !== undefined && !isObject(entry.acceptedArtifact)) {
      throw new Error(`specs[${index}].acceptedArtifact must be an object`);
    }
    if (entry.acceptedArtifactBacklog !== undefined && !Array.isArray(entry.acceptedArtifactBacklog)) {
      throw new Error(`specs[${index}].acceptedArtifactBacklog must be an array`);
    }

    const acceptedArtifactBacklog = Array.isArray(entry.acceptedArtifactBacklog)
      ? entry.acceptedArtifactBacklog.map((backlogEntry, backlogIndex) => (
        normalizeAcceptedArtifactBacklogEntry(backlogEntry, index, backlogIndex)
      ))
      : undefined;
    if (acceptedArtifactBacklog) {
      validateAcceptedArtifactBacklogContinuity(acceptedArtifactBacklog, index);
    }

    return {
      id,
      slug,
      hash,
      inputHash: readString(entry.inputHash),
      currentVersion: isObject(entry.currentVersion) ? entry.currentVersion : undefined,
      source: isObject(entry.source) ? entry.source : undefined,
      acceptedArtifact: isObject(entry.acceptedArtifact)
        ? normalizeAcceptedArtifact(entry.acceptedArtifact, index)
        : undefined,
      acceptedArtifactBacklog,
      metadataHash: readString(entry.metadataHash),
    };
  });

  return {
    schemaVersion: 1,
    aggregateHash,
    specs,
  };
}

function normalizeAcceptedArtifactBacklogEntry(
  value: unknown,
  specIndex: number,
  backlogIndex: number,
): SpecInputAcceptedArtifactBacklogEntry {
  if (!isObject(value)) {
    throw new Error(`specs[${specIndex}].acceptedArtifactBacklog[${backlogIndex}] must be an object`);
  }
  if (value.currentVersion !== undefined && !isObject(value.currentVersion)) {
    throw new Error(`specs[${specIndex}].acceptedArtifactBacklog[${backlogIndex}].currentVersion must be an object`);
  }
  if (value.source !== undefined && !isObject(value.source)) {
    throw new Error(`specs[${specIndex}].acceptedArtifactBacklog[${backlogIndex}].source must be an object`);
  }
  if (!isObject(value.acceptedArtifact)) {
    throw new Error(`specs[${specIndex}].acceptedArtifactBacklog[${backlogIndex}].acceptedArtifact must be an object`);
  }

  return {
    currentVersion: isObject(value.currentVersion) ? value.currentVersion : undefined,
    source: isObject(value.source) ? value.source : undefined,
    acceptedArtifact: normalizeAcceptedArtifact(
      value.acceptedArtifact,
      specIndex,
      `.acceptedArtifactBacklog[${backlogIndex}].acceptedArtifact`,
    ),
    metadataHash: readString(value.metadataHash),
  };
}

function normalizeAcceptedArtifact(value: JsonObject, index: number, field = '.acceptedArtifact'): JsonObject {
  try {
    parseAcceptedSpecArtifact(value);
    return value;
  } catch (err: any) {
    throw new Error(`specs[${index}]${field} is malformed: ${err.message}`);
  }
}

function validateAcceptedArtifactBacklogContinuity(
  entries: SpecInputAcceptedArtifactBacklogEntry[],
  specIndex: number,
): void {
  const groups = new Map<string, Array<{
    sourceVersion: number;
    baseVersion: number | null;
    legacyOperatorRepairAnchor: boolean;
  }>>();

  for (const entry of entries) {
    const source = isObject(entry.acceptedArtifact.source) ? entry.acceptedArtifact.source : {};
    const sourceSystem = readString(source.sourceSystem);
    const sourceProjectId = readString(source.sourceProjectId) ?? '';
    const sourceVersion = readNumber(source.sourceVersion) ?? readNumber(entry.source?.version);
    if (!sourceSystem || sourceVersion == null) continue;

    const acceptedDiff = entry.acceptedArtifact.acceptedDiff as JsonObject;
    const baseVersion = readNumber(acceptedDiff.baseSpecVersion) ?? null;
    const key = `${sourceSystem}:${sourceProjectId}`;
    const group = groups.get(key) ?? [];
    group.push({
      sourceVersion,
      baseVersion,
      legacyOperatorRepairAnchor: isLegacyOperatorRepairAnchor(entry.acceptedArtifact),
    });
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    group.sort((left, right) => left.sourceVersion - right.sourceVersion);
    for (let index = 1; index < group.length; index++) {
      const previous = group[index - 1];
      const current = group[index];
      // OPREPAIR artifacts are explicit legacy baseline materializations; the
      // next structured diff may legally point past the repaired source row.
      const crossesLegacyRepairBaseline = previous.legacyOperatorRepairAnchor && previous.baseVersion == null;
      if (current.baseVersion != null && current.baseVersion > previous.sourceVersion) {
        if (crossesLegacyRepairBaseline) continue;
        throw new Error(
          `specs[${specIndex}].acceptedArtifactBacklog has source version gap before ${current.sourceVersion}: `
          + `baseSpecVersion ${current.baseVersion} is newer than previous represented sourceVersion ${previous.sourceVersion}`,
        );
      }
    }
  }
}

function isLegacyOperatorRepairAnchor(artifact: JsonObject): boolean {
  const artifactId = readString(artifact.artifactId);
  return artifactId?.startsWith('OPREPAIR:') ?? false;
}

function collectManifestAcceptedArtifactEntries(manifest: SpecInputManifest): ManifestAcceptedArtifactEntry[] {
  return manifest.specs.flatMap((spec) => {
    if (spec.acceptedArtifactBacklog && spec.acceptedArtifactBacklog.length > 0) {
      return spec.acceptedArtifactBacklog.map((entry) => ({
        ...entry,
        spec,
      }));
    }
    if (!spec.acceptedArtifact) return [];
    return [{
      spec,
      currentVersion: spec.currentVersion,
      source: spec.source,
      acceptedArtifact: spec.acceptedArtifact,
      metadataHash: spec.metadataHash,
    }];
  });
}

function collectLegacyOperatorRepairCutovers(
  entries: ManifestAcceptedArtifactEntry[],
): AcceptedArtifactLegacyOperatorRepairCutover[] {
  return entries.flatMap((entry) => {
    const artifact = entry.acceptedArtifact;
    if (!isLegacyOperatorRepairAnchor(artifact)) return [];

    const source = isObject(artifact.source) ? artifact.source : {};
    const sourceVersion = readNumber(source.sourceVersion) ?? readNumber(entry.source?.version);
    if (sourceVersion == null) return [];

    return [{
      system: readString(source.sourceSystem),
      projectId: readString(source.sourceProjectId),
      sourceVersion,
    }];
  });
}

function manifestHasMetadata(manifest: SpecInputManifest): boolean {
  return manifest.specs.some((spec) => (
    !!spec.inputHash
      || !!spec.metadataHash
      || !!spec.acceptedArtifact
      || !!spec.acceptedArtifactBacklog
      || !!spec.source
  ));
}

function buildArtifactFeedbackMap(artifact: JsonObject): Map<string, JsonObject> {
  const feedback = readArray(artifact.feedback).filter(isObject);
  return new Map(feedback.flatMap((entry) => {
    const id = readString(entry.id);
    return id ? [[id, entry] as const] : [];
  }));
}

function buildArtifactTargetDetailMap(artifact: JsonObject): Map<string, string> {
  const details = new Map<string, string>();
  const acceptedSpec = isObject(artifact.acceptedSpec) ? artifact.acceptedSpec : {};
  const document = isObject(acceptedSpec.document) ? acceptedSpec.document : {};

  for (const requirement of readArray(document.requirements).filter(isObject)) {
    const id = readString(requirement.id);
    if (!id) continue;
    const title = readString(requirement.title);
    const statement = readString(requirement.statement);
    details.set(id, [title, statement].filter(Boolean).join(': '));
  }

  for (const assumption of readArray(artifact.assumptions).filter(isObject)) {
    const id = readString(assumption.id);
    if (!id) continue;
    const title = readString(assumption.title);
    const statement = readString(assumption.statement);
    details.set(id, [title, statement].filter(Boolean).join(': '));
  }

  for (const asset of readArray(artifact.assets).filter(isObject)) {
    const id = readString(asset.id);
    if (!id) continue;
    const label = readString(asset.label) ?? readString(asset.path) ?? readString(asset.kind);
    if (label) details.set(id, label);
  }

  for (const secret of readArray(artifact.secretRequirements).filter(isObject)) {
    const id = readString(secret.id);
    if (!id) continue;
    const label = readString(secret.label) ?? readString(secret.key) ?? readString(secret.purpose);
    if (label) details.set(id, label);
  }

  return details;
}

function buildSpecChangeSource(
  entry: ManifestAcceptedArtifactEntry,
  artifact: JsonObject,
  itemCount: number,
  fallbackArtifactHash: string,
): SpecMigrationSource {
  const source = isObject(artifact.source) ? artifact.source : {};
  const acceptedDiff = artifact.acceptedDiff as JsonObject;
  const acceptedSpec = isObject(artifact.acceptedSpec) ? artifact.acceptedSpec : {};
  const currentVersion = isObject(entry.currentVersion)
    ? entry.currentVersion
    : isObject(entry.spec.currentVersion)
      ? entry.spec.currentVersion
      : {};

  return {
    kind: 'accepted_artifact',
    system: readString(source.sourceSystem),
    projectId: readString(source.sourceProjectId),
    version: readNumber(source.sourceVersion),
    specVersionId: readString(currentVersion.id),
    specVersion: readNumber(currentVersion.version) ?? readNumber(acceptedSpec.version),
    baseVersion: readNumber(acceptedDiff.baseSpecVersion) ?? null,
    acceptedAt: readString(artifact.acceptedAt),
    artifactHash: entry.metadataHash ?? entry.spec.metadataHash ?? fallbackArtifactHash,
    itemCount,
  };
}

function selectPrimarySpecChangeSource(items: AcceptedArtifactFeedbackItem[]): SpecMigrationSource | undefined {
  let selected: SpecMigrationSource | undefined;
  let selectedTime = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const source = item.specChangeSource;
    if (!source) continue;

    const time = source.acceptedAt ? Date.parse(source.acceptedAt) : Number.NEGATIVE_INFINITY;
    if (!selected || time >= selectedTime) {
      selected = source;
      selectedTime = time;
    }
  }

  return selected ? withCoveredSourceVersions(selected, items) : undefined;
}

function withCoveredSourceVersions(
  source: SpecMigrationSource,
  items: AcceptedArtifactFeedbackItem[],
): SpecMigrationSource {
  const seen = new Set<string>();
  const coveredSourceVersions: Array<string | number> = [];

  for (const item of items) {
    const version = item.specChangeSource?.version;
    if (version == null) continue;
    const key = String(version);
    if (seen.has(key)) continue;
    seen.add(key);
    coveredSourceVersions.push(version);
  }

  return coveredSourceVersions.length > 1
    ? { ...source, coveredSourceVersions }
    : source;
}

function toRequiredFeedbackItemFromArtifact(
  spec: SpecInputManifestSpec,
  item: JsonObject,
  feedbackById: Map<string, JsonObject>,
  targetDetailsById: Map<string, string>,
  specChangeSource: SpecMigrationSource,
): AcceptedArtifactFeedbackItem {
  const diffItemId = readString(item.id);
  const targetType = readString(item.targetType);
  const targetId = readString(item.targetId);
  const itemId = diffItemId ?? targetId ?? 'UNKNOWN';
  const feedback = targetId ? feedbackById.get(targetId) : undefined;
  const changeType = readString(item.changeType) ?? 'updated';
  const workImpact = readString(item.workImpact);
  const workSurface = readString(item.workSurface);
  const targetDetail = targetId ? targetDetailsById.get(targetId) : undefined;
  const summary = uniqueStrings([
    readString(item.summary),
    feedback ? readString(feedback.body) : undefined,
    feedback ? readString(feedback.title) : undefined,
    targetDetail,
  ]).join(' | ') || itemId;
  const status = artifactFeedbackStatus(feedback, item);
  const sourceRefs = readArray(item.sourceRefs).filter((ref): ref is string => typeof ref === 'string');
  const sourceEvidence = readSourceEvidence(item.sourceEvidence);

  return {
    itemId,
    diffItemId,
    targetType,
    targetId,
    kind: targetType ? `accepted_diff:${targetType}` : 'accepted_diff',
    changeType,
    ...(workImpact ? { workImpact } : {}),
    ...(workSurface ? { workSurface } : {}),
    status,
    summary,
    sourceRefs,
    sourceEvidence,
    fingerprint: sha256Stable({
      specId: spec.id,
      itemId,
      diffItemId,
      targetType,
      targetId,
      changeType,
      workImpact,
      workSurface,
      status,
      summary,
      sourceRefs,
      sourceEvidence,
    }),
    specChangeSource,
  };
}

function artifactItemRequiresDisposition(item: JsonObject): boolean {
  return readString(item.workImpact) === 'requires_loop_work';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function readSourceEvidence(value: unknown): FeedbackSourceEvidence[] | undefined {
  const evidence = readArray(value)
    .filter(isObject)
    .map((entry) => {
      const sourceRef = readString(entry.sourceRef);
      const quote = readString(entry.quote);
      const intent = readString(entry.intent);
      if (!sourceRef || (!quote && !intent)) return null;
      return {
        sourceRef,
        ...(quote ? { quote } : {}),
        ...(intent ? { intent } : {}),
      };
    })
    .filter((entry): entry is FeedbackSourceEvidence => !!entry);

  return evidence.length > 0 ? evidence : undefined;
}

function artifactFeedbackStatus(feedback: JsonObject | undefined, item: JsonObject): string | null {
  const state = feedback ? readString(feedback.state) : undefined;
  if (state === 'reopened') {
    const reopenCount = feedback ? readNumber(feedback.reopenCount) : undefined;
    return typeof reopenCount === 'number' && reopenCount > 0 ? `reopened#${reopenCount}` : 'reopened#1';
  }
  if (state === 'handled') return 'handled';
  if (state === 'accepted_closed') return 'closed';
  if (state === 'open' || state === 'superseded') return state;

  const changeType = readString(item.changeType);
  if (changeType === 'reopened') return 'reopened#1';
  if (changeType === 'handled') return 'handled';
  if (changeType === 'closed') return 'closed';
  return changeType ?? null;
}

function isArtifactDiffItem(value: unknown): value is JsonObject {
  return isObject(value) && typeof value.targetId === 'string';
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sha256Stable(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isObject(value)) {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
