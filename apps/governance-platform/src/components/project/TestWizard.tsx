"use client";

import { useState } from "react";
import { toast } from "sonner";

interface TestRequestEvent {
  id: string;
  projectId: string;
  payload: {
    title: string;
    steps: { question: string }[];
    url?: string;
  };
}

interface TestResultEvent {
  id: string;
  payload: {
    testRequestEventId: string;
    results: { stepIndex: number; passed: boolean; comment?: string }[];
  };
  createdAt: string;
}

interface TestWizardProps {
  test: TestRequestEvent;
  existingResults: TestResultEvent[];
  projectId: string;
  onResultSubmitted: (event: any) => void;
}

export function TestWizard({ test, existingResults, projectId, onResultSubmitted }: TestWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [results, setResults] = useState<Array<{ passed: boolean; comment: string }>>([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [retesting, setRetesting] = useState(false);

  const steps = test.payload.steps;
  const totalSteps = steps.length;

  // Show existing results if any
  if (existingResults.length > 0 && !submitted && !retesting) {
    const latest = existingResults[existingResults.length - 1];
    const allPassed = latest.payload.results.every((r) => r.passed);

    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">
          {test.payload.title}
        </h3>
        <div className={`rounded-lg border p-4 mb-4 ${
          allPassed
            ? "border-emerald-400/25 bg-emerald-500/10"
            : "border-rose-400/25 bg-rose-500/10"
        }`}>
          <div className="text-sm font-medium mb-2 text-gray-900 dark:text-slate-100">
            {allPassed ? "All steps passed" : "Some steps failed"}
          </div>
          <div className="space-y-1">
            {latest.payload.results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300">
                <span>{r.passed ? "✓" : "✗"}</span>
                <span>{steps[r.stepIndex]?.question ?? `Step ${r.stepIndex + 1}`}</span>
                {r.comment && <span className="text-gray-400">— {r.comment}</span>}
              </div>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            setResults([]);
            setCurrentStep(0);
            setComment("");
            setSubmitted(false);
            setRetesting(true);
          }}
          className="text-sm text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
        >
          Re-test
        </button>
      </div>
    );
  }

  // Submission confirmation
  if (submitted) {
    const allPassed = results.every((r) => r.passed);
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-2">
          {test.payload.title}
        </h3>
        <div className={`rounded-lg border p-4 ${
          allPassed
            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-300"
        }`}>
          <p className="font-medium">
            {allPassed ? "All steps passed!" : "Test completed with failures."}
          </p>
          <p className="text-sm mt-1 opacity-80">Result submitted. The agent will receive your feedback.</p>
        </div>
      </div>
    );
  }

  // Active wizard
  const step = steps[currentStep];

  async function handleAnswer(passed: boolean) {
    const newResults = [...results, { passed, comment: comment.trim() }];
    setResults(newResults);
    setComment("");

    if (currentStep + 1 < totalSteps) {
      setCurrentStep(currentStep + 1);
      return;
    }

    // Last step — submit
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "test_result",
          payload: {
            testRequestEventId: test.id,
            results: newResults.map((r, i) => ({
              stepIndex: i,
              passed: r.passed,
              comment: r.comment || undefined,
            })),
          },
        }),
      });
      if (!res.ok) {
        toast.error("Failed to submit test result. Please try again.");
        return;
      }
      const data = await res.json();
      onResultSubmitted({
        id: data.id,
        projectId,
        direction: "in",
        type: "test_result",
        payload: {
          testRequestEventId: test.id,
          results: newResults.map((r, i) => ({
            stepIndex: i,
            passed: r.passed,
            comment: r.comment || undefined,
          })),
        },
        createdAt: new Date().toISOString(),
      });
      setSubmitted(true);
    } catch {
      toast.error("Failed to submit test result. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
        {test.payload.title}
      </h3>
      <div className="text-xs text-gray-500 dark:text-slate-400 mb-4">
        Step {currentStep + 1} of {totalSteps}
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-slate-700 mb-6">
        <div
          className="h-1 rounded-full bg-violet-500 transition-all"
          style={{ width: `${(results.length / totalSteps) * 100}%` }}
        />
      </div>

      {/* Question */}
      <p className="text-base text-gray-900 dark:text-slate-100 mb-4">
        {step.question}
      </p>

      {/* Comment */}
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment..."
        rows={2}
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-violet-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 mb-4"
      />

      {/* Yes / No buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => handleAnswer(true)}
          disabled={submitting}
          className="flex-1 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {currentStep + 1 === totalSteps ? "Yes — Submit" : "Yes"}
        </button>
        <button
          onClick={() => handleAnswer(false)}
          disabled={submitting}
          className="flex-1 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-50"
        >
          {currentStep + 1 === totalSteps ? "No — Submit" : "No"}
        </button>
      </div>
    </div>
  );
}
