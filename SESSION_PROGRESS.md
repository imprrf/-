# 对话总结与部署续接

> 更新：2026-10-13（本机日期）。只记录已知事实，不包含完整 OpenID、手机号或密钥。
> **当前停点：第 5、6、7 步均已验收（2026-10-13），数据库权限已收紧。剩第 8 步：越权探测（普通成员直接 SDK 写 users/records/config 应被拒）、云函数线上版本核对、最终备份、Git 提交（不要把 .claude/、tasks/ 不加筛选提交）。**

### 第 6 步其他已验证项（2026-10-13）

- 地点配置：管理员保存后页面成功，重进保持，config/main_config 同步一致（用户确认）。
- 普通成员：第二个微信（已加为体验成员）登录后为普通成员，无后台入口（用户确认）。
- 控制台匿名调用 adminOps（action=listUsers）返回 success=false、“请通过小程序登录”，无数据（只证明匿名被拦，不等于普通成员被拦）。
- 真实普通成员越权已验证：第二个账号经临时编译模式直接打开 pages/admin/admin，提示“无管理员权限”，无数据（用户确认）。临时编译模式测完应删除。
- 第 6 步全部项均通过：成员列表/详情/总览、资料保存、地点配置、越权、角色授权/撤销（roleLogs 与计数已核对）、旧记录盘点。唯一未真实验证：25 条以上分页（现有数据量不足，本地测试已覆盖 20 条与 1000 条）。

### 第 7 步：数据库权限收紧（2026-10-13，用户确认全部通过）

- users、records：自定义规则 `read: auth.openid != null && doc._openid == auth.openid`，`write: false`。
- config：控制台预设“所有用户可读”（database.rules.json 写的是登录用户可读，略严；二者只差未登录者能否读地点配置，不敏感，以控制台实际为准）。
- roleLogs、security_state、checkin_state、checkin_requests：预设“所有用户不可读写”。
- 验证：用户确认 users、records 收紧后登录、资料保存、成员管理、打卡、记录读取均正常。
- 越权探测（Console 直接 SDK 写入）：config.doc('main_config').update 与 records.add 均返回 `Permission denied`（DATABASE_PERMISSION_DENIED），规则有效。users 首次探测用了占位 openid 条件，说服力不足；随后用 `users.doc(自己的_id).update` 补测，同样被拒绝（用户确认）。三类集合的客户端直接写入均已验证被拒。
- 已知缺口：四个云函数线上版本与本地未逐文件核对。`cloud functions download` 先报 code 17（目标目录须预先存在），建好目录后又报 `env true not exists`（`$envId` 被解析成 true，终端变量丢失所致），未成功。用户决定跳过；功能验证间接覆盖 checkin/adminOps/updateUserInfo/login 的当前行为。
- 回滚：把 users、records 改回“所有用户可读，仅创建者可读写”即可，但会重新允许客户端改自身 role 与伪造考勤。

### 角色授权/撤销与旧记录盘点（2026-10-13，用户确认）

- 管理员把第二个账号设为管理员再撤销：入口随之出现和消失，roleLogs 与 security_state 数据库已核对（用户确认）。
- auditRecordSchemas 只读盘点：total 89，schemaV2 7，formatB（checkInTime 旧版）31，legacyEvents（type=in/out 事件）51，formatA 0，unknown 0。没有无法识别的记录。RecordModel 已能读取 formatB 与 legacyEvents；用户确认新旧两种格式页面均显示正常，新格式字段更全。结论：暂不迁移旧记录（迁移会改线上数据，收益只是格式统一）。
- 登录后自动弹出资料窗口：已验证。此前未弹出是因为手机跑的是旧预览包；重新预览后 needsProfile 返回 true（姓名“三横”、无手机号），编辑窗口自动弹出（用户确认）。临时诊断日志已删除。

### 资料补全与微信手机号（2026-10-13）

