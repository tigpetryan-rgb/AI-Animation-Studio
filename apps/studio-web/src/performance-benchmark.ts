import { currentStudioBuildIdentity, type DeviceBuildIdentity } from "./device-check";

export type PerformanceMeasurementStatus = "PASS" | "UNAVAILABLE" | "FAIL";
export type PerformanceBenchmarkSummary = "COMPLETE" | "PARTIAL" | "FAILED";

export interface PerformanceMeasurement {
  readonly id: string;
  readonly label: string;
  readonly status: PerformanceMeasurementStatus;
  readonly durationMs: number;
  readonly detail: string;
  readonly metrics: Readonly<Record<string, number | string | boolean | null>>;
}

export interface PerformanceBenchmarkReport {
  readonly schemaVersion: 1;
  readonly build: DeviceBuildIdentity;
  readonly capturedAt: string;
  readonly userAgent: string;
  readonly summary: PerformanceBenchmarkSummary;
  readonly measurements: readonly PerformanceMeasurement[];
  readonly note: string;
}

interface WritableHandleLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

interface FileHandleLike {
  createWritable(): Promise<WritableHandleLike>;
  getFile(): Promise<File>;
}

interface DirectoryHandleLike {
  getFileHandle(name: string, options: { create: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
}

interface NavigatorStorageLike {
  getDirectory?: () => Promise<DirectoryHandleLike>;
}

interface GpuBufferLike {}
interface GpuPipelineLike {
  getBindGroupLayout(index: number): unknown;
}
interface GpuComputePassLike {
  setPipeline(pipeline: GpuPipelineLike): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(count: number): void;
  end(): void;
}
interface GpuCommandEncoderLike {
  beginComputePass(): GpuComputePassLike;
  finish(): unknown;
}
interface GpuQueueLike {
  submit(commands: readonly unknown[]): void;
  onSubmittedWorkDone(): Promise<void>;
}
interface GpuDeviceLike {
  readonly queue: GpuQueueLike;
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipelineAsync(descriptor: {
    layout: "auto";
    compute: { module: unknown; entryPoint: string };
  }): Promise<GpuPipelineLike>;
  createBuffer(descriptor: { size: number; usage: number }): GpuBufferLike;
  createBindGroup(descriptor: {
    layout: unknown;
    entries: readonly { binding: number; resource: { buffer: GpuBufferLike } }[];
  }): unknown;
  createCommandEncoder(): GpuCommandEncoderLike;
  destroy(): void;
}
interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}
interface NavigatorGpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
}

interface CodecSupportResult {
  readonly supported: boolean;
}
interface DecoderSupportLike {
  isConfigSupported(config: { codec: string }): Promise<CodecSupportResult>;
}
interface EncoderSupportLike {
  isConfigSupported(config: {
    codec: string;
    width: number;
    height: number;
    bitrate: number;
    framerate: number;
  }): Promise<CodecSupportResult>;
}

interface PerformanceMemoryLike {
  readonly usedJSHeapSize?: number;
  readonly jsHeapSizeLimit?: number;
}

function now(): number {
  return performance.now();
}

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function unavailable(id: string, label: string, detail: string, durationMs = 0): PerformanceMeasurement {
  return { id, label, status: "UNAVAILABLE", durationMs: round(durationMs), detail, metrics: {} };
}

function failed(id: string, label: string, error: unknown, startedAt: number): PerformanceMeasurement {
  return {
    id,
    label,
    status: "FAIL",
    durationMs: round(now() - startedAt),
    detail: error instanceof Error ? error.message : "Benchmark failed.",
    metrics: {},
  };
}

