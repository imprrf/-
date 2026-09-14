const app = getApp();
const DbService = require('../../services/DbService');
const CheckinService = require('../../services/CheckinService');

Page({
  data: {
    user: null,
    year: 0,
    month: 0,
    weekDays: ['日', '一', '二', '三', '四', '五', '六'],
    calendarGrid: [],
    records: [],
    weekStats: [],
    weekTotalMinutes: 0,
    chartMax: 1,
    stats: {
      totalDays: 0,
      presentDays: 0,
      lateDays: 0,
      earlyDays: 0,
      absentDays: 0,
      workDays: 0
    },
    loading: false,
    showRecordDetail: false,
    selectedRecord: null
  },

  onLoad(options) {
    const { openid, name } = options;
    const now = new Date();
    
    this.setData({
      user: { openid, name },
      year: now.getFullYear(),
      month: now.getMonth() + 1
    });

    wx.setNavigationBarTitle({
      title: name ? `${name}的打卡记录` : '打卡记录'
    });

    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    
    try {
      const { year, month, user } = this.data;
      
      // 加载月度记录
      const records = (await CheckinService.getMonthRecords(year, month, user.openid))
        .map(record => this.normalizeRecord(record));
      
      // 计算统计数据
      const stats = await CheckinService.getStatistics(year, month, user.openid);
      const weekStats = this.buildWeekStats(records);
      
      // 生成日历
      const calendarGrid = this.generateCalendar(year, month, records);
      
      this.setData({
        records: records.sort((a, b) => b.date.localeCompare(a.date)),
        stats,
        calendarGrid,
        weekStats,
        weekTotalMinutes: weekStats.reduce((sum, item) => sum + (item.minutes || 0), 0),
        chartMax: Math.max(1, ...weekStats.map(item => item.count || 0)),
        loading: false
      });
    } catch (e) {
      console.error('加载数据失败', e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  buildWeekStats(records) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const recordMap = {};

    records.forEach(record => {
      if (!record.date) return;
      recordMap[record.date] = record;
    });

    const result = [];
    const maxDayCount = 7;
    let chartMax = 1;

    for (let i = maxDayCount - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const record = recordMap[key] || {};
      const count = ((record.clockIn ? 1 : 0) + (record.clockOut ? 1 : 0));
      const minutes = Number(record.duration || 0);
      result.push({
        key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        count,
        minutes,
        barHeight: 0
      });
      if (count > chartMax) chartMax = count;
    }

    result.forEach(item => {
      item.barHeight = item.count === 0 ? 6 : Math.max(18, (item.count / chartMax) * 100);
    });

    return result;
  },

  generateCalendar(year, month, records) {
    const daysInMonth = new Date(year, month, 0).getDate();
    const startWeekDay = new Date(year, month - 1, 1).getDay();
    const recordMap = {};
    
    records.forEach(r => {
      recordMap[r.date] = r;
    });

    const grid = [];
    
    // 填充空白
    for (let i = 0; i < startWeekDay; i++) {
      grid.push({ day: '', status: '' });
    }
    
    // 填充日期
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const record = recordMap[dateStr];
      let status = '';
      
      if (record && (record.clockIn || record.clockOut || record.checkInTime || record.checkOutTime)) {
        status = 'normal';
      }
      
      grid.push({ day: d, date: dateStr, status });
    }
    
    return grid;
  },

  normalizeRecord(record) {
    const duration = record.duration || (
      record.checkInTimestamp && record.checkOutTimestamp
        ? Math.round((record.checkOutTimestamp - record.checkInTimestamp) / 60000)
        : 0
    );
    return {
      ...record,
      clockIn: record.clockIn || record.checkInTime || '',
      clockOut: record.clockOut || record.checkOutTime || '',
      duration,
      locationIn: record.locationIn || record.checkInLocation || null,
      locationOut: record.locationOut || record.checkOutLocation || null,
      status: record.status === 'Incomplete' || record.status === 'Complete'
        ? 'normal'
        : record.status
    };
  },

  prevMonth() {
    let { year, month } = this.data;
    if (month === 1) {
      year--;
      month = 12;
    } else {
      month--;
    }
    this.setData({ year, month }, () => this.loadData());
  },

  nextMonth() {
    let { year, month } = this.data;
    if (month === 12) {
      year++;
      month = 1;
    } else {
      month++;
    }
    this.setData({ year, month }, () => this.loadData());
  },

  onDateTap(e) {
    const { date } = e.currentTarget.dataset;
    if (!date) return;
    
    const record = this.data.records.find(r => r.date === date);
    if (record) {
      this.setData({
        selectedRecord: record,
        showRecordDetail: true
      });
    }
  },

  onRecordItemTap(e) {
    const { record } = e.currentTarget.dataset;
    this.setData({
      selectedRecord: record,
      showRecordDetail: true
    });
  },

  closeDetail() {
    this.setData({ showRecordDetail: false, selectedRecord: null });
  },

  formatDuration(minutes) {
    if (!minutes) return '--';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}小时${mins > 0 ? mins + '分钟' : ''}`;
    }
    return `${mins}分钟`;
  },

  formatWeekTotal(minutes) {
    if (!minutes) return '0分钟';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}小时${mins > 0 ? mins + '分钟' : ''}`;
    }
    return `${mins}分钟`;
  },

  getStatusText(status) {
    if (status === 'normal') {
      return '已打卡';
    }
    return '未知';
  },

  getStatusClass(status) {
    if (status === 'normal') {
      return 'status-normal';
    }
    return '';
  }
});
