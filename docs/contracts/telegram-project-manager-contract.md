# Telegram Project Manager Contract

Status: RA-275 / RA-287 implementation contract
Date: 2026-05-16

## Boundary

Arena owns project-management truth:

- `ProjectInteractionSnapshot`
- project identity and visibility
- `User` + Auth.js `Account(provider="telegram")`
- `AccessGrant`
- applied specs, accepted artifact projections, assets, secrets, runtime state,
  progress, preview and safe activity

`tg-spec` owns Telegram presentation:

- chat/topic discussion
- Telegram Web App shell
- Telegram message ids
- notification wording
- spec negotiation workflow before accepted specs are handed to Arena

`tg-spec` must not own a second project manager, permission model, secret store,
runtime state model, task/feedback/judgment store or applied-spec truth.

## Identity

Telegram users become normal Arena users through RA-276:

- canonical user row: `User`
- canonical Telegram link: `Account(provider="telegram")`
- canonical permissions: `AccessGrant`

Telegram OIDC and Telegram Web App expose different identity fields. OIDC `sub` proves the login token subject, but the Mini App handoff exposes the raw numeric Telegram `user.id`. Arena stores the raw Telegram id as the preferred `Account(provider="telegram").providerAccountId` when OIDC provides it, because that is the id the embedded Web App can later prove cryptographically. Legacy subject-only Telegram accounts must be repaired by adding the raw-id account mapping to the same Arena `User`, not by trusting `tg-spec`.

Telegram chat membership or Telegram Web App init data is not permission truth. It can identify a Telegram account candidate, but project access is granted only after it resolves to an Arena `User` with matching `AccessGrant` capability.

## Role Mapping

Arena can automatically sync a project-scoped `AccessGrant` for a Telegram Web App viewer when all of these are true:

- the Arena project has `tgSpecSourceProjectId`
- the request is `surface=telegram`
- Arena verifies Telegram Web App `initData` and maps the raw Telegram `user.id` to an Arena `User`
- tg-spec confirms the raw Telegram `user.id` has a role for that source project over the internal shared-secret bridge

The synced v1 access mapping is:

- project contributor: project-scoped `project_viewer` grant, currently `project.view`
- supergroup viewer: current member of the bound Telegram supergroup may receive the same read-only viewer snapshot, but only while membership is verified or through a short-lived/revalidated viewer grant
- project/group admin: project-scoped `project_manager` grant or equivalent custom grant that can see status, preview, task projections, feedback, assumptions, specs, progress and safe secret status, without direct spec writes
- public/left user: no private manager snapshot; only visibility-safe public/featured preview through the `public` audience tier of `ProjectInteractionSnapshot`

The automated mapping is auditable, revocable and project-scoped. It must not grant runtime mutation, access management, delete, budget control, direct spec writes or secret reveal by default.

## Telegram Audience Tiers

Telegram Mini App deep links select a project entrypoint. They do not decide the audience tier.

Arena decides the snapshot audience after the signed Telegram handoff resolves to an Arena `User` and, for tg-spec-sourced projects, after tg-spec provides project-room role or current supergroup membership evidence over the internal bridge.

V1 audience tiers are:

| Audience | Minimum evidence | Arena grant | Snapshot sections | Explicitly not allowed by default |
| --- | --- | --- | --- | --- |
| Project/group manager | tg-spec confirms `curator` or current Telegram room admin for the exact bound project room | `project_manager` or narrower equivalent | project identity, preview, status, task projections, feedback, assumptions, progress, full applied specs/version diff, safe required-secret status, safe activity; secret setup only if the grant includes secret capabilities | direct spec writes, runtime controls, access management, budget/admin, secret reveal |
| Supergroup viewer / project contributor | tg-spec confirms `contributor`, observed project-room participation, another explicit project-scoped participant record, or current membership in the bound Telegram supergroup | `project_viewer` or request-scoped equivalent viewer authority | project identity, preview, status, task projections, feedback, assumptions and progress with viewer redaction | full applied specs/version content, secret names/details, secret setup, secret reveal, runtime controls, direct spec writes, access management, budget/admin, raw logs |
| Public / left user | no project-room role; project is public/featured under Arena visibility policy | no private manager grant | `ProjectInteractionSnapshot.viewer.audience=public` with project identity, `publicStatus` and preview only | private project snapshot, progress internals, tasks/specs, secrets, runtime/status details, controls |

For topic-bound projects inside a supergroup, current supergroup membership is acceptable only for the weakest viewer snapshot: "what is happening with this project". It is not enough for manager status, secret setup, spec approval, direct Arena spec writes, runtime controls, access management or budget/admin surfaces. Those still require curator/admin evidence or another explicit project-scoped record.

If viewer authority is derived only from current supergroup membership, it must be revalidated or made short-lived. Arena must not create a stale long-lived private access path that keeps working after the Telegram user leaves the supergroup.

