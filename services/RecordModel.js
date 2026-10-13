/** 统一记录读取：新写入仅格式乙；旧数据在云端盘点前保留只读适配。 */
function dateStr(date = new Date()) {
  // 考勤业务统一为北京时间，避免设备/云函数时区差异。
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
function durationText(minutes) {
  if (minutes === null || minutes === undefined) return '--';
  return `${Math.floor(minutes / 60)}h${Math.floor(minutes % 60)}m`;
}
function normalize(record) {
  const checkInTime =
    record.checkInTime || record.clockIn || (record.type !== 'out' ? record.time : '') || '';
  const checkOutTime =
    record.checkOutTime || record.clockOut || (record.type === 'out' ? record.time : '') || '';
  const checkInTimestamp =
    record.checkInTimestamp ||
    record.clockInTimestamp ||
    (record.type !== 'out' ? record.timestamp : 0) ||
    0;
  const checkOutTimestamp =
    record.checkOutTimestamp ||
    record.clockOutTimestamp ||
    (record.type === 'out' ? record.timestamp : 0) ||
    0;
  const durationMinutes =
    record.durationMinutes !== undefined
      ? record.durationMinutes
      : checkInTimestamp && checkOutTimestamp
        ? Math.max(0, Math.floor((checkOutTimestamp - checkInTimestamp) / 60000))
        : record.duration || 0;
  const completed =
    !!checkOutTimestamp ||
    (!!checkOutTime && checkOutTime !== '未签退' && checkOutTime !== '漏签退');
  const expired = record.status === 'Incomplete_Expired' || (!completed && record.date < dateStr());
  // 历史迟到/早退字段只保留原数据，不参与工作室到访展示。
  const statusText = completed ? '已离开' : expired ? '未记录离开' : '在工作室';
  return {
    ...record,
    checkInTime,
    checkOutTime,
    checkInTimestamp,
    checkOutTimestamp,
    durationMinutes,
    statusText,
    expired,
    openid: record._openid || record.openid,
    completed,
    durationText: completed ? durationText(durationMinutes) : '--',
    outTime: completed ? checkOutTime : expired ? '未记录离开' : '进行中',
    outOfRange: !!(record.outOfRange || record.checkInOutOfRange || record.checkOutOutOfRange)
  };
}
function normalizeList(records) {
  const sorted = records
    .slice()
    .sort(
      (a, b) => (a.timestamp || a.checkInTimestamp || 0) - (b.timestamp || b.checkInTimestamp || 0)
    );
  const result = [];
  const pendingByOwnerDate = new Map();
  for (const record of sorted) {
    const key = `${record._openid || record.openid || ''}:${record.date}`;
    const pending = pendingByOwnerDate.get(key);
    if (record.type === 'in' && !record.checkInTime && !record.clockIn) {
      if (pending) result.push(normalize(pending));
      pendingByOwnerDate.set(key, record);
    } else if (
      record.type === 'out' &&
      !record.checkInTime &&
      !record.clockIn &&
      pending &&
      pending.date === record.date
    ) {
      result.push(
        normalize({
          ...pending,
          checkInTime: pending.time,
          checkInTimestamp: pending.timestamp,
          checkOutTime: record.time,
          checkOutTimestamp: record.timestamp,
          status: 'Complete'
        })
      );
      pendingByOwnerDate.delete(key);
    } else {
      if (pending && record.type !== 'out') {
        result.push(normalize(pending));
        pendingByOwnerDate.delete(key);
      }
      result.push(normalize(record));
    }
  }
  for (const pending of pendingByOwnerDate.values()) result.push(normalize(pending));
  return result;
}
function pairs(records) {
  return normalizeList(records).map((record) => ({
    ...record,
    inTime: record.checkInTime || '漏签到',
    duration: record.durationText,
    status: record.completed ? 'complete' : 'incomplete'
  }));
}
function calendarStatus(records, date) {
  if (date > dateStr()) return '';
  return records.some((record) => record.date === date) ? 'normal' : '';
}
module.exports = {
  dateStr,
  durationText,
  normalize,
  normalizeList,
  pairs,
  calendarStatus
};
