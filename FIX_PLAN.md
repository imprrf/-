# 修复计划

> 制定日期：2026-10-09
> 依据：[AUDIT.md](./AUDIT.md)（2026-10-08 审计）+ [FIXES.md](./FIXES.md)（第 1 步已完成）
> 起点：commit `cc6454b`（"fix: 修复功能缺陷和无用UI"），tag `v1.0.2` 为回滚基线
> 说明：原文为任务拆分与排期；当前实现状态见下方记录。

## 部署当前停点（2026-10-13）

详细对话总结与第 5～8 步续接见 [SESSION_PROGRESS.md](./SESSION_PROGRESS.md)。

2026-10-13 状态：第 5 步（真实进入/离开）、第 6 步（成员管理、资料、地点、角色授权撤销、越权、旧记录盘点）、第 7 步（数据库权限收紧，用户确认全部通过）均已验收。待办：第 8 步收尾回归、云函数线上版本与本地逐文件核对（CLI download 未成功）、Git 提交。

当前分支 fix/security-hardening，HEAD 为 6d5242d；最新自由到访调整和 _id 修复仍在工作区。原起点 a4e2e12 和原备份保留。本次记录不提交或操作云端。


## 最新业务决策：工作室自由到访（2026-10-12）

用户明确取消迟到、早退规则：工作室有时间就来，不按上下班管理。此前 T5 的迟到、早退、工作日缺勤要求停止执行，新写入不计算这些字段；历史值不迁移、不展示。页面仅展示进入、离开、停留时长、实际到访天数和次数。任何时刻均可打卡，旧排班配置不参与打卡准入。云函数需重新部署后才生效。

## 本轮实施状态（2026-10-12）

已检查两层 Git、保存完整工作区与 Git bundle 备份，建立 `fix/security-hardening` 分支。

| 项目 | 本地结果 | 仍需云端验证 |
|---|---|---|
| T0 | 起点 a4e2e12；备份与分支已完成 | 三账号、权限截图、数据导出 |
| T1 | 真正循环分页；保留更新额外条件；区分缺失/未变更；明确 openid 和本地查询限制 | 25 条以上真实月度记录 |
| T2 | RECORD_SCHEMA.md；统一只读适配；删除旧服务写入死代码；新记录位置字段省略而非 null | auditRecordSchemas 盘点；依据数量决定迁移 |
| T3 | checkin 云函数、前端接入、服务端北京时间、距离软校验、事务与请求收据；支持多组进出 | 部署后验证真实 SDK 事务冲突、定位与并发 |
| T4 | login 注册事务；adminOps 鉴权/分页/改角色/日志/配置；资料白名单；syncUserInfo 仅从云端刷新身份 | 数据库规则应用及直接 SDK 越权验证 |
| T5 | 已按最新用户决定取消迟到、早退、应到和缺勤；统计实际到访天数、次数、停留时长 | 真机验证任意时刻打卡 |
| T6 | 班次页已由起点提交移除；清理敏感调试日志；版本统一；手机号保持宽松校验 | 9MB 根目录留档保留，无删除 |

验证结果：22 项本地回归全部通过（含任意时刻打卡、旧排班字段失效和历史收据提示清理）；47 个 JS 文件语法检查、JSON、页面路由、模板表达式、云函数副本一致性和 `git diff --check` 通过。四个云函数均通过 wx-server-sdk 3.0.4 本地加载验证。两层 Git bundle 与修改前工作区压缩包已验证。

验收步骤与恢复方法见 [DEPLOYMENT.md](./DEPLOYMENT.md)，记录语义见 [RECORD_SCHEMA.md](./RECORD_SCHEMA.md)。本地回归使用 Node 原生测试与数据库模型；不能仅凭本地回归或函数 HTTP 200 声称验收完成；最新已确认的云端结果及剩余步骤以 [SESSION_PROGRESS.md](./SESSION_PROGRESS.md) 为准。

