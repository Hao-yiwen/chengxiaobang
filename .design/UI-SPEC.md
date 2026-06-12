# 程小帮 UI 最终规格书 ·「铅与纸」v1.0

> 本文档是可直接照着实现的最终规格。基于获胜提案「铅与纸」，融合评委指定的嫁接亮点（RunMetaLine 仪表行、HSL 覆写落地、失败工具行自呈现、计划书签条、旁注限流、流式降级保险丝、ask-user 即点即答、主题切换过渡、模型下拉决策信息），并修正评委指出的全部问题（用户气泡对比、页边注断点、印章标可达性、墨点唯一性、hr 撞符、danger 撞色、楷体边界、leader dots 实现、块 key 前提）。
>
> 所有文件路径以 `apps/desktop/src/renderer/` 为根（下文简写为 `renderer/`），契约改动在 `packages/shared/src/index.ts`。

---

## 0. 设计原则（实现时的判断依据）

1. **屏幕是纸，回答是文章**：assistant 输出排进 660px 版心，无气泡；一切 UI 部件是印刷部件——脚注（工具行）、页边注（btw）、目录（计划卡）、版记（RunMetaLine）。
2. **平面、hairline、零辉光**：用细线和三层暖纸分层；无彩色阴影、无玻璃拟态、无 pill 胶囊。色彩只有四种矿物墨（朱砂/苔绿/赭石/黛蓝）+ 一种冷红 danger，全部语义化，禁止装饰性使用。
3. **节奏即品味**：块内紧、块间松；正文 sans 保证屏读，衬线只点题；动效只做"墨迹浮现"，永不弹跳、永不闪烁、永不 shimmer。

冲突裁决规则：任何实现疑义，按「印刷物会怎么做」回答；印刷物没有的效果（辉光、悬浮、扫光、弹跳）一律不做。

---

## 1. 设计 Token

### 1.1 落地方式（重要）

**走 HSL 覆写，不搞双轨。** 保留 `tailwind.config.ts` 现有 `hsl(var(--x))` 管线，直接覆写 `global.css` 中 `:root` / `.dark` 的 HSL 三元组值，让 `ui/` 下 14 个 shadcn 原件零改动吃到纸墨色。新增的矿物色也以 HSL 三元组进入同一管线。**只有 alpha 合成必需的值**（hairline 三档、selection、inline-code 底、soft 底、阴影、字体、缓动）以字面量 CSS 变量存在——它们不与任何 shadcn token 重复，不构成双轨。

### 1.2 global.css token 层（整段替换现有 `@layer base` 的 `:root` / `.dark`，可直接粘贴）

```css
@layer base {
  :root {
    /* ===== shadcn HSL 覆写（换算表：HSL → 纸墨 hex）===== */
    --background: 45 33% 98%;            /* 纸·版心 #FBFAF7 */
    --foreground: 36 18% 11%;            /* 墨·正文 #211D17 */
    --surface: 45 27% 94%;               /* 纸·外壳/侧栏/代码底 #F4F2EC */
    --card: 60 100% 99.8%;               /* 纸·卡片/composer #FFFFFE */
    --card-foreground: 36 18% 11%;
    --popover: 60 100% 99.8%;
    --popover-foreground: 36 18% 11%;
    --primary: 36 18% 11%;               /* ink 实底按钮 */
    --primary-foreground: 45 33% 98%;
    --secondary: 45 20% 92%;
    --secondary-foreground: 42 16% 29%;  /* 墨·次级 #57503F */
    --muted: 44 22% 93%;
    --muted-foreground: 38 10% 49%;      /* 墨·三级 #8A8171 */
    --accent: 44 20% 91%;
    --accent-foreground: 36 18% 11%;
    --destructive: 352 66% 45%;          /* 冷红 #BE273B（已与朱砂拉开色相+明度）*/
    --destructive-foreground: 45 33% 98%;
    --border: 48 8% 87%;                 /* ≈ rgba(33,29,23,.12) 压平在版心上 */
    --input: 36 5% 79%;                  /* ≈ rgba(33,29,23,.22) 压平 */
    --ring: 36 18% 11%;
    --brand: 36 18% 11%;
    --brand-foreground: 45 33% 98%;
    --brand-soft: 44 22% 93%;
    --accent-amber: 36 63% 37%;          /* 赭石复用 */
    --radius: 0.5rem;                    /* 8px；shadcn sm=0、md=4px、lg=8px、xl=12px */
    --shadow-color: 36 18% 11%;          /* 阴影基色改暖墨 */
    --bubble-user: 45 27% 91%;           /* 用户气泡实色 #EFECE3（修正：弃 0.045 alpha）*/

    /* ===== 矿物墨（HSL 三元组，进 tailwind colors）===== */
    --cinnabar: 12 67% 38%;              /* 朱砂 #A23B20：强调/链接hover/当前项 */
    --moss: 142 26% 33%;                 /* 苔绿 #3F6B4F：成功/diff+ */
    --ochre: 36 63% 37%;                 /* 赭石 #9A6B23：警示/旁注/待审批 */
    --indigo: 205 37% 32%;               /* 黛蓝 #33566F：计划模式/信息 */

    /* ===== 四级墨阶补充（ink/ink-2 已被 foreground/secondary-fg 覆盖）===== */
    --ink-3: 38 10% 49%;                 /* #8A8171 muted/时间戳 */
    --ink-4: 40 15% 65%;                 /* #B3AA98 faint/placeholder */

    /* ===== 字面量层：alpha 合成必需，非双轨 ===== */
    --line: rgba(33, 29, 23, 0.12);
    --line-strong: rgba(33, 29, 23, 0.22);
    --line-weak: rgba(33, 29, 23, 0.06);
    --paper-inset: rgba(33, 29, 23, 0.06);        /* 仅 inline code 底 */
    --selection: rgba(162, 59, 32, 0.16);
    --cinnabar-soft: rgba(162, 59, 32, 0.08);
    --indigo-soft: rgba(51, 86, 111, 0.08);
    --moss-soft: rgba(63, 107, 79, 0.08);          /* diff + 底 */
    --ochre-soft: rgba(154, 107, 35, 0.10);
    --danger-soft: rgba(190, 39, 59, 0.08);        /* diff − 底 */

    --sh-composer: 0 1px 0 var(--line-weak), 0 10px 30px rgba(33, 29, 23, 0.07);
    --sh-popover: 0 4px 12px rgba(33, 29, 23, 0.06), 0 16px 40px rgba(33, 29, 23, 0.12);
    --sh-dialog: 0 24px 64px rgba(33, 29, 23, 0.18);

    --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
      "Hiragino Sans GB", sans-serif;
    /* ui-serif → macOS New York（Chromium 支持）；Latin 先行，汉字落 Songti */
    --font-serif: ui-serif, "New York", Georgia, "Songti SC", "Source Han Serif SC", serif;
    /* 楷体作注；Latin 先落 Georgia（修正：Kaiti 西文字形不堪用） */
    --font-note: Georgia, "Kaiti SC", "STKaiti", "Songti SC", serif;
    --font-mono: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;

    --t-micro: 120ms;
    --t-std: 180ms;
    --t-deep: 260ms;
    --ease-out: cubic-bezier(0.25, 1, 0.5, 1);
    --ease-enter: cubic-bezier(0.22, 1, 0.36, 1);
  }

  .dark {
    --background: 36 10% 10%;            /* 暖黑版心 #1B1916 */
    --foreground: 41 30% 89%;            /* #ECE7DC */
    --surface: 30 11% 7%;                /* 外壳 #141210（兼代码底） */
    --card: 42 17% 12%;                  /* #232019 */
    --card-foreground: 41 30% 89%;
    --popover: 42 17% 12%;
    --popover-foreground: 41 30% 89%;
    --primary: 41 30% 89%;
    --primary-foreground: 36 10% 10%;
    --secondary: 42 12% 16%;
    --secondary-foreground: 40 14% 67%;  /* #B8B0A0 */
    --muted: 42 12% 15%;
    --muted-foreground: 41 9% 51%;       /* #8C8576 */
    --accent: 42 12% 18%;
    --accent-foreground: 41 30% 89%;
    --destructive: 352 80% 64%;          /* 冷红 #ED5A6E（与暗朱砂 #D26A48 色相差 >330°环上 23°+明度差） */
    --destructive-foreground: 36 10% 10%;
    --border: 40 6% 19%;
    --input: 34 5% 27%;
    --ring: 41 30% 89%;
    --brand: 41 30% 89%;
    --brand-foreground: 36 10% 10%;
    --brand-soft: 42 12% 16%;
    --accent-amber: 37 53% 55%;
    --shadow-color: 0 0% 0%;
    --bubble-user: 38 15% 14%;           /* #2A261F 实色（修正暗色 0.06 同病） */

    --cinnabar: 15 61% 55%;              /* #D26A48 */
    --moss: 134 21% 60%;                 /* #82AE8C */
    --ochre: 37 53% 55%;                 /* #C99A4E */
    --indigo: 204 34% 63%;               /* #7FA6C0 */

    --ink-3: 41 9% 51%;
    --ink-4: 42 9% 36%;                  /* #645F53 */

    --line: rgba(236, 231, 221, 0.12);
    --line-strong: rgba(236, 231, 221, 0.22);
    --line-weak: rgba(236, 231, 221, 0.06);
    --paper-inset: rgba(236, 231, 221, 0.07);
    --selection: rgba(210, 106, 72, 0.22);
    --cinnabar-soft: rgba(210, 106, 72, 0.12);
    --indigo-soft: rgba(127, 166, 192, 0.12);
    --moss-soft: rgba(130, 174, 140, 0.12);
    --ochre-soft: rgba(201, 154, 78, 0.14);
    --danger-soft: rgba(237, 90, 110, 0.12);

    /* 暗色阴影：alpha ×1.6，基色 #000 */
    --sh-composer: 0 1px 0 var(--line-weak), 0 10px 30px rgba(0, 0, 0, 0.11);
    --sh-popover: 0 4px 12px rgba(0, 0, 0, 0.10), 0 16px 40px rgba(0, 0, 0, 0.19);
    --sh-dialog: 0 24px 64px rgba(0, 0, 0, 0.29);
  }
}
```

