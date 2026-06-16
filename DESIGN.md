---
version: beta
name: Vercel-developer-platform-theme
description: A stark developer-platform interface built from near-white canvases, ink-near-black text, deliberate gray steps, subtle stacked elevation, system sans typography, and a hero-scale blue / teal / violet / pink / amber mesh gradient reserved for atmospheric moments.

colors:
  primary: "#171717"
  ink: "#171717"
  body: "#4d4d4d"
  mute: "#888888"
  canvas: "#ffffff"
  canvas-soft: "#fafafa"
  canvas-soft-2: "#f5f5f5"
  plan-surface: "#ededed"
  surface-hover: "#ececec"
  hairline: "#ebebeb"
  hairline-strong: "#a1a1a1"
  cyan: "#50e3c2"
  highlight-pink: "#ff0080"
  violet: "#7928ca"
  link: "#0070f3"
  link-deep: "#0761d1"
  link-bg-soft: "#d3e5ff"
  soft-blue: "#4076be"
  soft-blue-strong: "#265898"
  soft-blue-foreground: "#2d5387"
  soft-blue-border: "#c4d7f2"
  soft-blue-surface: "#f5f9ff"
  soft-blue-surface-hover: "#edf5ff"
  error: "#ee0000"
  error-soft: "#f7d4d6"
  error-deep: "#c50000"
  warning: "#f5a623"
  warning-soft: "#ffefcf"
  warning-deep: "#ab570a"
  gradient-develop-start: "#007cf0"
  gradient-develop-end: "#00dfd8"
  gradient-preview-start: "#7928ca"
  gradient-preview-end: "#ff0080"
  gradient-ship-start: "#ff4d4d"
  gradient-ship-end: "#f9cb28"
  on-primary: "#ffffff"

typography:
  display-xl:
    fontFamily: system sans
    fontSize: 48px
    fontWeight: 600
    lineHeight: 48px
    letterSpacing: -2.4px
  display-lg:
    fontFamily: system sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -1.28px
  display-md:
    fontFamily: system sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.96px
  display-sm:
    fontFamily: system sans
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.6px
  body-lg:
    fontFamily: system sans
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0
  body-md:
    fontFamily: system sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0
  body-sm:
    fontFamily: system sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: -0.28px
  body-xs:
    fontFamily: system sans
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: -0.26px
  caption:
    fontFamily: system sans
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0
  caption-mono:
    fontFamily: Geist Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0
  code:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0
  button-md:
    fontFamily: system sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0
  button-lg:
    fontFamily: system sans
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: 0

rounded:
  none: 0px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  pill-sm: 64px
  pill: 100px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 40px
  3xl: 48px
  4xl: 64px
  5xl: 96px
  6xl: 128px
  section: 192px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.button-lg}"
    rounded: "{rounded.pill}"
  nav-button:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
  form-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
  card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.md}"
  code-editor-mockup:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.code}"
    rounded: "{rounded.md}"
  banner:
    backgroundColor: "{colors.canvas-soft}"
    textColor: "{colors.body}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.full}"
---

## Overview

程小帮当前主题以 Vercel 的 developer-platform 品牌系统为视觉事实源。这个系统不靠单一彩色主题取胜，而靠高精度黑白灰、清晰开发者语气、极少量语义蓝，以及只在大面积背景中出现的 mesh gradient 建立品牌识别。

界面主体应该像部署控制台的工作台：`canvas-soft` 是页面底色，`canvas` 是卡片/弹层/输入面，`primary` 是近黑主操作与代码预览面板。灰阶负责层级，蓝色负责链接、成功或信息语义。青色、紫色、粉色、橙红、琥珀只属于品牌渐变，不应该被拆成小色块到处使用。

**关键特征：**

