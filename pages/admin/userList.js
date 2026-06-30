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
      // 优先从云数据库同步数据到本地
      const db = app.getCloudDatabase();
      if (db) {
        try {
          const cloudResult = await db.collection('users').get();
          if (cloudResult.data && cloudResult.data.length > 0) {
            // 将云数据库数据同步到本地
            for (const cloudUser of cloudResult.data) {
              const localUser = {
                ...cloudUser,
                // 兼容字段
                name: cloudUser.name || cloudUser.realName || '',
                createTime: cloudUser.createTime || cloudUser._createTime || Date.now()
              };
              
              // 检查本地是否已存在该用户
              const existingUser = await DbService.getOne('users', { openid: cloudUser.openid });
              if (existingUser) {
                // 更新本地用户
                await DbService.update('users', { openid: cloudUser.openid }, localUser);
              } else {
                // 新增本地用户
                await DbService.add('users', localUser);
              }
            }
          }
        } catch (e) {
          console.log('从云数据库同步用户失败', e);
        }
      }

      // 从本地存储读取用户列表
      const users = await DbService.getList('users', {}, {
        orderBy: { field: 'createTime', order: 'desc' }
      });

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
    const action = user.isAdmin ? '取消' : '设置';
    
    wx.showModal({
      title: '确认操作',
      content: `确定要${action} ${user.name || '该成员'} 为管理员吗？`,
      success: async (res) => {
        if (res.confirm) {
          try {
            const newIsAdmin = !user.isAdmin;
            
            // 更新本地存储
            await DbService.update('users', {
              openid: user.openid
            }, {
              isAdmin: newIsAdmin
            });
            
            // 同步到云数据库
            const db = app.getCloudDatabase();
            if (db) {
              console.log('【调试】准备更新管理员权限到云:', user.openid, newIsAdmin);
              const queryResult = await db.collection('users')
                .where({ openid: user.openid })
                .get();
              
              console.log('【调试】查询结果:', queryResult);
              
              if (queryResult.data && queryResult.data.length > 0) {
                const updateData = { isAdmin: newIsAdmin };
                // 确保没有保留字段
                delete updateData._openid;
                delete updateData._id;
                
                console.log('【调试】准备更新云数据库:', updateData);
                await db.collection('users')
                  .doc(queryResult.data[0]._id)
                  .update({
                    data: updateData
                  });
                console.log('【调试】云数据库管理员权限更新成功');
              }
            }
            
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