随附改动（同文件）：

```css
::selection { background: var(--selection); }

/* 滚动条转暖墨 */
::-webkit-scrollbar-thumb { background-color: rgba(33, 29, 23, 0.18); }
::-webkit-scrollbar-thumb:hover { background-color: rgba(33, 29, 23, 0.32); }
.dark ::-webkit-scrollbar-thumb { background-color: rgba(236, 231, 221, 0.16); }
.dark ::-webkit-scrollbar-thumb:hover { background-color: rgba(236, 231, 221, 0.30); }

/* 主题切换的体面：仅颜色参与，transform/layout 不动（嫁接自 2 号） */
html.theme-switching,
html.theme-switching *,
html.theme-switching *::before,
html.theme-switching *::after {
  transition: background-color 360ms var(--ease-out), color 360ms var(--ease-out),
    border-color 360ms var(--ease-out) !important;
}

/* 无障碍豁免块：motion 与 transparency 统一写在一处 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
  .ink-caret { animation: none !important; opacity: 0.6; }
}
@media (prefers-reduced-transparency: reduce) {
  * { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
}
```

删除 `global.css` 中：`.stream-caret`（::after 方案整段删除，见 §4.1）、`.shimmer-text`、`@keyframes shimmer`。
`use-theme.ts`：切换主题时给 `<html>` 加 `theme-switching` 类，400ms 后移除（setTimeout，记日志级别 debug 即可）。

### 1.3 tailwind.config.ts 增量

```ts
// colors 追加（保留现有全部条目不动）
cinnabar: { DEFAULT: "hsl(var(--cinnabar))", soft: "var(--cinnabar-soft)" },
moss:     { DEFAULT: "hsl(var(--moss))",     soft: "var(--moss-soft)" },
ochre:    { DEFAULT: "hsl(var(--ochre))",    soft: "var(--ochre-soft)" },
indigo:   { DEFAULT: "hsl(var(--indigo))",   soft: "var(--indigo-soft)" },
"ink-3":  "hsl(var(--ink-3))",
"ink-4":  "hsl(var(--ink-4))",
line: { DEFAULT: "var(--line)", strong: "var(--line-strong)", weak: "var(--line-weak)" },
inset: "var(--paper-inset)",

// fontFamily 追加
serif: ["ui-serif", "New York", "Georgia", "Songti SC", "Source Han Serif SC", "serif"],
note:  ["Georgia", "Kaiti SC", "STKaiti", "Songti SC", "serif"],

// boxShadow 三档整体替换
soft: "none",
composer: "var(--sh-composer)",
elevated: "var(--sh-popover)",
dialog: "var(--sh-dialog)",

// keyframes：删 caret / mic-pulse（shimmer 在 css 里删）；msg-in 改 2px/160ms；新增 ink-pulse
"msg-in": { from: { opacity: "0", transform: "translateY(2px)" }, to: { opacity: "1", transform: "translateY(0)" } },
"ink-pulse": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.25" } },
// animation
"msg-in": "msg-in 160ms cubic-bezier(0.22, 1, 0.36, 1)",
"ink-pulse": "ink-pulse 1200ms ease-in-out infinite",
```

### 1.4 字号节奏（px / line-height；以 Tailwind 任意值或 utilities 实现）

| token | 值 | 用途 |
|---|---|---|
| chip | 10.5 / 14 | 印章标、RunMetaLine |
| caption | 11.5 / 16 | 时间戳、语言标、行数 |
| footnote | 12.5 / 19 | 工具行、署名行、回执行 |
| note | 13 / 21 | 页边注（楷体） |
| ui | 13 / 20 | 侧栏、菜单、按钮 |
| body-sm | 13.5 / 21 | 表格 td、计划步骤；代码块 13 / 21 |
| body | **15 / 26** | 聊天正文（版心 660px ≈ 44 字/行） |
| title-sm | 16 / 24 | markdown h3（衬线） |
| title | 18 / 27 | markdown h2、卡片标题（衬线） |
| title-lg | 22 / 32 | markdown h1、视图标题（衬线 600） |
| hero | 30 / 40 | 空状态（衬线 600） |

