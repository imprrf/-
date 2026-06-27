/**
 * 考勤打卡小程序 - 主应用文件（已修复云开发初始化）
 * @description 负责全局状态管理、用户登录、数据初始化、定位优化
 */

const DbService = require('./services/DbService');
const ConfigService = require('./services/ConfigService');

App({
  globalData: {
    openid: '',
    userInfo: null,
    isLogin: false,
    isAdmin: false,
    config: null,
    location: null,
    hasLocationAuth: false
  },

  onLaunch() {
      // 捕获未处理的Promise reject
      wx.onUnhandledRejection((res) => {
        console.error('未捕获的Promise异常:', res.reason);
      });

    // 1. 初始化云开发（必须最先执行，解决 Cloud API isn't enabled 报错）
    wx.cloud.init({
      env: 'cloud1-d4g22few1dfa58dd6',   // 你的云环境ID
      traceUser: true
    });
    console.log('云开发初始化完成');

    // 2. 检查登录状态
    this.checkLogin();
    // 3. 加载全局配置
    this.loadConfig();
  },

  /**
   * 检查本地登录状态
   */
  async checkLogin() {
    const openid = wx.getStorageSync('openid');
    const userInfo = wx.getStorageSync('userInfo');

    if (openid && userInfo) {
      this.globalData.openid = openid;
      this.globalData.userInfo = userInfo;
      this.globalData.isLogin = true;
      this.globalData.isAdmin = userInfo.isAdmin || false;

      // 异步同步用户信息（不阻塞 onLaunch）
      this.syncUserInfo(userInfo).catch(e => {
        console.log('同步用户信息失败', e);
      });
    }
  },


/**
   * 用户登录（通过云函数获取真实不变的 openid 并写库）
   */
  async login() {
    return new Promise(async (resolve, reject) => {
      try {
        wx.showLoading({ title: '登录中...', mask: true });

        // ------ 【已修复】调用刚刚部署的云函数获取真实唯一 OPENID ------
        const cloudRes = await wx.cloud.callFunction({
          name: 'getOpenid'
        });
        
        if (!cloudRes || !cloudRes.result || !cloudRes.result.openid) {
          throw new Error('云函数获取openid失败');
        }

        const openid = cloudRes.result.openid;
        console.log('当前登录用户的真实唯一OpenID:', openid);

        // 查询用户（此时同一个用户无论登录多少次，openid 永远相同）
        let userInfo = await DbService.getOne('users', { openid });

        if (!userInfo) {
          // 真正的新用户注册
          userInfo = {
            openid,
            name: '微信用户',
            avatar: '',
            phone: '',
            isAdmin: false,
            createTime: Date.now()
          };

          // 第一个注册的用户自动成为管理员
          const userCount = await DbService.count('users');
          if (userCount === 0) {
            userInfo.isAdmin = true;
          }

          await DbService.add('users', userInfo);
          console.log('新用户注册成功');
        } else {
          console.log('老用户登录成功，成功关联历史数据');
        }

        // 写入缓存与全局状态
        wx.setStorageSync('openid', openid);
        wx.setStorageSync('userInfo', userInfo);

        this.globalData.openid = openid;
        this.globalData.userInfo = userInfo;
        this.globalData.isLogin = true;
        this.globalData.isAdmin = userInfo.isAdmin || false;

        wx.hideLoading();
        resolve(userInfo);
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: '登录失败', icon: 'none' });
        console.error('登录异常:', err);
        reject(err);
      }
    });
  },

  /**
   * 同步用户信息到数据库
   */
  async syncUserInfo(userInfo) {
    try {
      const existingUser = await DbService.getOne('users', { openid: userInfo.openid });
      if (!existingUser) {
        await DbService.add('users', userInfo);
      } else {
        // 如果数据库中已经是管理员，同步到本地
        if (existingUser.isAdmin) {
          this.globalData.isAdmin = true;
          userInfo.isAdmin = true;
          wx.setStorageSync('userInfo', userInfo);
        }
        // 更新最后登录时间
        await DbService.update('users', { openid: userInfo.openid }, {
          lastLoginTime: Date.now()
        });
      }
    } catch (e) {
      console.log('同步用户信息失败，保存本地备份', e);
      wx.setStorageSync('localUserInfo', userInfo);
    }
  },

  /**
   * 更新用户信息（资料修改）
   */
  async updateUserInfo(userInfo) {
    try {
      await DbService.update('users', { openid: this.globalData.openid }, userInfo);
    } catch (e) {
      console.log('更新用户信息失败', e);
    }
    wx.setStorageSync('userInfo', userInfo);
    this.globalData.userInfo = userInfo;
    this.globalData.isAdmin = userInfo.isAdmin || false;
  },

  /**
   * 加载全局考勤配置（不再强制覆盖管理员设置）
   */
  async loadConfig() {
    const defaultLocation = {
      latitude: 29.55565896,
      longitude: 106.23342499,
      radius: 300,
      name: '重庆西永考勤点'
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
      console.log('考勤配置加载完成:', this.globalData.config);
    } catch (e) {
      console.log('加载配置失败，使用默认配置', e);
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
  _locationCache: null,   // 缓存结果
  _locationLock: false,   // 防止并发重复获取

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
          console.log(force ? '【打卡】强制获取最新位置成功:' : '【首页】获取缓存位置成功:', res);

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
          console.log('获取位置失败:', err);
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
  },
});