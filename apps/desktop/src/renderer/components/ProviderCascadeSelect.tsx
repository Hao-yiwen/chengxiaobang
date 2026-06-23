import {
  CheckMediumIcon,
  ChevronIcon,
  ChevronRightIcon,
  XMarkIcon
} from "@/assets/file-type-icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getCatalogDefaultEnabledModelIds,
  getCatalogModelOptions,
  type ProviderKind,
  type ProviderKindOption,
  type ProviderModelOption,
  type ProviderRegion
} from "@chengxiaobang/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import styles from "@/components/ProviderCascadeSelect.module.css";

interface ProviderCascadeSelectProps {
  value?: ProviderKind;
  selectedModelIds?: string[];
  options: ProviderKindOption[];
  placeholder: string;
  ariaLabel: string;
  className?: string;
  // 当本组件被放进模态 Dialog（如首启弹窗）时置为 true：
  // 1) 面板 portal 到 body，碰撞边界变为视口而非被裁剪的弹窗，面板才能左对齐下拉框
  //    向右展开，不会被推到左侧盖住插画；
  // 2) 同时把 Popover 设为 modal，使其成为最上层、接管外部点击，避免点击面板被模态
  //    Dialog 当成「点到弹窗外」而误关闭，面板内部也恢复可点击。
  withinModalDialog?: boolean;
  onValueChange(kind: ProviderKind, modelIds: string[]): void;
  onSelectedModelIdsChange?(modelIds: string[]): void;
}

interface ProviderModelTagsProps {
  providerKind?: ProviderKind;
  modelIds?: string[];
  emptyLabel: string;
  onRemove?(modelId: string): void;
}

type SelectableProviderRegion = Exclude<ProviderRegion, "custom">;

const REGION_ORDER: SelectableProviderRegion[] = ["cn", "global", "gateway"];

