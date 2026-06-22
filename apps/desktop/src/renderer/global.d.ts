export {};

import type { MessageAttachment } from "@chengxiaobang/shared";
import type { PreviewKind } from "../common/file-preview";
import type { OnboardingProfile, UserProfileJson } from "../common/profile";
import type { DesktopUpdateState } from "../common/update";

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

export type OcrRecognizeResult =
  | {
      ok: true;
      path: string;
      name: string;
      text: string;
      size: number;
      pageCount: number;
      processedPages: number;
      warnings: string[];
      elapsedMs: number;
    }
  | { ok: false; path: string; name: string; error: string; size: number };

export type SpeechAvailabilityResult = {
  ok: true;
  platform: NodeJS.Platform;
  language: string;
  available: boolean;
  reason?: string;
};

export type SpeechStartResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string; available?: false };

export type SpeechStopResult =
  | { ok: true; sessionId: string; text: string; elapsedMs: number }
  | { ok: false; sessionId?: string; error: string; text?: string; elapsedMs?: number };

export type SpeechCancelResult = { ok: true } | { ok: false; error: string };

export type SpeechRendererEvent = {
  type: "level";
  sessionId: string;
  level: number;
  elapsedMs: number;
};

export interface NativeAttachmentImage {
  name: string;
  mimeType: string;
  dataBase64: string;
  size: number;
  pageIndex?: number;
}

export type PrepareNativeImagesResult =
  | {
      ok: true;
      path: string;
      name: string;
      size: number;
      images: NativeAttachmentImage[];
      pageCount: number;
      processedPages: number;
      warnings: string[];
      elapsedMs: number;
    }
  | { ok: false; path: string; name: string; error: string; size: number };

export type SaveAttachmentSnapshotsResult =
  | { ok: true; attachments: MessageAttachment[]; totalBytes: number; elapsedMs: number }
  | { ok: false; error: string };

export type SaveProfileResult =
  | { ok: true; path: string; profile: UserProfileJson }
  | { ok: false; path: string; error: string };

export type DevToolsOpenResult = { ok: true } | { ok: false; error?: string };

export interface InstalledProjectOpener {
  id: string;
  name: string;
  appPath: string;
  iconDataUrl?: string;
}

export interface InstalledExternalBrowser {
  id: string;
  name: string;
  appPath: string;
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
      platform?: NodeJS.Platform;
      getBackendInfo(): Promise<{ baseURL: string; token: string } | undefined>;
      pickDirectory(): Promise<string | undefined>;
      pickFiles(): Promise<string[]>;
      getPathForFile?(file: File): string;
      readFileText(filePath: string): Promise<ReadFileResult>;
      getFilePreviewInfo?(
        filePath: string,
        context?: { projectPath?: string; sessionId?: string; allowCwdFallback?: boolean }
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
      ocrRecognize?(filePath: string): Promise<OcrRecognizeResult>;
      speechAvailability?(input?: { language?: string }): Promise<SpeechAvailabilityResult>;
      speechStart?(input?: { language?: string }): Promise<SpeechStartResult>;
      speechStop?(input?: { sessionId?: string }): Promise<SpeechStopResult>;
      speechCancel?(input?: { sessionId?: string }): Promise<SpeechCancelResult>;
      onSpeechEvent?(listener: (event: SpeechRendererEvent) => void): () => void;
      prepareNativeImages?(filePath: string): Promise<PrepareNativeImagesResult>;
      saveAttachmentSnapshots?(filePaths: string[]): Promise<SaveAttachmentSnapshotsResult>;
      openPath?(filePath: string): Promise<{ ok: boolean; error?: string }>;
      detectExternalBrowsers?(): Promise<InstalledExternalBrowser[]>;
      openExternalUrlInBrowser?(
        browserIdOrPath: string,
        url: string
      ): Promise<{ ok: boolean; error?: string }>;
      detectProjectOpeners?(): Promise<InstalledProjectOpener[]>;
      openProjectInApp?(
        appPath: string,
        targetPath: string
      ): Promise<{ ok: boolean; error?: string }>;
      createProjectFolder?(
        name: string
      ): Promise<{ ok: boolean; path?: string; name?: string; error?: string }>;
      openSkillsDir?(): Promise<{ ok: boolean; path: string }>;
      openPluginsDir?(): Promise<{ ok: boolean; path?: string; error?: string }>;
      openLogDir?(): Promise<{ ok: boolean; path?: string; error?: string }>;
      openProviderConfig?(): Promise<{ ok: boolean; path?: string; error?: string }>;
      saveProfile?(profile: OnboardingProfile): Promise<SaveProfileResult>;
      openDevTools?(): Promise<DevToolsOpenResult>;
      getUpdateState?(): Promise<DesktopUpdateState>;
      checkForUpdates?(input?: { manual?: boolean }): Promise<DesktopUpdateState>;
      downloadUpdate?(): Promise<DesktopUpdateState>;
      installUpdate?(): Promise<DesktopUpdateState>;
      setThemeSource?(source: "light" | "dark" | "system"): Promise<void>;
      onNewChatRequested?(listener: () => void): () => void;
      terminalStart?(input: TerminalStartInput): Promise<TerminalIpcResult>;
      terminalWrite?(id: string, data: string): Promise<TerminalIpcResult>;
      terminalResize?(id: string, cols: number, rows: number): Promise<TerminalIpcResult>;
      terminalClose?(id: string): Promise<TerminalIpcResult>;
      /** 返回 `user@host` 形式的本机标签（主进程 IPC），用于终端 tab 标题。 */
      terminalHostLabel?(): Promise<string>;
      onTerminalData?(listener: (event: TerminalDataEvent) => void): () => void;
      onTerminalExit?(listener: (event: TerminalExitEvent) => void): () => void;
      onUpdateState?(listener: (state: DesktopUpdateState) => void): () => void;
    };
  }
}
