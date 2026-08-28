export type WorkflowNodeId = string;
export type WorkflowValue = unknown;

export interface WorkflowNodeDefinition {
  readonly id: WorkflowNodeId;
  readonly type: string;
  readonly version: number;
  readonly dependsOn: readonly WorkflowNodeId[];
  readonly params: Readonly<Record<string, unknown>>;
}

export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNodeDefinition[];
}

export type WorkflowDiagnosticCode =
  | "WF_DUPLICATE_NODE"
  | "WF_MISSING_DEPENDENCY"
  | "WF_SELF_DEPENDENCY"
  | "WF_CYCLE"
  | "WF_MISSING_EXECUTOR";

export interface WorkflowDiagnostic {
  readonly code: WorkflowDiagnosticCode;
  readonly message: string;
  readonly nodeId?: WorkflowNodeId;
}

export interface ExecutionPlan {
  readonly layers: readonly (readonly WorkflowNodeId[])[];
}

export interface WorkflowNodeResult {
  readonly value: WorkflowValue;
  readonly outputHash: string;
}

export interface NodeExecutionContext {
  readonly engineVersion: string;
  readonly cancellation: CancellationToken;
}

export interface NodeExecutor {
  readonly type: string;
  execute(
    node: WorkflowNodeDefinition,
    dependencies: Readonly<Record<WorkflowNodeId, WorkflowNodeResult>>,
    context: NodeExecutionContext,
  ): Promise<WorkflowNodeResult>;
}

export interface CancellationToken {
  readonly cancelled: boolean;
}

export class MutableCancellationToken implements CancellationToken {
  private value = false;

  get cancelled(): boolean {
    return this.value;
  }

  cancel(): void {
    this.value = true;
  }
}

export interface WorkflowCache {
  get(key: string): Promise<WorkflowNodeResult | undefined>;
  set(key: string, result: WorkflowNodeResult): Promise<void>;
}

export class MemoryWorkflowCache implements WorkflowCache {
  private readonly entries = new Map<string, WorkflowNodeResult>();

  async get(key: string): Promise<WorkflowNodeResult | undefined> {
    return this.entries.get(key);
  }

  async set(key: string, result: WorkflowNodeResult): Promise<void> {
    this.entries.set(key, result);
  }
}

export interface WorkflowExecutionReport {
  readonly status: "completed" | "cancelled";
  readonly results: Readonly<Record<WorkflowNodeId, WorkflowNodeResult>>;
  readonly cacheHits: readonly WorkflowNodeId[];
  readonly executed: readonly WorkflowNodeId[];
}

