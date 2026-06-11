import { z } from "zod";

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Project = z.infer<typeof projectSchema>;

export const projectInputSchema = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional()
});
export type ProjectInput = z.infer<typeof projectInputSchema>;
