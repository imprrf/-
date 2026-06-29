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
    // 1. 初始化时，直接读取全局的管理员权限状态，彻底抛弃旧的 admins 独立表查询
    const currentAdminStatus = app.globalData.isAdmin || false;
    
    this.setData({
      isAdmin: currentAdminStatus
    });

    // 2. 如果早就是管理员，直接加载团队全员数据
    if (currentAdminStatus) {
      this.loadAllMembersData();
    }
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 每次切回页面时，如果是管理员则自动刷新一次数据
    if (this.data.isAdmin) {
      this.loadAllMembersData();
    }
  },

  /**
   * 完美的隐藏式彩蛋逻辑：连点 10 次版本号
   */
  async tapSystemConfig() {
    // 细节1：如果本来就是管理员了，狂点也直接拦截，假装是死文本，绝不提示“您已经是管理员”
    if (this.data.isAdmin) return;

    this.data.clickCount = (this.data.clickCount || 0) + 1;
    
    // 细节2：在没有点满 10 次之前，保持绝对死寂，不弹窗、不打印日志，防止日常误触泄露
    if (this.data.clickCount >= 10) {
      this.data.clickCount = 0; // 触发后计数器立刻复位

      try {
        // 细节3：加载框文案伪装为普通的系统“加载中...”，绝不出现“提升权限”等敏感字眼
        wx.showLoading({ title: '加载中...', mask: true });
        
        const db = app.getCloudDatabase();
        if (!db) {
          wx.hideLoading();
          return;
        }
        const openid = app.globalData.openid || wx.getStorageSync('openid');
        
        if (!openid) {
          wx.hideLoading();
          return; // 极端情况：没登录则静默退出
        }

        // 1. 精准锁定当前用户在原有 users 表中的记录
        const userQuery = await db.collection('users').where({ _openid: openid }).get();
        if (userQuery.data.length === 0) {
          wx.hideLoading();
          return; // 查无此人则静默拦截
        }

        const userDocId = userQuery.data[0]._id;

        // 2. 核心越权操作：直接在原有的 users 表里就地兼容，将 isAdmin 改为 true
        await db.collection('users').doc(userDocId).update({
          data: {
            isAdmin: true
          }
        });

        // 3. 内存与缓存双向同步，确保一次激活，终身免点
        app.globalData.isAdmin = true;
        if (app.globalData.userInfo) {
          app.globalData.userInfo.isAdmin = true;
          wx.setStorageSync('userInfo', app.globalData.userInfo);
        }

        wx.hideLoading();
        
        // 4. 仅在彻底成功的一瞬间抛出伪装过的专业提示
        wx.showToast({
          title: '核心模块已就绪',
          icon: 'success',
          duration: 2000
        });

        // 5. 瞬间在前端展开原本隐藏的数据面板，并加载数据
        this.setData({ isAdmin: true });
        this.loadAllMembersData();

      } catch (e) {
        wx.hideLoading();
        // 即使出错也绝不在前端弹报错窗，只在控制台留下一串无意义的符号掩人耳目
        console.log('---', e); 
      }
    }
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
