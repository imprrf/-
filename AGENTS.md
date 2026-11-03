# 项目续接要点

- 沟通语言中文。微信小程序项目，实际 Git 在本目录；外层 wx_program 另有 Git，不自动更新其 gitlink。
- 业务是工作室自由到访，不是上下班管理：任意时间允许打卡，不计算或展示迟到、早退、应到、缺勤；记录进入、离开、停留时长和实际到访。历史字段保留，距离超范围是软校验。
- 云端部署由用户操作。环境 ID `cloud1-d4g22few1dfa58dd6`；配置集合 `config`（单数），文档 `main_config`。
- 文档只有两份：`README.md`（架构、数据模型、部署、验收、已知限制）和本文件（续接规则）。不要再繁衍过程流水账。
- `cloudfunctions/_shared` 是唯一源码，部署目录里的同名文件是生成副本。改源后必须 `npm run sync:cloud` → `npm run check` → `npm test`。不要手改副本。
- 现有函数更新用 `inc-deploy`，不删除重建。CLI 必须显式 `--project`；长命令易被终端截断，用短 PowerShell 变量分步执行，每步确认后再继续。
- `adminOps` 的超时和内存只能在云开发控制台手动设置（`config.json` 里的 `timeout`、`memorySize` 实测无效）：60 秒 / 512MB，否则导出报"网络或云服务调用失败"。
- 不清空生产 `users`/`records`，不随意重建 `security_state`/`roles` 或手工改管理员计数。不得把完整 OpenID、手机号或其它敏感信息写进文档或提交。
- 云平台 HTTP 200 不等于业务成功，检查 `RetMsg.success`。本地内存数据库测试不能替代真实 SDK 的事务、权限和并发验收。
- 对云端的写入（部署、数据库、存储）先征得用户确认。不自动合并 main、不自动推送。

## 当前状态（2026-11-04）

- 版本 v2.1.0 已合并到本地 `main`，分支 `feature/export-and-remove-member` 保留；均未推送。
- 已完成：导出打卡记录（Excel/Word×三种范围）、移除成员（软删除）、导出兼容 `type: in/out` 旧事件、关于系统文案、文档重构。
- 真机已验证：导出全部范围成功且旧事件行有值；被移除成员无法登录打卡、列表不显示、`users` 带 `removed: true`、导出仍含其历史并标注"（已移除）"、`registeredCount` 不变。
- 待办：用户上传前端体验版/正式版（"关于系统"才会显示 v2.1.0）；决定是否推送远端。
- 回退标签：`backup-before-export-delete`（`2d566e9`）、`v1.0.2`。
