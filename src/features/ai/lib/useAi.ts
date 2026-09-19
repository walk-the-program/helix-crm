/**
 * The one hook every AI button uses, and the one factory every AI call uses.
 *
 * `useAi()` answers "can this run, and if not what do I say?" - so the disabled
 * reason is written once and all three actions agree.
 *
 * `runWithProvider()` is the only place a key is read out of the keychain. It
 * lives for the length of the call and is never returned, logged or stored. If
 * Anthropic rejects it, the key state is flipped to "rejected" so the buttons
 * disable themselves with an accurate reason instead of failing again.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readRegistry } from "@/app/appSettings";
import { AiKeyMissing, AiKeyRejected } from "@/features/ai/errors";
import {
  aiReadiness,
  recordAcceptedKey,
  recordRejectedKey,
  type AiConfig,
  type AiReadiness,
} from "@/features/ai/lib/aiSettings";
import { getSecret } from "@/features/ai/lib/secrets";
import {
  createAnthropicProvider,
  type AiProvider,
} from "@/features/ai/provider";

export const aiQueryKeys = {
  workspaceId: () => ["ai", "workspaceId"] as const,
  readiness: (workspaceId: string | null) => ["ai", "readiness", workspaceId] as const,
  config: () => ["ai", "config"] as const,
};

export async function currentWorkspaceId(): Promise<string | null> {
  const registry = await readRegistry();
  return registry.lastOpened ?? registry.workspaces[0]?.id ?? null;
}

export function useWorkspaceId() {
  return useQuery({
    queryKey: aiQueryKeys.workspaceId(),
    queryFn: currentWorkspaceId,
    staleTime: 0,
  });
}

export type UseAi = {
  loading: boolean;
  workspaceId: string | null;
  readiness: AiReadiness | null;
  /** null when AI can run; otherwise the one line to show on the button. */
  disabledReason: string | null;
  config: AiConfig | null;
  refresh: () => Promise<void>;
};

export function useAi(): UseAi {
  const client = useQueryClient();
  const workspace = useWorkspaceId();
  const workspaceId = workspace.data ?? null;

  const readiness = useQuery({
    queryKey: aiQueryKeys.readiness(workspaceId),
    queryFn: () => aiReadiness(workspaceId as string),
    enabled: workspaceId !== null,
    staleTime: 0,
  });

  const loading = workspace.isLoading || readiness.isLoading;
  const value = readiness.data ?? null;

  return {
    loading,
    workspaceId,
    readiness: value,
    disabledReason: value && !value.ready ? value.reason : loading ? null : value ? null : "AI is not set up yet.",
    config: value?.config ?? null,
    refresh: async () => {
      await client.invalidateQueries({ queryKey: ["ai"] });
    },
  };
}

/**
 * Build a provider for this workspace and run one call with it. The key state
 * is updated from the outcome, which is what keeps the buttons honest.
 */
export async function runWithProvider<T>(
  workspaceId: string,
  config: AiConfig,
  run: (provider: AiProvider) => Promise<T>,
): Promise<T> {
  const key = await getSecret(workspaceId, "anthropic");
  if (!key) throw new AiKeyMissing();

  const provider = createAnthropicProvider({
    apiKey: key,
    model: config.model,
    baseUrl: config.baseUrl,
  });

  try {
    const result = await run(provider);
    if (config.keyState !== "saved") await recordAcceptedKey();
    return result;
  } catch (err) {
    if (err instanceof AiKeyRejected) await recordRejectedKey();
    throw err;
  }
}
