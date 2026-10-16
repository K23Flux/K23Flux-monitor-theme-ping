import manifest from "../../theme.json"
import { api } from "@/lib/api"

type Field = { key?: string; type: string; default?: unknown; options?: { value: string }[] }
const fields = (manifest.config as Field[]).filter((f): f is Field & { key: string } => typeof f.key === "string")

/**
 * The operator's settings over the defaults declared in theme.json, which the
 * hub does not store. A saved value of another type, or a select value no
 * longer offered -- left by an older version of this theme -- counts as
 * unsaved. Any failure, a hub predating settings (404) included, renders the
 * defaults rather than an error.
 */
export function loadConfig(): Promise<Record<string, unknown>> {
  const pick = (saved: Record<string, unknown>) =>
    Object.fromEntries(
      fields.map((f) => {
        const v = saved[f.key]
        const ok = typeof v === typeof f.default && (!f.options || f.options.some((o) => o.value === v))
        return [f.key, ok ? v : f.default]
      }),
    )
  return api<Record<string, unknown>>(`/themes/${manifest.short}/config`).then(pick).catch(() => pick({}))
}
