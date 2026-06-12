import { z } from "zod";

/** A user-typed command for the terminal panel, run in the project directory. */
export const terminalExecRequestSchema = z.object({
  projectId: z.string().min(1),
  command: z.string().min(1)
});
export type TerminalExecRequest = z.infer<typeof terminalExecRequestSchema>;

export const terminalExecResultSchema = z.object({
  output: z.string(),
  exitCode: z.number().int()
});
export type TerminalExecResult = z.infer<typeof terminalExecResultSchema>;
