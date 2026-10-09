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
      console.log('[ConfigService.initConfig] 开始初始化配置');
      // 先检查配置是否已存在
      const existConfig = await DbService.getOne(this.collectionName, { _id: 'main_config' });
      console.log('[ConfigService.initConfig] 检查结果:', existConfig ? '已存在' : '不存在');

      if (existConfig) {
        // 已存在，不需要初始化
        console.log('[ConfigService.initConfig] 配置已存在，跳过初始化');
        wx.setStorageSync('attendanceConfig', existConfig);
        return;
      }

      // 不存在才新增
      console.log('[ConfigService.initConfig] 配置不存在，开始新增');
      await DbService.add(this.collectionName, this.defaultConfig);
      wx.setStorageSync('attendanceConfig', this.defaultConfig);
      console.log('[ConfigService.initConfig] 初始化完成');
    } catch (e) {
      console.log('[ConfigService.initConfig] 初始化配置失败', e);
    }
  }

  // 更新配置
  async updateConfig(config) {
    try {
      console.log('[ConfigService] 开始更新配置，传入参数:', config);

      // 先获取当前配置，再合并新配置
      const existConfig = await DbService.getOne(this.collectionName, { _id: 'main_config' });
      console.log('[ConfigService] 当前配置:', existConfig);

      const updateData = {
        ...this.defaultConfig,
        ...(existConfig || {}),  // 保留现有配置
        ...config,                // 覆盖传入的配置
        _id: 'main_config',
        updateTime: Date.now()
      };
      console.log('[ConfigService] 合并后的配置:', updateData);

      // 更新到数据库
      let result;
      if (existConfig) {
        console.log('[ConfigService] 执行更新操作');
        result = await DbService.update(
          this.collectionName,
          { _id: 'main_config' },
          updateData
        );
      } else {
        console.log('[ConfigService] 执行新增操作');
        result = await DbService.add(this.collectionName, updateData);
      }

      console.log('[ConfigService] 数据库操作结果:', result);

      if (!result || !result.success) {
        console.error('[ConfigService] 保存失败:', result);
        return {
          success: false,
          message: result && result.message ? result.message : '配置保存失败'
        };
      }

      // 更新本地存储
      wx.setStorageSync('attendanceConfig', updateData);
      console.log('[ConfigService] 配置保存成功');

      return { success: true, config: updateData };
    } catch (e) {
      console.error('[ConfigService] 更新配置异常:', e);
      return { success: false, message: '配置保存失败: ' + (e.message || e) };
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