实施调整：历史格式在云端数量未知时保留集中只读适配，历史未签退按读取时日期显示为“未签退”，不批量改写原数据。权限规则要求 users/records 客户端写入全部禁止，“仅创建者可读写”仍会允许篡改自己的角色和考勤，不能作为最终规则。角色日志只经鉴权云函数读取。

---

## 阶段 0：准备（前置，必须先做）

### ✅ T0.1 固化当前工作区改动【已完成 2026-10-10】

**已修复问题**：
- ✅ 微信云开发 `where()` 查询自动添加 `_openid` 条件，导致全局配置查询失败
- ✅ `config` 集合权限设置不当，其他用户无法读取全局配置
- ✅ `initConfig()` 误判配置不存在，尝试重复插入导致 E11000 错误

**实际修复内容**：
- ✅ `DbService.getOne()` 方法：当查询条件只有 `_id` 时，使用 `doc().get()` 避免 `_openid` 限制
- ✅ `ConfigService.initConfig()` 方法：增加配置存在性检查，避免重复插入
- ✅ 调整 `config` 集合权限为"所有用户可读，仅创建者可写"
- ✅ 优化 `records` 集合索引：创建 `openid_date_index` 组合索引（`_openid` + `date`）

**验证结果**：
- ✅ 启动不再报 E11000 错误
- ✅ 配置正确加载：`[ConfigService.initConfig] 配置已存在，跳过初始化`
- ✅ 数据库查询性能优化完成

**提交记录**：
- Commit: `bcfb595` - "修复 E11000 重复键错误"
- 详细日志：见 `CHANGELOG.md`

### T0.2 建立验证环境【待处理】

- [x] 建分支 `fix/security-hardening`（本轮已建立）。
- [ ] 准备三个测试账号：首个管理员、第二个管理员、普通成员（用于验权限边界）。
- [ ] 云开发控制台截图保存 `records`、`users`、`config` 三张表**当前权限设置**，作为 T4.5 收紧前的对照。
- [ ] 用 `wx.cloud.database()` 的控制台/云函数测试面板直接写一条 `role: 'admin'` 记录，确认能写入——验证问题 3 真实存在，同时作为 T4 完成后的回归用例。

**注意**：集合名已确认为 `config`（单数），不是 `configs`。

---

## T1：数据访问层修复（独立，低风险，先做）

> 不碰云函数、不碰权限，只修 `services/DbService.js`。所有页面都依赖它，必须先修干净，
> 否则后续所有验证都会被"只有 20 条数据"误导。

### T1.1 `getList()` 缺省分页导致数据截断【高优先级】

`DbService.js:104` 只在 `options.limit` 存在时才加 `.limit()`，云 SDK 默认返回 20 条。

**影响面**（已 grep 确认）：
- `CheckinService.getMonthRecords()`（`CheckinService.js:46`）不传 limit → 月度记录最多 20 条
- → `CheckinService.getStatistics()` 统计错
- → `userList.js:84` 每个成员的月度统计错
- → `userDetail.js:53` 管理员看的日历年历只亮前 20 天
- → `mine.js:60` 个人出勤天数错

**动作**：
- 小任务 a：`getList` 增加默认 `limit`（建议 1000，与页面里现有写法一致），或在 `options.limit` 缺省时循环分页取全量。
- 小任务 b：把所有绕过 `getList` 的页面查询也统一走 `DbService`，避免"有的地方记得加 limit、有的地方忘了"。
- 小任务 c：写一个对照实验——插入 25 条测试记录，确认修复前统计明显偏小、修复后正确。

**验收**：单月 > 20 条记录时，记录页、成员统计、日历页数量一致且正确。

### T1.2 `update()` 用 `query._id` 时硬编码 `updated: 1`

`DbService.js:201` 无论是否真的改到文档都返回 `{ success: true, updated: 1 }`，
调用方（`ConfigService.js:102`、`CheckinService.js:146`、`CheckinService.js:205`）靠这个判断成败 → 静默失败。

**动作**：改为读取 `result.stats.updated`，并区分"文档不存在"与"字段无变化"两种情况。
**验收**：对一个不存在的 `_id` 调用 `update`，返回 `success: false` 或 `updated: 0`，而不是假装成功。

