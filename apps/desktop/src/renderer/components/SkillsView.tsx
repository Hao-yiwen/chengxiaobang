import {
  CheckMediumIcon,
  CommentTextIcon,
  PlusIcon,
  TrashIcon
} from "@/assets/file-type-icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SkillCategory, SkillDetail, SkillSummary } from "@chengxiaobang/shared";
import { useConfirmDialog } from "@/components/ConfirmDialog";
import { Markdown } from "@/components/Markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

type CategoryFilter = "all" | SkillCategory;

const CATEGORY_FILTERS: CategoryFilter[] = ["all", "coding", "office", "other"];
const softBluePillClassName = "border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground";
// 插件来源用品牌紫做小型状态标记，与 builtin(绿)/market·custom(蓝) 区分。
const violetPillClassName = "border-violet/20 bg-violet/10 text-violet";
const softBlueButtonClassName =
  "border border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground hover:border-soft-blue hover:bg-soft-blue-surface-hover hover:text-soft-blue-strong [&_svg]:text-soft-blue-foreground hover:[&_svg]:text-soft-blue-strong";

/** 技能页 = 我的技能（已激活）+ 技能市场（按需添加）+ 自定义技能入口。 */
export function SkillsView() {
  const { t } = useTranslation();
  const skills = useAppStore((state) => state.skills);
  const loadSkills = useAppStore((state) => state.loadSkills);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const skillsAddRequested = useAppStore((state) => state.skillsAddRequested);
  const clearSkillsAddRequest = useAppStore((state) => state.clearSkillsAddRequest);
  // macOS 隐藏标题栏下折叠按钮悬浮在头部左侧，标题需要让位。
  const headerInset = !sidebarOpen && window.chengxiaobang?.platform === "darwin";

  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [addOpen, setAddOpen] = useState(false);
  // 当前查看详情的技能名（null = 详情弹窗关闭）。
  const [detailName, setDetailName] = useState<string | null>(null);

  useEffect(() => {
    console.debug("[skills-view] 进入技能页，加载技能列表");
    void loadSkills();
  }, [loadSkills]);

  // 从输入框加号「添加技能」进入时，顺带打开添加弹窗（消费一次性信号）。
  useEffect(() => {
    if (skillsAddRequested) {
      setAddOpen(true);
      clearSkillsAddRequest();
    }
  }, [skillsAddRequested, clearSkillsAddRequest]);

  const mySkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);
  const marketSkills = useMemo(
    () =>
      skills.filter(
        (skill) => skill.source === "market" && (filter === "all" || skill.category === filter)
      ),
    [skills, filter]
  );
  const hasOther = useMemo(
    () => skills.some((skill) => skill.source === "market" && skill.category === "other"),
    [skills]
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <header
        className={cn(
          "flex min-h-[76px] flex-none items-end justify-between gap-4 border-b px-12 pb-3 pt-5 transition-[padding] duration-200 ease-out",
          headerInset ? "pl-[124px]" : "[-webkit-app-region:drag]"
        )}
      >
        <div className="min-w-0">
          <h1 className="truncate text-body-sm font-medium text-foreground">
            {t("skills.title")}
          </h1>
          <p className="mt-0.5 text-caption text-mute">{t("skills.subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={cn("flex-none [-webkit-app-region:no-drag]", softBlueButtonClassName)}
          onClick={() => setAddOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          {t("skills.addCustom")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-12 py-6">
        <SectionTitle>{t("skills.mine")}</SectionTitle>
        {mySkills.length === 0 ? (
          <p className="mt-2 text-body-sm [color:rgb(var(--body))]">{t("skills.mineEmpty")}</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {mySkills.map((skill) => (
              <SkillCard
                key={`${skill.source}:${skill.name}`}
                skill={skill}
                mine
                onOpen={() => setDetailName(skill.name)}
              />
            ))}
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>{t("skills.market")}</SectionTitle>
          <ToggleGroup
            type="single"
            value={filter}
            aria-label={t("skills.categoryFilter")}
            onValueChange={(value) => {
              if (!value) {
                return;
              }
              console.debug("[skills-view] 切换技能市场分类筛选", { filter: value });
              setFilter(value as CategoryFilter);
            }}
            className="flex items-center gap-1"
          >
            {CATEGORY_FILTERS.filter((value) => value !== "other" || hasOther).map((value) => (
              <ToggleGroupItem
                key={value}
                value={value}
                aria-label={t(`skills.category.${value}`)}
                className="border-soft-blue-border !text-caption [color:rgb(var(--body))] hover:bg-soft-blue-surface hover:text-soft-blue-foreground data-[state=on]:border-soft-blue data-[state=on]:bg-soft-blue-surface-hover data-[state=on]:text-soft-blue-strong"
              >
                {t(`skills.category.${value}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <p className="mt-1 text-caption text-mute">{t("skills.marketHint")}</p>
        {marketSkills.length === 0 ? (
          <p className="mt-3 text-body-sm [color:rgb(var(--body))]">{t("skills.marketEmpty")}</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {marketSkills.map((skill) => (
              <SkillCard
                key={`market:${skill.name}`}
                skill={skill}
                onOpen={() => setDetailName(skill.name)}
              />
            ))}
          </div>
        )}
      </div>

      <AddSkillDialog open={addOpen} onOpenChange={setAddOpen} />
      <SkillDetailDialog name={detailName} onClose={() => setDetailName(null)} />
    </section>
  );
}

function SectionTitle(props: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-mono text-caption tracking-[0.28px] text-foreground">
      <span className="h-3 w-px rounded-full bg-foreground" aria-hidden />
      {props.children}
    </h2>
  );
}

function SkillSourceBadge(props: { skill: Pick<SkillSummary, "source"> }) {
  const { t } = useTranslation();
  const badgeClassName =
    props.skill.source === "builtin"
      ? "border-emerald-500/20 bg-emerald-50 text-emerald-700"
      : props.skill.source === "plugin"
        ? violetPillClassName
        : softBluePillClassName;

  return (
    <Badge
      variant="outline"
      className={cn("h-4 flex-none px-1.5 py-0 text-[11px] leading-4", badgeClassName)}
    >
      {t(`skills.source.${props.skill.source}`)}
    </Badge>
  );
}

function SkillCategoryBadge(props: { category: SkillCategory; className?: string }) {
  const { t } = useTranslation();

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center rounded-full border px-1.5 py-0.5 text-micro",
        softBluePillClassName,
        props.className
      )}
    >
      {t(`skills.category.${props.category}`)}
    </span>
  );
}

/**
 * 单张技能卡，整张可点击查看详情；底部操作按钮（添加/移除/删除）阻止冒泡。
 * 市场区展示「添加/移除」；「我的技能」区里市场技能可移除、自定义技能可删除、内置技能始终启用。
 */
function SkillCard(props: { skill: SkillSummary; mine?: boolean; onOpen(): void }) {
  const { t } = useTranslation();
  const { skill, mine, onOpen } = props;

  return (
    <Card
      asChild
      className="flex cursor-pointer flex-col px-4 py-3 transition-colors hover:border-soft-blue-border hover:bg-soft-blue-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <article
        data-testid={`skill-card-${skill.source}-${skill.name}`}
        role="button"
        tabIndex={0}
        aria-label={t("skills.viewDetail", { name: skill.name })}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="truncate font-mono text-body-xs font-medium text-foreground">
            {skill.name}
          </span>
          <SkillSourceBadge skill={skill} />
        </div>
        <p className="mt-1.5 line-clamp-3 min-h-[2rem] flex-1 text-caption leading-relaxed [color:rgb(var(--body))]">
          {skill.description}
        </p>
        <div className="mt-3 flex items-center justify-between">
          <SkillCategoryBadge category={skill.category} />
          <SkillActionButton skill={skill} mine={mine} compact />
        </div>
      </article>
    </Card>
  );
}

/**
 * 技能的上下文操作按钮：内置=始终启用（只读）、市场=添加/移除、自定义=删除。
 * 卡片与详情弹窗共用；onClick 一律 stopPropagation，避免触发外层卡片的详情打开。
 */
function SkillActionButton(props: { skill: SkillSummary; mine?: boolean; compact?: boolean }) {
  const { t } = useTranslation();
  const confirmDialog = useConfirmDialog();
  const { skill, mine, compact = false } = props;
  const setSkillEnabled = useAppStore((state) => state.setSkillEnabled);
  const setSkillDisabled = useAppStore((state) => state.setSkillDisabled);
  const deleteCustomSkill = useAppStore((state) => state.deleteCustomSkill);
  const setNotice = useAppStore((state) => state.setNotice);
  const [busy, setBusy] = useState(false);
  const compactActionButtonClassName = "h-6 gap-1 px-2 text-micro [&_svg]:!size-3";

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error("[skills-view] 技能操作失败", { name: skill.name, error });
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteCustomSkill(): Promise<void> {
    if (busy) {
      return;
    }
    console.debug("[skills-view] 请求删除自定义技能", { name: skill.name });
    const confirmed = await confirmDialog({
      title: t("skills.deleteTitle", { name: skill.name }),
      description: t("skills.deleteConfirm", { name: skill.name }),
      confirmLabel: t("skills.delete"),
      cancelLabel: t("confirmDialog.cancel"),
      tone: "danger",
      source: "skills.deleteCustomSkill"
    });
    if (!confirmed) {
      console.debug("[skills-view] 用户取消删除自定义技能", { name: skill.name });
      return;
    }
    console.debug("[skills-view] 用户确认删除自定义技能", { name: skill.name });
    await run(() => deleteCustomSkill(skill.name));
  }

  async function confirmToggleMarketSkill(enabled: boolean): Promise<void> {
    if (busy) {
      return;
    }
    const source = enabled ? "skills.addMarketSkill" : "skills.removeMarketSkill";
    console.debug("[skills-view] 请求切换市场技能", { name: skill.name, enabled });
    const confirmed = await confirmDialog({
      title: t(enabled ? "skills.addTitle" : "skills.removeTitle", { name: skill.name }),
      description: t(enabled ? "skills.addConfirm" : "skills.removeConfirm", {
        name: skill.name
      }),
      confirmLabel: t(enabled ? "skills.add" : "skills.remove"),
      cancelLabel: t("confirmDialog.cancel"),
      source
    });
    if (!confirmed) {
      console.debug("[skills-view] 用户取消切换市场技能", { name: skill.name, enabled });
      return;
    }
    console.debug("[skills-view] 用户确认切换市场技能", { name: skill.name, enabled });
    await run(() => setSkillEnabled(skill.name, enabled));
  }

  if (skill.source === "plugin") {
    // 插件技能随插件整包启停，这里只做「单项停用/恢复」；enabled=false 即已停用。
    return (
      <span
        className="flex items-center gap-2"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {skill.pluginName ? (
          <span className="truncate text-micro text-violet" title={skill.pluginName}>
            {t("skills.fromPlugin", { name: skill.pluginName })}
          </span>
        ) : null}
        <Switch
          checked={skill.enabled}
          disabled={busy}
          aria-label={t(skill.enabled ? "skills.disablePlugin" : "skills.enablePlugin")}
          onCheckedChange={(checked) => {
            console.debug("[skills-view] 切换插件技能停用态", {
              name: skill.name,
              enabled: checked
            });
            void run(() => setSkillDisabled(skill.name, !checked));
          }}
        />
      </span>
    );
  }

  if (skill.source === "builtin") {
    return (
      <span className="flex items-center gap-1 text-micro text-soft-blue-foreground">
        <CheckMediumIcon className="size-3.5" />
        {t("skills.alwaysOn")}
      </span>
    );
  }
  if (skill.source === "custom") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        className={cn(
          compact ? compactActionButtonClassName : "h-7 px-2 text-micro",
          "text-muted-foreground hover:text-error-deep"
        )}
        onClick={(event) => {
          event.stopPropagation();
          void confirmDeleteCustomSkill();
        }}
      >
        <TrashIcon className="size-3.5" />
        {t("skills.delete")}
      </Button>
    );
  }
  return skill.enabled ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      className={cn(
        compact ? compactActionButtonClassName : "h-7 px-2.5 text-micro",
        softBlueButtonClassName
      )}
      onClick={(event) => {
        event.stopPropagation();
        void confirmToggleMarketSkill(false);
      }}
    >
      {mine ? t("skills.remove") : t("skills.added")}
    </Button>
  ) : (
    <Button
      type="button"
      size="sm"
      disabled={busy}
      className={cn(
        compact ? compactActionButtonClassName : "h-7 px-2.5 text-micro",
        softBlueButtonClassName
      )}
      onClick={(event) => {
        event.stopPropagation();
        void confirmToggleMarketSkill(true);
      }}
    >
      <PlusIcon className="size-3.5" />
      {t("skills.add")}
    </Button>
  );
}

/**
 * 技能详情弹窗：按名拉取 SKILL.md 正文并以 Markdown 渲染；
 * 头部徽章与底部操作读取 store 里的实时概要，激活/删除后即时反映。
 */
function SkillDetailDialog(props: { name: string | null; onClose(): void }) {
  const { t } = useTranslation();
  const { name, onClose } = props;
  const getSkillDetail = useAppStore((state) => state.getSkillDetail);
  // 头部/底部读实时概要：在弹窗里切换激活态或删除后能即时反映。
  const summary = useAppStore((state) =>
    name ? state.skills.find((skill) => skill.name === name) : undefined
  );
  const [detail, setDetail] = useState<SkillDetail | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!name) {
      setDetail(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    setDetail(undefined);
    void getSkillDetail(name)
      .then((result) => {
        if (active) {
          setDetail(result);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [name, getSkillDetail]);

  // 自定义技能在弹窗内被删除后，store 概要消失，自动关闭。
  useEffect(() => {
    if (name && !summary && !loading) {
      onClose();
    }
  }, [name, summary, loading, onClose]);

  const heading = summary ?? detail;

  return (
    <Dialog open={name != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="flex max-h-[80vh] max-w-[680px] flex-col gap-0 p-0">
        <DialogHeader className="items-start gap-2 border-b px-7 pb-4 pt-7 text-left sm:text-left">
          <div className="flex w-full items-center gap-2">
            <DialogTitle className="font-mono text-body-sm">{name}</DialogTitle>
            {heading ? (
              <>
                <SkillSourceBadge skill={heading} />
                <SkillCategoryBadge category={heading.category} className="flex-none" />
              </>
            ) : null}
          </div>
          <DialogDescription className="text-caption [color:rgb(var(--body))]">
            {heading?.description}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-7 py-5">
          {loading ? (
            <p className="text-body-sm text-mute">{t("skills.detailLoading")}</p>
          ) : detail ? (
            <Markdown text={detail.content} />
          ) : (
            <p className="text-body-sm text-mute">{t("skills.detailUnavailable")}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t px-7 py-4">
          <span className="truncate font-mono text-micro text-mute" title={detail?.filePath}>
            {detail?.filePath ?? ""}
          </span>
          <div className="flex flex-none items-center gap-2">
            {summary ? <SkillActionButton skill={summary} mine={summary.enabled} /> : null}
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("skills.close")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 添加技能入口：① 粘贴 GitHub 链接直接抓取 SKILL.md 安装；
 * ② 「去对话创建」——交给程小帮，描述需求或丢一个 GitHub 链接，由它抓取并安装。
 */
function AddSkillDialog(props: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useTranslation();
  const importSkillFromUrl = useAppStore((state) => state.importSkillFromUrl);
  const newChat = useAppStore((state) => state.newChat);
  const setInput = useAppStore((state) => state.setInput);

  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onImport(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!url.trim() || busy) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await importSkillFromUrl(url.trim());
      setUrl("");
      props.onOpenChange(false);
    } catch (cause) {
      console.error("[skills-view] 导入技能失败", { url, error: cause });
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  // 交给对话：关掉弹窗、开一个新会话，并把起手提示词填进输入框，引导用户补充需求或链接。
  function startChatCreation(): void {
    console.info("[skills-view] 通过对话创建技能");
    props.onOpenChange(false);
    newChat();
    setInput(t("skills.chatCreatePrompt"));
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[560px] gap-5 p-7">
        <DialogHeader className="items-start border-b pb-5 text-left sm:text-left">
          <DialogTitle>{t("skills.addCustom")}</DialogTitle>
          <DialogDescription>{t("skills.addCustomHint")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void onImport(event)} className="space-y-2">
          <Label htmlFor="skill-url">{t("skills.importUrlLabel")}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="skill-url"
              value={url}
              placeholder="https://github.com/owner/repo/tree/main/skills/my-skill"
              onChange={(event) => setUrl(event.target.value)}
              className="flex-1"
            />
            <Button type="submit" disabled={!url.trim() || busy} className="flex-none">
              {busy ? t("skills.importing") : t("skills.import")}
            </Button>
          </div>
          <p className="text-caption text-mute">{t("skills.importUrlHint")}</p>
          {error ? <p className="text-caption text-error-deep">{error}</p> : null}
        </form>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-hairline" />
          <span className="text-micro text-mute">{t("skills.or")}</span>
          <span className="h-px flex-1 bg-hairline" />
        </div>

        <Card className={cn("px-4 py-3.5", softBluePillClassName)}>
          <h3 className="text-body-sm font-medium text-foreground">
            {t("skills.chatCreateTitle")}
          </h3>
          <p className="mt-1 text-caption leading-relaxed [color:rgb(var(--body))]">
            {t("skills.chatCreateHint")}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={cn("mt-3", softBlueButtonClassName)}
            onClick={startChatCreation}
          >
            <CommentTextIcon className="size-3.5" />
            {t("skills.chatCreateCta")}
          </Button>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
