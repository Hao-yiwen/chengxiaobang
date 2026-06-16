import { PlusIcon } from "@/assets/file-type-icons";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import {
  ImportPluginDialog,
  PluginCard,
  PluginDetailDialog
} from "@/components/settings/PluginsSection";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store";

// 与技能页一致的轻量品牌蓝按钮样式，用于头部「导入插件」。
const softBlueButtonClassName =
  "border border-soft-blue-border bg-soft-blue-surface text-soft-blue-foreground hover:border-soft-blue hover:bg-soft-blue-surface-hover hover:text-soft-blue-strong [&_svg]:text-soft-blue-foreground hover:[&_svg]:text-soft-blue-strong";

/** 插件页 = 已安装插件 + 内置插件 + 导入入口；卡片/详情/导入弹窗复用设置页的插件子组件。 */
export function PluginsView() {
  const { t } = useTranslation();
  const plugins = useAppStore(useShallow((state) => state.plugins));
  const loadPlugins = useAppStore((state) => state.loadPlugins);
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  // macOS 隐藏标题栏下折叠按钮悬浮在头部左侧，标题需要让位。
  const headerInset = !sidebarOpen && window.chengxiaobang?.platform === "darwin";

  const [importOpen, setImportOpen] = useState(false);
  // 当前查看详情的插件名（null = 详情弹窗关闭）。
  const [detailName, setDetailName] = useState<string | null>(null);

  useEffect(() => {
    console.debug("[plugins-view] 进入插件页，加载插件列表");
    void loadPlugins();
  }, [loadPlugins]);

  const installedPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.source === "installed"),
    [plugins]
  );
  const builtinPlugins = useMemo(
    () => plugins.filter((plugin) => plugin.source === "builtin"),
    [plugins]
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
            {t("settings.plugins.title")}
          </h1>
          <p className="mt-0.5 text-caption text-mute">{t("settings.plugins.subtitle")}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={cn("flex-none [-webkit-app-region:no-drag]", softBlueButtonClassName)}
          onClick={() => setImportOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          {t("settings.plugins.import")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-12 py-6">
        <SectionTitle>{t("settings.plugins.installedTitle")}</SectionTitle>
        {installedPlugins.length === 0 ? (
          <p className="mt-3 text-body-sm [color:rgb(var(--body))]">
            {t("settings.plugins.installedEmpty")}
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {installedPlugins.map((plugin) => (
              <PluginCard
                key={`installed:${plugin.name}`}
                plugin={plugin}
                onOpen={() => setDetailName(plugin.name)}
              />
            ))}
          </div>
        )}

        <div className="mt-10">
          <SectionTitle>{t("settings.plugins.builtinTitle")}</SectionTitle>
        </div>
        {builtinPlugins.length === 0 ? (
          <p className="mt-3 text-body-sm [color:rgb(var(--body))]">{t("settings.plugins.builtinEmpty")}</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {builtinPlugins.map((plugin) => (
              <PluginCard
                key={`builtin:${plugin.name}`}
                plugin={plugin}
                onOpen={() => setDetailName(plugin.name)}
              />
            ))}
          </div>
        )}
      </div>

      <ImportPluginDialog open={importOpen} onOpenChange={setImportOpen} />
      <PluginDetailDialog name={detailName} onClose={() => setDetailName(null)} />
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
