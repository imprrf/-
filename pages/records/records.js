const app = getApp();

Page({
  data: {
    year: 2026,
    month: 6,
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarGrid: [],
    selectedDate: '',
    selectedDateRecords: [],
    showDetail: false
  },

  _isUnloaded: false,

  onLoad() {
    this._isUnloaded = false;
    this.db = app.getCloudDatabase();
    const now = new Date();
    this.setData({
      year: now.getFullYear(),
      month: now.getMonth() + 1
    });
    this.loadRecords();
  },

  onUnload() {
    this._isUnloaded = true;
  },

  async loadRecords() {
    const { year, month } = this.data;
    const db = this.db || app.getCloudDatabase();
    this.db = db;
    if (!db) {
      if (!this._isUnloaded) {
        this.setData({ calendarGrid: [] });
        wx.showToast({ title: '云服务不可用', icon: 'none' });
      }
      return;
    }
    const daysInMonth = new Date(year, month, 0).getDate();
    const startWeekDay = new Date(year, month - 1, 1).getDay();

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

    let records = [];
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), 8000));
      const query = db.collection('records')
        .where({
          date: db.command.gte(startDate).and(db.command.lte(endDate))
        })
        .get();
      const res = await Promise.race([query, timeout]);
      records = res.data;
    } catch (e) {
      console.error('加载记录失败', e);
      if (!this._isUnloaded) wx.showToast({ title: '记录加载失败', icon: 'none' });
      return;
    }

    if (this._isUnloaded) return;

    // 按日期分组，只记录是否有打卡
    const dateHasRecord = {};
    records.forEach(r => {
      dateHasRecord[r.date] = true;
    });

    const grid = [];
    for (let i = 0; i < startWeekDay; i++) {
      grid.push({ day: '', color: '' });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      let color = '';
      if (dateHasRecord[dateStr]) {
        color = 'green';   // 有打卡则绿色
      }
      grid.push({ day: d, date: dateStr, color });
    }

    if (!this._isUnloaded) {
      this.setData({ calendarGrid: grid });
    }
  },

  prevMonth() {
    let { year, month } = this.data;
    if (month === 1) { year--; month = 12; } else { month--; }
    this.setData({ year, month }, () => this.loadRecords());
  },

  nextMonth() {
    let { year, month } = this.data;
    if (month === 12) { year++; month = 1; } else { month++; }
    this.setData({ year, month }, () => this.loadRecords());
  },

  async onDateTap(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({ selectedDate: date, showDetail: true });

    const db = this.db || app.getCloudDatabase();
    this.db = db;
    if (!db) {
      if (!this._isUnloaded) {
        wx.showToast({ title: '云服务不可用', icon: 'none' });
      }
      return;
    }
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), 8000));
      const query = db.collection('records')
        .where({ date })
        .orderBy('timestamp', 'asc')
        .get();
      const res = await Promise.race([query, timeout]);
      if (this._isUnloaded) return;
      const records = res.data;
      let paired = [];
      for (let i = 0; i < records.length; i++) {
        if (records[i].type === 'in' && i+1 < records.length && records[i+1].type === 'out') {
          const inRec = records[i];
          const outRec = records[i+1];
          const duration = outRec.timestamp - inRec.timestamp;
          paired.push({
            inTime: inRec.time,
            outTime: outRec.time,
            duration: this.formatDuration(duration)
          });
          i++;
        } else if (records[i].type === 'in' && i === records.length - 1) {
          paired.push({
            inTime: records[i].time,
            outTime: '进行中',
            duration: '--'
          });
        }
        // 单独出忽略（或可单独显示）
      }
      this.setData({ selectedDateRecords: paired });
    } catch (e) {
      console.error('查询详情失败', e);
      if (!this._isUnloaded) wx.showToast({ title: '详情加载失败', icon: 'none' });
    }
  },

  formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours}h${minutes > 0 ? minutes+'m' : ''}`;
    else if (minutes > 0) return `${minutes}m`;
    else return '0m';
  },

  closeDetail() {
    this.setData({ showDetail: false });
  }
});
