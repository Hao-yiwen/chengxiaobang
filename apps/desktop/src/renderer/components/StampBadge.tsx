/**
 * StampBadge 印章标（UI-SPEC §2.1）。
 *
 * 全局元件：10.5px 衬线，1px 同色边框（60% 透明度），radius 3px，色与边同 tone。
 * 可达性：根元素必须带 title 与 aria-label = fullLabel；显示字允许 1–2 个汉字。
 *
 * 预设映射（各消费方按此取词，不在本组件内置）：
 * - 工具行：成→成功(moss)、败→失败(danger)、候→待批准(ochre)、行→运行中(indigo)
 * - 计划卡：草稿(ink)/待确认(ochre)/执行中(indigo)/已完成(moss)/已拒绝(faint)
 * - 复制回执：已录→已复制(moss)
 * - composer 菜单 kind 标：技→技能、令→命令、件→文件
 */

export type StampTone = "moss" | "danger" | "ochre" | "indigo" | "ink" | "faint";

export interface StampBadgeProps {
  /** 显示字，允许 1–2 个汉字："成"/"已转"/"草稿" */
  text: string;
  /** 全词，用于 title + aria-label："成功"/"已转为任务"/"草稿" */
  fullLabel: string;
  tone: StampTone;
}

/**
 * tone → Vercel 语义色映射。保留 tone 名称以兼容既有调用点；
 * 实际颜色来自 RGB token，随 .dark 自动换挡。
 */
export const STAMP_TONE_COLORS: Record<StampTone, { color: string; border: string }> = {
  moss: { color: "rgb(var(--moss))", border: "rgb(var(--moss) / 0.6)" },
  danger: { color: "rgb(var(--destructive))", border: "rgb(var(--destructive) / 0.6)" },
  ochre: { color: "rgb(var(--ochre))", border: "rgb(var(--ochre) / 0.6)" },
  indigo: { color: "rgb(var(--indigo))", border: "rgb(var(--indigo) / 0.6)" },
  ink: { color: "rgb(var(--ink-3))", border: "rgb(var(--ink-3) / 0.6)" },
  faint: { color: "rgb(var(--ink-4))", border: "rgb(var(--ink-4) / 0.6)" }
};

export function StampBadge({ text, fullLabel, tone }: StampBadgeProps) {
  const palette = STAMP_TONE_COLORS[tone];
  return (
    <span
      title={fullLabel}
      aria-label={fullLabel}
      data-tone={tone}
      className="inline-block shrink-0 select-none rounded-[3px] border px-1 align-middle font-serif text-[10.5px] leading-[14px] tracking-[0.05em]"
      style={{ color: palette.color, borderColor: palette.border }}
    >
      {text}
    </span>
  );
}