数字一律 `font-feature-settings: "tnum" 1`（表格、token 统计、序号、仪表行）。建一个 utility：`.tnum { font-feature-settings: "tnum" 1; }`。

### 1.5 间距（4px 基数）

`4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 56`。关键节奏：**turn 之间 40px**；turn 内消息与工具行 12px；卡片内边距 `16px 20px`（小卡 `10px 14px`）；版心左右最小留白 48px；composer 距底 20px、距正文 16px。

### 1.6 圆角（反胶囊）

| 用途 | 值 |
|---|---|
| inline code、印章标 | 3px |
| 按钮、输入框、图标按钮、chip | 6px |
| 代码块、工具行展开、卡片、下拉 | 8px |
| 用户气泡、ask-user 卡 | 10px |
| composer、对话框 | 14px |

禁用 pill、禁用 >16px。`--radius: 0.5rem` 已使 shadcn 各组件自动落到 4/8/12px 档。

### 1.7 动效纪律

- hover/按压 120ms；展开/入场 180ms；面板/对话框 260ms。按压 `scale(0.97)`。
- 入场统一 `opacity 0→1 + translateY(2px)→0`，160ms `--ease-enter`（即改造后的 `animate-msg-in`）。
- **唯一循环动画 = ink-pulse**，且同屏唯一（见 §3.3 优先级规则）。
- 禁止：hover 位移/加影、shimmer、逐字符动画、彩色 ring 辉光。

---

## 2. 全局元件

### 2.1 StampBadge 印章标（新建 `renderer/components/StampBadge.tsx`）

```ts
type StampTone = "moss" | "danger" | "ochre" | "indigo" | "ink" | "faint";
interface StampBadgeProps {
  text: string;        // 显示字，允许 1–2 个汉字："成"/"已转"/"草稿"
  fullLabel: string;   // 全词，用于 title + aria-label："成功"/"已转为任务"/"草稿"
  tone: StampTone;
}
```

- 样式：10.5px 衬线，`letter-spacing: 0.05em`，1px 同色边框（颜色 60% 透明度），radius 3px，padding `0 4px`，行高 14px，色与边同 tone。
- **可达性（修正）**：根元素必须带 `title={fullLabel}` 与 `aria-label={fullLabel}`；显示字允许双字宽度，不强行单字。
- 预设映射（工具行用）：`成→成功(moss)`、`败→失败(danger)`、`候→待批准(ochre)`、`行→运行中(indigo)`；计划卡用：`草稿(ink-3)/待确认(ochre)/执行中(indigo)/已完成(moss)/已拒绝(faint)`；复制回执 `已录→已复制(moss)`；旁注 `已转→已转为任务(moss)`。

### 2.2 hairline hover 词汇（全局统一）

一切可点卡片/行 hover：**不位移、不加影**，只做 `border-color: var(--line) → var(--line-strong)` + `background: transparent → hsl(var(--muted))`（或 `--paper-inset`），各 120ms。两种按钮形态全局复用：

- **ink 实底按钮**：`bg-primary text-primary-foreground`，radius 6px，13px，padding `5px 12px`；hover 亮度 +6%（`filter: brightness(1.06)` 浅色 / `0.94` 反向暗色）；按压 scale(0.97)。
- **hairline 按钮**：透明底 + 1px `var(--line)` 边，文字 ink-2；hover 边转 line-strong + 底 muted。

### 2.3 墨点光标与唯一性规则（修正）

- `.ink-caret`：真实行内元素 `<span class="ink-caret" aria-hidden>`，`display:inline-block; width:2px; height:1em; margin-left:2px; vertical-align:-0.12em; background: hsl(var(--foreground)); animation: ink-pulse 1200ms ease-in-out infinite;`
- **同会话同屏只允许一个活动墨点**。优先级：流式正文光标 > 计划卡当前步 `▍` > 思考行。实现：`renderer/lib/ink-owner.ts` 导出纯函数 `resolveInkOwner(state): "stream" | "plan" | "thinking" | null`（依据 streamText 非空 / plan.status==="executing" / thinking 活跃），store 暴露 selector；非 owner 的墨点渲染为静态 60% 透明度（加 `.ink-caret-static` 类：`animation:none; opacity:0.6`）。纯函数配单测。

---

## 3. 聊天主视图（`renderer/components/ChatView.tsx`）

### 3.1 布局

```
┌──────────────┬──────────────────────────────────────────────────────┐
│ 侧栏 264px    │  bg-background（版心纸），内容列 660px 居中             │
│ bg-surface   │                                                      │
│              │  你                                  14:32  [复制]    │ ← hover 才现
│              │            ┌──────────────────────────────────┐      │
│              │            │ 用户消息（markdown 渲染）            │      │
│              │            └──────────────────────────────────┘      │
│              │                                                      │
│              │  程小帮 · deepseek-v4-flash                           │ ← 署名行
│              │  正文平铺，无气泡……                                    │
│              │  ¹ read_file  src/store/index.ts  2.3KB  [成]        │ ← 脚注工具行
│              │  12.4s · 2,113 tok · deepseek-v4-flash               │ ← RunMetaLine
│              │                    · · ·                             │ ← run 节间符
│              │  ┌ Composer ┐                                        │
└──────────────┴──────────────────────────────────────────────────────┘
```

- 内容列：`max-width: 660px; margin-inline: auto; padding-inline: 48px`（窄窗时 padding 保底）。
- **用户消息**：右对齐，`max-width: min(75%, 560px)`，`bg: hsl(var(--bubble-user))`（实色，修正对比），`border: 1px solid var(--line)`，radius 10px，padding `10px 14px`，14px/24。**升级为 markdown 渲染**（复用 `<Markdown>`，但禁 h1–h3 放大：用户气泡内标题一律按正文字号加粗）。附件引用以 11.5px mono chip 列在气泡底部（可追溯，解短板 9）。
- **assistant**：无底色无边框，15px/26 平铺。每个 turn 顶部**署名行**：`程小帮 · {model}`，12.5px，"程小帮" ink-3 sans、模型名 mono ink-3；turn 间距 40px，turn 内（消息↔工具行）12px。
- **run 节间符**：run 与 run 之间居中 `· · ·`，11px ink-4，上下 24px；三点入场错峰 60ms 依次淡入。此符号为 run 分隔**专属**（markdown hr 已改样式，见 §5）。
- 时间戳/复制：`opacity-0 group-hover:opacity-100`，120ms。
- **空状态**：衬线 hero「今天写点什么？」30px/40 600，下方 `HomeStarters.tsx` 改为**目录式列表**：hairline 分隔的三行启动项，行高 44px，序号 `01/02/03` 衬线 tnum ink-3 宽 28px，标题 13.5px ink；hover 行底 muted + 序号转朱砂。数据与 composer `/` 菜单、设置页技能区共用同一清单（store.slashCommands）。
- timeline 计算包 `useMemo`（依赖 messages/toolCalls 引用）；`lib/timeline.ts` 排序键补 `createdAt` 同值时比 `seq`（落库自增或数组序）次级键，杜绝同毫秒乱序（解短板 3）。

