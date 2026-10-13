const app = getApp();
const CheckinService = require('../../services/CheckinService');
const RecordModel = require('../../services/RecordModel');
Page({
  data: {
    year: 0,
    month: 0,
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarGrid: [],
    selectedDate: '',
    selectedDateRecords: [],
    showDetail: false
  },
  _isUnloaded: false,
  onLoad() {
    const today = RecordModel.dateStr();
    this.setData({
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7))
    });
  },
  onShow() {
    this._isUnloaded = false;
    this.loadRecords();
  },
  onUnload() {
    this._isUnloaded = true;
  },
  async loadRecords() {
    const { year, month } = this.data;
    if (!app.globalData.openid) {
      this._records = [];
      this.setData({ calendarGrid: [], showDetail: false });
      return;
    }
    const token = (this._loadToken = (this._loadToken || 0) + 1);
    try {
      const records = await CheckinService.getMonthRecords(year, month);
      if (this._isUnloaded || token !== this._loadToken) return;
      this._records = records;
      const grid = [];
      for (let i = 0; i < new Date(year, month - 1, 1).getDay(); i++)
        grid.push({ day: '', color: '' });
      for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const status = RecordModel.calendarStatus(records, date);
        grid.push({
          day,
          date,
          color: { normal: 'green', late: 'orange', absent: 'red' }[status] || ''
        });
      }
      this.setData({ calendarGrid: grid, showDetail: false });
    } catch (e) {
      if (!this._isUnloaded) app.showError('记录加载失败');
    }
  },
  prevMonth() {
    let { year, month } = this.data;
    if (month === 1) {
      year--;
      month = 12;
    } else month--;
    this.setData({ year, month }, () => this.loadRecords());
  },
  nextMonth() {
    let { year, month } = this.data;
    if (month === 12) {
      year++;
      month = 1;
    } else month++;
    this.setData({ year, month }, () => this.loadRecords());
  },
  buildPairedRecords(records) {
    return RecordModel.pairs(records);
  },
  onDateTap(e) {
    const date = e.currentTarget.dataset.date;
    if (date)
      this.setData({
        selectedDate: date,
        showDetail: true,
        selectedDateRecords: this.buildPairedRecords(
          (this._records || []).filter((r) => r.date === date)
        )
      });
  },
  closeDetail() {
    this.setData({ showDetail: false });
  }
});
