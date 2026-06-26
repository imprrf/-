/**
 * pages/admin/userList.js - 成员管理页面逻辑
 * @description 管理团队成员、查看考勤记录、设置管理员
 */

const app = getApp();
const DbService = require('../../services/DbService');

Page({
  data: {
    // 搜索关键字
    searchKey: '',
    
    // 成员列表
    users: [],
    
    // 加载状态
    loading: false
  },

  onLoad() {
    this.checkAdmin();
    this.loadUsers();
  },

  onShow() {
    this.checkAdmin();
  },

  // 检查管理员权限
  checkAdmin() {
    if (!app.globalData.isAdmin) {
      wx.showToast({
        title: '无权限访问',
        icon: 'none'
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }
  },

  // 加载成员列表
  async loadUsers() {
    this.setData({ loading: true });

    try {
      const users = await DbService.getList('users', {}, {
        orderBy: { field: 'createTime', order: 'desc' }
      });

      // 处理用户数据
      const processedUsers = users.map(user => ({
        ...user,
        createTimeStr: this.formatDate(user.createTime),
        stats: user.stats || { presentDays: 0, lateDays: 0, earlyDays: 0 }
      }));

      // 如果有搜索关键字，进行过滤
      const filteredUsers = this.filterUsers(processedUsers, this.data.searchKey);

      this.setData({
        users: filteredUsers,
        loading: false
      });
    } catch (e) {
      console.log('加载成员失败', e);
      this.setData({ loading: false });
    }
  },

  // 格式化日期
  formatDate(timestamp) {
    if (!timestamp) return '未知';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 过滤用户
  filterUsers(users, key) {
    if (!key) return users;
    
    const lowerKey = key.toLowerCase();
    return users.filter(user => {
      const name = (user.name || '').toLowerCase();
      const phone = (user.phone || '').toLowerCase();
      return name.includes(lowerKey) || phone.includes(lowerKey);
    });
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({
      searchKey: e.detail.value
    });
  },

  // 搜索
  onSearch() {
    this.loadUsers();
  },

  // 查看打卡记录
  onViewRecords(e) {
    const user = e.currentTarget.dataset.user;
    
    wx.showModal({
      title: '打卡记录',
      content: `查看 ${user.name || '未知'} 的打卡记录功能开发中...`,
      showCancel: false
    });
  },

  // 切换管理员权限
  async onToggleAdmin(e) {
    const user = e.currentTarget.dataset.user;
    const action = user.isAdmin ? '取消' : '设置';
    
    wx.showModal({
      title: '确认操作',
      content: `确定要${action} ${user.name || '该成员'} 为管理员吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            await DbService.update('users', {
              openid: user.openid
            }, {
              isAdmin: !user.isAdmin
            });
            
            app.showSuccess('操作成功');
            this.loadUsers();
          } catch (e) {
            console.log('更新失败', e);
            app.showError('操作失败');
          }
        }
      }
    });
  }
});