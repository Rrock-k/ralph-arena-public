"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { buildCommitBlocksFromSelection, formatCommitScopeSummary } from "@/lib/commit-scope";
import type { CommitEntry, ManifestDraft, PrepData, ScenarioOption } from "@/lib/schema";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DatePicker } from "@/components/ui/date-picker";
import {
  CheckCircle2,
  AlertCircle,
  Info,
  GitCommit,
  Target,
  FlaskConical,
  Settings2,
  Shield,
  FileText,
  Sparkles,
  Copy,
  Check,
  X,
} from "lucide-react";

type InstructionKey =
  | "commitScope"
  | "reviewTargets"
  | "scenarios"
  | "execution"
  | "environment"
  | "manualProof";

type ManifestResult =
  | {
      success: true;
      manifestId: string;
      manifestPath: string;
      promptPath: string;
      promptText: string;
      summary: string[];
    }
  | {
      success: false;
      error: string;
    }
  | null;

function formatLocalDate(dateString: string) {
  return new Date(dateString).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function scenarioIdsForLane(options: ScenarioOption[], lane: ScenarioOption["lane"]) {
  return options.filter((o) => o.lane === lane).map((o) => o.id);
}

export function A2EStudio({ prep }: { prep: PrepData }) {
  const [batchLabel, setBatchLabel] = useState("a2e-operator-run");
  const [selectedCommitShas, setSelectedCommitShas] = useState<string[]>(
    prep.recentCommits.slice(0, Math.min(3, prep.recentCommits.length)).map((c) => c.sha),
  );
  const [selectedReviewTargets, setSelectedReviewTargets] = useState<string[]>(prep.reviewTargets);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>(
    prep.scenarioOptions.filter((o) => o.defaultSelected).map((o) => o.id),
  );
  const [extraReviewTarget, setExtraReviewTarget] = useState("");
  const [customInstructions, setCustomInstructions] = useState<Record<InstructionKey, string>>({
    commitScope: "",
    reviewTargets: "",
    scenarios: "",
    execution: "",
    environment: "",
    manualProof: "",
  });
  const [localFullSweep, setLocalFullSweep] = useState(true);
  const [manualFirstStrict, setManualFirstStrict] = useState(true);
  const [refreshLivingSpec, setRefreshLivingSpec] = useState(true);
  const [cleanupBeforeReport, setCleanupBeforeReport] = useState(true);
  const [strictFreeze, setStrictFreeze] = useState(false);
  const [allowDirtyRepos, setAllowDirtyRepos] = useState(true);
  const [promptStyle, setPromptStyle] = useState<"summary_first" | "minimal">("summary_first");
  const [isSaving, setIsSaving] = useState(false);
  const [manifestResult, setManifestResult] = useState<ManifestResult>(null);
  const [anchorCommitIndex, setAnchorCommitIndex] = useState<number | null>(
    prep.recentCommits.length > 0 ? Math.min(2, prep.recentCommits.length - 1) : null,
  );
  const [copied, setCopied] = useState(false);
  const [allCommits, setAllCommits] = useState<CommitEntry[]>(prep.recentCommits);
  const [hasMoreCommits, setHasMoreCommits] = useState(prep.recentCommits.length >= 200);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
  const lastShiftClickRef = useRef(false);

  const loadMoreCommits = useCallback(async () => {
    if (loadingMore || !hasMoreCommits) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/commits?skip=${allCommits.length}&limit=200`);
      if (!res.ok) return;
      const data = await res.json();
      const newCommits = data.commits as CommitEntry[];
      if (newCommits.length === 0) {
        setHasMoreCommits(false);
        return;
      }
      const existingShas = new Set(allCommits.map((c) => c.sha));
      const deduped = newCommits.filter((c) => !existingShas.has(c.sha));
      setAllCommits((prev) => [...prev, ...deduped]);
      setHasMoreCommits(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [allCommits, hasMoreCommits, loadingMore]);

  const filteredCommits = useMemo(() => {
    if (!dateFrom && !dateTo) return allCommits;
    return allCommits.filter((c) => {
      const t = new Date(c.authoredAt).getTime();
      if (dateFrom && t < dateFrom.getTime()) return false;
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        if (t > end.getTime()) return false;
      }
      return true;
    });
  }, [allCommits, dateFrom, dateTo]);

  const lane1Ids = useMemo(() => scenarioIdsForLane(prep.scenarioOptions, "lane_1"), [prep.scenarioOptions]);
  const lane2Ids = useMemo(() => scenarioIdsForLane(prep.scenarioOptions, "lane_2"), [prep.scenarioOptions]);
  const lane3Ids = useMemo(() => scenarioIdsForLane(prep.scenarioOptions, "lane_3"), [prep.scenarioOptions]);

  const selectedCommitEntries = useMemo(
    () => allCommits.filter((c) => selectedCommitShas.includes(c.sha)),
    [allCommits, selectedCommitShas],
  );
  const selectedCommitBlocks = useMemo(
    () => buildCommitBlocksFromSelection(selectedCommitShas, allCommits),
    [allCommits, selectedCommitShas],
  );

  const draft: ManifestDraft = useMemo(
    () => ({
      batchLabel,
      selectedCommitShas,
      selectedScenarioIds,
      selectedReviewTargets,
      settings: {
        localFullSweep,
        includeLane1: lane1Ids.some((id) => selectedScenarioIds.includes(id)),
        includeLane3LocalSubset: lane3Ids.some((id) => selectedScenarioIds.includes(id)),
        includeVpsSymphoSmoke: lane2Ids.some((id) => selectedScenarioIds.includes(id)),
        manualFirstStrict,
        refreshLivingSpec,
        cleanupBeforeReport,
        strictFreeze,
        allowDirtyRepos,
        promptStyle,
      },
      customInstructions,
    }),
    [
      allowDirtyRepos, batchLabel, cleanupBeforeReport, customInstructions,
      lane1Ids, lane2Ids, lane3Ids, localFullSweep, manualFirstStrict,
      promptStyle, refreshLivingSpec, selectedCommitShas, selectedReviewTargets,
      selectedScenarioIds, strictFreeze,
    ],
  );

  const dirtyRepos = prep.repos.filter((r) => !r.clean);

  const summaryLines = useMemo(() => {
    const commitSummary =
      selectedCommitEntries.length > 0
        ? formatCommitScopeSummary(selectedCommitBlocks)
        : "Коммиты не выбраны";
    const scenarioSummary =
      prep.scenarioOptions
        .filter((o) => selectedScenarioIds.includes(o.id))
        .map((o) => o.label)
        .join(", ") || "Сценарии не выбраны";
    return [
      { label: "Батч", value: batchLabel || "\u2014" },
      { label: "Коммиты", value: commitSummary },
      { label: "Задачи", value: selectedReviewTargets.join(", ") || "нет" },
      { label: "Сценарии", value: scenarioSummary },
      {
        label: "Режим",
        value: `${localFullSweep ? "Полный прогон" : "Точечный"}${lane2Ids.some((id) => selectedScenarioIds.includes(id)) ? " + VPS smoke" : ""}`,
      },
      {
        label: "Заморозка",
        value: strictFreeze ? "Строгая" : allowDirtyRepos ? "Грязные допустимы" : "Только снапшот",
      },
    ];
  }, [
    allowDirtyRepos, batchLabel, lane2Ids, localFullSweep, prep.scenarioOptions,
    selectedCommitBlocks, selectedCommitEntries, selectedReviewTargets,
    selectedScenarioIds, strictFreeze,
  ]);

  function updateInstruction(key: InstructionKey, value: string) {
    setCustomInstructions((c) => ({ ...c, [key]: value }));
  }

  function toggleCommit(index: number, checked: boolean) {
    const commit = allCommits[index];
    if (!commit) return;
    setSelectedCommitShas((current) => {
      const next = new Set(current);
      if (lastShiftClickRef.current && anchorCommitIndex !== null) {
        const [start, end] = [anchorCommitIndex, index].sort((a, b) => a - b);
        for (let i = start; i <= end; i++) {
          const c = allCommits[i];
          if (!c) continue;
          if (checked) next.add(c.sha);
          else next.delete(c.sha);
        }
      } else if (checked) {
        next.add(commit.sha);
      } else {
        next.delete(commit.sha);
      }
      return allCommits.filter((e) => next.has(e.sha)).map((e) => e.sha);
    });
    setAnchorCommitIndex(index);
  }

  function toggleReviewTarget(target: string, checked: boolean) {
    setSelectedReviewTargets((c) => {
      const next = new Set(c);
      if (checked) next.add(target);
      else next.delete(target);
      return Array.from(next);
    });
  }

  function addReviewTarget() {
    const value = extraReviewTarget.trim().toUpperCase();
    if (!value) return;
    setSelectedReviewTargets((c) => (c.includes(value) ? c : [...c, value]));
    setExtraReviewTarget("");
  }

  function toggleScenario(id: string, checked: boolean) {
    setSelectedScenarioIds((c) => {
      const next = new Set(c);
      if (checked) next.add(id);
      else next.delete(id);
      return prep.scenarioOptions.filter((o) => next.has(o.id)).map((o) => o.id);
    });
  }

  function toggleScenarioGroup(ids: string[], checked: boolean) {
    setSelectedScenarioIds((c) => {
      const next = new Set(c);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return prep.scenarioOptions.filter((o) => next.has(o.id)).map((o) => o.id);
    });
  }

  async function saveManifest() {
    setIsSaving(true);
    setManifestResult(null);
    try {
      const response = await fetch("/api/manifests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = (await response.json()) as Exclude<ManifestResult, null>;
      setManifestResult(
        response.ok ? result : { success: false, error: "error" in result ? result.error : "Не удалось сгенерировать манифест" },
      );
    } catch (error) {
      setManifestResult({ success: false, error: error instanceof Error ? error.message : "Не удалось сгенерировать манифест" });
    } finally {
      setIsSaving(false);
    }
  }

  async function copyPrompt(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-[1520px] px-6 py-8">
      {/* Hero */}
      <div className="mb-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-1">A2E Studio</p>
          <h1 className="text-3xl font-bold tracking-tight mb-3">
            Панель управления A2E прогонами
          </h1>
          <p className="text-muted-foreground leading-relaxed max-w-lg">
            Выберите точный набор коммитов, сценарии и правила оператора, затем сгенерируйте короткий промпт,
            который указывает Claude на сохранённый манифест в <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">a2e/state/manifests</code>.
          </p>
          <Link href="/manifests" className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-primary hover:underline">
            <FileText className="h-3.5 w-3.5" />
            Каталог манифестов
          </Link>
        </div>
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Сводка промпта
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {summaryLines.map((line) => (
              <div key={line.label} className="flex gap-2 text-sm">
                <span className="text-muted-foreground shrink-0 w-24">{line.label}</span>
                <span className="font-medium truncate">{line.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Main grid */}
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        {/* Left column */}
        <div className="space-y-6">
          {/* 1. Commit Scope */}
          <SectionCard
            icon={<GitCommit className="h-4 w-4" />}
            number={1}
            title="Область коммитов"
            description="Shift-выделение точных коммитов, которые Claude должен заново проверить."
          >
            <div className="flex gap-2 items-center flex-wrap">
              <Input
                className="flex-1 min-w-[200px]"
                value={batchLabel}
                onChange={(e) => setBatchLabel(e.target.value)}
                placeholder="Метка батча"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedCommitShas(allCommits.map((c) => c.sha));
                  setAnchorCommitIndex(0);
                }}
              >
                Выбрать все
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedCommitShas([]);
                  setAnchorCommitIndex(null);
                }}
              >
                Сбросить
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Период:</span>
              <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="от" className="w-[150px]" />
              <DatePicker value={dateTo} onChange={setDateTo} placeholder="до" className="w-[150px]" />
              {(dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
                  <X className="h-3 w-3" />
                  Сбросить
                </Button>
              )}
              {(dateFrom || dateTo) && (
                <span className="text-xs text-muted-foreground">
                  {filteredCommits.length} из {allCommits.length}
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Клик ставит якорь. Shift+клик переключает весь непрерывный блок. Повторите для нескольких блоков.
            </p>

            {selectedCommitBlocks.length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Выбранные блоки
                </p>
                {selectedCommitBlocks.map((block) => (
                  <div key={`${block.baseSha}-${block.headSha}`} className="flex items-center justify-between">
                    <div>
                      <span className="font-mono text-sm font-semibold">
                        {block.commitCount === 1
                          ? block.headShortSha
                          : `${block.baseShortSha}..${block.headShortSha}`}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {block.commitCount} коммит{block.commitCount === 1 ? "" : block.commitCount < 5 ? "а" : "ов"}
                      </span>
                    </div>
                    <Badge variant="success">блок</Badge>
                  </div>
                ))}
              </div>
            )}

            <ScrollArea className="h-[420px] rounded-lg border select-none">
              <div className="divide-y">
                {filteredCommits.map((commit) => {
                  const index = allCommits.indexOf(commit);
                  const checked = selectedCommitShas.includes(commit.sha);
                  return (
                    <CommitRow
                      key={commit.sha}
                      commit={commit}
                      checked={checked}
                      isAnchor={anchorCommitIndex === index}
                      onPointerDown={(e) => {
                        if (e.shiftKey) e.preventDefault();
                        lastShiftClickRef.current = e.shiftKey;
                      }}
                      onCheckedChange={(v) => toggleCommit(index, v)}
                      onClick={(e) => {
                        lastShiftClickRef.current = e.shiftKey;
                      }}
                    />
                  );
                })}
                {hasMoreCommits && (
                  <div className="flex justify-center py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={loadingMore}
                      onClick={loadMoreCommits}
                    >
                      {loadingMore ? "Загрузка\u2026" : `Загрузить ещё (загружено ${allCommits.length})`}
                    </Button>
                  </div>
                )}
              </div>
            </ScrollArea>

            <CustomInstruction
              label="Инструкция для области коммитов"
              value={customInstructions.commitScope}
              onChange={(v) => updateInstruction("commitScope", v)}
              placeholder="Пример: обратить особое внимание на loop init payloads в этих коммитах."
            />
          </SectionCard>

          {/* 2. Review Targets */}
          <SectionCard
            icon={<Target className="h-4 w-4" />}
            number={2}
            title="Задачи для ревью"
            description="Явно задайте scope на уровне задач."
          >
            <div className="flex flex-wrap gap-2">
              {selectedReviewTargets
                .concat(prep.reviewTargets.filter((t) => !selectedReviewTargets.includes(t)))
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((target) => {
                  const active = selectedReviewTargets.includes(target);
                  return (
                    <button
                      key={target}
                      onClick={() => toggleReviewTarget(target, !active)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-mono font-medium transition-colors",
                        active
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {active && <Check className="h-3 w-3" />}
                      {target}
                    </button>
                  );
                })}
            </div>
            <div className="flex gap-2">
              <Input
                className="flex-1"
                value={extraReviewTarget}
                onChange={(e) => setExtraReviewTarget(e.target.value)}
                placeholder="Добавить задачу, напр. RA-160"
                onKeyDown={(e) => e.key === "Enter" && addReviewTarget()}
              />
              <Button size="sm" onClick={addReviewTarget}>Добавить</Button>
            </div>
            <CustomInstruction
              label="Инструкция для задач ревью"
              value={customInstructions.reviewTargets}
              onChange={(v) => updateInstruction("reviewTargets", v)}
              placeholder="Пример: RA-108 не может быть PASS без реального перезапуска + архивных данных."
            />
          </SectionCard>

          {/* 3. Scenario Matrix */}
          <SectionCard
            icon={<FlaskConical className="h-4 w-4" />}
            number={3}
            title="Матрица сценариев"
            description="Переключайте целые линии, затем настраивайте отдельные проверки."
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <LaneToggle
                label="Линия 1 Core"
                description="Локальные Playwright тесты"
                checked={lane1Ids.every((id) => selectedScenarioIds.includes(id))}
                onChange={(v) => toggleScenarioGroup(lane1Ids, v)}
              />
              <LaneToggle
                label="Линия 3 Local"
                description="Ручные + исправления"
                checked={lane3Ids.every((id) => selectedScenarioIds.includes(id))}
                onChange={(v) => toggleScenarioGroup(lane3Ids, v)}
              />
              <LaneToggle
                label="VPS Smoke"
                description="Удалённый Sympho smoke"
                checked={lane2Ids.every((id) => selectedScenarioIds.includes(id))}
                onChange={(v) => toggleScenarioGroup(lane2Ids, v)}
              />
            </div>

            <div className="space-y-2">
              {prep.scenarioOptions.map((scenario) => {
                const checked = selectedScenarioIds.includes(scenario.id);
                return (
                  <label
                    key={scenario.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                      checked ? "border-primary/20 bg-primary/[0.03]" : "hover:bg-muted/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleScenario(scenario.id, v === true)}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{scenario.label}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{scenario.lane}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{scenario.description}</p>
                    </div>
                  </label>
                );
              })}
            </div>

            <CustomInstruction
              label="Инструкция для сценариев"
              value={customInstructions.scenarios}
              onChange={(v) => updateInstruction("scenarios", v)}
              placeholder="Пример: сегодня без VPS, но полная локальная матрица."
            />
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* 4. Execution Rules */}
          <SectionCard
            icon={<Settings2 className="h-4 w-4" />}
            number={4}
            title="Правила выполнения"
            description="Определите, насколько строгим и дорогим будет прогон."
          >
            <div className="space-y-4">
              <SwitchRow
                id="localFullSweep"
                label="Полный локальный прогон"
                description="Вся платформа + циклы, а не узкий smoke."
                checked={localFullSweep}
                onCheckedChange={setLocalFullSweep}
              />
              <SwitchRow
                id="manualFirstStrict"
                label="Строгий ручной приоритет"
                description="Пользовательские фичи требуют свежего ручного подтверждения."
                checked={manualFirstStrict}
                onCheckedChange={setManualFirstStrict}
              />
              <SwitchRow
                id="refreshLivingSpec"
                label="Обновить living spec"
                description="Просмотреть коммиты и обновить чеклисты перед прогоном."
                checked={refreshLivingSpec}
                onCheckedChange={setRefreshLivingSpec}
              />
              <SwitchRow
                id="cleanupBeforeReport"
                label="Очистка перед отчётом"
                description="Принудительная очистка перед генерацией итогового отчёта."
                checked={cleanupBeforeReport}
                onCheckedChange={setCleanupBeforeReport}
              />
            </div>
            <CustomInstruction
              label="Инструкция для выполнения"
              value={customInstructions.execution}
              onChange={(v) => updateInstruction("execution", v)}
              placeholder="Пример: доказать unified Ops только через новый /dashboard/admin/ops path."
            />
          </SectionCard>

          {/* 5. Environment & Freeze */}
          <SectionCard
            icon={<Shield className="h-4 w-4" />}
            number={5}
            title="Окружение и заморозка"
            description="Баланс между воспроизводимостью и удобством."
          >
            <div className="space-y-4">
              <SwitchRow
                id="strictFreeze"
                label="Строгая заморозка"
                description="Блокировать прогон, если какой-то репо грязный."
                checked={strictFreeze}
                onCheckedChange={setStrictFreeze}
              />
              <SwitchRow
                id="allowDirtyRepos"
                label="Разрешить грязные репо"
                description="Записать снапшот, но не блокировать из-за грязности."
                checked={allowDirtyRepos}
                onCheckedChange={setAllowDirtyRepos}
              />
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Снапшот репозиториев
              </p>
              {prep.repos.map((repo) => (
                <div key={repo.name} className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold truncate">{repo.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {repo.headShaShort ?? "неизвестно"} {repo.headTitle ? `\u00b7 ${repo.headTitle}` : ""}
                    </p>
                  </div>
                  <Badge variant={repo.clean ? "success" : "warning"}>
                    {repo.clean ? "чисто" : "грязно"}
                  </Badge>
                </div>
              ))}
              {dirtyRepos.length > 0 && (
                <p className="text-xs text-muted-foreground pt-1">
                  Грязные репо будут записаны в манифест. Строгая заморозка определяет, станет ли это блокером.
                </p>
              )}
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
                Стиль промпта
              </p>
              <RadioGroup
                value={promptStyle}
                onValueChange={(v) => setPromptStyle(v as typeof promptStyle)}
                className="grid grid-cols-2 gap-3"
              >
                <label
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    promptStyle === "summary_first" ? "border-primary/30 bg-primary/[0.03]" : "hover:bg-muted/50",
                  )}
                >
                  <RadioGroupItem value="summary_first" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">Сначала сводка</p>
                    <p className="text-xs text-muted-foreground">Читаемая сводка в начале промпта.</p>
                  </div>
                </label>
                <label
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
                    promptStyle === "minimal" ? "border-primary/30 bg-primary/[0.03]" : "hover:bg-muted/50",
                  )}
                >
                  <RadioGroupItem value="minimal" className="mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">Минимальный</p>
                    <p className="text-xs text-muted-foreground">Короткий промпт, детали в манифесте.</p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <CustomInstruction
              label="Инструкция для окружения"
              value={customInstructions.environment}
              onChange={(v) => updateInstruction("environment", v)}
              placeholder="Пример: сегодня не блокировать из-за грязности raleph, просто записать в отчёт."
            />
          </SectionCard>

          {/* 6. Manual Proof Notes */}
          <SectionCard
            icon={<FileText className="h-4 w-4" />}
            number={6}
            title="Ручная верификация"
            description="Укажите Claude, как проводить ручной обход."
          >
            <CustomInstruction
              label="Инструкция для ручной верификации"
              value={customInstructions.manualProof}
              onChange={(v) => updateInstruction("manualProof", v)}
              placeholder="Пример: для превью и галереи всегда делать хотя бы один скриншот на фичу."
            />
          </SectionCard>

          {/* 7. Generate */}
          <SectionCard
            icon={<Sparkles className="h-4 w-4" />}
            number={7}
            title="Генерация манифеста"
            description="Сохраните и передайте Claude сгенерированный короткий промпт."
          >
            <Button className="w-full" disabled={isSaving} onClick={saveManifest}>
              {isSaving ? "Сохранение\u2026" : "Сохранить манифест + промпт"}
            </Button>

            {manifestResult?.success && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    Манифест готов
                  </div>
                  <ul className="text-sm space-y-0.5 list-disc pl-5 text-emerald-800">
                    {manifestResult.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-emerald-600 font-mono pt-1">
                    {manifestResult.manifestPath} &middot; {manifestResult.promptPath}
                  </p>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Сгенерированный промпт
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={() => copyPrompt(manifestResult.promptText)}
                    >
                      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied ? "Скопировано" : "Копировать"}
                    </Button>
                  </div>
                  <Textarea
                    className="font-mono text-xs min-h-[260px]"
                    readOnly
                    value={manifestResult.promptText}
                  />
                </div>
              </div>
            )}
            {manifestResult?.success === false && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-center gap-2 text-red-700 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {manifestResult.error}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </main>
  );
}

/* ── Sub-components ─────────────────────────────────────────────────── */

function SectionCard({
  icon,
  number,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          <span className="text-xs text-muted-foreground font-mono">{number}.</span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function CommitRow({
  commit,
  checked,
  isAnchor,
  onPointerDown,
  onCheckedChange,
  onClick,
}: {
  commit: CommitEntry;
  checked: boolean;
  isAnchor: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onCheckedChange: (checked: boolean) => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors",
        checked ? "bg-primary/[0.04]" : "hover:bg-muted/40",
      )}
      onPointerDownCapture={onPointerDown}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        onClick={onClick}
        className="mt-0.5"
      />
      <span className="text-sm font-semibold leading-snug truncate min-w-0 flex-1">{commit.subject}</span>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {commit.primaryTask && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="secondary" className="text-[10px] font-bold px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200 cursor-help">
                {commit.primaryTask.id}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="font-mono text-xs">
                {commit.primaryTask.id} &middot; [{commit.primaryTask.status ?? "UNKNOWN"}]
              </p>
              <p className="text-xs">{commit.primaryTask.title ?? "Задача не найдена в бэклоге"}</p>
            </TooltipContent>
          </Tooltip>
        )}
        <span className="text-xs text-muted-foreground font-mono">{commit.shortSha}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">{formatLocalDate(commit.authoredAt)}</span>
        {isAnchor && <Badge variant="outline" className="text-[9px] px-1 py-0">якорь</Badge>}
      </div>
    </label>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-semibold cursor-pointer">{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function LaneToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors",
        checked ? "border-primary/20 bg-primary/[0.03]" : "hover:bg-muted/50",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

function CustomInstruction({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-h-[80px] text-sm"
      />
    </div>
  );
}
