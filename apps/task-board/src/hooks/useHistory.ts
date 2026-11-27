"use client";

import { useRef, useCallback } from "react";

export type UndoEntry = {
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

export function useHistory(maxEntries = 50) {
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const isUndoRedoRef = useRef(false);
  const batchRef = useRef<UndoEntry[] | null>(null);

  const push = useCallback(
    (entry: UndoEntry) => {
      if (batchRef.current) {
        batchRef.current.push(entry);
      } else {
        undoStackRef.current.push(entry);
        if (undoStackRef.current.length > maxEntries) undoStackRef.current.shift();
        redoStackRef.current = [];
      }
    },
    [maxEntries]
  );

  const startBatch = useCallback(() => {
    batchRef.current = [];
  }, []);

  const endBatch = useCallback(() => {
    const ops = batchRef.current;
    batchRef.current = null;
    if (ops && ops.length > 0) {
      const entry: UndoEntry = {
        undo: async () => {
          for (const op of [...ops].reverse()) await op.undo();
        },
        redo: async () => {
          for (const op of ops) await op.redo();
        },
      };
      undoStackRef.current.push(entry);
      if (undoStackRef.current.length > maxEntries) undoStackRef.current.shift();
      redoStackRef.current = [];
    }
  }, [maxEntries]);

  const performUndo = useCallback(async () => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    isUndoRedoRef.current = true;
    await entry.undo();
    redoStackRef.current.push(entry);
    isUndoRedoRef.current = false;
  }, []);

  const performRedo = useCallback(async () => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    isUndoRedoRef.current = true;
    await entry.redo();
    undoStackRef.current.push(entry);
    isUndoRedoRef.current = false;
  }, []);

  return { push, startBatch, endBatch, performUndo, performRedo, isUndoRedoRef };
}
