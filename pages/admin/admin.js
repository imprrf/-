/**
 * pages/admin/admin.js - 系统配置页面逻辑
 * @description 管理考勤时间、地点、规则等配置
 */

const app = getApp();
const ConfigService = require('../../services/ConfigService');

Page({
  data: {
    // 配置数据
    config: {
      workStartTime: '09:00',
      workEndTime: '18:00',
      lateMinutes: 0,
      earlyMinutes: 0,
      location: {
        latitude: 31.230416,
        longitude: 121.473701,
        radius: 300,
        name: '默认考勤地点'
      }
    },

    // 迟到选项
    lateOptions: ['0分钟', '5分钟', '10分钟', '15分钟', '30分钟'],
    lateValues: [0, 5, 10, 15, 30],

    // 早退选项
    earlyOptions: ['0分钟', '5分钟', '10分钟', '15分钟', '30分钟'],
    earlyValues: [0, 5, 10, 15, 30],

    // 当前位置
    currentLocation: null,

    // 地图配置
    mapShow: false,
    mapLatitude: 31.230416,
    mapLongitude: 121.473701,
    markers: [],
    circles: []
  },

  onLoad() {
    this.loadConfig();
  },

  onShow() {
    this.checkAdmin();
  },

  // 检查管理员权限
  checkAdmin() {
    if (!app.globalData.isAdmin) {
      wx.showToast({
        title: '无权限访问',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  // 加载配置
  async loadConfig() {
    try {
      const config = await ConfigService.getConfig();
      this.setData({ config });
      this.updateMapConfig(config.location);
    } catch (e) {
      console.log('加载配置失败', e);
    }
  },

  // 修改上班时间
  onStartTimeChange(e) {
    const value = e.detail.value;
    this.setData({
      'config.workStartTime': value
    });
  },

  // 修改下班时间
  onEndTimeChange(e) {
    const value = e.detail.value;
    this.setData({
      'config.workEndTime': value
    });
  },

  // 输入地点名称
  onLocationNameInput(e) {
    this.setData({
      'config.location.name': e.detail.value
    });
  },

  // 获取当前位置
  onGetCurrentLocation() {
    wx.showLoading({ title: '获取位置中...' });

    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        wx.hideLoading();
        this.setData({
          currentLocation: {
            latitude: res.latitude,
            longitude: res.longitude
          }
        });
        
        // 更新地图显示
        this.setData({
          mapShow: true,
          mapLatitude: res.latitude,
          mapLongitude: res.longitude
        });
        
        this.updateMapConfig({
          ...this.data.config.location,
          latitude: res.latitude,
          longitude: res.longitude
        });
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({
          title: '获取位置失败',
          icon: 'none'
        });
        console.log('获取位置失败', err);
      }
    });
  },

  // 设为考勤地点
  onSetAsLocation() {
    const { currentLocation, config } = this.data;
    
    if (!currentLocation) {
      wx.showToast({
        title: '请先获取当前位置',
        icon: 'none'
      });
      return;
    }

    wx.showModal({
      title: '确认设置',
      content: '确定将当前位置设为考勤地点？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            'config.location.latitude': currentLocation.latitude,
            'config.location.longitude': currentLocation.longitude
          });
          
          this.updateMapConfig({
            ...config.location,
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude
          });
          
          wx.showToast({
            title: '设置成功',
            icon: 'success'
          });
        }
      }
    });
  },

  // 修改迟到宽限
  onLateChange(e) {
    const index = e.detail.value;
    this.setData({
      'config.lateMinutes': this.data.lateValues[index]
    });
  },

  // 修改早退宽限
  onEarlyChange(e) {
    const index = e.detail.value;
    this.setData({
      'config.earlyMinutes': this.data.earlyValues[index]
    });
  },

  // 更新地图配置
  updateMapConfig(location) {
    if (!location) return;

    const marker = {
      id: 1,
      latitude: location.latitude,
      longitude: location.longitude,
      width: 30,
      height: 30,
      title: location.name || '考勤地点'
    };

    const circle = {
      latitude: location.latitude,
      longitude: location.longitude,
      radius: location.radius || 300,
      fillColor: '#1890ff33',
      strokeColor: '#1890ff',
      strokeWidth: 2
    };

    this.setData({
      mapShow: true,
      mapLatitude: location.latitude,
      mapLongitude: location.longitude,
      markers: [marker],
      circles: [circle]
    });
  },

  // 保存配置
  async onSave() {
    const { config } = this.data;

    // 验证
    if (!config.location.name) {
      wx.showToast({
        title: '请输入地点名称',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({ title: '保存中...' });

    try {
      const result = await ConfigService.updateConfig(config);
      
      wx.hideLoading();
      
      if (result.success) {
        app.showSuccess('保存成功');
        
        // 更新全局配置
        app.globalData.config = result.config;
        
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        wx.showToast({
          title: '保存失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.log('保存失败', e);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  }
});