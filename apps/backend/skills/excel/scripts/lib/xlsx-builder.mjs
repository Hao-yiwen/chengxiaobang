import ExcelJS from "exceljs";
async function buildXlsx(spec) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "\u7A0B\u5C0F\u5E2E";
  const sheets = spec.sheets?.length ? spec.sheets : [{ name: "Sheet1" }];
  sheets.forEach((sheet, index) => {
    const worksheet = workbook.addWorksheet(sheet.name || `Sheet${index + 1}`);
    if (sheet.columns?.length) {
      worksheet.columns = sheet.columns.map((column, columnIndex) => ({
        header: column.header,
        key: column.key ?? column.header ?? `col${columnIndex + 1}`,
        width: column.width ?? Math.max(12, column.header?.length ?? 12)
      }));
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF3FF" }
      };
    }
    for (const row of sheet.rows ?? []) {
      worksheet.addRow(row);
    }
  });
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}
export {
  buildXlsx
};