### 3.2 RunMetaLine 仪表行（嫁接自 1 号；新建 `renderer/components/RunMetaLine.tsx`）

```ts
interface RunMetaLineProps {
  durationMs: number;
  totalTokens: number;        // prompt + completion
  model: string;
  onCopy(): void;
  onRegenerate(): void;
  onFork(): void;
}
```

- 每个 assistant turn 末尾**常驻**一行：`12.4s · 2,113 tok · deepseek-v4-flash`。10.5px mono，ink-4，tnum，千分位；时长 <60s 取一位小数，≥60s 用 `1m 12s`。
- hover（**延迟 80ms** 再现身，离开即隐）在行尾浮现三个 12px 图标按钮：复制 / 重新生成 / fork，hairline hover 词汇；现有 `MessageActions.tsx` 的动作迁入此处，组件可保留为内部实现。
- 数据（修复短板 10）：store 新增 `runMeta: Record<string /* assistantMessageId */, { durationMs; promptTokens; completionTokens; model }>`，在 `run_completed` 事件时以当次 run 的 assistant 消息 id 落键；废弃全局 `lastUsage` 的 UI 消费；切会话不串台（按消息 id 取数，取不到则整行不渲染）。

---

## 4. 流式渲染（`renderer/components/StreamingMarkdown.tsx` 等）

### 4.1 光标

- 删除 `.stream-caret::after` 容器外挂方案。`StreamingMarkdown` 渲染尾块时，把 `<span class="ink-caret">` 注入**最后一个文本节点之后**：实现方式为给尾块的 `<Markdown>` 传 `appendCaret` prop，在组件覆写的最末段落/列表项/标题闭合前追加该 span（react-markdown 覆写组件内判断「是否为尾块最后一个块级元素」，用 context 传递）。代码块尾块流式中光标挂在代码块下一行行首。
- 光标动画与唯一性遵循 §2.3。

### 4.2 块级管线与 key（修正后的规则）

- 保留 remend 尾部修复 + marked Lexer 切顶层块 + 每块独立 memoized `<Markdown>`、每个 delta 只重 parse 尾块的管线。
- **块 key 改为 `${blockStartOffset}:${blockType}` 哈希**。生效前提（必须写进实现注释）：流式输入是 **append-only**，remend 修复只改写尾部切片。规则：
  1. 设 `repairStart` = remend 本次实际改写的最小偏移（remend 返回或自行 diff 求得）；
  2. `startOffset < repairStart` 的块 key 必须不变（前缀稳定）；
  3. 只允许 `startOffset ≥ repairStart` 的尾部块（通常仅最后 1–2 块，合并/分裂场景）key 失效重渲；
  4. **禁止**偏移连锁导致整列 remount——dev 模式加断言：单次 delta 后 key 集合变更数 > 3 时 `console.warn` 带前后块摘要（留排查日志）。
- 配单测：模拟「段落长成列表」「两块合并」「尾部代码块闭合」三场景，断言前缀块 key 稳定。

### 4.3 入场动画与降级保险丝（嫁接自 2 号）

- 新出现的顶层块：`animate-msg-in`（opacity 0→1 + translateY 2px→0，160ms `--ease-enter`）；已稳定块零动画。**不做逐字符动画**。
- **保险丝**：单次 onEvent 的 `assistant_delta` 文本 > **2KB**（大段代码涌入）时，本次 flush 产生的新块**跳过入场动画直接渲染**（给这批块加 `data-no-anim`，不挂 animate 类），杜绝动画排队的爬行感。阈值常量 `STREAM_ANIM_FUSE_BYTES = 2048` 放 `renderer/lib/streaming-markdown.ts`。

### 4.4 代码块流式中

- 未闭合/流式中的代码块：先以等行高纯 escape 文本渲染（mono 13px/21 恒定行高），**highlight 完成后原位替换**，杜绝高亮造成的行高跳动；流式中复制按钮置灰（`disabled` + opacity 40%）。

### 4.5 滚动（新建 `renderer/hooks/useStickToBottom.ts`）

```ts
function useStickToBottom(ref: RefObject<HTMLElement>, deps: { streaming: boolean }): {
  isPinned: boolean;        // 距底 < 96px
  scrollToBottom(opts?: { force?: boolean }): void;
}
```

- 距底 < 96px 视为贴底；流式期间 rAF 合并滚动 + `behavior:'auto'` 瞬时；静态时 `smooth`。
- 用户上滑即停跟随（wheel/touch 向上即 unpin）；**发送新消息强制回底**。
- `ScrollToBottomButton.tsx` 接 `isPinned` 显隐，重皮为 hairline 圆角 6px 小按钮。

### 4.6 思考流（`renderer/components/ReasoningPanel.tsx`）

- 折叠态一行：`思考中 · 4s`，12.5px ink-3 + 墨点（受 §2.3 优先级管辖）；结束自动收起为 `思考 · 12s`，用户手动展开过则保持展开。
- **展开正文（修正）：sans 13px/21 ink-2**（不用楷体——长流楷体灰度不均），左侧 2px `var(--line-weak)` 边 + padding-left 12px。楷体只留给 ≤3 行的注（见 §5 blockquote/图注、§9 旁注）。

---

## 5. Markdown 渲染规格（`renderer/components/Markdown.tsx` 重写覆写组件）

| 元素 | 规格 |
|---|---|
| p | 15px/26，`margin: 0.7em 0`，`letter-spacing: 0.01em` |
| h1 | 衬线（font-serif）22px/32 600，`margin: 1.9em 0 0.5em` |
| h2 | 衬线 18px/27 600，`margin: 1.7em 0 0.45em` |
| h3 | 衬线 16px/24 600，`margin: 1.4em 0 0.4em` |
| h4 | sans 13px/20 600，ink-2，`letter-spacing: 0.08em`，`margin-top: 1.3em` |
| strong | 600，不变色 |
| blockquote | 左 2px 朱砂 rule（`border-left: 2px solid hsl(var(--cinnabar))`），padding-left 16px，**楷体（font-note）** 15px/26 ink-2，`margin: 1em 0`；无底色 |
| ul/ol | li 间距 0.25em；嵌套缩进 1.25em；ol 序号衬线 + tnum（`::marker { font-family: var(--font-serif) }`）；ul marker 13px ink-3 |
| inline code | mono 0.86em，`bg: var(--paper-inset)`，radius 3px，padding `1px 5px`，无边框，不换色 |
| 代码块 | 见下方细则 |
| table | **booktabs**：无竖线；`border-top/bottom: 1.5px solid var(--line-strong)`；表头下 1px `var(--line)`；行间 1px `var(--line-weak)`；th 12px 600 ink-3 `letter-spacing: 0.04em` 左对齐；td 13.5px/21，padding `8px 12px`；数字列右对齐 + tnum（渲染时按列内容启发式判定：>60% 单元格匹配数字模式即右对齐）；超宽容器 `overflow-x: auto`，容器无圆角无底色 |
| hr | **（修正）居中 96px 宽 1px `var(--line-weak)` 短线**，`margin: 2em auto`；`· · ·` 三点符号专属 run 分隔符，hr 不得使用 |
| a | ink 色 + 1px 下划线 `text-underline-offset: 3px`（下划线常驻，非 hover 才出现）；hover 文字与线同步转朱砂 120ms；`http(s)` 外链尾缀 `↗` 11px |
| img | radius 6px + 1px `var(--line)` 边框，`max-width: 100%`；alt 文字渲染为图下说明：**楷体** 12px ink-3 居中，`margin-top: 6px` |
| del | ink-4，保留删除线 |
| task list | checkbox 渲染为 12px 方框（1px line-strong，选中填 ink + 白 ✓），不可交互 |

