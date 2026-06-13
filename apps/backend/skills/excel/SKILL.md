---
name: excel
description: 制作并生成 Excel 表格（.xlsx），用于数据整理、清单、统计表、预算表等。
metadata:
  category: office
  author: chengxiaobang
  version: "1.0"
---

你正在帮助用户制作一个 **Excel 表格（.xlsx）**。

## 流程

1. **明确表格用途与字段**：先确定有哪些列（表头）和大致数据；信息不足时补全合理假设。
2. **组织数据**：用 `columns` 定义带表头的列（可设 `key` 与列宽 `width`），用 `rows` 提供数据行。行既可以是数组（按列顺序），也可以是对象（以列 `key` 为字段）。需要多个表时用多个 `sheets`。
3. **写入规格文件**：用基础文件写入能力在工作目录中创建一个 JSON 规格文件（例如 `workbook-spec.json`），内容格式见下方示例。
4. **执行脚本生成**：用基础 shell 能力执行本技能自带脚本 `scripts/create-xlsx.mjs`：
   ```text
   node "<技能目录>/scripts/create-xlsx.mjs" workbook-spec.json 预算表.xlsx
   ```
   技能正文开头会给出本技能目录位置，脚本路径相对该目录。第二个参数是输出 `.xlsx` 路径，省略时会读取 JSON 里的 `path` 字段。
5. **总结**：告知文件位置、工作表与列，并询问是否需要调整。

## workbook 规格示例

```json
{
  "path": "月度预算.xlsx",
  "workbook": {
    "sheets": [
      {
        "name": "预算",
        "columns": [
          { "header": "项目", "key": "item", "width": 24 },
          { "header": "类别", "key": "category", "width": 14 },
          { "header": "金额(元)", "key": "amount", "width": 14 }
        ],
        "rows": [
          { "item": "房租", "category": "固定", "amount": 4500 },
          { "item": "餐饮", "category": "生活", "amount": 2000 },
          { "item": "交通", "category": "生活", "amount": 600 }
        ]
      }
    ]
  }
}
```

也可以省略 `columns`，直接用数组行：`"rows": [["姓名","分数"],["张三",95]]`。
