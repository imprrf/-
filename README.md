# 工作室打卡小程序

微信小程序（原生 JS）+ 微信云开发。记录**工作室自由到访**：任意时间都能打卡，不判定迟到、早退或缺勤，只记录进入、离开、停留时长和实际到访。

- 当前版本：**v2.1.0**
- 云环境：`cloud1-d4g22few1dfa58dd6`
- 配置集合：`config`（单数），文档 ID `main_config`

## 业务规则

- 自由到访：任意时刻可打卡，不设应到工作日，不算迟到/早退/缺勤。历史排班字段保留原值，不参与打卡、统计和展示。
- 同日支持多组进出：签到新建一条记录，签退更新当天挂起的那一条。跨日不自动配对，过去未完成的记录显示"未记录离开"。
- 距离为软校验：服务端计算距离并打标记，超范围不拒绝打卡；无法定位时记录"定位缺失"；非法坐标拒绝。
- 统计口径：到访天数、超范围天数按日期去重；到访次数按记录组计数；停留分钟只累计已完成记录。
- 时间统一按北京时间（UTC+8）计算，客户端不提供身份、打卡时间、角色或统计结果。

## 功能

| 角色 | 功能 |
|---|---|
| 成员 | 微信登录、补全姓名（`type="nickname"` 带微信昵称建议）与手机号、进入/离开打卡、按月查看记录、查看本月统计 |
| 管理员 | 全员今日打卡总览、成员列表与详情、设置/撤销管理员、**导出打卡记录（Excel/Word）**、**移除成员（软删除）**、考勤地点配置 |

v2.1.0 新增：

- **导出打卡记录**：`adminOps` 的 `exportRecords` 在云端生成文件，范围可选全部 / 近一周（含今天共 7 天）/ 近一个月（含今天共 30 天），格式 Excel 或 Word。文件含"打卡明细"和"成员汇总"两张表，已移除成员姓名带"（已移除）"。文件写入云存储 `exports/` 并返回临时链接。依赖 `exceljs`、`docx` 只装在 `adminOps`。
- **移除成员**：`adminOps` 的 `removeMember` 做软删除，只标记 `removed: true` 并写 `removedAt`/`removedBy`，用户文档和全部历史记录保留，同事务写 `roleLogs` 审计。被移除成员无法登录、打卡、改资料、被设角色。不能移除自己或管理员。

## 目录结构

```
miniprogram/
├── app.js / app.json / app.wxss   小程序入口、页面与 tabBar、全局样式
├── pages/
│   ├── index/        打卡页（进入/离开）
│   ├── records/      个人记录（按月）
│   ├── mine/         个人中心（资料、地点、成员管理入口、关于系统）
│   └── admin/        管理页 admin、成员列表 userList、成员详情 userDetail、地点配置 locationSet
├── services/
│   ├── DbService.js      云数据库访问，未指定 limit 时按 20 条循环分页读全量；openid 双向映射
│   ├── CloudService.js   云函数调用，区分"网络失败"与"业务拒绝"；管理员分页查询
│   ├── CheckinService.js 本人记录查询、成员授权查询、统计口径
│   └── RecordModel.js    唯一的记录展示适配：北京时间、时长、旧格式兼容
├── cloudfunctions/
│   ├── _shared/      源码目录：db / auth / attendance / admin / export / core
│   ├── login/ checkin/ adminOps/ updateUserInfo/   四个独立部署目录（生成副本）
│   └── getOpenid/    旧接口兼容，已不参与注册授权
├── scripts/          sync-cloud.js（同步副本）、check.js（一致性检查）
├── tests/            fix-plan.test.js + helpers/memory-db.js
└── database.rules.json   数据库权限规则清单（不是自动部署命令）
```

## 云函数架构

微信云函数**不支持跨目录 require**，每个函数必须是完整独立目录。因此采用"源码—副本"模式：

```
cloudfunctions/_shared/*.js   ← 唯一源码，只改这里
        ↓ npm run sync:cloud
cloudfunctions/{login,checkin,adminOps,updateUserInfo}/*.js   ← 自动生成的副本，不要手改
```

`index.js` 只做 `cloud.init` 后转交 `core.handler(name, cloud)`。`core.handler` 负责取 `OPENID`、构造 `db`、统一错误边界，异常统一返回 `{ success: false, message }`。

| 函数 | 职责 |
|---|---|
| `login` | 注册/登录，事务内建用户、初始化角色与计数，首个用户为管理员 |
| `checkin` | 进入/离开打卡，请求收据幂等，事务锁当天状态 |
| `adminOps` | `listUsers`/`listAllRecords`/`listRoleLogs`/`setRole`/`updateConfig`/`auditRecordSchemas`/`exportRecords`/`removeMember` |
| `updateUserInfo` | 资料更新，只接受白名单字段 |

