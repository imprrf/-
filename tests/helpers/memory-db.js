const clone = (value) => (value === undefined ? undefined : structuredClone(value));
class MemoryDatabase {
  constructor() {
    this.tables = new Map();
    this.queue = Promise.resolve();
    this.command = {
      gte: (value) => ({
        test: (actual) => actual >= value,
        and: (other) => ({ test: (actual) => actual >= value && other.test(actual) })
      }),
      lte: (value) => ({ test: (actual) => actual <= value })
    };
  }
  table(name) {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name);
  }
  collection(name) {
    const db = this;
    const makeQuery = (conditions = {}, orders = [], offset = 0, size = 20) => ({
      where: (conditions) => makeQuery(conditions, orders, offset, size),
      orderBy: (field, order) => makeQuery(conditions, [...orders, { field, order }], offset, size),
      skip: (offset) => makeQuery(conditions, orders, offset, size),
      limit: (size) => makeQuery(conditions, orders, offset, size),
      get: async () => {
        let values = [...db.table(name)].map(([id, data]) => ({ ...clone(data), _id: id }));
        values = values.filter((item) =>
          Object.entries(conditions).every(([key, value]) =>
            value && value.test ? value.test(item[key]) : item[key] === value
          )
        );
        values.sort((a, b) => {
          for (const { field, order } of orders) {
            const comparison = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0;
            if (comparison) return order === 'desc' ? -comparison : comparison;
          }
          return 0;
        });
        return { data: values.slice(offset, offset + size) };
      },
      update: async ({ data }) => {
        const matches = await makeQuery(conditions, orders, 0, Infinity).get();
        let updated = 0;
        for (const item of matches.data) {
          const current = db.table(name).get(item._id),
            next = { ...current, ...data };
          if (JSON.stringify(current) !== JSON.stringify(next)) {
            db.table(name).set(item._id, clone(next));
            updated++;
          }
        }
        return { stats: { updated } };
      },
      doc: (id) => ({
        get: async () => {
          const data = db.table(name).get(id);
          if (!data) throw new Error('document does not exist');
          return { data: { ...clone(data), _id: id } };
        },
        set: async ({ data }) => {
          const next = clone(data);
          delete next._id;
          db.table(name).set(id, next);
          return { stats: { updated: 1 } };
        },
        update: async ({ data }) => makeQuery({ _id: id }).update({ data })
      }),
      add: async ({ data }) => {
        const id = data._id || `auto_${db.table(name).size}`;
        if (db.table(name).has(id)) throw new Error('E11000 duplicate');
        const value = clone(data);
        delete value._id;
        db.table(name).set(id, value);
        return { _id: id };
      }
    });
    return makeQuery();
  }
  runTransaction(callback) {
    // 串行、回滚模型验证业务边界；真实 SDK 的冲突重试另做云端回归。
    const result = this.queue.then(async () => {
      const backup = clone(this.tables);
      try {
        return await callback(this);
      } catch (error) {
        this.tables = backup;
        throw error;
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }
}
module.exports = MemoryDatabase;
