# Accepted Spec Artifact Contract

This is the canonical platform contract for structured accepted product truth.

It defines the loop-neutral artifact that `tg-spec`, Arena, runner, Ralph and
future loops use to agree on accepted spec, accepted diff, feedback,
assumptions, safe secret refs, asset refs and provenance.

Implementation note: RA-287 accepts current imports only as
`AcceptedSpecArtifact`. Legacy v2 `acceptedDelta` / `ralphDirective` input is
not an active runtime adapter. During MVP, old rows may break and should be
re-imported, manually repaired or parked through the operator path instead of
kept alive through hidden compatibility.

Use with:

- [system-simplicity-contract.md](docs/contracts/system-simplicity-contract.md)
- [project-runtime-preview-business-contract.md](docs/contracts/project-runtime-preview-business-contract.md)
- [ralph-feedback-evidence-contract.md](docs/contracts/ralph-feedback-evidence-contract.md)
- [docs/loops/contract.md](docs/loops/contract.md)

## Goal

The platform needs one structured product-truth boundary.

This is the foundation for Arena's spec-driven development layer in an AI-first
product workflow. The spec is not just prompt context and not just a markdown
brief. It is the structured contract that product discussion, human feedback,
AI loop execution, verification, assumptions and future UX all converge on.

Without this contract, accepted spec semantics drift across:

- `tg-spec` producer payloads;
- Arena import metadata;
- runner `.arena/spec-input.json`;
- Ralph-specific parsers and planner prompts;
- user/manager UI projections.

This contract keeps that boundary loop-neutral. Ralph may consume it, but Ralph
does not own it.

It also makes the spec itself structured. Markdown is a rendering/legacy
representation, not the only product truth.

## Spec-driven Development Principles

- The accepted spec is product truth.
- The accepted diff is the focused command for the next loop run.
- Feedback and production evidence change product truth only when accepted into
  the spec artifact.
- Assumptions are loop-to-user proposals; they become product truth only through
  accepted spec/diff.
- Public task lists are read-side projections from feedback/diff and loop
  status. They are not first-class accepted artifact truth.
- Markdown is a rendering and compatibility format; structured spec fields are
  the durable API.
- Extension blocks are temporary pressure valves, not a parallel free-form spec
  system.
- Every consumer should be able to answer: which accepted product truth am I
  reading, and which private execution state am I producing?

## Boundary

Canonical boundary: `AcceptedSpecArtifact`.

It owns structured accepted product truth exchanged between spec producers,
Arena, runner and loops.

It does not own:

- runtime lifecycle;
- preview state;
- access policy;
- secret values;
- asset storage;
- loop execution memory;
- Ralph controller reports;
- UX delivery mechanics for polls, buttons or direct messages.

## Minimal Model

```text
Accepted Spec
Accepted Diff
Feedback / Bugs with resolved and reopened semantics
Assumptions with accept/correct/dispute back into spec
Secret requirement refs
Asset refs
Provenance refs
```

`Phases` are not a v1 artifact entity. If added later, they may only be
display-only grouping unless a separate contract deliberately adds lifecycle
meaning.

## Top-level Shape

Working code name: `AcceptedSpecArtifact`.

Product-facing words should be `approved spec`, `approved project brief` or
`what changed`, not `artifact`.

```ts
type AcceptedSpecArtifact = {
  artifactSchemaVersion: "ra-287.accepted-spec-artifact.v1";
  artifactId: string;
  acceptedAt: string;
  source: ProvenanceRef;
  acceptedSpec: AcceptedSpec;
  acceptedDiff: AcceptedDiff;
  feedback: FeedbackItem[];
  assumptions: AssumptionItem[];
  secretRequirements: SecretRequirementRef[];
  assets: AssetRef[];
};
```

Rules:

- every object is strict;
- unknown fields are rejected;
- arrays may default to empty only at the normalization boundary;
- ids are stable inside the artifact and across later accepted versions when
  the same product concept is updated;
- no field may be Ralph-branded.

## Accepted Spec

Full current product truth.

```ts
type AcceptedSpec = {
  id: string;
  version: number;
  document: SpecDocument;
  renderedMarkdown?: string;
  contentHash: `sha256:${string}`;
  sourceRefs: string[];
};
```

Rules:

- `document` is the accepted product spec, not loop memory;
- `renderedMarkdown` is a display/materialization format for humans, runner
  compatibility and legacy consumers;
- Arena maps it to `SpecVersion.content`;
- runner may materialize `renderedMarkdown` into `spec.md`;
- loops read it, but do not write it directly.

## Spec Document

