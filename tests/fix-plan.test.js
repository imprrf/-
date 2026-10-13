const test = require('node:test');
const assert = require('node:assert/strict');
const MemoryDatabase = require('./helpers/memory-db');
const core = require('../cloudfunctions/_shared/core');
const model = require('../services/RecordModel');
const storage = new Map();
const app = { globalData: { openid: 'alice' }, getCloudDatabase: () => null };
global.getApp = () => app;
global.wx = {
  getStorageSync: (key) => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value)
};
const dbService = require('../services/DbService');
const checkinService = require('../services/CheckinService');
const now = Date.parse('2026-10-12T02:00:00Z');
async function fixture() {
  const db = new MemoryDatabase();
  await db
    .collection('users')
    .doc('alice')
    .set({ data: { _openid: 'alice', name: 'Alice', role: 'admin' } });
  await db
    .collection('users')
    .doc('bob')
    .set({ data: { _openid: 'bob', name: 'Bob', role: 'member' } });
  await db
    .collection('config')
    .doc('main_config')
    .set({
      data: {
        workStartTime: '09:00',
        workEndTime: '18:00',
        lateMinutes: 5,
        earlyMinutes: 5,
        location: { latitude: 29.5, longitude: 106.2, radius: 300, name: '实验室' }
      }
    });
  return db;
}
test('分页读取超过 20 条与 1000 条，显式 limit/skip 保持准确', async () => {
  const db = new MemoryDatabase();
  app.getCloudDatabase = () => db;
  for (let i = 0; i < 1025; i++)
    db.table('records').set(String(i).padStart(5, '0'), { _openid: 'alice', date: '2026-10-12' });
  assert.equal((await dbService.getList('records', { openid: 'alice' })).length, 1025);
  assert.equal(
    (await dbService.getList('records', { openid: 'alice' }, { skip: 20, limit: 25 })).length,
    25
  );
  assert.equal((await dbService.getList('records', {}, { limit: 0 })).length, 0);
  app.getCloudDatabase = () => null;
});
test('按 _id 更新必须保留额外条件，缺失与无变化可区分', async () => {
  const db = new MemoryDatabase();
  app.getCloudDatabase = () => db;
  db.table('records').set('one', { _openid: 'alice', value: 1 });
  assert.equal(
    (await dbService.update('records', { _id: 'one', openid: 'bob' }, { value: 2 })).updated,
    0
  );
  const unchanged = await dbService.update('records', { _id: 'one' }, { value: 1 });
  assert.equal(unchanged.reason, 'unchanged');
  assert.equal(unchanged.success, true);
  const missing = await dbService.update('records', { _id: 'missing' }, { value: 1 });
  assert.equal(missing.success, false);
  assert.equal(missing.reason, 'missing');
  app.getCloudDatabase = () => null;
});
test('openid 云端与本地映射一致；本地 upsert 不重复 ID', async () => {
  storage.clear();
  await dbService.add('records', { _id: 'one', openid: 'alice', value: 1 });
  await dbService.add('records', { _id: 'one', openid: 'alice', value: 2 });
  assert.equal((await dbService.getOne('records', { openid: 'alice' })).value, 2);
  assert.equal((await dbService.getList('records', { _openid: 'alice' })).length, 1);
  assert.equal(
    (await dbService.update('records', { _id: 'missing' }, { value: 3 })).success,
    false
  );
});
test('并发注册只生成一个首管理员，同一人注册不会重复', async () => {
  const db = new MemoryDatabase();
  const results = await Promise.all([
    core.login(db, 'first', now),
    core.login(db, 'second', now),
    core.login(db, 'first', now)
  ]);
  assert.equal(db.table('users').size, 2);
  assert.equal([...db.table('users').values()].filter((u) => u.role === 'admin').length, 1);
  assert.equal(results[0].user.role, 'admin');
});
test('资料保存剥离角色、身份与保留字段，返回服务端角色', async () => {
  const db = await fixture();
  const result = await core.updateProfile(
    db,
    'bob',
    { profile: { name: 'New Bob', role: 'admin', isAdmin: true, _openid: 'alice', _id: 'alice' } },
    now
  );
  assert.equal(result.user.role, 'member');
  assert.equal(result.user._openid, 'bob');
  assert.equal(db.table('users').get('bob').name, 'New Bob');
});
test('普通成员伪造管理员参数仍拒绝列表、改角色与配置写入', async () => {
  const db = await fixture();
  for (const action of ['listUsers', 'listAllRecords', 'setRole', 'updateConfig']) {
    await assert.rejects(
      core.adminOps(db, 'bob', { action, isAdmin: true, role: 'admin', openid: 'bob' }, now),
      /无管理员权限/
    );
  }
});
test('管理员角色与完整审计日志原子提交，禁止自撤销', async () => {
  const db = await fixture();
  await core.adminOps(db, 'alice', { action: 'setRole', openid: 'bob', role: 'admin' }, now);
  assert.equal(db.table('users').get('bob').role, 'admin');
  const log = [...db.table('roleLogs').values()][0];
  assert.equal(log.actorOpenid, 'alice');
  assert.equal(log.targetOpenid, 'bob');
  assert.equal(log.oldRole, 'member');
  assert.equal(log.newRole, 'admin');
  await assert.rejects(
    core.adminOps(db, 'alice', { action: 'setRole', openid: 'alice', role: 'member' }, now),
    /自己/
  );
});
test('并发互相撤销权限后至少保留一个管理员', async () => {
  const db = await fixture();
  await core.adminOps(db, 'alice', { action: 'setRole', openid: 'bob', role: 'admin' }, now);
  const results = await Promise.allSettled([
    core.adminOps(db, 'alice', { action: 'setRole', openid: 'bob', role: 'member' }, now + 1),
    core.adminOps(db, 'bob', { action: 'setRole', openid: 'alice', role: 'member' }, now + 1)
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal([...db.table('users').values()].filter((u) => u.role === 'admin').length, 1);
});
test('配置保存仅接受地点字段，忽略旧排班参数，失败时不改变地点', async () => {
  const db = await fixture();
  const location = { latitude: 29.5, longitude: 106.2, radius: 500, name: '工作室' };
  await core.adminOps(
    db,
    'alice',
    {
      action: 'updateConfig',
      config: { location, lateMinutes: 10, workEndTime: '08:00', _openid: 'bob' }
    },
    now
  );
  assert.equal(db.table('config').get('main_config').location.radius, 500);
  assert.equal(db.table('config').get('main_config').lateMinutes, 5);
  assert.equal(db.table('config').get('main_config')._openid, undefined);
  await assert.rejects(
    core.adminOps(
      db,
      'alice',
      {
        action: 'updateConfig',
        config: { location: { ...location, radius: -1 } }
      },
      now
    ),
    /考勤地点配置无效/
  );
  assert.equal(db.table('config').get('main_config').location.radius, 500);
});
test('软距离校验不拒绝超范围，服务端时间写入且不判定迟到', async () => {
  const db = await fixture();
  const result = await core.checkin(
    db,
    'bob',
    {
      requestId: 'request_0001',
      timestamp: 0,
      openid: 'alice',
      location: { latitude: 30, longitude: 107, accuracy: 50 }
    },
    now
  );
  assert.equal(result.record._openid, 'bob');
  assert.equal(result.record.date, '2026-10-12');
  assert.equal(result.record.checkInTime, '10:00');
  assert.equal(result.record.lateMinutes, undefined);
  assert.equal(result.record.earlyMinutes, undefined);
  assert.equal(result.message, '进入打卡成功 (10:00)');
  assert.equal(result.record.outOfRange, true);
  assert.equal(result.record.status, 'Incomplete');
});
test('同请求与不同请求并发只签到一次，超时重试不误签退', async () => {
  const db = await fixture();
  const responses = await Promise.all(
    ['request_0001', 'request_0002', 'request_0001'].map((requestId) =>
      core.checkin(db, 'bob', { requestId }, now)
    )
  );
  assert.equal(db.table('records').size, 1);
  assert.ok(responses.every((r) => r.type === 'in'));
  const retry = await core.checkin(db, 'bob', { requestId: 'request_0001' }, now + 60000);
  assert.equal(retry.type, 'in');
  assert.equal(db.table('records').size, 1);
});
test('签退更新同一记录，停留时长准确，多次进出保留', async () => {
  const db = await fixture();
  await core.checkin(db, 'bob', { requestId: 'request_0001' }, now);
  const out = await core.checkin(db, 'bob', { requestId: 'request_0002' }, now + 7 * 3600000);
  assert.equal(out.type, 'out');
  assert.equal(out.record.durationMinutes, 420);
  assert.equal(out.record.earlyMinutes, undefined);
  assert.equal(out.record.attendanceStatus, undefined);
  assert.equal(out.message, '离开打卡成功 (17:00)');
  assert.equal(db.table('records').size, 1);
  await core.checkin(db, 'bob', { requestId: 'request_0003' }, now + 7 * 3600000 + 60000);
  assert.equal(db.table('records').size, 2);
});
test('缺失定位允许且标记，非法定位拒绝不产生记录', async () => {
  const db = await fixture();
  await assert.rejects(
    core.checkin(
      db,
      'bob',
      { requestId: 'request_0001', location: { latitude: 91, longitude: 0 } },
      now
    ),
    /定位数据无效/
  );
  assert.equal(db.table('records').size, 0);
  const result = await core.checkin(db, 'bob', { requestId: 'request_0002' }, now);
  assert.equal(result.record.locationUnavailable, true);
  assert.equal(result.record.checkInLocation, undefined);
});
test('北京时间日期边界与已过未签退展示一致', () => {
  assert.equal(core.dateParts(Date.parse('2026-10-12T16:00:00Z')).date, '2026-10-13');
  assert.equal(model.dateStr(new Date('2026-10-12T16:00:00Z')), '2026-10-13');
  assert.equal(
    model.pairs([{ date: '2020-01-01', status: 'Incomplete', checkInTime: '09:00' }])[0].outTime,
    '未记录离开'
  );
  const paired = model.pairs([
    { date: '2020-01-01', type: 'in', time: '09:00', timestamp: 1000 },
    { date: '2020-01-01', type: 'out', time: '10:00', timestamp: 3601000 }
  ]);
  assert.equal(paired.length, 1);
  assert.equal(paired[0].durationMinutes, 60);
});
test('到访按日期去重，周末同样计入，未来记录忽略，不统计缺勤或迟到早退', async () => {
  const records = model.normalizeList([
    { date: '2020-01-06', checkInTime: '09:00', lateMinutes: 5, outOfRange: true },
    { date: '2020-01-06', checkInTime: '10:00', earlyMinutes: 10 },
    { date: '2020-01-04', checkInTime: '09:00' },
    { date: '2099-01-01', checkInTime: '09:00' }
  ]);
  const stats = await checkinService.getStatistics(2020, 1, undefined, records);
  assert.equal(stats.presentDays, 2);
  assert.equal(stats.visitCount, 3);
  for (const key of ['absentDays', 'workDays', 'lateDays', 'earlyDays'])
    assert.equal(key in stats, false);
  assert.equal(stats.outOfRangeDays, 1);
  assert.equal(model.calendarStatus(records, '2020-01-06'), 'normal');
  assert.equal(model.calendarStatus(records, '2020-01-07'), '');
});
test('任意时间可进入与离开，旧排班字段缺失或无效也不阻止打卡', async () => {
  for (const time of ['00:01', '08:59', '09:00', '18:00', '23:59']) {
    const db = await fixture();
    const timestamp = Date.parse(`2026-10-12T${time}:00+08:00`);
    const entry = await core.checkin(db, 'bob', { requestId: 'request_entry' }, timestamp);
    const exit = await core.checkin(db, 'bob', { requestId: 'request_exit' }, timestamp + 6000);
    assert.equal(entry.type, 'in');
    assert.equal(exit.type, 'out');
    assert.equal(entry.time, time);
    assert.equal(/迟到|早退/.test(entry.message + exit.message), false);
  }
  for (const schedule of [
    { workStartTime: 'bad', workEndTime: null },
    { workStartTime: '22:00', workEndTime: '06:00' },
    { workStartTime: undefined, workEndTime: undefined }
  ]) {
    const db = await fixture();
    Object.assign(db.table('config').get('main_config'), schedule);
    assert.equal(
      (await core.checkin(db, 'bob', { requestId: 'request_entry' }, now)).success,
      true
    );
  }
});

test('重试历史收据不再展示旧迟到提示', async () => {
  const db = await fixture();
  await core.checkin(db, 'bob', { requestId: 'request_0001' }, now);
  const receipt = [...db.table('checkin_requests').values()][0];
  receipt.result.message += ' · 迟到';
  assert.equal(
    (await core.checkin(db, 'bob', { requestId: 'request_0001' }, now)).message,
    '进入打卡成功 (10:00)'
  );
});

test('已成功的打卡重试不受后续配置变化影响', async () => {
  const db = await fixture();
  const original = await core.checkin(db, 'bob', { requestId: 'request_0001' }, now);
  db.table('config').delete('main_config');
  const replay = await core.checkin(
    db,
    'bob',
    { requestId: 'request_0001', location: { latitude: 999 } },
    now + 3600000
  );
  assert.deepEqual(replay, original);
  assert.equal(db.table('records').size, 1);
});

test('旧事件配对按用户和日期隔离，不串联团队成员', () => {
  const records = model.normalizeList([
    { _openid: 'alice', date: '2020-01-01', type: 'in', time: '09:00', timestamp: 1000 },
    { _openid: 'bob', date: '2020-01-01', type: 'in', time: '10:00', timestamp: 2000 },
    { _openid: 'alice', date: '2020-01-01', type: 'out', time: '11:00', timestamp: 3601000 },
    { _openid: 'bob', date: '2020-01-01', type: 'out', time: '12:00', timestamp: 7202000 }
  ]);
  assert.equal(records.find((r) => r.openid === 'alice').durationMinutes, 60);
  assert.equal(records.find((r) => r.openid === 'bob').durationMinutes, 120);
  assert.equal(
    model.normalize({ date: '2020-01-01', clockIn: '09:00', clockOut: '18:00', duration: 540 })
      .outTime,
    '18:00'
  );
});
test('管理员分页与日期/成员过滤准确，盘点只返回数量', async () => {
  const db = await fixture();
  for (let i = 0; i < 125; i++)
    db.table('records').set(String(i).padStart(4, '0'), {
      _openid: 'bob',
      date: '2026-10-12',
      checkInTime: '09:00'
    });
  db.table('records').set('other', { _openid: 'alice', date: '2026-09-01', clockIn: '09:00' });
  const filter = {
    action: 'listAllRecords',
    openid: 'bob',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    limit: 100
  };
  const first = await core.adminOps(db, 'alice', filter, now),
    second = await core.adminOps(db, 'alice', { ...filter, offset: 100 }, now);
  assert.equal(first.items.length, 100);
  assert.equal(second.items.length, 25);
  assert.equal(second.hasMore, false);
  const audit = await core.adminOps(db, 'alice', { action: 'auditRecordSchemas' }, now);
  assert.equal(audit.counts.formatB, 125);
  assert.equal(audit.counts.formatA, 1);
});
test('查询失败抛出，不能将权限拒绝冒充空记录成功', async () => {
  app.getCloudDatabase = () => ({
    collection: () => {
      throw new Error('permission denied');
    }
  });
  const errorLog = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      dbService.getList('records', {}, { throwOnError: true }),
      /permission denied/
    );
  } finally {
    app.getCloudDatabase = () => null;
    console.error = errorLog;
  }
});
test('前端网络失败保留请求 ID，再次点击复用且成功后清理', async () => {
  const vm = require('node:vm'),
    fs = require('node:fs'),
    path = require('node:path');
  const { createRequire } = require('node:module');
  const sourcePath = path.resolve(__dirname, '../pages/index/index.js');
  app.globalData.isLogin = true;
  app.ensureCloudReady = () => true;
  app.getLocation = async () => ({ latitude: 29.5, longitude: 106.2 });
  app.showError = () => {};
  wx.showLoading = wx.hideLoading = () => {};
  wx.removeStorageSync = (key) => storage.delete(key);
  let page;
  vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), {
    getApp: () => app,
    require: createRequire(sourcePath),
    wx,
    Page: (definition) => {
      page = definition;
    },
    console,
    Date,
    Math,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  });
  page.data = { canClock: true };
  page.setData = (data) => Object.assign(page.data, data);
  page.loadTodayRecords = async () => {};
  page.showCheckinResult = () => {};
  let failed = true;
  const ids = [];
  wx.cloud = {
    callFunction: async ({ data }) => {
      ids.push(data.requestId);
      if (failed) throw new Error('timeout');
      return { result: { success: true, message: '成功' } };
    }
  };
  await page.onClock();
  assert.ok(storage.get('pending_checkin_alice'));
  failed = false;
  await page.onClock();
  assert.equal(ids[0], ids[1]);
  assert.equal(storage.get('pending_checkin_alice'), undefined);
  assert.equal(page.data.canClock, true);
});
