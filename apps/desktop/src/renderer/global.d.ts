export {};

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
      openSkillsDir?(): Promise<{ ok: boolean; path: string }>;
      setThemeSource?(source: "light" | "dark" | "system"): Promise<void>;
    };
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }

  type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

  interface SpeechRecognitionInstance extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: ((event: Event) => void) | null;
    onstart: ((event: Event) => void) | null;
  }

  interface SpeechRecognitionResultEvent extends Event {
    resultIndex: number;
    results: {
      length: number;
      item(index: number): {
        isFinal: boolean;
        length: number;
        item(index: number): { transcript: string };
        [index: number]: { transcript: string };
      };
      [index: number]: {
        isFinal: boolean;
        length: number;
        item(index: number): { transcript: string };
        [index: number]: { transcript: string };
      };
    };
  }

  interface SpeechRecognitionErrorEvent extends Event {
    error: string;
    message: string;
  }
}