Viewer snapshots are useful product surfaces, but still private manager data. They must be built by the Project Interaction API through section-level redaction, not by letting `tg-spec` maintain a second project summary or task/progress store.

Public snapshots are also built by the Project Interaction API, but they are
not private manager data. The `public` audience tier must redact applied specs,
task projections, feedback, assumptions, progress internals, secrets, raw
activity, runtime internals, tg-spec mirror ids and manager controls.

## Spec Ownership

Telegram-project specs evolve through `tg-spec` discussion, approval and accepted-spec handoff.

The Telegram manager surface reads applied Arena specs from `ProjectInteractionSnapshot`, but Telegram project/group admins do not get `project.specs.write` by default. Direct Arena spec editing is reserved for Arena-native/personal project flows or an explicit non-Telegram administrative grant such as `project_curator`.

## API Consumption

Telegram Web App consumes Arena truth through the Project Interaction API:

```text
GET /api/projects/:id/interaction?surface=telegram
```

The current RA-287 read-side shape is
`ProjectInteractionSnapshot.version="ra-287.project-interaction.v2"`.

The response is private manager data for `admin` and `contributor` audiences and requires normal Arena auth/access. For `public` audience it is a visibility-safe snapshot: featured projects may be shown to guests, public projects may be shown to authenticated Arena users, and private projects still require project access. `surface=telegram` applies the Telegram action policy:

- runtime verbs disabled
- spec/asset mutation disabled
- budget, settings, access and delete disabled
- secret setup can remain enabled only when the user has explicit secret capabilities
- secret reveal stays disabled

Unknown surfaces are rejected. Public/featured access must not create a second tg-spec project summary; it uses the same snapshot boundary with `viewer.audience=public`.

Read-side project work is split intentionally:

- `snapshot.tasks` is product/spec work projection for manager UI. It is not
  Ralph's private plan and must not be treated as loop execution truth.
- `snapshot.progress.raw.steps` is the exposed loop execution read-side: what
  Ralph, or another resident loop, is currently doing or recently did.
- `snapshot.visualEvidenceReviews` is the Arena-owned screenshot review
  projection for exported/assessed visual evidence. It is derived from
  task-linked Ralph `verificationEvidence` through the Arena progress/read-side
  channel. `tg-spec` may render the returned action, but it must not compute
  evidence availability or inspect raw capture artifacts itself. The internal
  `tg-spec` readback endpoint exposes only artifact-backed reviews as
  `visualEvidenceReviews`; metadata-only visual evidence remains diagnostic
  Arena read-side state until a matching screenshot artifact exists.
- `visualEvidenceReadiness` is an Arena-owned diagnostic for the internal
  `tg-spec` status/readback path. It can explain why no screenshot action is
  currently present, but it is not an action source: Telegram screenshot-review
  buttons are still rendered only from the returned artifact-backed
  `snapshot.visualEvidenceReviews`.
- Telegram manager UI may render both, but it must label them separately and
  must not write either one back as a tg-spec task store.

## Deep Links

Telegram messages may link users into Arena manager surfaces after auth:

```text
/my/projects/:id?focus=secrets&requiredSecret=KEY#project-secrets
/my/projects/:id?focus=secrets&requiredSecret=KEY&provideSecret=KEY#project-secrets
/my/projects/:id?focus=visualEvidence&review=REVIEW_ID#project-visual-evidence
```

`KEY` is only a required secret name. `provideSecret=KEY` is an Arena WebApp
action hint to open the encrypted value form for an already-required missing
secret; it is not a mutation by itself. Secret values never go in Telegram
messages, URLs, snapshots, activity labels or event payloads.
`REVIEW_ID` is only an Arena visual evidence review id. Raw `.ralph` paths,
artifact paths and screenshot file URLs must not go in Telegram messages.

Embedded Telegram Web App auth uses the same Project Interaction endpoint, not a trusted tg-spec server session. The Web App sends `Telegram.WebApp.initData` to Arena as a request header; Arena verifies Telegram's Ed25519 `signature` with Telegram's public key and the server-side `TELEGRAM_WEBAPP_BOT_ID`, then maps the signed Telegram `user.id` to `User` through `Account(provider="telegram")`.

This handoff identifies an Arena user candidate only. Project visibility and permissions still come from Arena `AccessGrant`/owner/bypass checks. Missing signature, missing bot id, stale init data or an unlinked Telegram account must not create a user or grant project access.

For tg-spec-sourced projects, Arena may use the verified raw Telegram `user.id` to ask tg-spec for that user's project role over the internal shared-secret bridge. If tg-spec confirms `curator` or `contributor`, Arena creates the corresponding project-scoped `AccessGrant` before building the snapshot. The grant is the permission truth after creation; tg-spec is only the role evidence source.

## Events And Delivery

Arena-originated updates to Telegram chats are derived from Arena truth:

- snapshot status/progress/preview fields
- safe activity/outbox metadata after an explicit delivery contract exists
- required-secret status/deep links
- accepted-spec/project events after canonical Arena mutations