- 近白页面背景与纯白卡片，边界靠 `#ebebeb` hairline 和极弱 stacked shadow。
- 近黑 `#171717` 是文字和主 CTA，而不是绿色、黄色或大面积彩色。
- Vercel mesh gradient 是唯一装饰性视觉资产，只用于 hero 级或大背景级氛围。
- 字体使用系统 sans 字体栈；macOS 上实际主要落到 San Francisco / SF Pro，技术层使用 JetBrains Mono / SF Mono。
- 标题使用 sentence-case、600 字重、明显负字距；不要 all-caps 标题，只有 mono 小标签可以 uppercase。
- 卡片半径克制：6px 用于应用控件，8px 用于常规卡片，12px 到 16px 用于更大展示容器，100px 用于 CTA 胶囊。

## Colors

### Core

- **Primary / Ink** `#171717`：主按钮、主要文字、深色代码预览面板、极性翻转区域。
- **Canvas** `#ffffff`：卡片、弹窗、输入框、菜单。
- **Canvas Soft** `#fafafa`：页面背景。
- **Canvas Soft 2** `#f5f5f5`：嵌入式区域、代码块内层背景，以及轻量控件的 hover。
- **Plan Surface** `#ededed`：计划/套餐等成块卡片的背景，纯中性浅灰（R=G=B，无冷暖色调），比 Canvas Soft 2 深一档、配深色文字（暗色为 `#2c2c2c`）。
- **Surface Hover** `#ececec`：侧边栏等列表项的 hover / 选中态背景，比 Canvas Soft 2 深一档，呈 macOS 风格的轻盈苹果灰。
- **Hairline** `#ebebeb`：默认边框、分隔线、表格线。
- **Hairline Strong** `#a1a1a1`：更强的分隔线、低优先级文字。

### Text

- **Ink** `#171717`：标题、正文高优先级文字。
- **Body** `#4d4d4d`：副标题、次级正文、导航非激活状态。
- **Mute** `#888888`：占位符、脚注、低优先级说明。
- **On Primary** `#ffffff`：近黑主按钮或深色面板上的文字。

### Semantic

- **Link / Success** `#0070f3`：链接、成功/连接状态、信息态。Vercel 的 legacy success 语义与 link blue 合并。
- **Link Deep** `#0761d1`：链接按下或更深状态。
- **Link Bg Soft** `#d3e5ff`：信息提示和轻量高亮底色。
- **Soft Blue** `#4076be`：低强度品牌蓝，用于标签、筛选项、轻量操作按钮和卡片 hover 的统一点缀，不用于主 CTA。
- **Soft Blue Strong** `#265898`：Soft Blue 的 hover / pressed 文字和边框强调。
- **Soft Blue Foreground** `#2d5387`：Soft Blue 淡底上的文字与小图标。
- **Soft Blue Border** `#c4d7f2`：Soft Blue 淡底控件的边框。
- **Soft Blue Surface** `#f5f9ff`：Soft Blue 胶囊、标签、轻量高亮底色。
- **Soft Blue Surface Hover** `#edf5ff`：Soft Blue 控件 hover 底色。
- **Error** `#ee0000`：错误与危险动作。
- **Error Soft** `#f7d4d6`：错误淡底。
- **Warning** `#f5a623`：警示、待处理状态。
- **Warning Soft** `#ffefcf`：警示淡底。

### Brand Gradient

品牌渐变由三组 stop 组成：

- **Develop** `#007cf0` → `#00dfd8`
- **Preview** `#7928ca` → `#ff0080`
- **Ship** `#ff4d4d` → `#f9cb28`

把它当成一个整体对象使用。不要把其中某个 stop 单独抽出来做大面积 UI 色，不要把渐变缩成小图标或小徽章。它只适合 hero 级氛围、大背景、展示带。

## Typography

### Font Family

