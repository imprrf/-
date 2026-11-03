# 对接文档：导出打卡记录与移除成员

> 编写日期：2026-11-04（暂停点；导出验证通过后已更新状态）
> 分支：`feature/export-and-remove-member`（未推送，未合并 main）
> 回退标签：`backup-before-export-delete`（提交 `2d566e9`）

## 一、需求来源与已确认的决定

老师两条建议：
1. 管理员可一次性下载全体成员打卡记录。
2. 管理员可删除已退出工作室的成员。

用户已确认：
- 导出 Excel 和 Word 两种格式都要。
- 导出范围三种：全部、近一周（含今天共 7 天）、近一个月（含今天共 30 天）。
- 删除采用软删除：保留用户文档和全部历史记录，只标记 `removed: true`。

## 二、提交记录（均为 2026-11-04，每条说明含日期、目的、修改内容）

| 提交 | 内容 |
|---|---|
| `2d566e9` | 备份点：project.config.json 打包忽略开发文件 |
| `317cb5c` | 移除成员服务端（db.js assertActive；auth/attendance 拒绝已移除用户；admin.js removeMember；4 个新测试） |
| `f9e3f7e` | 成员列表页“移除成员”按钮（userList.js/wxml/wxss） |
| `1767bfa` | 导出服务端（_shared/export.js；admin.js 注册 exportRecords；adminOps/package.json 增 exceljs、docx；2 个新测试） |
| `d75f479` | 管理页导出按钮（admin.js/wxml/wxss） |
| `70011fc` | 版本升至 1.0.3，补 README、RECORD_SCHEMA、DEPLOYMENT |
| `f234ebf` | 导出兼容 `type: in/out` 旧事件（`_shared/export.js` 新增 `pairLegacyEvents`，规则同前端 `RecordModel.normalizeList`；同步 4 个副本；新增旧事件测试） |
| `d296431` | 部署说明补充：云函数超时/内存须在控制台手动设置（实测 config.json 不生效） |
| `5bd3eb2` | 版本升至 2.1.0（app.js、package.json、README、DEPLOYMENT） |

本地检查：`npm run check` 通过，`npm test` 30 项全部通过。

## 三、未提交的改动（重要）

- 无代码改动。仅本文档 `HANDOVER.md` 在收尾时提交。
- `cloudfunctions/adminOps/config.json` 曾改为 `{ "timeout": 60, "memorySize": 512 }`，已还原为 `{}`：实测该文件里的 timeout、memorySize 不生效，超时和内存只能在云控制台手动设置，故不提交此改动。
- 原有未跟踪文件（`.backups/`、`.claude/`、`tasks/`、`deploy-fix.ps1`、`_shared/attendance.js.bak`）一直没有动，也没有提交。

## 四、云端部署状态

- `adminOps`：已用 `inc-deploy` 部署，并选“云端安装依赖”；超时/内存已由用户在云控制台手动改为 60s/512M（控制台曾显示 3s/256M，证实 config.json 不生效）。含旧事件兼容的最新 `adminOps` 已部署，真机导出“全部”验证通过。
- `login`、`checkin`、`updateUserInfo`：用户反馈已部署完成。
- **前端待上传**：版本号改为 2.1.0 只在本地，需在开发者工具上传体验版/正式版后，“我的 → 关于系统”才显示 v2.1.0。
- 移除成员已真机验证通过：被移除成员无法登录和打卡，列表不显示，`users` 带 `removed: true`，导出仍含其历史记录并标注“（已移除）”；软删除不改 `registeredCount`（代码确认：仅 `auth.js` 首次登录递增、`db.js` 初始化重置，`removeMember` 不碰）。
- 我不能操作云端数据库和控制台，部署与真机验收均由用户执行。

## 五、当前未解决的问题

**导出失败（已解决）**：管理页点导出，弹出“网络或云服务调用失败，请重试”。该提示只在 `wx.cloud.callFunction` 本身抛错时出现，说明函数没有正常返回。

