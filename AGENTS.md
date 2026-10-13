# 项目续接要点

- 沟通语言中文。微信小程序项目，实际 Git 在本目录；外层 wx_program 另有 Git，不自动更新其 gitlink。
- 当前业务是工作室自由到访，不是上下班管理：任意时间允许打卡，不计算或展示迟到、早退、应到、缺勤；记录进入、离开、停留时长和实际到访。历史字段保留，距离超范围是软校验。
- 云端部署由用户操作。环境 ID 为 cloud1-d4g22few1dfa58dd6；配置集合 config（单数），文档 main_config。
- 开始续接先读 SESSION_PROGRESS.md 和 FIX_PLAN.md 顶部。详细备份、已验证部署结果、错误排查和第 5～8 步都在 SESSION_PROGRESS.md，不在此重复流水账。
- 2026-10-13 停点：第 5、6、7 步已验收，数据库权限已按 database.rules.json 收紧（config 用控制台预设“所有用户可读”）。剩第 8 步：越权探测、云函数线上版本核对、备份与 Git 收尾。微信手机号接口无权限（jsapi no permission 102），手机号只能手动输入。
- 云平台 HTTP 200 不等于业务成功，检查 RetMsg.success。本地模型测试也不能替代真实 SDK 约束/事务/权限验收。
- cloudfunctions/_shared 是源代码，部署目录是生成副本；改源后运行 node scripts/sync-cloud.js、npm run check、npm test。
- 现有函数更新用 inc-deploy，不删除重建。CLI 必须显式 --project；用户长命令粘贴易截断，使用短 PowerShell 变量逐行指导，每一步确认后再继续。
- 不清空生产 users/records，不随意重建 security_state/roles 或手工改管理员计数。不得将完整 OpenID、手机号或其他敏感信息记入文档。