**改代码的唯一正确顺序**：改 `_shared/` → `npm run sync:cloud` → `npm run check` → `npm test` → 部署。

## 数据模型

### 集合

| 集合 | 说明 | 客户端权限 |
|---|---|---|
| `users` | 用户资料、角色 | 只读本人 |
| `records` | 打卡记录 | 只读本人 |
| `config` | 系统配置，文档 `main_config` | 只读 |
| `roleLogs` | 角色变更与移除审计 | 禁止读写（只经云函数） |
| `security_state` | 状态锁，`roles` 文档存 `adminCount`、`registeredCount` | 禁止读写 |
| `checkin_state` | 打卡状态锁（当天的挂起记录） | 禁止读写 |
| `checkin_requests` | 打卡请求收据（幂等） | 禁止读写 |

### `users`

`_id` 为按 openid 生成的确定性 ID；`_openid`、`name`、`realName`、`phone`、`role`（`admin`/`member`）、`isAdmin`（兼容字段）、`createTime`、`lastLoginTime`、`updateTime`；软删除后有 `removed: true`、`removedAt`、`removedBy`。

### `records`

新记录 `schemaVersion: 2`，仅由 `checkin` 云函数写入。日期与时间按北京时间。

| 字段 | 类型 | 约定 |
|---|---|---|
| `_id` | string | 服务端按用户、日期、当日序号生成确定性 ID |
| `_openid` | string | 来自云函数调用上下文，读取时补 `openid` 别名 |
| `date` | string | `YYYY-MM-DD`，北京时间 |
| `timestamp` / `checkInTimestamp` | number | 签到服务端毫秒时间戳 |
| `checkInTime` | string | `HH:mm` |
| `checkOutTimestamp` / `checkOutTime` | number / string | 签退后存在 |
| `checkInLocation` / `checkOutLocation` | object | 有定位时存在，含 latitude、longitude、accuracy；新记录不写 null 或空对象 |
| `durationMinutes` | number | 完成时长整分钟数，向下取整；未完成为 0 |
| `totalWorkTime` | string | 显示兼容字段，如 `8h30m`；统计用数值字段 |
| `status` | string | `Incomplete` / `Complete`；历史 `Incomplete_Expired` 可读 |
| `distance` / `checkInDistance` / `checkOutDistance` | number 或 null | 到考勤点距离（米），缺失定位为 null |
| `checkInOutOfRange` / `checkOutOutOfRange` / `outOfRange` | boolean | 是否超出半径，软校验不拒绝 |
| `locationUnavailable` | boolean | 任一端无法定位 |
| `userName` / `userPhone` | string | 打卡时的用户资料快照 |
| `createTime` / `updateTime` | number | 服务端毫秒时间戳 |

历史兼容：格式甲（`clockIn`/`clockOut`）与 `type: in/out` 事件由 `RecordModel.normalizeList` 集中做只读适配，按成员和日期配对；云函数导出侧有同规则实现 `pairLegacyEvents`。历史未签退记录按读取日期显示为"未签退"，不批量改写原始数据。

## 安全与权限

核心原则：**客户端只读，一切写入只走云函数**。

`database.rules.json` 为规则清单，需在云开发控制台逐集合手动应用：

```json
{
  "users":    { "read": "auth.openid != null && doc._openid == auth.openid", "write": false },
  "records":  { "read": "auth.openid != null && doc._openid == auth.openid", "write": false },
  "config":   { "read": "auth.openid != null", "write": false },
  "roleLogs": { "read": false, "write": false },
  "security_state":   { "read": false, "write": false },
  "checkin_state":    { "read": false, "write": false },
  "checkin_requests": { "read": false, "write": false }
}
```

`users`、`records` **必须禁止所有客户端写入**。早期"仅创建者可读写"不足以阻止用户改自己的 `role` 或伪造考勤。`config` 控制台实际用的是预设"所有用户可读"，与上面规则只差未登录者能否读地点配置，不敏感。

鉴权：云函数从调用上下文取 `OPENID`，用 `userFor()` / `requireAdmin()` 判定，绝不信任客户端传来的 openid、role、isAdmin。角色变更在事务内二次校验"操作者仍是 admin"。

## 开发与检查

```bash
npm run sync:cloud   # 同步 _shared 到四个部署目录
npm run check        # JS 语法、JSON、页面路由、模板表达式、云函数副本一致性
npm test             # 30 项，node --test
```

只需 Node.js。代码风格：两空格、单引号、分号、行宽 100（`.prettierrc.json`）。

测试覆盖：分页（20 条/1000 条）、并发注册与登录、权限边界、资料白名单、打卡幂等、多组进出、旧格式兼容、移除成员、导出整理与旧事件配对。

**局限**：测试用内存数据库模拟，不能代替真实云环境的 SDK 事务、权限规则和并发冲突；云平台 HTTP 200 也不等于业务成功，须看 `RetMsg.success`。

