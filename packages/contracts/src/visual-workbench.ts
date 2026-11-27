import { z } from "zod";

export const VISUAL_WORKBENCH_MANIFEST_PATH = "visual-workbench/manifest.json" as const;
export const VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION = "ra-355.visual-coverage-manifest.v0" as const;

const LocalRouteSchema = z.string()
  .trim()
  .min(1)
  .refine((value) => value.startsWith("/"), "Route must be local and start with /.")
  .refine((value) => !value.startsWith("//"), "Route must not be protocol-relative.")
  .refine((value) => !value.includes("\\"), "Route must not contain backslashes.")
  .refine((value) => !/[\x00-\x1F\x7F]/.test(value), "Route must not contain control characters.")
  .refine((value) => {
    try {
      const parsed = new URL(value, "http://arena.local");
      return parsed.origin === "http://arena.local";
    } catch {
      return false;
    }
  }, "Route must be parseable as a local route.");

const StableIdSchema = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9._-]+$/);
const RequiredTextSchema = z.string().trim().min(1).max(1000);

export const VisualWorkbenchStoryKindSchema = z.enum([
  "feature",
  "widget",
  "state",
  "page_flow",
]);

export const VisualWorkbenchViewportSchema = z.object({
  name: StableIdSchema,
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
}).strict();

export const VisualWorkbenchStorySchema = z.object({
  id: StableIdSchema,
  title: RequiredTextSchema.max(200),
  kind: VisualWorkbenchStoryKindSchema,
  feature: RequiredTextSchema.max(160),
  widget: RequiredTextSchema.max(160),
  state: RequiredTextSchema.max(160),
  claim: RequiredTextSchema.max(500),
  render: z.object({
    type: z.literal("workbench_route"),
    path: LocalRouteSchema,
  }).strict(),
  mockState: z.object({
    name: RequiredTextSchema.max(160),
  }).strict(),
  viewports: z.array(VisualWorkbenchViewportSchema).min(1).max(20),
  interaction: z.string().trim().min(1).max(500).optional(),
  waitAfterLoadMs: z.number().int().min(0).max(10_000).optional(),
  tags: z.array(RequiredTextSchema.max(80)).max(50).optional(),
  taskRelevance: z.object({
    defaultFor: z.array(RequiredTextSchema.max(160)).max(100).optional(),
  }).strict().optional(),
}).strict();

export const VisualWorkbenchManifestSchema = z.object({
  schemaVersion: z.literal(VISUAL_WORKBENCH_MANIFEST_SCHEMA_VERSION),
  projectClass: z.literal("ordinary_web"),
  workbench: z.object({
    serveCommand: RequiredTextSchema.max(500),
    baseUrlEnv: StableIdSchema.optional(),
    storyRoutePattern: LocalRouteSchema,
  }).strict(),
  coveragePolicy: z.object({
    mode: z.literal("strict_canary"),
    selectionDefault: z.literal("full_manifest"),
    simplificationRequiresEvidence: z.literal(true),
  }).strict(),
  stories: z.array(VisualWorkbenchStorySchema).min(1).max(500),
}).strict().superRefine((manifest, ctx) => {
  const seen = new Set<string>();
  for (let index = 0; index < manifest.stories.length; index += 1) {
    const story = manifest.stories[index];
    if (seen.has(story.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["stories", index, "id"],
        message: `Duplicate Visual Workbench story id: ${story.id}`,
        params: { visualWorkbenchIssueCode: "story_id_duplicate" },
      });
    }
    seen.add(story.id);
    const expectedPath = manifest.workbench.storyRoutePattern.replace(":storyId", story.id);
    if (expectedPath !== story.render.path) {
      ctx.addIssue({
        code: "custom",
        path: ["stories", index, "render", "path"],
        message: `Visual Workbench story path must match storyRoutePattern: ${expectedPath}`,
        params: { visualWorkbenchIssueCode: "story_route_pattern_mismatch" },
      });
    }
  }
});

export type VisualWorkbenchStoryKind = z.infer<typeof VisualWorkbenchStoryKindSchema>;
export type VisualWorkbenchViewport = z.infer<typeof VisualWorkbenchViewportSchema>;
export type VisualWorkbenchStory = z.infer<typeof VisualWorkbenchStorySchema>;
export type VisualWorkbenchManifest = z.infer<typeof VisualWorkbenchManifestSchema>;

