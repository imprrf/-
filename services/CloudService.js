// onLaunch 期间 getApp() 尚不可用，App 自身调用时需显式传入 app。
async function call(name, data = {}, app = getApp()) {
  if (!app.ensureCloudReady()) throw new Error('云服务不可用');
  let response;
  try {
    response = await wx.cloud.callFunction({ name, data });
  } catch (error) {
    const failure = new Error('网络或云服务调用失败，请重试');
    failure.cause = error;
    throw failure;
  }
  const result = response && response.result;
  if (!result || !result.success) {
    const failure = new Error((result && result.message) || '服务端未完成操作');
    failure.isBusinessFailure = !!result && result.success === false;
    throw failure;
  }
  return result;
}
async function list(action, filters = {}) {
  const result = [];
  let offset = 0;
  while (true) {
    const page = await call('adminOps', {
      action,
      ...filters,
      offset,
      limit: 100
    });
    if (!Array.isArray(page.items) || (page.hasMore && page.items.length === 0)) {
      throw new Error('云端分页结果无效');
    }
    result.push(...page.items);
    if (!page.hasMore) return result;
    offset += page.items.length;
  }
}
module.exports = { call, list };
