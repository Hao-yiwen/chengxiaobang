---
name: conventional-commits
description: 按 Conventional Commits v1.0.0 规范生成或校验 Git 提交信息，先看 diff 再分类，杜绝模糊描述
metadata:
  category: coding
  author: chengxiaobang
  version: "1.0"
---

你正在帮助用户**编写或校验符合 Conventional Commits v1.0.0 规范的提交信息**。

## 格式

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

示例：`fix(parser): handle empty input in tokenizer`

## 铁律

1. **先看清改动，再写信息。**用基础 shell 能力运行 `git status` 与 `git diff --staged`（未暂存时看 `git diff`），逐文件理解实际改了什么。没看 diff 就写 commit message 等于编故事。
2. **禁止模糊描述。**"update code"、"fix bug"、"修改文件"、"调整"这类信息一律不合格——描述必须回答"这次提交具体做了什么"。
3. **一次提交一件事。**diff 里混着多个无关改动（例如一个 bug 修复 + 一个新功能 + 一堆格式化）时，主动建议用户拆分提交，并给出每个提交应包含的文件清单与各自的 message。

## type 取值（仅限以下）

| type | 用途 |
| --- | --- |
| feat | 新增功能（对应 SemVer MINOR） |
| fix | 修复 bug（对应 SemVer PATCH） |
| docs | 仅文档变更 |
| style | 不影响含义的格式调整（空格、分号等，不是 CSS） |
| refactor | 既非修 bug 也非加功能的代码重构 |
| perf | 性能优化 |
| test | 新增或修正测试 |
| build | 构建系统或外部依赖变更（如 npm、tsup、electron-builder） |
| ci | CI 配置与脚本变更 |
| chore | 其他不改 src/test 的杂项 |
| revert | 回滚某次提交 |

分类拿不准时的判定顺序：改了行为吗？→ 是修复已有错误（fix）还是新能力（feat）；没改行为 → 是结构调整（refactor）、纯格式（style）、还是周边设施（build/ci/chore/test/docs）。

## description 规则

- **祈使语气**，像给代码库下命令："add"、"remove"、"handle"，而不是 "added"、"adds"。中文项目可用"新增/修复/移除"等动词开头。
- **小写字母开头**（英文时），**结尾不加句号**。
- **首行总长 ≤ 72 字符**（含 type 与 scope）。塞不下说明该拆提交或细节该进 body。
- scope 用名词标注影响范围，如 `feat(api):`、`fix(renderer):`，与仓库既有 scope 习惯保持一致（可用 `git log --oneline -30` 观察惯例）。

## body 与 footer

- body 解释**为什么改**与**和之前行为的差异**，而不是逐行复述 diff；与首行之间空一行。
- 关联 issue 用 footer：`Refs: #123`、`Closes: #123`。

## 破坏性变更（BREAKING CHANGE）

二选一（也可同时用）：

1. type/scope 后加 `!`：`feat(api)!: remove legacy session endpoint`
2. footer 写明：

```
BREAKING CHANGE: session endpoint /api/v1/session 已移除，请改用 /api/sessions
```

破坏性变更对应 SemVer MAJOR。任何让现有调用方不改代码就会出错的改动都算，包括配置格式、默认值、导出签名的变化。

## 校验既有提交信息时

逐条检查并输出结论：

- [ ] type 在合法列表内，且与 diff 实际内容相符（标着 fix 实际是 feat 要指出）
- [ ] 格式正确：`type(scope): description`，冒号后有空格
- [ ] description 祈使语气、无句号、首行 ≤72 字符
- [ ] 不是模糊描述，看 message 能大致还原改动
- [ ] 破坏性变更被正确标记

每条不合格项给出修正后的完整 message。

## 完成标准

- 给出的 message 与 diff 内容一一对应，type 分类经得起追问。
- 多个无关改动时给出了拆分建议而不是硬塞进一条提交。
- 最终 message 完整可直接用于 `git commit`。
