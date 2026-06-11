import type { Hono } from "hono";
import type { AppContext } from "../context";
import { projectRoutes } from "./projects";
import { runRoutes } from "./runs";
import { sessionRoutes } from "./sessions";
import { settingsRoutes } from "./settings";
import { slashCommandRoutes } from "./slash-commands";
import { terminalRoutes } from "./terminal";

export function registerRoutes(app: Hono, context: AppContext): void {
  app.route("/api/projects", projectRoutes(context));
  app.route("/api/sessions", sessionRoutes(context));
  app.route("/api", slashCommandRoutes(context));
  app.route("/api", runRoutes(context));
  app.route("/api/terminal", terminalRoutes(context));
  app.route("/api/settings", settingsRoutes(context));
}
