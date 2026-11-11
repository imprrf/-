const app = getApp();
const CheckinService = require('../../services/CheckinService');
const ConfigService = require('../../services/ConfigService');

Page({
  data: {
    isLogin: false,
    userInfo: null,
    isAdmin: false,
    appVersion: app.globalData.appVersion,
    attendanceInfo: { presentDays: 0, visitCount: 0, totalMinutes: 0, outOfRangeDays: 0 },
    config: {
      location: { name: '重庆西永考勤点', radius: 300 }
    },
    showEditModal: false,
    editForm: { name: '', phone: '', agreed: false },
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
    // 冷启动同步未完成或角色被改动时，等身份刷新后再更新管理员入口。
    Promise.resolve(app.syncPromise)
      .then(() => app.refreshIdentity())
      .then(() => this.checkLoginStatus());
    if (app.globalData.isLogin) {
      this.loadAttendanceInfo();
    }
    this.loadConfig();
    // 从打卡页登录后跳转而来，自动弹出一次资料编辑窗口。
    if (app.globalData.promptProfile) {
      app.globalData.promptProfile = false;
      if (app.globalData.isLogin) this.onEditProfile();
    }
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
      const stats = await CheckinService.getStatistics(year, month);
      if (this._isUnloaded) return;
      this.setData({ attendanceInfo: stats });
    } catch (e) {
      if (!this._isUnloaded) {
        console.error('加载考勤统计失败:', e);
      }
    }
  },

  async loadConfig() {
    try {
      const config = await ConfigService.getConfig();
      if (this._isUnloaded) return;
      // 修复：不再强制覆盖坐标，完全信任服务端设置
      this.setData({ config: config || this.data.config });
    } catch (e) {
      if (!this._isUnloaded) console.error('加载配置失败');
    }
  },

  async onLogin() {
    try {
      const user = await app.login();
      if (this._isUnloaded) return;
      this.checkLoginStatus();
      this.loadAttendanceInfo();
      app.showSuccess('登录成功');
      if (app.needsProfile(user)) this.onEditProfile();
    } catch (e) {
      if (!this._isUnloaded) console.error('登录失败');
    }
  },

  onEditProfile() {
    if (!this.data.isLogin) {
      app.showError('请先登录');
      return;
    }
    const { userInfo } = this.data;
    this.setData({
      showEditModal: true,
      editForm: {
        name: userInfo && userInfo.name !== '微信用户' ? userInfo.name || '' : '',
        phone: userInfo ? userInfo.phone || '' : '',
        agreed: false
      }
    });
  },

  onCloseEditModal() {
    this.setData({ showEditModal: false, editForm: { name: '', phone: '', agreed: false } });
  },

  onNameInput(e) {
    this.setData({ 'editForm.name': e.detail.value });
  },
  onPhoneInput(e) {
    this.setData({ 'editForm.phone': e.detail.value });
  },

  onAgreementChange(e) {
    const agreed = e.detail.value.includes('agreed');
    this.setData({ 'editForm.agreed': agreed });
  },

  onViewTerms(e) {
    e.stopPropagation();
    wx.navigateTo({ url: '/pages/terms/terms' });
  },

  onViewPrivacy(e) {
    e.stopPropagation();
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  onViewTermsInModal(e) {
    e.stopPropagation();
    wx.navigateTo({ url: '/pages/terms/terms' });
  },

  onViewPrivacyInModal(e) {
    e.stopPropagation();
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },

  async onSaveProfile() {
    const { editForm } = this.data;
    if (!editForm.name.trim()) {
      app.showError('请输入姓名');
      return;
    }
    // 有意使用宽松的中国大陆 11 位手机号格式校验。
    if (editForm.phone && !/^1\d{10}$/.test(editForm.phone)) {
      app.showError('请输入正确的手机号');
      return;
    }
    if (!editForm.agreed) {
      app.showError('请先阅读并同意用户服务协议和隐私政策');
      return;
    }
    try {
      wx.showLoading({ title: '保存中...' });
      const userInfo = {
        ...this.data.userInfo,
        name: editForm.name.trim(),
        phone: editForm.phone.trim()
      };
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

  onCheckInRule() {
    this.setData({ showRuleModal: true });
  },
  onCloseRuleModal() {
    this.setData({ showRuleModal: false });
  },

  onLocationSet() {
    if (!this.data.isAdmin) return;
    wx.navigateTo({ url: '/pages/admin/locationSet' });
  },

  onAbout() {
    wx.showModal({
      title: '工作室打卡',
      content: `版本：${this.data.appVersion}\n\n支持导出打卡数据，新增删除成员功能。`,
      showCancel: true,
      cancelText: '关闭',
      confirmText: '查看协议',
      success: (res) => {
        if (res.confirm) {
          this.showAgreementOptions();
        }
      }
    });
  },

  showAgreementOptions() {
    wx.showActionSheet({
      itemList: ['用户服务协议', '隐私政策'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/terms/terms' });
        } else if (res.tapIndex === 1) {
          wx.navigateTo({ url: '/pages/privacy/privacy' });
        }
      }
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
            isLogin: false,
            userInfo: null,
            isAdmin: false,
            attendanceInfo: { presentDays: 0, visitCount: 0, totalMinutes: 0, outOfRangeDays: 0 }
          });
          app.showSuccess('已退出登录');
        }
      }
    });
  }
});
