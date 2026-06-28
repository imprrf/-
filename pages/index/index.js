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
    console.log('【调试】当前 userInfo 内容:', userInfo);
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

  // ==================== 【已修复】混合格式双控状态机 ====================
  async loadTodayRecords() {
    if (!app.globalData.isLogin) return;
    const db = wx.cloud.database();
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    
    try {
      const res = await db.collection('records')
        .where({ date: dateStr })
        .get();

      if (this._isUnloaded) return;
      const records = res.data;

      // 强行按照时间戳升序排序，确保新老数据交织时顺序不乱
      const sortedRecords = records.sort((a, b) => {
        const timeA = a.timestamp || a.checkInTimestamp || 0;
        const timeB = b.timestamp || b.checkInTimestamp || 0;
        return timeA - timeB;
      });

      let paired = [];
      let currentIn = null; // 专门用来配对老版本 type="in"/"out" 的指针

      for (let i = 0; i < sortedRecords.length; i++) {
        const r = sortedRecords[i];
        
        if (r.status === 'Incomplete') {
          // 新格式：上班了，下班还没打
          if (currentIn) {
            paired.push({ inTime: currentIn.time, outTime: '漏签退', duration: '--' });
            currentIn = null;
          }
          paired.push({ inTime: r.checkInTime || '--', outTime: '进行中', duration: '--' });
        } 
        else if (r.status === 'Complete') {
          // 新格式：完美合并的一体化数据
          if (currentIn) {
            paired.push({ inTime: currentIn.time, outTime: '漏签退', duration: '--' });
            currentIn = null;
          }
          paired.push({ inTime: r.checkInTime || '--', outTime: r.checkOutTime || '--', duration: r.totalWorkTime || '--' });
        } 
        else {
          // 降级兼容：老版本单独进出的记录
          const type = r.type || 'in';
          if (type === 'in') {
            if (currentIn) {
              paired.push({ inTime: currentIn.time, outTime: '漏签退', duration: '--' });
            }
            currentIn = r;
          } else if (type === 'out') {
            if (currentIn) {
              const duration = (r.timestamp || 0) - (currentIn.timestamp || 0);
              paired.push({
                inTime: currentIn.time,
                outTime: r.time,
                duration: this.formatDuration(duration)
              });
              currentIn = null;
            } else {
              paired.push({ inTime: '漏签到', outTime: r.time, duration: '--' });
            }
          }
        }
      }

      // 收尾清扫
      if (currentIn) {
        paired.push({ inTime: currentIn.time, outTime: '进行中', duration: '--' });
      }

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

// ==================== 【已修复 null 冲突】打卡决策 ====================
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

  let location = null;
  try {
    const locRes = await app.getLocation({ enableHighAccuracy: true, force: true });
    location = {
      latitude: locRes.latitude,
      longitude: locRes.longitude,
      name: (this.data.config && this.data.config.location && this.data.config.location.name) || '指定考勤点'
    };
    console.log('真实打卡位置记录(gcj02):', location);
  } catch (e) {
    console.log('获取打卡位置失败，打卡继续，不记录位置', e);
  }

  const db = wx.cloud.database();
  const _ = db.command; // 👈 核心：引入云数据库指令集
  
  // 查找今天有没有挂起的“未完成”打卡记录
  let incompleteRecord = null;
  try {
    const res = await db.collection('records')
      .where({ 
        date: dateStr,
        status: 'Incomplete'
      })
      .get();
    if (res.data.length > 0) {
      incompleteRecord = res.data[0];
    }
  } catch (e) {
    wx.showToast({ title: '查询数据库失败', icon: 'none' });
    return;
  }

  try {
    wx.showLoading({ title: '打卡中...', mask: true });
    let typeName = '';
    const uInfo = app.globalData.userInfo || {};

    if (!incompleteRecord) {
      // Branch A: 没有挂起记录 -> 新建上班卡
      typeName = '进入';
      const newRecord = {
        date: dateStr,
        timestamp: now.getTime(),
        userName: uInfo.name || '微信用户', 
        userPhone: uInfo.phone || '',       
        
        checkInTime: timeStr,
        checkInTimestamp: now.getTime(),
        checkInLocation: location,
        
        checkOutTime: null,
        checkOutTimestamp: null,
        checkOutLocation: {}, // 👈 优化：初始化为空对象 {}，防止以后更新遇到 null 报错
        totalWorkTime: null,
        status: 'Incomplete'
      };
      await db.collection('records').add({ data: newRecord });

    } else {
      // Branch B: 有挂起记录 -> 更新下班卡
      typeName = '离开';
      const durationMs = now.getTime() - incompleteRecord.checkInTimestamp;
      const formattedDuration = this.formatDuration(durationMs);

      // 👈 核心修复：使用 _.set() 强行覆盖原本为 null 的字段，打破冲突
      await db.collection('records').doc(incompleteRecord._id).update({
        data: {
          checkOutTime: timeStr,
          checkOutTimestamp: now.getTime(),
          checkOutLocation: _.set(location || {}), 
          totalWorkTime: formattedDuration,
          status: 'Complete'
        }
      });
    }

    wx.hideLoading();
    if (this._isUnloaded) return;
    
    await this.loadTodayRecords();
    this.showCheckinResult('success', '✓', `${typeName}打卡成功 (${timeStr})`);
  } catch (e) {
    wx.hideLoading();
    if (!this._isUnloaded) {
      this.showCheckinResult('error', '✗', '打卡失败，请重试');
      console.error('【打卡异常底层日志】详细错误报告:', e); 
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