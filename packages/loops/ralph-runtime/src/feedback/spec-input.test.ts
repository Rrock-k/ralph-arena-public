import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readAcceptedArtifactFeedbackContext, readSpecInputManifest } from './spec-input.js';

function createWorkDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeManifest(workDir: string, manifest: unknown): void {
  mkdirSync(path.join(workDir, '.arena'), { recursive: true });
  writeFileSync(path.join(workDir, '.arena', 'spec-input.json'), JSON.stringify(manifest), 'utf-8');
}

function validAcceptedArtifact(artifact: any): any {
  const sourceRef = artifact.source?.id ?? 'SRC-001';
  return {
    secretRequirements: [],
    assets: [],
    ...artifact,
    acceptedSpec: {
      contentHash: `sha256:${'a'.repeat(64)}`,
      sourceRefs: [sourceRef],
      ...artifact.acceptedSpec,
      document: {
        specSchemaVersion: 'ra-287.spec-document.v1',
        title: 'Spec',
        sections: [],
        requirements: [],
        extensionBlocks: [],
        ...artifact.acceptedSpec?.document,
      },
    },
    acceptedDiff: {
      summary: 'Accepted diff',
      ...artifact.acceptedDiff,
      items: (artifact.acceptedDiff?.items ?? []).map((item: any) => ({
        summary: 'Accepted diff item',
        sourceRefs: [sourceRef],
        ...item,
      })),
    },
    feedback: (artifact.feedback ?? []).map((item: any) => ({
      reopenCount: 0,
      defaultClosurePolicy: 'loop_claim_is_enough_until_reopened',
      sourceRefs: [sourceRef],
      ...item,
    })),
    assumptions: (artifact.assumptions ?? []).map((item: any) => ({
      sourceRefs: [sourceRef],
      ...item,
    })),
  };
}

function backlogArtifact(
  sourceVersion: number,
  workImpact: 'requires_loop_work' | 'context_only' | 'no_loop_work' = 'requires_loop_work',
  baseSpecVersion: number | undefined = sourceVersion - 1,
): any {
  const suffix = String(sourceVersion).padStart(3, '0');
  const minute = String(sourceVersion % 60).padStart(2, '0');
  return validAcceptedArtifact({
    artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
    artifactId: `SPEC-${suffix}`,
    acceptedAt: `2026-07-02T10:${minute}:00.000Z`,
    source: {
      id: `SRC-${suffix}`,
      sourceSystem: 'tg-spec',
      sourceProjectId: 'tg-proj-1',
      sourceVersion,
      sourceRefType: 'accepted_spec',
      sourceId: `tg-spec-version-${sourceVersion}`,
    },
    acceptedSpec: {
      id: `SPEC-${suffix}`,
      version: sourceVersion,
    },
    acceptedDiff: {
      id: `DIFF-${suffix}`,
      ...(baseSpecVersion != null ? { baseSpecVersion } : {}),
      targetSpecVersion: sourceVersion,
      summary: `Spec update ${sourceVersion}`,
      items: [{
        id: `DIFF-${suffix}-001`,
        targetType: 'spec',
        targetId: `REQ-${suffix}`,
        changeType: 'updated',
        workImpact,
        summary: `Spec work ${sourceVersion}`,
        sourceRefs: [`SRC-${suffix}`],
      }],
    },
  });
}

function legacyOperatorRepairArtifact(sourceVersion: number): any {
  const suffix = String(sourceVersion).padStart(3, '0');
  return validAcceptedArtifact({
    artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
    artifactId: `OPREPAIR:LEGACY-${suffix}`,
    acceptedAt: `2026-07-02T09:${String(sourceVersion % 60).padStart(2, '0')}:00.000Z`,
    source: {
      id: `SRC-OPREPAIR-${suffix}`,
      sourceSystem: 'tg-spec',
      sourceProjectId: 'tg-proj-1',
      sourceVersion,
      sourceRefType: 'accepted_spec',
      sourceId: `tg-spec-version-${sourceVersion}`,
    },
    acceptedSpec: {
      id: `SPEC-OPREPAIR-${suffix}`,
      version: sourceVersion,
    },
    acceptedDiff: {
      id: `DIFF-OPREPAIR-${suffix}`,
      targetSpecVersion: sourceVersion,
      summary: 'Legacy accepted markdown was materialized as an operator repair baseline.',
      items: [{
        id: `DIFF-OPREPAIR-${suffix}-001`,
        targetType: 'spec',
        targetId: `REQ-OPREPAIR-${suffix}`,
        changeType: 'accepted',
        workImpact: 'no_loop_work',
        summary: 'Legacy baseline anchor only.',
        sourceRefs: [`SRC-OPREPAIR-${suffix}`],
      }],
    },
  });
}