Strict structured product spec.

```ts
type SpecDocument = {
  specSchemaVersion: "ra-287.spec-document.v1";
  title: string;
  summary?: string;
  sections: SpecSection[];
  requirements: SpecRequirement[];
  extensionBlocks: SpecExtensionBlock[];
};

type SpecSection = {
  id: string;
  title: string;
  body?: string;
  requirementIds: string[];
  sourceRefs: string[];
};

type SpecRequirement = {
  id: string;
  kind:
    | "functional"
    | "ux"
    | "integration"
    | "data"
    | "non_functional"
    | "constraint"
    | "acceptance"
    | "other";
  title: string;
  statement: string;
  priority: "low" | "normal" | "high";
  acceptanceCriteria: string[];
  sourceRefs: string[];
};

type SpecExtensionBlock = {
  id: string;
  title: string;
  body: string;
  reason: string;
  sourceRefs: string[];
};
```

Rules:

- `requirements[]` is the structured core of the spec;
- `sections[]` provide human grouping and narrative;
- `extensionBlocks[]` are the only allowed freedom layer for cases not yet
  covered by the schema;
- every extension block must have a reason and source refs;
- extension blocks should be promoted into structured fields when a repeated
  pattern appears;
- producers should try to cover the whole accepted spec with structured fields
  before using extension blocks.

## Accepted Diff

Focused accepted change packet for the next loop run.

```ts
type AcceptedDiff = {
  id: string;
  baseSpecVersion?: number;
  targetSpecVersion: number;
  summary: string;
  items: AcceptedDiffItem[];
};

type AcceptedDiffItem = {
  id: string;
  targetType:
    | "spec"
    | "feedback"
    | "assumption"
    | "secret_requirement"
    | "asset";
  targetId: string;
  changeType:
    | "created"
    | "updated"
    | "handled"
    | "closed"
    | "reopened"
    | "accepted"
    | "corrected"
    | "disputed"
    | "superseded"
    | "removed";
  workImpact: "requires_loop_work" | "context_only" | "no_loop_work";
  summary: string;
  sourceRefs: string[];
  sourceEvidence?: AcceptedDiffSourceEvidence[];
};

type AcceptedDiffSourceEvidence = {
  sourceRef: string;
  quote?: string;
  intent?: string;
};
```

Rules:

- fresh accepted diff outranks historical loop task state;
- producer validation may enforce structural consistency, but must not infer
  semantic intent from language-specific keyword/regex rules;
- if source text, replies, images or files imply an implementation-critical
  asset, bug, assumption or product change, that implication must be made as a
  recorded producer judgement (`sourceEvidence`, claim decisions,
  `assetBindings`, etc.), not as hidden phrase matching;
- RAG/retrieval may help collect candidate source messages and assets for the
  producer, but it is not a source of accepted product truth by itself;
- if an accepted diff or its `sourceEvidence` names an exact implementation
  technology, library, framework, design system, provider, integration, asset,
  file, visual reference, behavior or removal requirement, loop projections
  must preserve that exact requirement. They must not downgrade it to
  `compatible`, `style`, `inspired`, mock, local-only or narrower substitutes
  unless a new accepted diff explicitly relaxes the requirement or a recorded
  judgment explains a real product/spec ambiguity;
- codebase/runtime constraints may create more implementation work or a real
  blocker, but they do not authorize a loop to mark a local substitute as
  accepted product closure;
- reopened feedback uses `workImpact="requires_loop_work"`;
- handled feedback usually uses `workImpact="no_loop_work"` and means the loop
  claims the issue has been addressed, but users have not accepted closure;
- accepted closed feedback usually uses `workImpact="no_loop_work"`;
- `workImpact` replaces Ralph-specific `ralphDirective`;
- diff items do not become a second task list.
- `sourceEvidence` is compact source intent evidence for a diff item. It is for
  preserving contrast, negation and removal semantics such as "instead of",
  "remove text", "icon-only" or "must not show"; it is not a second task list;
- every `sourceEvidence[].sourceRef` must be present in the item's `sourceRefs`,
  and each evidence row must contain `quote`, `intent`, or both;
- `quote` must be a short user-safe excerpt, not a full transcript and never a
  secret value. The artifact security scanner still applies to this field.

## Intent Signal Reliability

The accepted artifact is also the reliability boundary for user intent.

Rules:

- document dedupe is not work dedupe. Repeating a requirement before a loop
  result may be a duplicate; repeating the same visible mismatch after a loop
  result is feedback, reopen or dispute input for the next accepted artifact;
