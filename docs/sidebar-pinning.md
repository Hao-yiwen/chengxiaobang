# 侧边栏置顶功能设计方案

> 最后更新:2026-06-13(功能落地时)

侧边栏中的**会话**与**项目**支持置顶:右键弹出菜单中提供「置顶 / 取消置顶」,置顶项集中展示在侧边栏顶部的「置顶」区。对话内的消息不支持置顶(产品上明确排除)。

---

## 1. 需求与交互规则

- 右键侧边栏的会话行或项目组头 → 菜单出现「置顶」(已置顶时显示「取消置顶」,图标为 PushPin / PushPinSlash)。
- 侧边栏顶部新增「置顶」区,**仅当存在置顶项时渲染**,位于「项目」区之上:
  - 置顶的**会话**:以单行形式展示该会话。
  - 置顶的**项目**:以项目分组形式展示其下**全部**会话——普通项目区有 `slice(0, 8)` 截断,置顶区不截断。
- **原区域去重**:置顶项只在置顶区展示,原「项目」/「对话」区域不再重复出现;取消置顶后回到原区域。
  - 被单独置顶的会话,其所在项目组(无论项目是否置顶)内也不再重复展示。
- 置顶区内排序:项目组在前、单会话在后,各按置顶时间降序(最近置顶在最上)。

## 2. 数据模型

`projects` 与 `sessions` 表各新增一个可空列:

```sql
alter table projects add column pinned_at text;  -- ISO 时间戳,null = 未置顶
alter table sessions add column pinned_at text;
```

- 走既有的 `ensureColumn()` 动态迁移(`sqlite-state-store.ts` 的 `initialize()`),老库打开即升级,无需版本号。
- 一个字段同时表达两件事:**是否置顶**(存在即置顶)与**置顶区排序依据**(降序)。ISO 字符串可直接字典序比较,前端无需解析日期。
- 实体契约(`packages/shared`)相应新增可选字段 `pinnedAt?: string`,由 `mapProject` / `mapSession` 行映射函数按"可选列"模式带出。

### 关键决策:置顶不触碰 `updated_at`

`listProjects` / `listSessions` 均按 `updated_at desc` 排序,而既有的 `updateSession` **总是 bump `updatedAt`**。若置顶复用它,置顶/取消置顶都会把条目顶到普通列表最前,扰动排序。因此新增专用方法,只写 `pinned_at`:

```ts
// StateStore 接口(state-store.ts)
setProjectPinned(id: string, pinned: boolean): Promise<Project>;
setSessionPinned(id: string, pinned: boolean): Promise<Session>;
```

实现要点(`sqlite-state-store.ts`):

- `pinned ? nowIso() : null` 写入 `pinned_at`,SQL 不含 `updated_at`。
- **返回值重读数据库**而非手工 spread——取消置顶时 `{...current}` 会残留旧 `pinnedAt`,重读保证与 DB 严格一致。
- 关键路径有日志:置顶成功 `console.log`,目标不存在 `console.warn` 后抛错。
- 反向保证:`updateSession` 的 SQL 不含 `pinned_at` 列,改名/切模式等操作天然不会清掉置顶状态(有防回归测试)。

## 3. API 设计

复用既有 PATCH 端点,不新增路由;update schema 增加可选开关字段 `pinned?: boolean`(boolean 开关语义,区别于 `model: nullable` 的"显式清空"模式):

| 端点 | 请求体 | 行为 |
|---|---|---|
| `PATCH /api/sessions/:id` | `{ pinned: true \| false }` | 走 `setSessionPinned`,不 bump `updated_at` |
| `PATCH /api/sessions/:id` | `{ title, ... }`(无 pinned) | 维持原行为,走 `updateSession` |
| `PATCH /api/projects/:id` | `{ pinned: true \| false }` | 走 `setProjectPinned` |
| `PATCH /api/projects/:id` | `{ name }` | 维持原 rename 行为 |
| `PATCH /api/projects/:id` | `{}` | 400「没有可更新的字段」(schema 全可选后的新分支) |

路由层按字段分发(`api/routes/sessions.ts` / `projects.ts`):剥离 `pinned` 后,其余字段走原更新路径;`pinned` 存在则再调 `setXxxPinned`。两者混合出现时先更新后置顶,最终返回的实体两者兼有。

兼容性:`projectUpdateSchema` 从必填 `{name}` 改为 `{name?, pinned?}`,旧客户端只发 `{name}` 的请求解析与行为完全不变。

## 4. 前端实现

### ApiClient(`renderer/lib/api.ts`)

- 会话置顶零新增:`updateSession(id, { pinned })` 自动获得契约新字段。
- 项目置顶新增 `setProjectPinned(id, pinned)`,PATCH `{ pinned }`。

### store(`renderer/store/index.ts`)

新增两个 action,模式与 `renameSession` / `renameProject` 一致:

```ts
setSessionPinned(id, pinned)  // apiClient.updateSession(id, { pinned })
setProjectPinned(id, pinned)  // apiClient.setProjectPinned(id, pinned)
```

