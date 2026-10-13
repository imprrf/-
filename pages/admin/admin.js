const app = getApp();
const CloudService = require('../../services/CloudService');
const RecordModel = require('../../services/RecordModel');
Page({
  data: {
    isAdmin: false,
    memberRecords: [],
    appVersion: app.globalData.appVersion,
    hasMore: false,
    loading: false
  },
  onShow() {
    this.loadAllMembersData();
  },
  tapSystemConfig() {
    app.showError(`当前版本 ${app.globalData.appVersion}`);
  },
  async loadAllMembersData(append = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const date = RecordModel.dateStr();
      if (append && this._recordDate !== date) append = false;
      this._recordDate = date;
      const response = await CloudService.call('adminOps', {
        action: 'listAllRecords',
        startDate: date,
        endDate: date,
        offset: append ? this._offset || 0 : 0,
        limit: 50
      });
      this._offset = (append ? this._offset || 0 : 0) + response.items.length;
      const records = RecordModel.normalizeList(response.items);
      this.setData({
        isAdmin: true,
        memberRecords: append ? this.data.memberRecords.concat(records) : records,
        hasMore: response.hasMore
      });
    } catch (e) {
      this.setData({ memberRecords: [], isAdmin: false, hasMore: false });
      app.showError(e.message);
    } finally {
      this.setData({ loading: false });
    }
  },
  loadMore() {
    if (this.data.hasMore) this.loadAllMembersData(true);
  }
});