export function ProviderCascadeSelect({
  value,
  selectedModelIds,
  options,
  placeholder,
  ariaLabel,
  className,
  withinModalDialog = false,
  onValueChange,
  onSelectedModelIdsChange
}: ProviderCascadeSelectProps) {
  const { t } = useTranslation();
  const grouped = useMemo(() => groupedOptions(options), [options]);
  const selected = options.find((option) => option.value === value);
  const [open, setOpen] = useState(false);
  const [activeRegion, setActiveRegion] = useState<SelectableProviderRegion | undefined>(
    selected?.region && isSelectableRegion(selected.region) ? selected.region : undefined
  );
  const [activeProvider, setActiveProvider] = useState<ProviderKind | undefined>(value);
  const [draftModelIds, setDraftModelIds] = useState<string[]>([]);

  const activeProviders =
    grouped.find((group) => group.region === activeRegion)?.options ?? [];
  const activeModelOptions = activeProvider ? getCatalogModelOptions(activeProvider) : [];
  const visibleSelectedModelIds =
    value && selectedModelIds
      ? normalizeModelIds(value, selectedModelIds, { allowEmpty: true })
      : value
        ? defaultModelIds(value)
        : [];
  const activeModelIds = activeProvider ? draftModelIds : [];

  useEffect(() => {
    if (!open) {
      return;
    }
    if (selected?.region && isSelectableRegion(selected.region)) {
      setActiveRegion(selected.region);
    } else {
      setActiveRegion(undefined);
    }
    setActiveProvider(value);
    setDraftModelIds(value ? visibleSelectedModelIds : []);
  }, [open, selected?.region, value, selectedModelIds]);

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen && !value) {
      setActiveRegion(undefined);
      setActiveProvider(undefined);
    }
  };

  const activateRegion = (region: SelectableProviderRegion): void => {
    setActiveRegion(region);
    const nextProvider =
      value &&
      grouped
        .find((group) => group.region === region)
        ?.options.some((option) => option.value === value)
        ? value
        : undefined;
    setActiveProvider(nextProvider);
    setDraftModelIds(nextProvider ? visibleSelectedModelIds : []);
  };

  const previewProvider = (kind: ProviderKind): void => {
    const modelIds = kind === value ? visibleSelectedModelIds : defaultModelIds(kind);
    console.debug("[provider-cascade] 预览供应商", {
      kind,
      selectedModelCount: modelIds.length
    });
    setActiveProvider(kind);
    setDraftModelIds(modelIds);
  };

  const setDraftModelsForActiveProvider = (modelIds: string[]): void => {
    if (!activeProvider) {
      return;
    }
    const normalized = normalizeModelIds(activeProvider, modelIds, { allowEmpty: true });
    console.debug("[provider-cascade] 更新弹层内模型选择", {
      kind: activeProvider,
      selectedModelCount: normalized.length
    });
    setDraftModelIds(normalized);
  };

  const toggleModel = (modelId: string): void => {
    const next = activeModelIds.includes(modelId)
      ? activeModelIds.filter((id) => id !== modelId)
      : [...activeModelIds, modelId];
    setDraftModelsForActiveProvider(next);
  };

  const confirmSelection = (): void => {
    if (!activeProvider) {
      return;
    }
    const normalized = normalizeModelIds(activeProvider, draftModelIds, { allowEmpty: true });
    console.debug("[provider-cascade] 确认供应商与模型选择", {
      kind: activeProvider,
      selectedModelCount: normalized.length
    });
    if (activeProvider === value && onSelectedModelIdsChange) {
      onSelectedModelIdsChange(normalized);
    } else {
      onValueChange(activeProvider, normalized);
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={withinModalDialog}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn("provider-cascade-trigger", styles.trigger, className)}
        >
          <span className="min-w-0 flex-1 truncate text-left">
            {selected ? selected.label : placeholder}
          </span>
          {visibleSelectedModelIds.length > 0 ? (
            <span className={cn("provider-cascade-count", styles.count)}>
              {t("settings.providers.modelCount", { count: visibleSelectedModelIds.length })}
            </span>
          ) : null}
          <ChevronIcon className={cn("provider-cascade-suffix-icon", styles.suffixIcon)} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("provider-cascade-popup p-0", styles.popup)}
        portalled={withinModalDialog}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className={cn("provider-cascade-menus", styles.menus)}>
          <div className={cn("provider-cascade-menu", styles.menu)}>
            {grouped.map((group) => (
              <button
                key={group.region}
                type="button"
                className={cn(
                  "provider-cascade-menu-item ant-cascader-menu-item",
                  styles.menuItem,
                  activeRegion === group.region && "provider-cascade-menu-item-active",
                  activeRegion === group.region && styles.menuItemActive
                )}
                onMouseEnter={() => {
                  console.debug("[provider-cascade] hover 供应商区域", {
                    region: group.region
                  });
                  activateRegion(group.region);
                }}
                onClick={() => activateRegion(group.region)}
              >
                <span>{t(providerRegionLabelKey(group.region))}</span>
                <ChevronRightIcon className={cn("provider-cascade-expand-icon", styles.expandIcon)} />
              </button>
            ))}
          </div>
          <div className={cn("provider-cascade-menu provider-cascade-provider-menu", styles.menu)}>
            {activeProviders.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "provider-cascade-menu-item ant-cascader-menu-item",
                  styles.menuItem,
                  activeProvider === option.value && "provider-cascade-menu-item-active",
                  activeProvider === option.value && styles.menuItemActive
                )}
                onMouseEnter={() => {
                  console.debug("[provider-cascade] hover 供应商", {
                    kind: option.value
                  });
                  previewProvider(option.value);
                }}
                onClick={() => previewProvider(option.value)}
              >
                <span className="truncate">{option.label}</span>
                <ChevronRightIcon className={cn("provider-cascade-expand-icon", styles.expandIcon)} />
              </button>
            ))}
          </div>
          <div
            className={cn(
              "provider-cascade-menu provider-cascade-model-menu",
              styles.menu,
              styles.modelMenu
            )}
          >
            {activeProvider ? (
              <>
                <div className={cn("provider-cascade-model-header", styles.modelHeader)}>
                  <span>{t("settings.providers.models")}</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      className={cn("provider-cascade-text-action", styles.textAction)}
                      onClick={() => setDraftModelsForActiveProvider([])}
                    >
                      {t("settings.providers.clearModels")}
                    </button>
                    <button
                      type="button"
                      className={cn(
                        "provider-cascade-text-action provider-cascade-confirm-action",
                        styles.textAction,
                        styles.confirmAction
                      )}
                      onClick={confirmSelection}
                    >
                      {t("confirmDialog.confirm")}
                    </button>
                  </span>
                </div>
                <div className={cn("provider-cascade-model-list", styles.modelList)}>
                  {activeModelOptions.map((model) => {
                    const checked = activeModelIds.includes(model.id);
                    return (
                      <label
                        key={model.id}
                        className={cn(
                          "provider-cascade-model-option",
                          styles.modelOption,
                          checked && "provider-cascade-model-option-selected",
                          checked && styles.modelOptionSelected
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          readOnly
                          aria-label={modelOptionLabel(model)}
                          onClick={(event) => {
                            event.preventDefault();
                            toggleModel(model.id);
                          }}
                        />
                        <span className={cn("provider-cascade-checkbox", styles.checkbox)} aria-hidden="true">
                          {checked ? <CheckMediumIcon className="size-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {modelOptionLabel(model)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className={cn("provider-cascade-empty", styles.empty)}>
                {t("settings.providers.hoverProviderForModels")}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ProviderModelTags({
  providerKind,
  modelIds,
  emptyLabel,
  onRemove
}: ProviderModelTagsProps) {
  const ids = providerKind && modelIds ? normalizeModelIds(providerKind, modelIds, { allowEmpty: true }) : [];
  if (!providerKind || ids.length === 0) {
    return <p className="text-micro text-muted-foreground">{emptyLabel}</p>;
  }
  const canRemove = ids.length > 1;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((modelId) => (
        <span key={modelId} className={cn("provider-model-tag", styles.modelTag)}>
          <span className="max-w-[220px] truncate">{modelLabel(providerKind, modelId)}</span>
          {onRemove ? (
            <button
              type="button"
              aria-label={`移除 ${modelLabel(providerKind, modelId)}`}
              disabled={!canRemove}
              className={cn("provider-model-tag-remove", styles.modelTagRemove)}
              onClick={() => {
                if (canRemove) {
                  onRemove(modelId);
                }
              }}
            >
              <XMarkIcon className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

export function defaultModelIds(kind: ProviderKind): string[] {
  const defaults = getCatalogDefaultEnabledModelIds(kind);
  if (defaults.length > 0) {
    return defaults;
  }
  return getCatalogModelOptions(kind).map((model) => model.id);
}

export function normalizeModelIds(
  kind: ProviderKind,
  modelIds: string[],
  options: { allowEmpty?: boolean } = {}
): string[] {
  const allowed = new Set(getCatalogModelOptions(kind).map((model) => model.id));
  const normalized = [...new Set(modelIds)].filter((id) => allowed.size === 0 || allowed.has(id));
  if (normalized.length > 0 || options.allowEmpty) {
    return normalized;
  }
  return defaultModelIds(kind);
}

export function modelLabel(kind: ProviderKind, modelId: string): string {
  return modelOptionLabel(
    getCatalogModelOptions(kind).find((model) => model.id === modelId) ?? {
      id: modelId,
      providerKind: kind,
      reasoningModes: [],
      inputModalities: ["text"],
      enabled: true,
      maxToolIterations: 500,
      autoCompactThresholdRatio: 0.8,
      source: "catalog"
    }
  );
}

function groupedOptions(options: ProviderKindOption[]): Array<{
  region: SelectableProviderRegion;
  options: ProviderKindOption[];
}> {
  return REGION_ORDER.map((region) => ({
    region,
    options: options.filter((option) => option.region === region && option.value !== "custom")
  })).filter((group) => group.options.length > 0);
}

function modelOptionLabel(option: ProviderModelOption): string {
  return option.label ?? option.id;
}

function isSelectableRegion(region: ProviderRegion): region is SelectableProviderRegion {
  return region !== "custom";
}

function providerRegionLabelKey(
  region: SelectableProviderRegion
):
  | "settings.providers.regions.cn"
  | "settings.providers.regions.global"
  | "settings.providers.regions.gateway" {
  return `settings.providers.regions.${region}` as const;
}
