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
      const records = await CheckinService.getMonthRecords(year, month, user.openid);
      
      // 计算统计数据
      const stats = await CheckinService.getStatistics(year, month, user.openid);
      
      // 生成日历
      const calendarGrid = this.generateCalendar(year, month, records);
      
      this.setData({
        records: records.sort((a, b) => b.date.localeCompare(a.date)),
        stats,
        calendarGrid,
        loading: false
      });
    } catch (e) {
      console.error('加载数据失败', e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
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
      
      if (record && (record.clockIn || record.clockOut)) {
        status = 'normal';
      }
      
      grid.push({ day: d, date: dateStr, status });
    }
    
    return grid;
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