### 代码块细则（`renderer/components/markdown/CodeBlock.tsx`）

- 容器：`bg: hsl(var(--surface))`，1px `var(--line-weak)` 边框，radius 8px，`margin: 1em 0`。
- **页眉栏**（高 32px，底边 1px `var(--line-weak)`）：左侧语言标 11.5px mono `letter-spacing: 0.06em` ink-3 小写；右侧行数（`86 行`，11.5px ink-4，常驻）+ 复制按钮（hover 容器才现身，点击后图标换印章标 `已录`，1.5s 淡回，不弹 toast）。
- 正文：mono 13px/21，padding `14px 16px`，横向滚动不折行。
- **折叠**：渲染高度 > 360px 自动折叠至 360px，底部 2.5rem 三停渐隐踢脚（`linear-gradient(transparent, hsl(var(--surface)) 60%, hsl(var(--surface)))`）；整条渐隐区可点展开，hover 时浮出 `展开 ⌄ 86 行`（11.5px mono ink-2 居中）；展开动画 `grid-template-rows 0fr→1fr` 260ms `--ease-out`。
- 性能：`content-visibility: auto; contain-intrinsic-size: auto 240px;`。
- 高亮主题：重写 global.css 的 hljs 段，**语法色与矿物色板同源**：keyword `hsl(var(--cinnabar))`、string/addition `hsl(var(--moss))`、title/function/section `hsl(var(--indigo))`、number/literal `hsl(var(--ochre))`、comment/quote/meta `hsl(var(--ink-4))` italic、attr/type/built_in 黛蓝降饱和（`hsl(205 25% 40%)` / dark `hsl(204 28% 70%)`）。浅暗两套照 1.2 节明度规律（暗色取各矿物 dark 值）。

---

## 6. Composer（`renderer/components/Composer.tsx` 重皮，逻辑保留）

```
┌────────────────────────────────────────────────────────────┐ ← 计划模式时顶部 2px 黛蓝
│ ▍计划模式 · 先想后做                                 (黛蓝行) │   边线 + 本水印行
├────────────────────────────────────────────────────────────┤
│  说点什么，或输入 / 调用技能…                     min-h 56px  │ ← 15px/26
├────────────────────────────────────────────────────────────┤
│ DeepSeek · v4-flash ▾  [◻ 计划]  /技能  @文件   审批 ▾   ↑  │ ← 工具栏 32px
└────────────────────────────────────────────────────────────┘
  radius 14px · bg-card · 1px var(--line) · shadow-composer · 距底 20px
```

- **聚焦态**：边框转 `var(--line-strong)`，无 ring、无辉光。placeholder ink-4。
- **模型选择器**（重构现有 Select，位置不变）：左下角文字按钮，mono 12px ink-2，`{Provider} · {model}` + 6px chevron（opacity 35%）。下拉（radius 8px，shadow-popover）：
  - 按 provider 分组，组名 11.5px ink-3 衬线；
  - 每行：模型名 mono 13px；**行右侧（嫁接自 1 号）**：上下文窗读数 mono 11.5px ink-4（`128k`，数据取 shared `defaultProviders` 的模型元数据）+ key 配置状态点（6px 圆点：已配 = moss 实心，未配 = 1px `var(--line-strong)` 空心；`title="已配置 API Key"/"未配置"`）；
  - 当前项前置 2px 朱砂短竖线；
  - 底部 hairline 分隔后一行「管理模型…」跳设置页。
  - 会话内切换即时生效，署名行随之更新（现有 `setProviderId` 链路不动）。
- **计划模式开关**：方角 chip（radius 6px，1px line）：默认 `◻ 计划` ink-3；开启后底 `var(--indigo-soft)`、文字黛蓝、图标 ☑，composer 顶部浮出 2px 黛蓝上边线（scaleX 0→1 从左向右 260ms `--ease-out`）+ 水印行 `▍计划模式 · 先想后做`（12px 黛蓝）淡入。
- 审批模式下拉、项目/对话切换：沿用现有 DropdownMenu，仅 token 重皮。
- 发送按钮：28×28 radius 6px；空内容时 ink-4 描边态，有内容时 ink 实底 + 纸色 ↑（180ms 过渡）；运行中旋转 90° 切换为 ◼ 停止（180ms，方块图标 destructive 色、底仍 ink）；按压 scale(0.97)。
- slash/@ 双菜单：状态机抽到 **`renderer/hooks/useComposerMenus.ts`**（解短板 8）：

```ts
function useComposerMenus(input: {
  value: string; caretPos: number;
  slashCommands: SlashCommand[];
  listProjectFiles?: (q: string) => Promise<FileEntry[]>;
}): {
  active: "slash" | "file" | null;
  items: MenuItem[]; highlighted: number;
  onKeyDown(e: KeyboardEvent): boolean;   // true = 已消费
  select(index: number): MenuSelection;
}
```

  浮层 radius 8px shadow-popover；候选行 13px；kind 标用 StampBadge（`技`/`件`，fullLabel「技能」「文件」）。hook 纯逻辑配单测。

---

## 7. 计划卡 PlanCard + 书签条（新建）

### 7.1 PlanCard（`renderer/components/PlanCard.tsx`）

```ts
interface PlanStep { id: string; title: string; status: "todo" | "doing" | "done"; }
interface PlanCardProps {
  title: string;
  steps: PlanStep[];
  status: "draft" | "awaiting" | "executing" | "completed" | "rejected";
  onConfirm(): void;
  onReject(): void;
  onUpdateSteps(steps: PlanStep[]): void;   // 仅 draft 态可调用
}
```

布局（插在 timeline 的 `plan_proposed` 事件位，随对话滚动）：

