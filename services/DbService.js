/**
 * services/DbService.js - 数据库服务
 * @description 云数据库分页访问与本地等值查询降级；云端错误不会切换为本地成功。
 * 云端写入由 SDK 生成 _openid，查询将 openid 映射为 _openid，读取补回 openid。
 * 本地写入保留 openid；本地仅支持等值与嵌套字段，不支持 SDK 指令。
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
        // 如果查询条件只有 _id，直接用 doc() 查询（避免自动添加 _openid 限制）
        if (query._id && Object.keys(query).length === 1) {
          const result = await db.collection(collectionName).doc(query._id).get();
          const data = result.data ? this.normalizeData(result.data) : null;
          return data;
        }

        // 其他情况用 where() 查询
        const result = await db
          .collection(collectionName)
          .where(this.normalizeQuery(query))
          .limit(1)
          .get();
        const data = result.data.length ? this.normalizeData(result.data[0]) : null;
        return data;
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
        const result = [];
        const maximum = options.limit === undefined ? Infinity : Math.max(0, options.limit);
        let offset = options.skip || 0;
        // 小程序端按 20 条翻页；缺省取全量，不依赖 SDK 的默认上限。
        while (result.length < maximum) {
          let request = db.collection(collectionName).where(this.normalizeQuery(query));
          if (options.orderBy)
            request = request.orderBy(options.orderBy.field, options.orderBy.order);
          if (!options.orderBy || options.orderBy.field !== '_id')
            request = request.orderBy('_id', 'asc');
          const size = Math.min(20, maximum - result.length);
          const page = await request.skip(offset).limit(size).get();
          result.push(...page.data.map((item) => this.normalizeData(item)));
          if (page.data.length < size) break;
          offset += page.data.length;
        }
        return result;
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
      if (options.limit !== undefined) {
        result = result.slice(0, options.limit);
      }

      return result;
    } catch (e) {
      console.error(`查询失败: ${collectionName}`, e);
      if (options.throwOnError) throw e;
      return [];
    }
  }

  // 新增记录（如果有 _id，改用 set 实现 upsert 效果）
  async add(collectionName, data) {
    try {
      const db = this.getCloudDatabase();
      if (db) {
        const cloudData = { ...data };
        delete cloudData._id;
        delete cloudData._openid;
        delete cloudData.openid;
        if (data._id) {
          // 对于指定 _id 的插入，用 set 做到"有则覆盖、无则创建"
          await db.collection(collectionName).doc(data._id).set({ data: cloudData });
          return { success: true, id: data._id };
        }
        // 无 _id 时才用 add（自动生成 _id）
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
      if (!ids.includes(id)) ids.push(id);
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

        // 对于有 _id 的精确查询，使用 doc().update 确保原子性
        if (query._id && Object.keys(query).length === 1) {
          const result = await db
            .collection(collectionName)
            .doc(query._id)
            .update({ data: cloudData });
          // 读取真实的更新数量，而不是硬编码 1
          const updated = result.stats ? result.stats.updated : 0;
          if (updated > 0) return { success: true, updated };
          let existing;
          try {
            existing = (await db.collection(collectionName).doc(query._id).get()).data;
          } catch (error) {
            if (
              !/document.*(not exist|not found)|文档不存在/i.test(
                error.message || error.errMsg || String(error)
              )
            )
              throw error;
          }
          return {
            success: !!existing,
            updated,
            reason: existing ? 'unchanged' : 'missing'
          };
        }

        const result = await db
          .collection(collectionName)
          .where(this.normalizeQuery(query))
          .update({ data: cloudData });
        const updated = result.stats ? result.stats.updated : 0;
        return { success: updated > 0, updated };
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
        success: updated > 0,
        updated,
        reason: updated > 0 ? undefined : 'missing'
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
        const result = await db
          .collection(collectionName)
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
        const result = await db
          .collection(collectionName)
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
      const value = key
        .split('.')
        .reduce((current, part) => current && current[part], this.normalizeData(item));
      if (query[key] && typeof query[key] === 'object') {
        throw new Error('本地模式仅支持等值查询，不支持数组、区间或 SDK 指令');
      }
      const queryKey = key === '_openid' ? item._openid || item.openid : value;
      if (queryKey !== query[key]) {
        return false;
      }
    }

    return true;
  }
}

// 导出单例
module.exports = new DbService();
