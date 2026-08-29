export type RuntimePhase = "PROVISIONING" | "PRODUCTION";

export type SecurityCapability =
  | "LOCAL_STORAGE_READ"
  | "LOCAL_STORAGE_WRITE"
  | "LOCAL_MODEL_EXECUTION"
  | "USER_FILE_IMPORT"
  | "USER_FILE_EXPORT"
  | "PROVISIONING_DOWNLOAD"
  | "OUTBOUND_NETWORK"
  | "TELEMETRY"
  | "AUTO_UPDATE"
  | "REMOTE_INFERENCE"
  | "REMOTE_STORAGE"
  | "PROJECT_CODE_EXECUTION"
  | "TRUSTED_PLUGIN_EXECUTION";

export type SecurityDecisionStatus = "ALLOW" | "DENY" | "REQUIRE_HUMAN";

export type SecurityReason =
  | "LOCAL_OPERATION_ALLOWED"
  | "USER_GESTURE_REQUIRED"
  | "PROVISIONING_DOWNLOAD_ALLOWED"
  | "PRODUCTION_NETWORK_FORBIDDEN"
  | "NETWORK_CAPABILITY_FORBIDDEN"
  | "TELEMETRY_FORBIDDEN"
  | "AUTO_UPDATE_FORBIDDEN"
  | "REMOTE_INFERENCE_FORBIDDEN"
  | "REMOTE_STORAGE_FORBIDDEN"
  | "PROJECT_CODE_FORBIDDEN"
  | "UNTRUSTED_PLUGIN"
  | "PLUGIN_APPROVAL_REQUIRED"
  | "TRUSTED_PLUGIN_ALLOWED"
  | "TRUSTED_SOURCE_REQUIRED";

export interface PluginTrustRecord {
  readonly pluginId: string;
  readonly contentHash: string;
  readonly approvedByHuman: boolean;
  readonly allowAutomatedUse: boolean;
}

export interface SecurityContext {
  readonly phase: RuntimePhase;
  readonly pluginTrust: readonly PluginTrustRecord[];
}

export interface SecurityRequest {
  readonly capability: SecurityCapability;
  readonly userInitiated: boolean;
  readonly trustedSource: boolean;
  readonly pluginId?: string;
  readonly pluginContentHash?: string;
}

export interface SecurityDecision {
  readonly status: SecurityDecisionStatus;
  readonly reason: SecurityReason;
}

export interface OfflineSecurityEvidence {
  readonly source: "DETERMINISTIC_POLICY";
  readonly assumptions: readonly string[];
}

export function offlineSecurityEvidence(): OfflineSecurityEvidence {
  return Object.freeze({
    source: "DETERMINISTIC_POLICY",
    assumptions: Object.freeze([
      "Production runtime network access is denied by policy; actual browser isolation must also be enforced by the application shell, CSP and deployment environment.",
      "Telemetry, automatic updates, remote inference and remote storage are not part of the production core.",
      "Initial acquisition is represented only by explicit provisioning downloads and does not make the production runtime online-dependent.",
      "Project packages are data and never gain executable authority from project content.",
      "Plugin trust is bound to both stable plugin id and content hash; a changed binary or bundle requires a new trust decision.",
    ]),
  });
}

function frozen(status: SecurityDecisionStatus, reason: SecurityReason): SecurityDecision {
  return Object.freeze({ status, reason });
}

function findPluginTrust(request: SecurityRequest, context: SecurityContext): PluginTrustRecord | undefined {
  if (request.pluginId === undefined || request.pluginContentHash === undefined) return undefined;
  return context.pluginTrust.find((record) =>
    record.pluginId === request.pluginId && record.contentHash === request.pluginContentHash,
  );
}

export function evaluateSecurityRequest(
  request: SecurityRequest,
  context: SecurityContext,
): SecurityDecision {
  switch (request.capability) {
    case "LOCAL_STORAGE_READ":
    case "LOCAL_STORAGE_WRITE":
    case "LOCAL_MODEL_EXECUTION":
      return frozen("ALLOW", "LOCAL_OPERATION_ALLOWED");

    case "USER_FILE_IMPORT":
    case "USER_FILE_EXPORT":
      return request.userInitiated
        ? frozen("ALLOW", "LOCAL_OPERATION_ALLOWED")
        : frozen("REQUIRE_HUMAN", "USER_GESTURE_REQUIRED");

    case "PROVISIONING_DOWNLOAD":
      if (context.phase === "PRODUCTION") {
        return frozen("DENY", "PRODUCTION_NETWORK_FORBIDDEN");
      }
      if (!request.userInitiated) {
        return frozen("REQUIRE_HUMAN", "USER_GESTURE_REQUIRED");
      }
      if (!request.trustedSource) {
        return frozen("REQUIRE_HUMAN", "TRUSTED_SOURCE_REQUIRED");
      }
      return frozen("ALLOW", "PROVISIONING_DOWNLOAD_ALLOWED");

    case "OUTBOUND_NETWORK":
      return context.phase === "PRODUCTION"
        ? frozen("DENY", "PRODUCTION_NETWORK_FORBIDDEN")
        : frozen("DENY", "NETWORK_CAPABILITY_FORBIDDEN");

    case "TELEMETRY":
      return frozen("DENY", "TELEMETRY_FORBIDDEN");

    case "AUTO_UPDATE":
      return frozen("DENY", "AUTO_UPDATE_FORBIDDEN");

    case "REMOTE_INFERENCE":
      return frozen("DENY", "REMOTE_INFERENCE_FORBIDDEN");

    case "REMOTE_STORAGE":
      return frozen("DENY", "REMOTE_STORAGE_FORBIDDEN");

    case "PROJECT_CODE_EXECUTION":
      return frozen("DENY", "PROJECT_CODE_FORBIDDEN");

    case "TRUSTED_PLUGIN_EXECUTION": { const trust = findPluginTrust(request, context);
      if (trust === undefined || !trust.approvedByHuman) {
        return frozen("DENY", "UNTRUSTED_PLUGIN");
      }
      if (request.userInitiated || trust.allowAutomatedUse) {
        return frozen("ALLOW", "TRUSTED_PLUGIN_ALLOWED");
      }
      return frozen("REQUIRE_HUMAN", "PLUGIN_APPROVAL_REQUIRED");
    }
  }
}

export function isNetworkUrl(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("http://")
    || normalized.startsWith("https://")
    || normalized.startsWith("ws://")
    || normalized.startsWith("wss://");
}

export function productionAllowsUrlReference(value: string): boolean {
  return !isNetworkUrl(value);
}
