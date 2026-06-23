---
name: pptx
description: 制作、读取、分析、编辑 PowerPoint 演示文稿（.pptx），支持从零创建、模板改造、OOXML 检查与按模型能力启用视觉 QA。
metadata:
  category: office
  author: chengxiaobang
  version: "2.0"
---

你正在帮助用户处理 **PowerPoint 演示文稿（.pptx）**。只要任务涉及 deck、slides、presentation、PPT、幻灯片或 `.pptx` 文件，都优先使用本技能。

## 先判断任务类型

- **读取/分析已有 PPTX**：先执行 `scripts/pptx-inspect.mjs` 提取页序、标题、正文、备注和疑似占位符。
- **从零创建 PPTX**：不要再写 JSON 规格文件。请在工作目录写一个一次性 `.mjs` 脚本，导入 `scripts/pptx-author.mjs` 和 `pptxgenjs`，用代码生成可编辑 PPTX。
- **基于模板编辑 PPTX**：先 inspect 和 unpack，分析模板版式，再复制/删除/重排 slide，编辑 XML，clean、pack、validate。

## 从零创建流程

1. 明确主题、受众、页数和素材来源；信息不足时补全合理假设，不反复追问。
2. 规划 6-12 页结构：封面、目录、章节页、内容页、数据/流程/对比页、总结页。
3. 每页都要有视觉结构：形状、图表、统计数字、流程、图标、分栏或图片。避免纯白底标题加项目符号。
4. 写一次性生成脚本，例如 `make-deck.mjs`：
   ```js
   import {
     createPresentation,
     savePresentation,
     addTitle,
     addSectionTitle,
     addBodyText,
     addCard,
     addStat
   } from "./<技能目录>/scripts/pptx-author.mjs";

   const pptx = createPresentation({ title: "产品发布会", author: "程小帮" });
   const slide = pptx.addSlide();
   addTitle(slide, "产品发布会", { subtitle: "2026 路线图" });
   await savePresentation(pptx, "产品发布会.pptx");
   ```
5. 执行脚本生成 PPTX：`node make-deck.mjs`。
6. 跑文本和结构 QA：
   ```text
   node "<技能目录>/scripts/pptx-inspect.mjs" 产品发布会.pptx
   node "<技能目录>/scripts/pptx-validate.mjs" 产品发布会.pptx
   ```

## 模板编辑流程

1. 分析模板：
   ```text
   node "<技能目录>/scripts/pptx-inspect.mjs" template.pptx
   node "<技能目录>/scripts/pptx-unpack.mjs" template.pptx unpacked/
   ```
2. 选择适合内容的模板页。不要连续复用同一种重文本版式。
3. 需要复制 slide 时：
   ```text
   node "<技能目录>/scripts/pptx-add-slide.mjs" unpacked/ slide2.xml
   ```
   脚本会输出需要插入 `ppt/presentation.xml` 的 `<p:sldId .../>`。
4. 修改 XML 时优先用精确文本替换；删除多余占位符、图片和图形，不要只把文字清空。
5. 完成结构调整后执行：
   ```text
   node "<技能目录>/scripts/pptx-clean.mjs" unpacked/
   node "<技能目录>/scripts/pptx-pack.mjs" unpacked/ output.pptx
   node "<技能目录>/scripts/pptx-validate.mjs" output.pptx
   ```

## QA 要求

所有模型都必须完成：

- 文本 QA：用 `pptx-inspect.mjs` 检查页序、标题、正文是否完整。
- 占位符 QA：检查输出中是否有 `xxxx`、`lorem`、`ipsum`、`placeholder`、`单击添加` 等残留。
- 结构 QA：用 `pptx-validate.mjs` 检查 slide 引用、rels、Content Types 和 media 引用。

视觉 QA 按当前模型能力处理：

- 如果系统提示里的 `supportsImage=true`，可以先执行 `pptx-render-images.mjs`，再用 Read 逐页读取导出的 JPG/PNG 进行视觉检查，重点看重叠、截断、低对比度、边距和对齐。
- 如果 `supportsImage=false`，不要让模型读取导出的图片做视觉审稿；只生成图片作为人工预览辅助，并在总结中说明“当前模型不支持图片输入，已完成文本/结构 QA，视觉检查留给用户预览确认”。
- 如果本机缺少 LibreOffice 或 `pdftoppm`，`pptx-render-images.mjs` 会给出 warning；这不阻断 PPTX 生成，但总结中必须说明未覆盖自动渲染预览。

## 设计原则

- 颜色要服务主题，不默认全蓝。选一个主色、一个辅助色、一个强调色。
- 标题 32-44pt，正文 14-18pt，页面边距不少于 0.5 英寸。
- 保持可编辑性：优先使用文字框、形状、图表和图片对象，不把整页做成一张截图。
- 图片默认来自用户提供素材、模板自带素材、或代码生成的图表/形状；不要默认联网抓图。
- 最终回复必须用中文说明文件位置、页数、QA 结果和未覆盖风险，并声明最终产物：
  `<artifacts><artifact path="输出文件.pptx" /></artifacts>`
