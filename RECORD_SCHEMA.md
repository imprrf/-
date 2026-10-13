# 打卡记录约定

新记录 `schemaVersion: 2`，仅由 `checkin` 云函数写入 `records`。日期和时间统一按北京时间（UTC+8）计算，客户端不提供身份、打卡时间、角色或统计结果。

| 字段 | 类型 | 约定 |
|---|---|---|
| `_id` | string | 服务端按用户、日期、当日序号生成确定性 ID |
| `_openid` | string | 来自云函数调用上下文；读取时补充 `openid` 别名 |
| `date` | string | `YYYY-MM-DD`，北京时间 |
| `timestamp` / `checkInTimestamp` | number | 签到时服务端毫秒时间戳 |
| `checkInTime` | string | `HH:mm` |
| `checkOutTimestamp` / `checkOutTime` | number / string | 签退后存在，签到时省略 |
| `checkInLocation` / `checkOutLocation` | object | 有定位时存在；包含 latitude、longitude、accuracy；新记录不写 null 或空对象 |
| `durationMinutes` | number | 完成时长的整分钟数，向下取整；未完成为 0 |
| `totalWorkTime` | string | 签退后写入的显示兼容字段，例如 `8h30m`；统计使用数值字段 |
| `status` | string | `Incomplete` / `Complete`；历史 `Incomplete_Expired` 可读取 |
| `attendanceStatus` | string | `normal` / `late` / `early` / `late_early`，与完成状态分开 |
| `lateMinutes` / `earlyMinutes` | number | 扣除对应宽限后的迟到、早退分钟数，最小为 0 |
| `distance` / `checkInDistance` | number 或 null | 签到到考勤点的距离（米）；缺失定位为 null |
| `checkOutDistance` | number 或 null | 签退时写入 |
| `checkInOutOfRange` / `checkOutOutOfRange` | boolean | 对应打卡距离超过配置半径；签退字段完成时写入 |
| `outOfRange` | boolean | 任一端超范围即为 true；软校验不拒绝打卡 |
| `locationUnavailable` | boolean | 任一端无法定位即为 true，不能用距离 0 表示定位成功 |
| `userName` / `userPhone` | string | 打卡时服务端读取用户资料快照 |
| `createTime` / `updateTime` | number | 服务端毫秒时间戳 |

同日支持多组进出。事务锁定 `checkin_state` 中该用户当天的状态；签到新建一条，签退更新挂起的一条。不同请求在 5 秒内返回上次结果，防止并发签到变成签退。`checkin_requests` 保存请求收据，客户端网络失败后复用请求 ID，跨页面、重启或跨日重试也返回原操作结果。上述两个集合只允许云函数访问。

历史未签退记录在统一读取层按日期判断为“未签退”，不批量改写原始历史记录。旧格式甲和 type=in/out 事件由 `RecordModel` 集中做只读适配；按用户和日期配对，避免混入其他成员的记录。部署后先执行管理员 `auditRecordSchemas` 盘点，迁移方案须依据实际数量决定。

统计按北京时间截至今天的日期计算。出勤、迟到、早退、超范围按日期去重；缺卡为已到达的工作日中没有记录的日期数，周末出勤不抵扣工作日缺卡。当前工作日仅周一到周五，不含法定节假日或调休规则，不支持跨夜班次。当天未结束仍计入工作日，尚未打卡显示缺卡；未来日期不计入。