### T1.3 `normalizeQuery` / `normalizeData` 的 `openid` 双向映射复核

`DbService.js:25-40` 把 `openid` 映射为 `_openid`，`add()` 又把两者都删掉（`DbService.js:152-154`）。
这套映射是"写入靠云自动生成 `_openid`、查询靠 `_openid`、读取再映射回 `openid`"的隐式约定。

**动作**：抽成显式注释 + 单元级验证（本地存储降级模式下 `openid` 字段是保留的，云端不是，容易踩坑）。
**验收**：云端与本地降级两种模式下，`getOne('records', { openid })` 都能查到同一条记录。

### T1.4 `matchQuery` 不支持数组/区间/嵌套字段

`DbService.js:296` 是严格相等比较。本地降级模式下，任何 `where` 用 `_.gt`/`_.in` 的查询都会静默返回空。
当前 `records.js` 用 `db.command.gte(...).and(...)` 直接查云库，走不到这里，但 T2 统一数据层后会踩到。

**动作**：要么补最小指令支持，要么在文档里写明"本地模式仅支持等值查询"并保证关键查询不依赖本地模式。
**验收**：文档与实现一致。

---

## T2：打卡记录数据结构统一（依赖 T1）

> 现状是两套格式并存（AUDIT 问题 5），但已确认 `CheckinService.clockIn()` 是**死代码**，
> 所以核心决策是"留哪一套"，而不是"写迁移脚本搬数据"。

**两套格式**：
- 格式甲（`CheckinService.clockIn()`，`CheckinService.js:63`）：`clockIn` / `clockOut` / `clockInTimestamp` / `openid` / `status: 'normal'`
- 格式乙（`index.js onClock()`，`index.js:315`，**实际在用**）：`checkInTime` / `checkOutTime` / `checkInTimestamp` / `status: 'Incomplete'|'Complete'|'Incomplete_Expired'`、无 `openid` 字段（靠 `_openid`）

### T2.1 定义唯一 schema 并落到文档

- 小任务 a：写 `RECORD_SCHEMA.md`（或 README 章节），明确字段名、类型、可空性、状态机取值。
- 小任务 b：明确保留格式乙（在用），甲作为历史包袱删除。**但**甲的 `duration`（分钟数）比乙的 `totalWorkTime`（"8h30m" 字符串）更利于统计——建议新 schema 同时保留数值型 `durationMinutes`，展示层再格式化。

### T2.2 删除死代码 `CheckinService.clockIn()` / `updateRecord()`

- 小任务 a：确认 `saveRecord()` 是否也只有死代码调用（当前看是）。
- 小任务 b：删除，或改造为"唯一写入入口"供 T3 的云函数逻辑参考。
- 注意：`getMonthRecords()` / `getStatistics()` **是活的**（userList / userDetail / mine 三处调用），不能删。

### T2.3 收敛写入路径

- 小任务 a：`index.js onClock()` 里的写入逻辑抽成服务层函数（T3 之后改为 callFunction）。
- 小任务 b：`loadTodayRecords()`（`index.js:131-221`）的双格式分支收敛为单格式分支，`pairedRecords` 配对逻辑简化。
- 小任务 c：`records.js buildPairedRecords()`（`records.js:110-180`）、`userDetail.js normalizeRecord()`（`userDetail.js:150-166`）同步收敛。

### T2.4 处理 `checkOutLocation: {}` workaround

`index.js:420` 注释明说是为了绕开 "更新 null 字段报错"，配合 `index.js:437` 的 `_.set()` 使用。

- 小任务 a：确认根因（云数据库对 `null` 字段更新的行为）在当前 SDK 版本下的真实表现。
- 小任务 b：改为 schema 层面明确"该字段要么不存在、要么是对象"，去掉 `_.set({})` 魔法，加注释说明。

### T2.5 历史数据处置

