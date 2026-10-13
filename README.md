# 考勤打卡小程序

微信小程序原生 JS + 微信云开发，支持同日多次进出、距离软校验、迟到早退统计和成员管理。

## 模块

- `app.js`：云服务初始化、权威身份缓存、登录、资料保存与定位。
- `services/DbService.js`：云数据库按 20 条循环分页，未指定 limit 时读全量；openid 双向映射；本地降级仅支持等值和嵌套字段等值。
- `services/RecordModel.js`：唯一的记录展示适配、时长和北京时间处理；旧数据只读兼容。
- `services/CheckinService.js`：本人记录查询、成员授权查询和共享统计口径。
- `services/CloudService.js`：云函数调用、业务拒绝与网络失败区分、管理员分页查询。
- `cloudfunctions/_shared/`：db（身份与锁状态）、auth（登录与资料）、attendance（打卡）、admin（管理操作）、core（调用上下文与错误边界）。修改后执行 `npm run sync:cloud` 复制到各部署目录，云函数不会跨目录 require。
- `cloudfunctions/login/`、`checkin/`、`adminOps/`、`updateUserInfo/`：独立部署的云函数。
- `pages/index/`、`records/`、`mine/`、`admin/`：打卡、记录、个人中心和管理员页面；班次空壳页已移除。

## 开发与检查

用微信开发者工具打开本目录。`project.config.json` 当前为游客 AppID，云环境在 `app.js`；真实上线需配置有权限的 AppID 和云环境。

```bash
npm run sync:cloud
npm run check
npm test
```

以上检查只需 Node.js。代码格式采用两空格、单引号、分号，职责按模块拆分；测试覆盖真实问题和权限边界。本地云数据库模型测试不代替微信真机或云端事务验收。

## 业务约定与上线

详见 [记录结构](./RECORD_SCHEMA.md)、[修复计划](./FIX_PLAN.md) 和 [部署与回归](./DEPLOYMENT.md)。本轮本地代码已加入服务端鉴权和写入入口，**尚未部署云函数、应用权限规则或完成云端验收**。新前端必须配套部署新的四个云函数。

时间统一为北京时间。缺卡仅统计截至今天的周一到周五，出勤按日期去重，周末出勤不能抵扣工作日缺卡；当前不纳入法定节假日、调休，不支持跨夜班次。距离超过半径不拒绝打卡；没有定位时记录“定位缺失”，管理员可查看异常标记。

打卡、资料、角色和配置写入只走云函数。云服务失败时显示失败，不降级为本地写入成功。DbService 的本地存储兼容仅供离线数据读取和单元验证，不能作为可信身份、权限或考勤结果。

## Git

实际仓库位于本目录，外层 `wx_program` 另有仓库并以 gitlink 指向小程序。本轮在 `fix/security-hardening` 上修改，起点为 `a4e2e12`。既有 `main` 跟踪 `origin/feature/multi-checkin` 且已分叉，不自动合并或推送。`v1.0.2` 保留为历史回滚参考，本轮更准确的恢复基线与完整本地备份见 DEPLOYMENT.md。
