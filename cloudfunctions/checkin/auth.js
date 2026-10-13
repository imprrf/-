const { hash, role, clean, optional, userFor, initializeRoles } = require('./db');
async function login(db, openid, now) {
  await initializeRoles(db);
  const previous = await userFor(db, openid);
  const id = previous ? previous._id : `user_${hash(openid)}`;
  const user = await db.runTransaction(async (tx) => {
    const stateRef = tx.collection('security_state').doc('roles');
    const state = await optional(stateRef);
    if (!state) throw new Error('角色状态未初始化');
    const ref = tx.collection('users').doc(id);
    const existing = await optional(ref);
    if (existing) {
      await ref.update({ data: { lastLoginTime: now } });
      return { ...existing, lastLoginTime: now };
    }
    const isFirst = state.registeredCount === 0;
    const data = {
      _openid: openid,
      name: '微信用户',
      realName: '',
      avatar: '',
      phone: '',
      role: isFirst ? 'admin' : 'member',
      isAdmin: isFirst,
      createTime: now,
      lastLoginTime: now
    };
    await ref.set({ data });
    await stateRef.update({
      data: {
        registeredCount: state.registeredCount + 1,
        adminCount: state.adminCount + (isFirst ? 1 : 0)
      }
    });
    return { ...data, _id: id };
  });
  return { success: true, openid, user: clean(user) };
}
function profileFields(input) {
  const data = {};
  for (const key of ['name', 'realName', 'phone', 'avatar']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string') throw new Error('资料字段类型不正确');
    data[key] = input[key].trim();
    if (data[key].length > (key === 'avatar' ? 2048 : 80)) throw new Error('资料字段过长');
  }
  if (data.name !== undefined) {
    if (!data.name) throw new Error('请输入姓名');
    data.realName = data.name;
  }
  if (data.phone && !/^1\d{10}$/.test(data.phone)) throw new Error('请输入正确的手机号');
  return data;
}
async function updateProfile(db, openid, event, now) {
  const user = await userFor(db, openid);
  if (!user) throw new Error('请先登录');
  const data = profileFields(event.profile || {});
  // 返回更新后重新读取的权威角色，不能把客户端角色回写到缓存。
  await db
    .collection('users')
    .doc(user._id)
    .update({ data: { ...data, updateTime: now } });
  return { success: true, user: clean(await userFor(db, openid)) };
}

module.exports = { login, updateProfile, profileFields };