- 微信手机号自动获取不可用：Console 报 `getPhoneNumber:fail operateWXData:fail jsapi has no permission 102`，该小程序无手机号接口权限（多为主体类型/认证限制）。已撤销按钮、云端换取与接口声明；手机号只能手动输入。后续若取得权限再另行实现。
- 昵称：姓名输入框使用 `type="nickname"`，键盘出现微信昵称建议（用户确认有效）。微信不允许静默读取昵称/手机号。
- 登录后引导：app.needsProfile 在姓名为空/“微信用户”或手机号为空时返回 true。“我的”页登录后自动弹出编辑窗口；打卡页登录后经 globalData.promptProfile 跳到“我的”并弹窗。仅前端，待设备验证。
- 撤销管理员后入口不刷新：新增 app.refreshIdentity（30 秒限频），“我的”页 onShow 刷新身份。服务端撤销本身正确；待重做授权/撤销验证。

### 第 6 步已发现并修复的前端缺陷（2026-10-13，仅前端，无需部署云函数）

- 现象：重新编译后管理员入口消失，改资料后才出现。数据库 role/isAdmin 始终正确，服务端未改角色。
- 原因一：onLaunch 期间 getApp() 为 undefined，启动同步在 CloudService.call 里报错，从未发出。修复：call 增加第三个参数 app，app.js 内三处调用传 this；同步失败日志现在打印原因。
- 原因二：“我的”页 onShow 在同步完成前读取 isAdmin 后不再刷新。修复：app.syncPromise，页面等待后重新读取。
- 已确认：重新编译后管理员入口自动出现。

## 业务决定

- 这是工作室自由到访记录，不是上下班考勤：有时间就来，任意时间均可打卡。
- 取消迟到、早退判定、提示、统计及颜色；同时移除应到工作日和缺勤指标。
- 保留进入、离开、停留时长、实际到访天数、次数和定位参考。旧排班字段不参与打卡准入；旧迟到早退字段保留原数据但不展示。
- 超范围为软校验：服务端计算距离、记录标记，不拒绝。无定位允许提交并记录缺失；非法坐标拒绝。
- 当前跨日期配对没有扩展：当天无挂起记录就记录进入，过去未完成记录显示“未记录离开”。不等于禁止深夜打卡，但跨午夜离开尚未自动配对，后续如需要应单独确定规则。
- 用户要求代码可读、规范；已整理格式并拆分职责。新的业务决定优先于 FIX_PLAN 原 T5 迟到早退要求。

## 项目、Git 与备份

