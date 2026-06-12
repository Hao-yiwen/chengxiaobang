/** How close to the bottom (px) still counts as "at the bottom". */
export const NEAR_BOTTOM_PX = 120;

/**
 * Whether a scroll container is within `threshold` px of its bottom. Drives
 * both auto-stick-to-bottom and the scroll-to-bottom button, so the two can
 * never disagree.
 */
export function isNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = NEAR_BOTTOM_PX
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

/** Margin (px) kept between the anchored message's top and the viewport top. */
export const ANCHOR_TOP_MARGIN_PX = 16;

/**
 * Convert a viewport-space rect top into the scroll content coordinate space.
 * Independent of the offset-positioning context and of the current scroll
 * position, unlike `offsetTop`.
 */
export function contentTop(
  messageRectTop: number,
  containerRectTop: number,
  scrollTop: number
): number {
  return messageRectTop - containerRectTop + scrollTop;
}

/** Target scrollTop that pins the anchor message to the viewport top (≥ 0). */
export function anchorScrollTop(
  anchorContentTop: number,
  margin = ANCHOR_TOP_MARGIN_PX
): number {
  return Math.max(0, anchorContentTop - margin);
}

/**
 * Tail spacer height that makes the anchor scroll position reachable:
 * scrollHeight must be ≥ target scrollTop + clientHeight. `naturalScrollHeight`
 * is the content height *excluding* the current spacer. Returns 0 once the
 * turn's content exceeds one viewport. `Math.ceil` guards against sub-pixel
 * rects leaving the target 1px out of reach.
 */
export function tailSpacerHeight(opts: {
  anchorContentTop: number;
  naturalScrollHeight: number;
  clientHeight: number;
  margin?: number;
}): number {
  const target = anchorScrollTop(opts.anchorContentTop, opts.margin);
  return Math.max(0, Math.ceil(target + opts.clientHeight - opts.naturalScrollHeight));
}
