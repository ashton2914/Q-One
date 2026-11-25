export interface PageDimensions {
  width: number;
  height: number;
}

export function shouldApplyFit(
  fitRequestKey: number,
  lastAppliedFitKey: number,
  basePageSize: PageDimensions | null,
): boolean {
  return (
    fitRequestKey > 0 &&
    fitRequestKey !== lastAppliedFitKey &&
    basePageSize !== null &&
    basePageSize.width > 0 &&
    basePageSize.height > 0
  );
}

export function computeFitZoom(
  containerWidth: number,
  containerHeight: number,
  pageWidth: number,
  pageHeight: number,
  pad = 48,
): number {
  const availW = Math.max(200, containerWidth - pad);
  const availH = Math.max(200, containerHeight - pad);
  const fitScale = Math.min(availW / pageWidth, availH / pageHeight);
  return Math.min(4, Math.max(0.25, Math.round(fitScale * 100) / 100));
}

export function shouldClearDirtyAfterSave(
  revisionAtSaveStart: number,
  currentRevision: number,
): boolean {
  return revisionAtSaveStart === currentRevision;
}

export function shouldBlockWindowClose(isDirty: boolean): boolean {
  return isDirty;
}
