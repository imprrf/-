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
  return { ...result, message: `${result.type === 'in' ? '进入' : '离开'}打卡成功 (${result.time})` };
}
async function checkin(db, openid, event, now) {
  if (typeof event.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(event.requestId))
    throw new Error('打卡请求标识无效');
  const user = await userFor(db, openid);
  if (!user) throw new Error('请先登录');
  const receiptId = hash(`${openid}:${event.requestId}`);
  const previousReceipt = await optional(db.collection('checkin_requests').doc(receiptId));
  // 已提交请求的重试不受之后的配置变动或定位失败影响。
  if (previousReceipt) return visitResult(previousReceipt.result);
  const config = await optional(db.collection('config').doc('main_config'));
  if (!config) throw new Error('请管理员先保存考勤配置');
  const audit = locationAudit(event.location, config);
  const { date, time } = dateParts(now);
  // 工作室自由到访：不读取排班时间，不计算迟到或早退。
  const existing = await all(db, 'records', { _openid: openid, date });
  const incomplete = existing
    .filter((r) => r.status === 'Incomplete')
    .sort((a, b) => (b.checkInTimestamp || 0) - (a.checkInTimestamp || 0))[0];
  const stateId = hash(`${openid}:${date}`);
  // requestId 收据永久保留，网络超时后的重试不会变成下一次签退。
  return db.runTransaction(async (tx) => {
    const receiptRef = tx.collection('checkin_requests').doc(receiptId);
    const receipt = await optional(receiptRef);
    if (receipt) return visitResult(receipt.result);
    const stateRef = tx.collection('checkin_state').doc(stateId);
    const state = (await optional(stateRef)) || {
      sequence: existing.length,
      activeId: (incomplete && incomplete._id) || '',
      lastAt: 0
    };
    // 并发点击即使使用不同 requestId，也不能把刚创建的签到立即签退。
    if (now - state.lastAt < 5000 && state.lastResult) {
      const result = visitResult(state.lastResult);
      await receiptRef.set({
        data: { _openid: openid, createdAt: now, result }
      });
      return result;
    }
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
      delete record._id;
      await activeRef.set({ data: record });
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
    await stateRef.set({
      data: { ...state, _openid: openid, date, lastAt: now, lastResult: result }
    });
    await receiptRef.set({ data: { _openid: openid, createdAt: now, result } });
    return result;
  });
}

module.exports = { checkin, locationAudit, dateParts };
