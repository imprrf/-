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
  },
  onExport() {
    if (this._exporting) return;
    const ranges = [
      ['all', '全部'],
      ['week', '近一周'],
      ['month', '近一个月']
    ];
    const formats = [
      ['xlsx', 'Excel'],
      ['docx', 'Word']
    ];
    wx.showActionSheet({
      itemList: ranges.map((r) => r[1]),
      success: (rangeRes) => {
        wx.showActionSheet({
          itemList: formats.map((f) => f[1]),
          success: (formatRes) =>
            this.exportRecords(ranges[rangeRes.tapIndex][0], formats[formatRes.tapIndex][0])
        });
      }
    });
  },
  async exportRecords(range, format) {
    this._exporting = true;
    wx.showLoading({ title: '正在生成...', mask: true });
    try {
      const result = await CloudService.call('adminOps', {
        action: 'exportRecords',
        range,
        format
      });
      const file = await new Promise((resolve, reject) =>
        wx.cloud.downloadFile({ fileID: result.fileID, success: resolve, fail: reject })
      );
      wx.openDocument({
        filePath: file.tempFilePath,
        fileType: format,
        showMenu: true,
        fail: () => app.showError('文件已生成，但打开失败')
      });
    } catch (e) {
      app.showError((e && e.message) || '导出失败，请重试');
    } finally {
      wx.hideLoading();
      this._exporting = false;
    }
  }
});
