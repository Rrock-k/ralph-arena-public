import {
  exportRalphLoopMap,
  type RalphLoopDecision,
  type RalphLoopMap,
  type RalphLoopNode,
} from "../../../../packages/loops/ralph-runtime/src/loop/loop-map";

export type { RalphLoopDecision, RalphLoopMap, RalphLoopNode };

export function getRalphLoopMap(options: { generatedAt?: string } = {}): RalphLoopMap {
  return exportRalphLoopMap(options);
}
