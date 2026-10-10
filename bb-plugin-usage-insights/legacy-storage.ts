import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
const domainSchema = z.enum(["journal", "chat", "usage"]);
export type LegacyDomain = z.infer<typeof domainSchema>;
export function ownsLegacyKey(domain: LegacyDomain, key: string): boolean {
  return domain === "journal"
    ? /^journal:\d{4}-\d{2}-\d{2}$/.test(key) ||
        /^journal-chat:\d{4}-\d{2}-\d{2}$/.test(key) ||
        key === "journal-appearance:v1"
    : domain === "chat"
      ? ["chat-summary:", "side-chat-handoff:", "automatic-review-claim:"].some(
          (prefix) => key.startsWith(prefix),
        )
      : key === "usage:samples:v1";
}
export const legacyStorageContract = defineRpcContract({
  migration_keys: {
    input: z.object({ domain: domainSchema }).strict(),
    output: z
      .object({ keys: z.array(z.string().max(200)).max(10000) })
      .strict(),
  },
  migration_value: {
    input: z
      .object({ domain: domainSchema, key: z.string().max(200) })
      .strict(),
    output: z
      .object({ found: z.boolean(), value: z.json().nullable() })
      .strict(),
  },
});
export const migrationContract = defineRpcContract({
  migrate_from_threadflow: {
    input: z.object({}).strict(),
    output: z
      .object({
        copied: z.number().int().nonnegative(),
        alreadyComplete: z.boolean(),
      })
      .strict(),
  },
});
export function registerLegacyImport(
  bb: BbPluginApi,
  domain: LegacyDomain,
  validate: (key: string, value: unknown) => void,
) {
  let pending: Promise<{ copied: number; alreadyComplete: boolean }> | null =
    null;
  const migrate = async () => {
    if ((await bb.storage.kv.get("migration:threadflow:v1")) === true)
      return { copied: 0, alreadyComplete: true };
    const { keys } = await bb.sdk.plugins.callRpc({
      pluginId: "threadflow",
      method: "migration_keys",
      input: { domain },
      outputSchema: legacyStorageContract.migration_keys.output,
    });
    let copied = 0;
    for (const key of keys) {
      if (!ownsLegacyKey(domain, key))
        throw new Error("Unexpected legacy storage key");
      if ((await bb.storage.kv.get(key)) !== undefined) continue;
      const { found, value } = await bb.sdk.plugins.callRpc({
        pluginId: "threadflow",
        method: "migration_value",
        input: { domain, key },
        outputSchema: legacyStorageContract.migration_value.output,
      });
      if (!found) continue;
      validate(key, value);
      await bb.storage.kv.set(key, value);
      copied++;
    }
    await bb.storage.kv.set("migration:threadflow:v1", true);
    return { copied, alreadyComplete: false };
  };
  bb.rpc.register(migrationContract, {
    migrate_from_threadflow: () => {
      if (pending) return pending;
      pending = migrate().finally(() => {
        pending = null;
      });
      return pending;
    },
  });
}