- 小任务 a：统计云端 `records` 里格式甲 / 乙各多少条（用云函数或控制台）。
- 小任务 b：若甲的数量少且无价值 → 不迁移，代码里读到即忽略；若多 → 写一次性迁移云函数。
- **验收**：任意历史日期在记录页、日历页、成员详情页三处显示一致，不出现"漏签退/进行中"错配。

---

## T3：打卡服务端化（依赖 T2，可与 T4 并行）

> 对应 AUDIT 问题 1。已决策：**软校验**（见文末"已确认的决策"）——
> 既不违背 FIXES.md 里"设备差异会导致同一位置不同用户结果不同、故不做强约束"的既有判断，
> 又达成 AUDIT 要的"服务端强校验/有记录"。

### T3.1 距离校验实现方式：软校验【已决策】

服务端**自己算**距离并写入记录，**不阻止打卡**：

- 写入 `distance`（数值，米）与 `outOfRange`（布尔）两个字段。
- 超出 `configs.location.radius` 时标记 `outOfRange: true`，但仍正常完成打卡。
- 管理端（`userList.js` / `userDetail.js` / `admin.js`）需能显示"超出范围"标记，让异常打卡有据可查。
- 前端 `index.js calculateDistance()` 的"范围内/超出范围"文字提示保留，作为用户体验反馈，但**不再是唯一校验**。

**明确放弃**：超出半径直接拒绝打卡（会因定位漂移导致正常员工打不了卡）。

### T3.2 新建 `cloudfunctions/checkin`

- 小任务 a：云函数骨架 + `wx-server-sdk` 初始化，复用 `getOpenid` 的写法。
- 小任务 b：服务端取时间（`new Date()` 在云函数内，**不信任客户端传的 timestamp**）。
- 小任务 c：服务端读 `configs.location`，用 Haversine 计算 `distance` 并写回（不论方案 a/b 都要算）。
- 小任务 d：按 §T3.1 写入 `distance` / `outOfRange`，**不拒绝打卡**。
- 小任务 e：状态机（找当天 `Incomplete` → 判断上班/下班）从 `index.js onClock()` 搬进来，并从客户端删除。

### T3.3 前端改造

- 小任务 a：`index.js onClock()` 改为 `wx.cloud.callFunction({ name: 'checkin', ... })`。
- 小任务 b：客户端仍上传位置（服务端要用），但位置只作参考、服务端可加合理性校验（如经纬度范围、精度）。
- 小任务 c：失败路径与现有 UI（`showCheckinResult`）对接；区分"网络失败"与"服务端拒绝"。

### T3.4 防重复提交

`index.js:316` 的 `this._clocking` 是纯前端防重，绕过后可并发打两次卡。
**动作**：云函数内做幂等（同一 openid + date 用固定 `_id` 或唯一索引/条件更新）。
**验收**：并发调用两次云函数，只产生/更新一条当天记录。

---

## T4：权限与角色服务端化（依赖 T3.2 的云函数基建，可参考同一个鉴权模块）

> 对应 AUDIT 问题 2、3、4，以及我新发现的 `app.js updateUserInfo` 提权路径。

### T4.1 抽公共鉴权模块

- 小任务 a：写 `cloudfunctions/_shared/auth.js`（或每个函数内复制一份最小实现，云函数不能跨目录 require，除非用 npm 包）。
- 小任务 b：**鉴权必须服务端重新查库**，不能信任客户端传的 `isAdmin`——这是 AUDIT 问题 3 的根本。
- 小任务 c：注意 `cloudfunctions/updateUserInfo/index.js:44` 有个残留的 `admins` 集合查询（`db.collection('admins')`），确认这个集合是否存在；不存在说明是废弃逻辑，一并清理。

### T4.2 新建 `cloudfunctions/adminOps`（角色管理）

- 小任务 a：实现 `listUsers`：服务端校验调用者是 admin 后，返回用户列表（替代 `userList.js:52` 的无条件全表读）。
- 小任务 b：实现 `setRole`：校验调用者是 admin → 写 `users.role` → 写 `roleLogs`。替代 `userList.js:150 onToggleAdmin()` 的客户端直写。
- 小任务 c：防护措施——禁止撤销最后一个管理员、禁止自己撤销自己（或至少要求二次确认）。
- 小任务 d：实现 `listAllRecords`（替代 `admin.js:58 loadAllMembersData()` 的全表读 50 条），改为分页 + 可选按日期/成员过滤。