- a same-source-version import may update the accepted artifact metadata. If
  the metadata hash is unchanged, it is an idempotent no-op; if the metadata
  hash changes, it is a fresh accepted input even when markdown and source
  version stay the same;
- accepted input freshness is stored on `SpecVersion.updatedAt`, not inferred
  from raw chat, outbox rows, runtime events or Ralph task history;
- loop wake eligibility is: any accepted input newer than the latest loop
  outcome with at least one `acceptedDiff.items[]` row whose
  `workImpact="requires_loop_work"`;
- `context_only` and `no_loop_work` updates may update product truth and
  runner hashes, but they must not mask an older unprocessed
  `requires_loop_work` input and must not create their own loop work wake;
- user-facing task/progress surfaces may project active accepted work, but
  completion must not be inferred from terminal success, stale `acceptedAt`, or
  completed historical tasks when the stored accepted input is newer.

## Public Task Projection

`AcceptedSpecArtifact` intentionally has no top-level `tasks[]`.

Rules:

- `tg-spec` owns product truth as accepted spec, accepted diff, feedback and
  assumptions; it does not plan loop execution tasks.
- Ralph and future loops plan implementation privately from the artifact plus
  code/runtime context.
- Manager-facing task UI may project work-like rows from `feedback[]`,
  `acceptedDiff.items[]` and loop status, but that projection is not artifact
  truth and must not be written back into the artifact as `tasks[]`.
- Feedback is self-contained product signal. It must not carry reverse links to
  projected UI task ids.
- Raw loop progress and `.ralph/plan.json` remain execution/debug state, not
  accepted product truth.

## Feedback

Product signal that reality does not match accepted intent.

```ts
type FeedbackItem = {
  id: string;
  title: string;
  body: string;
  state: "open" | "handled" | "reopened" | "accepted_closed" | "superseded";
  reopenCount: number;
  defaultClosurePolicy: "loop_claim_is_enough_until_reopened";
  sourceRefs: string[];
  resolution?: {
    kind: "accepted_fixed" | "not_a_bug" | "superseded";
    summary: string;
    sourceRefs: string[];
  };
};
```

Rules:

- `reopened#N` is represented by `state="reopened"` and `reopenCount=N`;
- `reopened#N` is a status change on the same feedback id, not a duplicate bug;
- `handled` means a loop has claimed the bug is fixed. It is not human/product
  acceptance and must not be rendered as final closure.
- user silence is not a blocker and does not create a waiting state;
- a loop claim moves active feedback to `handled` by default, and the system may
  proceed unless users provide newer negative feedback;
- lack of fresh negative feedback is the default product signal after loop
  claimed work. Do not create user-facing confirmation cards just to prove that
  ordinary implemented work still works;
- optional verification prompts may ask `fixed / not fixed` when configured;
- `not fixed` creates a new accepted diff item with `changeType="reopened"`;
- `fixed` may create accepted closure, but is not required for normal progress.
- Arena manager-facing interaction snapshots may expose feedback as a read-only
  projection from the stored artifact; closing/reopening feedback must still
  write a new accepted spec/diff artifact, not mutate the projection.

Valid state transitions:

```text
open -> accepted_closed
open -> superseded
open -> handled
open -> reopened
handled -> accepted_closed
handled -> reopened with reopenCount + 1
handled -> superseded
reopened -> accepted_closed
reopened -> handled
reopened -> reopened with reopenCount + 1
reopened -> superseded
accepted_closed -> reopened with reopenCount + 1
```

## Assumptions

Spec gap interpreted by a loop so it can continue.

```ts
type AssumptionItem = {
  id: string;
  title: string;
  statement: string;
  state:
    | "proposed"
    | "accepted"
    | "corrected"
    | "disputed"
    | "visible_caveat"
    | "superseded";
  sourceRefs: string[];
  outcome?: {
    kind: "accepted_as_spec" | "corrected_into_spec" | "disputed_not_spec";
    acceptedDiffItemId?: string;
    correctionSummary?: string;
  };
};
```

Rules:

- public entity name is `Assumption`;
- Ralph may internally call this a judgment, but raw judgment ids are not public
  artifact API;
- loop emits an assumption to users only for a spec gap it interpreted on its
  own so work could continue;
- verification gaps, missing production proof, overclaim warnings and
  `needs confirmation` signals are loop evidence, not assumptions. They must
  not be projected as user-facing `Assumption` / `Решение агента` cards;
- user acceptance or correction returns to loops only through accepted spec/diff;
- assumptions do not patch `.arena/spec-input.json`, `.ralph/plan.json` or UI
  local state directly.
