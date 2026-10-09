/**
 * pages/admin/userList.js - 成员管理页面逻辑
 * @description 管理团队成员、查看考勤记录、设置管理员
 */

const app = getApp();
const DbService = require('../../services/DbService');
const CheckinService = require('../../services/CheckinService');

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
    const currentUser = app.globalData.userInfo || {};
    const isAdmin = app.isUserAdmin ? app.isUserAdmin(currentUser) : !!app.globalData.isAdmin;
    if (!isAdmin) {
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
      let users = [];
      const db = app.getCloudDatabase();
      if (db) {
        try {
          const cloudResult = await db.collection('users')
            .limit(1000)  // 设置合理的上限，避免数据过大
            .get();
          users = cloudResult.data.map(cloudUser => ({
            ...cloudUser,
            openid: cloudUser._openid || cloudUser.openid,
            name: cloudUser.name || cloudUser.realName || '',
            role: cloudUser.role || (cloudUser.isAdmin ? 'admin' : 'member'),
            isAdmin: cloudUser.role === 'admin' || !!cloudUser.isAdmin,
            createTime: cloudUser.createTime || cloudUser._createTime || Date.now()
          }));
        } catch (e) {
          console.log('从云数据库同步用户失败', e);
        }
      }

      if (!users.length) {
        users = await DbService.getList('users', {}, {
          orderBy: { field: 'createTime', order: 'desc' }
        });
      }

      // 获取当前年月
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // 为每个用户计算统计数据
      const processedUsers = await Promise.all(users.map(async user => {
        const stats = await CheckinService.getStatistics(year, month, user.openid);
        return {
          ...user,
          createTimeStr: this.formatDate(user.createTime),
          stats: {
            presentDays: stats.presentDays,
            lateDays: stats.lateDays,
            earlyDays: stats.earlyDays
          }
        };
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
    
    wx.navigateTo({
      url: `/pages/admin/userDetail?openid=${user.openid}&name=${encodeURIComponent(user.name || '成员')}`
    });
  },

  // 切换管理员权限
  async onToggleAdmin(e) {
    const user = e.currentTarget.dataset.user;
    const currentRole = user.role || (user.isAdmin ? 'admin' : 'member');
    const nextRole = currentRole === 'admin' ? 'member' : 'admin';
    const action = nextRole === 'admin' ? '设置' : '取消';
    
    wx.showModal({
      title: '确认操作',
      content: `确定要${action} ${user.name || '该成员'} 为${nextRole === 'admin' ? '管理员' : '普通成员'}吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            const db = app.getCloudDatabase();
            const currentUser = app.globalData.userInfo || {};
            const updateData = {
              role: nextRole,
              isAdmin: nextRole === 'admin',
              updatedAt: Date.now()
            };

            await DbService.update('users', {
              openid: user.openid
            }, updateData);

            if (db) {
              const queryResult = await db.collection('users')
                .where({ _openid: user.openid })
                .get();
              
              if (queryResult.data && queryResult.data.length > 0) {
                await db.collection('users')
                  .doc(queryResult.data[0]._id)
                  .update({
                    data: updateData
                  });
              }
            }

            await DbService.add('roleLogs', {
              actorOpenid: app.globalData.openid,
              actorName: currentUser.name || '管理员',
              targetOpenid: user.openid,
              targetName: user.name || '成员',
              oldRole: currentRole,
              newRole: nextRole,
              action: nextRole === 'admin' ? 'grant_admin' : 'revoke_admin',
              createdAt: Date.now()
            });

            wx.showToast({ title: '操作成功', icon: 'success' });
            this.loadUsers();
          } catch (e) {
            console.log('更新失败', e);
            wx.showToast({ title: '操作失败', icon: 'none' });
          }
        }
      }
    });
  }
});