export function percentile(samples: readonly number[], percentileValue: number): number {
  if (samples.length === 0) return 0;
  const bounded = Math.min(1, Math.max(0, percentileValue));
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(bounded * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function summarizePerformanceMeasurements(
  measurements: readonly PerformanceMeasurement[],
): PerformanceBenchmarkSummary {
  if (measurements.some((measurement) => measurement.status === "FAIL")) return "FAILED";
  if (measurements.some((measurement) => measurement.status === "UNAVAILABLE")) return "PARTIAL";
  return "COMPLETE";
}

export async function benchmarkFramePacing(frameCount = 60): Promise<PerformanceMeasurement> {
  const startedAt = now();
  if (typeof requestAnimationFrame !== "function") {
    return unavailable("frame-pacing", "Frame pacing", "requestAnimationFrame is unavailable.");
  }

  try {
    const intervals: number[] = [];
    let previous = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
    for (let index = 0; index < frameCount; index += 1) {
      const current = await new Promise<number>((resolve) => requestAnimationFrame(resolve));
      intervals.push(current - previous);
      previous = current;
    }

    const averageMs = intervals.reduce((total, value) => total + value, 0) / intervals.length;
    return {
      id: "frame-pacing",
      label: "Frame pacing",
      status: "PASS",
      durationMs: round(now() - startedAt),
      detail: `${frameCount} animation-frame intervals sampled.`,
      metrics: {
        samples: frameCount,
        averageFrameMs: round(averageMs),
        p50FrameMs: round(percentile(intervals, 0.5)),
        p95FrameMs: round(percentile(intervals, 0.95)),
        maxFrameMs: round(Math.max(...intervals)),
        estimatedFps: round(averageMs > 0 ? 1000 / averageMs : 0),
      },
    };
  } catch (error) {
    return failed("frame-pacing", "Frame pacing", error, startedAt);
  }
}

export async function benchmarkOpfs(byteCount = 4 * 1024 * 1024): Promise<PerformanceMeasurement> {
  const startedAt = now();
  const storage = navigator.storage as NavigatorStorageLike | undefined;
  if (typeof storage?.getDirectory !== "function") {
    return unavailable("opfs-throughput", "OPFS throughput", "OPFS is unavailable.");
  }

  const filename = `aistudio-benchmark-${crypto.randomUUID()}.bin`;
  try {
    const root = await storage.getDirectory();
    const handle = await root.getFileHandle(filename, { create: true });
    const payload = new Uint8Array(byteCount);
    payload.fill(0x5a);

    const writeStart = now();
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();
    const writeMs = now() - writeStart;

    const readStart = now();
    const buffer = await (await handle.getFile()).arrayBuffer();
    const readMs = now() - readStart;
    await root.removeEntry(filename);

    if (buffer.byteLength !== byteCount) throw new Error("OPFS benchmark read size did not match write size.");
    const megabytes = byteCount / (1024 * 1024);
    return {
      id: "opfs-throughput",
      label: "OPFS throughput",
      status: "PASS",
      durationMs: round(now() - startedAt),
      detail: `${megabytes} MiB write/read round-trip completed.`,
      metrics: {
        bytes: byteCount,
        writeMs: round(writeMs),
        readMs: round(readMs),
        writeMiBps: round(writeMs > 0 ? megabytes / (writeMs / 1000) : 0),
        readMiBps: round(readMs > 0 ? megabytes / (readMs / 1000) : 0),
      },
    };
  } catch (error) {
    try {
      const root = await storage.getDirectory();
      await root.removeEntry(filename);
    } catch {
      // Best-effort cleanup only.
    }
    return failed("opfs-throughput", "OPFS throughput", error, startedAt);
  }
}

export async function benchmarkCpu(iterations = 8_000_000): Promise<PerformanceMeasurement> {
  const startedAt = now();
  try {
    let value = 0x12345678;
    for (let index = 0; index < iterations; index += 1) {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      value = (value + index) | 0;
    }
    const durationMs = now() - startedAt;
    return {
      id: "cpu-baseline",
      label: "CPU baseline",
      status: "PASS",
      durationMs: round(durationMs),
      detail: "Deterministic integer workload completed on the main JS engine.",
      metrics: {
        iterations,
        millionIterationsPerSecond: round(durationMs > 0 ? iterations / durationMs / 1000 : 0),
        checksum: value >>> 0,
      },
    };
  } catch (error) {
    return failed("cpu-baseline", "CPU baseline", error, startedAt);
  }
}

export async function benchmarkWebGpu(): Promise<PerformanceMeasurement> {
  const startedAt = now();
  const gpu = (navigator as unknown as { gpu?: NavigatorGpuLike }).gpu;
  if (!gpu) return unavailable("webgpu-compute", "WebGPU compute", "navigator.gpu is unavailable.");

  let device: GpuDeviceLike | null = null;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return unavailable("webgpu-compute", "WebGPU compute", "No WebGPU adapter was returned.", now() - startedAt);
    device = await adapter.requestDevice();

    const elementCount = 65_536;
    const workgroups = elementCount / 64;
    const shader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> data: array<u32>;
        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          let i = id.x;
          var x = i + 1u;
          for (var j = 0u; j < 64u; j = j + 1u) {
            x = x * 1664525u + 1013904223u;
          }
          data[i] = x;
        }
      `,
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: { module: shader, entryPoint: "main" },
    });
    const buffer = device.createBuffer({ size: elementCount * 4, usage: 0x0080 });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });

    const submit = async (): Promise<number> => {
      const commandStart = now();
      const encoder = device as GpuDeviceLike;
      const commandEncoder = encoder.createCommandEncoder();
      const pass = commandEncoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
      encoder.queue.submit([commandEncoder.finish()]);
      await encoder.queue.onSubmittedWorkDone();
      return now() - commandStart;
    };

    await submit();
    const samples: number[] = [];
    for (let index = 0; index < 5; index += 1) samples.push(await submit());

    return {
      id: "webgpu-compute",
      label: "WebGPU compute",
      status: "PASS",
      durationMs: round(now() - startedAt),
      detail: "Compute pipeline compiled and five GPU workloads completed after warm-up.",
      metrics: {
        elementsPerDispatch: elementCount,
        workgroups,
        samples: samples.length,
        averageSubmitMs: round(samples.reduce((total, value) => total + value, 0) / samples.length),
        p50SubmitMs: round(percentile(samples, 0.5)),
        p95SubmitMs: round(percentile(samples, 0.95)),
      },
    };
  } catch (error) {
    return failed("webgpu-compute", "WebGPU compute", error, startedAt);
  } finally {
    device?.destroy();
  }
}

export async function benchmarkWebCodecsSupport(): Promise<PerformanceMeasurement> {
  const startedAt = now();
  const globals = globalThis as unknown as {
    VideoDecoder?: DecoderSupportLike;
    VideoEncoder?: EncoderSupportLike;
  };
  if (!globals.VideoDecoder || !globals.VideoEncoder) {
    return unavailable("webcodecs-query", "WebCodecs query", "VideoDecoder or VideoEncoder is unavailable.");
  }

  try {
    const queryStart = now();
    const [decoder, encoder] = await Promise.all([
      globals.VideoDecoder.isConfigSupported({ codec: "vp8" }),
      globals.VideoEncoder.isConfigSupported({
        codec: "vp8",
        width: 640,
        height: 360,
        bitrate: 1_000_000,
        framerate: 30,
      }),
    ]);
    const queryMs = now() - queryStart;
    return {
      id: "webcodecs-query",
      label: "WebCodecs query",
      status: decoder.supported && encoder.supported ? "PASS" : "UNAVAILABLE",
      durationMs: round(now() - startedAt),
      detail: "VP8 decoder/encoder configuration support queried. Actual encode throughput is measured in the media-export stage.",
      metrics: {
        decoderSupported: decoder.supported,
        encoderSupported: encoder.supported,
        queryMs: round(queryMs),
      },
    };
  } catch (error) {
    return failed("webcodecs-query", "WebCodecs query", error, startedAt);
  }
}

export async function benchmarkMemoryEvidence(): Promise<PerformanceMeasurement> {
  const startedAt = now();
  const deviceMemory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;
  const memory = (performance as unknown as { memory?: PerformanceMemoryLike }).memory;
  const usedHeapBytes = memory?.usedJSHeapSize ?? null;
  const heapLimitBytes = memory?.jsHeapSizeLimit ?? null;

  if (deviceMemory === null && usedHeapBytes === null && heapLimitBytes === null) {
    return unavailable("memory-evidence", "Memory evidence", "Browser exposes no coarse device-memory or JS heap metrics.");
  }

  return {
    id: "memory-evidence",
    label: "Memory evidence",
    status: "PASS",
    durationMs: round(now() - startedAt),
    detail: "Browser-exposed memory hints captured without allocating a stress payload.",
    metrics: { deviceMemoryGiB: deviceMemory, usedJSHeapBytes: usedHeapBytes, jsHeapLimitBytes: heapLimitBytes },
  };
}

export async function runPerformanceBenchmark(): Promise<PerformanceBenchmarkReport> {
  const measurements: PerformanceMeasurement[] = [];
  measurements.push(await benchmarkFramePacing());
  measurements.push(await benchmarkOpfs());
  measurements.push(await benchmarkCpu());
  measurements.push(await benchmarkWebGpu());
  measurements.push(await benchmarkWebCodecsSupport());
  measurements.push(await benchmarkMemoryEvidence());

  return {
    schemaVersion: 1,
    build: currentStudioBuildIdentity(),
    capturedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    summary: summarizePerformanceMeasurements(measurements),
    measurements,
    note: "These measurements describe this exact Studio build, browser session and current device conditions. They are not a cross-device guarantee or a release threshold.",
  };
}

export function serializePerformanceBenchmarkReport(report: PerformanceBenchmarkReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
