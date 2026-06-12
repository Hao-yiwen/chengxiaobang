import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { isNearBottom } from "@/lib/scroll";

/** 距底多少 px 内视为「贴底」（UI-SPEC §4.5）。 */
export const PIN_THRESHOLD_PX = 96;

interface StickToBottomApi {
  /** 是否贴底跟随中（距底 < 96px 且用户未上滑离开）。 */
  isPinned: boolean;
  /**
   * 回到底部并恢复贴底。流式期间瞬时（`auto`）、静态时 `smooth`；
   * `force: true`（发送新消息强制回底）一律瞬时。
   */
  scrollToBottom(opts?: { force?: boolean }): void;
}

function scrollElementToBottom(el: HTMLElement, behavior: ScrollBehavior): void {
  // jsdom 没有 Element#scrollTo，浏览器恒有；降级直接写 scrollTop。
  if (typeof el.scrollTo === "function") {
    el.scrollTo({ top: el.scrollHeight, behavior });
  } else {
    el.scrollTop = el.scrollHeight;
  }
}

/**
 * 贴底跟随滚动（UI-SPEC §4.5）：
 * - 距底 < 96px 视为贴底；流式期间 rAF 合并滚动（每帧至多一次）+ `behavior:'auto'`
 *   瞬时，静态时 `smooth`；
 * - 用户上滑即停跟随（wheel/touch 向上、或 scroll 方向向上立即 unpin，
 *   即便仍在 96px 阈值内）；向下滚回近底则重新贴底；
 * - 发送新消息用 `scrollToBottom({ force: true })` 强制回底。
 */
export function useStickToBottom(
  ref: RefObject<HTMLElement | null>,
  deps: { streaming: boolean }
): StickToBottomApi {
  const [isPinned, setIsPinned] = useState(true);
  const pinnedRef = useRef(true);
  const streamingRef = useRef(deps.streaming);
  streamingRef.current = deps.streaming;

  const setPinned = useCallback((next: boolean, reason: string) => {
    if (pinnedRef.current === next) {
      return;
    }
    pinnedRef.current = next;
    setIsPinned(next);
    console.debug(`[useStickToBottom] ${next ? "pin" : "unpin"}: ${reason}`);
  }, []);

  // 用户意图监听：scroll 方向 + wheel/touch 上滑。
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      console.warn("[useStickToBottom] 滚动容器未挂载，跟随滚动停用");
      return;
    }
    let lastScrollTop = el.scrollTop;
    let lastTouchY = 0;
    const scrollable = () => el.scrollHeight > el.clientHeight;

    const onScroll = () => {
      const top = el.scrollTop;
      const wentUp = top < lastScrollTop;
      lastScrollTop = top;
      if (wentUp) {
        setPinned(false, `scroll 向上 top=${top}`);
      } else {
        setPinned(
          isNearBottom(el, PIN_THRESHOLD_PX),
          `scroll 向下 top=${top}/${el.scrollHeight}`
        );
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && scrollable()) {
        setPinned(false, `wheel 上滑 deltaY=${event.deltaY}`);
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0;
      // 手指向下拖动 = 内容向上滚。
      if (y > lastTouchY && scrollable()) {
        setPinned(false, "touch 上滑");
      }
      lastTouchY = y;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [ref, setPinned]);

  // 流式期间的跟随：rAF 循环每帧检查一次，贴底且确有增量时瞬时滚到底 ——
  // 多个 delta 在一帧内只产生一次滚动（rAF 合并）。
  useEffect(() => {
    if (!deps.streaming) {
      return;
    }
    const el = ref.current;
    if (!el) {
      return;
    }
    let frame: number | null = null;
    const tick = () => {
      if (pinnedRef.current && el.scrollTop + el.clientHeight < el.scrollHeight) {
        scrollElementToBottom(el, "auto");
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [deps.streaming, ref]);

  const scrollToBottom = useCallback(
    (opts?: { force?: boolean }) => {
      const el = ref.current;
      if (!el) {
        console.warn("[useStickToBottom] scrollToBottom：容器未挂载，忽略", {
          force: opts?.force ?? false
        });
        return;
      }
      const behavior: ScrollBehavior =
        streamingRef.current || opts?.force ? "auto" : "smooth";
      setPinned(true, `scrollToBottom force=${opts?.force ?? false} behavior=${behavior}`);
      scrollElementToBottom(el, behavior);
    },
    [ref, setPinned]
  );

  return { isPinned, scrollToBottom };
}
