const { login, updateProfile, profileFields } = require('./auth');
const { checkin, locationAudit, dateParts } = require('./attendance');
const { adminOps } = require('./admin');
const { role } = require('./db');

function handler(name, cloud) {
  return async (event = {}) => {
    try {
      const openid = cloud.getWXContext().OPENID;
      if (!openid) throw new Error('请通过小程序登录');
      const db = cloud.database();
      const now = Date.now();
      const operations = { checkin, updateUserInfo: updateProfile, adminOps };
      return await (name === 'login'
        ? login(db, openid, now)
        : operations[name](db, openid, event, now));
    } catch (error) {
      console.error(`${name} failed`, error.code || error.errCode || 'operation_error');
      return { success: false, message: error.message || '云端操作失败' };
    }
  };
}

module.exports = {
  handler,
  login,
  checkin,
  updateProfile,
  adminOps,
  role,
  locationAudit,
  dateParts,
  profileFields
};