## 部署

1. **准备集合**：`roleLogs`、`security_state`、`checkin_state`、`checkin_requests` 若不存在则创建，客户端权限设为不可读写。
2. **本地检查**：`npm run sync:cloud` → `npm run check` → `npm test`。
3. **上传云函数**：`login`、`checkin`、`adminOps`、`updateUserInfo`，右键选"**上传并部署：云端安装依赖（不上传 node_modules）**"。`adminOps` 新增 `exceljs`、`docx`，首次安装较慢。更新已有函数不要删除重建。
4. **设置超时与内存**：`adminOps` 的超时和内存**必须在云开发控制台手动设置**。实测 `adminOps/config.json` 里的 `timeout`、`memorySize` 不生效，默认 3s/256M 会让导出报"网络或云服务调用失败"；已验证的配置是 **60s / 512M**。
5. **应用权限规则**：在控制台逐集合应用上面的规则。`database.rules.json` 不是自动部署命令，语法校验失败时按控制台表达式语法调整后实测。
6. **上传前端**：版本号只在本地，需在开发者工具上传体验版/正式版，"我的 → 关于系统"才会显示新版本。

CLI 增量部署（更新已有函数，必须显式传 `--project`）：

```powershell
$cli = 'D:\usually\微信web开发者工具\cli.bat'
$project = 'C:\Users\星耀14\Documents\wx_program\miniprogram'
$envId = 'cloud1-d4g22few1dfa58dd6'
& $cli cloud functions inc-deploy -e $envId -n adminOps -f . --project $project
```

`ResourceInUse.FunctionName` 表示上传流程试图创建已存在的函数，刷新云函数列表后再单独上传该目录，不要删函数规避。

### 验收清单

| 场景 | 期望 |
|---|---|
| 同日多组打卡、25 条以上月度记录 | 各页完整；统计按日期去重 |
| 两人并发首次注册 / 同人重复登录 | 恰好一位首管理员，同一用户只有一条身份 |
| 普通成员伪造 role / isAdmin / openid | 无法读全员、改角色或改配置 |
| 客户端直接 SDK 写 users / records / config | 全部 `Permission denied` |
| 并发 checkin、超时重试 | 不重复签到，重试不会变成签退 |
| 超半径 / 定位失败 / 非法坐标 | 前两者允许并标记，非法坐标拒绝 |
| 凌晨、9 点前、18 点后、深夜 | 都能进入和离开，无迟到早退提示 |
| 历史未完成、格式甲/乙、`type:in/out` 事件 | 各页同一适配；旧事件不跨用户配对；导出时间有值 |
| 导出 Excel / Word × 全部 / 近一周 / 近一个月 | 能打开，内容正确，已移除成员带标注 |
| 移除成员 | 无法登录打卡，列表不显示，`users` 带 `removed: true`，历史仍可导出 |

## 已知限制

- 导出文件含姓名和手机号，分享需注意；`exports/` 目录会累积文件，需定期在控制台清理。
- 跨日不自动配对：当天无挂起记录就记为进入，深夜离开不会接到昨天的记录上。
- 微信手机号接口无权限（`jsapi has no permission 102`），手机号只能手动输入；微信不允许静默读取昵称/手机号。
- `adminOps/config.json` 的 `timeout`、`memorySize` 不生效，见部署第 4 条。
- 前端按钮（移除成员、导出）没有自动化测试，按奥卡姆剃刀刻意不加：各只有一个调用方，断言内容只是参数名和提示文字，真实失败模式（部署状态、云端依赖、真机开文档）测试覆盖不到。触发条件：这两个函数开始被频繁改动或出现第二个调用方时再补。
- 海量历史统计的只读盘点可能触及云函数超时，数据量明确后应改为分段盘点。
- 不要在控制台手动删用户文档，会让 `security_state` 的计数与实际不一致。软删除不递减 `registeredCount`（文档仍保留），这是与早期规划的唯一差异。

## Git 与恢复

实际仓库在本目录，外层 `wx_program` 另有仓库并以 gitlink 指向小程序，两层不要混谈。

- 分支：`main`（v2.1.0 已合入，领先 `origin/main`，未推送）
- 特性分支：`feature/export-and-remove-member`
- 回退标签：`backup-before-export-delete`（`2d566e9`）、`v1.0.2`
- 回退：`git reset --hard backup-before-export-delete`（会丢弃未提交改动，执行前确认）。线上云函数需另行恢复旧版本；仅恢复旧前端而保留"客户端禁止写入"权限会让旧版无法打卡。

提交说明须写明日期、目的和修改内容。对云端的写入（部署、数据库）先确认。

## 相关文档

- [AGENTS.md](./AGENTS.md)：续接要点与协作规则（给接手的 AI 或开发者）
- 外层 [README.md](../README.md)：项目总览与快速上手
