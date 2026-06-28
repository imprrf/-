const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { avatarUrl, nickName, phoneData } = event;

  // 1. 如果传了手机号加密数据，解密（可选）
  let phoneNumber = null;
  if (phoneData) {
    try {
      const { encryptedData, iv } = phoneData;
      const result = await cloud.openapi.security.phoneNumber({ encryptedData, iv });
      phoneNumber = result.phoneInfo.phoneNumber;
    } catch (e) {
      console.warn('手机号解密失败，忽略');
    }
  }

  // 2. 查询或创建用户
  const users = db.collection('users');
  let user = null;
  try {
    const existing = await users.where({ _openid: openid }).get();
    if (existing.data.length > 0) {
      // 更新信息
      const updateData = { avatarUrl, nickName, updateTime: new Date() };
      if (phoneNumber) updateData.phone = phoneNumber;
      await users.doc(existing.data[0]._id).update({ data: updateData });
      user = { ...existing.data[0], ...updateData };
    } else {
      const newUser = {
        _openid: openid,
        avatarUrl,
        nickName,
        phone: phoneNumber || '',
        realName: '', // 可后续填写
        createTime: new Date(),
        updateTime: new Date()
      };
      const addRes = await users.add({ data: newUser });
      user = { _id: addRes._id, ...newUser };
    }
  } catch (e) {
    console.error('数据库操作失败', e);
    return { success: false, errMsg: '数据库错误' };
  }

  // 3. 查询是否为管理员
  let isAdmin = false;
  try {
    const adminRes = await db.collection('admins').where({ _openid: openid }).get();
    isAdmin = adminRes.data.length > 0;
  } catch (e) { /* 忽略 */ }

  return {
    success: true,
    user: user,
    isAdmin: isAdmin
  };
};