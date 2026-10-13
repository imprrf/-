const {
  hash,
  role,
  clean,
  optional,
  all,
  userFor,
  requireAdmin,
  initializeRoles
} = require('./db');
const { locationAudit } = require('./attendance');
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
function configFields(input) {
  const data = {};
  if (input.location !== undefined) {
    const center = input.location;
    if (!center || typeof center.name !== 'string' || center.name.length > 200)
      throw new Error('考勤地点无效');
    locationAudit({ latitude: center.latitude, longitude: center.longitude }, { location: center });
    data.location = {
      latitude: center.latitude,
      longitude: center.longitude,
      radius: center.radius,
      name: center.name
    };
  }
  return data;
}
async function adminOps(db, openid, event, now) {
  const actor = await requireAdmin(db, openid);
  if (event.action === 'auditRecordSchemas') {
    const records = await all(db, 'records');
    const counts = {
      total: records.length,
      schemaV2: 0,
      formatB: 0,
      formatA: 0,
      legacyEvents: 0,
      unknown: 0
    };
    for (const record of records) {
      if (record.schemaVersion === 2) counts.schemaV2++;
      else if (record.checkInTime || record.checkInTimestamp) counts.formatB++;
      else if (record.clockIn || record.clockOut) counts.formatA++;
      else if (record.type === 'in' || record.type === 'out') counts.legacyEvents++;
      else counts.unknown++;
    }
    return { success: true, counts };
  }
  if (
    event.action === 'listUsers' ||
    event.action === 'listAllRecords' ||
    event.action === 'listRoleLogs'
  ) {
    const collection = {
      listUsers: 'users',
      listAllRecords: 'records',
      listRoleLogs: 'roleLogs'
    }[event.action];
    const query = {};
    if (collection === 'records') {
      if (event.openid !== undefined) {
        if (typeof event.openid !== 'string' || !event.openid) throw new Error('成员标识无效');
        query._openid = event.openid;
      }
      if (event.startDate || event.endDate) {
        if (
          !validDate(event.startDate) ||
          !validDate(event.endDate) ||
          event.startDate > event.endDate
        )
          throw new Error('日期筛选无效');
        query.date = db.command.gte(event.startDate).and(db.command.lte(event.endDate));
      }
    }
    const limit = Math.min(100, Math.max(1, Number(event.limit) || 100));
    const offset = Math.max(0, Number(event.offset) || 0);
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) throw new Error('分页参数无效');
    const response = await db
      .collection(collection)
      .where(query)
      .orderBy('_id', 'asc')
      .skip(offset)
      .limit(limit)
      .get();
    return {
      success: true,
      items: collection === 'users' ? response.data.map(clean) : response.data,
      hasMore: response.data.length === limit
    };
  }
  if (event.action === 'updateConfig') {
    const data = configFields(event.config || {});
    await db.runTransaction(async (tx) => {
      const actorNow = await optional(tx.collection('users').doc(actor._id));
      if (role(actorNow) !== 'admin') throw new Error('无管理员权限');
      const ref = tx.collection('config').doc('main_config');
      const current = (await optional(ref)) || {};
      const next = { ...current, ...data, updateTime: now };
      if (!next.location) throw new Error('请设置考勤地点');
      delete next._id;
      await ref.set({ data: next });
    });
    return {
      success: true,
      config: await optional(db.collection('config').doc('main_config'))
    };
  }
  if (event.action !== 'setRole') throw new Error('未知管理操作');
  if (!['admin', 'member'].includes(event.role) || typeof event.openid !== 'string')
    throw new Error('角色参数无效');
  if (event.openid === openid && event.role === 'member')
    throw new Error('不能撤销自己的管理员权限');
  await initializeRoles(db);
  const target = await userFor(db, event.openid);
  if (!target) throw new Error('成员不存在');
  await db.runTransaction(async (tx) => {
    const stateRef = tx.collection('security_state').doc('roles');
    const state = await optional(stateRef);
    const actorNow = await optional(tx.collection('users').doc(actor._id));
    if (role(actorNow) !== 'admin') throw new Error('无管理员权限');
    const ref = tx.collection('users').doc(target._id);
    const targetNow = await optional(ref);
    if (!targetNow) throw new Error('成员不存在');
    const oldRole = role(targetNow);
    if (oldRole === event.role) return;
    const adminCount = state.adminCount + (event.role === 'admin' ? 1 : -1);
    if (adminCount < 1) throw new Error('不能撤销最后一个管理员');
    await ref.update({
      data: {
        role: event.role,
        isAdmin: event.role === 'admin',
        updatedAt: now
      }
    });
    await stateRef.update({ data: { adminCount } });
    const logId = hash(`${openid}:${target._id}:${now}:${event.role}`);
    await tx
      .collection('roleLogs')
      .doc(logId)
      .set({
        data: {
          actorOpenid: openid,
          actorName: actorNow.name || '',
          targetOpenid: event.openid,
          targetName: targetNow.name || '',
          oldRole,
          newRole: event.role,
          action: event.role === 'admin' ? 'grant_admin' : 'revoke_admin',
          createdAt: now
        }
      });
  });
  return { success: true };
}

module.exports = { adminOps };
