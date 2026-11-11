const { hash, optional, all, userFor } = require('./db');
function dateParts(now) {
  const iso = new Date(now + 8 * 3600000).toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
    minute: Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16))
  };
}
function locationAudit(location, config) {
  if (!location) return { locationUnavailable: true, distance: null, outOfRange: false };
  const { latitude, longitude, accuracy } = location;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))
  )
    throw new Error('定位数据无效');
  const center = config.location;
  if (
    !center ||
    !Number.isFinite(center.latitude) ||
    !Number.isFinite(center.longitude) ||
    Math.abs(center.latitude) > 90 ||
    Math.abs(center.longitude) > 180 ||
    !Number.isFinite(center.radius) ||
    center.radius <= 0
  )
    throw new Error('考勤地点配置无效');
  const rad = (value) => (value * Math.PI) / 180;
  const a =
    Math.sin(rad(center.latitude - latitude) / 2) ** 2 +
    Math.cos(rad(latitude)) *
      Math.cos(rad(center.latitude)) *
      Math.sin(rad(center.longitude - longitude) / 2) ** 2;
  const distance = Math.round(
    6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  );
  return {
    location: { latitude, longitude, accuracy: accuracy || 0 },
    locationUnavailable: false,
    distance,
    outOfRange: distance > center.radius
  };
}
function visitResult(result) {
  return {
    ...result,
    message: `${result.type === 'in' ? '进入' : '离开'}打卡成功 (${result.time})`
  };
}
async function checkin(db, openid, event, now) {
  if (typeof event.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(event.requestId))
    throw new Error('打卡请求标识无效');
  const receiptId = hash(`${openid}:${event.requestId}`);
  // ✅ 优化 1: 提前检查收据，如果存在直接返回（减少后续查询）
  const previousReceipt = await optional(db.collection('checkin_requests').doc(receiptId));
  if (previousReceipt) return visitResult(previousReceipt.result);
  // ✅ 优化 2: 并行查询 user + config（从串行变并行）
  const [user, config] = await Promise.all([
    userFor(db, openid),
    optional(db.collection('config').doc('main_config'))
  ]);
  if (!user) throw new Error('请先登录');
  if (!config) throw new Error('请管理员先保存考勤配置');
  const audit = locationAudit(event.location, config);
  const { date, time } = dateParts(now);
  // ✅ 优化 3: 只在事务内查询状态，不在事务外查询 existing
  const stateId = hash(`${openid}:${date}`);
  // requestId 收据永久保留，网络超时后的重试不会变成下一次签退。
  return db.runTransaction(async (tx) => {
    const receiptRef = tx.collection('checkin_requests').doc(receiptId);
    const receipt = await optional(receiptRef);
    if (receipt) return visitResult(receipt.result);
    const stateRef = tx.collection('checkin_state').doc(stateId);
    let state = await optional(stateRef);
    // ✅ 优化 4: 状态不存在时才查询 existing 初始化（懒加载）
    if (!state) {
      const existing = await tx.collection('records').where({ _openid: openid, date }).get();
      const incomplete = existing.data
        .filter((r) => r.status === 'Incomplete')
        .sort((a, b) => (b.checkInTimestamp || 0) - (a.checkInTimestamp || 0))[0];
      state = {
        sequence: existing.data.length,
        activeId: (incomplete && incomplete._id) || '',
        lastAt: 0
      };
    }
    // 防抖已取消，允许连续快速打卡
    const activeRef = state.activeId ? tx.collection('records').doc(state.activeId) : null;
    const active = activeRef ? await optional(activeRef) : null;
    let recordId, record, type;
    if (active && active.status === 'Incomplete') {
      recordId = state.activeId;
      type = 'out';
      const durationMinutes = Math.max(0, Math.floor((now - active.checkInTimestamp) / 60000));
      record = {
        ...active,
        checkOutTime: time,
        checkOutTimestamp: now,
        durationMinutes,
        totalWorkTime: `${Math.floor(durationMinutes / 60)}h${durationMinutes % 60}m`,
        status: 'Complete',
        checkOutDistance: audit.distance,
        checkOutOutOfRange: audit.outOfRange,
        outOfRange: !!(active.outOfRange || audit.outOfRange),
        locationUnavailable: !!(active.locationUnavailable || audit.locationUnavailable),
        updateTime: now
      };
      if (audit.location) record.checkOutLocation = audit.location;
      // set 整份文档：旧的 null 位置字段也能替换，不使用嵌套字段魔法。
      const nextRecord = { ...record };
      delete nextRecord._id;
      await activeRef.set({ data: nextRecord });
      state.activeId = '';
    } else {
      type = 'in';
      state.sequence++;
      recordId = `record_${hash(`${openid}:${date}:${state.sequence}`)}`;
      record = {
        _openid: openid,
        schemaVersion: 2,
        date,
        timestamp: now,
        userName: user.realName || user.name || '微信用户',
        userPhone: user.phone || '',
        checkInTime: time,
        checkInTimestamp: now,
        status: 'Incomplete',
        durationMinutes: 0,
        distance: audit.distance,
        checkInDistance: audit.distance,
        checkInOutOfRange: audit.outOfRange,
        outOfRange: audit.outOfRange,
        locationUnavailable: audit.locationUnavailable,
        createTime: now,
        updateTime: now
      };
      if (audit.location) record.checkInLocation = audit.location;
      await tx.collection('records').doc(recordId).set({ data: record });
      state.activeId = recordId;
    }
    const result = {
      success: true,
      type,
      time,
      record: { ...record, _id: recordId },
      message: `${type === 'in' ? '进入' : '离开'}打卡成功 (${time})`
    };
    const nextState = { ...state, _openid: openid, date, lastAt: now, lastResult: result };
    delete nextState._id;
    await stateRef.set({ data: nextState });
    const receiptData = { _openid: openid, createdAt: now, result };
    delete receiptData._id;
    await receiptRef.set({ data: receiptData });
    return result;
  });
}

module.exports = { checkin, locationAudit, dateParts };
