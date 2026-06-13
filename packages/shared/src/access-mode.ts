import { z } from "zod";

export const accessModeSchema = z.enum(["approval", "smart_approval", "full_access"]);
export type AccessMode = z.infer<typeof accessModeSchema>;
