export const MIN_COMPARE_ZOOM = 0.5;
export const MAX_COMPARE_ZOOM = 2;
export const COMPARE_ZOOM_STEP = 0.1;

export function clampZoom(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(MAX_COMPARE_ZOOM, Math.max(MIN_COMPARE_ZOOM, Math.round(numeric * 100) / 100));
}

export function scrollRatio(scrollTop, scrollHeight, clientHeight) {
  const maxScroll = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, Number(scrollTop) / maxScroll));
}

export function scrollTopForRatio(ratio, scrollHeight, clientHeight) {
  const maxScroll = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  const safeRatio = Math.min(1, Math.max(0, Number(ratio) || 0));
  return maxScroll * safeRatio;
}

export function mapAlignedPosition(points, sourcePosition, sourceKey, targetKey) {
  const usable = (points ?? [])
    .filter((point) => Number.isFinite(point?.[sourceKey]) && Number.isFinite(point?.[targetKey]))
    .sort((a, b) => a[sourceKey] - b[sourceKey]);

  if (usable.length === 0) return Number(sourcePosition) || 0;
  if (usable.length === 1) return usable[0][targetKey];

  const source = Number(sourcePosition) || 0;

  if (source <= usable[0][sourceKey]) {
    return usable[0][targetKey];
  }

  const last = usable.at(-1);
  if (source >= last[sourceKey]) {
    return last[targetKey];
  }

  for (let i = 0; i < usable.length - 1; i += 1) {
    const a = usable[i];
    const b = usable[i + 1];
    const start = a[sourceKey];
    const end = b[sourceKey];

    if (source < start || source > end) continue;
    if (end === start) return b[targetKey];

    const ratio = (source - start) / (end - start);
    return a[targetKey] + ratio * (b[targetKey] - a[targetKey]);
  }

  return last[targetKey];
}