- 项目：`C:\Users\星耀14\Documents\wx_program\miniprogram`。
- 环境 ID：`cloud1-d4g22few1dfa58dd6`。集合名是 `config`（单数），文档 ID 是 `main_config`。
- 实际仓库位于 miniprogram，外层 wx_program 另有 Git，以 gitlink 指向小程序；两层不能混为一谈。
- 修改前小程序 HEAD：`a4e2e12`，跟踪文件干净，`.claude/`、`tasks/` 未跟踪；main 跟踪 origin/feature/multi-checkin 且分叉，不自动合并或推送。
- 修复分支：`fix/security-hardening`。当前 HEAD 已是 `6d5242d`（fix: 安全加固与打卡服务端化），最新业务调整和 _id 修复仍有未提交改动。本轮总结不再提交、不覆盖已有改动。
- 初始备份：`C:\Users\星耀14\Documents\wx_program-backups\20261013-093551-before-fix-plan\`，含 workspace.tar.gz、两层 Git bundle，以及中途 after-fix-plan-workspace.tar.gz；都已验证。这不是所有后续修改的最终快照。
- 自由到访调整前备份：`C:\Users\星耀14\Documents\wx_program-backups\before-unrestricted-checkin-20261013-102206\miniprogram.tar.gz`。
- 保留根目录 9MB project-code.txt；没有删除用户留档或重置数据库。

## 已实现内容

| Plan | 本地实现 | 尚需验证 |
|---|---|---|
| T0 | Git、完整快照、bundle、修复分支 | 云端数据备份、权限截图、测试账号是否准备完，未获得全部确认 |
| T1 | 20 条循环分页，缺省全量；更新数量与额外条件；openid 映射；本地等值查询限制 | 真实 25 条以上记录及查询索引 |
| T2 | RECORD_SCHEMA、RecordModel 集中适配，旧写入死代码删除 | auditRecordSchemas 盘点后决定历史迁移 |
| T3 | checkin 服务端身份/时间/软距离校验，事务、请求收据和短时防重 | 最新 _id 修复重新部署后的业务成功；实际事务冲突 |
| T4 | login 注册事务、资料白名单、adminOps 角色/配置/授权查询、审计日志 | 三账号回归、最终权限规则、越权测试 |
| T5 | 按用户最新决定改成实际到访统计，无迟到早退和缺勤 | 真机到访显示与时长一致性 |
| T6 | 班次页在起点前已清理；日志、版本展示、文档整理 | 上线后界面回归 |

共享源码在 `cloudfunctions/_shared/`，各函数目录中的模块是部署副本。改共享源码后运行 `node scripts/sync-cloud.js`；不要只上传 index.js。SDK 为 `~3.0.4`。

最新一次代码修复后的本地结果：22 项测试通过，47 个 JS 文件/JSON/路由/模板表达式及副本一致性检查通过。测试使用本地数据库模型，不是微信规则引擎或真实事务。此次 _id 问题没有被本地模型发现，说明测试模型对 SDK 保留字段的约束覆盖不足，不能把“测试通过”当作云端验收通过。

## 部署过程与已确认结果

1. 最初前端先切到新云函数，云端未就绪，导致“网络或云服务调用失败”。以后必须配套部署验证，不能只改前端就认定可用。
2. 上传 updateUserInfo 报 `ResourceInUse.FunctionName`：同名函数已存在，创建流程失败。改用 `inc-deploy` 更新现有函数，不删除、不重新创建。
3. CLI 报服务端口关闭：在开发者工具设置的安全设置中开启服务端口，已解决。
4. 长命令粘贴被截断：采用短变量逐行执行。CLI 必须显式传 `--project`，仅 Set-Location 不够；此前“当前目录可省略 project”的指导有误。
5. `punycode` DeprecationWarning 是警告，不是部署失败原因。IDE 已监听 127.0.0.1:50400。
6. 用户输出确认 updateUserInfo 增量更新成功，8 个文件，7.8 KB。函数列表确认存在 adminOps、checkin、getOpenid、login、updateUserInfo。
7. 已指导增量更新 checkin、adminOps、login；未逐一收到这三个最新版本的部署成功输出，不把“函数存在”当作版本正确。
8. 启动显示 `app.js:128 同步用户信息失败`。这个 catch 没打印原因，仅此一行不能定位；不是编译语法错误。随后用户提供 login 日志，明确 `success: true`，返回已有管理员，耗时约 364ms，说明该次登录业务成功。不能据此断定所有历史/后续请求都成功。
9. 云平台 HTTP 200 只代表调用完成；core 捕获业务错误后也可返回 `success: false`，必须看 RetMsg。控制台截图里的调用成功当时全部是 checkin，不是五个函数都验证成功。
10. 第 5 步打卡出现 `document.set:fail -501007 invalid parameters. 不能更新_id的值`。读取 checkin_state 后 state 带系统 _id，再 spread 到 set 写入对象，触发 SDK 拒绝。
11. 最新修复：nextState 删除顶层 _id；完成记录用 nextRecord 删除顶层 _id 后 set；收据写入用独立对象。已同步四个函数目录并跑完本地检查，**用户尚未回报修复后部署和打卡成功**。

不要手动重新创建 security_state/roles：正常 login 会自动初始化，而且本次 login 已成功。只有具体错误和数据核对证明需要修复时才操作。不要猜测后删除 users、清空 records、修改角色计数或删除收据。

## 第 5 步：当前要做的打卡验收

### A. 恢复 PowerShell 变量

若仍是原终端且变量存在，可跳过。新终端逐行执行：

```powershell
$cli = 'D:\usually\微信web开发者工具\cli.bat'
$project = 'C:\Users\星耀14\Documents\wx_program\miniprogram'
$envId = 'cloud1-d4g22few1dfa58dd6'
```

不需要依赖当前目录。每条单独执行；出现 `>>` 时 Ctrl+C 后重新输入完整短命令。

### B. 重新部署本次修复的 checkin

```powershell
& $cli cloud functions inc-deploy -e $envId -n checkin -f . --project $project
```

确认成功结束再编译。若失败，保留完整错误，不继续后面的步骤。此处是已有函数更新，假定首次部署已安装 wx-server-sdk；依赖问题必须另外检查。

### C. 验证真实进入和离开

1. 查看 records 今天已有状态。若有 Incomplete，下一次点击会离开，不要误以为一定是进入。
2. 编译新前端。login 当前已有成功日志；可退出再登录确认。无 npm 前端依赖，构建 npm 不能作为云函数失败的通用修复。
3. 点击一次，观察“进入/离开打卡成功 (当前时间)”。两次独立操作间隔至少 5 秒；5 秒是并发误点击防重，不是 9点/18点的打卡时间限制。
4. 在 checkin 日志查看 RetMsg.success 必须为 true，不只看 status_code=200。
5. 在 records 核对身份所属、date、checkInTime/Timestamp；离开后同一文档有 checkOutTime/Timestamp、durationMinutes、status=Complete。不到一分钟时 durationMinutes=0 正常。
6. 各页面显示同一组进入/离开和时长，不出现迟到、早退、应到或缺勤。
7. 不要直接在生产反复制造打卡测试，优先测试账号；若报错，先查日志再点，不手动删除状态或请求收据。

此步成功前不要启用 users/records 客户端写入禁止规则，不继续宣布 T3 已验收。

## 第 6 步：其他功能及数据核对

- 检查 roleLogs、security_state、checkin_state、checkin_requests 均存在。无需重复创建；其中 roles 已正常初始化的证据是 login success。
- 核对 users、records、config 的数据备份和原权限截图已保存，是否准备三个测试账号。不清空生产 users 来测试首管理员；首管理员竞态在隔离环境测。
- 管理员打开成员列表、成员详情、今日总览：跨成员查询正常且分页完整，25 条以上记录不截断。
- 保存本人姓名/手机号后角色不变；云函数返回 success=true，页面不能显示假成功。
- 管理员保存地点配置并确认重启后读取的还是 config/main_config。adminOps 最新代码忽略旧排班字段；地点格式和半径必须有效。
- 普通成员调用管理接口应返回 success=false；设置第二管理员、撤销他人权限有完整 roleLogs，禁止自撤销并确保至少一个管理员。
- 任意时间到访允许；超范围不阻止；缺定位标记；非法坐标拒绝。网络重试不产生重复进入或误离开，真实云端并发事务另做验证。
- 管理员通过小程序调用上下文执行 adminOps/action=auditRecordSchemas，只读盘点旧格式。控制台无 OPENID 的直接测试不能等价验证授权；数量未知前不迁移或忽略旧记录。
- 排查索引时按控制台明确提示补齐，保留 _openid + date 索引。

## 第 7 步：最后收紧数据库权限（T4.5）

前提：第 5、6 步通过；旧客户端不再直写；配套新前端准备发布；线上数据与权限已备份。当前对话没有确认该步骤已执行。

在控制台逐集合应用该集合的规则对象，不把整个 database.rules.json 粘到一个集合。

users 和 records 分别使用：

```json
{ "read": "auth.openid != null && doc._openid == auth.openid", "write": false }
```

config：

```json
{ "read": "auth.openid != null", "write": false }
```

roleLogs、security_state、checkin_state、checkin_requests 各自使用：

```json
{ "read": false, "write": false }
```

管理员经鉴权云函数访问，不开放客户端全表读取。users 仅创建者可写仍允许篡改自己的 role；records 仅创建者可写仍允许伪造考勤，均不能作为最终规则。若控制台拒绝表达式语法，保留原权限并核对，不能擅自改为全员可写。

## 第 8 步：收紧后的回归与收尾

- 普通成员只能读取本人 users/records，直接 SDK 写本人 role、records 或 config 全部失败。
- 登录、资料保存、进入、离开、管理员列表、角色修改和地点保存通过云函数仍正常。
- roles 的 registeredCount/adminCount 与用户真实数量一致；后续禁止随意控制台改角色或删用户造成计数失配。
- 确认新前端发布与四个云函数版本一致，留存各函数部署状态和关键成功日志。
- 完成后更新 FIX_PLAN 验收状态，保存最终工作区/线上备份，审查 Git 差异再提交。不要把 .claude/、tasks/ 或用户资料不加筛选地提交。
- 回滚需匹配前端、云函数和原权限；仅回滚旧前端会因客户端禁止写入而继续不能打卡。回滚原权限会重新引入安全风险，须明确接受。

## 续接提示

下一次先读本文件和 FIX_PLAN 顶部，询问或查看用户是否已成功重新部署 checkin 及其 RetMsg。不重复前四步，不重新建 roles，不因 HTTP 200 就判定打卡恢复。最优先任务是获得最新 _id 修复后的真实进入/离开成功证据。
