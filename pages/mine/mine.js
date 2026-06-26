const app = getApp();
const CheckinService = require('../../services/CheckinService');
const ConfigService = require('../../services/ConfigService');

Page({
  data: {
    isLogin: false,
    userInfo: null,
    isAdmin: false,
    attendanceInfo: {
      workDays: 0, presentDays: 0, lateDays: 0, earlyDays: 0, absentDays: 0
    },
    config: {
      workStartTime: '09:00', workEndTime: '18:00',
      location: { name: '重庆西永考勤点', radius: 300 }
    },
    showEditModal: false,
    editForm: { name: '', phone: '' },
    showRuleModal: false
  },

  _isUnloaded: false,

  onLoad() {
    this._isUnloaded = false;
    this.checkLoginStatus();
  },

  onShow() {
    this._isUnloaded = false;
    this.checkLoginStatus();
    if (app.globalData.isLogin) {
      this.loadAttendanceInfo();
    }
    this.loadConfig();
  },

  onHide() {
    this._isUnloaded = true;
  },

  onUnload() {
    this._isUnloaded = true;
  },

  checkLoginStatus() {
    if (this._isUnloaded) return;
    const isLogin = !!app.globalData.isLogin;
    const userInfo = app.globalData.userInfo || null;
    const isAdmin = !!app.globalData.isAdmin;
    this.setData({ isLogin, userInfo, isAdmin });
  },

  async loadAttendanceInfo() {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const records = await CheckinService.getMonthRecords(year, month) || [];
      if (this._isUnloaded) return;

      let presentDays = 0, lateDays = 0, earlyDays = 0, absentDays = 0;
      if (Array.isArray(records)) {
        records.forEach(record => {
          if (!record) return;
          const status = record.status || 'none';
          if (status === 'normal') { presentDays++; }
          else if (status === 'late') { presentDays++; lateDays++; }
          else if (status === 'early') { presentDays++; earlyDays++; }
          else if (status === 'late_early') { presentDays++; lateDays++; earlyDays++; }
          else if (status === 'absent') { absentDays++; }
        });
      }
      const workDays = this.getWorkDaysInMonth(year, month);
      this.setData({ attendanceInfo: { workDays, presentDays, lateDays, earlyDays, absentDays } });
    } catch (e) {
      if (!this._isUnloaded) {
        console.error('加载考勤统计失败:', e);
        this.setData({
          'attendanceInfo.workDays': this.getWorkDaysInMonth(new Date().getFullYear(), new Date().getMonth() + 1)
        });
      }
    }
  },

  getWorkDaysInMonth(year, month) {
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    let workDays = 0;
    for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) workDays++;
    }
    return workDays;
  },

  async loadConfig() {
    try {
      const config = await ConfigService.getConfig();
      if (this._isUnloaded) return;
      // 修复：不再强制覆盖坐标，完全信任服务端设置
      this.setData({ config: config || this.data.config });
    } catch (e) {
      if (!this._isUnloaded) console.log('加载配置失败', e);
    }
  },

  async onLogin() {
    try {
      await app.login();
      if (this._isUnloaded) return;
      this.checkLoginStatus();
      this.loadAttendanceInfo();
      app.showSuccess('登录成功');
    } catch (e) {
      if (!this._isUnloaded) console.log('登录失败', e);
    }
  },

  onEditProfile() {
    if (!this.data.isLogin) { app.showError('请先登录'); return; }
    const { userInfo } = this.data;
    this.setData({
      showEditModal: true,
      editForm: { name: userInfo ? (userInfo.name || '') : '', phone: userInfo ? (userInfo.phone || '') : '' }
    });
  },

  onCloseEditModal() {
    this.setData({ showEditModal: false, editForm: { name: '', phone: '' } });
  },

  onNameInput(e) { this.setData({ 'editForm.name': e.detail.value }); },
  onPhoneInput(e) { this.setData({ 'editForm.phone': e.detail.value }); },

  async onSaveProfile() {
    const { editForm } = this.data;
    if (!editForm.name.trim()) { app.showError('请输入姓名'); return; }
    if (editForm.phone && !/^1\d{10}$/.test(editForm.phone)) { app.showError('请输入正确的手机号'); return; }
    try {
      wx.showLoading({ title: '保存中...' });
      const userInfo = { ...this.data.userInfo, name: editForm.name.trim(), phone: editForm.phone.trim() };
      await app.updateUserInfo(userInfo);
      wx.hideLoading();
      if (this._isUnloaded) return;
      app.showSuccess('保存成功');
      this.onCloseEditModal();
      this.checkLoginStatus();
    } catch (e) {
      wx.hideLoading();
      if (!this._isUnloaded) app.showError('保存失败');
    }
  },

  onCheckInRule() { this.setData({ showRuleModal: true }); },
  onCloseRuleModal() { this.setData({ showRuleModal: false }); },

  onLocationSet() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/admin/locationSet' });
  },

  onAbout() {
    wx.showModal({
      title: '考勤打卡系统',
      content: '版本：1.0.0\n\n简洁高效的考勤打卡工具，支持定位打卡、记录统计等功能。',
      showCancel: false
    });
  },

  onUserManagement() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/admin/userList' });
  },

  onConfigSet() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/admin/admin' });
  },

  onLogout() {
    wx.showModal({
      title: '提示',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          wx.removeStorageSync('openid');
          wx.removeStorageSync('userInfo');
          app.globalData.openid = '';
          app.globalData.userInfo = null;
          app.globalData.isLogin = false;
          app.globalData.isAdmin = false;
          if (this._isUnloaded) return;
          this.setData({
            isLogin: false, userInfo: null, isAdmin: false,
            attendanceInfo: { workDays: 0, presentDays: 0, lateDays: 0, earlyDays: 0, absentDays: 0 }
          });
          app.showSuccess('已退出登录');
        }
      }
    });
  }
});