test('reads acceptedArtifact metadata as the feedback contract', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-v3',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash',
        inputHash: 'input-hash-v3',
        currentVersion: {
          id: 'spec-version-3',
          version: 3,
        },
        metadataHash: 'sha256:artifact',
        acceptedArtifact: validAcceptedArtifact({
          artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
          artifactId: 'SPEC-001',
          acceptedAt: '2026-05-16T12:00:00Z',
          source: {
            id: 'SRC-001',
            sourceSystem: 'tg-spec',
            sourceProjectId: 'tg-proj-1',
            sourceVersion: 9,
            sourceRefType: 'accepted_spec',
            sourceId: 'tg-spec-version-9',
          },
          acceptedSpec: {
            id: 'SPEC-001',
            version: 9,
          },
          acceptedDiff: {
            id: 'DIFF-009',
            baseSpecVersion: 8,
            targetSpecVersion: 9,
            summary: 'BUG-005 reopened',
            items: [{
              id: 'DIFF-009-001',
              targetType: 'feedback',
              targetId: 'BUG-005',
              changeType: 'reopened',
              workImpact: 'requires_loop_work',
              workSurface: 'frontend',
              summary: 'Users still see too many customers.',
              sourceRefs: ['SRC-001'],
              sourceEvidence: [{
                sourceRef: 'SRC-001',
                quote: 'кнопку Play не текстом, а той же play-иконкой',
                intent: 'Play is an icon button; visible Play/play text must not remain.',
              }],
            }, {
              id: 'DIFF-009-002',
              targetType: 'spec',
              targetId: 'REQ-HTML',
              changeType: 'updated',
              workImpact: 'requires_loop_work',
              workSurface: 'frontend',
              summary: 'Game must use HTML elements, not canvas.',
              sourceRefs: ['SRC-001'],
            }],
          },
          feedback: [{
            id: 'BUG-005',
            title: 'Queue readability',
            body: 'Users still see too many customers.',
            state: 'reopened',
            reopenCount: 2,
          }],
        }),
      }],
    });

    const context = await readAcceptedArtifactFeedbackContext(workDir);

    assert.equal(context?.specChangeSource.kind, 'accepted_artifact');
    assert.equal(context?.specChangeSource.projectId, 'tg-proj-1');
    assert.equal(context?.specChangeSource.version, 9);
    assert.equal(context?.specChangeSource.baseVersion, 8);
    assert.deepEqual(context?.requiredItems.map((item) => ({
      itemId: item.itemId,
      diffItemId: item.diffItemId,
      targetType: item.targetType,
      targetId: item.targetId,
      workImpact: item.workImpact,
      workSurface: item.workSurface,
      status: item.status,
      summary: item.summary,
    })), [{
      itemId: 'DIFF-009-001',
      diffItemId: 'DIFF-009-001',
      targetType: 'feedback',
      targetId: 'BUG-005',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'reopened#2',
      summary: 'Users still see too many customers. | Queue readability',
    }, {
      itemId: 'DIFF-009-002',
      diffItemId: 'DIFF-009-002',
      targetType: 'spec',
      targetId: 'REQ-HTML',
      workImpact: 'requires_loop_work',
      workSurface: 'frontend',
      status: 'updated',
      summary: 'Game must use HTML elements, not canvas.',
    }]);
    assert.deepEqual(context?.requiredItems[0]?.sourceEvidence, [{
      sourceRef: 'SRC-001',
      quote: 'кнопку Play не текстом, а той же play-иконкой',
      intent: 'Play is an icon button; visible Play/play text must not remain.',
    }]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('keeps required item fingerprint stable across transport hash changes', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-fingerprint-');
  const artifact = validAcceptedArtifact({
    artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
    artifactId: 'SPEC-001',
    acceptedAt: '2026-05-16T12:00:00Z',
    source: {
      id: 'SRC-001',
      sourceSystem: 'tg-spec',
      sourceProjectId: 'tg-proj-1',
      sourceVersion: 9,
      sourceRefType: 'accepted_spec',
      sourceId: 'tg-spec-version-9',
    },
    acceptedSpec: {
      id: 'SPEC-001',
      version: 9,
    },
    acceptedDiff: {
      id: 'DIFF-009',
      baseSpecVersion: 8,
      targetSpecVersion: 9,
      summary: 'BUG-005 reopened',
      items: [{
        id: 'DIFF-009-001',
        targetType: 'feedback',
        targetId: 'BUG-005',
        changeType: 'reopened',
        workImpact: 'requires_loop_work',
        workSurface: 'frontend',
        summary: 'Users still see too many customers.',
        sourceRefs: ['SRC-001'],
      }],
    },
    feedback: [{
      id: 'BUG-005',
      title: 'Queue readability',
      body: 'Users still see too many customers.',
      state: 'reopened',
      reopenCount: 2,
    }],
  });

  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-v3',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash-v3',
        inputHash: 'input-hash-v3',
        metadataHash: 'sha256:artifact-v3',
        acceptedArtifact: artifact,
      }],
    });
    const first = await readAcceptedArtifactFeedbackContext(workDir);

    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-v4',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash-v4',
        inputHash: 'input-hash-v4',
        metadataHash: 'sha256:artifact-v4',
        acceptedArtifact: artifact,
      }],
    });
    const second = await readAcceptedArtifactFeedbackContext(workDir);

    assert.ok(first?.requiredItems[0]?.fingerprint);
    assert.equal(second?.requiredItems[0]?.fingerprint, first.requiredItems[0].fingerprint);
    assert.equal(second?.specChangeSource.artifactHash, 'sha256:artifact-v4');
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('reads acceptedArtifactBacklog as an ordered required work packet', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-backlog-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-sushi',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash',
        inputHash: 'input-hash-sushi',
        currentVersion: {
          id: 'spec-version-66',
          version: 66,
        },
        metadataHash: 'sha256:metadata-66',
        acceptedArtifact: backlogArtifact(66),
        acceptedArtifactBacklog: [63, 64, 65, 66].map((sourceVersion) => ({
          currentVersion: {
            id: `spec-version-${sourceVersion}`,
            version: sourceVersion,
          },
          source: {
            system: 'tg-spec',
            projectId: 'tg-proj-1',
            version: sourceVersion,
          },
          metadataHash: `sha256:metadata-${sourceVersion}`,
          acceptedArtifact: backlogArtifact(
            sourceVersion,
            sourceVersion === 65 ? 'context_only' : 'requires_loop_work',
          ),
        })),
      }],
    });

    const context = await readAcceptedArtifactFeedbackContext(workDir);

    assert.equal(context?.specChangeSource.kind, 'accepted_artifact');
    assert.equal(context?.specChangeSource.version, 66);
    assert.deepEqual(context?.specChangeSource.coveredSourceVersions, [63, 64, 66]);
    assert.equal(context?.specChangeSource.itemCount, 3);
    assert.deepEqual(context?.requiredItems.map((item) => ({
      itemId: item.itemId,
      sourceVersion: item.specChangeSource?.version,
      specVersionId: item.specChangeSource?.specVersionId,
      artifactHash: item.specChangeSource?.artifactHash,
    })), [{
      itemId: 'DIFF-063-001',
      sourceVersion: 63,
      specVersionId: 'spec-version-63',
      artifactHash: 'sha256:metadata-63',
    }, {
      itemId: 'DIFF-064-001',
      sourceVersion: 64,
      specVersionId: 'spec-version-64',
      artifactHash: 'sha256:metadata-64',
    }, {
      itemId: 'DIFF-066-001',
      sourceVersion: 66,
      specVersionId: 'spec-version-66',
      artifactHash: 'sha256:metadata-66',
    }]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('fails closed when acceptedArtifactBacklog has a represented source-version gap', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-backlog-gap-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-gap',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash',
        acceptedArtifactBacklog: [63, 65].map((sourceVersion) => ({
          currentVersion: {
            id: `spec-version-${sourceVersion}`,
            version: sourceVersion,
          },
          source: {
            system: 'tg-spec',
            projectId: 'tg-proj-1',
            version: sourceVersion,
          },
          metadataHash: `sha256:metadata-${sourceVersion}`,
          acceptedArtifact: backlogArtifact(sourceVersion),
        })),
      }],
    });

    await assert.rejects(
      () => readAcceptedArtifactFeedbackContext(workDir),
      /acceptedArtifactBacklog has source version gap before 65: baseSpecVersion 64 is newer than previous represented sourceVersion 63/,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('allows legacy operator repair artifact as the acceptedArtifactBacklog cutover anchor', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-backlog-oprepair-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-oprepair',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash',
        acceptedArtifactBacklog: [{
          currentVersion: {
            id: 'spec-version-30',
            version: 15,
          },
          source: {
            system: 'tg-spec',
            projectId: 'tg-proj-1',
            version: 30,
          },
          metadataHash: 'sha256:metadata-30',
          acceptedArtifact: legacyOperatorRepairArtifact(30),
        }, {
          currentVersion: {
            id: 'spec-version-37',
            version: 16,
          },
          source: {
            system: 'tg-spec',
            projectId: 'tg-proj-1',
            version: 37,
          },
          metadataHash: 'sha256:metadata-37',
          acceptedArtifact: backlogArtifact(37, 'requires_loop_work', 35),
        }, {
          currentVersion: {
            id: 'spec-version-40',
            version: 17,
          },
          source: {
            system: 'tg-spec',
            projectId: 'tg-proj-1',
            version: 40,
          },
          metadataHash: 'sha256:metadata-40',
          acceptedArtifact: backlogArtifact(40, 'requires_loop_work', 37),
        }],
      }],
    });

    const context = await readAcceptedArtifactFeedbackContext(workDir);

    assert.deepEqual(
      context?.requiredItems.map((item) => item.specChangeSource?.version),
      [37, 40],
    );
    assert.deepEqual(context?.specChangeSource.coveredSourceVersions, [37, 40]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('reads accepted assumption diffs as work-required artifact input', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-assumption-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-v4',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash',
        inputHash: 'input-hash-v4',
        currentVersion: {
          id: 'spec-version-4',
          version: 4,
        },
        metadataHash: 'sha256:artifact-assumption',
        acceptedArtifact: validAcceptedArtifact({
          artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
          artifactId: 'SPEC-001',
          acceptedAt: '2026-05-22T12:00:00Z',
          source: {
            id: 'SRC-001',
            sourceSystem: 'tg-spec',
            sourceProjectId: 'tg-proj-1',
            sourceVersion: 10,
            sourceRefType: 'accepted_spec',
            sourceId: 'tg-spec-version-10',
          },
          acceptedSpec: {
            id: 'SPEC-001',
            version: 10,
          },
          acceptedDiff: {
            id: 'DIFF-010',
            baseSpecVersion: 9,
            targetSpecVersion: 10,
            summary: 'Assumption disputed',
            items: [{
              id: 'DIFF-010-ASM-001',
              targetType: 'assumption',
              targetId: 'ASM-RALPH-BUG-005',
              changeType: 'disputed',
              workImpact: 'requires_loop_work',
              summary: 'Queue size is not fixed: Users disputed Ralph assumption that BUG-005 was already handled.',
              sourceRefs: ['SRC-001'],
            }],
          },
          assumptions: [{
            id: 'ASM-RALPH-BUG-005',
            title: 'Queue size is not fixed',
            statement: 'Users disputed Ralph assumption that BUG-005 was already handled.',
            state: 'disputed',
            sourceRefs: ['SRC-001'],
            outcome: {
              kind: 'disputed_not_spec',
              acceptedDiffItemId: 'DIFF-010-ASM-001',
            },
          }],
        }),
      }],
    });

    const context = await readAcceptedArtifactFeedbackContext(workDir);

    assert.deepEqual(context?.requiredItems.map((item) => ({
      itemId: item.itemId,
      diffItemId: item.diffItemId,
      targetType: item.targetType,
      targetId: item.targetId,
      status: item.status,
      summary: item.summary,
    })), [{
      itemId: 'DIFF-010-ASM-001',
      diffItemId: 'DIFF-010-ASM-001',
      targetType: 'assumption',
      targetId: 'ASM-RALPH-BUG-005',
      status: 'disputed',
      summary: 'Queue size is not fixed: Users disputed Ralph assumption that BUG-005 was already handled.',
    }]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('uses the newest required accepted artifact as the primary source', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-source-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-combined',
      specs: [{
        id: 'spec-main',
        slug: 'Evolution Spec',
        hash: 'main-hash',
        inputHash: 'main-input-hash',
        currentVersion: {
          id: 'main-version-4',
          version: 4,
        },
        metadataHash: 'sha256:main-artifact',
        acceptedArtifact: validAcceptedArtifact({
          artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
          artifactId: 'SPEC-MAIN',
          acceptedAt: '2026-05-28T18:38:51.889Z',
          source: {
            id: 'SRC-MAIN',
            sourceSystem: 'tg-spec',
            sourceProjectId: 'tg-proj-1',
            sourceVersion: 4,
            sourceRefType: 'accepted_spec',
            sourceId: 'tg-spec-version-4',
          },
          acceptedSpec: {
            id: 'SPEC-MAIN',
            version: 4,
          },
          acceptedDiff: {
            id: 'DIFF-MAIN',
            targetSpecVersion: 4,
            items: [{
              id: 'DIFF-MAIN-SPEC',
              targetType: 'spec',
              targetId: 'SPEC-MAIN',
              changeType: 'updated',
              workImpact: 'requires_loop_work',
              summary: 'Main accepted work.',
            }],
          },
        }),
      }, {
        id: 'spec-addon',
        slug: 'Addon: Telegram Mini App',
        hash: 'addon-hash',
        inputHash: 'addon-input-hash',
        currentVersion: {
          id: 'addon-version-1',
          version: 1,
        },
        metadataHash: 'sha256:addon-artifact',
        acceptedArtifact: validAcceptedArtifact({
          artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
          artifactId: 'SPEC-ADDON',
          acceptedAt: '2026-05-29T00:00:00.000Z',
          source: {
            id: 'SRC-ADDON',
            sourceSystem: 'arena',
            sourceVersion: 1,
            sourceRefType: 'operator_note',
            sourceId: 'project-addon:telegram_mini_app',
          },
          acceptedSpec: {
            id: 'SPEC-ADDON',
            version: 1,
          },
          acceptedDiff: {
            id: 'DIFF-ADDON',
            targetSpecVersion: 1,
            items: [{
              id: 'DIFF-ADDON-SPEC',
              targetType: 'spec',
              targetId: 'SPEC-ADDON',
              changeType: 'created',
              workImpact: 'requires_loop_work',
              summary: 'Addon accepted work.',
            }],
          },
        }),
      }],
    });

    const context = await readAcceptedArtifactFeedbackContext(workDir);

    assert.equal(context?.specChangeSource.system, 'arena');
    assert.equal(context?.specChangeSource.specVersionId, 'addon-version-1');
    assert.equal(context?.specChangeSource.artifactHash, 'sha256:addon-artifact');
    assert.deepEqual(context?.requiredItems.map((item) => item.itemId), [
      'DIFF-MAIN-SPEC',
      'DIFF-ADDON-SPEC',
    ]);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('fails loudly for malformed acceptedArtifact metadata', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-bad-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-v3',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
        hash: 'content-hash',
        acceptedArtifact: {
          artifactSchemaVersion: 'ra-287.accepted-spec-artifact.v1',
          acceptedDiff: {},
        },
      }],
    });

    await assert.rejects(
      () => readAcceptedArtifactFeedbackContext(workDir),
      /acceptedArtifact is malformed/,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('fails loudly when existing spec input manifest is malformed', async () => {
  const workDir = createWorkDir('ralph-spec-artifact-bad-manifest-');
  try {
    writeManifest(workDir, {
      schemaVersion: 1,
      aggregateHash: 'input-hash-v3',
      specs: [{
        id: 'spec-1',
        slug: 'Spec',
      }],
    });

    await assert.rejects(
      () => readSpecInputManifest(workDir),
      /Malformed \.arena\/spec-input\.json: specs\[0\]\.hash is required/,
    );
    await assert.rejects(
      () => readAcceptedArtifactFeedbackContext(workDir),
      /Malformed \.arena\/spec-input\.json: specs\[0\]\.hash is required/,
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
