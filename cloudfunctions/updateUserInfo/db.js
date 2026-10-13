// 此模块在部署前复制到各云函数目录，禁止云函数跨目录 require。
const crypto = require('crypto');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const role = (user) =>
  user && (user.role ? user.role === 'admin' : user.isAdmin === true) ? 'admin' : 'member';
const clean = (user) => ({
  ...user,
  openid: user._openid,
  name: user.realName || user.name || '',
  role: role(user),
  isAdmin: role(user) === 'admin'
});
async function optional(ref) {
  try {
    const result = await ref.get();
    return result.data || null;
  } catch (e) {
    if (/document.*(not exist|not found)|文档不存在/i.test(e.message || e.errMsg || ''))
      return null;
    throw e;
  }
}
async function all(db, collection, query = {}) {
  const items = [];
  while (true) {
    const page = await db
      .collection(collection)
      .where(query)
      .orderBy('_id', 'asc')
      .skip(items.length)
      .limit(100)
      .get();
    items.push(...page.data);
    if (page.data.length < 100) return items;
  }
}
async function userFor(db, openid) {
  const result = await db.collection('users').where({ _openid: openid }).limit(2).get();
  if (result.data.length > 1) throw new Error('用户身份记录重复，请管理员先处理');
  return result.data[0] || null;
}
async function requireAdmin(db, openid) {
  const user = await userFor(db, openid);
  if (role(user) !== 'admin') throw new Error('无管理员权限');
  return user;
}
async function initializeRoles(db) {
  const ref = db.collection('security_state').doc('roles');
  if (await optional(ref)) return;
  // 部署时先收紧 users 写权限；所有角色变更统一争用该文档。
  const users = await all(db, 'users');
  try {
    await db.collection('security_state').add({
      data: {
        _id: 'roles',
        adminCount: users.filter((u) => role(u) === 'admin').length,
        registeredCount: users.length
      }
    });
  } catch (e) {
    if (!/duplicate|E11000|already exist/i.test(e.message || e.errMsg || '')) throw e;
  }
}

module.exports = { hash, role, clean, optional, all, userFor, requireAdmin, initializeRoles };