### T4.3 首用户管理员判定加锁

`app.js:182-186` 的 `count()` → `add()` 存在 TOCTOU 竞态（AUDIT 问题 4）。

- 小任务 a：把注册逻辑搬进云函数（`cloudfunctions/login` 或并入 T4.2），服务端用事务确保只有一个首管理员。
- 小任务 b：或退一步——用 `configs` 里的一个 `initialized` 标记做条件更新（`where({initialized: false}).update({initialized: true})` 拿到 `updated: 1` 的才是首位），无需事务。
- 小任务 c：同时把 `app.js login()` 里的查询/注册整体搬到云函数，顺带解决 `app.js:149` 明文打印 openid 的问题（T6.4）。

### T4.4 封堵 `updateUserInfo` 提权路径【新发现，优先级高】

`app.js:256 updateUserInfo()` 把整个 `userInfo`（含 `role`、`isAdmin`）写回云数据库。

**攻击路径**：改本地存储 `userInfo.role = 'admin'` → 进"我的"改一次姓名触发保存 → 云端 role 被写成 admin。
**这比 AUDIT 问题 3 更直接**，且不需要任何数据库写权限配置错误。

- 小任务 a：字段白名单——只允许 `name` / `phone` / `avatar` / `realName`，显式剔除 `role` / `isAdmin` / `_openid` / `_id`。
- 小任务 b：更彻底的做法是这段也走云函数，服务端只接受白名单字段。
- 小任务 c：检查 `app.js:221 syncUserInfo()`——它也从云端读 role 后写回本地缓存（`app.js:230-245`），确认这条路径的方向是"云端 → 本地"，反向写入已被堵住。
- **验收**：手工污染本地 `userInfo.role` 后保存资料，云端 role 不变。

### T4.5 数据库权限收紧（最后一步做，避免中间态把功能打断）

- 小任务 a：`users` → "仅创建者可读写" + 自定义规则（管理员读全表通过云函数绕开客户端权限）。
- 小任务 b：`records` → 同上。
- 小任务 c：`configs` → 读开放（所有登录用户要读考勤地点）、写仅云函数。
- 小任务 d：`roleLogs` → 仅云函数写，管理端只读。
- **顺序要求**：必须 T4.2 全部改造完成、且前端已全部走云函数之后再改权限，否则 `admin.js` / `userList.js` 立即白屏。
- 小任务 e：改完后按 T0.2 准备的账号做回归（普通用户直接 SDK 读全表应失败）。

### T4.6 审计日志补全

`roleLogs` 写入目前在 `userList.js:191`，客户端直调。迁到云函数后确认字段完整（谁、什么时候、改了谁、旧角色、新角色）。

---

## T5：迟到/早退与统计口径【已被最新自由到访决策取代，以下保留原计划】

> 对应 AUDIT 问题 6，但实际范围比审计更大——统计口径本身就有矛盾。

### T5.1 实现迟到/早退判定

- 小任务 a：打卡时读 `configs.workStartTime` / `workEndTime` / `lateMinutes` / `earlyMinutes`，在服务端计算（配合 T3）。
- 小任务 b：写入 `lateMinutes` / `earlyMinutes` / `status`（`normal` / `late` / `early` / `late_early`）。
- 小任务 c：若 T3 未完成，先在客户端算并写入（临时方案，标注 TODO），T3 完成后迁走。
- 注意 `CheckinService.js:109` 和 `:124` 都有 `record.status = 'normal'` 硬编码，需要一并处理。

### T5.2 修 `getStatistics()` 的统计逻辑

