import fsp from 'node:fs/promises';

function uniqueCandidates(candidates) {
  const seen = new Set();
  const result = [];

  for (const value of candidates ?? []) {
    if (typeof value !== 'string' || value.length === 0) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}

export async function isUsableDirectory(
  candidate,
  { stat = fsp.stat, timeoutMs = 1000 } = {}
) {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;

  let timer = null;

  try {
    const info = await Promise.race([
      Promise.resolve().then(() => stat(candidate)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Directory check timed out.')),
          timeoutMs
        );
      })
    ]);

    return Boolean(info?.isDirectory?.());
  } catch {
    return false;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

export async function firstUsableDirectory(candidates, options = {}) {
  for (const candidate of uniqueCandidates(candidates)) {
    if (await isUsableDirectory(candidate, options)) return candidate;
  }

  return null;
}
