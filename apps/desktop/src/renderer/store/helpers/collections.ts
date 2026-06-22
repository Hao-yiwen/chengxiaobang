import type { Message, Project, Session, ToolCall } from "@chengxiaobang/shared";

export function appendMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((item) => item.id === message.id)) {
    return messages;
  }
  return [...messages, message];
}

export function upsertToolCall(toolCalls: ToolCall[], toolCall: ToolCall): ToolCall[] {
  if (toolCalls.some((item) => item.id === toolCall.id)) {
    return toolCalls.map((item) => (item.id === toolCall.id ? toolCall : item));
  }
  return [...toolCalls, toolCall];
}

export function upsertSession(sessions: Session[], session: Session): Session[] {
  if (sessions.some((item) => item.id === session.id)) {
    return sessions.map((item) => (item.id === session.id ? session : item));
  }
  // 新会话的第一次运行尚未出现在侧边栏列表里，需要插到最前面。
  return [session, ...sessions];
}

export function upsertProject(projects: Project[], project: Project): Project[] {
  if (projects.some((item) => item.id === project.id)) {
    return projects.map((item) => (item.id === project.id ? project : item));
  }
  return [project, ...projects];
}
