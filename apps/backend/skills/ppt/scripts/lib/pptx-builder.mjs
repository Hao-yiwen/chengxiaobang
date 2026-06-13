import pptxgen from "pptxgenjs";
const DEFAULT_THEME = {
  primary: "2E5BFF",
  accent: "00C2A8",
  background: "FFFFFF",
  text: "1A1A2E"
};
function normalizeColor(value, fallback) {
  if (!value) {
    return fallback;
  }
  return value.replace(/^#/, "").toUpperCase();
}
async function buildPptx(spec) {
  const theme = {
    primary: normalizeColor(spec.theme?.primary, DEFAULT_THEME.primary),
    accent: normalizeColor(spec.theme?.accent, DEFAULT_THEME.accent),
    background: normalizeColor(spec.theme?.background, DEFAULT_THEME.background),
    text: normalizeColor(spec.theme?.text, DEFAULT_THEME.text)
  };
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  if (spec.author) {
    pptx.author = spec.author;
  }
  if (spec.title) {
    pptx.title = spec.title;
  }
  pptx.defineSlideMaster({
    title: "MASTER",
    background: { color: theme.background },
    objects: [
      {
        rect: {
          x: 0,
          y: 7.1,
          w: "100%",
          h: 0.06,
          fill: { color: theme.accent }
        }
      }
    ]
  });
  const slides = spec.slides?.length ? spec.slides : [{ layout: "title", title: spec.title ?? "\u6F14\u793A\u6587\u7A3F" }];
  if (slides[0]?.layout !== "title" && spec.title) {
    renderTitleSlide(pptx, theme, {
      layout: "title",
      title: spec.title,
      subtitle: spec.subtitle
    });
  }
  for (const slide of slides) {
    const layout = slide.layout ?? inferLayout(slide);
    if (layout === "title") {
      renderTitleSlide(pptx, theme, slide);
    } else if (layout === "section") {
      renderSectionSlide(pptx, theme, slide);
    } else if (layout === "two-column") {
      renderTwoColumnSlide(pptx, theme, slide);
    } else if (layout === "quote") {
      renderQuoteSlide(pptx, theme, slide);
    } else {
      renderContentSlide(pptx, theme, slide);
    }
  }
  const data = await pptx.write({ outputType: "nodebuffer" });
  return data;
}
function inferLayout(slide) {
  if (slide.columns?.length) {
    return "two-column";
  }
  if (slide.quote) {
    return "quote";
  }
  if (!slide.bullets?.length && !slide.paragraphs?.length) {
    return "section";
  }
  return "bullets";
}
function addSlide(pptx, theme) {
  const slide = pptx.addSlide({ masterName: "MASTER" });
  slide.background = { color: theme.background };
  return slide;
}
function withNotes(slide, notes) {
  if (notes) {
    slide.addNotes(notes);
  }
}
function renderTitleSlide(pptx, theme, data) {
  const slide = addSlide(pptx, theme);
  slide.addShape("rect", { x: 0, y: 0, w: "100%", h: 7.5, fill: { color: theme.primary } });
  slide.addText(data.title ?? "\u6F14\u793A\u6587\u7A3F", {
    x: 0.8,
    y: 2.6,
    w: 11.7,
    h: 1.6,
    fontSize: 44,
    bold: true,
    color: "FFFFFF",
    align: "left"
  });
  if (data.subtitle) {
    slide.addText(data.subtitle, {
      x: 0.8,
      y: 4.2,
      w: 11.7,
      h: 1,
      fontSize: 22,
      color: "E6ECFF",
      align: "left"
    });
  }
  withNotes(slide, data.notes);
}
function renderSectionSlide(pptx, theme, data) {
  const slide = addSlide(pptx, theme);
  slide.addShape("rect", { x: 0, y: 3.1, w: 0.25, h: 1.3, fill: { color: theme.accent } });
  slide.addText(data.title ?? "", {
    x: 0.8,
    y: 3,
    w: 11.7,
    h: 1.2,
    fontSize: 36,
    bold: true,
    color: theme.text,
    align: "left"
  });
  if (data.subtitle) {
    slide.addText(data.subtitle, {
      x: 0.8,
      y: 4.3,
      w: 11.7,
      h: 0.8,
      fontSize: 18,
      color: theme.text,
      align: "left"
    });
  }
  withNotes(slide, data.notes);
}
function renderContentSlide(pptx, theme, data) {
  const slide = addSlide(pptx, theme);
  renderHeader(slide, theme, data);
  let cursor = 1.8;
  if (data.paragraphs?.length) {
    slide.addText(data.paragraphs.join("\n\n"), {
      x: 0.8,
      y: cursor,
      w: 11.7,
      h: 1.5,
      fontSize: 18,
      color: theme.text,
      align: "left",
      valign: "top"
    });
    cursor += 1.7;
  }
  if (data.bullets?.length) {
    slide.addText(toBulletRuns(data.bullets, theme), {
      x: 0.8,
      y: cursor,
      w: 11.7,
      h: 6.6 - cursor,
      fontSize: 18,
      color: theme.text,
      align: "left",
      valign: "top"
    });
  }
  withNotes(slide, data.notes);
}
function renderTwoColumnSlide(pptx, theme, data) {
  const slide = addSlide(pptx, theme);
  renderHeader(slide, theme, data);
  const columns = (data.columns ?? []).slice(0, 2);
  const widths = [
    { x: 0.8, w: 5.7 },
    { x: 6.9, w: 5.7 }
  ];
  columns.forEach((column, index) => {
    const place = widths[index];
    if (column.title) {
      slide.addText(column.title, {
        x: place.x,
        y: 1.8,
        w: place.w,
        h: 0.6,
        fontSize: 20,
        bold: true,
        color: theme.primary,
        align: "left"
      });
    }
    if (column.bullets?.length) {
      slide.addText(toBulletRuns(column.bullets, theme), {
        x: place.x,
        y: 2.5,
        w: place.w,
        h: 4.3,
        fontSize: 16,
        color: theme.text,
        align: "left",
        valign: "top"
      });
    }
  });
  withNotes(slide, data.notes);
}
function renderQuoteSlide(pptx, theme, data) {
  const slide = addSlide(pptx, theme);
  slide.addText(`\u201C${data.quote ?? data.title ?? ""}\u201D`, {
    x: 1.2,
    y: 2.4,
    w: 10.9,
    h: 2.4,
    fontSize: 30,
    italic: true,
    color: theme.text,
    align: "center",
    valign: "middle"
  });
  if (data.attribution) {
    slide.addText(`\u2014 ${data.attribution}`, {
      x: 1.2,
      y: 4.9,
      w: 10.9,
      h: 0.6,
      fontSize: 18,
      color: theme.primary,
      align: "center"
    });
  }
  withNotes(slide, data.notes);
}
function renderHeader(slide, theme, data) {
  slide.addText(data.title ?? "", {
    x: 0.8,
    y: 0.55,
    w: 11.7,
    h: 0.9,
    fontSize: 28,
    bold: true,
    color: theme.text,
    align: "left"
  });
  slide.addShape("rect", { x: 0.8, y: 1.5, w: 1.2, h: 0.07, fill: { color: theme.accent } });
}
function toBulletRuns(bullets, theme) {
  return bullets.map((bullet) => ({
    text: String(bullet),
    options: {
      bullet: { code: "2022", indent: 18 },
      color: theme.text,
      paraSpaceAfter: 8,
      breakLine: true
    }
  }));
}
export {
  buildPptx
};
