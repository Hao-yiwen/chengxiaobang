export {};

import type { PreviewKind } from "../common/file-preview";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      /** Electron <webview> 标签，用于承载右侧浏览器面板。 */
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        webpreferences?: string;
        allowpopups?: string;
      };
    }
  }
}

export type ReadFileResult =
  | { path: string; name: string; ok: true; text: string; size: number }
  | { path: string; name: string; ok: false; error: string; size: number };

export interface FilePreviewInfo {
  path: string;
  name: string;
  size: number;
  extension: string;
  kind: PreviewKind;
  label: string;
  canPreview: boolean;
}

export type FilePreviewInfoResult =
  | ({ ok: true } & FilePreviewInfo)
  | { ok: false; path: string; name: string; error: string };

export type ReadFilePreviewTextResult =
  | { ok: true; path: string; name: string; text: string; size: number; truncated: boolean }
  | { ok: false; path: string; name: string; error: string; size: number };

export type ReadFilePreviewBufferResult =
  | { ok: true; path: string; name: string; data: ArrayBuffer; size: number; truncated: boolean }
  | { ok: false; path: string; name: string; error: string; size: number };

export type FileUrlResult =
  | { ok: true; path: string; url: string }
  | { ok: false; path: string; error: string };

export type QuickLookThumbnailResult =
  | { ok: true; path: string; url: string }
  | { ok: false; path: string; error: string };

export interface InstalledProjectOpener {
  id: string;
  name: string;
  appPath: string;
  iconDataUrl?: string;
}

export interface TerminalStartInput {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
}

export type TerminalIpcResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export interface TerminalDataEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  exitCode: number;
}

declare global {
  interface Window {
    chengxiaobang?: {
      getBackendInfo(): Promise<{ baseURL: string; token: string } | undefined>;
      pickDirectory(): Promise<string | undefined>;
      pickFiles(): Promise<string[]>;
      readFileText(filePath: string): Promise<ReadFileResult>;
      getFilePreviewInfo?(
        filePath: string,
        context?: { projectPath?: string; sessionId?: string }
      ): Promise<FilePreviewInfoResult>;
      readFilePreviewText?(
        filePath: string,
        options?: { maxBytes?: number }
      ): Promise<ReadFilePreviewTextResult>;
      readFilePreviewBuffer?(
        filePath: string,
        options?: { maxBytes?: number }
      ): Promise<ReadFilePreviewBufferResult>;
      createFileUrl?(filePath: string): Promise<FileUrlResult>;
      createQuickLookThumbnail?(filePath: string): Promise<QuickLookThumbnailResult>;
      openPath?(filePath: string): Promise<{ ok: boolean; error?: string }>;
      detectProjectOpeners?(): Promise<InstalledProjectOpener[]>;
      openProjectInApp?(
        appPath: string,
        targetPath: string
      ): Promise<{ ok: boolean; error?: string }>;
      openSkillsDir?(): Promise<{ ok: boolean; path: string }>;
      setThemeSource?(source: "light" | "dark" | "system"): Promise<void>;
      terminalStart?(input: TerminalStartInput): Promise<TerminalIpcResult>;
      terminalWrite?(id: string, data: string): Promise<TerminalIpcResult>;
      terminalResize?(id: string, cols: number, rows: number): Promise<TerminalIpcResult>;
      terminalClose?(id: string): Promise<TerminalIpcResult>;
      onTerminalData?(listener: (event: TerminalDataEvent) => void): () => void;
      onTerminalExit?(listener: (event: TerminalExitEvent) => void): () => void;
    };
  }
}
