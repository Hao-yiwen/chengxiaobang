# 图标资产说明

本目录只保留图标说明和内联图标模块，不再保留独立的 SVG 资产文件。图标按语义分类放在多个 `.tsx` 文件中，`index.tsx` 只负责统一导出，业务代码应直接从模块导入组件使用。

常用入口：

```tsx
import { PdfIcon, TypescriptIcon } from "@/assets/file-type-icons";

<TypescriptIcon className="size-4" />
<PdfIcon className="size-4" />
```

业务代码优先直接导入所需图标组件。语言和文件路径这种需要动态选择图标的场景继续走 `@/lib/code-language-icons`：它直接返回可渲染的 Icon 组件，内部也显式导入本目录的组件。

本目录没有合适图标时,回退到项目通用的 Phosphor Icons(`@phosphor-icons/react`),不要新增独立 `.svg` 文件。

## 文件结构

- `file-type.tsx`：文件类型基础图标。
- `file-preview.tsx`：文件预览 / 文档类型图标。
- `file-tree.tsx`：文件树基础符号。
- `brand.tsx`：品牌 / 产品图标。
- `plugin.tsx`：插件入口图标。
- `ui-action.tsx`：通用 UI 动作图标。
- `illustration.tsx`：插画 / 状态素材图标。
- `types.ts`：图标组件共用 props 类型。
- `index.tsx`：统一导出入口，不放具体图标实现。

## 命名规则

- 图标 token 统一使用稳定的语义化 `kebab-case`，不保留上游打包 hash、`.js-数字`、随机短码或 `assets-*` 前缀。
- 组件名由 token 转为 PascalCase，并统一以 `Icon` 结尾，例如 `typescript` 对应 `TypescriptIcon`。
- 原有文件类型 token 保持不动，例如 `typescript`、`react`、`markdown`，避免影响现有解析逻辑。
- 同一图形的视觉变体使用可读状态词区分，例如 `light`、`dark`、`blue`、`filled`、`outline`。
- 当前模块共导出 `352` 个 SVG 组件；没有保留上游专用命名图标。

## 分类

- **文件类型基础图标**：53 个。项目原有的稳定文件类型 token，`code-language-icons.ts` 会直接按这些名字解析语言、扩展名和常见配置文件。
- **文件预览 / 文档类型图标**：42 个。从上游文件预览图标和素材集中补充的文档、附件、Office、PDF、终端等类型。
- **文件树基础符号**：5 个。文件树展开、文件、锁、省略号等基础 UI 符号。
- **品牌 / 产品图标**：14 个。外部产品、工具或品牌相关图标。
- **插件入口图标**：28 个。插件、连接器或能力入口中使用的一组语义化图标。
- **通用 UI 动作图标**：48 个。按钮、状态、导航、编辑、选择、反馈等通用 UI 符号。
- **插画 / 状态素材图标**：162 个。从上游素材集中拆出的 light、dark、color 等视觉变体，已按图形语义重新命名。

## 全量清单