- 成功后用返回实体**整体替换**本地数组中的对应项(不能 merge:取消置顶时返回对象不含 `pinnedAt`,整体替换才能清掉本地字段)。
- 不重新拉全量;数组顺序天然不变(置顶不改 `updatedAt`,map 替换保持位置)。

### Sidebar(`renderer/components/Sidebar.tsx`)

派生数据(渲染层负责去重与排序,后端列表 SQL 不变):

```ts
ungrouped       = 无 projectId 且未置顶的会话            // 「对话」区
pinnedProjects  = 已置顶项目(组内排除被单独置顶的会话),按 pinnedAt 降序
pinnedSessions  = 已置顶会话,按 pinnedAt 降序            // 置顶区单行
unpinnedProjects = 未置顶项目(组内排除被单独置顶的会话)  // 「项目」区
```

渲染结构:

```
置顶(SectionLabel,仅 hasPinned 时)
  ├─ pinnedProjects → renderProjectGroup(不截断)
  └─ pinnedSessions → renderSession(单行)
项目(hasPinned 时加 mt-6 维持区块间距)
  └─ unpinnedProjects → renderProjectGroup(slice(0, 8))
对话
  └─ ungrouped → renderSession
```

- 抽取 `renderProjectGroup(project, sessions, { sliceTo? })` 供置顶区与项目区共用(与既有 `renderSession` 同一模式),`sliceTo` 缺省即不截断。
- `ProjectGroup` 新增 `pinned` + `onTogglePin` props,`SessionRow` 新增 `onTogglePin`;菜单项插在「重命名」之后,按当前状态切换文案与图标。
- 视觉完全复用既有 token(SectionLabel、ContextMenuItem、`mt-6` 区块间距、`size-3.5` 图标),无 DESIGN.md 之外的新样式。

### i18n

`sidebar` 节新增三个 key:`pinned`(置顶 / Pinned)、`pin`(置顶 / Pin)、`unpin`(取消置顶 / Unpin)。区标题与菜单动作中文恰好同词,但保留独立 key(英文不同词)。

## 5. 测试

| 文件 | 覆盖 |
|---|---|
| `apps/backend/test/sqlite-state-store.test.ts` | 置顶/取消置顶不触碰 `updated_at`;跨重启持久化(覆盖 ensureColumn 迁移 + 行映射);`updateSession` 改名不丢置顶(防回归);取消后 `pinnedAt` 为 undefined |
| `apps/backend/test/api-app.test.ts` | PATCH `{pinned:true/false}` 会话置顶且 `updatedAt` 不变;项目置顶后改名保留置顶;`PATCH {}` 返回 400 |
| `apps/desktop/test/sidebar-pin.test.tsx` | 无置顶项不渲染置顶区;置顶项目组不截断且原区域去重;右键菜单置顶会话(断言 `updateSession` 入参与置顶区位置);右键取消置顶项目(置顶区消失) |

`tsconfig.web.json` 只对 `test/app.test.tsx` 与 `test/stream-client.test.ts` 做 typecheck,`ApiClient` 新增必选方法后需同步补 `app.test.tsx` 的 createClient mock(`setProjectPinned`)。

## 6. 边界情况

| 场景 | 行为 | 额外代码 |
|---|---|---|
| 删除已置顶会话/项目 | 级联删除既有,store 已过滤本地 state,置顶区响应式消失 | 无 |
| 置顶项目下无会话 | 置顶组内复用既有 `sidebar.noChats` 空态 | 无 |
| 置顶会话 + 其项目也置顶 | 会话以单行展示在置顶区,置顶项目组内不重复(组内排除被单独置顶的会话) | 派生时一次 filter |
| 旧库升级 | `ensureColumn` 动态 ALTER,`pinned_at` 为 null = 未置顶 | 两行迁移 |
| 同名条目的编辑态 | `editingId`/`editingProjectId` 为 Sidebar 级共享状态;置顶区与原区域因去重不会同屏双份,该状态无冲突 | 无 |

## 7. 涉及文件清单

```
packages/shared/src/project.ts                 projectSchema.pinnedAt、projectUpdateSchema.pinned
packages/shared/src/session.ts                 sessionSchema.pinnedAt、sessionUpdateSchema.pinned
apps/backend/src/repository/state-store.ts     StateStore 接口 setProjectPinned / setSessionPinned
apps/backend/src/repository/sqlite-state-store.ts  ensureColumn 迁移、两个新方法、行映射
apps/backend/src/api/routes/projects.ts        PATCH 按字段分发 + 空 body 400
apps/backend/src/api/routes/sessions.ts        PATCH 剥离 pinned 分发
apps/desktop/src/renderer/lib/api.ts           setProjectPinned
apps/desktop/src/renderer/store/index.ts       setSessionPinned / setProjectPinned action
apps/desktop/src/renderer/components/Sidebar.tsx   置顶区渲染、去重派生、右键菜单项
apps/desktop/src/renderer/i18n/locales/{zh,en}.json  sidebar.pinned / pin / unpin
apps/backend/test/sqlite-state-store.test.ts   store 层测试
apps/backend/test/api-app.test.ts              API 层测试
apps/desktop/test/sidebar-pin.test.tsx         渲染层测试(新文件)
```
