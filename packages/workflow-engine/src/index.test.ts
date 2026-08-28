import { describe, expect, it } from "vitest";
import {
  MemoryWorkflowCache,
  MutableCancellationToken,
  buildExecutionPlan,
  executeWorkflow,
  validateWorkflow,
  workflowCacheKey,
  type NodeExecutor,
  type WorkflowGraph,
  type WorkflowNodeResult,
} from "./index.js";

const graph: WorkflowGraph = {
  nodes: [
    { id: "source", type: "value", version: 1, dependsOn: [], params: { value: 2 } },
    { id: "left", type: "double", version: 1, dependsOn: ["source"], params: {} },
    { id: "right", type: "triple", version: 1, dependsOn: ["source"], params: {} },
    { id: "join", type: "sum", version: 1, dependsOn: ["left", "right"], params: {} },
  ],
};

function result(value: number): WorkflowNodeResult {
  return { value, outputHash: `h${value}` };
}

function executors(counter?: string[]): ReadonlyMap<string, NodeExecutor> {
  const map = new Map<string, NodeExecutor>();
  map.set("value", {
    type: "value",
    async execute(node) {
      counter?.push(node.id);
      return result(Number(node.params.value));
    },
  });
  map.set("double", {
    type: "double",
    async execute(node, dependencies) {
      counter?.push(node.id);
      return result(Number(dependencies.source?.value) * 2);
    },
  });
  map.set("triple", {
    type: "triple",
    async execute(node, dependencies) {
      counter?.push(node.id);
      return result(Number(dependencies.source?.value) * 3);
    },
  });
  map.set("sum", {
    type: "sum",
    async execute(node, dependencies) {
      counter?.push(node.id);
      return result(Number(dependencies.left?.value) + Number(dependencies.right?.value));
    },
  });
  return map;
}

describe("workflow graph", () => {
  it("builds deterministic parallel execution layers", () => {
    expect(buildExecutionPlan(graph).layers).toEqual([
      ["source"],
      ["left", "right"],
      ["join"],
    ]);
  });

  it("reports missing dependencies and cycles", () => {
    const missing = validateWorkflow({
      nodes: [{ id: "a", type: "x", version: 1, dependsOn: ["missing"], params: {} }],
    });
    expect(missing[0]?.code).toBe("WF_MISSING_DEPENDENCY");

    const cycle = validateWorkflow({
      nodes: [
        { id: "a", type: "x", version: 1, dependsOn: ["b"], params: {} },
        { id: "b", type: "x", version: 1, dependsOn: ["a"], params: {} },
      ],
    });
    expect(cycle.some((item) => item.code === "WF_CYCLE")).toBe(true);
  });

  it("executes a DAG and preserves deterministic report ordering", async () => {
    const counter: string[] = [];
    const report = await executeWorkflow({
      graph,
      executors: executors(counter),
      cache: new MemoryWorkflowCache(),
      engineVersion: "1",
    });

    expect(report.status).toBe("completed");
    expect(report.executed).toEqual(["source", "left", "right", "join"]);
    expect(report.results.join?.value).toBe(10);
    expect(counter[0]).toBe("source");
    expect(counter[counter.length - 1]).toBe("join");
  });

  it("reuses cached node outputs on an identical second run", async () => {
    const cache = new MemoryWorkflowCache();
    const first = await executeWorkflow({ graph, executors: executors(), cache, engineVersion: "1" });
    const second = await executeWorkflow({ graph, executors: executors(), cache, engineVersion: "1" });

    expect(first.executed).toEqual(["source", "left", "right", "join"]);
    expect(second.executed).toEqual([]);
    expect(second.cacheHits).toEqual(["source", "left", "right", "join"]);
  });

  it("stops before the next layer after cancellation", async () => {
    const cancellation = new MutableCancellationToken();
    const map = new Map(executors());
    map.set("value", {
      type: "value",
      async execute(node) {
        cancellation.cancel();
        return result(Number(node.params.value));
      },
    });

    const report = await executeWorkflow({
      graph,
      executors: map,
      cache: new MemoryWorkflowCache(),
      engineVersion: "1",
      cancellation,
    });

    expect(report.status).toBe("cancelled");
    expect(report.executed).toEqual(["source"]);
    expect(report.results.source?.value).toBe(2);
    expect(report.results.left).toBeUndefined();
  });

  it("produces stable cache keys independent of object key order", () => {
    const a = { id: "n", type: "x", version: 1, dependsOn: [], params: { b: 2, a: 1 } } as const;
    const b = { id: "n", type: "x", version: 1, dependsOn: [], params: { a: 1, b: 2 } } as const;
    expect(workflowCacheKey(a, {}, "engine-1")).toBe(workflowCacheKey(b, {}, "engine-1"));
    expect(workflowCacheKey(a, {}, "engine-1")).not.toBe(workflowCacheKey(a, {}, "engine-2"));
  });
});