export type VisualWorkbenchManifestIssueCode =
  | "manifest_schema_unsupported"
  | "project_class_unsupported"
  | "serve_command_missing"
  | "story_route_pattern_missing"
  | "coverage_policy_unsupported"
  | "story_kind_unsupported"
  | "story_id_duplicate"
  | "story_route_pattern_mismatch"
  | "story_required_field_missing"
  | "story_viewport_missing"
  | "strict_state_gap";

export type VisualWorkbenchManifestIssueDetail = {
  code: VisualWorkbenchManifestIssueCode;
  path: Array<string | number>;
  message: string;
  field?: string;
  storyIndex?: number;
  storyId?: string;
  keys?: string[];
};

export type VisualWorkbenchManifestSummary = {
  storyCount: number;
  features: string[];
  widgets: string[];
  states: string[];
  viewportNames: string[];
  stories: Array<{
    id: string;
    title: string;
    kind: VisualWorkbenchStoryKind;
    feature: string;
    widget: string;
    state: string;
    route: string;
    mockStateName: string;
    viewportNames: string[];
    taskRelevanceDefaultFor: string[];
  }>;
};

const VISUAL_WORKBENCH_ISSUE_CODE_ORDER: VisualWorkbenchManifestIssueCode[] = [
  "manifest_schema_unsupported",
  "project_class_unsupported",
  "serve_command_missing",
  "story_route_pattern_missing",
  "coverage_policy_unsupported",
  "story_kind_unsupported",
  "story_id_duplicate",
  "story_route_pattern_mismatch",
  "story_required_field_missing",
  "story_viewport_missing",
  "strict_state_gap",
];

export function parseVisualWorkbenchManifest(raw: unknown): VisualWorkbenchManifest {
  return VisualWorkbenchManifestSchema.parse(raw);
}

export function readVisualWorkbenchManifestSchemaVersion(raw: unknown): string | null {
  if (!isRecord(raw) || typeof raw.schemaVersion !== "string") return null;
  const schemaVersion = raw.schemaVersion.trim();
  return schemaVersion ? schemaVersion : null;
}

export function getVisualWorkbenchManifestIssueCodes(raw: unknown): VisualWorkbenchManifestIssueCode[] {
  return unique(getVisualWorkbenchManifestIssueDetails(raw).map((detail) => detail.code));
}

export function getVisualWorkbenchManifestIssueDetails(raw: unknown): VisualWorkbenchManifestIssueDetail[] {
  const details = detectDuplicateStoryIdDetails(raw);
  const parsed = VisualWorkbenchManifestSchema.safeParse(raw);
  if (parsed.success) return uniqueIssueDetails(details);

  for (const issue of parsed.error.issues) {
    for (const code of visualWorkbenchIssueCodesForZodIssue(issue)) {
      details.push(toIssueDetail(raw, issue, code));
    }
  }

  return uniqueIssueDetails(details);
}

export function summarizeVisualWorkbenchManifest(manifest: VisualWorkbenchManifest): VisualWorkbenchManifestSummary {
  return {
    storyCount: manifest.stories.length,
    features: uniqueSorted(manifest.stories.map((story) => story.feature)),
    widgets: uniqueSorted(manifest.stories.map((story) => story.widget)),
    states: uniqueSorted(manifest.stories.map((story) => story.state)),
    viewportNames: uniqueSorted(manifest.stories.flatMap((story) => story.viewports.map((viewport) => viewport.name))),
    stories: manifest.stories.map((story) => ({
      id: story.id,
      title: story.title,
      kind: story.kind,
      feature: story.feature,
      widget: story.widget,
      state: story.state,
      route: story.render.path,
      mockStateName: story.mockState.name,
      viewportNames: story.viewports.map((viewport) => viewport.name),
      taskRelevanceDefaultFor: story.taskRelevance?.defaultFor ?? [],
    })),
  };
}