当时的判断（结论：超时是主因，控制台手动设为 60s/512M 后导出正常）：
1. 最可能是默认 3 秒超时：首次加载 exceljs/docx 并生成文件耗时较长。已在本地改 config.json，待部署。
2. 其次是依赖未在云端装好（部署包仅 11.5 KB，没带 node_modules，依赖靠云端安装）。
3. 还可能是 `export.js` 里 `require('wx-server-sdk')` 得到的实例与 index.js 初始化的不是同一份配置，或云存储上传权限问题。

另：之前的“Component is not found in path wx://not-found”和界面无法显示，清缓存后已恢复，确认是开发者工具状态问题，不是代码问题。

## 六、已知缺口

1. （已修复：提交 `f234ebf`，真机导出“全部”已验证旧事件行有值）原问题：导出不兼容 `type: in/out` 旧事件。线上约 89 条记录中约 51 条是旧事件，当前 `export.js` 只读 checkInTime/clockIn 等字段，这类行的时间会是空的。建议在云端移植或复用 `services/RecordModel.js` 的配对逻辑，并加旧事件测试。
2. 前端按钮测试（`onRemoveMember`、导出按钮）**刻意不做**。这两处各只有一个调用方，断言内容只是参数名、提示文字和标志位复位，属于源码里直接可见的事实；真实失败模式（部署状态、云端依赖、真机打开文档）测试都覆盖不到。触发条件：这两个函数开始被频繁改动或出现第二个调用方时再补。
3. 云存储 `exports/` 目录会累积导出文件，需要定期清理（DEPLOYMENT.md 已提示）。
4. 同事提出的另一种方案（独立 exportRecords 云函数、base64 返回、不走云存储）可作备选：导出失败持续时可考虑，它避免云存储权限和清理问题，但受返回值约 1MB 限制。

## 七、下一步（建议顺序）

1. （已完成）用户重新部署 `adminOps`（云端安装依赖），命令：
   `"D:/usually/微信web开发者工具/cli.bat" cloud functions inc-deploy --env cloud1-d4g22few1dfa58dd6 --name adminOps --file . --project C:/Users/星耀14/Documents/wx_program/miniprogram`
   并在云开发控制台确认 adminOps 的依赖状态、超时、内存。
2. （已完成）真机再试导出（先选“近一周”，Excel 和 Word 各一次）。若仍失败，从云控制台日志取 adminOps 的报错原文，按报错定位。
3. （已完成，`f234ebf`）导出成功后，修复旧事件兼容并补测试，单独提交。
4. （已砍掉）补前端测试。按奥卡姆剃刀原则不加，理由见第六章第 2 条。
5. （已完成）真机验证移除成员：测试账号被移除后无法登录/打卡，列表不显示，云库 users 带 removed: true，导出仍含其历史记录并标注“（已移除）”。
6. （已完成，`5bd3eb2`）版本号升至 2.1.0。
7. 合并到 main 与推送由用户决定。不自动合并或推送。

## 八、规则与注意事项

- 云函数共享代码只改 `cloudfunctions/_shared/`，改后执行 `npm run sync:cloud`，再 `npm run check`、`npm test`。不要手改各云函数目录里的副本。
- 代码风格：两空格、单引号、分号、行宽 100（.prettierrc.json）。
- 提交说明必须写明日期、目的、修改内容。
- 对云端的写入（部署、数据库）先征得用户确认。不要在控制台手动删用户文档，避免 security_state 的 adminCount/registeredCount 与实际不一致。
- 软删除时 registeredCount 不递减（用户文档仍保留），这是与最初规划的唯一差异。
- 导出文件含姓名和手机号，分享需注意。

## 九、回退方法

回到备份点：`git reset --hard backup-before-export-delete`（会丢弃未提交改动，执行前先与用户确认）。线上云函数需另行恢复旧版本。
