/** fetch with an abort-based timeout. Rejects (AbortError) if `ms` elapses. */
export async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(to);
  }
}
