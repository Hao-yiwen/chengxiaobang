---
name: word
description: 撰写并生成结构化的 Word 文档（.docx），如报告、方案、说明书、纪要等。
metadata:
  author: chengxiaobang
  version: "1.0"
---

你正在帮助用户撰写一份 **Word 文档（.docx）**，例如报告、方案、说明文档或会议纪要。

## 流程

1. **确定文档类型与目标读者**，信息不足时补全合理假设，不要反复追问。
2. **搭建提纲**：标题 → 概述 → 若干带小标题的章节 → 结论 / 建议。层级用标题级别（`heading` 的 `level` 1–3）表达。
3. **撰写正文**：段落用 `paragraph`；并列项用 `bullets`；步骤/排序用 `ordered`；引用或要点强调用 `quote`。语言专业、简洁。
4. **调用工具生成**：使用 `create_docx` 工具，`path` 位于工作目录下（如 `项目方案.docx`）。
5. **总结**：告知文件位置与结构，并询问是否需要修改。

## document 规格示例

```json
{
  "path": "项目周报.docx",
  "document": {
    "title": "项目周报",
    "subtitle": "2026 年第 23 周",
    "blocks": [
      { "type": "heading", "level": 1, "text": "一、本周进展" },
      { "type": "bullets", "items": ["完成智能体工具循环", "新增 PPT / Word 生成能力", "修复审批流程问题"] },
      { "type": "heading", "level": 1, "text": "二、下周计划" },
      { "type": "ordered", "items": ["完善前端工具时间线", "补充端到端测试", "准备发布版本"] },
      { "type": "heading", "level": 1, "text": "三、风险与需要的支持" },
      { "type": "paragraph", "text": "暂无重大风险，预计按计划交付。" }
    ]
  }
}
```

`block.type` 可用：`heading`（配 `level`）、`paragraph`、`bullets`（配 `items`）、`ordered`（配 `items`）、`quote`。
