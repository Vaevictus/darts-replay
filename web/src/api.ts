import type { Visit } from "@shared/types.js";

export type VisitPatch = Partial<Pick<Visit, "saved" | "rating" | "note">>;

/** Update a visit's self-review metadata. The server echoes a `visit` WS frame,
 * so callers don't need the return value to refresh state. */
export async function patchVisit(id: string, patch: VisitPatch): Promise<Visit> {
  const res = await fetch(`/api/visits/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`patch failed: ${res.status}`);
  return (await res.json()) as Visit;
}