| Token | 组件 | 分类 | 说明 |
| --- | --- | --- | --- |
| `astro` | `AstroIcon` | 文件类型基础图标 | astro文件类型图标。 |
| `babel` | `BabelIcon` | 文件类型基础图标 | babel文件类型图标。 |
| `bash` | `BashIcon` | 文件类型基础图标 | bash文件类型图标。 |
| `biome` | `BiomeIcon` | 文件类型基础图标 | biome文件类型图标。 |
| `bootstrap` | `BootstrapIcon` | 文件类型基础图标 | bootstrap文件类型图标。 |
| `browserslist` | `BrowserslistIcon` | 文件类型基础图标 | browserslist文件类型图标。 |
| `bun` | `BunIcon` | 文件类型基础图标 | bun文件类型图标。 |
| `c` | `CIcon` | 文件类型基础图标 | c文件类型图标。 |
| `claude` | `ClaudeIcon` | 文件类型基础图标 | claude文件类型图标。 |
| `cpp` | `CppIcon` | 文件类型基础图标 | cpp文件类型图标。 |
| `css` | `CssIcon` | 文件类型基础图标 | css文件类型图标。 |
| `database` | `DatabaseIcon` | 文件类型基础图标 | database文件类型图标。 |
| `default` | `DefaultIcon` | 文件类型基础图标 | default文件类型图标。 |
| `docker` | `DockerIcon` | 文件类型基础图标 | docker文件类型图标。 |
| `eslint` | `EslintIcon` | 文件类型基础图标 | eslint文件类型图标。 |
| `font` | `FontIcon` | 文件类型基础图标 | font文件类型图标。 |
| `git` | `GitIcon` | 文件类型基础图标 | Git文件类型图标。 |
| `go` | `GoIcon` | 文件类型基础图标 | go文件类型图标。 |
| `graphql` | `GraphqlIcon` | 文件类型基础图标 | graphql文件类型图标。 |
| `html` | `HtmlIcon` | 文件类型基础图标 | html文件类型图标。 |
| `image` | `ImageIcon` | 文件类型基础图标 | 图片文件类型图标。 |
| `javascript` | `JavascriptIcon` | 文件类型基础图标 | javascript文件类型图标。 |
| `json` | `JsonIcon` | 文件类型基础图标 | json文件类型图标。 |
| `markdown` | `MarkdownIcon` | 文件类型基础图标 | markdown文件类型图标。 |
| `mcp` | `McpIcon` | 文件类型基础图标 | MCP文件类型图标。 |
| `nextjs` | `NextjsIcon` | 文件类型基础图标 | nextjs文件类型图标。 |
| `npm` | `NpmIcon` | 文件类型基础图标 | npm文件类型图标。 |
| `oxc` | `OxcIcon` | 文件类型基础图标 | oxc文件类型图标。 |
| `postcss` | `PostcssIcon` | 文件类型基础图标 | postcss文件类型图标。 |
| `prettier` | `PrettierIcon` | 文件类型基础图标 | prettier文件类型图标。 |
| `python` | `PythonIcon` | 文件类型基础图标 | python文件类型图标。 |
| `react` | `ReactIcon` | 文件类型基础图标 | react文件类型图标。 |
| `ruby` | `RubyIcon` | 文件类型基础图标 | ruby文件类型图标。 |
| `rust` | `RustIcon` | 文件类型基础图标 | rust文件类型图标。 |
| `sass` | `SassIcon` | 文件类型基础图标 | sass文件类型图标。 |
| `stylelint` | `StylelintIcon` | 文件类型基础图标 | stylelint文件类型图标。 |
| `svelte` | `SvelteIcon` | 文件类型基础图标 | svelte文件类型图标。 |
| `svg` | `SvgIcon` | 文件类型基础图标 | svg文件类型图标。 |
| `svgo` | `SvgoIcon` | 文件类型基础图标 | svgo文件类型图标。 |
| `swift` | `SwiftIcon` | 文件类型基础图标 | swift文件类型图标。 |
| `table` | `TableIcon` | 文件类型基础图标 | table文件类型图标。 |
| `tailwind` | `TailwindIcon` | 文件类型基础图标 | tailwind文件类型图标。 |
| `terraform` | `TerraformIcon` | 文件类型基础图标 | terraform文件类型图标。 |
| `text` | `TextIcon` | 文件类型基础图标 | 文本文件类型图标。 |
| `typescript` | `TypescriptIcon` | 文件类型基础图标 | typescript文件类型图标。 |
| `vite` | `ViteIcon` | 文件类型基础图标 | vite文件类型图标。 |
| `vscode` | `VscodeIcon` | 文件类型基础图标 | vscode文件类型图标。 |
| `vue` | `VueIcon` | 文件类型基础图标 | vue文件类型图标。 |
| `wasm` | `WasmIcon` | 文件类型基础图标 | wasm文件类型图标。 |
| `webpack` | `WebpackIcon` | 文件类型基础图标 | webpack文件类型图标。 |
| `yml` | `YmlIcon` | 文件类型基础图标 | yml文件类型图标。 |
| `zig` | `ZigIcon` | 文件类型基础图标 | zig文件类型图标。 |
| `zip` | `ZipIcon` | 文件类型基础图标 | zip文件类型图标。 |
| `artifact-document` | `ArtifactDocumentIcon` | 文件预览 / 文档类型图标 | 制品或附件文档图标。 |
| `blank-document-light` | `BlankDocumentLightIcon` | 文件预览 / 文档类型图标 | blank文档浅色预览图标。 |
| `blank-document` | `BlankDocumentIcon` | 文件预览 / 文档类型图标 | blank文档预览图标。 |
| `build` | `BuildIcon` | 文件预览 / 文档类型图标 | build预览图标。 |
| `code` | `CodeIcon` | 文件预览 / 文档类型图标 | 代码预览图标。 |
| `cpp-file` | `CppFileIcon` | 文件预览 / 文档类型图标 | C++ 文件预览图标。 |
| `csv-file` | `CsvFileIcon` | 文件预览 / 文档类型图标 | csv文件预览图标。 |
| `document-cursor-light` | `DocumentCursorLightIcon` | 文件预览 / 文档类型图标 | 文档光标浅色预览图标。 |
| `document-cursor-yellow` | `DocumentCursorYellowIcon` | 文件预览 / 文档类型图标 | 文档光标黄色预览图标。 |
| `document` | `DocumentIcon` | 文件预览 / 文档类型图标 | 文档预览图标。 |
| `excel-app-green` | `ExcelAppGreenIcon` | 文件预览 / 文档类型图标 | Excel应用绿色预览图标。 |
| `excel-app-light` | `ExcelAppLightIcon` | 文件预览 / 文档类型图标 | Excel应用浅色预览图标。 |
| `excel-document` | `ExcelDocumentIcon` | 文件预览 / 文档类型图标 | Excel文档预览图标。 |
| `file` | `FileIcon` | 文件预览 / 文档类型图标 | 文件预览图标。 |
| `folder` | `FolderIcon` | 文件预览 / 文档类型图标 | 文件夹预览图标。 |
| `hash-file` | `HashFileIcon` | 文件预览 / 文档类型图标 | 哈希、校验或摘要类文件图标。 |
| `image-file-color` | `ImageFileColorIcon` | 文件预览 / 文档类型图标 | 图片文件彩色预览图标。 |
| `image-file-light` | `ImageFileLightIcon` | 文件预览 / 文档类型图标 | 图片文件浅色预览图标。 |
| `java` | `JavaIcon` | 文件预览 / 文档类型图标 | Java预览图标。 |
| `jpg-file-blue` | `JpgFileBlueIcon` | 文件预览 / 文档类型图标 | JPG文件蓝色预览图标。 |
| `jpg-file-light` | `JpgFileLightIcon` | 文件预览 / 文档类型图标 | JPG文件浅色预览图标。 |
| `locked-document-light` | `LockedDocumentLightIcon` | 文件预览 / 文档类型图标 | 加锁文档浅色预览图标。 |
| `locked-document-teal` | `LockedDocumentTealIcon` | 文件预览 / 文档类型图标 | 加锁文档青绿色预览图标。 |
| `notebook` | `NotebookIcon` | 文件预览 / 文档类型图标 | notebook预览图标。 |
| `pdf-file-light` | `PdfFileLightIcon` | 文件预览 / 文档类型图标 | PDF文件浅色预览图标。 |
| `pdf-file-red` | `PdfFileRedIcon` | 文件预览 / 文档类型图标 | PDF文件红色预览图标。 |
| `pdf` | `PdfIcon` | 文件预览 / 文档类型图标 | PDF预览图标。 |
| `php` | `PhpIcon` | 文件预览 / 文档类型图标 | php预览图标。 |
| `png-file-green` | `PngFileGreenIcon` | 文件预览 / 文档类型图标 | PNG文件绿色预览图标。 |
| `png-file-light` | `PngFileLightIcon` | 文件预览 / 文档类型图标 | PNG文件浅色预览图标。 |
| `powerpoint-file-light` | `PowerpointFileLightIcon` | 文件预览 / 文档类型图标 | PowerPoint文件浅色预览图标。 |
| `powerpoint-file-red` | `PowerpointFileRedIcon` | 文件预览 / 文档类型图标 | PowerPoint文件红色预览图标。 |
| `presentation` | `PresentationIcon` | 文件预览 / 文档类型图标 | presentation预览图标。 |
| `shell` | `ShellIcon` | 文件预览 / 文档类型图标 | shell预览图标。 |
| `skill` | `SkillIcon` | 文件预览 / 文档类型图标 | skill预览图标。 |
| `spreadsheet` | `SpreadsheetIcon` | 文件预览 / 文档类型图标 | spreadsheet预览图标。 |
| `terminal` | `TerminalIcon` | 文件预览 / 文档类型图标 | 终端预览图标。 |
| `text-document-gray` | `TextDocumentGrayIcon` | 文件预览 / 文档类型图标 | 文本文档灰色预览图标。 |
| `text-document-light` | `TextDocumentLightIcon` | 文件预览 / 文档类型图标 | 文本文档浅色预览图标。 |
| `toml` | `TomlIcon` | 文件预览 / 文档类型图标 | toml预览图标。 |
| `word-document-file` | `WordDocumentFileIcon` | 文件预览 / 文档类型图标 | Word文档文件预览图标。 |
| `word-document-square` | `WordDocumentSquareIcon` | 文件预览 / 文档类型图标 | Word文档square预览图标。 |
| `file-tree-chevron` | `FileTreeChevronIcon` | 文件树基础符号 | 文件treechevron文件树符号。 |
| `file-tree-dot` | `FileTreeDotIcon` | 文件树基础符号 | 文件tree圆点文件树符号。 |
| `file-tree-ellipsis` | `FileTreeEllipsisIcon` | 文件树基础符号 | 文件tree省略号文件树符号。 |
| `file-tree-file` | `FileTreeFileIcon` | 文件树基础符号 | 文件tree文件文件树符号。 |
| `file-tree-lock` | `FileTreeLockIcon` | 文件树基础符号 | 文件tree锁文件树符号。 |
| `chrome-logo` | `ChromeLogoIcon` | 品牌 / 产品图标 | Chrome标志品牌或产品图标。 |
| `figma-logo-color` | `FigmaLogoColorIcon` | 品牌 / 产品图标 | Figma标志彩色品牌或产品图标。 |
| `figma-logo-light` | `FigmaLogoLightIcon` | 品牌 / 产品图标 | Figma标志浅色品牌或产品图标。 |
| `github-logo` | `GithubLogoIcon` | 品牌 / 产品图标 | GitHub标志品牌或产品图标。 |
| `gmail-logo` | `GmailLogoIcon` | 品牌 / 产品图标 | gmail标志品牌或产品图标。 |
| `google-calendar-logo` | `GoogleCalendarLogoIcon` | 品牌 / 产品图标 | Googlecalendar标志品牌或产品图标。 |
| `google-drive-logo-color` | `GoogleDriveLogoColorIcon` | 品牌 / 产品图标 | Googledrive标志彩色品牌或产品图标。 |
| `google-drive-logo` | `GoogleDriveLogoIcon` | 品牌 / 产品图标 | Googledrive标志品牌或产品图标。 |
| `notion-logo` | `NotionLogoIcon` | 品牌 / 产品图标 | notion标志品牌或产品图标。 |
| `notion-page` | `NotionPageIcon` | 品牌 / 产品图标 | notionpage品牌或产品图标。 |
| `openai-blossom` | `OpenaiBlossomIcon` | 品牌 / 产品图标 | openai花形品牌或产品图标。 |
| `openai-knot-logo` | `OpenaiKnotLogoIcon` | 品牌 / 产品图标 | openai结形标志品牌或产品图标。 |
| `sentry-logo` | `SentryLogoIcon` | 品牌 / 产品图标 | Sentry标志品牌或产品图标。 |
| `webstorm-app` | `WebstormAppIcon` | 品牌 / 产品图标 | webstorm应用品牌或产品图标。 |
| `plugin-add-window` | `PluginAddWindowIcon` | 插件入口图标 | 插件添加窗口插件入口图标。 |
| `plugin-app-grid` | `PluginAppGridIcon` | 插件入口图标 | 插件应用网格插件入口图标。 |
| `plugin-badge-star` | `PluginBadgeStarIcon` | 插件入口图标 | 插件徽章星标插件入口图标。 |
| `plugin-book-open` | `PluginBookOpenIcon` | 插件入口图标 | 插件书本打开插件入口图标。 |
| `plugin-bookmark-star` | `PluginBookmarkStarIcon` | 插件入口图标 | 插件书签星标插件入口图标。 |
| `plugin-browser-window` | `PluginBrowserWindowIcon` | 插件入口图标 | 插件浏览器窗口插件入口图标。 |
| `plugin-check-circle` | `PluginCheckCircleIcon` | 插件入口图标 | 插件check圆形插件入口图标。 |
| `plugin-compass` | `PluginCompassIcon` | 插件入口图标 | 插件指南针插件入口图标。 |
| `plugin-cube` | `PluginCubeIcon` | 插件入口图标 | 插件立方体插件入口图标。 |
| `plugin-document-cursor` | `PluginDocumentCursorIcon` | 插件入口图标 | 插件文档光标插件入口图标。 |
| `plugin-document-lines` | `PluginDocumentLinesIcon` | 插件入口图标 | 插件文档线条插件入口图标。 |
| `plugin-file` | `PluginFileIcon` | 插件入口图标 | 插件文件插件入口图标。 |
| `plugin-folder` | `PluginFolderIcon` | 插件入口图标 | 插件文件夹插件入口图标。 |
| `plugin-globe` | `PluginGlobeIcon` | 插件入口图标 | 插件地球插件入口图标。 |
| `plugin-layout-grid` | `PluginLayoutGridIcon` | 插件入口图标 | 插件布局网格插件入口图标。 |
| `plugin-layout-panel` | `PluginLayoutPanelIcon` | 插件入口图标 | 插件布局面板插件入口图标。 |
| `plugin-lightbulb` | `PluginLightbulbIcon` | 插件入口图标 | 插件灯泡插件入口图标。 |
| `plugin-paperclip` | `PluginPaperclipIcon` | 插件入口图标 | 插件回形针插件入口图标。 |
| `plugin-pencil` | `PluginPencilIcon` | 插件入口图标 | 插件pencil插件入口图标。 |
| `plugin-power-button` | `PluginPowerButtonIcon` | 插件入口图标 | 插件电源按钮插件入口图标。 |
| `plugin-profile-card` | `PluginProfileCardIcon` | 插件入口图标 | 插件资料卡片插件入口图标。 |
| `plugin-puzzle-piece` | `PluginPuzzlePieceIcon` | 插件入口图标 | 插件拼图piece插件入口图标。 |
| `plugin-search` | `PluginSearchIcon` | 插件入口图标 | 插件搜索插件入口图标。 |
| `plugin-send` | `PluginSendIcon` | 插件入口图标 | 插件发送插件入口图标。 |
| `plugin-shield` | `PluginShieldIcon` | 插件入口图标 | 插件盾牌插件入口图标。 |
| `plugin-sitemap` | `PluginSitemapIcon` | 插件入口图标 | 插件站点结构插件入口图标。 |
| `plugin-text-document` | `PluginTextDocumentIcon` | 插件入口图标 | 插件文本文档插件入口图标。 |
| `plugin-window-stack` | `PluginWindowStackIcon` | 插件入口图标 | 插件窗口stack插件入口图标。 |
| `arrow-left` | `ArrowLeftIcon` | 通用 UI 动作图标 | 箭头left通用 UI 图标。 |
| `arrow-rotate-ccw` | `ArrowRotateCcwIcon` | 通用 UI 动作图标 | 箭头rotateccw通用 UI 图标。 |
| `arrow-top-right` | `ArrowTopRightIcon` | 通用 UI 动作图标 | 箭头topright通用 UI 图标。 |
| `arrow-up-right-large` | `ArrowUpRightLargeIcon` | 通用 UI 动作图标 | 箭头upright大号通用 UI 图标。 |
| `arrow-up` | `ArrowUpIcon` | 通用 UI 动作图标 | 箭头up通用 UI 图标。 |
| `check-circle-filled` | `CheckCircleFilledIcon` | 通用 UI 动作图标 | check圆形实心通用 UI 图标。 |
| `check-circle-green` | `CheckCircleGreenIcon` | 通用 UI 动作图标 | check圆形绿色通用 UI 图标。 |
| `check-circle-light` | `CheckCircleLightIcon` | 通用 UI 动作图标 | check圆形浅色通用 UI 图标。 |
| `check-circle` | `CheckCircleIcon` | 通用 UI 动作图标 | check圆形通用 UI 图标。 |
| `check-large` | `CheckLargeIcon` | 通用 UI 动作图标 | check大号通用 UI 图标。 |
| `check-medium` | `CheckMediumIcon` | 通用 UI 动作图标 | check中号通用 UI 图标。 |
| `checklist-plan` | `ChecklistPlanIcon` | 通用 UI 动作图标 | 清单plan通用 UI 图标。 |
| `chevron-right` | `ChevronRightIcon` | 通用 UI 动作图标 | chevronright通用 UI 图标。 |
| `chevron` | `ChevronIcon` | 通用 UI 动作图标 | chevron通用 UI 图标。 |
| `circle-outline` | `CircleOutlineIcon` | 通用 UI 动作图标 | 圆形描边通用 UI 图标。 |
| `comment-outline` | `CommentOutlineIcon` | 通用 UI 动作图标 | 评论描边通用 UI 图标。 |
| `comment-text` | `CommentTextIcon` | 通用 UI 动作图标 | 评论文本通用 UI 图标。 |
| `copy` | `CopyIcon` | 通用 UI 动作图标 | copy通用 UI 图标。 |
| `cursor` | `CursorIcon` | 通用 UI 动作图标 | 光标通用 UI 图标。 |
| `download` | `DownloadIcon` | 通用 UI 动作图标 | 下载通用 UI 图标。 |
| `drag-handle` | `DragHandleIcon` | 通用 UI 动作图标 | 拖拽控制柄通用 UI 图标。 |
| `edit-pencil` | `EditPencilIcon` | 通用 UI 动作图标 | 编辑pencil通用 UI 图标。 |
| `ellipsis-horizontal` | `EllipsisHorizontalIcon` | 通用 UI 动作图标 | 省略号horizontal通用 UI 图标。 |
| `expand-corners` | `ExpandCornersIcon` | 通用 UI 动作图标 | expand边角通用 UI 图标。 |
| `expand-inward` | `ExpandInwardIcon` | 通用 UI 动作图标 | expand向内通用 UI 图标。 |
| `filter-lines` | `FilterLinesIcon` | 通用 UI 动作图标 | 筛选线条通用 UI 图标。 |
| `info-circle` | `InfoCircleIcon` | 通用 UI 动作图标 | info圆形通用 UI 图标。 |
| `link` | `LinkIcon` | 通用 UI 动作图标 | 链接通用 UI 图标。 |
| `lock` | `LockIcon` | 通用 UI 动作图标 | 锁通用 UI 图标。 |
| `minus` | `MinusIcon` | 通用 UI 动作图标 | minus通用 UI 图标。 |
| `pencil-color` | `PencilColorIcon` | 通用 UI 动作图标 | pencil彩色通用 UI 图标。 |
| `pencil-light` | `PencilLightIcon` | 通用 UI 动作图标 | pencil浅色通用 UI 图标。 |
| `pencil-outline` | `PencilOutlineIcon` | 通用 UI 动作图标 | pencil描边通用 UI 图标。 |
| `play-outline` | `PlayOutlineIcon` | 通用 UI 动作图标 | 播放描边通用 UI 图标。 |
| `play-small` | `PlaySmallIcon` | 通用 UI 动作图标 | 播放small通用 UI 图标。 |
| `plus` | `PlusIcon` | 通用 UI 动作图标 | plus通用 UI 图标。 |
| `pointer-outline` | `PointerOutlineIcon` | 通用 UI 动作图标 | pointer描边通用 UI 图标。 |
| `question-circle` | `QuestionCircleIcon` | 通用 UI 动作图标 | 问题圆形通用 UI 图标。 |
| `refresh` | `RefreshIcon` | 通用 UI 动作图标 | 刷新通用 UI 图标。 |
| `search-blue` | `SearchBlueIcon` | 通用 UI 动作图标 | 搜索蓝色通用 UI 图标。 |
| `search-light` | `SearchLightIcon` | 通用 UI 动作图标 | 搜索浅色通用 UI 图标。 |
| `search` | `SearchIcon` | 通用 UI 动作图标 | 搜索通用 UI 图标。 |
| `share-upload` | `ShareUploadIcon` | 通用 UI 动作图标 | 分享上传通用 UI 图标。 |
| `trash` | `TrashIcon` | 通用 UI 动作图标 | trash通用 UI 图标。 |
| `undo` | `UndoIcon` | 通用 UI 动作图标 | undo通用 UI 图标。 |
| `warning-circle` | `WarningCircleIcon` | 通用 UI 动作图标 | warning圆形通用 UI 图标。 |
| `x-circle` | `XCircleIcon` | 通用 UI 动作图标 | x圆形通用 UI 图标。 |
| `x-mark` | `XMarkIcon` | 通用 UI 动作图标 | xmark通用 UI 图标。 |
| `alert-circle-blue` | `AlertCircleBlueIcon` | 插画 / 状态素材图标 | 警告圆形蓝色素材图标。 |
| `alert-circle-light` | `AlertCircleLightIcon` | 插画 / 状态素材图标 | 警告圆形浅色素材图标。 |
| `alert-circle` | `AlertCircleIcon` | 插画 / 状态素材图标 | 警告圆形素材图标。 |
| `android-dots` | `AndroidDotsIcon` | 插画 / 状态素材图标 | Android圆点素材图标。 |
| `annotation-comment-filled` | `AnnotationCommentFilledIcon` | 插画 / 状态素材图标 | 批注评论实心素材图标。 |
| `app-grid-color` | `AppGridColorIcon` | 插画 / 状态素材图标 | 应用网格彩色素材图标。 |
| `app-grid-light` | `AppGridLightIcon` | 插画 / 状态素材图标 | 应用网格浅色素材图标。 |
| `app-window` | `AppWindowIcon` | 插画 / 状态素材图标 | 应用窗口素材图标。 |
| `apps-refresh` | `AppsRefreshIcon` | 插画 / 状态素材图标 | 应用刷新素材图标。 |
| `appshot-window` | `AppshotWindowIcon` | 插画 / 状态素材图标 | 应用截图窗口素材图标。 |
| `archive-box` | `ArchiveBoxIcon` | 插画 / 状态素材图标 | 归档box素材图标。 |
| `audio-waveform` | `AudioWaveformIcon` | 插画 / 状态素材图标 | 音频波形素材图标。 |
| `badge-star-blue` | `BadgeStarBlueIcon` | 插画 / 状态素材图标 | 徽章星标蓝色素材图标。 |
| `badge-star-light` | `BadgeStarLightIcon` | 插画 / 状态素材图标 | 徽章星标浅色素材图标。 |
| `bar-chart-color` | `BarChartColorIcon` | 插画 / 状态素材图标 | 柱状图表彩色素材图标。 |
| `bar-chart-light` | `BarChartLightIcon` | 插画 / 状态素材图标 | 柱状图表浅色素材图标。 |
| `blank-placeholder` | `BlankPlaceholderIcon` | 插画 / 状态素材图标 | 空白占位素材图标。 |
| `blossom-outline-alt` | `BlossomOutlineAltIcon` | 插画 / 状态素材图标 | 花形描边备选素材图标。 |
| `blossom-outline` | `BlossomOutlineIcon` | 插画 / 状态素材图标 | 花形描边素材图标。 |
| `book-open-light` | `BookOpenLightIcon` | 插画 / 状态素材图标 | 书本打开浅色素材图标。 |
| `book-open-red` | `BookOpenRedIcon` | 插画 / 状态素材图标 | 书本打开红色素材图标。 |
| `bookmark-star-light` | `BookmarkStarLightIcon` | 插画 / 状态素材图标 | 书签星标浅色素材图标。 |
| `bookmark-star-orange` | `BookmarkStarOrangeIcon` | 插画 / 状态素材图标 | 书签星标orange素材图标。 |
| `brain` | `BrainIcon` | 插画 / 状态素材图标 | 思考素材图标。 |
| `briefcase-green` | `BriefcaseGreenIcon` | 插画 / 状态素材图标 | 公文包绿色素材图标。 |
| `briefcase-light` | `BriefcaseLightIcon` | 插画 / 状态素材图标 | 公文包浅色素材图标。 |
| `browser-cursor` | `BrowserCursorIcon` | 插画 / 状态素材图标 | 浏览器光标素材图标。 |
| `browser-window-blue` | `BrowserWindowBlueIcon` | 插画 / 状态素材图标 | 浏览器窗口蓝色素材图标。 |
| `browser-window-light` | `BrowserWindowLightIcon` | 插画 / 状态素材图标 | 浏览器窗口浅色素材图标。 |
| `bug-outline` | `BugOutlineIcon` | 插画 / 状态素材图标 | 调试描边素材图标。 |
| `building` | `BuildingIcon` | 插画 / 状态素材图标 | building素材图标。 |
| `chat-bubble` | `ChatBubbleIcon` | 插画 / 状态素材图标 | 对话气泡素材图标。 |
| `chat-bubbles-light` | `ChatBubblesLightIcon` | 插画 / 状态素材图标 | 对话气泡浅色素材图标。 |
| `chat-bubbles-purple` | `ChatBubblesPurpleIcon` | 插画 / 状态素材图标 | 对话气泡紫色素材图标。 |
| `chat-bubbles` | `ChatBubblesIcon` | 插画 / 状态素材图标 | 对话气泡素材图标。 |
| `clipboard-check-light` | `ClipboardCheckLightIcon` | 插画 / 状态素材图标 | clipboardcheck浅色素材图标。 |
| `clipboard-check-red` | `ClipboardCheckRedIcon` | 插画 / 状态素材图标 | clipboardcheck红色素材图标。 |
| `clock` | `ClockIcon` | 插画 / 状态素材图标 | clock素材图标。 |
| `cloud-upload` | `CloudUploadIcon` | 插画 / 状态素材图标 | 云上传素材图标。 |
| `cloud` | `CloudIcon` | 插画 / 状态素材图标 | 云素材图标。 |
| `code-block-dark` | `CodeBlockDarkIcon` | 插画 / 状态素材图标 | 代码block深色素材图标。 |
| `code-block-light` | `CodeBlockLightIcon` | 插画 / 状态素材图标 | 代码block浅色素材图标。 |
| `compass-light` | `CompassLightIcon` | 插画 / 状态素材图标 | 指南针浅色素材图标。 |
| `compass-red` | `CompassRedIcon` | 插画 / 状态素材图标 | 指南针红色素材图标。 |
| `compose` | `ComposeIcon` | 插画 / 状态素材图标 | compose素材图标。 |
| `connected-apps` | `ConnectedAppsIcon` | 插画 / 状态素材图标 | 连接应用素材图标。 |
| `corner-handles` | `CornerHandlesIcon` | 插画 / 状态素材图标 | 边角控制柄素材图标。 |
| `credit-card-blue` | `CreditCardBlueIcon` | 插画 / 状态素材图标 | 信用卡卡片蓝色素材图标。 |
| `credit-card-light` | `CreditCardLightIcon` | 插画 / 状态素材图标 | 信用卡卡片浅色素材图标。 |
| `cube-color` | `CubeColorIcon` | 插画 / 状态素材图标 | 立方体彩色素材图标。 |
| `cube-outline` | `CubeOutlineIcon` | 插画 / 状态素材图标 | 立方体描边素材图标。 |
| `cube-pastel` | `CubePastelIcon` | 插画 / 状态素材图标 | 立方体pastel素材图标。 |
| `dock-window` | `DockWindowIcon` | 插画 / 状态素材图标 | dock窗口素材图标。 |
| `document-search` | `DocumentSearchIcon` | 插画 / 状态素材图标 | 文档搜索素材图标。 |
| `dot-pattern` | `DotPatternIcon` | 插画 / 状态素材图标 | 圆点pattern素材图标。 |
| `external-link` | `ExternalLinkIcon` | 插画 / 状态素材图标 | 外部链接素材图标。 |
| `file-icon-resolver-symbol` | `FileIconResolverSymbolIcon` | 插画 / 状态素材图标 | 文件图标解析器内部符号。 |
| `flask-light` | `FlaskLightIcon` | 插画 / 状态素材图标 | 实验瓶浅色素材图标。 |
| `flask-red` | `FlaskRedIcon` | 插画 / 状态素材图标 | 实验瓶红色素材图标。 |
| `folder-blue` | `FolderBlueIcon` | 插画 / 状态素材图标 | 文件夹蓝色素材图标。 |
| `folder-open-outline` | `FolderOpenOutlineIcon` | 插画 / 状态素材图标 | 文件夹打开描边素材图标。 |
| `folders` | `FoldersIcon` | 插画 / 状态素材图标 | 文件夹素材图标。 |
| `gamepad-color` | `GamepadColorIcon` | 插画 / 状态素材图标 | 手柄彩色素材图标。 |
| `gamepad-light` | `GamepadLightIcon` | 插画 / 状态素材图标 | 手柄浅色素材图标。 |
| `git-branch` | `GitBranchIcon` | 插画 / 状态素材图标 | Gitbranch素材图标。 |
| `globe-blue` | `GlobeBlueIcon` | 插画 / 状态素材图标 | 地球蓝色素材图标。 |
| `globe-light-blue` | `GlobeLightBlueIcon` | 插画 / 状态素材图标 | 地球浅色蓝色素材图标。 |
| `globe-outline` | `GlobeOutlineIcon` | 插画 / 状态素材图标 | 地球描边素材图标。 |
| `gpu-tearing-squares` | `GpuTearingSquaresIcon` | 插画 / 状态素材图标 | GPU 撕裂调试方块素材。 |
| `graduation-cap` | `GraduationCapIcon` | 插画 / 状态素材图标 | graduationcap素材图标。 |
| `heart-chat-light` | `HeartChatLightIcon` | 插画 / 状态素材图标 | 爱心对话浅色素材图标。 |
| `heart-chat-red` | `HeartChatRedIcon` | 插画 / 状态素材图标 | 爱心对话红色素材图标。 |
| `heart-light` | `HeartLightIcon` | 插画 / 状态素材图标 | 爱心浅色素材图标。 |
| `heart-red` | `HeartRedIcon` | 插画 / 状态素材图标 | 爱心红色素材图标。 |
| `history` | `HistoryIcon` | 插画 / 状态素材图标 | 历史素材图标。 |
| `hooks` | `HooksIcon` | 插画 / 状态素材图标 | 钩子素材图标。 |
| `image-square` | `ImageSquareIcon` | 插画 / 状态素材图标 | 图片square素材图标。 |
| `json-ui` | `JsonUiIcon` | 插画 / 状态素材图标 | json界面素材图标。 |
| `keyboard-lightning` | `KeyboardLightningIcon` | 插画 / 状态素材图标 | 键盘闪电素材图标。 |
| `lab-flask-outline` | `LabFlaskOutlineIcon` | 插画 / 状态素材图标 | 实验实验瓶描边素材图标。 |
| `ladybug-light` | `LadybugLightIcon` | 插画 / 状态素材图标 | ladybug浅色素材图标。 |
| `ladybug-red` | `LadybugRedIcon` | 插画 / 状态素材图标 | ladybug红色素材图标。 |
| `laptop` | `LaptopIcon` | 插画 / 状态素材图标 | laptop素材图标。 |
| `layout-card-gray` | `LayoutCardGrayIcon` | 插画 / 状态素材图标 | 布局卡片灰色素材图标。 |
| `layout-card-light` | `LayoutCardLightIcon` | 插画 / 状态素材图标 | 布局卡片浅色素材图标。 |
| `layout-grid-gray` | `LayoutGridGrayIcon` | 插画 / 状态素材图标 | 布局网格灰色素材图标。 |
| `layout-grid-light` | `LayoutGridLightIcon` | 插画 / 状态素材图标 | 布局网格浅色素材图标。 |
| `lightbulb-light` | `LightbulbLightIcon` | 插画 / 状态素材图标 | 灯泡浅色素材图标。 |
| `lightbulb-yellow` | `LightbulbYellowIcon` | 插画 / 状态素材图标 | 灯泡黄色素材图标。 |
| `lightning-bolt` | `LightningBoltIcon` | 插画 / 状态素材图标 | 闪电bolt素材图标。 |
| `lightning-light` | `LightningLightIcon` | 插画 / 状态素材图标 | 闪电浅色素材图标。 |
| `lightning-yellow` | `LightningYellowIcon` | 插画 / 状态素材图标 | 闪电黄色素材图标。 |
| `loading-blossom` | `LoadingBlossomIcon` | 插画 / 状态素材图标 | loading花形素材图标。 |
| `log-out` | `LogOutIcon` | 插画 / 状态素材图标 | logout素材图标。 |
| `macbook` | `MacbookIcon` | 插画 / 状态素材图标 | MacBook素材图标。 |
| `map-pin-light` | `MapPinLightIcon` | 插画 / 状态素材图标 | 地图定位浅色素材图标。 |
| `map-pin-yellow` | `MapPinYellowIcon` | 插画 / 状态素材图标 | 地图定位黄色素材图标。 |
| `mcp-outline` | `McpOutlineIcon` | 插画 / 状态素材图标 | MCP描边素材图标。 |
| `microphone-blue` | `MicrophoneBlueIcon` | 插画 / 状态素材图标 | 麦克风蓝色素材图标。 |
| `microphone-light` | `MicrophoneLightIcon` | 插画 / 状态素材图标 | 麦克风浅色素材图标。 |
| `notification-dot-light` | `NotificationDotLightIcon` | 插画 / 状态素材图标 | notification圆点浅色素材图标。 |
| `notification-dot-red` | `NotificationDotRedIcon` | 插画 / 状态素材图标 | notification圆点红色素材图标。 |
| `paperclip-gray` | `PaperclipGrayIcon` | 插画 / 状态素材图标 | 回形针灰色素材图标。 |
| `paperclip-light` | `PaperclipLightIcon` | 插画 / 状态素材图标 | 回形针浅色素材图标。 |
| `pdf-red-block` | `PdfRedBlockIcon` | 插画 / 状态素材图标 | PDF红色block素材图标。 |
| `phone-green` | `PhoneGreenIcon` | 插画 / 状态素材图标 | 手机绿色素材图标。 |
| `phone-light` | `PhoneLightIcon` | 插画 / 状态素材图标 | 手机浅色素材图标。 |
| `phone-outline` | `PhoneOutlineIcon` | 插画 / 状态素材图标 | 手机描边素材图标。 |
| `pop-in-mac` | `PopInMacIcon` | 插画 / 状态素材图标 | 弹出inMac素材图标。 |
| `power-button-green` | `PowerButtonGreenIcon` | 插画 / 状态素材图标 | 电源按钮绿色素材图标。 |
| `power-button-light` | `PowerButtonLightIcon` | 插画 / 状态素材图标 | 电源按钮浅色素材图标。 |
| `profile-card-light` | `ProfileCardLightIcon` | 插画 / 状态素材图标 | 资料卡片浅色素材图标。 |
| `profile-card-teal` | `ProfileCardTealIcon` | 插画 / 状态素材图标 | 资料卡片青绿色素材图标。 |
| `profile-wordmark` | `ProfileWordmarkIcon` | 插画 / 状态素材图标 | 个人资料页字标素材。 |
| `pull-request-open` | `PullRequestOpenIcon` | 插画 / 状态素材图标 | pullrequest打开素材图标。 |
| `puzzle-piece-color` | `PuzzlePieceColorIcon` | 插画 / 状态素材图标 | 拼图piece彩色素材图标。 |
| `puzzle-piece-light` | `PuzzlePieceLightIcon` | 插画 / 状态素材图标 | 拼图piece浅色素材图标。 |
| `puzzle-piece-outline` | `PuzzlePieceOutlineIcon` | 插画 / 状态素材图标 | 拼图piece描边素材图标。 |
| `quote-block-dark` | `QuoteBlockDarkIcon` | 插画 / 状态素材图标 | 引用block深色素材图标。 |
| `quote-block-light` | `QuoteBlockLightIcon` | 插画 / 状态素材图标 | 引用block浅色素材图标。 |
| `reasoning-brain-active` | `ReasoningBrainActiveIcon` | 插画 / 状态素材图标 | reasoning思考激活素材图标。 |
| `reasoning-brain-idle` | `ReasoningBrainIdleIcon` | 插画 / 状态素材图标 | reasoning思考空闲素材图标。 |
| `reasoning-brain-neutral` | `ReasoningBrainNeutralIcon` | 插画 / 状态素材图标 | reasoning思考中性素材图标。 |
| `reasoning-brain-running` | `ReasoningBrainRunningIcon` | 插画 / 状态素材图标 | reasoning思考运行中素材图标。 |
| `reasoning-brain-thinking` | `ReasoningBrainThinkingIcon` | 插画 / 状态素材图标 | reasoning思考思考中素材图标。 |
| `reasoning-pause-circle` | `ReasoningPauseCircleIcon` | 插画 / 状态素材图标 | reasoning暂停圆形素材图标。 |
| `reasoning-play-circle` | `ReasoningPlayCircleIcon` | 插画 / 状态素材图标 | reasoning播放圆形素材图标。 |
| `review-comment-bubble` | `ReviewCommentBubbleIcon` | 插画 / 状态素材图标 | 评审评论气泡素材图标。 |
| `robot` | `RobotIcon` | 插画 / 状态素材图标 | robot素材图标。 |
| `selection-card-cursor-dark` | `SelectionCardCursorDarkIcon` | 插画 / 状态素材图标 | 选择卡片光标深色素材图标。 |
| `selection-card-cursor-light` | `SelectionCardCursorLightIcon` | 插画 / 状态素材图标 | 选择卡片光标浅色素材图标。 |
| `send-blue` | `SendBlueIcon` | 插画 / 状态素材图标 | 发送蓝色素材图标。 |
| `send-light` | `SendLightIcon` | 插画 / 状态素材图标 | 发送浅色素材图标。 |
| `shield-alert` | `ShieldAlertIcon` | 插画 / 状态素材图标 | 盾牌警告素材图标。 |
| `shield-blue` | `ShieldBlueIcon` | 插画 / 状态素材图标 | 盾牌蓝色素材图标。 |
| `shield-code` | `ShieldCodeIcon` | 插画 / 状态素材图标 | 盾牌代码素材图标。 |
| `shield-light` | `ShieldLightIcon` | 插画 / 状态素材图标 | 盾牌浅色素材图标。 |
| `shopping-bag-light` | `ShoppingBagLightIcon` | 插画 / 状态素材图标 | 购物包浅色素材图标。 |
| `shopping-bag-purple` | `ShoppingBagPurpleIcon` | 插画 / 状态素材图标 | 购物包紫色素材图标。 |
| `sidebar-comment-dismiss` | `SidebarCommentDismissIcon` | 插画 / 状态素材图标 | 侧栏评论dismiss素材图标。 |
| `sitemap-blue` | `SitemapBlueIcon` | 插画 / 状态素材图标 | 站点结构蓝色素材图标。 |
| `sitemap-light` | `SitemapLightIcon` | 插画 / 状态素材图标 | 站点结构浅色素材图标。 |
| `sites-grid-color` | `SitesGridColorIcon` | 插画 / 状态素材图标 | sites网格彩色素材图标。 |
| `smile-face` | `SmileFaceIcon` | 插画 / 状态素材图标 | 微笑表情素材图标。 |
| `speedometer` | `SpeedometerIcon` | 插画 / 状态素材图标 | speedometer素材图标。 |
| `star-outline` | `StarOutlineIcon` | 插画 / 状态素材图标 | 星标描边素材图标。 |
| `sun` | `SunIcon` | 插画 / 状态素材图标 | sun素材图标。 |
| `support-chat-light` | `SupportChatLightIcon` | 插画 / 状态素材图标 | 支持对话浅色素材图标。 |
| `support-chat-teal` | `SupportChatTealIcon` | 插画 / 状态素材图标 | 支持对话青绿色素材图标。 |
| `sync-refresh-blue` | `SyncRefreshBlueIcon` | 插画 / 状态素材图标 | 同步刷新蓝色素材图标。 |
| `syntax-highlight-gate` | `SyntaxHighlightGateIcon` | 插画 / 状态素材图标 | 语法高亮加载门控占位图标。 |
| `target` | `TargetIcon` | 插画 / 状态素材图标 | target素材图标。 |
| `task-list` | `TaskListIcon` | 插画 / 状态素材图标 | 任务list素材图标。 |
| `team` | `TeamIcon` | 插画 / 状态素材图标 | 团队素材图标。 |
| `terminal-dark` | `TerminalDarkIcon` | 插画 / 状态素材图标 | 终端深色素材图标。 |
| `terminal-light` | `TerminalLightIcon` | 插画 / 状态素材图标 | 终端浅色素材图标。 |
| `triangle-dark` | `TriangleDarkIcon` | 插画 / 状态素材图标 | 三角形深色素材图标。 |
| `triangle-light` | `TriangleLightIcon` | 插画 / 状态素材图标 | 三角形浅色素材图标。 |
| `user-avatar` | `UserAvatarIcon` | 插画 / 状态素材图标 | 用户头像素材图标。 |
| `waveform-blue` | `WaveformBlueIcon` | 插画 / 状态素材图标 | 波形蓝色素材图标。 |
| `waveform-light` | `WaveformLightIcon` | 插画 / 状态素材图标 | 波形浅色素材图标。 |
| `worktree` | `WorktreeIcon` | 插画 / 状态素材图标 | 工作树素材图标。 |

## 维护建议

- 新增图标时先取稳定语义 token；不要直接保留上游打包生成的 hash 名称。
- 新增图标内容直接以 React SVG 组件导出；如果要参与语言或文件路径自动解析，再到 `@/lib/code-language-icons` 显式导入并补映射。
- 正式业务引用优先使用无视觉状态后缀的稳定 token；只有确实需要浅色、深色、彩色等变体时再引用对应变体。
- 修改图标模块后至少运行 `pnpm typecheck`。
