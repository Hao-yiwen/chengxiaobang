---
name: ppt
description: 根据主题或资料制作专业的 PowerPoint 演示文稿（.pptx），自动规划结构、配色与每页要点。
metadata:
  category: office
  author: chengxiaobang
  version: "1.0"
---

你正在帮助用户制作一份**演示文稿（PPT / 幻灯片）**。请按下面的流程产出一个高质量的 `.pptx` 文件。

## 流程

1. **明确主题与受众**：如果用户已经给出主题/资料，直接使用；信息不足时先用一两句话补全合理假设，不要反复追问。
2. **规划结构**：一份好的演示通常包含
   - 封面页（`title`）：标题 + 副标题。
   - 目录 / 概览页（`bullets`）：列出 3–5 个核心板块。
   - 若干内容页：每页一个主题，3–5 条要点，必要时用 `two-column` 做对比。
   - 章节分隔页（`section`）用于切换大主题。
   - 结尾页：总结 / 行动建议 / 致谢，可用 `quote` 收尾。
   - 总页数一般 6–12 页，不要把所有内容堆在一页。
3. **撰写内容**：每条要点精炼成一句话；标题有信息量（避免“介绍”“概述”这类空标题）。可在 `notes` 写演讲备注。
4. **写入规格文件**：用基础文件写入能力在工作目录中创建一个 JSON 规格文件（例如 `deck-spec.json`），内容格式见下方示例。
5. **执行脚本生成**：用基础 shell 能力执行本技能自带脚本 `scripts/create-pptx.mjs`：
   ```text
   node "<技能目录>/scripts/create-pptx.mjs" deck-spec.json 产品发布.pptx
   ```
   技能正文开头会给出本技能目录位置，脚本路径相对该目录。第二个参数是输出 `.pptx` 路径，省略时会读取 JSON 里的 `path` 字段。
6. **总结**：生成后用中文告诉用户文件位置、页数和大纲，并询问是否需要调整。

## deck 规格示例

```json
{
  "path": "产品发布.pptx",
  "deck": {
    "title": "新一代智能助手 程小帮",
    "subtitle": "让本地 AI 真正帮你把事情做完",
    "author": "程小帮",
    "theme": { "primary": "2E5BFF", "accent": "00C2A8" },
    "slides": [
      { "layout": "title", "title": "新一代智能助手 程小帮", "subtitle": "2026 产品发布" },
      { "layout": "bullets", "title": "今天的内容", "bullets": ["背景与痛点", "核心能力", "实测效果", "下一步"] },
      { "layout": "section", "title": "一、背景与痛点" },
      { "layout": "bullets", "title": "用户面临的问题", "bullets": ["工具分散、上下文割裂", "AI 只会聊天，不会动手", "数据隐私担忧"], "notes": "强调本地优先" },
      { "layout": "two-column", "title": "我们的方案", "columns": [
        { "title": "能力", "bullets": ["读写本地文件", "执行命令", "生成 PPT / Word"] },
        { "title": "体验", "bullets": ["流式推理可见", "操作可审批", "全中文界面"] }
      ] },
      { "layout": "quote", "quote": "把每一个 token 花在真正推动结果的事情上。", "attribution": "程小帮团队" }
    ]
  }
}
```

可用 `layout`：`title`、`section`、`bullets`、`content`（含 `paragraphs` 段落 + `bullets`）、`two-column`（`columns`）、`quote`（`quote` + `attribution`）。颜色用十六进制，不带 `#`。
