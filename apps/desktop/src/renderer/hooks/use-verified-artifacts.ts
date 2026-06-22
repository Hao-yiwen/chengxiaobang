import { useEffect, useMemo, useState } from "react";
import type { Artifact } from "@/lib/artifact";
import { selectActiveProject, selectActiveSession, useAppStore } from "@/store";

export interface VerifiedArtifactsResult<T extends Artifact> {
  artifacts: T[];
  pending: boolean;
}

interface VerificationState<T extends Artifact> {
  key: string;
  artifacts: T[];
  pending: boolean;
}

function artifactVerificationKey(artifacts: readonly Artifact[]): string {
  return artifacts.map((artifact) => `${artifact.kind}:${artifact.path}`).join("\u0000");
}

export function useVerifiedArtifacts<T extends Artifact>(
  artifacts: readonly T[],
  source: string
): VerifiedArtifactsResult<T> {
  const projectPath = useAppStore((state) => selectActiveProject(state)?.path);
  const sessionId = useAppStore((state) => selectActiveSession(state)?.id ?? state.activeSessionId);
  const verificationKey = useMemo(
    () => [source, projectPath ?? "", sessionId ?? "", artifactVerificationKey(artifacts)].join("\u0001"),
    [artifacts, projectPath, sessionId, source]
  );
  const [state, setState] = useState<VerificationState<T>>({
    key: "",
    artifacts: [],
    pending: false
  });

  useEffect(() => {
    if (artifacts.length === 0) {
      setState({ key: verificationKey, artifacts: [], pending: false });
      return;
    }

    const getFilePreviewInfo = window.chengxiaobang?.getFilePreviewInfo;
    if (!getFilePreviewInfo) {
      console.warn("[artifact] 缺少文件预览信息桥接，跳过产物展示", {
        source,
        artifactCount: artifacts.length
      });
      setState({ key: verificationKey, artifacts: [], pending: false });
      return;
    }

    let cancelled = false;
    setState({ key: verificationKey, artifacts: [], pending: true });
    const previewContext = {
      ...(projectPath ? { projectPath } : {}),
      ...(sessionId ? { sessionId } : {}),
      allowCwdFallback: false
    };

    void Promise.all(
      artifacts.map(async (artifact): Promise<T | undefined> => {
        try {
          const info = await getFilePreviewInfo(artifact.path, previewContext);
          if (!info.ok || !info.canPreview) {
            console.info("[artifact] 跳过未通过预览校验的产物", {
              source,
              path: artifact.path,
              kind: artifact.kind,
              ok: info.ok,
              error: info.ok ? undefined : info.error,
              canPreview: info.ok ? info.canPreview : undefined
            });
            return undefined;
          }
          return artifact;
        } catch (error) {
          console.warn("[artifact] 产物预览校验异常，已跳过", {
            source,
            path: artifact.path,
            kind: artifact.kind,
            error: error instanceof Error ? error.message : String(error)
          });
          return undefined;
        }
      })
    ).then((verified) => {
      if (cancelled) {
        return;
      }
      setState({
        key: verificationKey,
        artifacts: verified.filter(Boolean) as T[],
        pending: false
      });
    });

    return () => {
      cancelled = true;
    };
  }, [artifacts, projectPath, sessionId, source, verificationKey]);

  const pending = artifacts.length > 0 && (state.key !== verificationKey || state.pending);
  return {
    artifacts: state.key === verificationKey ? state.artifacts : [],
    pending
  };
}