Delivery to a bound chat/topic uses an Arena-owned `ProjectUpdateOutbox` with dedupe keys and delivery state. `tg-spec` may render and send Telegram messages, but event identity, source payload safety, audience policy, lease/retry state and replay decisions belong to Arena.

First transport is pull/claim:

```text
POST /api/internal/tg-spec/project-updates/claim
POST /api/internal/tg-spec/project-updates/:eventId/ack
```

The claim endpoint is internal-authenticated with the existing `ARENA_PUSH_SECRET` / `x-evolution-push-secret` shared-secret lane. `tg-spec` requests only the audiences it can deliver for a target binding, sends Telegram messages, then acks `DELIVERED`, `FAILED` or `SKIPPED` with the Arena-issued lease id.

Contributor delivery can be claimed without a target id because it is tied to the existing project binding. Manager delivery requires an Arena-issued active delivery target id for the exact Telegram destination.

A manager delivery target must be Arena-owned and revocable. Telegram chat admin status, `tg-spec` curator state or chat membership can suggest candidates, but cannot grant `project.secrets.manage` or any other Arena capability by itself.

Manager delivery targets are explicit project-scoped records with source system, source target id, target kind, audience, required capability and lifecycle status. `tg-spec` must pass the Arena-issued target id when claiming `project_managers` rows; Arena filters those rows to the target project, source system, target kind and required capability before leasing them. Contributor and manager claims are separate requests.

Arena may read candidate Telegram destinations from `tg-spec` over the internal shared-secret bridge, but `tg-spec` only proves that a Telegram chat/topic binding belongs to the Arena project. The activation decision remains an Arena `project.access.manage` action. After activation, Arena syncs the issued delivery target id back to the exact `tg-spec` binding so the bot can claim manager rows without a manual copy/paste step.

V1 supports one active manager Telegram target per Arena project/source/audience. Activating a new manager chat/topic target revokes the previous active target for that project/source/audience. This keeps the outbox delivery state project-scoped and avoids pretending that a single outbox row can be delivered independently to multiple manager destinations.

Target activation and revocation are Arena actions guarded by `project.access.manage`. Activation records the Arena actor, source system, source target id and activation time; revocation records the Arena actor and revocation time. Re-activation records the latest activating actor, clears the revoked fields and creates a new active lifecycle point for the same destination.

Every outbox row carries:

- `id`
- `projectId`
- `eventType`
- `audience`
- `requiredCapability`
- `dedupeKey`
- safe `payload`
- delivery `status`, attempts, lease and retry metadata

Initial useful lifecycle events:

- spec accepted/imported into Arena
- work/run started
- preview ready or changed
- required secret missing
- work paused/failed with a safe reason code
- work completed and agent returned to idle

Every deliverable event must carry a safe payload and an audience/capability policy. Examples:

- contributors may receive work started/completed, preview ready and progress-style updates
- project/group managers may additionally receive required-secret missing/provided status and safe blocker notices
- public/left users may receive only public/featured-safe updates, if a public delivery surface exists

Ready/completed payloads may include a sanitized result entrypoint:

- `telegramMiniAppUrl` for a real Telegram direct Mini App link such as
  `https://t.me/<bot>?startapp=<target>` when the bot's Main Mini App is
  explicitly configured, or
  `https://t.me/<bot>/<app>?startapp=<target>` when a Direct Link Mini App
  short name is explicitly known;
- `previewUrl` as the normal web-preview fallback when no direct Mini App target
  is available.

The Mini App URL must be treated as an entrypoint only. It does not grant Arena
access, does not replace Project Interaction snapshot permissions and must not
be inferred from raw project secrets or logs.

Ready/completed outbox payloads must not carry legacy `proofReviewId`,
`proofReviewStatus` or `proofReviewAction` metadata from before/after
screenshot proof. Screenshot-review actions for Telegram are presented from the
Arena Project Interaction/readback projection, where `visualEvidenceReviews` is
the artifact-backed button source and `visualEvidenceReadiness` is only an
empty-state diagnostic.

Secret values, raw logs, raw event payloads, stack traces, internal host/container names and access-management details must not be delivered to Telegram chats.

Transport can be a signed webhook from Arena to `tg-spec` or a `tg-spec` pull from an Arena outbox endpoint. That is an implementation choice; the product contract is not. Arena owns event eligibility and the safe event payload before delivery.

The outbox is not a replacement for Project Interaction snapshots. The Telegram Web App cockpit still reads current project state through `GET /api/projects/:id/interaction?surface=telegram`; the outbox exists only so lifecycle feedback can be delivered and retried without leaking raw runtime state.

## Non-Goals

- No Telegram-owned project secret entry flow.
- No Telegram-owned task store.
- No Telegram-only project access bypass.
- No raw run logs or event payloads in Telegram manager responses.
- No runtime controls in Telegram v1.