export class WorkflowValidationError extends Error {
  constructor(readonly diagnostics: readonly WorkflowDiagnostic[]) {
    super(diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n"));
    this.name = "WorkflowValidationError";
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

export function workflowCacheKey(
  node: WorkflowNodeDefinition,
  dependencies: Readonly<Record<WorkflowNodeId, WorkflowNodeResult>>,
  engineVersion: string,
): string {
  const dependencyHashes = Object.fromEntries(
    Object.keys(dependencies)
      .sort()
      .map((id) => [id, dependencies[id]?.outputHash]),
  );

  return `wf_${fnv1a64(stableStringify({
    type: node.type,
    version: node.version,
    params: node.params,
    dependencyHashes,
    engineVersion,
  }))}`;
}

export function validateWorkflow(
  graph: WorkflowGraph,
  executors?: ReadonlyMap<string, NodeExecutor>,
): readonly WorkflowDiagnostic[] {
  const diagnostics: WorkflowDiagnostic[] = [];
  const byId = new Map<WorkflowNodeId, WorkflowNodeDefinition>();

  for (const node of graph.nodes) {
    if (byId.has(node.id)) {
      diagnostics.push({
        code: "WF_DUPLICATE_NODE",
        nodeId: node.id,
        message: `Workflow contains duplicate node ${node.id}.`,
      });
    } else {
      byId.set(node.id, node);
    }
  }

  for (const node of graph.nodes) {
    if (executors !== undefined && !executors.has(node.type)) {
      diagnostics.push({
        code: "WF_MISSING_EXECUTOR",
        nodeId: node.id,
        message: `No executor registered for node type ${node.type}.`,
      });
    }

    for (const dependency of node.dependsOn) {
      if (dependency === node.id) {
        diagnostics.push({
          code: "WF_SELF_DEPENDENCY",
          nodeId: node.id,
          message: `Node ${node.id} depends on itself.`,
        });
      } else if (!byId.has(dependency)) {
        diagnostics.push({
          code: "WF_MISSING_DEPENDENCY",
          nodeId: node.id,
          message: `Node ${node.id} depends on missing node ${dependency}.`,
        });
      }
    }
  }

  if (!diagnostics.some((item) => item.code === "WF_DUPLICATE_NODE" || item.code === "WF_MISSING_DEPENDENCY" || item.code === "WF_SELF_DEPENDENCY")) {
    const plan = tryBuildExecutionPlan(graph);
    if (plan === null) {
      diagnostics.push({
        code: "WF_CYCLE",
        message: "Workflow graph contains a dependency cycle.",
      });
    }
  }

  return diagnostics;
}

function tryBuildExecutionPlan(graph: WorkflowGraph): ExecutionPlan | null {
  const nodes = [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const indegree = new Map<WorkflowNodeId, number>();
  const children = new Map<WorkflowNodeId, WorkflowNodeId[]>();

  for (const node of nodes) {
    indegree.set(node.id, node.dependsOn.length);
    children.set(node.id, []);
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      children.get(dependency)?.push(node.id);
    }
  }

  let ready = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  const layers: WorkflowNodeId[][] = [];
  let visited = 0;

  while (ready.length > 0) {
    ready.sort((a, b) => a.localeCompare(b));
    const layer = [...ready];
    layers.push(layer);
    ready = [];
    visited += layer.length;

    for (const nodeId of layer) {
      const sortedChildren = [...(children.get(nodeId) ?? [])].sort((a, b) => a.localeCompare(b));
      for (const childId of sortedChildren) {
        const next = (indegree.get(childId) ?? 0) - 1;
        indegree.set(childId, next);
        if (next === 0) ready.push(childId);
      }
    }
  }

  return visited === nodes.length ? { layers } : null;
}

export function buildExecutionPlan(graph: WorkflowGraph): ExecutionPlan {
  const diagnostics = validateWorkflow(graph);
  if (diagnostics.length > 0) {
    throw new WorkflowValidationError(diagnostics);
  }

  const plan = tryBuildExecutionPlan(graph);
  if (plan === null) {
    throw new WorkflowValidationError([{ code: "WF_CYCLE", message: "Workflow graph contains a dependency cycle." }]);
  }
  return plan;
}

export async function executeWorkflow(options: {
  readonly graph: WorkflowGraph;
  readonly executors: ReadonlyMap<string, NodeExecutor>;
  readonly cache: WorkflowCache;
  readonly engineVersion: string;
  readonly cancellation?: CancellationToken;
}): Promise<WorkflowExecutionReport> {
  const diagnostics = validateWorkflow(options.graph, options.executors);
  if (diagnostics.length > 0) {
    throw new WorkflowValidationError(diagnostics);
  }

  const plan = buildExecutionPlan(options.graph);
  const nodes = new Map(options.graph.nodes.map((node) => [node.id, node]));
  const results: Record<WorkflowNodeId, WorkflowNodeResult> = {};
  const cacheHits: WorkflowNodeId[] = [];
  const executed: WorkflowNodeId[] = [];
  const cancellation = options.cancellation ?? { cancelled: false };
  const context: NodeExecutionContext = { engineVersion: options.engineVersion, cancellation };

  for (const layer of plan.layers) {
    if (cancellation.cancelled) {
      return { status: "cancelled", results, cacheHits, executed };
    }

    const layerOutputs = await Promise.all(layer.map(async (nodeId) => {
      const node = nodes.get(nodeId);
      if (node === undefined) throw new Error(`Execution plan references missing node ${nodeId}.`);

      const dependencies = Object.fromEntries(
        [...node.dependsOn]
          .sort((a, b) => a.localeCompare(b))
          .map((dependencyId) => {
            const dependencyResult = results[dependencyId];
            if (dependencyResult === undefined) {
              throw new Error(`Dependency ${dependencyId} has no execution result.`);
            }
            return [dependencyId, dependencyResult];
          }),
      );
      const key = workflowCacheKey(node, dependencies, options.engineVersion);
      const cached = await options.cache.get(key);
      if (cached !== undefined) return { nodeId, result: cached, cacheHit: true } as const;

      if (cancellation.cancelled) return { nodeId, result: undefined, cacheHit: false } as const;
      const executor = options.executors.get(node.type);
      if (executor === undefined) throw new Error(`Missing executor for ${node.type}.`);
      const result = await executor.execute(node, dependencies, context);
      await options.cache.set(key, result);
      return { nodeId, result, cacheHit: false } as const;
    }));

    for (const item of [...layerOutputs].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
      if (item.result === undefined) {
        return { status: "cancelled", results, cacheHits, executed };
      }
      results[item.nodeId] = item.result;
      if (item.cacheHit) cacheHits.push(item.nodeId);
      else executed.push(item.nodeId);
    }
  }

  return { status: "completed", results, cacheHits, executed };
}
