/**
 * services/CheckinService.js - 打卡服务
 * @description 处理打卡、记录查询、统计计算等业务逻辑
 */

const DbService = require('./DbService');
const ConfigService = require('./ConfigService');
const app = getApp();

class CheckinService {
  constructor() {
    this.collectionName = 'records';
  }

  // 获取今日打卡记录
  async getTodayRecord() {
    const openid = app.globalData.openid;
    if (!openid) return null;

    const today = this.getDateStr(new Date());

    try {
      // 从数据库获取
      const record = await DbService.getOne(this.collectionName, {
        openid,
        date: today
      });

      return record;
    } catch (e) {
      console.log('获取今日记录失败', e);
      return null;
    }
  }

  // 获取月度打卡记录
  async getMonthRecords(year, month) {
    const openid = app.globalData.openid;
    if (!openid) return [];

    const startDate = `${year}-${month.toString().padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${month.toString().padStart(2, '0')}-${lastDay}`;

    try {
      // 从数据库获取所有记录，然后过滤
      const allRecords = await DbService.getList(
        this.collectionName,
        { openid },
        { orderBy: { field: 'date', order: 'desc' } }
      );

      // 过滤月度记录
      return allRecords.filter(record => {
        return record.date >= startDate && record.date <= endDate;
      });
    } catch (e) {
      console.log('获取月度记录失败', e);
      return [];
    }
  }

  // 执行打卡
  async clockIn(type) {
    const openid = app.globalData.openid;
    const userInfo = app.globalData.userInfo;
    const config = await ConfigService.getConfig();
    
    if (!openid) {
      return { success: false, message: '请先登录' };
    }

    const now = new Date();
    const today = this.getDateStr(now);
    const timeStr = this.formatTime(now);
    const { latitude, longitude } = app.globalData.location || {};

    // 获取或创建今日记录
    let record = await this.getTodayRecord();

    if (!record) {
      record = {
        openid,
        userName: userInfo?.name || '未知',
        date: today,
        clockIn: '',
        clockOut: '',
        status: 'normal',
        locationIn: null,
        locationOut: null,
        edited: false,
        createTime: Date.now()
      };
    }

    // 判断是上班打卡还是下班打卡
    if (type === 'clockIn') {
      if (record.clockIn) {
        return { success: false, message: '今日已上班打卡' };
      }
      
      record.clockIn = timeStr;
      record.locationIn = { latitude, longitude };
      
      // 判断是否迟到
      const isLate = this.checkLate(timeStr, config.workStartTime);
      if (isLate) {
        record.status = record.clockOut ? 'late_early' : 'late';
      }
    } else {
      if (record.clockOut) {
        return { success: false, message: '今日已下班打卡' };
      }
      
      record.clockOut = timeStr;
      record.locationOut = { latitude, longitude };
      
      // 判断是否早退
      const isEarly = this.checkEarly(timeStr, config.workEndTime);
      if (isEarly) {
        record.status = record.status === 'late' ? 'late_early' : 'early';
      } else if (record.status === 'normal' && !record.clockIn) {
        record.status = 'absent';
      }
    }

    record.updateTime = Date.now();

    // 保存记录
    return await this.saveRecord(record, type);
  }

  // 保存打卡记录
  async saveRecord(record, type) {
    try {
      const existRecord = await DbService.getOne(this.collectionName, {
        openid: record.openid,
        date: record.date
      });

      if (existRecord) {
        await DbService.update(this.collectionName, {
          openid: record.openid,
          date: record.date
        }, record);
      } else {
        await DbService.add(this.collectionName, record);
      }
    } catch (e) {
      console.log('保存记录失败', e);
      return { success: false, message: '保存失败' };
    }

    const message = type === 'clockIn' 
      ? (record.status === 'late' ? '打卡成功，已迟到' : '上班打卡成功')
      : (record.status === 'early' || record.status === 'late_early' ? '打卡成功，已早退' : '下班打卡成功');

    return { success: true, message, record };
  }

