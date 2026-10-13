const DbService = require('./DbService');
const RecordModel = require('./RecordModel');
const CloudService = require('./CloudService');
const app = getApp();

class CheckinService {
  async getDayRecords(date) {
    if (!app.globalData.openid) return [];
    const records = await DbService.getList('records', {
      openid: app.globalData.openid,
      date
    }, { throwOnError: true });
    return RecordModel.normalizeList(records);
  }

  async getMonthRecords(year, month, targetOpenid) {
    const openid = targetOpenid || app.globalData.openid;
    if (!openid) return [];
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    let records;
    if (targetOpenid) {
      // 成员详情始终由云函数重新鉴权。
      records = await CloudService.list('listAllRecords', {
        openid,
        startDate: `${prefix}-01`,
        endDate: `${prefix}-31`
      });
    } else {
      records = await DbService.getList('records', { openid }, {
        orderBy: { field: 'date', order: 'desc' },
        throwOnError: true
      });
    }
    return RecordModel.normalizeList(records.filter(record => record.date && record.date.startsWith(prefix)));
  }

  async getStatistics(year, month, targetOpenid, suppliedRecords) {
    const records = suppliedRecords || await this.getMonthRecords(year, month, targetOpenid);
    const stats = { presentDays: 0, visitCount: 0, totalMinutes: 0, outOfRangeDays: 0 };
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    const today = RecordModel.dateStr();
    const visitedDates = new Set();
    const outOfRangeDates = new Set();
    for (const record of records) {
      if (!record.date || !record.date.startsWith(prefix) || record.date > today ||
        !(record.checkInTime || record.checkOutTimestamp)) continue;
      visitedDates.add(record.date);
      stats.visitCount++;
      if (record.completed) stats.totalMinutes += Number(record.durationMinutes) || 0;
      if (record.outOfRange) outOfRangeDates.add(record.date);
    }
    // 工作室自由到访，没有应到工作日、迟到、早退或缺勤指标。
    stats.presentDays = visitedDates.size;
    stats.outOfRangeDays = outOfRangeDates.size;
    return stats;
  }
}
module.exports = new CheckinService();
