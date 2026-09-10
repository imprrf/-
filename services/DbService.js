/**
 * services/DbService.js - 数据库服务
 * @description 使用本地存储进行数据持久化
 */

class DbService {
  constructor() {
    this.init();
  }

  init() {
    // 初始化存储键前缀
    this.prefix = 'attendance_';
  }

  getCloudDatabase() {
    try {
      const app = getApp();
      return app && app.getCloudDatabase ? app.getCloudDatabase() : null;
    } catch (e) {
      return null;
    }
  }

  normalizeQuery(query = {}) {
    const normalized = { ...query };
    if (normalized.openid) {
      normalized._openid = normalized.openid;
      delete normalized.openid;
    }
    return normalized;
  }

  normalizeData(data = {}) {
    const normalized = { ...data };
    if (normalized._openid && !normalized.openid) {
      normalized.openid = normalized._openid;
    }
    return normalized;
  }

  // 获取完整的存储键
  getKey(collectionName, id) {
    if (id) {
      return `${this.prefix}${collectionName}_${id}`;
    }
    return `${this.prefix}${collectionName}_ids`;
  }

  // 获取集合的所有ID
  getCollectionIds(collectionName) {
    const key = this.getKey(collectionName);
    const ids = wx.getStorageSync(key);
    return Array.isArray(ids) ? ids : [];
  }

  // 保存集合的所有ID
  saveCollectionIds(collectionName, ids) {
    const key = this.getKey(collectionName);
    wx.setStorageSync(key, ids);
  }

  // 生成唯一ID
  generateId() {
    return `id_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 查询单条记录
  async getOne(collectionName, query) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        const result = await db.collection(collectionName)
          .where(this.normalizeQuery(query))
          .limit(1)
          .get();
        return result.data.length ? this.normalizeData(result.data[0]) : null;
      }
      const ids = this.getCollectionIds(collectionName);
      
      for (const id of ids) {
        const item = wx.getStorageSync(this.getKey(collectionName, id));
        if (item && this.matchQuery(item, query)) {
          return item;
        }
      }
      return null;
    } catch (e) {
      console.error(`查询失败: ${collectionName}`, e);
      return null;
    }
  }

  // 查询多条记录
  async getList(collectionName, query = {}, options = {}) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        let request = db.collection(collectionName).where(this.normalizeQuery(query));
        if (options.orderBy) {
          request = request.orderBy(options.orderBy.field, options.orderBy.order);
        }
        if (options.skip) request = request.skip(options.skip);
        if (options.limit) request = request.limit(options.limit);
        const result = await request.get();
        return result.data.map(item => this.normalizeData(item));
      }
      const ids = this.getCollectionIds(collectionName);
      let result = [];
      
      for (const id of ids) {
        const item = wx.getStorageSync(this.getKey(collectionName, id));
        if (item && this.matchQuery(item, query)) {
          result.push(item);
        }
      }
      
      // 排序
      if (options.orderBy) {
        const { field, order } = options.orderBy;
        result.sort((a, b) => {
          const valA = a[field];
          const valB = b[field];
          if (order === 'desc') {
            return valB > valA ? 1 : valB < valA ? -1 : 0;
          }
          return valA > valB ? 1 : valA < valB ? -1 : 0;
        });
      }
      
      // 分页
      if (options.skip) {
        result = result.slice(options.skip);
      }
      if (options.limit) {
        result = result.slice(0, options.limit);
      }
      
      return result;
    } catch (e) {
      console.error(`查询失败: ${collectionName}`, e);
      return [];
    }
  }

  // 新增记录
  async add(collectionName, data) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        const cloudData = { ...data };
        delete cloudData._id;
        delete cloudData._openid;
        delete cloudData.openid;
        if (data._id) {
          await db.collection(collectionName).doc(data._id).set({ data: cloudData });
          return { success: true, id: data._id };
        }
        const result = await db.collection(collectionName).add({ data: cloudData });
        return { success: true, id: result._id };
      }
      const id = data._id || this.generateId();
      const newData = {
        ...data,
        _id: id,
        _createTime: Date.now()
      };
      
      // 保存数据
      wx.setStorageSync(this.getKey(collectionName, id), newData);
      
      // 更新ID列表
      const ids = this.getCollectionIds(collectionName);
      ids.push(id);
      this.saveCollectionIds(collectionName, ids);
      
      return { success: true, id };
    } catch (e) {
      console.error(`新增失败: ${collectionName}`, e);
      return { success: false, message: e.message };
    }
  }

  // 更新记录
  async update(collectionName, query, data) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        const cloudData = { ...data };
        delete cloudData._id;
        delete cloudData._openid;
        delete cloudData.openid;
        const result = await db.collection(collectionName)
          .where(this.normalizeQuery(query))
          .update({ data: cloudData });
        return { success: true, updated: result.stats.updated };
      }
      const ids = this.getCollectionIds(collectionName);
      let updated = 0;
      
      for (const id of ids) {
        const item = wx.getStorageSync(this.getKey(collectionName, id));
        if (item && this.matchQuery(item, query)) {
          const updatedItem = {
            ...item,
            ...data,
            _updateTime: Date.now()
          };
          wx.setStorageSync(this.getKey(collectionName, id), updatedItem);
          updated++;
        }
      }
      
      return { 
        success: true, 
        updated 
      };
    } catch (e) {
      console.error(`更新失败: ${collectionName}`, e);
      return { success: false, message: e.message };
    }
  }

  // 删除记录
  async remove(collectionName, query) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        const result = await db.collection(collectionName)
          .where(this.normalizeQuery(query))
          .remove();
        return { success: true, removed: result.stats.removed };
      }
      const ids = this.getCollectionIds(collectionName);
      let removed = 0;
      const newIds = [];
      
      for (const id of ids) {
        const item = wx.getStorageSync(this.getKey(collectionName, id));
        if (item && this.matchQuery(item, query)) {
          wx.removeStorageSync(this.getKey(collectionName, id));
          removed++;
        } else {
          newIds.push(id);
        }
      }
      
      this.saveCollectionIds(collectionName, newIds);
      
      return { success: true, removed };
    } catch (e) {
      console.error(`删除失败: ${collectionName}`, e);
      return { success: false, message: e.message };
    }
  }

  // 统计数量
  async count(collectionName, query = {}) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        const result = await db.collection(collectionName)
          .where(this.normalizeQuery(query))
          .count();
        return result.total;
      }
      const ids = this.getCollectionIds(collectionName);
      let count = 0;
      
      for (const id of ids) {
        const item = wx.getStorageSync(this.getKey(collectionName, id));
        if (item && this.matchQuery(item, query)) {
          count++;
        }
      }
      
      return count;
    } catch (e) {
      console.error(`统计失败: ${collectionName}`, e);
      return 0;
    }
  }

  // 匹配查询条件
  matchQuery(item, query) {
    if (!query || Object.keys(query).length === 0) {
      return true;
    }
    
    for (const key in query) {
      if (item[key] !== query[key]) {
        return false;
      }
    }
    
    return true;
  }
}

// 导出单例
module.exports = new DbService();