  // 更新打卡记录
  async updateRecord(data) {
    const openid = app.globalData.openid;
    if (!openid) {
      return { success: false, message: '请先登录' };
    }

    const { date, clockIn, clockOut, remark } = data;
    
    try {
      let record = await DbService.getOne(this.collectionName, {
        openid,
        date
      });
      
      if (!record) {
        return { success: false, message: '记录不存在' };
      }

      // 更新字段
      if (clockIn !== undefined) record.clockIn = clockIn;
      if (clockOut !== undefined) record.clockOut = clockOut;
      if (remark) record.remark = remark;
      record.edited = true;
      record.updateTime = Date.now();

      // 重新计算状态
      record.status = this.calculateStatus(record);

      // 保存
      await DbService.update(this.collectionName, {
        openid,
        date
      }, record);

      return { success: true, record };
    } catch (e) {
      console.log('更新记录失败', e);
      return { success: false, message: '更新失败' };
    }
  }

  // 计算打卡状态
  calculateStatus(record) {
    const config = app.globalData.config || {};
    const workStartTime = config.workStartTime || '09:00';
    const workEndTime = config.workEndTime || '18:00';

    let status = 'normal';
    const hasClockIn = !!record.clockIn;
    const hasClockOut = !!record.clockOut;

    if (hasClockIn && this.checkLate(record.clockIn, workStartTime)) {
      status = hasClockOut ? 'late_early' : 'late';
    }

    if (hasClockOut && this.checkEarly(record.clockOut, workEndTime)) {
      status = status === 'late' ? 'late_early' : 'early';
    }

    if (!hasClockIn && !hasClockOut) {
      status = 'absent';
    }

    return status;
  }

  // 检查是否迟到
  checkLate(clockIn, workStartTime) {
    const [inH, inM] = clockIn.split(':').map(Number);
    const [startH, startM] = workStartTime.split(':').map(Number);
    
    const inMinutes = inH * 60 + inM;
    const startMinutes = startH * 60 + startM;
    
    // 允许几分钟宽限
    return inMinutes > startMinutes + 0;
  }

  // 检查是否早退
  checkEarly(clockOut, workEndTime) {
    const [outH, outM] = clockOut.split(':').map(Number);
    const [endH, endM] = workEndTime.split(':').map(Number);
    
    const outMinutes = outH * 60 + outM;
    const endMinutes = endH * 60 + endM;
    
    return outMinutes < endMinutes - 0;
  }

  // 获取日期字符串
  getDateStr(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 格式化时间
  formatTime(date) {
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${hour}:${minute}`;
  }

  // 获取考勤统计数据
  async getStatistics(year, month) {
    const records = await this.getMonthRecords(year, month);
    
    const stats = {
      totalDays: 0,
      presentDays: 0,
      lateDays: 0,
      earlyDays: 0,
      absentDays: 0,
      workDays: 0
    };

    const now = new Date();
    const todayStr = this.getDateStr(now);
    const lastDay = new Date(year, month, 0).getDate();

    // 计算工作日数量
    for (let d = 1; d <= lastDay; d++) {
      const date = new Date(year, month - 1, d);
      const dayOfWeek = date.getDay();
      const dateStr = `${year}-${month.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      
      // 排除周末
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        stats.workDays++;
        
        // 统计已过的日期
        if (dateStr <= todayStr) {
          stats.totalDays++;
        }
      }
    }

    // 统计记录
    records.forEach(record => {
      const status = record.status || 'normal';
      
      if (status === 'normal') {
        stats.presentDays++;
      } else if (status === 'late') {
        stats.presentDays++;
        stats.lateDays++;
      } else if (status === 'early') {
        stats.presentDays++;
        stats.earlyDays++;
      } else if (status === 'late_early') {
        stats.presentDays++;
        stats.lateDays++;
        stats.earlyDays++;
      } else if (status === 'absent') {
        stats.absentDays++;
      }
    });

    // 缺卡天数 = 工作日 - 有打卡记录的天数
    stats.absentDays = Math.max(0, stats.totalDays - stats.presentDays - stats.absentDays);

    return stats;
  }
}

module.exports = new CheckinService();
