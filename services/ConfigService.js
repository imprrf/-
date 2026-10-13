const DbService = require('./DbService');
const CloudService = require('./CloudService');
class ConfigService {
  constructor() {
    this.defaultConfig = {
      _id: 'main_config',
      location: {
        latitude: 29.55565896,
        longitude: 106.23342499,
        radius: 300,
        name: '璧山机电大学高能束实验室'
      }
    };
  }
  async getConfig() {
    const config = await DbService.getOne('config', { _id: 'main_config' });
    // 客户端只读，缺失配置使用展示默认值；初始化必须由管理员云函数完成。
    const merged = { ...this.defaultConfig, ...(config || {}) };
    wx.setStorageSync('attendanceConfig', merged);
    return merged;
  }
  async updateConfig(config) {
    try {
      const result = await CloudService.call('adminOps', {
        action: 'updateConfig',
        config
      });
      wx.setStorageSync('attendanceConfig', result.config);
      return result;
    } catch (e) {
      return { success: false, message: e.message };
    }
  }
  async updateLocation(location) {
    return this.updateConfig({ location });
  }
  async resetConfig() {
    return this.updateConfig(this.defaultConfig);
  }
  getRulesDescription() {
    const config = wx.getStorageSync('attendanceConfig') || this.defaultConfig;
    return `可在任意时间记录进入和离开；地点：${config.location.name}；参考范围：${config.location.radius}米`;
  }
}
module.exports = new ConfigService();
