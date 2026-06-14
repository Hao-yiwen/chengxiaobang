---
name: webapp-testing
description: 验证 Web 应用功能的方法论：起服务、curl 验证、按"侦察先于动作"原则做浏览器验证并清理现场
metadata:
  category: coding
  author: chengxiaobang
  version: "1.0"
---

你正在帮助用户**验证一个 Web 应用的功能是否正常**。核心方法论：用最便宜的手段先验证（读文件 < curl < 浏览器），浏览器验证遵循"侦察先于动作"，结束后清理现场。

## 分层验证策略

### 第一层：静态内容直接读文件

纯静态 HTML/CSS/JS 不需要起服务——直接用文件读取能力检查：

- HTML 结构是否包含预期元素、链接路径是否正确（相对路径、大小写）。
- 引用的 JS/CSS 文件是否真实存在（用 glob/搜索能力核对）。
- 表单的 action/method、关键元素的 id/class 是否与脚本里的选择器一致。

### 第二层：起服务 + curl 验证可达性

动态应用先把服务跑起来：

1. **后台启动**服务，并把输出重定向到日志文件，记下端口。用程小帮 `shell` 工具时优先传 `mode: "background"`，命令本身保持平台原生写法：
   ```sh
   # macOS / Linux
   npm run dev > /tmp/webapp-test.log 2>&1
   ```
   ```cmd
   :: Windows cmd
   npm run dev > "%TEMP%\webapp-test.log" 2>&1
   ```
2. **等待就绪**：轮询健康端点或首页，而不是固定 sleep 一个猜的秒数：
   ```sh
   # macOS / Linux
   for i in $(seq 1 30); do curl -sf http://localhost:3000/ >/dev/null && break; sleep 1; done
   ```
   ```cmd
   :: Windows cmd（显式用 PowerShell -NoProfile 做轮询，避免依赖用户 profile）
   powershell -NoProfile -Command "for ($i=0; $i -lt 30; $i++) { curl.exe -sf http://localhost:3000/ *> $null; if ($LASTEXITCODE -eq 0) { exit 0 }; Start-Sleep -Seconds 1 }; exit 1"
   ```
   起不来时**先读日志文件**找原因（端口占用、缺环境变量、依赖未装），不要盲目重试。
3. **curl 逐项验证**：
   - 页面可达：macOS / Linux 用 `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/`；Windows cmd 用 `curl.exe -s -o NUL -w "%{http_code}" http://localhost:3000/`，期望 200。
   - 接口契约：macOS / Linux 用 `curl -s http://localhost:3000/api/items | head -c 500`；Windows cmd 可用 `powershell -NoProfile -Command "[string]$body = curl.exe -s http://localhost:3000/api/items; if ($body.Length -gt 500) { $body.Substring(0, 500) } else { $body }"`，检查状态码、Content-Type 与响应结构。
   - 写接口：带上请求体与头，验证成功响应和至少一个错误分支（如缺参数返回 400）。

很多"页面坏了"在这一层就能定位（接口 500、路由 404），无需动用浏览器。

### 第三层：浏览器行为验证——侦察先于动作

需要验证渲染结果与交互（JS 渲染的内容、点击流程）时才进入浏览器。铁律：**先侦察页面的真实状态，再执行动作。**

1. **等加载完成再看 DOM**。现代前端是异步渲染的，导航返回 ≠ 页面就绪。等待"网络空闲"（networkidle 概念）或等待某个标志性元素出现，再做任何检查或截图。
2. **从渲染后的真实 DOM 找选择器**。先获取当前页面快照/DOM 结构，从中确认目标元素实际的标签、文本、属性，**用你亲眼看到的选择器**去交互——而不是从源码里推测的选择器（组件库会改写 class、SSR/CSR 结构可能不同、元素可能在条件分支里没渲染）。
3. **每个动作后重新侦察**。点击/输入之后页面已经变了，旧快照作废；先重新观察再做下一步。
4. **断言用户可见的结果**：文本出现、跳转到了预期 URL、列表多了一项；同时查看浏览器控制台报错——console 干净也是验收项。

## 测试结束：清理现场

无论成功失败都要执行：

```sh
# macOS / Linux
kill <记下的 PID> 2>/dev/null || true
# 不确定 PID 时按端口清理：
lsof -ti:3000 | xargs kill 2>/dev/null || true
```

```cmd
:: Windows cmd
taskkill /PID <记下的 PID> /T /F
:: 不确定 PID 时按端口清理：
for /f "tokens=5" %p in ('netstat -ano ^| findstr :3000') do taskkill /PID %p /T /F
```

留下野进程会占着端口，让下一次测试莫名失败。临时日志/文件也一并清理或告知位置。

## 常见陷阱

| 陷阱 | 后果 | 正确做法 |
| --- | --- | --- |
| 页面未加载完就查 DOM/截图 | 元素"不存在"、截到白屏，得出错误结论 | 等 networkidle 或标志元素出现 |
| 用源码里的选择器而不是渲染后的 | 选择器失配，交互打空 | 先快照真实 DOM 再取选择器 |
| 固定 sleep 猜等待时间 | 时灵时不灵的 flaky 验证 | 轮询条件直到满足（带超时） |
| 服务起失败后直接重试 | 反复撞同一堵墙 | 先读服务日志定位原因 |
| 只验证 happy path | 错误分支上线才暴露 | 至少验证一个失败场景（404/400/空数据） |
| 测试后不杀进程 | 端口被占，污染后续运行 | 结束必清理，失败路径也要清理 |

## 完成标准

- 报告中每一项结论都有证据：命令 + 实际输出（状态码、响应片段、看到的页面文本）。
- 正常路径与至少一个异常路径都被验证。
- 起过的服务进程已全部清理，端口已释放。
- 发现的问题给出定位线索（日志摘录、控制台报错、复现步骤），而不只是"不工作"。
