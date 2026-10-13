/**
 * 考勤打卡小程序 - 主应用文件（已修复云开发初始化）
 * @description 负责全局状态管理、用户登录、数据初始化、定位优化
 */

const CloudService = require('./services/CloudService');
const ConfigService = require('./services/ConfigService');
const APP_VERSION = '1.0.2';

App({
  normalizeUserRecord(user = {}) {
    const normalized = { ...user };
    const role = (normalized.role || '').toLowerCase();
    normalized.role = role || (normalized.isAdmin ? 'admin' : 'member');
    normalized.isAdmin = normalized.role === 'admin';
    return normalized;
  },

  isUserAdmin(user) {
    if (!user) return false;
    const role = (user.role || '').toLowerCase();
    return role ? role === 'admin' : !!user.isAdmin;
  },

  globalData: {
    appVersion: APP_VERSION,
    openid: '',
    userInfo: null,
    isLogin: false,
    isAdmin: false,
    config: null,
    location: null,
    hasLocationAuth: false,
    cloudReady: false,
    cloudInitError: ''
  },

  onLaunch() {
    // 捕获未处理的Promise reject
    if (typeof wx.onUnhandledRejection === 'function') {
      wx.onUnhandledRejection((res) => {
        const reason = res && res.reason;
        const message =
          typeof reason === 'string'
            ? reason
            : (reason && reason.errMsg) || (reason && reason.message) || '';

        // 过滤微信开发者工具内部偶发的云服务握手噪音，避免误判为业务代码错误
        if (message.includes('Failed to fetch') || message.includes('webapi_getwxaasyncsecinfo')) {
          console.warn('已忽略开发者工具网络噪音:', message);
          return;
        }

        console.error('未捕获的Promise异常:', reason);
      });
    }

    // 1. 检查登录状态
    this.checkLogin();
    // 2. 加载全局配置
    this.loadConfig();
  },

  initCloudSafely() {
    if (!wx.cloud || typeof wx.cloud.init !== 'function') {
      this.globalData.cloudReady = false;
      this.globalData.cloudInitError = '当前基础库不支持云开发';
      console.warn(this.globalData.cloudInitError);
      return false;
    }

    try {
      wx.cloud.init({
        env: 'cloud1-d4g22few1dfa58dd6',
        traceUser: true
      });
      this.globalData.cloudReady = true;
      this.globalData.cloudInitError = '';
      return true;
    } catch (e) {
      this.globalData.cloudReady = false;
      this.globalData.cloudInitError = e && e.message ? e.message : '云开发初始化失败';
      console.error('云开发初始化失败，已切换为降级模式:', e);
      return false;
    }
  },

  ensureCloudReady() {
    if (this.globalData.cloudReady) {
      return true;
    }

    return this.initCloudSafely();
  },

  getCloudDatabase() {
    if (!this.ensureCloudReady()) {
      return null;
    }

    try {
      return wx.cloud.database();
    } catch (e) {
      this.globalData.cloudReady = false;
      this.globalData.cloudInitError = e && e.message ? e.message : '云数据库不可用';
      console.error('获取云数据库失败:', e);
      return null;
    }
  },

  /**
   * 检查本地登录状态
   */
  async checkLogin() {
    const openid = wx.getStorageSync('openid');
    const userInfo = wx.getStorageSync('userInfo');

    if (openid && userInfo) {
      const normalizedUser = this.normalizeUserRecord(userInfo);
      this.globalData.openid = openid;
      this.globalData.userInfo = normalizedUser;
      this.globalData.isLogin = true;
      // 缓存角色只用于展示；后台同步成功后才恢复管理员入口。
      this.globalData.isAdmin = false;

      // 异步同步用户信息（不阻塞 onLaunch）
      this.syncUserInfo(normalizedUser).catch((e) => {
        console.error('同步用户信息失败');
      });
    }
  },

  applyServerUser(user, openid = user._openid || user.openid) {
    const normalizedUser = this.normalizeUserRecord({ ...user, openid });
    wx.setStorageSync('openid', openid);
    wx.setStorageSync('userInfo', normalizedUser);
    this.globalData.openid = openid;
    this.globalData.userInfo = normalizedUser;
    this.globalData.isLogin = true;
    this.globalData.isAdmin = this.isUserAdmin(normalizedUser);
    return normalizedUser;
  },

  async login() {
    wx.showLoading({ title: '登录中...', mask: true });
    try {
      const result = await CloudService.call('login');
      return this.applyServerUser(result.user, result.openid);
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
      throw error;
    } finally {
      wx.hideLoading();
    }
  },

  // 只从服务端刷新身份，绝不向数据库回写本地角色或资料。
  async syncUserInfo() {
    const result = await CloudService.call('login');
    // 请求期间已退出登录时，不能重新恢复登录。
    if (!this.globalData.isLogin) return;
    this.applyServerUser(result.user, result.openid);
  },

  async updateUserInfo(userInfo) {
    const profile = {};
    for (const key of ['name', 'phone', 'avatar', 'realName']) {
      if (userInfo[key] !== undefined) profile[key] = userInfo[key];
    }
    const result = await CloudService.call('updateUserInfo', { profile });
    return this.applyServerUser(result.user);
  },

  /**
   * 加载全局考勤配置（不再强制覆盖管理员设置）
   */
  async loadConfig() {
    const defaultLocation = {
      latitude: 29.55565896,
      longitude: 106.23342499,
      radius: 300,
      name: '璧山机电大学高能束实验室'
    };

    try {
      let config = await ConfigService.getConfig();

      // 只在没有配置或没有 location 时才使用默认值
      if (!config) {
        config = {
          workStartTime: '09:00',
          workEndTime: '18:00',
          lateMinutes: 0,
          earlyMinutes: 0,
          location: defaultLocation
        };
      } else if (!config.location) {
        config.location = defaultLocation;
      }
      // 已有配置直接使用

      this.globalData.config = config;
    } catch (e) {
      console.error('加载配置失败，使用默认配置');
      this.globalData.config = {
        workStartTime: '09:00',
        workEndTime: '18:00',
        lateMinutes: 0,
        earlyMinutes: 0,
        location: defaultLocation
      };
    }
  },

  /**
   * 刷新配置（管理员保存后调用）
   */
  async refreshConfig() {
    await this.loadConfig();
  },

  /* ---------- 定位相关（优化版，解决重复获取与超时） ---------- */
  _locationCache: null, // 缓存结果
  _locationLock: false, // 防止并发重复获取

  /**
   * 获取用户位置（高精度，已去重）
   */

  getLocation(options = {}) {
    // 1. 新增 force 参数，默认为 false
    const { enableHighAccuracy = true, force = false } = options;

    return new Promise((resolve, reject) => {
      // 2. 如果不强制刷新，且有缓存，才直接返回
      if (this._locationCache && !force) {
        resolve(this._locationCache);
        return;
      }

      // 如果正在获取中，等待一段时间后重试
      if (this._locationLock) {
        setTimeout(() => {
          this.getLocation(options).then(resolve).catch(reject);
        }, 500);
        return;
      }

      this._locationLock = true;

      wx.getLocation({
        type: 'gcj02', // 保持全系统统一使用 gcj02
        isHighAccuracy: enableHighAccuracy,
        highAccuracyExpireTime: 5000,
        success: (res) => {
          const locationData = {
            latitude: res.latitude,
            longitude: res.longitude,
            accuracy: res.accuracy || 0,
            speed: res.speed || 0,
            altitude: res.altitude || 0
          };

          // 缓存并更新全局状态
          this._locationCache = locationData;
          this.globalData.location = locationData;
          this.globalData.hasLocationAuth = true;
          this._locationLock = false;

          resolve(res);
        },
        fail: (err) => {
          console.error('获取位置失败');
          this.globalData.hasLocationAuth = false;
          this._locationLock = false;

          if (err.errMsg && err.errMsg.includes('auth deny')) {
            reject({ ...err, needAuth: true });
          } else {
            reject(err);
          }
        }
      });
    });
  },

  /**
   * 清除定位缓存（从设置页修改考勤点后调用）
   */
  clearLocationCache() {
    this._locationCache = null;
    this.globalData.location = null;
  },

  /**
   * 检查是否已授权定位
   */
  checkLocationAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          resolve(!!res.authSetting['scope.userLocation']);
        },
        fail: () => resolve(false)
      });
    });
  },

  /**
   * 主动请求定位授权（含引导）
   */
  requestLocationAuth() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.userLocation',
        success: () => {
          this.globalData.hasLocationAuth = true;
          resolve(true);
        },
        fail: () => {
          wx.showModal({
            title: '需要定位权限',
            content: '考勤打卡需要获取您的位置信息，请在设置中开启定位权限',
            confirmText: '去设置',
            success: (modalRes) => {
              if (modalRes.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting['scope.userLocation']) {
                      this.globalData.hasLocationAuth = true;
                      resolve(true);
                    } else {
                      reject(new Error('用户未授权定位权限'));
                    }
                  }
                });
              } else {
                reject(new Error('用户取消授权'));
              }
            }
          });
        }
      });
    });
  },

  /**
   * Haversine 公式计算两点距离（米）
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  toRad(deg) {
    return (deg * Math.PI) / 180;
  },

  /* ---------- 通用工具方法 ---------- */
  showError(msg) {
    wx.showToast({ title: msg, icon: 'none', duration: 2000 });
  },

  showSuccess(msg) {
    wx.showToast({ title: msg, icon: 'success', duration: 1500 });
  }
});
