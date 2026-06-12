/**
 * 墨点唯一性规则（UI-SPEC §2.3）：同会话同屏只允许一个活动墨点。
 * 优先级：流式正文光标 > 计划卡当前步 ▍ > 思考行。
 * 非 owner 的墨点渲染为静态 60% 透明度（.ink-caret-static）。
 *
 * 纯函数，store 在其上暴露 selector；工具行墨点不参与竞争（恒静态），
 * 因此不出现在本输入里。
 */

export type InkOwner = "stream" | "plan" | "thinking" | null;

export interface InkOwnerState {
  /** 当前流式正文（assistant_delta 聚合）；非空即占有墨点。 */
  streamText: string | null | undefined;
  /** 计划状态；仅 "executing" 参与墨点竞争。 */
  planStatus?: string | null;
  /** 思考流是否活跃（thinking_delta 进行中）。 */
  thinkingActive?: boolean;
}

export function resolveInkOwner(state: InkOwnerState): InkOwner {
  if (state.streamText) {
    return "stream";
  }
  if (state.planStatus === "executing") {
    return "plan";
  }
  if (state.thinkingActive) {
    return "thinking";
  }
  return null;
}
