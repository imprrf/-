const app = getApp();
const ConfigService = require('../../services/ConfigService');
const CheckinService = require('../../services/CheckinService');
const RecordModel = require('../../services/RecordModel');
const CloudService = require('../../services/CloudService');
Page({
  data: {
    isLogin: false,
    userInfo: null,
    currentDate: '',
    currentTime: '',
    currentWeek: '',
    todayStr: '',
    pairedRecords: [],
    hasRecord: false,
    canClock: true,
    currentLocation: null,
    currentLocationText: '正在获取...',
    distanceText: '',
    distanceClass: '',
    checkinResult: null,
    config: {
      location: {
        latitude: 29.55565896,
        longitude: 106.23342499,
        radius: 300,
        name: '指定考勤地点'
      }
    }
  },
  _isUnloaded: false,
  onLoad() {
    this._isUnloaded = false;
    this.checkLoginStatus();
    this.loadConfig();
  },
  onShow() {
    this._isUnloaded = false;
    this.checkLoginStatus();
    this.startTimer();
    if (app.globalData.isLogin) {
      this.loadTodayRecords();
      this.getLocation();
    }
  },
  onHide() {
    this._isUnloaded = true;
    this.stopTimer();
  },
  onUnload() {
    this._isUnloaded = true;
    this.stopTimer();
  },
  checkLoginStatus() {
    if (!this._isUnloaded)
      this.setData({
        isLogin: app.globalData.isLogin,
        userInfo: app.globalData.userInfo,
        config: app.globalData.config || this.data.config
      });
  },
  async loadConfig() {
    try {
      const config = await ConfigService.getConfig();
      if (!this._isUnloaded) this.setData({ config });
      app.globalData.config = config;
    } catch (e) {
      console.error('加载配置失败');
    }
  },
  startTimer() {
    this.stopTimer();
    this.updateTime();
    this._timer = setInterval(() => this.updateTime(), 1000);
  },
  stopTimer() {
    clearInterval(this._timer);
    clearTimeout(this._checkinResultTimer);
    this._timer = null;
  },
  updateTime() {
    if (this._isUnloaded) return;
    const now = new Date(Date.now() + 8 * 3600000);
    const month = now.getUTCMonth() + 1,
      day = now.getUTCDate();
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getUTCDay()];
    this.setData({
      currentDate: `${now.getUTCFullYear()}年${month}月${day}日`,
      currentTime: now.toISOString().slice(11, 19),
      currentWeek: week,
      todayStr: `${month}月${day}日 ${week}`
    });
  },
  async loadTodayRecords() {
    if (!app.globalData.isLogin) return;
    try {
      const records = await CheckinService.getDayRecords(RecordModel.dateStr());
      if (this._isUnloaded) return;
      const pairedRecords = RecordModel.pairs(records);
      this.setData({ pairedRecords, hasRecord: pairedRecords.length > 0 });
    } catch (e) {
      if (!this._isUnloaded) app.showError('今日记录加载失败');
    }
  },
  async onLogin() {
    try {
      await app.login();
      if (this._isUnloaded) return;
      this.checkLoginStatus();
      this.loadTodayRecords();
      this.getLocation();
      app.showSuccess('登录成功');
    } catch (e) {
      if (!this._isUnloaded) app.showError(e.message);
    }
  },
  async getLocation() {
    try {
      if (!(await app.checkLocationAuth())) await app.requestLocationAuth();
      if (this._isUnloaded) return;
      const location = await app.getLocation({ enableHighAccuracy: true });
      if (this._isUnloaded) return;
      this.setData({
        currentLocation: location,
        currentLocationText: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
      });
      this.calculateDistance();
    } catch (e) {
      if (!this._isUnloaded)
        this.setData({
          currentLocationText: '定位失败或未授权',
          distanceText: '无法计算'
        });
    }
  },
  calculateDistance() {
    if (this._isUnloaded) return;
    const { currentLocation, config } = this.data;
    if (!currentLocation || !config.location) return;
    const distance = app.calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      config.location.latitude,
      config.location.longitude
    );
    const inside = distance <= config.location.radius;
    this.setData({
      distanceText: `${Math.round(distance)}米 (${inside ? '范围内' : '超出范围'})`,
      distanceClass: inside ? 'text-success' : 'text-error'
    });
  },
  onCheckLocation() {
    const loc = this.data.config.location;
    wx.openLocation({
      latitude: loc.latitude,
      longitude: loc.longitude,
      scale: 18,
      name: loc.name || '考勤地点',
      address: '考勤打卡中心点'
    });
  },
  async onClock() {
    if (!this.data.canClock || this._clocking) return;
    if (!app.globalData.isLogin) {
      app.showError('请先登录');
      return;
    }
    this._clocking = true;
    this.setData({ canClock: false });
    // 网络失败后复用请求 ID（包括退出页面/重启），避免已成功的签到被重试成签退。
    const pendingKey = `pending_checkin_${app.globalData.openid}`;
    const requestId =
      wx.getStorageSync(pendingKey) || `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    wx.setStorageSync(pendingKey, requestId);
    let location = null;
    try {
      try {
        const loc = await app.getLocation({
          enableHighAccuracy: true,
          force: true
        });
        location = {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy || 0
        };
      } catch (e) {
        /* 软校验：定位失败仍允许提交，由服务端记录缺失标记。 */
      }
      wx.showLoading({ title: '打卡中...', mask: true });
      const result = await CloudService.call('checkin', {
        requestId,
        location
      });
      wx.removeStorageSync(pendingKey);
      if (this._isUnloaded) return;
      await this.loadTodayRecords();
      this.showCheckinResult('success', '✓', result.message);
    } catch (e) {
      // 明确的业务拒绝没有产生记录，下次点击可使用新请求。
      if (e.isBusinessFailure) wx.removeStorageSync(pendingKey);
      if (!this._isUnloaded) this.showCheckinResult('error', '✗', e.message || '打卡失败，请重试');
    } finally {
      wx.hideLoading();
      this._clocking = false;
      if (!this._isUnloaded) this.setData({ canClock: true });
    }
  },
  showCheckinResult(type, icon, message) {
    if (this._isUnloaded) return;
    this.setData({ checkinResult: { type, icon, message } });
    clearTimeout(this._checkinResultTimer);
    this._checkinResultTimer = setTimeout(() => {
      if (!this._isUnloaded) this.setData({ checkinResult: null });
    }, 3000);
  },
  onRefresh() {
    this.loadTodayRecords();
    this.getLocation();
    app.showSuccess('已刷新');
  },
  goToRecords() {
    wx.switchTab({ url: '/pages/records/records' });
  },
  goToStatistics() {
    wx.switchTab({ url: '/pages/records/records' });
  }
});
