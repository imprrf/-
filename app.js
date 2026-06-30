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
    hasLocationAuth: false,
    cloudReady: false,
    cloudInitError: ''
  },

  onLaunch() {
      // 捕获未处理的Promise reject
      if (typeof wx.onUnhandledRejection === 'function') {
        wx.onUnhandledRejection((res) => {
        const reason = res && res.reason;
        const message = typeof reason === 'string'
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
      console.log('云开发初始化完成');
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

  async login() {
    return new Promise(async (resolve, reject) => {
      try {
        wx.showLoading({ title: '登录中...', mask: true });

        if (!this.ensureCloudReady()) {
          throw new Error(this.globalData.cloudInitError || '云开发不可用，请检查开发者工具网络或云环境配置');
        }
  
        // 1. 获取 openid
        const cloudRes = await wx.cloud.callFunction({
          name: 'getOpenid'
        });
        if (!cloudRes || !cloudRes.result || !cloudRes.result.openid) {
          throw new Error('云函数获取openid失败');
        }
        const openid = cloudRes.result.openid;
        console.log('当前登录用户的真实唯一OpenID:', openid);
  
        const db = wx.cloud.database();
  
        // 2. 统一只用云开发原生的 _openid 查询
        let queryResult = await db.collection('users').where({
          _openid: openid
        }).get();
        console.log('查询 _openid 结果:', queryResult.data);
  
        let userInfo = null;
        if (queryResult.data.length > 0) {
          userInfo = queryResult.data[0];
          console.log('老用户登录成功，成功关联历史数据');
          
          // 字段映射：如果有 realName 则赋给 name
          if (userInfo.realName) {
            userInfo.name = userInfo.realName;
          }
          userInfo.phone = userInfo.phone || '';
        } else {
          // 新用户注册（这里不再往数据库存 openid 字段，只保留基本业务字段）
          // 云开发会自动帮你在数据库记录中生成一个系统的 _openid 字段
          userInfo = {
            name: '微信用户',
            avatar: '',
            phone: '',
            isAdmin: false,
            createTime: Date.now()
          };
          
          // 检查是否为第一个用户
          const countResult = await db.collection('users').count();
          if (countResult.total === 0) {
            userInfo.isAdmin = true;
          }
          // 插入新记录
          await db.collection('users').add({
            data: userInfo
          });
          console.log('新用户注册成功');
        }
  
        // 【关键兼容】在内存中为对象补上 openid 属性，防止后续页面因读取 userInfo.openid 而崩溃
        userInfo.openid = openid;
  
        // 3. 写入缓存与全局状态
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
      // 更新本地存储
      await DbService.update('users', { openid: this.globalData.openid }, userInfo);
      
      // 同步更新到云数据库
      const db = this.getCloudDatabase();
      if (db) {
        // 从 userInfo 中移除云数据库保留字段
        const { _openid, _id, _createTime, _updateTime, ...cleanUserInfo } = { ...userInfo };
        const cloudUserInfo = {
          ...cleanUserInfo,
          // 同时兼容 realName 字段
          realName: cleanUserInfo.name || cleanUserInfo.realName
        };
        
        // 手动从 cloudUserInfo 里也去掉这些保留字段
        delete cloudUserInfo._openid;
        delete cloudUserInfo._id;
        delete cloudUserInfo._createTime;
        delete cloudUserInfo._updateTime;
        
        console.log('【调试】准备更新云数据库用户信息:', cloudUserInfo);
        
        // 先查询是否存在该用户
        const queryResult = await db.collection('users')
          .where({ openid: this.globalData.openid })
          .get();
        
        console.log('【调试】查询用户结果:', queryResult);
        
        if (queryResult.data && queryResult.data.length > 0) {
          // 更新已有用户
          console.log('【调试】准备更新用户:', queryResult.data[0]._id);
          await db.collection('users')
            .doc(queryResult.data[0]._id)
            .update({
              data: cloudUserInfo
            });
          console.log('【调试】云数据库更新成功');
        } else {
          // 新增用户（需要显式添加 openid 字段
          cloudUserInfo.openid = this.globalData.openid;
          console.log('【调试】准备新增用户:', cloudUserInfo);
          await db.collection('users').add({
            data: cloudUserInfo
          });
          console.log('【调试】云数据库新增成功');
        }
      } else {
        console.log('【调试】云数据库不可用，跳过云同步');
      }
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
