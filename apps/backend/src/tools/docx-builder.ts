import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from "docx";

/**
 * A small, forgiving block-based document spec. The model emits an ordered list
 * of blocks; everything renders even when fields are missing.
 */
export interface DocBlock {
  type?: "heading" | "paragraph" | "bullets" | "ordered" | "quote";
  /** Heading level 1-4 (defaults to 1). */
  level?: number;
  text?: string;
  items?: string[];
}

export interface DocSpec {
  title?: string;
  subtitle?: string;
  blocks?: DocBlock[];
}

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4
];

function headingLevel(level: number | undefined): (typeof HEADING_LEVELS)[number] {
  const index = Math.min(Math.max((level ?? 1) - 1, 0), HEADING_LEVELS.length - 1);
  return HEADING_LEVELS[index];
}

function blockToParagraphs(block: DocBlock): Paragraph[] {
  const type = block.type ?? "paragraph";
  if (type === "heading") {
    return [new Paragraph({ text: block.text ?? "", heading: headingLevel(block.level) })];
  }
  if (type === "quote") {
    return [
      new Paragraph({
        children: [new TextRun({ text: block.text ?? "", italics: true })],
        spacing: { before: 120, after: 120 }
      })
    ];
  }
  if (type === "bullets" || type === "ordered") {
    const items = block.items ?? (block.text ? [block.text] : []);
    return items.map(
      (item, index) =>
        new Paragraph({
          text: String(item),
          ...(type === "bullets"
            ? { bullet: { level: 0 } }
            : { numbering: { reference: "ordered-list", level: 0, instance: index } })
        })
    );
  }
  return [new Paragraph({ text: block.text ?? "" })];
}

/** Build a .docx file as a Node Buffer from a document specification. */
export async function buildDocx(spec: DocSpec): Promise<Buffer> {
  const children: Paragraph[] = [];
  if (spec.title) {
    children.push(new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE }));
  }
  if (spec.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: spec.subtitle, italics: true, color: "666666" })],
        spacing: { after: 240 }
      })
    );
  }
  for (const block of spec.blocks ?? []) {
    children.push(...blockToParagraphs(block));
  }
  if (children.length === 0) {
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: [
            { level: 0, format: "decimal", text: "%1.", alignment: "left" }
          ]
        }
      ]
    },
    sections: [{ children }]
  });

  return Packer.toBuffer(doc);
}
