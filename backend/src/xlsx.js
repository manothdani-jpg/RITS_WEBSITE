const ExcelJS = require("exceljs");

const MONEY_FMT = '"$"#,##0.00';
const DATE_FMT = "yyyy-mm-dd";
const DATETIME_FMT = "yyyy-mm-dd hh:mm";

/**
 * Adds a sheet with a styled, frozen, filterable header row.
 * columns: [{ header, key, width, type? }] where type is "money" (cents in,
 * dollars out), "date", or "datetime". Strings are always written as
 * strings, so user-entered text starting with "=" is never a formula.
 */
function addSheet(workbook, name, columns, rows) {
  const ws = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 16 }));

  for (const row of rows) {
    const out = {};
    for (const c of columns) {
      const v = row[c.key];
      if (v === null || v === undefined || v === "") out[c.key] = null;
      else if (c.type === "money") out[c.key] = v / 100;
      else if (c.type === "date" || c.type === "datetime") out[c.key] = new Date(v);
      else out[c.key] = v;
    }
    ws.addRow(out);
  }

  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === "money") col.numFmt = MONEY_FMT;
    if (c.type === "date") col.numFmt = DATE_FMT;
    if (c.type === "datetime") col.numFmt = DATETIME_FMT;
  });

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF7A1B3A" } };
  header.alignment = { vertical: "middle" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

async function sendWorkbook(res, workbook, filename) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await workbook.xlsx.write(res);
  res.end();
}

module.exports = { ExcelJS, addSheet, sendWorkbook };