- 小任务 a：`lateDays` / `earlyDays` 目前恒为 0（`CheckinService.js:238-239` 声明，从不赋值）→ 按 T5.1 写入的字段累加。
- 小任务 b：`presentDays`（`CheckinService.js:266-270`）靠"有任意打卡字段"计数，格式甲/乙在各处的过滤条件不一致 → T2 统一后简化为单条件。
- 小任务 c：**口径冲突**——`mine.js:87 getWorkDaysInMonth()` 统计**整月**工作日（含未来日期），
  而 `CheckinService.getStatistics()`（`CheckinService.js:249-263`）只统计**已过**日期。
  同一个月，两个页面给出的"缺勤天数"不一样。需要确定唯一口径（建议：只算已过日期）。
- 小任务 d：法定节假日 / 调休如何处理？（当前只排除周末）确认是否要支持，不支持就写进 README 说明。

### T5.3 UI 展示

- 小任务 a：`index.js` 打卡成功后按状态给出不同提示（迟到/早退）。
- 小任务 b：`records.js` / `userDetail.js` 日历格子用颜色区分正常/迟到/缺勤（当前 `records.js:83` 只有 `green` 一种）。
- 小任务 c：`userList.js` 成员列表展示 `lateDays` / `earlyDays`（字段已取，确认 wxml 有渲染）。

---

## T6：代码卫生与清理（完全独立，随时可做，适合穿插）

### ✅ T6.1 删除废弃嵌套目录（AUDIT 问题 8）【已完成 2026-10-12】

确认无引用后删除：
- `pages/admin/pages/admin/periodsSet.js`（有实体内容，疑似重复副本）
- `pages/admin/pages/pages/admin/periodsSet.wxml`（**0 字节空文件**）
- `services/services/LocationService.js`（10KB，全项目无任何 `require`）

**完成情况**：
- `periodsSet` 相关嵌套文件此前已由 `HEAD` 删除。
- 扫描全项目确认 `LocationService` 无外部引用后，删除 `services/services/LocationService.js`。
- 全项目 JavaScript 语法检查通过，`git diff --check` 通过。
- `pages/admin/pages/` 与 `services/services/` 空目录已清理。

### ✅ T6.2 删除 `periodsSet` 空壳页【起点提交 a4e2e12 已完成】

`pages/admin/periodsSet.js` 是 Page 模板空壳（只有生命周期空函数），但 `app.json:8` 已注册，
`README.md` 也把它列为"班次设置"。`pages/admin/pages/admin/periodsSet.js` 里倒是有 `periods` 的实现。

**动作**（不做多班次功能，直接删除）：
- 小任务 a：从 `app.json` 的 `pages` 数组移除 `"pages/admin/periodsSet"`。
- 小任务 b：删除 `pages/admin/periodsSet.js` / `.json` / `.wxml` / `.wxss` 四个文件。
- 小任务 c：删除嵌套重复目录（与 T6.1 合并处理）——`pages/admin/pages/admin/periodsSet.js`（含未接线的 `periods` 实现）与 `pages/admin/pages/pages/admin/periodsSet.wxml`（0 字节）。
- 小任务 d：更新 `README.md`，把"班次设置"从功能列表和目录结构中移除（避免文档与实际不符）。
- 小任务 e：全项目 `grep -rn "periodsSet\|periods"` 确认无残留跳转（`mine.js` / `admin.wxml` 里不应有入口）。
- **验收**：小程序编译无 "page not found" 警告；`app.json` 页面列表与实际文件一一对应。

### T6.3 清理调试日志（AUDIT 问题 9）

全项目 81 处 `console.*`，其中带 `【调试】` 标记且打印敏感信息的：
- `app.js:278,285,289,295,297,301,304`（打印完整 userInfo / \_id）
- `pages/index/index.js:65`（打印完整 userInfo）
- `app.js:149` `console.log('当前登录用户的真实唯一OpenID:', openid)`（**明文打印 openid**）
- `ConfigService.js` 8 处 `[ConfigService]` 日志（未提交改动引入的）

**动作**：保留真正的错误日志（`console.error`），删除/降级 `console.log`；
建议引入一个 `utils/logger.js` 按环境开关，而不是散落各处的裸 `console.log`。

### T6.4 版本号统一

