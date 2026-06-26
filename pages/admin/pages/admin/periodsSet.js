const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    periods: [],
    inputName: '',
    inputStart: '',
    inputEnd: ''
  },

  onLoad() {
    this.loadPeriods();
  },

  loadPeriods() {
    const config = app.globalData.config;
    if (config && config.periods) {
      this.setData({ periods: config.periods });
    }
  },

  // 添加时段
  addPeriod() {
    const { inputName, inputStart, inputEnd } = this.data;
    if (!inputName || !inputStart || !inputEnd) {
      wx.showToast({ title: '请填写完整', icon: 'none' });
      return;
    }
    const timeReg = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeReg.test(inputStart) || !timeReg.test(inputEnd)) {
      wx.showToast({ title: '时间格式HH:MM', icon: 'none' });
      return;
    }
    const periods = [...this.data.periods, { name: inputName, start: inputStart, end: inputEnd }];
    this.setData({ periods, inputName: '', inputStart: '', inputEnd: '' });
  },

  // 删除时段
  deletePeriod(e) {
    const index = e.currentTarget.dataset.index;
    const periods = this.data.periods.filter((_, i) => i !== index);
    this.setData({ periods });
  },

  // 保存到云数据库
  savePeriods() {
    wx.showLoading({ title: '保存中' });
    db.collection('config').doc('main_config').update({
      data: { periods: this.data.periods }
    }).then(() => {
      wx.hideLoading();
      app.refreshConfig().then(() => {
        wx.showToast({ title: '保存成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 1000);
      });
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
      console.error(err);
    });
  },

  onNameInput(e) { this.setData({ inputName: e.detail.value }); },
  onStartInput(e) { this.setData({ inputStart: e.detail.value }); },
  onEndInput(e) { this.setData({ inputEnd: e.detail.value }); }
});