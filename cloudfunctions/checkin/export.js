const { all } = require('./db');
const { dateParts } = require('./attendance');
// 导出范围：全部 / 近一周（含今天共 7 天）/ 近一个月（含今天共 30 天）。
const RANGES = { all: 0, week: 7, month: 30 };
const RANGE_LABELS = { all: '全部', week: '近一周', month: '近一个月' };
const FORMATS = ['xlsx', 'docx'];
const DETAIL_HEADERS = [
  '姓名',
  '手机号',
  '日期',
  '签到时间',
  '签退时间',
  '停留分钟',
  '状态',
  '超出范围',
  '定位缺失'
];
const SUMMARY_HEADERS = ['姓名', '到访天数', '到访次数', '停留分钟', '超范围天数'];
function rangeStart(range, now) {
  const days = RANGES[range];
  return days ? dateParts(now - (days - 1) * 86400000).date : '';
}
// 旧事件（type=in/out，且没有 checkInTime/clockIn）：规则与前端 RecordModel.normalizeList 一致，
// 按成员和日期配对；孤立的签到或签退也保留为一行。
const isLegacyEvent = (r) => (r.type === 'in' || r.type === 'out') && !r.checkInTime && !r.clockIn;
const legacyIn = (r) => ({ ...r, checkInTime: r.time, checkInTimestamp: r.timestamp });
function pairLegacyEvents(records) {
  const sorted = records
    .slice()
    .sort(
      (a, b) => (a.timestamp || a.checkInTimestamp || 0) - (b.timestamp || b.checkInTimestamp || 0)
    );
  const result = [];
  const pendingByOwnerDate = new Map();
  for (const record of sorted) {
    if (!isLegacyEvent(record)) {
      result.push(record);
      continue;
    }
    const key = `${record._openid || ''}:${record.date}`;
    const pending = pendingByOwnerDate.get(key);
    if (record.type === 'in') {
      if (pending) result.push(legacyIn(pending));
      pendingByOwnerDate.set(key, record);
    } else if (pending) {
      result.push({
        ...legacyIn(pending),
        checkOutTime: record.time,
        checkOutTimestamp: record.timestamp,
        status: 'Complete'
      });
      pendingByOwnerDate.delete(key);
    } else {
      result.push({
        ...record,
        checkOutTime: record.time,
        checkOutTimestamp: record.timestamp,
        status: 'Complete'
      });
    }
  }
  for (const pending of pendingByOwnerDate.values()) result.push(legacyIn(pending));
  return result;
}
function durationOf(r) {
  if (r.durationMinutes !== undefined) return Number(r.durationMinutes) || 0;
  const start = r.checkInTimestamp || r.clockInTimestamp || 0;
  const end = r.checkOutTimestamp || r.clockOutTimestamp || 0;
  return start && end ? Math.max(0, Math.floor((end - start) / 60000)) : 0;
}
function buildRows(rawRecords, users, today) {
  const records = pairLegacyEvents(rawRecords);
  const byOpenid = new Map(users.map((u) => [u._openid, u]));
  return records
    .filter((r) => r.date && r.date <= today)
    .map((r) => {
      const user = byOpenid.get(r._openid) || {};
      const base = user.realName || user.name || r.userName || '未知成员';
      const checkOutTimestamp = r.checkOutTimestamp || r.clockOutTimestamp || 0;
      const completed = !!checkOutTimestamp || r.status === 'Complete';
      const expired = r.status === 'Incomplete_Expired' || (!completed && r.date < today);
      return {
        openid: r._openid,
        name: user.removed === true ? `${base}（已移除）` : base,
        phone: user.phone || r.userPhone || '',
        date: r.date,
        checkInTime: r.checkInTime || r.clockIn || '',
        checkOutTime: completed ? r.checkOutTime || r.clockOut || '' : '',
        minutes: completed ? durationOf(r) : 0,
        completed,
        status: completed ? '已离开' : expired ? '未记录离开' : '在工作室',
        outOfRange: !!(r.outOfRange || r.checkInOutOfRange || r.checkOutOutOfRange),
        locationUnavailable: !!r.locationUnavailable
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.name.localeCompare(b.name) ||
        a.checkInTime.localeCompare(b.checkInTime)
    );
}
// 统计口径与前端 CheckinService.getStatistics 一致：天数按日期去重，停留分钟只累计已完成记录。
function summarize(rows) {
  const people = new Map();
  for (const row of rows) {
    const key = row.openid || row.name;
    if (!people.has(key)) {
      people.set(key, { name: row.name, dates: new Set(), outDates: new Set(), visits: 0, minutes: 0 });
    }
    const p = people.get(key);
    p.dates.add(row.date);
    p.visits++;
    p.minutes += row.minutes;
    if (row.outOfRange) p.outDates.add(row.date);
  }
  return [...people.values()]
    .map((p) => ({
      name: p.name,
      presentDays: p.dates.size,
      visitCount: p.visits,
      totalMinutes: p.minutes,
      outOfRangeDays: p.outDates.size
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
const detailCells = (r) => [
  r.name,
  r.phone,
  r.date,
  r.checkInTime,
  r.checkOutTime,
  r.minutes,
  r.status,
  r.outOfRange ? '是' : '否',
  r.locationUnavailable ? '是' : '否'
];
const summaryCells = (s) => [
  s.name,
  s.presentDays,
  s.visitCount,
  s.totalMinutes,
  s.outOfRangeDays
];
async function buildXlsx(rows, summary) {
  // 仅导出时加载，依赖只安装在 adminOps 云函数。
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const detail = workbook.addWorksheet('打卡明细');
  detail.addRow(DETAIL_HEADERS).font = { bold: true };
  rows.forEach((r) => detail.addRow(detailCells(r)));
  detail.columns.forEach((column) => (column.width = 14));
  const sheet = workbook.addWorksheet('成员汇总');
  sheet.addRow(SUMMARY_HEADERS).font = { bold: true };
  summary.forEach((s) => sheet.addRow(summaryCells(s)));
  sheet.columns.forEach((column) => (column.width = 14));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
async function buildDocx(rows, summary, title) {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType } = require('docx');
  const table = (headers, lines) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headers, ...lines].map(
        (cells, index) =>
          new TableRow({
            tableHeader: index === 0,
            children: cells.map(
              (text) =>
                new TableCell({
                  children: [new Paragraph({ text: String(text), heading: undefined })]
                })
            )
          })
      )
    });
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title }),
          new Paragraph({ text: '成员汇总' }),
          table(SUMMARY_HEADERS, summary.map(summaryCells)),
          new Paragraph({ text: '打卡明细' }),
          table(DETAIL_HEADERS, rows.map(detailCells))
        ]
      }
    ]
  });
  return Packer.toBuffer(document);
}
async function exportRecords(db, event, now) {
  const range = event.range === undefined ? 'month' : event.range;
  const format = event.format === undefined ? 'xlsx' : event.format;
  if (!Object.prototype.hasOwnProperty.call(RANGES, range)) throw new Error('导出范围无效');
  if (!FORMATS.includes(format)) throw new Error('导出格式无效');
  const today = dateParts(now).date;
  const start = rangeStart(range, now);
  const query = start ? { date: db.command.gte(start).and(db.command.lte(today)) } : {};
  const [records, users] = await Promise.all([all(db, 'records', query), all(db, 'users')]);
  const rows = buildRows(records, users, today);
  if (!rows.length) throw new Error('所选范围内没有打卡记录');
  const summary = summarize(rows);
  const title = `打卡记录（${RANGE_LABELS[range]}，导出于 ${today}）`;
  const buffer =
    format === 'xlsx' ? await buildXlsx(rows, summary) : await buildDocx(rows, summary, title);
  const cloud = require('wx-server-sdk');
  const upload = await cloud.uploadFile({
    cloudPath: `exports/records-${range}-${now}.${format}`,
    fileContent: buffer
  });
  const temp = await cloud.getTempFileURL({ fileList: [upload.fileID] });
  return {
    success: true,
    fileID: upload.fileID,
    url: temp.fileList[0].tempFileURL,
    format,
    count: rows.length
  };
}

module.exports = { exportRecords, buildRows, summarize, rangeStart, RANGES, FORMATS };
