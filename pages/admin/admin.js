// pages/admin/admin.js
const app = getApp();

Page({
  /**
   * 页面的初始数据
   */
  data: {
    clickCount: 0,
    isAdmin: false,
    memberRecords: [] // 存放团队全员的打卡记录
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    this.checkAdminStatus();

    if (this.data.isAdmin) {
      this.loadAllMembersData();
    }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 每次显示页面时都重新检查管理员状态
    this.checkAdminStatus();

    if (this.data.isAdmin) {
      this.loadAllMembersData();
    }
  },

  /**
   * 检查管理员状态（从全局数据读取最新状态）
   */
  checkAdminStatus() {
    const currentAdminStatus = app.globalData.isAdmin || false;

    this.setData({
      isAdmin: currentAdminStatus
    });
  },

  tapSystemConfig() {
    const version = (app.globalData && app.globalData.appVersion) || '1.0.2';
    wx.showToast({
      title: `当前版本 ${version}`,
      icon: 'none'
    });
  },

  /**
   * 管理员特权功能：从 records 总表中抓取全员的打卡记录
   */
  async loadAllMembersData() {
    if (!this.data.isAdmin) return;

    try {
      // 这里的 loading 可以公开，因为已经是管理员身份在看报表了
      wx.showLoading({ title: '更新团队数据...' });
      const db = app.getCloudDatabase();
      if (!db) {
        wx.hideLoading();
        return;
      }
      
      // 拉取全表最新的 50 条记录（由于之前你已经在云控制台放开了 records 表的“所有用户可读”，这里便能统揽全局）
      const res = await db.collection('records')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      this.setData({
        memberRecords: res.data
      });
      
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      console.error('获取全员打卡记录失败:', e);
      wx.showToast({ title: '数据同步失败', icon: 'none' });
    }
  }
});