```
┌──────────────────────────────────────────────────────┐
│  计 划                                    [草稿]      │ ← 衬线16px + StampBadge
│  重构 store 模块                                      │ ← 衬线 18px/27 600
│ ──────────────────────────────────────────────────── │ ← 1px var(--line)
│  01  梳理现有 state 依赖 ······················  ✓    │
│  02  拆分 store/ 为三个切片 ····················  ▍   │ ← 当前步墨点（受唯一性规则）
│  03  迁移组件订阅 ······························      │
│ ──────────────────────────────────────────────────── │
│  2 / 4 · 预计还需 2 步            [修改]  [确认执行]   │ ← tnum
└──────────────────────────────────────────────────────┘
  radius 8px · 1px var(--line) · 左侧 3px 黛蓝边 · bg-card · padding 16px 20px
```

- 步骤行：高 32px，flex `align-items: center`；序号衬线 13px tnum ink-3 宽 24px；标题 13.5px。
- **leader 引线（修正实现）**：不用 dotted border。结构 `[序号][标题 span][leader span][状态]`：
  - 标题 span：`min-width: 0; flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`（长标题截断，不挤爆）；
  - leader span：`flex: 1 1 12px; height: 2px; margin: 0 8px; position: relative; top: 0.18em; background-image: repeating-linear-gradient(to right, var(--line) 0 2px, transparent 2px 7px); background-position: left bottom; background-size: 100% 2px; background-repeat: no-repeat;` —— 自绘等距圆点，非 Retina 不糊；
  - 状态格：宽 20px 居中。
- 状态语义：完成步 = 标题转 ink-3 + 序号转朱砂 + ✓ 苔绿（**不用删除线**）；进行中 = `▍` 墨点（owner 时呼吸，否则静态 60%）；待办 = 全 ink-3。
- ✓ 落笔动画：SVG `stroke-dashoffset` 240ms 画出，引线右端状态字 160ms 淡入。
- 草稿态：点击步骤行内变 input（13.5px，底边 1px `var(--line-strong)`，无框）；行尾 hover 现 `×` 删除；底部 `＋ 添加步骤` 12.5px ink-3。「确认执行」ink 实底按钮、「修改」hairline 按钮。
- 右上印章标随状态机：`草稿(ink)/待确认(ochre)/执行中(indigo)/已完成(moss)/已拒绝(faint)`，均带 fullLabel。

### 7.2 PlanBookmark 书签条（嫁接；新建 `renderer/components/PlanBookmark.tsx`）

```ts
interface PlanBookmarkProps {
  current: { index: number; total: number; title: string };  // 1-based
  onJump(): void;
}
```

- 触发：plan.status 为 `awaiting | executing` 且 PlanCard 滚出视口（ChatView 对卡片挂 IntersectionObserver）。
- 形态：画布顶部 sticky（滚动容器内 `position: sticky; top: 0; z-index: 10`），高 **28px**，宽随版心 660px；`bg-card`，底边 1px `var(--line)`，无阴影；内容 `02 / 04 · 拆分 store 切片` 12px mono tnum ink-2，左侧 8px 黛蓝 2px 短竖线，右端 11px chevron-up ink-4。
- 点击 → `scrollIntoView({ behavior: "smooth", block: "center" })` 回到卡片；入场/退场 opacity+translateY(-4px) 160ms。

---

## 8. ask-user 问答卡（新建 `renderer/components/AskUserCard.tsx`）

```ts
interface AskUserOption { key: string /* "A" */; label: string; recommended?: boolean; }
interface AskUserCardProps {
  question: string;
  options: AskUserOption[];
  resolved?: { type: "option"; key: string } | { type: "custom"; text: string };
  onAnswer(a: { type: "option"; key: string } | { type: "custom"; text: string }): void;
}
```

```
   ¿  程小帮想确认一件事                        ← 12.5px ink-3
┌──────────────────────────────────────────────────────┐
│  用哪种方式处理旧的 API 兼容层？                        │ ← 衬线 16px/24
│ ──────────────────────────────────────────────────── │
│   A   保留并标记 deprecated（推荐）                    │ ← 行高 44px, hairline 分隔
│   B   直接移除，major 版本升级                         │
│ ──────────────────────────────────────────────────── │
│   其他：  ____________________________________  [答复] │
└──────────────────────────────────────────────────────┘
  radius 10px · 1px var(--line-strong) · bg-card · 左 3px 朱砂边
```

- 字母序号衬线 14px ink-3，宽 28px 右对齐；推荐项 label 尾缀「（推荐）」ink-3。
- **单击选项即提交（嫁接自 2 号）**：点击/回车/直接按 A-Z 键 → 该行底色 `var(--cinnabar-soft)` 闪现 240ms → 调 `onAnswer` → 整卡塌缩为一行回执：`¿ 旧 API 兼容层 → A 保留并标记 deprecated`（12.5px ink-2，左 3px 朱砂边保留），180ms 高度塌缩。不设确认步。
- 选项行 hover：底 `var(--cinnabar-soft)` 120ms，序号转朱砂；↑↓ 键盘导航有相同高亮。
- **自定义输入互斥表达（嫁接）**：「其他」input 聚焦时，选项组整体 `opacity: 0.5`（120ms）但仍可点击（点选项 = 放弃自定义并提交该项）；input 底边式（1px 底线，聚焦转 line-strong），回车或「答复」hairline 按钮提交 custom。
- 等待期间 composer placeholder 改「程小帮在等你的回答…」（ink-4）；此时在 composer 发送文本 = 提交 custom 答案（store 层路由）。
- 数据通路：复用 pendingTool 阻塞机制——后端发 `tool_call_pending`（`name === "ask_user"`），ChatView 分支渲染本卡；回答走扩展后的 `POST /api/approvals/:toolCallId`（payload 带答案）；历史落 timeline 后由 ToolCallRow 以回执行形态渲染。

---

## 9. btw 旁注 AsideNote（新建 `renderer/components/AsideNote.tsx`）

```ts
interface AsideNoteProps {
  text: string;
  layout: "gutter-wide" | "gutter-narrow" | "inline";
  converted: boolean;                  // 已转为任务
  onConvertToTask(text: string): void; // 填入 composer 草稿，不自动发送
}
```

**三档断点（修正：补中间形态，且 inline 是第一形态、规格同权）**——断点判定用 ChatView 内容区 `ResizeObserver` 宽度，不用全局视口：

| 形态 | 条件（内容区宽） | 规格 |
|---|---|---|
| `gutter-wide` | ≥ 1096px（660 版心 + 2×48 留白 + 220 注 + 24 间距） | 旁注绝对定位于版心右缘外 24px，宽 220px，与触发它的正文块顶端对齐 |
| `gutter-narrow` | 916–1095px | 旁注贴版心右内缘外侧，宽 **180px**，间距 16px；版心左移（内容列 `margin-left: max(48px, auto)`），正文不重叠 |
| `inline` | < 916px | 正文流内缩进块：`margin: 8px 0 8px 24px`，不占满行宽 |

