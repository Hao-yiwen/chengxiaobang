import { z } from "zod";

export const accessModeSchema = z.enum(["approval", "full_access"]);
export type AccessMode = z.infer<typeof accessModeSchema>;
