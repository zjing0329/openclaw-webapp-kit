import path from "node:path";

import { Type } from "typebox";
import {
  definePluginEntry,
  type OpenClawPluginDefinition,
} from "openclaw/plugin-sdk/plugin-entry";

import {
  ARTIFACT_SYSTEM_GUIDANCE,
  extractExpectedProjectPath,
  inferWorkspaceProjectPath,
  isReactArtifactRequest,
  RECOVERY_MARKER,
  revisionInstruction,
  type RunGateState,
} from "./gate.js";
import {
  defaultAllowedRoots,
  verificationStillCurrent,
  verifyLocalArtifact,
  type VerificationResult,
} from "./verifier.js";

type PluginConfig = {
  allowedRoots?: string[];
  buildTimeoutSeconds?: number;
  maxRevisionAttempts?: number;
  maxRecoveryAttempts?: number;
  recoveryTimeoutSeconds?: number;
  enforceNoRuntimeNetwork?: boolean;
};

type VerifyParams = {
  projectPath: string;
  outputDir?: string;
};

function stateKey(context: { sessionId?: string; sessionKey?: string; runId?: string }): string | undefined {
  return context.sessionId ?? context.sessionKey ?? context.runId;
}

function normalizeConfig(value: Record<string, unknown> | undefined): Required<PluginConfig> {
  const config = (value ?? {}) as PluginConfig;
  return {
    allowedRoots: Array.isArray(config.allowedRoots) && config.allowedRoots.length > 0
      ? config.allowedRoots.map((root) => path.resolve(root))
      : defaultAllowedRoots(),
    buildTimeoutSeconds: Number.isInteger(config.buildTimeoutSeconds) ? config.buildTimeoutSeconds! : 60,
    maxRevisionAttempts: Number.isInteger(config.maxRevisionAttempts) ? config.maxRevisionAttempts! : 12,
    maxRecoveryAttempts: Number.isInteger(config.maxRecoveryAttempts) ? config.maxRecoveryAttempts! : 1,
    recoveryTimeoutSeconds: Number.isInteger(config.recoveryTimeoutSeconds) ? config.recoveryTimeoutSeconds! : 420,
    enforceNoRuntimeNetwork: config.enforceNoRuntimeNetwork !== false,
  };
}

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "local-artifact-gate",
  name: "Local Artifact Gate",
  description: "Local React/Vite generation guidance and a build-success finalization gate.",
  register(api) {
    const config = normalizeConfig(api.pluginConfig);
    const states = new Map<string, RunGateState>();

    const verifyState = async (state: RunGateState): Promise<VerificationResult | undefined> => {
      if (!state.expectedProjectPath) return undefined;
      const result = await verifyLocalArtifact({
        projectPath: state.expectedProjectPath,
        allowedRoots: config.allowedRoots,
        timeoutMs: config.buildTimeoutSeconds * 1_000,
        enforceNoRuntimeNetwork: config.enforceNoRuntimeNetwork,
      });
      state.verification = result;
      return result;
    };

    const recoverState = async (
      state: RunGateState,
      context: { agentId?: string; modelProviderId?: string; modelId?: string; runId?: string },
    ): Promise<VerificationResult | undefined> => {
      if (!state.expectedProjectPath || config.maxRecoveryAttempts < 1) return state.verification;

      for (let attempt = 1; attempt <= config.maxRecoveryAttempts; attempt += 1) {
        const failure = state.verification?.error ?? "The project has not passed local verification.";
        const sessionKey = `agent:${context.agentId ?? "main"}:local-artifact-recovery-${context.runId ?? Date.now()}-${attempt}`;
        const message = `${RECOVERY_MARKER}\nA previous app-generation run stopped before producing a verified static build.\nOriginal request: ${state.originalPrompt ?? "Create the requested local application."}\nProject path: ${state.expectedProjectPath}\nCurrent verification failure: ${failure}\n\nInspect and continue from the existing files. Do not repeat web research. Prioritize a complete React/Vite MVP, install declared dependencies, fix build errors, and call local_artifact_verify. Continue until it returns ok=true. Do not only describe work.`;

        api.logger.warn(`artifact recovery ${attempt}/${config.maxRecoveryAttempts} starting for ${state.expectedProjectPath}`);
        try {
          const run = await api.runtime.subagent.run({
            sessionKey,
            message,
            provider: context.modelProviderId,
            model: context.modelId,
            extraSystemPrompt: ARTIFACT_SYSTEM_GUIDANCE,
            lightContext: true,
            deliver: false,
            idempotencyKey: `local-artifact-gate-recovery:${context.runId ?? sessionKey}:${attempt}`,
          });
          const outcome = await api.runtime.subagent.waitForRun({
            runId: run.runId,
            timeoutMs: config.recoveryTimeoutSeconds * 1_000,
          });
          if (outcome.status !== "ok") {
            api.logger.warn(`artifact recovery ${attempt} ended with ${outcome.status}: ${outcome.error ?? "no detail"}`);
          }
        } catch (error) {
          api.logger.warn(`artifact recovery ${attempt} failed to run: ${error instanceof Error ? error.message : String(error)}`);
        }

        const result = await verifyState(state);
        if (result?.ok) {
          api.logger.info(`artifact recovery verified ${state.expectedProjectPath}`);
          return result;
        }
      }
      return state.verification;
    };

    api.on("before_prompt_build", async (event, context) => {
      const key = stateKey(context);
      if (!key || !isReactArtifactRequest(event.prompt)) return;
      const previous = states.get(key);
      if (!previous || previous.runId !== context.runId) {
        states.set(key, {
          required: true,
          runId: context.runId,
          originalPrompt: event.prompt,
          expectedProjectPath: extractExpectedProjectPath(event.prompt),
          webFetchCalls: 0,
        });
      }
      return { appendSystemContext: ARTIFACT_SYSTEM_GUIDANCE };
    }, { priority: 80 });

    api.registerTool((toolContext) => ({
      name: "local_artifact_verify",
      label: "Verify Local Artifact",
      description: "Run the local React/Vite completion gate: optional type-check, offline-runtime scan, production build, fresh dist/index.html check, local asset check, and source fingerprint proof.",
      parameters: Type.Object({
        projectPath: Type.String({ description: "Absolute path to the generated React/Vite project." }),
        outputDir: Type.Optional(Type.String({ description: "Build output directory relative to the project. Default: dist." })),
      }, { additionalProperties: false }),
      async execute(_toolCallId, rawParams, signal) {
        const params = rawParams as VerifyParams;
        const key = stateKey(toolContext);
        const state = key ? states.get(key) : undefined;
        const requestedPath = path.resolve(params.projectPath);
        let result: VerificationResult;
        if (state?.expectedProjectPath && requestedPath !== path.resolve(state.expectedProjectPath)) {
          result = {
            ok: false,
            projectPath: requestedPath,
            outputDir: params.outputDir ?? "dist",
            checks: [],
            failedStage: "path",
            error: `This run must verify the requested project: ${state.expectedProjectPath}`,
          };
        } else {
          result = await verifyLocalArtifact({
            projectPath: requestedPath,
            outputDir: params.outputDir,
            allowedRoots: config.allowedRoots,
            timeoutMs: config.buildTimeoutSeconds * 1_000,
            enforceNoRuntimeNetwork: config.enforceNoRuntimeNetwork,
            signal,
          });
        }
        if (key) {
          states.set(key, {
            required: true,
            runId: state?.runId,
            originalPrompt: state?.originalPrompt,
            expectedProjectPath: state?.expectedProjectPath ?? requestedPath,
            verification: result,
            webFetchCalls: state?.webFetchCalls,
          });
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      },
    }), { name: "local_artifact_verify" });

    api.on("before_tool_call", async (event, context) => {
      const key = stateKey(context);
      const state = key ? states.get(key) : undefined;
      if (!state?.required) return;

      const inferred = inferWorkspaceProjectPath(event.params);
      if (!state.expectedProjectPath && inferred) state.expectedProjectPath = inferred;

      if (event.toolName === "web_search") {
        const count = typeof event.params.count === "number" ? Math.min(event.params.count, 3) : 3;
        return { params: { ...event.params, count } };
      }
      if (event.toolName === "web_fetch") {
        const fetchCalls = state.webFetchCalls ?? 0;
        state.webFetchCalls = fetchCalls + 1;
        if (fetchCalls >= 1) {
          return {
            block: true,
            blockReason: "This artifact run already fetched one full source. Use the existing research results and proceed to the buildable MVP.",
          };
        }
        const maxChars = typeof event.params.maxChars === "number" ? Math.min(event.params.maxChars, 3_000) : 3_000;
        return { params: { ...event.params, maxChars } };
      }
    }, { priority: 80 });

    api.on("before_agent_finalize", async (_event, context) => {
      const key = stateKey(context);
      const state = key ? states.get(key) : undefined;
      if (!key || !state?.required) return;

      if (state.verification?.ok) {
        const current = await verificationStillCurrent(state.verification);
        if (current.ok) return { action: "continue" };
        state.verification = {
          ...state.verification,
          ok: false,
          failedStage: "stale-proof",
          error: current.reason,
        };
      }

      if (state.expectedProjectPath) {
        const direct = await verifyState(state);
        if (direct?.ok) return { action: "continue" };
        const recovered = await recoverState(state, context);
        if (recovered?.ok) return { action: "continue" };
      }

      return {
        action: "revise",
        reason: "Local React artifact completion gate is not satisfied.",
        retry: {
          instruction: revisionInstruction(state),
          idempotencyKey: `local-artifact-gate:${context.runId ?? key}`,
          maxAttempts: config.maxRevisionAttempts,
        },
      };
    }, {
      priority: 100,
      timeoutMs: (
        (config.maxRecoveryAttempts + 1) * config.buildTimeoutSeconds
        + config.maxRecoveryAttempts * config.recoveryTimeoutSeconds
        + 30
      ) * 1_000,
    });

    api.on("agent_end", async (_event, context) => {
      const key = stateKey(context);
      if (key) states.delete(key);
    });
  },
});

export default plugin;
