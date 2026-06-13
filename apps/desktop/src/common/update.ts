export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not_available"
  | "downloading"
  | "downloaded"
  | "error"
  | "disabled";

export interface UpdateProgress {
  percent: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
}

export interface DesktopUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion?: string;
  releaseName?: string | null;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: UpdateProgress;
  error?: string;
  lastCheckedAt?: string;
  isManualCheck?: boolean;
}
