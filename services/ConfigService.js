/**
 * services/ConfigService.js - 配置服务
 * @description 考勤配置管理：获取、更新考勤规则、考勤地点等
 */

const DbService = require('./DbService');

class ConfigService {
  constructor() {
    this.collectionName = 'config';
    this.defaultConfig = {
      _id: 'main_config',
      // 考勤时间配置
      workStartTime: '09:00',      // 上班时间
      workEndTime: '18:00',         // 下班时间
      lateMinutes: 0,              // 迟到宽限（分钟）
      earlyMinutes: 0,             // 早退宽限（分钟）
      
      // 定位配置
      location: {
        latitude: 31.230416,       // 默认经度（上海）
        longitude: 121.473701,      // 默认纬度
        radius: 300,                // 考勤半径（米）
        name: '默认考勤地点'         // 考勤地点名称
      },
      
      // 高级配置
      allowRemoteClockIn: false,   // 是否允许远程打卡
      clockInLimit: 1,             // 每日打卡次数限制（0表示不限）
      
      // 更新信息
      updateTime: Date.now()
    };
  }

  // 获取配置
  async getConfig() {
    try {
      // 从数据库获取
      const config = await DbService.getOne(this.collectionName, { _id: 'main_config' });
      
      if (config) {
        // 合并默认配置
        const mergedConfig = { ...this.defaultConfig, ...config };
        wx.setStorageSync('attendanceConfig', mergedConfig);
        return mergedConfig;
      } else {
        // 初始化配置
        await this.initConfig();
        return this.defaultConfig;
      }
    } catch (e) {
      console.log('获取配置失败，使用默认配置', e);
      return this.defaultConfig;
    }
  }

  // 初始化配置
  async initConfig() {
    try {
      await DbService.add(this.collectionName, this.defaultConfig);
      wx.setStorageSync('attendanceConfig', this.defaultConfig);
    } catch (e) {
      console.log('初始化配置失败', e);
    }
  }

  // 更新配置
  async updateConfig(config) {
    try {
      const updateData = {
        ...this.defaultConfig,
        ...config,
        _id: 'main_config',
        updateTime: Date.now()
      };

      // 更新到数据库
      const existConfig = await DbService.getOne(this.collectionName, { _id: 'main_config' });
      
      if (existConfig) {
        await DbService.update(
          this.collectionName,
          { _id: 'main_config' },
          updateData
        );
      } else {
        await DbService.add(this.collectionName, updateData);
      }

      // 更新本地存储
      wx.setStorageSync('attendanceConfig', updateData);

      return { success: true, config: updateData };
    } catch (e) {
      console.log('更新配置失败', e);
      
      // 仅更新本地存储
      const localConfig = { ...this.defaultConfig, ...config };
      wx.setStorageSync('attendanceConfig', localConfig);
      
      return { success: true, config: localConfig };
    }
  }

  // 更新考勤时间
  async updateWorkTime(workStartTime, workEndTime) {
    return await this.updateConfig({
      workStartTime,
      workEndTime
    });
  }

  // 更新考勤地点
  async updateLocation(location) {
    const currentConfig = await this.getConfig();
    return await this.updateConfig({
      ...currentConfig,
      location
    });
  }

  // 重置配置
  async resetConfig() {
    return await this.updateConfig(this.defaultConfig);
  }

  // 获取考勤规则说明
  getRulesDescription() {
    return `
      考勤规则：
      1. 上班时间：${this.defaultConfig.workStartTime}
      2. 下班时间：${this.defaultConfig.workEndTime}
      3. 考勤范围：${this.defaultConfig.location.radius}米
      4. 考勤地点：${this.defaultConfig.location.name}
    `;
  }
}

module.exports = new ConfigService();
