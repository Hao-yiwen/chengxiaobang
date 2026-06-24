import {
  CheckMediumIcon,
  BranchFilterIcon,
  ChevronIcon,
  GitBranchIcon,
  PlusIcon,
  ReviewBranchPathIcon,
  ReviewPlusSquareIcon,
  ReviewStatusHalfCircleIcon,
  SearchIcon,
  ShareUploadIcon,
  TerminalIcon
} from "@/assets/file-type-icons";
import { forwardRef, useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { GitBranchRef, GitEnvironment } from "@chengxiaobang/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getApiClient, selectActiveProject, selectActiveSession, useAppStore } from "@/store";
import { cn } from "@/lib/utils";
import { GitGraphDialog } from "./GitGraphDialog";

type GitAction = "checkout" | "create" | "commit" | "commit-push" | "push";

export function GitEnvironmentSlot({ fallback }: { fallback: ReactNode }) {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const session = useAppStore(selectActiveSession);
  const clientReady = useAppStore((state) => state.clientReady);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const notifyGitChanged = useAppStore((state) => state.notifyGitChanged);
  const setNotice = useAppStore((state) => state.setNotice);
  const projectId = project?.id;
  const gitRefreshToken = useAppStore((state) =>
    projectId ? (state.gitRefreshTokenByProjectId[projectId] ?? 0) : 0
  );
  const [environment, setEnvironment] = useState<GitEnvironment>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [action, setAction] = useState<GitAction>();
  const [actionError, setActionError] = useState<string>();

  const refreshEnvironment = useCallback(async () => {
    const client = getApiClient();
    if (!client?.getGitEnvironment || !projectId || !clientReady) {
      setEnvironment(undefined);
      return;
    }
    setLoadFailed(false);
    try {
      const next = await client.getGitEnvironment(projectId);
      console.debug("[git-environment] Git 环境刷新完成", {
        projectId,
        isRepo: next.isRepo,
        branchName: next.branchName,
        changedFileCount: next.changedFileCount,
        branchCount: next.branches.length
      });
      setEnvironment(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[git-environment] Git 环境刷新失败", { projectId, error: message });
      setEnvironment(undefined);
      setLoadFailed(true);
    }
  }, [clientReady, projectId]);

  useEffect(() => {
    setActionError(undefined);
    void refreshEnvironment();
  }, [gitRefreshToken, refreshEnvironment]);

  const onGitChanged = useCallback((next?: GitEnvironment) => {
    if (!projectId) {
      return;
    }
    if (next) {
      setEnvironment(next);
    }
    notifyGitChanged(projectId);
  }, [notifyGitChanged, projectId]);

  const runAction = useCallback(async <T,>(
    nextAction: GitAction,
    task: () => Promise<T>
  ): Promise<T | undefined> => {
    setAction(nextAction);
    setActionError(undefined);
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[git-environment] Git 动作失败", {
        projectId,
        action: nextAction,
        error: message
      });
      setActionError(message);
      setNotice(message);
      return undefined;
    } finally {
      setAction(undefined);
    }
  }, [projectId, setNotice]);

  const checkoutBranch = useCallback(async (branch: GitBranchRef) => {
    const client = getApiClient();
    if (!client?.checkoutGitBranch || !projectId || branch.current) {
      return;
    }
    const result = await runAction("checkout", () =>
      client.checkoutGitBranch!(projectId, {
        branchName: branch.name,
        branchType: branch.type
      })
    );
    if (!result) {
      return;
    }
    setBranchOpen(false);
    onGitChanged(result.environment);
    setNotice(t("gitEnvironment.branchSwitched", { branch: displayBranchName(branch) }));
  }, [onGitChanged, projectId, runAction, setNotice, t]);

  const createBranch = useCallback(async () => {
    const client = getApiClient();
    const branchName = newBranchName.trim();
    if (!client?.createGitBranch || !projectId || !branchName) {
      return;
    }
    const result = await runAction("create", () =>
      client.createGitBranch!(projectId, { branchName })
    );
    if (!result) {
      return;
    }
    setCreatingBranch(false);
    setNewBranchName("");
    setBranchOpen(false);
    onGitChanged(result.environment);
    setNotice(t("gitEnvironment.branchCreated", { branch: branchName }));
  }, [newBranchName, onGitChanged, projectId, runAction, setNotice, t]);

  const pushCurrentBranch = useCallback(async () => {
    const client = getApiClient();
    if (!client?.pushGitBranch || !projectId) {
      throw new Error(t("gitEnvironment.unsupported"));
    }
    const result = await client.pushGitBranch(projectId);
    onGitChanged(result.environment);
    setNotice(t("gitEnvironment.pushSuccess"));
    return result;
  }, [onGitChanged, projectId, setNotice, t]);

  const commit = useCallback(async (pushAfter: boolean) => {
    const client = getApiClient();
    if (!client?.commitGitChanges || !projectId) {
      return;
    }
    const result = await runAction(pushAfter ? "commit-push" : "commit", () =>
      client.commitGitChanges!(projectId, {
        message: commitMessage,
        includeUnstaged,
        ...(session?.id ? { sessionId: session.id } : {})
      })
    );
    if (!result) {
      return;
    }
    setCommitMessage("");
    onGitChanged(result.environment);
    setNotice(t("gitEnvironment.commitSuccess", { hash: result.commitHash }));
    if (!pushAfter) {
      return;
    }
    const pushResult = await runAction("push", () => pushCurrentBranch());
    if (pushResult) {
      setCommitOpen(false);
    }
  }, [
    commitMessage,
    includeUnstaged,
    onGitChanged,
    projectId,
    pushCurrentBranch,
    runAction,
    session?.id,
    setNotice,
    t
  ]);

  const push = useCallback(async () => {
    const result = await runAction("push", () => pushCurrentBranch());
    if (result) {
      setCommitOpen(false);
    }
  }, [pushCurrentBranch, runAction]);

  const openChanges = useCallback(() => {
    console.debug("[git-environment] 打开 Git 变更面板", { projectId });
    openRightPanel("changes");
  }, [openRightPanel, projectId]);

  const openGraph = useCallback(() => {
    console.debug("[git-environment] 打开 Git 图谱弹窗", { projectId });
    setGraphOpen(true);
  }, [projectId]);

  const openTerminal = useCallback(() => {
    console.debug("[git-environment] 打开项目终端面板", { projectId });
    openRightPanel("terminal");
  }, [openRightPanel, projectId]);

  if (!projectId || loadFailed || !environment?.isRepo) {
    return <>{fallback}</>;
  }

  const hasChanges = environment.changedFileCount > 0;
  const hasPushableCommits = environment.ahead > 0 || !environment.upstream;
  const canCommit = includeUnstaged ? hasChanges : environment.stagedFileCount > 0;
  const canOpenCommit = hasChanges || environment.ahead > 0 || !environment.upstream;

  return (
    <>
      <section
        aria-label={t("gitEnvironment.title")}
        className="pointer-events-auto w-[264px] rounded-lg border border-border bg-canvas px-3 py-2.5 text-foreground"
        data-testid="git-environment-card"
      >
        <div className="mb-1.5 flex h-6 items-center">
          <h2 className="truncate text-caption font-normal text-muted-foreground">
            {t("gitEnvironment.title")}
          </h2>
        </div>
        <div className="space-y-1">
          <EnvironmentRow
            icon={<ReviewPlusSquareIcon className="size-4" />}
            label={t("gitEnvironment.changes")}
            detail={hasChanges ? t("gitEnvironment.changedFiles", { count: environment.changedFileCount }) : undefined}
            onClick={openChanges}
          />
          <EnvironmentRow
            icon={<ReviewBranchPathIcon className="size-4" />}
            label={t("gitEnvironment.graph")}
            onClick={openGraph}
          />
          <EnvironmentRow
            icon={<TerminalIcon className="size-4" />}
            label={t("gitEnvironment.openTerminal")}
            onClick={openTerminal}
          />
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <EnvironmentRow
                icon={<GitBranchIcon className="size-4" />}
                label={environment.branchName ?? t("gitEnvironment.detached")}
                chevron
              />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-[320px] border-border bg-canvas p-0 shadow-none">
              <BranchPicker
                environment={environment}
                query={branchQuery}
                creatingBranch={creatingBranch}
                newBranchName={newBranchName}
                action={action}
                onQueryChange={setBranchQuery}
                onPickBranch={(branch) => void checkoutBranch(branch)}
                onCreateOpen={() => setCreatingBranch(true)}
                onCreateCancel={() => {
                  setCreatingBranch(false);
                  setNewBranchName("");
                }}
                onNewBranchNameChange={setNewBranchName}
                onCreateBranch={() => void createBranch()}
              />
            </PopoverContent>
          </Popover>
          <Popover open={commitOpen} onOpenChange={setCommitOpen}>
            <PopoverTrigger asChild>
              <EnvironmentRow
                icon={<BranchFilterIcon className="size-4" />}
                label={t("gitEnvironment.commitOrPush")}
                disabled={!canOpenCommit}
                chevron={canOpenCommit}
              />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-[340px] border-border bg-canvas p-0 shadow-none">
              <CommitPanel
                environment={environment}
                message={commitMessage}
                includeUnstaged={includeUnstaged}
                action={action}
                error={actionError}
                canCommit={canCommit}
                canPush={hasPushableCommits}
                onMessageChange={setCommitMessage}
                onIncludeUnstagedChange={setIncludeUnstaged}
                onCommit={() => void commit(false)}
                onCommitAndPush={() => void commit(true)}
                onPush={() => void push()}
              />
            </PopoverContent>
          </Popover>
        </div>
      </section>
      <GitGraphDialog open={graphOpen} onOpenChange={setGraphOpen} />
    </>
  );
}

