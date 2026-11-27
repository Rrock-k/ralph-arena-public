"use client";

import { useState, useEffect, useCallback } from "react";
import { TestWizard } from "./TestWizard";
import { PreviewIframe } from "@/components/preview/PreviewIframe";

interface TestRequestEvent {
  id: string;
  projectId: string;
  direction: "out";
  type: "test_request";
  payload: {
    title: string;
    steps: { question: string }[];
    url?: string;
  };
  createdAt: string;
}

interface TestResultEvent {
  id: string;
  projectId: string;
  direction: "in";
  type: "test_result";
  payload: {
    testRequestEventId: string;
    results: { stepIndex: number; passed: boolean; comment?: string }[];
  };
  userId?: string;
  createdAt: string;
}

type AnyEvent = TestRequestEvent | TestResultEvent;

interface TestsTabProps {
  projectId: string;
  previewUrl: string | null;
  initialEvents: AnyEvent[];
}

export function TestsTab({ projectId, previewUrl, initialEvents }: TestsTabProps) {
  const [events, setEvents] = useState<AnyEvent[]>(initialEvents);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  // SSE for real-time updates
  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/events/stream`);

    es.addEventListener("catchup", (e) => {
      try {
        const { events: catchupEvents } = JSON.parse(e.data);
        setEvents(catchupEvents);
      } catch { /* ignore */ }
    });

    es.addEventListener("project_event", (e) => {
      try {
        const { events: newEvents } = JSON.parse(e.data);
        // Deduplicate by id
        setEvents((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          const unique = newEvents.filter((ne: AnyEvent) => !ids.has(ne.id));
          return [...prev, ...unique];
        });
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      // EventSource will auto-reconnect; close permanently only on fatal errors
      if (es.readyState === EventSource.CLOSED) {
        console.warn("[TestsTab] SSE connection closed permanently");
      }
    };

    return () => es.close();
  }, [projectId]);

  const testRequests = events.filter(
    (e): e is TestRequestEvent => e.type === "test_request" && e.direction === "out",
  );
  const testResults = events.filter(
    (e): e is TestResultEvent => e.type === "test_result" && e.direction === "in",
  );

  const selectedTest = testRequests.find((t) => t.id === selectedTestId) ?? null;
  const selectedTestResults = testResults.filter(
    (r) => r.payload.testRequestEventId === selectedTestId,
  );

  const handleResultSubmitted = useCallback((newEvent: AnyEvent) => {
    setEvents((prev) => [...prev, newEvent]);
  }, []);

  if (testRequests.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <div className="text-4xl mb-3">🧪</div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
          No tests yet
        </h3>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          When the agent requests community QA, test cases will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4 min-h-[500px]">
      {/* Test list (left) */}
      <div className="w-72 shrink-0 space-y-2">
        {testRequests.map((test) => {
          const resultsForTest = testResults.filter(
            (r) => r.payload.testRequestEventId === test.id,
          );
          const isCompleted = resultsForTest.length > 0;
          const isSelected = test.id === selectedTestId;

          return (
            <button
              key={test.id}
              onClick={() => setSelectedTestId(test.id)}
              className={`w-full rounded-lg border p-3 text-left transition-all ${
                isSelected
                  ? "border-violet-400 bg-violet-50 dark:border-violet-500 dark:bg-violet-500/10"
                  : "border-gray-200 bg-white hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                  {test.payload.title}
                </span>
                {isCompleted ? (
                  <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                    done
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                    pending
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-slate-400">
                {test.payload.steps.length} step{test.payload.steps.length !== 1 ? "s" : ""}
                {test.payload.url && " · has test URL"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Right panel: wizard + iframe */}
      <div className="flex-1 min-w-0">
        {selectedTest ? (
          <div className="space-y-4">
            {/* Iframe */}
            {(selectedTest.payload.url || previewUrl) && (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
                <PreviewIframe
                  previewUrl={selectedTest.payload.url || previewUrl!}
                  proposalTitle="Test preview"
                  projectId={projectId}
                  iframeClassName="h-[350px] w-full border-0"
                  fallbackClassName="flex h-[350px] w-full flex-col items-center justify-center gap-2 px-4 text-center text-gray-500 dark:text-slate-400"
                />
              </div>
            )}

            {/* Wizard */}
            <TestWizard
              key={selectedTest.id}
              test={selectedTest}
              existingResults={selectedTestResults}
              projectId={projectId}
              onResultSubmitted={handleResultSubmitted}
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/30">
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Select a test to begin
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