- 三档共用样式：左 2px 赭石边，padding-left 12px，**楷体（font-note）13px/21** ink-2（旁注是短注，楷体边界内）；「→ 转为任务」12px 链接 ink-3，hover 转朱砂——**inline 形态同样具备 hover 与转任务交互，规格与 gutter 完全一致**。
- 「转为任务」点击：尾部追加 StampBadge `已转`（fullLabel「已转为任务」，moss），文本作为草稿填入 composer（不发送）。
- 入场：`opacity 0→1 + translateX(4px)→0` 180ms；仅当用户贴底跟随时播放，否则静默落位。绝不打断滚动、绝无弹窗音效。
- **限流（嫁接自 1 号）**：同一 run 产生 ≥3 条旁注时，第 3 条起聚合为一行 `┆ 旁注 × 3 ▸`（12.5px ink-3，赭石左边线），点击展开为 inline 形态堆叠列表（展开后不再收起回聚合）。聚合计数逻辑放 store selector，配单测。
- 数据：`Message.kind: "btw"` + shared 新事件 `btw`；timeline 不加新 kind，MessageBubble 按 kind 分支渲染（照 compaction_summary 模式）。

---

## 10. 工具调用行（`renderer/components/ToolCallRow.tsx` 改造）

```
  ¹ read_file   src/store/index.ts          2.3KB    [成]
  ² write_file  src/store/plan.ts        +84 −0   [候]  [允许] [拒绝]
  ³ shell       pnpm test                          [行] ▍
  ⁴ shell       pnpm build                         [败]
    │ error TS2345: Argument of type …            ← 失败默认展开 stderr 尾 20 行
    │ …
```

- 形态：**文本不是卡片**。mono 12.5px/19，左侧 2px `var(--line-weak)` 边 + padding-left 12px；上标序号衬线 11px ink-3（每 run 内递增）；工具名 ink-2，参数摘要 ink-3，中间 8px 间隔。
- 状态印章：StampBadge `成/败/候/行`（fullLabel 成功/失败/待批准/运行中），运行中行尾跟静态或活动墨点（§2.3 规则，工具行墨点不参与活动竞争，恒静态）。
- **diff 统计（嫁接自 1 号）**：`write_file`/`edit_file` 行内用 `+84 −0` 替代字节数——`+n` 苔绿 mono、`−n` destructive mono、tnum；统计由现有 diff 纯函数从 patch 计算。`read_file` 保留字节/KB 数。
- 展开：行尾 chevron `opacity-0 hover:opacity-40`，展开后 70%；展开区 radius 8px、`bg: hsl(var(--surface))`、1px `var(--line-weak)`：
  - read/list → 结果文本（mono 12.5px，最多 360px 折叠同代码块规则）；
  - write/edit → **DiffView**（diff 行底色 `var(--moss-soft)` / `var(--danger-soft)`，行号 ink-4 tnum）；
  - shell → 命令本体 + stdout（mono 13px 代码块样式）。
- **失败自呈现（嫁接，修复"失败要等 hover"）**：`tool_result` 为 error 时**默认展开** stderr 末 **20 行**：左 2px destructive 边线缩进、`bg: hsl(var(--surface))` 嵌入块、mono 12.5/19；超 20 行顶部一行 `查看全部 n 行`（11.5px ink-3）点击全展。
- **审批态（修复短板 1）**：pendingTool 不再裸 JSON——write/edit 直接内嵌 DiffView、shell 内嵌命令块；「允许」ink 实底小按钮、「拒绝」hairline 按钮，均 13px；待批行印章 `候`（ochre）。

---

## 11. 侧边栏（`renderer/components/Sidebar.tsx` 改造）

- 264px，`bg-surface`，右缘 1px `var(--line-weak)`。
- 顶部：「程小帮」衬线 16px 600 + 右侧 ⌘K 提示（11.5px mono ink-4）；下方「＋ 新对话」hairline 按钮（radius 6px，高 32px，撑满）。
- 会话列表按日分组：日期刊头衬线 12px ink-3（「六月十一日」），组间 16px。
- 行：高 32px，13px ink-2，padding-left 12px；项目会话标题前缀 11px 项目名 ink-4。
- **选中态**：不用填充底色——左缘 2px 朱砂 rule（`scaleY 0→1` 从中点向上下展开，180ms `--ease-out`，transform-origin center）+ 文字转 ink。hover（非选中）：`bg: var(--paper-inset)`。
- 行 hover 尾部现 `…` 菜单（DropdownMenu）：重命名 / fork / 删除；**删除确认换 shadcn Dialog**（radius 14px，shadow-dialog，「删除」按钮 destructive 实底），废弃 `window.confirm`（解短板 4）。
- 底部：⚙ 设置 + ◐ 主题切换（触发 §1.2 theme-switching 过渡），13px ink-2。

---

## 12. 设置页（`renderer/components/SettingsView.tsx` + `settings/` 改造）——版权页

- 版心 640px 居中，**无嵌套卡片**，全页用 booktabs 表格语言：节标衬线 16px 600 + 1.5px `var(--line-strong)` 顶 rule，行间 1px `var(--line-weak)`，行高 52px。页标题「设 置」衬线 22px。
- **模型节**：每 provider 一行：名称 13.5px ink、默认模型 mono 13px ink-2、状态（`已配置` + moss 点 / `未配置` ink-4）；行 hover 现「编辑」hairline 小按钮；末行 `＋ 添加 provider`。编辑用 Dialog（radius 14px，shadow-dialog）：label 12px ink-3，input 底边式（仅 1px 底线 `var(--line)`，聚焦转 `var(--line-strong)`，无框无 ring）。
- **技能节（skill 橱窗）**：每 skill 一行：名称 mono 13px、描述 13px ink-2、来源 StampBadge（`内`/`全`/`项`，fullLabel 内置/全局/项目）、触发方式 mono 11.5px ink-4（`/excel`）；行 hover 现「查看 SKILL.md」；末行 `＋ 打开技能目录`。数据与 composer `/` 菜单、空状态启动项同源（store.slashCommands）。
- `settings/OptionCard.tsx` 等子件随表格语言重皮（去卡片化，改行式）。

---

## 13. 微交互清单（实现验收用）

1. **墨点光标**：2px×1em 行内竖条，ink-pulse 1200ms；同屏唯一活动（流式光标 > 计划当前步 > 思考行），其余静态 60%。
2. **复制回执**：点击后图标 120ms 换 StampBadge `已录`，1.5s 淡回；不弹 toast。
3. **链接 hover**：文字与下划线同转朱砂 120ms；下划线常驻 offset 3px。
4. **hairline 应答**：可点行/卡 hover 仅 边线 line→line-strong + 底 muted/inset，各 120ms；零位移零阴影。
5. **目录引线点亮**：计划步完成 ✓ stroke-dashoffset 240ms 画出，序号同帧转朱砂。
6. **侧栏红丝带**：选中会话左缘朱砂 rule scaleY 0→1 自中点展开 180ms。
7. **选项键盘感**：ask-user 直接按 A/B/C 命中；行底朱砂 soft 闪 240ms 后塌缩回执。
8. **chevron 暗示**：可展开行 chevron 默认 opacity 0，hover 40%，展开后 70%。
9. **代码块踢脚**：渐隐区整条可点，hover 浮出「展开 ⌄ n 行」；grid-rows 260ms 展开。
10. **发送按钮**：有内容时描边→ink 实底 180ms；按压 scale(0.97)；运行中旋 90° 换停止方块 180ms。
11. **计划落墨**：开启计划模式，composer 顶 2px 黛蓝线 scaleX 从左画入 260ms + 水印行淡入。
12. **旁注入场**：translateX(4px) 淡入 180ms，仅贴底跟随时播放。
13. **节间符**：run 结束 `· · ·` 三点错峰 60ms 依次淡入。
14. **主题切换**：仅 background-color/color/border-color 360ms 过渡，transform/layout 不参与。
15. **流式保险丝**：单帧 delta >2KB 的新块跳过入场动画。
16. **仪表行**：RunMetaLine hover 延迟 80ms 浮现动作组。
17. **reduced-motion / reduced-transparency**：统一豁免块（§1.2），一处生效全局。

