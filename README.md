# 考勤打卡小程序

基于微信小程序 + 云开发的考勤打卡系统，支持定位打卡、打卡记录查询、管理员后台等功能。

## 技术栈

- 微信小程序原生框架（JS，非 TypeScript）
- 微信云开发（云数据库 + 云函数）
- 本地存储降级方案（云服务不可用时自动切换到 `wx.setStorageSync`）

## 项目结构

```
miniprogram/
├── app.js                  # 全局逻辑：登录、云开发初始化、定位、全局工具方法
├── app.json                # 小程序页面路由、权限、tabBar 配置
├── cloudfunctions/
│   ├── getOpenid/          # 获取用户 openid
│   └── updateUserInfo/     # 更新用户信息（含手机号解密）
├── pages/
│   ├── index/               # 打卡主页
│   ├── records/              # 打卡记录查询
│   ├── mine/                 # 个人中心
│   └── admin/                 # 管理员后台（配置、成员管理、位置设置、班次设置）
└── services/
    ├── DbService.js         # 数据访问层（云数据库 / 本地存储双模式）
    ├── CheckinService.js    # 打卡业务逻辑
    └── ConfigService.js     # 考勤配置（工作时间、打卡地点）管理
```

## 本地开发

1. 用微信开发者工具打开 `miniprogram` 目录（注意：是这个子目录，不是项目根目录）
2. AppID 选择"测试号"（`project.config.json` 里配置的 `appid` 为 `touristappid`，游客模式）
3. 云开发环境 ID 配置在 `app.js` 的 `initCloudSafely()` 方法里（`cloud1-d4g22few1dfa58dd6`）

## 已知问题

详见 [AUDIT.md](./AUDIT.md)，重点关注"严重问题"章节（打卡距离校验、数据库权限、管理员鉴权均只在前端做，未经服务端强制校验）。

## Git 分支说明（2026-10-08 梳理）

- `main`：当前主线，开发到 2026-09-14，是时间上最新的分支
- `feature/multi-checkin`：早期分支，停更于 2026-06-29，与 `main` 历史已分叉（无共同祖先，推测仓库曾被重建），**不建议继续在此分支开发**，内容已过时
- `v1.0.2`：标记在 2026-10-08 跨设备部署时的基线提交，用于回滚参考
