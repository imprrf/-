const app = getApp()

Page({
  data: {
    // ===== 权限相关 =====
    isAdmin: false,
    tapCount: 0,                // 连续点击计数
    lastTapTime: 0,             // 上次点击时间（用于判断连续点击）

    // ===== 统计数据 =====
    totalRecords: 0,
    totalHours: 0,
    todayCount: 0,

    // ===== 筛选条件 =====
    startDate: '',
    endDate: '',
    userList: [],
    selectedUserOpenId: '',
    selectedUserName: '全部用户',

    // ===== 记录列表 =====
    filteredRecords: [],
    allRawRecords: []
  },

  onLoad() {
    this.initDates()
    this.checkAdmin()
  },

  onShow() {
    // 每次显示时刷新（如果已是管理员）
    if (this.data.isAdmin) {
      this.loadUserList()
      this.loadData()
    }
  },

  // ========== 1. 权限检查 ==========
  async checkAdmin() {
    const db = wx.cloud.database()
    try {
      const openid = app.globalData.userInfo?.openid || ''
      if (!openid) {
        // 未登录，等一会再试
        setTimeout(() => this.checkAdmin(), 500)
        return
      }
      const res = await db.collection('admins').where({ openid }).get()
      const isAdmin = res.data.length > 0
      this.setData({ isAdmin })
      if (isAdmin) {
        // 是管理员，加载数据
        this.loadUserList()
        this.loadData()
      }
    } catch (e) {
      console.log('权限检查失败', e)
      // 可能是 admins 集合不存在，静默失败，用户可通过点击激活
      this.setData({ isAdmin: false })
    }
  },

  // ========== 2. 点击10次激活管理员 ==========
  onSecretTap() {
    const now = Date.now()
    const { tapCount, lastTapTime } = this.data

    // 如果距离上次点击超过2秒，重置计数（防止用户慢慢点）
    if (now - lastTapTime > 2000) {
      this.setData({ tapCount: 1, lastTapTime: now })
      return
    }

    const newCount = tapCount + 1
    this.setData({ tapCount: newCount, lastTapTime: now })

    // 达到10次，激活管理员
    if (newCount >= 10) {
      this.activateAdmin()
      this.setData({ tapCount: 0 })
    }
  },

  // ========== 3. 激活管理员（写入 admins 集合） ==========
  async activateAdmin() {
    try {
      const db = wx.cloud.database()
      const openid = app.globalData.userInfo?.openid || ''

      if (!openid) {
        wx.showToast({ title: '请先登录', icon: 'none' })
        return
      }

      // 先检查是否已是管理员
      const checkRes = await db.collection('admins').where({ openid }).get()
      if (checkRes.data.length > 0) {
        wx.showToast({ title: '已是管理员', icon: 'success' })
        this.setData({ isAdmin: true })
        this.loadUserList()
        this.loadData()
        return
      }

      // 写入 admins 集合（如果集合不存在，首次写入会自动创建）
      await db.collection('admins').add({ data: { openid } })

      wx.showToast({ title: '🎉 管理员权限已开启', icon: 'success' })
      this.setData({ isAdmin: true })
      app.globalData.isAdmin = true

      // 加载数据
      this.loadUserList()
      this.loadData()

    } catch (e) {
      console.error('激活管理员失败', e)
      // 如果集合不存在，尝试重新创建
      if (e.errCode === -502005) {
        wx.showToast({ title: '请先创建 admins 集合', icon: 'none' })
      } else {
        wx.showToast({ title: '激活失败，请重试', icon: 'none' })
      }
    }
  },

  // ========== 4. 初始化日期 ==========
  initDates() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    const today = `${year}-${month}-${day}`
    this.setData({
      startDate: `${year}-${month}-01`,
      endDate: today
    })
  },

  // ========== 5. 加载用户列表 ==========
  async loadUserList() {
    const db = wx.cloud.database()
    try {
      const res = await db.collection('users').get()
      const list = res.data.map(u => ({
        openid: u._openid,
        name: u.nickName || u.userInfo?.nickName || '未知'
      }))
      this.setData({ userList: list })
    } catch (e) {
      console.log('加载用户列表失败', e)
    }
  },

  // ========== 6. 核心：加载打卡记录 ==========
  async loadData() {
    if (!this.data.isAdmin) {
      wx.showToast({ title: '无权限', icon: 'none' })
      return
    }

    wx.showLoading({ title: '加载中...' })
    const db = wx.cloud.database()
    const _ = db.command

    try {
      const { startDate, endDate, selectedUserOpenId } = this.data

      const where = {}
      if (startDate && endDate) {
        where.date = _.gte(startDate).and(_.lte(endDate))
      }
      if (selectedUserOpenId) {
        where._openid = selectedUserOpenId
      }

      const res = await db.collection('records')
        .where(where)
        .orderBy('timestamp', 'asc')
        .limit(1000)
        .get()

      wx.hideLoading()

      const records = res.data || []

      // 补充用户名
      const userMap = {}
      this.data.userList.forEach(u => {
        userMap[u.openid] = u.name
      })
      const enriched = records.map(r => ({
        ...r,
        userName: userMap[r._openid] || r._openid.substring(0, 8) + '...'
      }))

      const paired = this.pairRecords(enriched)

      // 统计
      const totalRecords = records.length
      const totalHours = paired.reduce((sum, p) => {
        if (p.durationNum) return sum + p.durationNum
        return sum
      }, 0)
      const today = new Date().toISOString().slice(0, 10)
      const todayCount = records.filter(r => r.date === today).length

      this.setData({
        allRawRecords: enriched,
        filteredRecords: paired,
        totalRecords,
        totalHours: (totalHours / 3600).toFixed(1),
        todayCount
      })

    } catch (e) {
      wx.hideLoading()
      console.error('加载数据失败:', e)
      wx.showToast({ title: '加载失败: ' + (e.errMsg || e.message), icon: 'none' })
    }
  },

  // ========== 7. 配对逻辑 ==========
  pairRecords(records) {
    const userMap = {}
    records.forEach(r => {
      if (!userMap[r._openid]) userMap[r._openid] = []
      userMap[r._openid].push(r)
    })

    const result = []
    Object.keys(userMap).forEach(openid => {
      const list = userMap[openid].sort((a, b) => a.timestamp - b.timestamp)
      const userName = list[0]?.userName || openid.substring(0, 8)
      let i = 0
      while (i < list.length) {
        const cur = list[i]
        const type = cur.type || 'in'
        if (type === 'in' && i + 1 < list.length && (list[i+1].type || 'in') === 'out') {
          const inRec = list[i]
          const outRec = list[i+1]
          const durationSec = (outRec.timestamp - inRec.timestamp) / 1000
          result.push({
            date: inRec.date,
            userName,
            inTime: inRec.time,
            outTime: outRec.time,
            duration: this.formatDuration(durationSec),
            durationNum: durationSec
          })
          i += 2
        } else if (type === 'in') {
          result.push({
            date: cur.date,
            userName,
            inTime: cur.time,
            outTime: '进行中',
            duration: '--',
            durationNum: 0
          })
          i++
        } else {
          i++
        }
      }
    })
    return result.sort((a, b) => b.date.localeCompare(a.date))
  },

  formatDuration(seconds) {
    if (!seconds || seconds < 0) return '--'
    const hrs = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    if (hrs > 0) return `${hrs}h${mins > 0 ? mins + 'm' : ''}`
    else if (mins > 0) return `${mins}m`
    else return '0m'
  },

  // ========== 8. 筛选事件 ==========
  onStartDateChange(e) {
    this.setData({ startDate: e.detail.value })
  },
  onEndDateChange(e) {
    this.setData({ endDate: e.detail.value })
  },
  onUserChange(e) {
    const index = e.detail.value
    const user = this.data.userList[index]
    if (user) {
      this.setData({
        selectedUserOpenId: user.openid,
        selectedUserName: user.name
      })
    } else {
      this.setData({
        selectedUserOpenId: '',
        selectedUserName: '全部用户'
      })
    }
  },

  // 刷新按钮
  onRefresh() {
    this.loadData()
  }
})