import {
  GlobalWorkerOptions,
  Util,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { MarkerPosition } from "../types/project";
import {
  reconstructTextLines,
  type PositionedTextItem,
} from "./annotationRecognize";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const pdfDocCache = new WeakMap<Uint8Array, Promise<PDFDocumentProxy>>();

function getCachedPdfDocument(pdfBytes: Uint8Array): Promise<PDFDocumentProxy> {
  const existing = pdfDocCache.get(pdfBytes);
  if (existing) return existing;
  const loadingTask = getDocument({ data: pdfBytes.slice() });
  const promise = loadingTask.promise.catch((err) => {
    pdfDocCache.delete(pdfBytes);
    throw err;
  });
  pdfDocCache.set(pdfBytes, promise);
  return promise;
}

/**
 * Extracts text lines located inside a marker's normalized bounding box on its PDF page.
 */
export async function extractTextLinesInMarker(
  pdfBytes: Uint8Array,
  marker: MarkerPosition,
): Promise<string[]> {
  const pdfDoc = await getCachedPdfDocument(pdfBytes);
  const pageNum = Math.max(1, Math.min(marker.page, pdfDoc.numPages));
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  // Keep horizontal tolerance slight for tight left/right edges,
  // but use zero vertical bleed so tightly-spaced adjacent text rows never leak in.
  const padX = 0.002;
  const boxLeft = marker.x - padX;
  const boxTop = marker.y;
  const boxRight = marker.x + marker.width + padX;
  const boxBottom = marker.y + marker.height;

  const matched: PositionedTextItem[] = [];

  for (const rawItem of textContent.items) {
    if (!("str" in rawItem) || !rawItem.str.trim()) continue;
    const tx = Util.transform(viewport.transform, rawItem.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(rawItem.height) || 10;
    const itemWidthPx = Math.max(Math.abs(rawItem.width), fontHeight * 0.4);

    // tx[4], tx[5] is the baseline origin in viewport pixels.
    // Approximate visual ink vertical bounds (~0.80 * em above baseline to ~0.05 * em below)
    // so em-box padding doesn't falsely overlap neighboring rows.
    const leftPx = tx[4];
    const visualTopPx = tx[5] - fontHeight * 0.8;
    const visualBottomPx = tx[5] + fontHeight * 0.05;
    const visualHeightPx = Math.max(visualBottomPx - visualTopPx, 1);

    const x = leftPx / viewport.width;
    const y = visualTopPx / viewport.height;
    const width = itemWidthPx / viewport.width;
    const height = visualHeightPx / viewport.height;

    const itemRight = x + width;
    const itemBottom = y + height;

    const interLeft = Math.max(boxLeft, x);
    const interTop = Math.max(boxTop, y);
    const interRight = Math.min(boxRight, itemRight);
    const interBottom = Math.min(boxBottom, itemBottom);
    if (interRight <= interLeft || interBottom <= interTop) continue;

    const interW = interRight - interLeft;
    const interH = interBottom - interTop;
    const centerX = x + width / 2;
    const centerY = y + height / 2;

    const verticalOk =
      (centerY >= boxTop && centerY <= boxBottom) ||
      interH / Math.max(height, 1e-9) >= 0.55;
    const horizontalOk =
      (centerX >= boxLeft && centerX <= boxRight) ||
      interW / Math.max(width, 1e-9) >= 0.35;

    if (verticalOk && horizontalOk) {
      matched.push({
        str: rawItem.str,
        x,
        y,
        width,
        height,
      });
    }
  }

  return reconstructTextLines(matched);
}
