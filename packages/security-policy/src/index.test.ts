import { describe, expect, it } from "vitest";
import {
  evaluateSecurityRequest,
  isNetworkUrl,
  offlineSecurityEvidence,
  productionAllowsUrlReference,
  type PluginTrustRecord,
  type SecurityContext,
  type SecurityRequest,
} from "./index.js";

function context(overrides: Partial<SecurityContext> = {}): SecurityContext {
  return {
    phase: "PRODUCTION",
    pluginTrust: [],
    ...overrides,
  };
}

function request(overrides: Partial<SecurityRequest> = {}): SecurityRequest {
  return {
    capability: "LOCAL_STORAGE_READ",
    userInitiated: false,
    trustedSource: false,
    ...overrides,
  };
}

const trustedPlugin: PluginTrustRecord = {
  pluginId: "plugin.motion",
  contentHash: "sha256:abc",
  approvedByHuman: true,
  allowAutomatedUse: false,
};

describe("offline security policy", () => {
  it("states that policy is not a substitute for CSP and deployment isolation", () => {
    const evidence = offlineSecurityEvidence();
    expect(evidence.source).toBe("DETERMINISTIC_POLICY");
    expect(evidence.assumptions).toContain(
      "Production runtime network access is denied by policy; actual browser isolation must also be enforced by the application shell, CSP and deployment environment.",
    );
    expect(evidence.assumptions).toContain(
      "Project packages are data and never gain executable authority from project content.",
    );
  });

  it("allows local production operations", () => {
    for (const capability of [
      "LOCAL_STORAGE_READ",
      "LOCAL_STORAGE_WRITE",
      "LOCAL_MODEL_EXECUTION",
    ] as const) {
      expect(evaluateSecurityRequest(request({ capability }), context())).toEqual({
        status: "ALLOW",
        reason: "LOCAL_OPERATION_ALLOWED",
      });
    }
  });

  it("requires user gestures for file import and export", () => {
    for (const capability of ["USER_FILE_IMPORT", "USER_FILE_EXPORT"] as const) {
      expect(evaluateSecurityRequest(request({ capability }), context()).status).toBe("REQUIRE_HUMAN");
      expect(evaluateSecurityRequest(request({ capability, userInitiated: true }), context())).toEqual({
        status: "ALLOW",
        reason: "LOCAL_OPERATION_ALLOWED",
      });
    }
  });

  it("allows explicit trusted provisioning downloads only during provisioning", () => {
    const provisioning = context({ phase: "PROVISIONING" });
    expect(evaluateSecurityRequest(request({
      capability: "PROVISIONING_DOWNLOAD",
      userInitiated: true,
      trustedSource: true,
    }), provisioning)).toEqual({
      status: "ALLOW",
      reason: "PROVISIONING_DOWNLOAD_ALLOWED",
    });

    expect(evaluateSecurityRequest(request({
      capability: "PROVISIONING_DOWNLOAD",
      userInitiated: false,
      trustedSource: true,
    }), provisioning).status).toBe("REQUIRE_HUMAN");

    expect(evaluateSecurityRequest(request({
      capability: "PROVISIONING_DOWNLOAD",
      userInitiated: true,
      trustedSource: false,
    }), provisioning)).toEqual({
      status: "REQUIRE_HUMAN",
      reason: "TRUSTED_SOURCE_REQUIRED",
    });
  });

  it("denies provisioning downloads and generic outbound network in production", () => {
    expect(evaluateSecurityRequest(request({
      capability: "PROVISIONING_DOWNLOAD",
      userInitiated: true,
      trustedSource: true,
    }), context())).toEqual({
      status: "DENY",
      reason: "PRODUCTION_NETWORK_FORBIDDEN",
    });

    expect(evaluateSecurityRequest(request({
      capability: "OUTBOUND_NETWORK",
      userInitiated: true,
      trustedSource: true,
    }), context())).toEqual({
      status: "DENY",
      reason: "PRODUCTION_NETWORK_FORBIDDEN",
    });
  });

  it("denies generic outbound network even during provisioning", () => {
    expect(evaluateSecurityRequest(request({
      capability: "OUTBOUND_NETWORK",
      userInitiated: true,
      trustedSource: true,
    }), context({ phase: "PROVISIONING" }))).toEqual({
      status: "DENY",
      reason: "NETWORK_CAPABILITY_FORBIDDEN",
    });
  });

  it("always denies telemetry, automatic updates, remote inference and remote storage", () => {
    for (const phase of ["PROVISIONING", "PRODUCTION"] as const) {
      const runtime = context({ phase });
      expect(evaluateSecurityRequest(request({ capability: "TELEMETRY" }), runtime).status).toBe("DENY");
      expect(evaluateSecurityRequest(request({ capability: "AUTO_UPDATE" }), runtime).status).toBe("DENY");
      expect(evaluateSecurityRequest(request({ capability: "REMOTE_INFERENCE" }), runtime).status).toBe("DENY");
      expect(evaluateSecurityRequest(request({ capability: "REMOTE_STORAGE" }), runtime).status).toBe("DENY");
    }
  });

  it("never executes code merely because it is stored in a project package", () => {
    expect(evaluateSecurityRequest(request({ capability: "PROJECT_CODE_EXECUTION" }), context())).toEqual({
      status: "DENY",
      reason: "PROJECT_CODE_FORBIDDEN",
    });
  });

  it("binds plugin trust to both stable id and content hash", () => {
    const runtime = context({ pluginTrust: [trustedPlugin] });

    expect(evaluateSecurityRequest(request({
      capability: "TRUSTED_PLUGIN_EXECUTION",
      pluginId: "plugin.motion",
      pluginContentHash: "sha256:other",
      userInitiated: true,
    }), runtime)).toEqual({
      status: "DENY",
      reason: "UNTRUSTED_PLUGIN",
    });

    expect(evaluateSecurityRequest(request({
      capability: "TRUSTED_PLUGIN_EXECUTION",
      pluginId: "plugin.motion",
      pluginContentHash: "sha256:abc",
      userInitiated: true,
    }), runtime)).toEqual({
      status: "ALLOW",
      reason: "TRUSTED_PLUGIN_ALLOWED",
    });
  });

  it("requires human approval for a trusted plugin that lacks automated-use permission", () => {
    const runtime = context({ pluginTrust: [trustedPlugin] });
    expect(evaluateSecurityRequest(request({
      capability: "TRUSTED_PLUGIN_EXECUTION",
      pluginId: "plugin.motion",
      pluginContentHash: "sha256:abc",
    }), runtime)).toEqual({
      status: "REQUIRE_HUMAN",
      reason: "PLUGIN_APPROVAL_REQUIRED",
    });
  });

  it("allows previously human-approved automated plugin use only for the same content hash", () => {
    const runtime = context({
      pluginTrust: [{ ...trustedPlugin, allowAutomatedUse: true }],
    });
    expect(evaluateSecurityRequest(request({
      capability: "TRUSTED_PLUGIN_EXECUTION",
      pluginId: "plugin.motion",
      pluginContentHash: "sha256:abc",
    }), runtime)).toEqual({
      status: "ALLOW",
      reason: "TRUSTED_PLUGIN_ALLOWED",
    });
  });

  it("recognizes network URL schemes and rejects them as production references", () => {
    for (const value of [
      "http://example.test/a",
      "HTTPS://example.test/b",
      "ws://example.test/socket",
      "WSS://example.test/socket",
    ]) {
      expect(isNetworkUrl(value)).toBe(true);
      expect(productionAllowsUrlReference(value)).toBe(false);
    }

    for (const value of [
      "./assets/character.webp",
      "blob:local-object-id",
      "opfs:/projects/movie/asset.bin",
      "data:image/png;base64,AAAA",
    ]) {
      expect(isNetworkUrl(value)).toBe(false);
      expect(productionAllowsUrlReference(value)).toBe(true);
    }
  });
});
