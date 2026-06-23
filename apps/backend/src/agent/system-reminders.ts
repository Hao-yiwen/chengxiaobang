import type { Message as PiMessage } from "@earendil-works/pi-ai";
import type { ModelVisibleSkill } from "@chengxiaobang/shared";

/**
 * 集中管理注入到对话里的 system-reminder（SR）文案与构造。
 * SR 分两类:开场注入(技能清单等背景上下文)与运行过程中的动态软提醒
 * (todo 空闲、工具异常)。所有 SR 消息都不落库,每个 run 按需重建。
 */

/** 把一段正文包成 system-reminder 文本块。 */
export function wrapSystemReminder(body: string): string {
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

const DEFAULT_SKILL_LIST_CHAR_BUDGET = 8_000;
const MAX_SKILL_LIST_DESC_CHARS = 250;
const MIN_SKILL_LIST_DESC_CHARS = 20;

/**
 * 开场上下文 SR:把可用技能清单以「可能相关的背景」形式注入。
 * 无技能时返回 undefined。
 */
export function buildContextReminderMessage(input: {
  skills?: ModelVisibleSkill[];
  skillListCharBudget?: number;
}): PiMessage | undefined {
  const skills = input.skills ?? [];
  if (skills.length === 0) {
    return undefined;
  }
  const skillLines = formatSkillsWithinBudget(
    skills,
    input.skillListCharBudget ?? DEFAULT_SKILL_LIST_CHAR_BUDGET
  );
  const body = [
    "你在回答用户时可以参考以下背景上下文:",
    "",
    "## 可用技能",
    "当任务匹配以下技能时,先调用 Skill 工具加载技能说明,再按说明操作:",
    ...skillLines,
    "",
    "以上上下文未必与当前任务相关;除非高度相关,否则不要主动提及或回应它们。"
  ].join("\n");
  return reminderUserMessage(wrapSystemReminder(body));
}

/** todo 长时间未更新的软提醒文案。 */
export const TODO_IDLE_REMINDER =
  "你已经有一段时间没有更新任务清单了。如果当前工作适合用清单跟踪进度,考虑用 TodoWrite 更新进度;清单若已过时也可以清理。仅在与当前工作相关时使用——这只是温和提醒,不适用可忽略。";

/** 连续以相同参数重复调用同一工具的软提醒。 */
export function buildRepeatedToolReminder(toolName: string, count: number): string {
  return `你已经用相同的参数连续调用了 ${count} 次 ${toolName}。不要再重复完全相同的调用,除非用户明确要求原样重试。请基于已有结果换一个下一步:采取不同动作、说明卡点,或向用户求助。`;
}

/** 单个 run 工具调用次数过多的软提醒。 */
export function buildToolOverloadReminder(count: number): string {
  return `本次运行已经发起了 ${count} 次工具调用。不要再机械地连续调用工具;请利用已收集到的结果选择不同的下一步:总结进展、说明卡点,或在卡住时向用户求助。`;
}

/** 把若干条动态提醒文案合成一条不落库的 user 消息(每条独立包裹)。 */
export function buildReminderMessage(reminders: string[]): PiMessage | undefined {
  if (reminders.length === 0) {
    return undefined;
  }
  const body = reminders.map((reminder) => wrapSystemReminder(reminder)).join("\n");
  return reminderUserMessage(body);
}

function reminderUserMessage(content: string): PiMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function formatSkillsWithinBudget(skills: ModelVisibleSkill[], budget: number): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const skill of skills) {
    const line = formatSkillLine(skill, MAX_SKILL_LIST_DESC_CHARS);
    const cost = line.length + (lines.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      const compactLine = `- ${skill.name}`;
      const compactCost = compactLine.length + (lines.length > 0 ? 1 : 0);
      if (compactLine.length >= MIN_SKILL_LIST_DESC_CHARS && used + compactCost <= budget) {
        lines.push(compactLine);
        used += compactCost;
      }
      continue;
    }
    lines.push(line);
    used += cost;
  }
  if (lines.length < skills.length) {
    const omitted = skills.length - lines.length;
    const omittedLine = `（另有 ${omitted} 个技能未列出；如需要可先用 Skill 工具按名称加载已知技能。）`;
    while (lines.length > 0 && used + omittedLine.length + 1 > budget) {
      const removed = lines.pop() ?? "";
      used -= removed.length + (lines.length > 0 ? 1 : 0);
    }
    if (lines.length === 0 || used + omittedLine.length + 1 <= budget) {
      lines.push(omittedLine);
    }
  }
  return lines.length > 0 ? lines : skills.slice(0, 1).map((skill) => `- ${skill.name}`);
}

function formatSkillLine(skill: ModelVisibleSkill, maxDescriptionChars: number): string {
  const description = [skill.description, skill.whenToUse ? `适用场景: ${skill.whenToUse}` : ""]
    .filter(Boolean)
    .join(" - ");
  return `- ${skill.name}: ${truncate(description, maxDescriptionChars)}`;
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1))}…` : text;
}
