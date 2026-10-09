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
