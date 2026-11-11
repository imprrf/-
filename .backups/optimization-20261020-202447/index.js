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
      const user = await app.login();
      if (this._isUnloaded) return;
      this.checkLoginStatus();
      this.loadTodayRecords();
      this.getLocation();
      app.showSuccess('登录成功');
      // 资料未补全时，转到“我的”页自动弹出编辑窗口。
      if (app.needsProfile(user)) {
        app.globalData.promptProfile = true;
        wx.switchTab({ url: '/pages/mine/mine' });
      }
    } catch (e) {
      if (!this._isUnloaded) app.showError(e.message);
    }
  },
  async getLocation(forceRefresh = false) {
    try {
      if (!(await app.checkLocationAuth())) await app.requestLocationAuth();
      if (this._isUnloaded) return;
      // ✅ 优化 2: 如果不强制刷新，且缓存未过期（30秒内），直接返回
      const now = Date.now();
      const cached = this.data.currentLocation;
      if (!forceRefresh && cached && cached.timestamp && now - cached.timestamp < 30000) {
        return cached;
      }
      const location = await app.getLocation({ enableHighAccuracy: true });
      if (this._isUnloaded) return;
      // ✅ 保存带时间戳的定位
      const locationWithTimestamp = {
        ...location,
        timestamp: Date.now()
      };
      this.setData({
        currentLocation: locationWithTimestamp,
        currentLocationText: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
      });
      this.calculateDistance();
      return locationWithTimestamp;
    } catch (e) {
      if (!this._isUnloaded)
        this.setData({
          currentLocationText: '定位失败或未授权',
          distanceText: '无法计算'
        });
      throw e;
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
    // ✅ 优化 3: 快速点击反馈
    if (this._clocking) {
      wx.showToast({
        title: '打卡处理中，请稍候',
        icon: 'none',
        duration: 1500
      });
      return;
    }
    if (!this.data.canClock) return;
    if (!app.globalData.isLogin) {
      app.showError('请先登录');
      return;
    }
    this._clocking = true;
    this.setData({ canClock: false });
    // ✅ 优化 1: 立即显示 Loading
    wx.showLoading({ title: '定位中...', mask: true });

    // ✅ 优化：每次点击生成新的 requestId（不复用），避免云函数返回缓存结果
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    let location = null;
    try {
      // ✅ 优化 2: 复用页面定位（30秒内 + 精度足够）
      const now = Date.now();
      const cached = this.data.currentLocation;
      if (
        cached &&
        cached.timestamp &&
        now - cached.timestamp < 30000 &&
        (!cached.accuracy || cached.accuracy < 100)
      ) {
        // 定位缓存有效，直接使用
        location = {
          latitude: cached.latitude,
          longitude: cached.longitude,
          accuracy: cached.accuracy || 0
        };
        wx.showLoading({ title: '打卡中...', mask: true });
      } else {
        // 定位过期或精度不足，重新获取
        try {
          const loc = await this.getLocation(true);
          if (loc) {
            location = {
              latitude: loc.latitude,
              longitude: loc.longitude,
              accuracy: loc.accuracy || 0
            };
          }
          wx.showLoading({ title: '打卡中...', mask: true });
        } catch (e) {
          /* 软校验：定位失败仍允许提交，由服务端记录缺失标记。 */
        }
      }
      // ✅ 乐观更新：立即隐藏 Loading，显示处理中提示
      wx.hideLoading();
      this.showCheckinResult('pending', '⏳', '打卡中...');

      // 后台调用云函数
      const result = await CloudService.call('checkin', {
        requestId,
        location
      });
      if (this._isUnloaded) return;

      // 用真实结果更新（不重新查询，直接更新本地）
      await this.loadTodayRecords();
      this.showCheckinResult('success', '✓', result.message);

      // ✅ 成功后才释放锁（延迟释放，防止事务未提交时再次点击）
      this._clocking = false;
      this.setData({ canClock: true });
    } catch (e) {
      // 打卡失败，显示错误提示
      if (!this._isUnloaded) this.showCheckinResult('error', '✗', e.message || '打卡失败，请重试');

      // ✅ 失败后才释放锁
      this._clocking = false;
      if (!this._isUnloaded) this.setData({ canClock: true });
    } finally {
      // 确保 Loading 隐藏（防御性代码）
      wx.hideLoading();
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
