import type { PersonEntry } from "./layout";
import { effectiveFields, type Overrides } from "./store";

const HEADERS = [
  "Name",
  "Gender",
  "Generation",
  "Parents",
  "Spouses",
  "Children",
  "Photo",
  "Date of Birth",
  "Birthplace",
  "Occupation",
  "Notes",
] as const;

const enc = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function colName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function cell(value: string, row: number, col: number): string {
  return `<c r="${colName(col)}${row}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function worksheet(rows: string[][]): string {
  const body = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((value, c) => cell(value, r + 1, c)).join("")}</row>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="3" width="14" customWidth="1"/>
    <col min="4" max="6" width="34" customWidth="1"/>
    <col min="7" max="10" width="22" customWidth="1"/>
    <col min="11" max="11" width="48" customWidth="1"/>
  </cols>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function zip(files: Array<{ path: string; data: Uint8Array }>): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const writeHeader = (size: number) => new Uint8Array(size);
  const write16 = (view: DataView, offset: number, value: number) => view.setUint16(offset, value, true);
  const write32 = (view: DataView, offset: number, value: number) => view.setUint32(offset, value, true);

  for (const file of files) {
    const name = enc.encode(file.path);
    const crc = crc32(file.data);
    const local = writeHeader(30 + name.length);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0);
    write32(localView, 14, crc);
    write32(localView, 18, file.data.length);
    write32(localView, 22, file.data.length);
    write16(localView, 26, name.length);
    local.set(name, 30);
    chunks.push(local, file.data);

    const dir = writeHeader(46 + name.length);
    const dirView = new DataView(dir.buffer);
    write32(dirView, 0, 0x02014b50);
    write16(dirView, 4, 20);
    write16(dirView, 6, 20);
    write16(dirView, 8, 0);
    write16(dirView, 10, 0);
    write16(dirView, 12, 0);
    write16(dirView, 14, 0);
    write32(dirView, 16, crc);
    write32(dirView, 20, file.data.length);
    write32(dirView, 24, file.data.length);
    write16(dirView, 28, name.length);
    write32(dirView, 42, offset);
    dir.set(name, 46);
    central.push(dir);

    offset += local.length + file.data.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  chunks.push(...central);

  const end = writeHeader(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, files.length);
  write16(endView, 10, files.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, centralOffset);
  chunks.push(end);

  const parts = chunks.map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    return copy.buffer;
  });
  return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function familyExcelBlob(people: PersonEntry[], overrides: Overrides): Blob {
  const rows = [
    [...HEADERS],
    ...people.map((entry) => {
      const fields = effectiveFields(entry.person, overrides[entry.person.name]);
      return [
        fields.name,
        fields.gender === "m" ? "Male" : "Female",
        String(entry.gen + 1),
        entry.parents.map((p) => effectiveFields(p, overrides[p.name]).name).join(", "),
        entry.spouses.map((p) => effectiveFields(p, overrides[p.name]).name).join(", "),
        entry.children.map((p) => effectiveFields(p, overrides[p.name]).name).join(", "),
        overrides[entry.person.name]?.photoFile ?? entry.person.photo ?? "",
        fields.dob,
        fields.birthplace,
        fields.occupation,
        fields.notes,
      ];
    }),
  ];

  const files = [
    {
      path: "[Content_Types].xml",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    },
    {
      path: "_rels/.rels",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      path: "xl/workbook.xml",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Family Members" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    },
    {
      path: "xl/_rels/workbook.xml.rels",
      data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    },
    { path: "xl/worksheets/sheet1.xml", data: enc.encode(worksheet(rows)) },
  ];

  return zip(files);
}