function visualWorkbenchIssueCodesForZodIssue(issue: z.core.$ZodIssue): VisualWorkbenchManifestIssueCode[] {
  const customCode = readCustomIssueCode(issue);
  if (customCode) return [customCode];

  const [first, second, third] = issue.path.map(String);
  if (first === "schemaVersion") return ["manifest_schema_unsupported"];
  if (first === "projectClass") return ["project_class_unsupported"];
  if (first === "workbench") {
    if (second === "serveCommand") return ["serve_command_missing"];
    if (second === "storyRoutePattern") return ["story_route_pattern_missing"];
    return ["serve_command_missing", "story_route_pattern_missing"];
  }
  if (first === "coveragePolicy") return ["coverage_policy_unsupported"];
  if (first === "stories" && second == null) return ["strict_state_gap"];
  if (first === "stories") {
    if (third === "kind") return ["story_kind_unsupported"];
    if (third === "viewports") return ["story_viewport_missing"];
    if (third === "render") return ["story_route_pattern_mismatch"];
    return ["story_required_field_missing"];
  }
  return ["story_required_field_missing"];
}

function readCustomIssueCode(issue: z.core.$ZodIssue): VisualWorkbenchManifestIssueCode | null {
  if (issue.code !== "custom") return null;
  const params = "params" in issue ? issue.params : undefined;
  if (!params || typeof params !== "object" || !("visualWorkbenchIssueCode" in params)) return null;
  const code = params.visualWorkbenchIssueCode;
  return isVisualWorkbenchManifestIssueCode(code) ? code : null;
}

function toIssueDetail(
  raw: unknown,
  issue: z.core.$ZodIssue,
  code: VisualWorkbenchManifestIssueCode,
): VisualWorkbenchManifestIssueDetail {
  const path = issue.path.map((part) => typeof part === "number" ? part : String(part));
  const storyIndex = path[0] === "stories" && typeof path[1] === "number" ? path[1] : undefined;
  const storyId = storyIndex != null ? readStoryId(raw, storyIndex) : undefined;
  const keys = readIssueKeys(issue);
  const field = readIssueField(path, keys);
  return {
    code,
    path,
    message: issue.message,
    ...(field ? { field } : {}),
    ...(storyIndex != null ? { storyIndex } : {}),
    ...(storyId ? { storyId } : {}),
    ...(keys.length > 0 ? { keys } : {}),
  };
}

function detectDuplicateStoryIdDetails(raw: unknown): VisualWorkbenchManifestIssueDetail[] {
  if (!isRecord(raw) || !Array.isArray(raw.stories)) return [];
  const seen = new Set<string>();
  const details: VisualWorkbenchManifestIssueDetail[] = [];
  for (let index = 0; index < raw.stories.length; index += 1) {
    const story = raw.stories[index];
    if (!isRecord(story) || typeof story.id !== "string") continue;
    if (seen.has(story.id)) {
      details.push({
        code: "story_id_duplicate",
        path: ["stories", index, "id"],
        message: `Duplicate Visual Workbench story id: ${story.id}`,
        field: "id",
        storyIndex: index,
        storyId: story.id,
      });
      continue;
    }
    seen.add(story.id);
  }
  return details;
}

function readStoryId(raw: unknown, index: number): string | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.stories)) return undefined;
  const story = raw.stories[index];
  if (!isRecord(story) || typeof story.id !== "string") return undefined;
  const storyId = story.id.trim();
  return storyId ? storyId : undefined;
}

function readIssueKeys(issue: z.core.$ZodIssue): string[] {
  const maybeIssue = issue as { keys?: unknown };
  if (!Array.isArray(maybeIssue.keys)) return [];
  return maybeIssue.keys.filter((key): key is string => typeof key === "string");
}

function readIssueField(path: Array<string | number>, keys: string[]): string | undefined {
  if (path[0] === "stories" && typeof path[2] === "string") return path[2];
  return keys[0];
}

function uniqueIssueDetails(details: VisualWorkbenchManifestIssueDetail[]): VisualWorkbenchManifestIssueDetail[] {
  const seen = new Set<string>();
  const result: VisualWorkbenchManifestIssueDetail[] = [];
  for (const detail of details) {
    const key = `${detail.code}\u0000${JSON.stringify(detail.path)}\u0000${detail.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(detail);
  }
  return result;
}

function isVisualWorkbenchManifestIssueCode(value: unknown): value is VisualWorkbenchManifestIssueCode {
  return typeof value === "string" && VISUAL_WORKBENCH_ISSUE_CODE_ORDER.includes(value as VisualWorkbenchManifestIssueCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unique(values: VisualWorkbenchManifestIssueCode[]): VisualWorkbenchManifestIssueCode[] {
  const set = new Set(values);
  return VISUAL_WORKBENCH_ISSUE_CODE_ORDER.filter((code) => set.has(code));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
