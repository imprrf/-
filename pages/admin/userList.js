const app = getApp();
const CloudService = require('../../services/CloudService');
const CheckinService = require('../../services/CheckinService');
const RecordModel = require('../../services/RecordModel');
Page({
  data: { searchKey: '', users: [], loading: false },
  onShow() {
    this.loadUsers();
  },
  async loadUsers() {
    this.setData({ loading: true });
    try {
      const users = await CloudService.list('listUsers');
      const today = RecordModel.dateStr(),
        year = Number(today.slice(0, 4)),
        month = Number(today.slice(5, 7));
      // 月度记录一次批量读取，避免每个成员发起一次全量历史扫描。
      const records = RecordModel.normalizeList(
        await CloudService.list('listAllRecords', {
          startDate: `${today.slice(0, 7)}-01`,
          endDate: `${today.slice(0, 7)}-31`
        })
      );
      const processed = await Promise.all(
        users.map(async (user) => ({
          ...user,
          createTimeStr: user.createTime ? RecordModel.dateStr(new Date(user.createTime)) : '未知',
          stats: await CheckinService.getStatistics(
            year,
            month,
            user.openid,
            records.filter((r) => r.openid === user.openid)
          )
        }))
      );
      this.setData({ users: this.filterUsers(processed, this.data.searchKey) });
    } catch (e) {
      this.setData({ users: [] });
      app.showError(e.message);
    } finally {
      this.setData({ loading: false });
    }
  },
  filterUsers(users, key) {
    const text = key.toLowerCase();
    return users.filter(
      (u) => (u.name || '').toLowerCase().includes(text) || (u.phone || '').includes(text)
    );
  },
  onSearchInput(e) {
    this.setData({ searchKey: e.detail.value });
  },
  onSearch() {
    this.loadUsers();
  },
  onViewRecords(e) {
    const user = e.currentTarget.dataset.user;
    wx.navigateTo({
      url: `/pages/admin/userDetail?openid=${encodeURIComponent(user.openid)}&name=${encodeURIComponent(user.name || '成员')}`
    });
  },
  onToggleAdmin(e) {
    const user = e.currentTarget.dataset.user;
    const nextRole = user.role === 'admin' ? 'member' : 'admin';
    wx.showModal({
      title: '确认操作',
      content: `确定将 ${user.name || '该成员'} 设置为${nextRole === 'admin' ? '管理员' : '普通成员'}吗？`,
      success: async (res) => {
        if (!res.confirm || this._changingRole) return;
        this._changingRole = true;
        try {
          await CloudService.call('adminOps', {
            action: 'setRole',
            openid: user.openid,
            role: nextRole
          });
          app.showSuccess('操作成功');
          await this.loadUsers();
        } catch (e) {
          app.showError(e.message);
        } finally {
          this._changingRole = false;
        }
      }
    });
  }
});