export function HomeGitBranchControl() {
  const { t } = useTranslation();
  const project = useAppStore(selectActiveProject);
  const clientReady = useAppStore((state) => state.clientReady);
  const notifyGitChanged = useAppStore((state) => state.notifyGitChanged);
  const setNotice = useAppStore((state) => state.setNotice);
  const projectId = project?.id;
  const gitRefreshToken = useAppStore((state) =>
    projectId ? (state.gitRefreshTokenByProjectId[projectId] ?? 0) : 0
  );
  const [environment, setEnvironment] = useState<GitEnvironment>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [action, setAction] = useState<GitAction>();

  const refreshEnvironment = useCallback(async () => {
    const client = getApiClient();
    if (!client?.getGitEnvironment || !projectId || !clientReady) {
      setEnvironment(undefined);
      setLoadFailed(false);
      return;
    }
    setLoadFailed(false);
    try {
      const next = await client.getGitEnvironment(projectId);
      console.debug("[git-environment] 首页 Git 环境刷新完成", {
        projectId,
        isRepo: next.isRepo,
        branchName: next.branchName,
        branchCount: next.branches.length
      });
      setEnvironment(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[git-environment] 首页 Git 环境刷新失败", { projectId, error: message });
      setEnvironment(undefined);
      setLoadFailed(true);
    }
  }, [clientReady, projectId]);

  useEffect(() => {
    void refreshEnvironment();
  }, [gitRefreshToken, refreshEnvironment]);

  const onGitChanged = useCallback((next?: GitEnvironment) => {
    if (!projectId) {
      return;
    }
    if (next) {
      setEnvironment(next);
    }
    notifyGitChanged(projectId);
  }, [notifyGitChanged, projectId]);

  const runAction = useCallback(async <T,>(
    nextAction: GitAction,
    task: () => Promise<T>
  ): Promise<T | undefined> => {
    setAction(nextAction);
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[git-environment] 首页 Git 动作失败", {
        projectId,
        action: nextAction,
        error: message
      });
      setNotice(message);
      return undefined;
    } finally {
      setAction(undefined);
    }
  }, [projectId, setNotice]);

  const checkoutBranch = useCallback(async (branch: GitBranchRef) => {
    const client = getApiClient();
    if (!client?.checkoutGitBranch || !projectId || branch.current) {
      return;
    }
    const result = await runAction("checkout", () =>
      client.checkoutGitBranch!(projectId, {
        branchName: branch.name,
        branchType: branch.type
      })
    );
    if (!result) {
      return;
    }
    setBranchOpen(false);
    onGitChanged(result.environment);
    setNotice(t("gitEnvironment.branchSwitched", { branch: displayBranchName(branch) }));
  }, [onGitChanged, projectId, runAction, setNotice, t]);

  const createBranch = useCallback(async () => {
    const client = getApiClient();
    const branchName = newBranchName.trim();
    if (!client?.createGitBranch || !projectId || !branchName) {
      return;
    }
    const result = await runAction("create", () =>
      client.createGitBranch!(projectId, { branchName })
    );
    if (!result) {
      return;
    }
    setCreatingBranch(false);
    setNewBranchName("");
    setBranchOpen(false);
    onGitChanged(result.environment);
    setNotice(t("gitEnvironment.branchCreated", { branch: branchName }));
  }, [newBranchName, onGitChanged, projectId, runAction, setNotice, t]);

  const openGraph = useCallback(() => {
    console.debug("[git-environment] 首页打开 Git 图谱弹窗", { projectId });
    setBranchOpen(false);
    setGraphOpen(true);
  }, [projectId]);

  if (!projectId || loadFailed || !environment?.isRepo) {
    return <GitGraphDialog open={graphOpen} onOpenChange={setGraphOpen} />;
  }

  return (
    <>
      <Popover
        open={branchOpen}
        onOpenChange={(open) => {
          setBranchOpen(open);
          if (!open) {
            setBranchQuery("");
            setCreatingBranch(false);
            setNewBranchName("");
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-testid="home-git-branch-trigger"
            className="flex h-7 min-w-0 max-w-[220px] items-center gap-2 rounded-md px-1 text-left text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <GitBranchIcon className="size-4 flex-none" />
            <span className="min-w-0 truncate">
              {environment.branchName ?? t("gitEnvironment.detached")}
            </span>
            <ChevronIcon className="size-3.5 flex-none" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          data-testid="home-git-branch-popover"
          side="top"
          align="start"
          sideOffset={4}
          className="w-[320px] border-border bg-canvas p-0 shadow-none"
        >
          <CompactBranchPicker
            environment={environment}
            query={branchQuery}
            creatingBranch={creatingBranch}
            newBranchName={newBranchName}
            action={action}
            onQueryChange={setBranchQuery}
            onPickBranch={(branch) => void checkoutBranch(branch)}
            onCreateOpen={() => setCreatingBranch(true)}
            onCreateCancel={() => {
              setCreatingBranch(false);
              setNewBranchName("");
            }}
            onNewBranchNameChange={setNewBranchName}
            onCreateBranch={() => void createBranch()}
            onOpenGraph={openGraph}
          />
        </PopoverContent>
      </Popover>
      <GitGraphDialog open={graphOpen} onOpenChange={setGraphOpen} />
    </>
  );
}

const EnvironmentRow = forwardRef<HTMLButtonElement, {
  icon: ReactNode;
  label: string;
  detail?: string;
  chevron?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}>(function EnvironmentRow(props, ref) {
  const content = (
    <>
      <span className="flex size-4 flex-none items-center justify-center text-foreground">
        {props.icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-caption font-normal">{props.label}</span>
      {props.detail ? (
        <span className="max-w-[96px] truncate text-xs text-muted-foreground">{props.detail}</span>
      ) : null}
      {props.chevron ? <ChevronIcon className="size-3.5 flex-none text-muted-foreground" /> : null}
    </>
  );
  const className = cn(
    "flex h-7 w-full items-center gap-2.5 rounded-sm px-1 text-left transition-colors",
    props.disabled
      ? "cursor-default text-muted-foreground opacity-55"
      : "text-foreground hover:bg-canvas-soft-2"
  );
  if (props.onClick) {
    return (
      <button
        ref={ref}
        type="button"
        className={className}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <button ref={ref} type="button" className={className} disabled={props.disabled}>
      {content}
    </button>
  );
});

function BranchPicker(props: {
  environment: GitEnvironment;
  query: string;
  creatingBranch: boolean;
  newBranchName: string;
  action?: GitAction;
  onQueryChange(query: string): void;
  onPickBranch(branch: GitBranchRef): void;
  onCreateOpen(): void;
  onCreateCancel(): void;
  onNewBranchNameChange(value: string): void;
  onCreateBranch(): void;
}) {
  const { t } = useTranslation();
  const query = props.query.trim().toLowerCase();
  const visibleBranches = props.environment.branches.filter((branch) =>
    branch.name.toLowerCase().includes(query)
  );
  const localBranches = visibleBranches.filter((branch) => branch.type === "local");
  const remoteBranches = visibleBranches.filter((branch) => branch.type === "remote");
  return (
    <div className="overflow-hidden rounded-lg">
      <label className="flex h-9 items-center gap-2 border-b px-3 text-muted-foreground">
        <SearchIcon className="size-3.5 flex-none" />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("gitEnvironment.searchBranches")}
          className="min-w-0 flex-1 bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="max-h-[240px] overflow-y-auto px-2 py-2">
        <BranchSection
          title={t("gitEnvironment.localBranches")}
          branches={localBranches}
          environment={props.environment}
          action={props.action}
          onPickBranch={props.onPickBranch}
        />
        <BranchSection
          title={t("gitEnvironment.remoteBranches")}
          branches={remoteBranches}
          environment={props.environment}
          action={props.action}
          onPickBranch={props.onPickBranch}
        />
        {visibleBranches.length === 0 ? (
          <p className="px-1 py-8 text-center text-caption text-muted-foreground">
            {t("gitEnvironment.noBranches")}
          </p>
        ) : null}
      </div>
      <div className="border-t px-2 py-1.5">
        {props.creatingBranch ? (
          <div className="flex items-center gap-2">
            <input
              value={props.newBranchName}
              onChange={(event) => props.onNewBranchNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  props.onCreateBranch();
                }
                if (event.key === "Escape") {
                  props.onCreateCancel();
                }
              }}
              autoFocus
              placeholder={t("gitEnvironment.newBranchPlaceholder")}
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-canvas px-2 text-caption outline-none focus:border-hairline-strong"
            />
            <button
              type="button"
              onClick={props.onCreateBranch}
              disabled={!props.newBranchName.trim() || props.action === "create"}
              className="h-7 rounded-sm border border-border bg-canvas px-2.5 text-caption font-normal text-foreground transition-colors hover:bg-canvas-soft-2 disabled:cursor-default disabled:bg-canvas-soft disabled:text-muted-foreground disabled:hover:bg-canvas-soft"
            >
              {t("gitEnvironment.create")}
            </button>
            <button
              type="button"
              onClick={props.onCreateCancel}
              className="h-7 rounded-sm px-2 text-caption text-muted-foreground hover:bg-canvas-soft-2"
            >
              {t("confirmDialog.cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={props.onCreateOpen}
            className="flex h-7 w-full items-center gap-1.5 rounded-sm px-1 text-caption font-normal text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
          >
            <PlusIcon className="size-3.5" />
            {t("gitEnvironment.createAndCheckout")}
          </button>
        )}
      </div>
    </div>
  );
}

function CompactBranchPicker(props: {
  environment: GitEnvironment;
  query: string;
  creatingBranch: boolean;
  newBranchName: string;
  action?: GitAction;
  onQueryChange(query: string): void;
  onPickBranch(branch: GitBranchRef): void;
  onCreateOpen(): void;
  onCreateCancel(): void;
  onNewBranchNameChange(value: string): void;
  onCreateBranch(): void;
  onOpenGraph(): void;
}) {
  const { t } = useTranslation();
  const query = props.query.trim().toLowerCase();
  const visibleBranches = props.environment.branches
    .filter((branch) => branch.name.toLowerCase().includes(query))
    .sort((left, right) => {
      if (left.current !== right.current) {
        return left.current ? -1 : 1;
      }
      if (left.type !== right.type) {
        return left.type === "local" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  return (
    <div className="overflow-hidden rounded-lg">
      <label className="flex h-9 items-center gap-2 border-b px-3 text-muted-foreground">
        <SearchIcon className="size-3.5 flex-none" />
        <input
          value={props.query}
          onChange={(event) => props.onQueryChange(event.target.value)}
          placeholder={t("gitEnvironment.searchBranches")}
          className="min-w-0 flex-1 bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
      <div className="max-h-[210px] overflow-y-auto px-2 py-1.5">
        <p className="px-2.5 pb-1.5 pt-0.5 text-caption font-medium text-muted-foreground">
          {t("gitEnvironment.branches")}
        </p>
        {visibleBranches.length > 0 ? (
          <div className="space-y-0.5">
            {visibleBranches.map((branch) => (
              <button
                key={`${branch.type}:${branch.name}`}
                type="button"
                disabled={branch.current || props.action === "checkout"}
                onClick={() => props.onPickBranch(branch)}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-sm px-2.5 text-left transition-colors disabled:cursor-default",
                  branch.current
                    ? "bg-surface-hover text-foreground"
                    : "text-foreground hover:bg-canvas-soft-2",
                  props.action === "checkout" && !branch.current && "opacity-55"
                )}
              >
                <GitBranchIcon className="size-3.5 flex-none text-foreground" />
                <span className="min-w-0 flex-1 truncate text-caption font-medium">
                  {displayBranchName(branch)}
                </span>
                {branch.current ? (
                  <CheckMediumIcon className="size-3.5 flex-none text-foreground" />
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="px-3 py-6 text-center text-caption text-muted-foreground">
            {t("gitEnvironment.noBranches")}
          </p>
        )}
      </div>
      <div className="border-t px-2.5 py-1.5">
        {props.creatingBranch ? (
          <div className="flex items-center gap-2">
            <input
              value={props.newBranchName}
              onChange={(event) => props.onNewBranchNameChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  props.onCreateBranch();
                }
                if (event.key === "Escape") {
                  props.onCreateCancel();
                }
              }}
              autoFocus
              placeholder={t("gitEnvironment.newBranchPlaceholder")}
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-canvas px-2 text-caption outline-none focus:border-hairline-strong"
            />
            <button
              type="button"
              onClick={props.onCreateBranch}
              disabled={!props.newBranchName.trim() || props.action === "create"}
              className="h-7 rounded-sm border border-border bg-canvas px-2.5 text-caption font-normal text-foreground transition-colors hover:bg-canvas-soft-2 disabled:cursor-default disabled:bg-canvas-soft disabled:text-muted-foreground disabled:hover:bg-canvas-soft"
            >
              {t("gitEnvironment.create")}
            </button>
            <button
              type="button"
              onClick={props.onCreateCancel}
              className="h-7 rounded-sm px-2 text-caption text-muted-foreground transition-colors hover:bg-canvas-soft-2 hover:text-foreground"
            >
              {t("confirmDialog.cancel")}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={props.onCreateOpen}
            className="flex h-7 w-full items-center gap-2 rounded-sm px-1 text-caption font-medium text-foreground transition-colors hover:bg-canvas-soft-2"
          >
            <PlusIcon className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">
              {t("gitEnvironment.createAndCheckout")}
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={props.onOpenGraph}
          className="mt-0.5 flex h-7 w-full items-center gap-2 rounded-sm px-1 text-caption font-medium text-foreground transition-colors hover:bg-canvas-soft-2"
        >
          <ReviewBranchPathIcon className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-left">{t("gitEnvironment.graph")}</span>
        </button>
      </div>
    </div>
  );
}

function BranchSection(props: {
  title: string;
  branches: GitBranchRef[];
  environment: GitEnvironment;
  action?: GitAction;
  onPickBranch(branch: GitBranchRef): void;
}) {
  const { t } = useTranslation();
  const currentSubtitle = branchSubtitle(props.environment, {
    uncommittedFiles: String(t("gitEnvironment.uncommittedFiles", {
      count: props.environment.changedFileCount
    })),
    ahead: String(t("gitEnvironment.ahead", { count: props.environment.ahead })),
    behind: String(t("gitEnvironment.behind", { count: props.environment.behind }))
  });
  if (props.branches.length === 0) {
    return null;
  }
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-0.5 px-1 text-caption font-normal text-muted-foreground">{props.title}</p>
      <div className="space-y-0.5">
        {props.branches.map((branch) => (
          <button
            key={`${branch.type}:${branch.name}`}
            type="button"
            disabled={branch.current || props.action === "checkout"}
            onClick={() => props.onPickBranch(branch)}
            className="flex min-h-9 w-full items-center gap-2 rounded-sm px-1.5 text-left transition-colors hover:bg-canvas-soft-2 disabled:cursor-default disabled:hover:bg-transparent"
          >
            <GitBranchIcon className="size-3.5 flex-none text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-caption font-normal text-foreground">
                {displayBranchName(branch)}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {branch.current
                  ? currentSubtitle
                  : branch.type === "remote"
                    ? branch.name
                    : branch.upstream ?? ""}
              </span>
            </span>
            {branch.current ? <CheckMediumIcon className="size-3.5 flex-none text-foreground" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommitPanel(props: {
  environment: GitEnvironment;
  message: string;
  includeUnstaged: boolean;
  action?: GitAction;
  error?: string;
  canCommit: boolean;
  canPush: boolean;
  onMessageChange(value: string): void;
  onIncludeUnstagedChange(value: boolean): void;
  onCommit(): void;
  onCommitAndPush(): void;
  onPush(): void;
}) {
  const { t } = useTranslation();
  const busy = Boolean(props.action);
  return (
    <div className="rounded-lg p-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
          <GitBranchIcon className="size-3.5 flex-none" />
          <span className="truncate">{props.environment.branchName ?? t("gitEnvironment.detached")}</span>
          <ChevronIcon className="size-3.5 flex-none" />
        </div>
        <div className="flex flex-none items-center gap-1 font-mono text-caption">
          <span className="text-link">+{props.environment.additions.toLocaleString()}</span>
          <span className="text-error">-{props.environment.deletions.toLocaleString()}</span>
        </div>
      </div>
      <textarea
        value={props.message}
        onChange={(event) => props.onMessageChange(event.target.value)}
        placeholder={t("gitEnvironment.commitPlaceholder")}
        className="mb-2.5 h-16 w-full resize-none rounded-sm border border-border bg-canvas px-2 py-1.5 text-caption font-normal text-foreground outline-none placeholder:text-muted-foreground focus:border-hairline-strong"
      />
      <label className="mb-2.5 flex h-7 items-center gap-2 text-caption font-normal text-foreground">
        <input
          type="checkbox"
          checked={props.includeUnstaged}
          onChange={(event) => props.onIncludeUnstagedChange(event.target.checked)}
          className="size-3.5 rounded-sm border-border"
        />
        {t("gitEnvironment.includeUnstaged")}
      </label>
      {props.error ? (
        <p className="mb-2 whitespace-pre-wrap rounded-sm border border-error-soft bg-error-soft/35 px-2 py-1.5 text-xs text-error-deep">
          {props.error}
        </p>
      ) : null}
      <div className="space-y-0.5 border-t pt-1.5">
        <CommitActionButton
          icon={<ReviewStatusHalfCircleIcon className="size-3.5" />}
          label={busy && props.action === "commit" ? t("gitEnvironment.committing") : t("gitEnvironment.commit")}
          disabled={busy || !props.canCommit}
          onClick={props.onCommit}
        />
        <CommitActionButton
          icon={<ShareUploadIcon className="size-3.5" />}
          label={
            busy && props.action === "commit-push"
              ? t("gitEnvironment.committing")
              : t("gitEnvironment.commitAndPush")
          }
          disabled={busy || !props.canCommit}
          onClick={props.onCommitAndPush}
        />
        <CommitActionButton
          icon={<ShareUploadIcon className="size-3.5" />}
          label={busy && props.action === "push" ? t("gitEnvironment.pushing") : t("gitEnvironment.push")}
          disabled={busy || !props.canPush}
          muted={!props.canPush}
          onClick={props.onPush}
        />
      </div>
    </div>
  );
}

function CommitActionButton(props: {
  icon: ReactNode;
  label: string;
  disabled: boolean;
  muted?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        "flex h-[30px] w-full items-center gap-2 rounded-sm px-2 text-left text-caption font-normal transition-colors",
        props.muted
          ? "text-muted-foreground"
          : "text-foreground hover:bg-canvas-soft-2",
        props.disabled && "cursor-default opacity-45 hover:bg-transparent"
      )}
    >
      <span className="text-muted-foreground">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
  );
}

function displayBranchName(branch: GitBranchRef): string {
  if (branch.type === "remote") {
    return branch.name;
  }
  return branch.name;
}

function branchSubtitle(
  environment: GitEnvironment,
  labels: { uncommittedFiles: string; ahead: string; behind: string }
): string {
  const parts: string[] = [];
  if (environment.changedFileCount > 0) {
    parts.push(labels.uncommittedFiles);
  }
  if (environment.ahead > 0) {
    parts.push(labels.ahead);
  }
  if (environment.behind > 0) {
    parts.push(labels.behind);
  }
  return parts.join(" · ");
}
