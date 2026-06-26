/**
 * 高精度定位服务
 * @description 解决定位漂移问题，提供多重校验机制
 */

class LocationService {
  constructor() {
    // 有效位置缓存（用于漂移校验）
    this.lastValidLocation = null;
    this.lastValidTime = 0;
    
    // 配置
    this.config = {
      // 最大允许的定位误差（米）
      maxAccuracy: 100,
      // 两次定位之间的最大移动距离（米）超过此距离视为漂移
      maxMoveDistance: 5000,
      // 有效位置缓存有效期（毫秒）5分钟
      cacheExpireTime: 5 * 60 * 1000,
      // 定位超时时间（毫秒）
      timeout: 10000,
      // 最大重试次数
      maxRetries: 3
    };
  }

  /**
   * 获取高精度位置
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 位置信息
   */
  async getHighAccuracyLocation(options = {}) {
    const retries = options.retries || this.config.maxRetries;
    
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`第${i + 1}次尝试获取高精度位置...`);
        
        const location = await this.getLocationWithHighAccuracy(options);
        
        // 验证位置有效性
        const validation = await this.validateLocation(location);
        
        if (validation.valid) {
          console.log('位置验证通过', location);
          this.cacheValidLocation(location);
          return {
            ...location,
            validation: validation
          };
        } else {
          console.warn('位置验证失败:', validation.reason);
          
          // 如果有缓存的有效位置且距离不远，使用缓存位置
          if (this.lastValidLocation && this.isCacheValid()) {
            console.log('使用缓存的有效位置');
            return {
              ...this.lastValidLocation,
              fromCache: true,
              validation: { valid: true, reason: '使用缓存位置' }
            };
          }
          
          // 最后一次重试失败，返回原始位置
          if (i === retries - 1) {
            console.log('所有重试失败，返回原始位置');
            return {
              ...location,
              validation: validation
            };
          }
          
          // 等待后重试
          await this.sleep(1000 * (i + 1));
        }
        
      } catch (error) {
        console.error(`第${i + 1}次定位失败:`, error);
        
        if (i === retries - 1) {
          throw error;
        }
        
        await this.sleep(1000 * (i + 1));
      }
    }
  }

  /**
   * 微信高精度定位
   */
  getLocationWithHighAccuracy(options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || this.config.timeout;
      let timeoutId = null;
      let isResolved = false;

      // 设置超时
      timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          // 超时后尝试普通定位
          this.getNormalLocation()
            .then(resolve)
            .catch(reject);
        }
      }, timeout);

      // 尝试高精度定位
      wx.getLocation({
        type: 'gcj02',
        isHighAccuracy: true, // 开启高精度定位
        highAccuracyExpireTime: 5000, // 高精度定位超时时间
        success: (res) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            
            // 检查精度
            if (res.accuracy && res.accuracy > this.config.maxAccuracy) {
              console.warn('定位精度不足:', res.accuracy, '米');
            }
            
            resolve({
              latitude: res.latitude,
              longitude: res.longitude,
              accuracy: res.accuracy || 0,
              speed: res.speed || 0,
              altitude: res.altitude || 0,
              timestamp: Date.now(),
              horizontalAccuracy: res.horizontalAccuracy || 0
            });
          }
        },
        fail: (err) => {
          if (!isResolved) {
            isResolved = true;
            clearTimeout(timeoutId);
            
            console.error('高精度定位失败，尝试普通定位:', err);
            
            // 降级到普通定位
            this.getNormalLocation()
              .then(resolve)
              .catch(() => {
                // 最后尝试IP定位
                this.getIPLocation()
                  .then(resolve)
                  .catch(reject);
              });
          }
        }
      });
    });
  }

  /**
   * 普通定位（降级方案）
   */
  getNormalLocation() {
    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: (res) => {
          resolve({
            latitude: res.latitude,
            longitude: res.longitude,
            accuracy: res.accuracy || 50,
            speed: res.speed || 0,
            altitude: res.altitude || 0,
            timestamp: Date.now(),
            isHighAccuracy: false
          });
        },
        fail: reject
      });
    });
  }

  /**
   * IP定位（最后的降级方案）
   */
  getIPLocation() {
    return new Promise((resolve, reject) => {
      // 使用微信内置的IP定位
      wx.request({
        url: 'https://apis.map.qq.com/ws/location/v1/ip',
        data: {
          key: 'YOUR_TENCENT_MAP_KEY', // 需要申请腾讯地图key
          output: 'json'
        },
        success: (res) => {
          if (res.data.status === 0) {
            const location = res.data.result.location;
            resolve({
              latitude: location.lat,
              longitude: location.lng,
              accuracy: 500, // IP定位精度较低
              timestamp: Date.now(),
              isIPLocation: true
            });
          } else {
            reject(new Error('IP定位失败'));
          }
        },
        fail: reject
      });
    });
  }

  /**
   * 验证位置有效性
   */
  async validateLocation(location) {
    const checks = [];
    
    // 1. 坐标基本检查
    if (!this.isValidCoordinate(location.latitude, location.longitude)) {
      return { valid: false, reason: '坐标格式无效' };
    }

    // 2. 中国范围检查（防止定到国外）
    if (!this.isInChina(location.latitude, location.longitude)) {
      return { valid: false, reason: '定位超出中国范围' };
    }

    // 3. 精度检查
    if (location.accuracy > 200) {
      checks.push(`精度较低(${Math.round(location.accuracy)}米)`);
    }

    // 4. 速度合理性检查（正常步行/静止速度应该小于10m/s）
    if (location.speed > 10) {
      checks.push(`移动速度异常(${location.speed}m/s)`);
    }

    // 5. 与上次有效位置的距离检查
    if (this.lastValidLocation && this.isCacheValid()) {
      const distance = this.calculateDistance(
        this.lastValidLocation.latitude,
        this.lastValidLocation.longitude,
        location.latitude,
        location.longitude
      );
      
      // 时间差（秒）
      const timeDiff = (location.timestamp - this.lastValidTime) / 1000;
      
      // 计算理论最大移动距离（假设最快100km/h ≈ 27.8m/s）
      const maxDistance = timeDiff * 30;
      
      if (distance > Math.max(maxDistance, this.config.maxMoveDistance)) {
        return { 
          valid: false, 
          reason: `位置漂移过大(${Math.round(distance)}米)` 
        };
      }
    }

    // 5. 海拔检查（普通地区海拔应在0-5000米之间）
    if (location.altitude && (location.altitude < 0 || location.altitude > 5000)) {
      checks.push('海拔异常');
    }

    return {
      valid: checks.length === 0,
      reason: checks.length > 0 ? checks.join('; ') : '验证通过',
      checks: checks
    };
  }

  /**
   * 验证坐标是否有效
   */
  isValidCoordinate(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) 
      && lat >= -90 && lat <= 90 
      && lng >= -180 && lng <= 180
      && lat !== 0 && lng !== 0; // 排除0,0坐标
  }

  /**
   * 检查是否在中国范围内（粗略）
   */
  isInChina(lat, lng) {
    // 中国大致范围
    const chinaBounds = {
      minLat: 18.0,
      maxLat: 54.0,
      minLng: 73.0,
      maxLng: 135.0
    };
    
    return lat >= chinaBounds.minLat 
      && lat <= chinaBounds.maxLat 
      && lng >= chinaBounds.minLng 
      && lng <= chinaBounds.maxLng;
  }

  /**
   * 缓存有效位置
   */
  cacheValidLocation(location) {
    this.lastValidLocation = {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      timestamp: location.timestamp
    };
    this.lastValidTime = location.timestamp || Date.now();
  }

  /**
   * 检查缓存是否有效
   */
  isCacheValid() {
    return this.lastValidLocation 
      && (Date.now() - this.lastValidTime) < this.config.cacheExpireTime;
  }

  /**
   * 计算两点距离（Haversine公式）
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // 地球半径（米）
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(deg) {
    return deg * Math.PI / 180;
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.lastValidLocation = null;
    this.lastValidTime = 0;
  }
}

// 导出单例
module.exports = new LocationService();