---

## 14. 新组件清单

| 组件 | 文件路径（`apps/desktop/src/renderer/` 下） | props 草案 | 备注 |
|---|---|---|---|
| StampBadge | `components/StampBadge.tsx` | `{ text; fullLabel; tone }` | §2.1；全局元件，先建 |
| RunMetaLine | `components/RunMetaLine.tsx` | `{ durationMs; totalTokens; model; onCopy; onRegenerate; onFork }` | §3.2 |
| PlanCard | `components/PlanCard.tsx` | `{ title; steps; status; onConfirm; onReject; onUpdateSteps }` | §7.1 |
| PlanBookmark | `components/PlanBookmark.tsx` | `{ current: {index; total; title}; onJump }` | §7.2 |
| AskUserCard | `components/AskUserCard.tsx` | `{ question; options; resolved?; onAnswer }` | §8 |
| AsideNote | `components/AsideNote.tsx` | `{ text; layout; converted; onConvertToTask }` | §9 |
| useStickToBottom | `hooks/useStickToBottom.ts` | `(ref, {streaming}) → { isPinned; scrollToBottom }` | §4.5 |
| useComposerMenus | `hooks/useComposerMenus.ts` | 见 §6 签名 | 纯逻辑可单测 |
| ink-owner | `lib/ink-owner.ts` | `resolveInkOwner(state)` 纯函数 | §2.3；单测 |

shared 契约（`packages/shared/src/index.ts` StreamEvent union 处追加）：`plan_proposed` / `plan_updated`、`ask_user`（或复用 `tool_call_pending` + `name:"ask_user"` 路线，二选一，推荐后者改动最小）、`btw`（Message.kind 扩 `"btw"`）。Zod schema 与两端类型同步。

## 15. 现有组件改造清单

| 文件 | 改什么 |
|---|---|
| `styles/global.css` | token 层整段替换（§1.2）；删 stream-caret/shimmer；新增 `.ink-caret`/`.ink-caret-static`/theme-switching/豁免块/selection/滚动条；hljs 主题重写为矿物色（§5 代码块） |
| `tailwind.config.ts` | §1.3 增量：colors/fontFamily/boxShadow/keyframes/animation |
| `hooks/use-theme.ts` | 切换时挂/摘 `theme-switching` 类（400ms） |
| `components/Markdown.tsx` | 覆写组件按 §5 全表重写（核心工作量，纯样式）；新增 `appendCaret` 支持 |
| `components/markdown/CodeBlock.tsx` | 页眉栏/折叠踢脚/流式纯文本模式/复制回执（§5 细则） |
| `components/StreamingMarkdown.tsx` | 块 key 改偏移哈希（§4.2 含前提与断言）；caret 注入尾块行内；2KB 保险丝（§4.3） |
| `components/ChatView.tsx` | 660 版心、40px 节奏、署名行、节间符、RunMetaLine、PlanCard/PlanBookmark 挂载（IntersectionObserver）、AskUserCard 分支（pendingTool.name==="ask_user"）、AsideNote 三档布局（ResizeObserver）、timeline useMemo |
| `components/Composer.tsx` | 外壳重皮（§6）；计划 chip + 落墨动效；模型下拉重构（分组/上下文窗/key 状态点）；菜单逻辑迁出至 useComposerMenus |
| `components/ToolCallRow.tsx` | 脚注形态 + StampBadge + diff 统计 + 失败自动展开 stderr + 审批态接 DiffView/命令块（§10） |
| `components/Sidebar.tsx` | 日期分组刊头、朱砂 rule 选中态、`window.confirm` → Dialog（§11） |
| `components/SettingsView.tsx` + `components/settings/*` | 版权页表格语言 + 技能橱窗（§12） |
| `components/ReasoningPanel.tsx` | 折叠一行态 + 展开 sans 13px（楷体边界修正，§4.6） |
| `components/HomeStarters.tsx` | 目录式列表（§3.1 空状态） |
| `components/MessageActions.tsx` | 动作迁入 RunMetaLine hover 组（保留为内部实现或并入） |
| `components/ScrollToBottomButton.tsx` | 接 useStickToBottom；hairline 重皮 |
| `components/DiffView.tsx` | 仅配色：+ 行 `var(--moss-soft)`、− 行 `var(--danger-soft)`、行号 ink-4 tnum |
| `lib/timeline.ts` | 排序补 createdAt+seq 次级键 |
| `store/index.ts` | 新增 `runMeta` 映射（run_completed 落键，按消息 id 消费，弃 lastUsage UI 消费）；plan/askUser/btw 事件消费；inkOwner selector；ask-user 等待时 composer 发送路由为 custom 答案 |
| `lib/streaming-markdown.ts` | 导出 `STREAM_ANIM_FUSE_BYTES`、repairStart 计算 |

`components/ui/` 14 个原件、`CommandPalette`、`AppErrorBoundary`、`lib/api.ts`：**零逻辑改动**，仅靠 token 覆写重渲染。

## 16. 实现顺序与测试要求

1. token 层（§1）→ 全局立即换肤，验证 ui/ 原件无破相；
2. StampBadge + ink-caret + hairline 词汇（§2）；
3. Markdown/CodeBlock 重写（§5，工作量最大）+ StreamingMarkdown key/caret/保险丝（§4，配三场景单测）；
4. ChatView 版面 + RunMetaLine + useStickToBottom（store runMeta 配单测：切会话不串台）；
5. Composer + useComposerMenus（hook 单测）；
6. ToolCallRow + Sidebar + Settings；
7. PlanCard/PlanBookmark/AskUserCard/AsideNote（依赖 shared 事件落地，mock ApiClient + scriptedModel 模式照 `test/app.test.tsx` 写测试；AsideNote 限流 selector、ink-owner、timeline 次级排序均为纯函数直测）。

每步保持 `pnpm test` 绿；关键路径（事件消费、审批提交、ask-user 答案路由、主题切换）按工程规范补足日志（含 runId/toolCallId/答案类型等上下文）。

---

*「铅与纸」v1.0 —— 文首署名，文末版记；把聊天窗口排成一本值得重读的杂志。*
