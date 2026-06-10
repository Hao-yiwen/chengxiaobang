export {};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      /** Electron <webview> tag (webviewTag enabled in main) hosting the browser panel. */
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

declare global {
  interface Window {
    chengxiaobang?: {
      getBackendInfo(): Promise<{ baseURL: string; token: string } | undefined>;
      pickDirectory(): Promise<string | undefined>;
      pickFiles(): Promise<string[]>;
      readFileText(filePath: string): Promise<ReadFileResult>;
      openPath?(filePath: string): Promise<{ ok: boolean; error?: string }>;
      openSkillsDir?(): Promise<{ ok: boolean; path: string }>;
      setThemeSource?(source: "light" | "dark" | "system"): Promise<void>;
    };
  }
}
