# 代码审计记录

> 审计日期：2026-10-08
> 审计范围：`miniprogram/` 目录，基于 git tag `v1.0.2`（commit `391fa07`）
> 说明：本次审计不做任何代码改动，仅记录发现的问题，供后续迭代参考。

## 一、严重问题（安全/数据完整性）

### 1. 打卡距离校验只在前端做，服务端无拦截

`pages/index/index.js` 的 `calculateDistance()` 只用来给用户显示"超出范围"文字提示，`onClock()` 实际写入打卡记录时完全不检查这个距离结果——无论是否超出范围，`db.collection('records').add(...)` 都会直接成功。只要篡改前端定位数据或直接调用云数据库 SDK，就能在任意地点打卡。

**建议**：把距离校验移到云函数里做服务端强制校验，前端校验只作为用户体验提示。

### 2. 云数据库权限被整表放开

`pages/admin/admin.js` 代码注释中明确写到：

> "由于之前你已经在云控制台放开了 records 表的'所有用户可读'，这里便能统揽全局"

这意味着任何登录用户都能直接读取全部员工的打卡记录和位置数据，不需要管理员身份。`pages/admin/userList.js` 里 `db.collection('users').get()` 不带任何 `where` 条件，`users` 表很可能同样是全表可读。

**建议**：在云开发控制台将 `records`、`users` 表权限改为"仅创建者可读写"或自定义安全规则（按 `_openid` 限制）。

### 3. 管理员鉴权完全在前端做，可被绕过

`userList.js` 的 `checkAdmin()`、`admin.js` 的权限判断都只读本地缓存的 `app.globalData.isAdmin`。`onToggleAdmin()` 直接从客户端调用 `db.collection('users').update(...)` 修改自身角色字段。如果数据库权限是开放的（问题2），任何用户理论上可以直接把自己的 `role` 改成 `admin`。

**建议**：管理员授权操作收敛到云函数，由云函数校验"操作者当前是否已是 admin"后再执行写入。

### 4. 新用户注册的管理员判定存在竞态（TOCTOU）

`app.js` 的 `login()`：

```js
const countResult = await db.collection('users').count();
if (countResult.total === 0) {
  userInfo.role = 'admin';
  userInfo.isAdmin = true;
}
```

`count()` 和后续 `add()` 之间没有事务保护。多个新用户几乎同时首次登录时，可能都读到 `total === 0`，都被判定为管理员。实际并发概率低，但属于明确的逻辑缺陷。

## 二、数据模型/逻辑问题

### 5. 两套打卡记录格式并存

`CheckinService.clockIn()` 使用 `clockIn`/`clockOut`/`openid` 字段，经由 `DbService` 读写；`pages/index/index.js` 的 `onClock()` 则绕过 `CheckinService`，直接用 `wx.cloud` 写入另一套 `checkInTime`/`checkOutTime`/`status: 'Incomplete'/'Complete'` 结构。`loadTodayRecords()` 里为兼容两种格式写了大段分支判断。

**建议**：统一数据结构，必要时做一次性数据迁移脚本。

### 6. 迟到/早退字段未实现

`ConfigService` 定义了 `lateMinutes`/`earlyMinutes`，`CheckinService.getStatistics()` 的统计对象里也有 `lateDays`/`earlyDays`，但代码中找不到任何实际判断逻辑——打卡后 `status` 永远硬编码为 `'normal'`，这两个统计字段永远是 0。

### 7. `clockOutLocation` 初始化为空对象的 workaround

`index.js` 注释："初始化为空对象 {}，防止以后更新遇到 null 报错"——这是绕开云数据库对 `null` 字段更新行为的临时处理，而非根因修复，云 SDK 行为变化时容易失效。

## 三、代码卫生问题

### 8. 废弃的错误嵌套目录残留

以下文件 `app.json` 中均未引用，是开发过程中路径写错产生的重复文件，建议删除：

```
pages/admin/pages/admin/periodsSet.js
pages/admin/pages/pages/admin/periodsSet.wxml
services/services/LocationService.js
```

### 9. 调试用 console.log 残留

`app.js`、`pages/index/index.js` 中存在带中文"【调试】"标记的 console.log，部分会打印完整 openid 等标识信息，建议上线前清理。

### 10. 根目录大文件

`wx_program/project-code.txt`（约 9MB）位于项目根目录，疑似整体代码导出留档，非运行所需文件。根目录当前没有 `.gitignore`，仅 `miniprogram/.gitignore` 存在。

### 11. 手机号校验较宽松

`pages/mine/mine.js` 的 `onSaveProfile()` 用 `/^1\d{10}$/` 校验手机号，只验证位数和开头数字，不校验号段，属于宽松校验，一般场景可接受。

## 四、设计上合理的部分

- `app.js` 的 `initCloudSafely()`/`ensureCloudReady()` 对云开发初始化失败做了降级处理，并过滤了开发者工具的网络噪音报错。
- `DbService` 做了云数据库与本地存储的双模式兼容，云服务不可用时自动降级，抽象层设计合理。
- `CheckinService` 将打卡业务逻辑和数据访问分层，职责划分基本清晰（除问题 5 中 `index.js` 绕过它直接操作云数据库的部分）。

## 总结

当前最大风险是**打卡距离校验、数据库权限、角色管理全部只停留在前端**，服务端未做强制校验。如果用于内部小范围、信任员工不会主动作弊的场景，可暂缓处理；若考勤数据有实际考核用途，建议优先处理问题 1-3（服务端校验 + 数据库权限收紧），再逐步处理问题 5-7（数据模型统一、功能补全）。
