const app = getApp();
const CheckinService = require('../../services/CheckinService');
const RecordModel = require('../../services/RecordModel');
const CloudService = require('../../services/CloudService');
Page({
  data: {
    user: null,
    year: 0,
    month: 0,
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarGrid: [],
    records: [],
    weekStats: [],
    weekTotalText: '0h0m',
    chartMax: 1,
    stats: {},
    loading: false,
    showRecordDetail: false,
    selectedRecord: null
  },
  onLoad(options) {
    const today = RecordModel.dateStr();
    this.setData({
      user: { openid: options.openid, name: options.name },
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7))
    });
    wx.setNavigationBarTitle({
      title: options.name ? `${options.name}的打卡记录` : '打卡记录'
    });
    this.loadData();
  },
  async loadData() {
    const token = (this._loadToken = (this._loadToken || 0) + 1);
    this.setData({ loading: true, showRecordDetail: false });
    try {
      const { year, month, user } = this.data;
      if (!user.openid) throw new Error('成员标识无效');
      const records = await CheckinService.getMonthRecords(year, month, user.openid);
      const stats = await CheckinService.getStatistics(year, month, user.openid, records);
      // 七天图表跨月也必须补查，不能只用所选月份的数据。
      const today = RecordModel.dateStr();
      const since = new Date(`${today}T00:00:00Z`);
      since.setUTCDate(since.getUTCDate() - 6);
      const recent = RecordModel.normalizeList(
        await CloudService.list('listAllRecords', {
          openid: user.openid,
          startDate: since.toISOString().slice(0, 10),
          endDate: today
        })
      );
      const weekStats = this.buildWeekStats(recent);
      if (token !== this._loadToken) return;
      this.setData({
        records: records.sort((a, b) => b.date.localeCompare(a.date)),
        stats,
        calendarGrid: this.generateCalendar(year, month, records),
        weekStats,
        weekTotalText: RecordModel.durationText(weekStats.reduce((sum, r) => sum + r.minutes, 0)),
        loading: false
      });
    } catch (e) {
      if (token === this._loadToken) {
        this.setData({
          loading: false,
          records: [],
          calendarGrid: [],
          stats: {}
        });
        app.showError(e.message);
      }
    }
  },
  buildWeekStats(records) {
    const today = new Date(`${RecordModel.dateStr()}T00:00:00Z`),
      result = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - i);
      const key = date.toISOString().slice(0, 10),
        daily = records.filter((r) => r.date === key);
      result.push({
        key,
        label: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
        count: daily.reduce((sum, r) => sum + (r.checkInTime ? 1 : 0) + (r.completed ? 1 : 0), 0),
        minutes: daily.reduce((sum, r) => sum + r.durationMinutes, 0)
      });
    }
    const max = Math.max(1, ...result.map((r) => r.count));
    return result.map((r) => ({
      ...r,
      barHeight: r.count ? Math.max(18, (r.count / max) * 100) : 6
    }));
  },
  generateCalendar(year, month, records) {
    const grid = [];
    for (let i = 0; i < new Date(year, month - 1, 1).getDay(); i++)
      grid.push({ day: '', status: '' });
    for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      grid.push({
        day,
        date,
        status: RecordModel.calendarStatus(records, date)
      });
    }
    return grid;
  },
  prevMonth() {
    let { year, month } = this.data;
    if (month === 1) {
      year--;
      month = 12;
    } else month--;
    this.setData({ year, month }, () => this.loadData());
  },
  nextMonth() {
    let { year, month } = this.data;
    if (month === 12) {
      year++;
      month = 1;
    } else month++;
    this.setData({ year, month }, () => this.loadData());
  },
  onDateTap(e) {
    const records = this.data.records.filter((r) => r.date === e.currentTarget.dataset.date);
    if (records.length) this.setData({ selectedRecord: records[0], showRecordDetail: true });
  },
  onRecordItemTap(e) {
    this.setData({
      selectedRecord: e.currentTarget.dataset.record,
      showRecordDetail: true
    });
  },
  closeDetail() {
    this.setData({ showRecordDetail: false, selectedRecord: null });
  }
});