- A loop may send a sanitized assumption-review signal to a project interface,
  but that signal is not product truth. It may contain only a public assumption
  id/title/statement/source refs, never raw judgment ids, chosen option indexes,
  options, private reasoning or operator-only summaries. The statement must be
  phrased as user-facing review copy. The signal becomes current product truth
  only when `tg-spec` or another spec producer accepts it into a new
  `AcceptedSpecArtifact.assumptions[]` / `acceptedDiff.items[]` artifact.
- Arena manager-facing interaction snapshots may expose assumptions as a
  read-only projection from the stored artifact; user accept/correct/dispute
  actions must still write a new accepted spec/diff artifact, not mutate the
  projection.
- Arena/Telegram project surfaces may show a pending assumption-review signal as
  an action card from progress/outbox. That card is not a member of
  `ProjectInteractionSnapshot.assumptions[]` until a spec producer accepts it
  into an artifact.
- `tg-spec` may express accepted assumption write-back in markdown as
  `## Assumptions` with `ASM-*` items grouped under `### Proposed`,
  `### Accepted`, `### Corrected`, `### Disputed`, `### Visible Caveats` or
  `### Superseded`; the producer must project that section into artifact
  `assumptions[]` and `acceptedDiff.items[]`.
- corrected or disputed assumptions require loop attention; accepted
  assumptions are context/spec truth unless a later accepted diff says
  otherwise.

Valid state transitions:

```text
proposed -> accepted
proposed -> corrected
proposed -> disputed
proposed -> visible_caveat
accepted/corrected/disputed/visible_caveat -> superseded
```

## Secret Requirement Refs

Safe requirement for a runtime capability.

```ts
type SecretRequirementRef = {
  id: string;
  key: string;
  description?: string;
  required: boolean;
  blocking: boolean;
  sourceRefs: string[];
};
```

Rules:

- `key` is a secret name, for example `TELEGRAM_BOT_TOKEN`;
- actual encrypted values live only in Arena `ProjectSecret`;
- `Project.requiredSecrets` remains Arena fulfillment/injection truth;
- the artifact may say a secret is required, but cannot provide the value.

Forbidden field names anywhere under a secret requirement:

```text
value
secretValue
token
apiKey
password
encryptedValue
iv
authTag
defaultValue
sampleValue
last4
```

## Asset Refs

Typed product reference to a project file.

```ts
type AssetRef = {
  id: string;
  kind: "image" | "document" | "data" | "archive" | "other";
  label: string;
  required: boolean;
  state: "pending" | "resolved" | "removed";
  logicalPath?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: `sha256:${string}`;
  arenaAssetId?: string;
  sourceRefs: string[];
};
```

Rules:

- v1 accepts typed pending refs to avoid forcing upload order into the spec
  contract;
- Arena owns imported asset storage and `ProjectAsset` rows;
- runner manifest may include only resolved refs that Arena can deliver;
- unresolved required assets are product requirements, not lifecycle states;
- no Telegram file ids, local host paths, private URLs or access grants in
  runner materialized payloads.

## Provenance Refs

Bounded source reference. It is not raw Telegram history and not private logs.

```ts
type ProvenanceRef = {
  id: string;
  sourceSystem: "tg-spec" | "arena" | "loop" | "operator" | "production";
  sourceProjectId?: string;
  sourceVersion?: number;
  sourceRefType:
    | "accepted_spec"
    | "discussion_message"
    | "loop_output"
    | "operator_note"
    | "production_evidence";
  sourceId: string;
  url?: string;
  fingerprint?: `sha256:${string}`;
};
```

Forbidden in `ProvenanceRef`:

- raw chat transcript;
- private channel ids in runner materialized payloads;
- raw author identity unless a separate access policy permits it;
- credentials, tokens, cookies or external file ids.

## Security Rejection Rules

Contract/package validation rejects:

- unknown fields;
- forbidden secret-like field names;
- secret-looking values in artifact text fields;
- raw private logs;
- raw external file ids in runner materialized payloads;
- local absolute paths outside runner-owned workspace refs;
- access grants or permission grants embedded in the artifact.

Arena import must run the same rejection before storage. `tg-spec` redaction is
not trusted as the only security boundary.

Runner manifest tests must prove `.arena/spec-input.json` contains refs only,
not secret values, access grants, raw private logs, Telegram file ids or local
host paths.

Repo guardrail:

```bash
node scripts/check-accepted-spec-artifact-contract.mjs --verbose
```

This Stop-hook/CI-style check protects the current Arena storage, runner,
Ralph and operator surfaces from reintroducing legacy accepted-delta vocabulary.
Legacy v2 names are allowed only in historical tests/work notes, not current
runtime surfaces.

