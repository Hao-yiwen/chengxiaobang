import ExcelJS from "exceljs";

/**
 * A small spreadsheet spec. Each sheet may declare typed columns (with headers)
 * and rows given either as arrays (positional) or objects (keyed by column key).
 */
export interface SheetColumn {
  header: string;
  key?: string;
  width?: number;
}

export interface SheetSpec {
  name?: string;
  columns?: SheetColumn[];
  rows?: Array<Array<string | number | boolean | null> | Record<string, unknown>>;
}

export interface WorkbookSpec {
  sheets?: SheetSpec[];
}

/** Build an .xlsx file as a Node Buffer from a workbook specification. */
export async function buildXlsx(spec: WorkbookSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "程小帮";

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
      worksheet.addRow(row as never);
    }
  });

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}
