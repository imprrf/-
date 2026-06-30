// cloudfunctions/getOpenid/index.js
const cloud = require('wx-server-sdk')

// 初始化当前云环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  // 从微信上下文中直接获取用户的真实 OPENID
  const wxContext = cloud.getWXContext()

  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  }
}