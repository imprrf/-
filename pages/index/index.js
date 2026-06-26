const app = getApp();
const ConfigService = require('../../services/ConfigService');

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

  _timer: null,
  _checkinResultTimer: null,
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
      setTimeout(() => {
        if (!this._isUnloaded) this.getLocation();
      }, 500);
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
    const isLogin = app.globalData.isLogin;
    const userInfo = app.globalData.userInfo;
    const config = app.globalData.config;
    if (this._isUnloaded) return;
    this.setData({
      isLogin,
      userInfo,
      config: config || this.data.config
    });
  },

  async loadConfig() {
    try {
      const config = await ConfigService.getConfig();
      if (this._isUnloaded) return;
      this.setData({
        config: {
          location: config.location || this.data.config.location
        }
      });
      app.globalData.config = config;
    } catch (e) {
      if (!this._isUnloaded) console.log('加载配置失败', e);
    }
  },

  startTimer() {
    this.updateTime();
    this._timer = setInterval(() => {
      if (this._isUnloaded) {
        clearInterval(this._timer);
        return;
      }
      this.updateTime();
    }, 1000);
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    if (this._checkinResultTimer) {
      clearTimeout(this._checkinResultTimer);
    }
  },

  updateTime() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const week = weekDays[now.getDay()];
    if (this._isUnloaded) return;
    this.setData({
      currentDate: `${year}年${month}月${day}日`,
      currentTime: `${hour}:${minute}:${second}`,
      currentWeek: week,
      todayStr: `${month}月${day}日 ${week}`
    });
  },

  // ========== 加载今日记录并配对 ==========
  async loadTodayRecords() {
    if (!app.globalData.isLogin) return;
    const db = wx.cloud.database();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    try {
      const res = await db.collection('records')
        .where({ date: dateStr })
        .orderBy('timestamp', 'asc')
        .get();
      if (this._isUnloaded) return;
      const records = res.data;
      console.log('今日原始记录:', records);
      let paired = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const type = r.type || 'in';
        if (type === 'in' && i+1 < records.length && (records[i+1].type || 'in') === 'out') {
          const inRec = records[i];
          const outRec = records[i+1];
          const duration = outRec.timestamp - inRec.timestamp;
          paired.push({
            inTime: inRec.time,
            outTime: outRec.time,
            duration: this.formatDuration(duration)
          });
          i++;
        } else if (type === 'in' && i === records.length - 1) {
          paired.push({
            inTime: r.time,
            outTime: '进行中',
            duration: '--'
          });
        }
      }
      console.log('配对结果:', paired);
      this.setData({
        pairedRecords: paired,
        hasRecord: paired.length > 0
      });
    } catch (e) {
      if (!this._isUnloaded) console.log('加载今日记录失败', e);
    }
  },

  formatDuration(ms) {
    if (!ms || ms < 0) return '--';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours}h${minutes > 0 ? minutes+'m' : ''}`;
    else if (minutes > 0) return `${minutes}m`;
    else return '0m';
  },

  // ========== 登录 ==========
  async onLogin() {
    try {
      await app.login();
      if (this._isUnloaded) return;
      this.checkLoginStatus();
      this.loadTodayRecords();
      this.getLocation();
      app.showSuccess('登录成功');
    } catch (e) {
      if (!this._isUnloaded) console.log('登录失败', e);
    }
  },

  // ========== 位置相关 ==========
  async getLocation() {
    try {
      const hasAuth = await app.checkLocationAuth();
      if (this._isUnloaded) return;
      if (!hasAuth) {
        try {
          await app.requestLocationAuth();
          if (this._isUnloaded) return;
        } catch (e) {
          if (!this._isUnloaded) {
            this.setData({
              currentLocationText: '定位权限未授权',
              distanceText: '无法获取'
            });
          }
          return;
        }
      }
      const location = await app.getLocation({ enableHighAccuracy: true });
      if (this._isUnloaded) return;
      this.setData({
        currentLocation: location,
        currentLocationText: `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
      });
      this.calculateDistance();
    } catch (e) {
      if (!this._isUnloaded) {
        console.log('获取位置失败', e);
        this.setData({
          currentLocationText: '定位失败',
          distanceText: '无法计算'
        });
      }
    }
  },

  calculateDistance() {
    if (this._isUnloaded) return;
    const { currentLocation, config } = this.data;
    if (!currentLocation || !config || !config.location) return;
    const distance = app.calculateDistance(
      currentLocation.latitude, currentLocation.longitude,
      config.location.latitude, config.location.longitude
    );
    let distanceText, distanceClass;
    if (distance <= config.location.radius) {
      distanceText = `${Math.round(distance)}米 (范围内)`;
      distanceClass = 'text-success';
    } else {
      distanceText = `${Math.round(distance)}米 (超出范围)`;
      distanceClass = 'text-error';
    }
    this.setData({ distanceText, distanceClass });
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

  // ========== 核心打卡方法（无限制，只记录位置） ==========
  async onClock() {
    if (!this.data.canClock) {
      wx.showToast({ title: '请稍后再试', icon: 'none' });
      return;
    }
    if (!app.globalData.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    // ------ 获取位置（失败不影响打卡） ------
    let location = null;
    try {
      const locRes = await new Promise((resolve, reject) => {
        wx.getLocation({
          type: 'wgs84',
          success: resolve,
          fail: reject
        });
      });
      location = {
        latitude: locRes.latitude,
        longitude: locRes.longitude
      };
      console.log('打卡位置记录:', location);
    } catch (e) {
      console.log('获取位置失败，打卡继续，不记录位置', e);
    }

    const db = wx.cloud.database();
    let existing = [];
    try {
      const res = await db.collection('records')
        .where({ date: dateStr })
        .orderBy('timestamp', 'asc')
        .get();
      existing = res.data;
    } catch (e) {
      wx.showToast({ title: '查询记录失败', icon: 'none' });
      return;
    }

    let type = 'in';
    if (existing.length > 0) {
      const last = existing[existing.length - 1];
      const lastType = last.type || 'in';
      if (lastType === 'in') type = 'out';
    }

    const record = {
      date: dateStr,
      time: timeStr,
      timestamp: now.getTime(),
      type: type,
      location: location   // 保存经纬度
    };

    try {
      wx.showLoading({ title: '打卡中...', mask: true });
      await db.collection('records').add({ data: record });
      wx.hideLoading();
      if (this._isUnloaded) return;
      await this.loadTodayRecords();
      const typeName = type === 'in' ? '进入' : '离开';
      this.showCheckinResult('success', '✓', `${typeName}打卡成功 (${timeStr})`);
    } catch (e) {
      wx.hideLoading();
      if (!this._isUnloaded) {
        this.showCheckinResult('error', '✗', '打卡失败，请重试');
        console.error(e);
      }
    }
  },

  showCheckinResult(type, icon, message) {
    if (this._isUnloaded) return;
    this.setData({ checkinResult: { type, icon, message } });
    if (this._checkinResultTimer) clearTimeout(this._checkinResultTimer);
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