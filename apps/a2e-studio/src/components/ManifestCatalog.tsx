"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ManifestListEntry } from "@/lib/a2e-ops";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ArrowDownAZ,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Clock,
  FileJson,
  FileText,
  GitCommit,
  FlaskConical,
  Target,
} from "lucide-react";

type SortKey = "date" | "batch" | "commits" | "scenarios";
type SortDir = "asc" | "desc";

function sortManifests(list: ManifestListEntry[], key: SortKey, dir: SortDir): ManifestListEntry[] {
  const sorted = [...list].sort((a, b) => {
    switch (key) {
      case "date":
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      case "batch":
        return a.batchLabel.localeCompare(b.batchLabel);
      case "commits":
        return a.commitCount - b.commitCount;
      case "scenarios":
        return a.scenarioCount - b.scenarioCount;
    }
  });
  return dir === "desc" ? sorted.reverse() : sorted;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const SORT_OPTIONS: { key: SortKey; label: string; icon: typeof Clock }[] = [
  { key: "date", label: "Дата", icon: Clock },
  { key: "batch", label: "Батч", icon: ArrowDownAZ },
  { key: "commits", label: "Коммиты", icon: GitCommit },
  { key: "scenarios", label: "Сценарии", icon: FlaskConical },
];

export function ManifestCatalog({ manifests }: { manifests: ManifestListEntry[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    let list = manifests;
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      list = list.filter((m) => new Date(m.createdAt).getTime() >= from);
    }
    if (dateTo) {
      const to = new Date(dateTo + "T23:59:59").getTime();
      list = list.filter((m) => new Date(m.createdAt).getTime() <= to);
    }
    return list;
  }, [manifests, dateFrom, dateTo]);

  const sorted = useMemo(() => sortManifests(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setPromptText(null);
      return;
    }
    setExpandedId(id);
    setPromptText(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/manifests/${id}`);
      if (res.ok) {
        const data = await res.json();
        setPromptText(data.promptText);
      }
    } finally {
      setLoading(false);
    }
  }

  async function copyPrompt(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Студия
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Каталог манифестов</h1>
          <p className="text-sm text-muted-foreground">
            {manifests.length} сохранённых манифест{manifests.length === 1 ? "" : manifests.length < 5 ? "а" : "ов"} в <code className="text-xs bg-muted px-1 py-0.5 rounded font-mono">a2e/state/manifests</code>
          </p>
        </div>
      </div>

      {manifests.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Манифестов пока нет. Сгенерируйте первый из Студии.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Сортировка</span>
              {SORT_OPTIONS.map((opt) => {
                const active = sortKey === opt.key;
                const Icon = opt.icon;
                return (
                  <Button
                    key={opt.key}
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    className={cn("h-7 text-xs gap-1", active && "font-semibold")}
                    onClick={() => handleSort(opt.key)}
                  >
                    <Icon className="h-3 w-3" />
                    {opt.label}
                    {active && (
                      <span className="text-[10px] text-muted-foreground">{sortDir === "desc" ? "\u2193" : "\u2191"}</span>
                    )}
                  </Button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">от</span>
              <Input
                type="date"
                className="h-7 w-36 text-xs"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">до</span>
              <Input
                type="date"
                className="h-7 w-36 text-xs"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
              {(dateFrom || dateTo) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                >
                  Сбросить
                </Button>
              )}
            </div>
          </div>

          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Нет манифестов за выбранный период.
            </p>
          ) : (
          <div className="space-y-3">
          {sorted.map((m) => {
            const isExpanded = expandedId === m.manifestId;
            return (
              <Card key={m.manifestId} className={cn(isExpanded && "ring-1 ring-primary/20")}>
                <button
                  className="w-full text-left"
                  onClick={() => toggleExpand(m.manifestId)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="flex items-center gap-2 text-sm">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-mono truncate">{m.manifestId}</span>
                        </CardTitle>
                        <CardDescription className="pl-6">
                          {formatDate(m.createdAt)}
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="gap-1 text-xs">
                          <GitCommit className="h-3 w-3" />
                          {m.commitCount}
                        </Badge>
                        <Badge variant="outline" className="gap-1 text-xs">
                          <FlaskConical className="h-3 w-3" />
                          {m.scenarioCount}
                        </Badge>
                        {m.reviewTargets.length > 0 && (
                          <Badge variant="outline" className="gap-1 text-xs">
                            <Target className="h-3 w-3" />
                            {m.reviewTargets.length}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                </button>

                {isExpanded && (
                  <CardContent className="space-y-4 pt-0">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pl-6">
                      <div>
                        <p className="text-xs text-muted-foreground">Батч</p>
                        <p className="text-sm font-medium">{m.batchLabel}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Блоки</p>
                        <p className="text-sm font-medium">{m.blockCount}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Стиль промпта</p>
                        <p className="text-sm font-medium">{m.promptStyle}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Задачи</p>
                        <p className="text-sm font-medium">{m.reviewTargets.join(", ") || "\u2014"}</p>
                      </div>
                    </div>

                    <div className="pl-6 flex gap-2 text-xs text-muted-foreground font-mono">
                      <span className="flex items-center gap-1">
                        <FileJson className="h-3 w-3" />
                        {m.manifestPath}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="h-3 w-3" />
                        {m.promptPath}
                      </span>
                    </div>

                    {loading && (
                      <p className="pl-6 text-sm text-muted-foreground">Загрузка промпта...</p>
                    )}

                    {promptText !== null && (
                      <div className="pl-6 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Промпт
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyPrompt(promptText);
                            }}
                          >
                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                            {copied ? "Скопировано" : "Копировать"}
                          </Button>
                        </div>
                        <Textarea
                          className="font-mono text-xs min-h-[200px]"
                          readOnly
                          value={promptText}
                        />
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
          </div>
          )}
        </div>
      )}
    </main>
  );
}
