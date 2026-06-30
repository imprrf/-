const ConfigService = require('../../services/ConfigService');

Page({
  data: {
    location: {
      latitude: 29.55565896,
      longitude: 106.23342499,
      radius: 300,
      name: '请选择考勤位置'
    },
    markers: [],
    hasChanged: false
  },

  onLoad() {
    this.loadSavedLocation();
  },

  // 加载已保存的位置配置
  async loadSavedLocation() {
    try {
      wx.showLoading({ title: '加载中...' });
      const config = await ConfigService.getConfig();
      wx.hideLoading();
      
      if (config && config.location) {
        this.setData({
          location: {
            latitude: config.location.latitude || 29.55565896,
            longitude: config.location.longitude || 106.23342499,
            radius: config.location.radius || 300,
            name: config.location.name || '考勤地点'
          }
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.log('加载位置配置失败，使用默认值', e);
      // 使用默认位置
    }
    
    // 无论是否加载成功，都更新地图标记
    this.updateMarkers();
  },

  // 更新地图标记
  updateMarkers() {
    const { location } = this.data;
    const markers = [{
      id: 0,
      latitude: location.latitude,
      longitude: location.longitude,
      title: location.name || '考勤点',
      iconPath: '/assets/icons/location.png',
      width: 40,
      height: 40,
      callout: {
        content: location.name || '考勤点',
        color: '#ffffff',
        fontSize: 14,
        borderRadius: 8,
        bgColor: '#1890ff',
        padding: 8,
        display: 'ALWAYS'
      }
    }];
    
    this.setData({ markers });
  },

  // 点击地图选点
  onMapTap(e) {
    const { latitude, longitude } = e.detail;
    
    // 更新位置坐标
    this.setData({
      'location.latitude': latitude,
      'location.longitude': longitude,
      hasChanged: true
    });
    
    // 获取地址名称
    this.reverseGeocoder(latitude, longitude);
    
    // 更新地图标记
    this.updateMarkers();
    
    wx.vibrateShort({ type: 'light' });
  },

  // 逆地理编码（坐标转地址）
  reverseGeocoder(latitude, longitude) {
    // 方法1：使用微信内置API（需要最新基础库）
    if (wx.getLocation) {
      // 简单标记，让用户自己输入名称
      this.setData({
        'location.name': `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
      });
    }
  },

  // 搜索地点
  onSearchLocation() {
    wx.chooseLocation({
      success: (res) => {
        console.log('选择的位置:', res);
        this.setData({
          'location.latitude': res.latitude,
          'location.longitude': res.longitude,
          'location.name': res.name || res.address || '已选位置',
          hasChanged: true
        });
        this.updateMarkers();
        
        wx.showToast({
          title: '位置已更新',
          icon: 'success',
          duration: 1500
        });
      },
      fail: (err) => {
        if (err.errMsg !== 'chooseLocation:cancel') {
          wx.showToast({
            title: '选择位置失败',
            icon: 'none'
          });
        }
      }
    });
  },

  // 使用当前位置
  getCurrentLocation() {
    wx.showLoading({ title: '获取位置...' });
    
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (res) => {
        wx.hideLoading();
        
        this.setData({
          'location.latitude': res.latitude,
          'location.longitude': res.longitude,
          'location.name': '当前位置',
          hasChanged: true
        });
        
        this.updateMarkers();
        
        wx.showToast({
          title: '已定位到当前位置',
          icon: 'success',
          duration: 1500
        });
      },
      fail: (err) => {
        wx.hideLoading();
        console.log('获取位置失败', err);
        
        wx.showModal({
          title: '定位失败',
          content: '请在设置中开启定位权限，或手动在地图上选择位置',
          showCancel: false
        });
      }
    });
  },

  // 修改地点名称
  onNameChange(e) {
    this.setData({
      'location.name': e.detail.value,
      hasChanged: true
    });
    this.updateMarkers();
  },

  // 修改打卡范围
  onRadiusChange(e) {
    let radius = parseInt(e.detail.value) || 300;
    
    // 限制范围在50-2000米之间
    radius = Math.max(50, Math.min(2000, radius));
    
    this.setData({
      'location.radius': radius,
      hasChanged: true
    });
  },

  // 点击地图标记
  onMarkerTap(e) {
    wx.showToast({
      title: '点击地图其他位置可以移动考勤点',
      icon: 'none',
      duration: 2000
    });
  },

  // 保存位置配置
  async saveLocation() {
    const { location, hasChanged } = this.data;
    
    // 验证数据
    if (!location.latitude || !location.longitude) {
      wx.showToast({
        title: '请先在地图上选择位置',
        icon: 'none',
        duration: 2000
      });
      return;
    }
    
    if (!location.name || location.name.trim() === '') {
      this.setData({
        'location.name': `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
      });
    }
    
    try {
      wx.showLoading({ title: '保存中...', mask: true });
      
      // 保存到数据库
      await ConfigService.updateConfig({
        location: {
          latitude: location.latitude,
          longitude: location.longitude,
          radius: location.radius,
          name: location.name
        }
      });
      
      // 更新全局配置
      const app = getApp();
      if (app && app.globalData) {
        app.globalData.config = app.globalData.config || {};
        app.globalData.config.location = {
          latitude: location.latitude,
          longitude: location.longitude,
          radius: location.radius,
          name: location.name
        };
      }
      
      wx.hideLoading();
      
      wx.showToast({
        title: '保存成功',
        icon: 'success',
        duration: 1500
      });
      
      // 延迟返回，让用户看到成功提示
      setTimeout(() => {
        wx.navigateBack({
          delta: 1,
          success: () => {
            console.log('返回上一页');
          }
        });
      }, 1200);
      
    } catch (e) {
      wx.hideLoading();
      console.error('保存位置失败', e);
      
      wx.showModal({
        title: '保存失败',
        content: '无法保存位置配置，请检查网络连接后重试',
        showCancel: false
      });
    }
  },

  // 取消设置
  cancelSetting() {
    if (this.data.hasChanged) {
      wx.showModal({
        title: '提示',
        content: '位置已修改，是否放弃更改？',
        success: (res) => {
          if (res.confirm) {
            wx.navigateBack();
          }
        }
      });
    } else {
      wx.navigateBack();
    }
  }
});