## Retired Legacy v2 Policy

Retired input:

```text
packageSchemaVersion=2
acceptedDelta
sourceProvenance
ralphDirective
expectedRalphHandling
```

Policy:

- current imports must provide `acceptedArtifact`;
- no runtime import path may accept or adapt this retired shape;
- no new writes may emit `acceptedDelta`, `sourceProvenance`,
  `ralphDirective` or `expectedRalphHandling`;
- old projects can be repaired/upgraded by an operator run instead of preserving
  hidden compatibility in every runtime path;
- historical tests or work notes may mention the retired shape only as past
  migration evidence.

Arena storage:

- `SpecVersion.acceptedArtifact` is the canonical persisted artifact field;
- import rejects requests without a valid `acceptedArtifact`;
- runner must expose persisted metadata as `acceptedArtifact` only;
- no Arena storage field or runner manifest field may be named
  `acceptedDelta`, `sourceProvenance` or `ralphDirective`.

## Operator Repair / Upgrade Policy

Breaking retired metadata is allowed during MVP only with an explicit operator
repair path. Markdown-only projects, malformed metadata, unsafe metadata and old
v2 metadata must be classified explicitly. They may be re-imported from source
truth, manually repaired by an operator-authored artifact, or parked with an
operator note.

Do not add broad runtime fallback to hide bad metadata. Present metadata that
claims an accepted artifact shape must validate or fail loudly at the migration
boundary.

## Manifest Behavior

Missing metadata:

- current `tg-spec` imports are rejected;
- old stored projects are classified for operator repair instead of silently
  becoming markdown-only loop input.

Present metadata:

- if metadata claims an accepted artifact shape but fails schema validation,
  runner/Ralph must fail loudly at migration boundary;
- malformed metadata-capable manifests must not silently downgrade to markdown
  extraction.

## Contract Package Distribution

Arena owns the canonical Zod schema in `packages/contracts`.

Current first-party producers and consumers must consume the same
`@arena/contracts` package at runtime. `tg-spec` is a first-party producer, so
it validates produced accepted artifacts with `parseAcceptedSpecArtifact` from
that package before push.

Arena may still export a generated JSON Schema as an auxiliary artifact for
tooling, publication or non-runtime consumers:

```text
packages/contracts/generated/accepted-spec-artifact.schema.json
```

Rules:

- generate it with `npm --prefix packages/contracts run export:accepted-spec-schema`;
- first-party runtime producers must not carry copied schema/validator bridges;
- `tg-spec` production artifact builders must validate produced artifacts
  through `@arena/contracts` before push;
- custom refinements that JSON Schema cannot represent, such as secret-like
  strings and reopened feedback counts, are exported under
  `x-arena-contract.refinements` for auxiliary schema consumers;
- `scripts/check-accepted-spec-artifact-contract.mjs` verifies package/export
  health and, when the sibling repo is present, rejects old `tg-spec` copied
  bridge files.

## Owner / Writer Matrix

| Concept | Meaning owner | Writer | Readers |
| --- | --- | --- | --- |
| `AcceptedSpecArtifact` shape | contract package | `tg-spec` via `@arena/contracts` package | Arena, runner, loops, UI projection |
| accepted spec content | accepted spec plane | `tg-spec` | Arena, runner, loops, UI |
| accepted diff semantics | accepted spec plane | `tg-spec` | Arena, runner, loops |
| task UI projection | read-side projection | Arena / UI | managers, contributors |
| feedback state/reopen count | accepted spec plane | `tg-spec` | UI, loops |
| assumptions | loop output as source, accepted spec plane as truth | `tg-spec` after user decision | UI, loops |
| secret requirement refs | accepted spec plane | `tg-spec` | Arena, loops, UI |
| secret values | Arena | Arena secret flows | runner injection only |
| asset refs | accepted spec plane | `tg-spec` | Arena, runner, loops, UI |
| asset files/storage | Arena | Arena asset flows | runner delivery, UI |
| loop execution tasks | loop runtime | Ralph / future loop | debug/operator views |

## Public Vocabulary

Internal contract words should not leak directly to creator/manager UX.

| Internal | Product-facing |
| --- | --- |
| Artifact | Approved project brief / approved spec |
| Accepted diff | What changed / approved change |
| Task projection | Work item / issue |
| SecretRequirementRef | Required integration / required secret name |
| AssetRef | Reference file / project file |
| ProvenanceRef | Source message / discussion source |
| Dispute assumption | Correct / clarify assumption |