`app.js:8` `APP_VERSION = '1.0.2'`，但 `mine.js:12` 默认值是 `'1.0.1'`，`admin.js:44` 又硬编码兜底 `'1.0.2'`，`README.md` 里也散落版本描述。
**动作**：统一从 `app.globalData.appVersion` 取，去掉各处硬编码兜底。

### T6.5 根目录大文件与 .gitignore（AUDIT 问题 10）

- `wx_program/project-code.txt`（9MB）—— git 仓库实际在 `miniprogram/` 内，该文件在仓库外，**未被版本控制**，风险低于审计描述。
- 确认 `wx_program/` 根目录是否还需要单独的 `.gitignore`（若将来在根目录初始化仓库则需要）。
**动作**：确认该文件是否仍需要留档；不需要则移入归档目录或删除。

### T6.6 手机号校验（AUDIT 问题 11，可选）

`mine.js:105` `/^1\d{10}$/`。审计自己也说"一般场景可接受"。
**动作**：除非有明确需求，否则保持现状，只在注释里标注是有意为之。

---

## 依赖关系

```
T0 准备
 ├─→ T1 数据层修复 ─→ T2 数据结构统一 ─→ T3 打卡服务端化 ─┐
 │                                          T5 统计口径 ──┤
 └─→ T4.1 鉴权基座 ─→ T4.2 adminOps ──→ T4.4/T4.3 ──→ T4.5 权限收紧（最后）
T6 代码卫生（完全独立，任何时间可插入，建议 T1 前后各做一批）
```

**关键顺序约束（违反会打断功能）**：
1. `T4.5 权限收紧` 必须在 `T4.2` 前端改造完成后，否则成员管理页、系统配置页立即失效。
2. `T3.2 云函数` 建好并验证前，不要动 `index.js onClock()`。
3. `T1.1` 应尽早，否则 T2/T5 的验证结论都会被"只有 20 条数据"污染。

---

## 建议执行顺序（按性价比排序）

| 批次 | 内容 | 理由 |
|---|---|---|
| 第 1 批 | T0 + T1.1 + T1.2 + T6.1 | 都是低风险高收益，且 T1.1 是后续验证的前提 |
| 第 2 批 | T4.4（提权封堵）+ T6.3 | 纯前端改动，收益极高，不依赖云函数 |
| 第 3 批 | T2 | 为 T3 铺路，改动面大但机械 |
| 第 4 批 | T3 | 核心安全项，工作量最大 |
| 第 5 批 | T4.1→T4.2→T4.3→T4.5 | 权限体系，需云函数基建 |
| 第 6 批 | T5 + T6 剩余 | 功能补全与收尾 |

---

## 已确认的决策（2026-10-09）

1. **T3.1 距离校验 = 软校验（已定）**
   服务端计算 `distance` / `outOfRange` 并写入记录，**不阻止打卡**；管理端需可显示超范围标记。
   放弃"超半径直接拒绝"方案。理由：FIXES.md 已判定设备定位差异会导致误判，
   软校验在保留打卡体验的同时满足 AUDIT "服务端有记录"的诉求。

2. **T0.1 集合名 = `config`（已定，2026-10-10 修正）**
   ~~保留工作区改动方向，集合统一用 `configs`。~~
   **实际确认**：集合名为 `config`（单数），不是 `configs`。
   已通过修改 `DbService.getOne()` 使用 `doc().get()` 方法解决权限问题。
   无需迁移集合，已保存的考勤地点/时间配置正常加载。

3. **T6.2 班次设置页 = 删除（已定）**
   不做多班次功能。从 `app.json` 移除注册、删除空壳页与嵌套重复副本、同步更新 README。

## 仍需确认（不阻塞开工，可在对应批次前答复）

- **T5.2d 法定节假日**：考勤日历是否纳入法定节假日 / 调休？当前只排除周末。
  影响 `CheckinService.getStatistics()` 与 `mine.js getWorkDaysInMonth()` 的工作日计算。
- **T6.5** `wx_program/project-code.txt`（9MB）是否还需要留档？该文件在 git 仓库外，未被版本控制。
