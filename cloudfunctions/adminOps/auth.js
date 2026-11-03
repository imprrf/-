const { hash, role, clean, optional, userFor, assertActive, initializeRoles } = require('./db');
async function login(db, openid, now) {
  await initializeRoles(db);
  // 事务外快速检查,优化已存在用户的性能
  const previous = await userFor(db, openid);
  const user = await db.runTransaction(async (tx) => {
    const stateRef = tx.collection('security_state').doc('roles');
    const state = await optional(stateRef);
    if (!state) throw new Error('角色状态未初始化');
    // 🔥 关键修复: 事务内重新检查该 openid 的用户,防止并发创建重复身份
    const existingUsers = await tx.collection('users').where({ _openid: openid }).limit(2).get();
    // 检测数据异常 (不应该有重复的 openid)
    if (existingUsers.data.length > 1) {
      throw new Error('用户身份记录重复，请管理员先处理');
    }
    // 用户已存在 - 只更新登录时间
    if (existingUsers.data.length === 1) {
      const existing = existingUsers.data[0];
      assertActive(existing);
      await tx.collection('users').doc(existing._id).update({ data: { lastLoginTime: now } });
      return { ...existing, lastLoginTime: now };
    }
    // 用户不存在 - 创建新用户
    // 继续使用确定性 ID (利用数据库唯一性约束作为额外保护)
    const id = previous ? previous._id : `user_${hash(openid)}`;
    const ref = tx.collection('users').doc(id);
    // 防御性检查: 确保 doc ID 未被占用 (理论上不应该发生)
    const byId = await optional(ref);
    if (byId) {
      // ID 冲突但 openid 查询未发现 - 数据异常或严重并发冲突
      throw new Error('用户 ID 冲突，请联系管理员');
    }
    // 创建新用户 (逻辑保持不变)
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
  assertActive(user);
  const data = profileFields(event.profile || {});
  // 返回更新后重新读取的权威角色，不能把客户端角色回写到缓存。
  await db
    .collection('users')
    .doc(user._id)
    .update({ data: { ...data, updateTime: now } });
  return { success: true, user: clean(await userFor(db, openid)) };
}

module.exports = { login, updateProfile, profileFields };