- **Display / Body / Button**：使用系统 sans 字体栈：`ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"`。
- **Technical labels / Code**：目标是 Geist Mono；本项目使用 JetBrains Mono、SF Mono、Menlo 作为替代。

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---:|---:|---:|---:|---|
| `display-xl` | 48px | 600 | 48px | -2.4px | 首页主标题、关键空状态标题 |
| `display-lg` | 32px | 600 | 40px | -1.28px | 页面/区域标题 |
| `display-md` | 24px | 600 | 32px | -0.96px | 卡片组标题、重要面板标题 |
| `display-sm` | 20px | 600 | 28px | -0.6px | 小型标题 |
| `body-lg` | 18px | 400 | 28px | 0 | 引导说明 |
| `body-md` | 16px | 400 | 24px | 0 | 默认正文 |
| `body-sm` | 14px | 400 | 20px | -0.28px | 导航、按钮、小正文 |
| `body-xs` | 13px | 400 | 18px | -0.26px | 侧边栏导航、区块标签 |
| `caption` | 12px | 400 | 16px | 0 | 说明、脚注、徽章 |
| `caption-mono` | 12px | 400 | 16px | 0 | 技术标签、路径、状态小标签 |
| `code` | 13px | 400 | 20px | 0 | 代码、终端、命令 |
| `button-md` | 14px | 500 | 20px | 0 | 应用级按钮 |
| `button-lg` | 16px | 500 | 24px | 0 | 营销级主 CTA |

### Rules

- 标题最多 600 字重，不使用 700 或更粗。
- 标题使用强负字距，正文不额外加字距。
- 技术标签和代码使用 mono，正文不要使用 mono。
- 除 mono 小标签外，不要把标题或正文设成全大写。

## Layout

- 基础单位是 4px，所有间距尽量落在 4px 倍数。
- 应用工作区以密度和清晰扫描为优先，不做营销落地页式大 hero。
- 页面背景 `canvas-soft`，卡片/弹层 `canvas`，hover/选中 `canvas-soft-2`。
- 卡片内部紧凑，区块之间留白更大。Vercel 的秩序感来自大间距与极细边界。
- 桌面容器最大宽度可保持 1400px；聊天正文维持可读版心，不要横向铺满。

## Elevation

Vercel 的阴影是 stacked shadow：

- **hairline**：仅 inset 1px 边界。
- **subtle**：1px / 2px 小阴影 + inset hairline。
- **stack**：2px + 8px 弱阴影 + inset hairline。
- **float**：适合较突出的卡片。
- **modal / overlay**：弹层、菜单、通知。

不要使用单个大 blur 投影，不要彩色辉光，不要玻璃拟态。

## Components

### Buttons

- **button-primary**：黑色 100px 胶囊，白字，承载最重要动作。
- **button-secondary**：白色 100px 胶囊，黑字，hairline 边框，与 primary 配对。
- **nav/app button**：6px 半径，28-40px 高度，适合工具型界面。
- **link button**：使用 link blue，hover 下划线。

### Cards

- 默认卡片：白底、hairline、8px 半径。
- 大卡片：白底、12px 半径、stacked shadow。
- 代码/终端卡片：`primary` 近黑底，mono 文字，8px 半径。

### Inputs

- 白底、hairline、6px 半径。
- focus 使用 link blue ring / border。
- placeholder 使用 mute。

### Badges

- 默认徽章使用黑底白字。
- 次级徽章使用 `canvas-soft-2` 灰底和 body 文本。
- 高亮粉、紫、青、琥珀仅用于状态或渐变，不用于铺开背景主题。

## Do

- 用 `primary` 作为主操作和主要深色面。
- 用灰阶区分层级，不用暖黄色或绿色填充界面。
- 链接、成功、信息态统一用 `link` 蓝。
- 把 mesh gradient 留给大面积视觉氛围。
- 使用 stacked shadow 与 hairline 组合建立深度。
- 代码、终端、路径、技术标签使用 mono。

## Don't

- 不要把绿色、黄色、珊瑚色作为全局主题色。
- 不要把渐变拆成小图标、小按钮或小徽章。
- 不要使用重投影、彩色辉光、玻璃拟态。
- 不要用 700/800 字重。
- 不要在普通正文中使用 mono。
- 不要在标题中使用全大写。
