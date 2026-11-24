const PDFDocument = require("pdfkit");

// Renders resume content to an ATS-friendly PDF: one column, real selectable
// text, standard section headings, no text inside images or tables.
// The layout mirrors internarea/src/resume/ResumePreview.tsx.

const FONT_FAMILIES = {
  sans: { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique" },
  serif: { regular: "Times-Roman", bold: "Times-Bold", italic: "Times-Italic" },
  mono: { regular: "Courier", bold: "Courier-Bold", italic: "Courier-Oblique" },
};
const BASE_SIZES = { small: 9.5, medium: 10.5, large: 11.5 };

const TEXT = "#111827";
const MUTED = "#4b5563";
const RULE = "#d1d5db";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const formatMonth = (value) => {
  if (!value) return "";
  const [year, month] = value.split("-");
  return `${MONTHS[Number(month) - 1]} ${year}`;
};

function formatRange(start, end, current) {
  const from = formatMonth(start);
  const to = current ? "Present" : formatMonth(end);
  if (from && to) return `${from} - ${to}`;
  return from || to || "";
}

// Splits a description into bullet points (lines starting with -, * or •) and paragraphs.
function splitDescription(text) {
  return (text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const bullet = line.match(/^[-*•]\s*(.+)$/);
      return bullet ? { bullet: true, text: bullet[1] } : { bullet: false, text: line };
    });
}

function renderResumePdf({ title, design, data, photo }) {
  const fonts = FONT_FAMILIES[design.font] || FONT_FAMILIES.sans;
  const base = BASE_SIZES[design.fontSize] || BASE_SIZES.medium;
  const accent = design.color;
  const template = design.template;
  const margin = template === "minimal" ? 44 : 48;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    info: {
      Title: title || `${data.personal.fullName} - Resume`,
      Author: data.personal.fullName,
      Subject: "Resume",
      Creator: "InternArea Resume Builder",
    },
  });

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = margin;
  const right = doc.page.width - margin;
  const width = right - left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const ensureSpace = (height) => {
    if (doc.y + height > bottom()) doc.addPage();
  };

  const p = data.personal;
  const contactParts = [p.email, p.phone, p.location].filter(Boolean);
  const linkParts = (data.links || []).map((l) => `${l.label}: ${l.url.replace(/^https?:\/\//, "")}`);

  // ---- Header -------------------------------------------------------------
  const photoSize = 72;
  const photoBuffer = photo ? Buffer.from(photo.split(",")[1], "base64") : null;

  const drawPhoto = (x, y, border) => {
    if (!photoBuffer) return;
    doc.save();
    doc.circle(x + photoSize / 2, y + photoSize / 2, photoSize / 2).clip();
    doc.image(photoBuffer, x, y, { cover: [photoSize, photoSize], align: "center", valign: "center" });
    doc.restore();
    if (border) {
      doc.save().lineWidth(2).strokeColor(border)
        .circle(x + photoSize / 2, y + photoSize / 2, photoSize / 2).stroke().restore();
    }
  };

  const headerText = ({ x, y, w, align, nameColor, textColor, mutedColor }) => {
    doc.font(fonts.bold).fontSize(base * 2.3).fillColor(nameColor)
      .text(p.fullName, x, y, { width: w, align });
    if (p.headline) {
      doc.moveDown(0.15).font(fonts.regular).fontSize(base * 1.15).fillColor(textColor)
        .text(p.headline, x, doc.y, { width: w, align });
    }
    doc.moveDown(0.3).font(fonts.regular).fontSize(base * 0.92).fillColor(mutedColor);
    if (contactParts.length) doc.text(contactParts.join("  |  "), x, doc.y, { width: w, align });
    if (linkParts.length) doc.text(linkParts.join("  |  "), x, doc.y, { width: w, align });
  };

  const top = doc.y;
  if (template === "executive") {
    // A coloured band with white text. Measure the text first to size the band.
    const pad = 18;
    const textW = width - (photoBuffer ? photoSize + 16 : 0);
    const measure = () => {
      let h = doc.font(fonts.bold).fontSize(base * 2.3).heightOfString(p.fullName, { width: textW });
      if (p.headline) h += doc.font(fonts.regular).fontSize(base * 1.15).heightOfString(p.headline, { width: textW }) + base * 0.3;
      doc.font(fonts.regular).fontSize(base * 0.92);
      if (contactParts.length) h += doc.heightOfString(contactParts.join("  |  "), { width: textW }) + base * 0.3;
      if (linkParts.length) h += doc.heightOfString(linkParts.join("  |  "), { width: textW });
      return h;
    };
    const bandH = Math.max(measure(), photoBuffer ? photoSize : 0) + pad * 2;
    doc.save().rect(0, 0, doc.page.width, bandH + top - margin + 10).fill(accent).restore();
    const y = top - margin + 10 + pad;
    headerText({ x: left, y, w: textW, align: "left", nameColor: "#ffffff", textColor: "#ffffff", mutedColor: "#f3f4f6" });
    drawPhoto(right - photoSize, y, "#ffffff");
    doc.y = bandH + top - margin + 10 + 16;
  } else {
    const textW = width - (photoBuffer ? photoSize + 16 : 0);
    const centered = template === "classic" && !photoBuffer;
    headerText({
      x: left,
      y: top,
      w: textW,
      align: centered ? "center" : "left",
      nameColor: template === "minimal" ? TEXT : accent,
      textColor: TEXT,
      mutedColor: MUTED,
    });
    drawPhoto(right - photoSize, top, template === "modern" ? accent : null);
    const headerBottom = Math.max(doc.y, photoBuffer ? top + photoSize : 0);
    if (template === "modern") {
      doc.save().rect(left - 14, top, 4, headerBottom - top).fill(accent).restore();
    }
    doc.y = headerBottom + 6;
    if (template === "classic") {
      doc.save().moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1.5).strokeColor(accent).stroke().restore();
      doc.y += 6;
    }
  }

  // ---- Sections -----------------------------------------------------------
  const heading = (label) => {
    ensureSpace(base * 5);
    doc.moveDown(0.6);
    const y = doc.y;
    if (template === "minimal") {
      doc.font(fonts.bold).fontSize(base * 0.95).fillColor(accent)
        .text(label.toUpperCase(), left, y, { width, characterSpacing: 1.2 });
      doc.moveDown(0.25);
    } else if (template === "modern") {
      doc.font(fonts.bold).fontSize(base * 1.2).fillColor(accent).text(label, left, y, { width });
      doc.save().rect(left, doc.y + 1, 28, 2).fill(accent).restore();
      doc.y += 7;
    } else {
      const color = template === "executive" ? TEXT : accent;
      doc.font(fonts.bold).fontSize(base * 1.12).fillColor(color).text(label.toUpperCase(), left, y, { width, characterSpacing: 0.6 });
      const ruleY = doc.y + 1;
      doc.save().moveTo(left, ruleY).lineTo(right, ruleY).lineWidth(0.75)
        .strokeColor(template === "executive" ? accent : RULE).stroke().restore();
      doc.y = ruleY + 5;
    }
  };

  const paragraph = (text, options = {}) => {
    doc.font(options.italic ? fonts.italic : fonts.regular).fontSize(base).fillColor(options.color || TEXT)
      .text(text, left + (options.indent || 0), doc.y, { width: width - (options.indent || 0), lineGap: 1.5 });
  };

  const bullet = (text, indent = 0) => {
    ensureSpace(base * 1.6);
    const y = doc.y;
    doc.font(fonts.regular).fontSize(base).fillColor(TEXT);
    doc.text("•", left + indent, y, { width: 10, lineBreak: false });
    doc.text(text, left + indent + 11, y, { width: width - indent - 11, lineGap: 1.5 });
  };

  const description = (text) => {
    for (const part of splitDescription(text)) {
      if (part.bullet) bullet(part.text, 4);
      else {
        ensureSpace(base * 1.6);
        paragraph(part.text);
      }
    }
  };

  // Title on the left, dates on the right, then a muted subtitle line.
  const entryHeader = (titleText, dateText, subtitle) => {
    ensureSpace(base * 4);
    doc.moveDown(0.35);
    const y = doc.y;
    doc.font(fonts.regular).fontSize(base * 0.92);
    const dateW = dateText ? doc.widthOfString(dateText) : 0;
    if (dateText) {
      doc.fillColor(MUTED).text(dateText, right - dateW, y, { width: dateW + 1, lineBreak: false });
    }
    doc.font(fonts.bold).fontSize(base * 1.02).fillColor(TEXT)
      .text(titleText, left, y, { width: width - dateW - (dateText ? 12 : 0) });
    if (subtitle) {
      doc.font(fonts.italic).fontSize(base * 0.95).fillColor(MUTED).text(subtitle, left, doc.y, { width });
    }
    doc.moveDown(0.15);
  };

  if (data.objective) {
    heading("Career Objective");
    paragraph(data.objective);
  }

  if (data.education.length) {
    heading("Education");
    for (const e of data.education) {
      const titleText = [e.degree, e.field].filter(Boolean).join(", ");
      const subtitle = [e.institution, e.score].filter(Boolean).join("  |  ");
      entryHeader(titleText, formatRange(e.startDate, e.endDate), subtitle);
      if (e.description) description(e.description);
    }
  }

  const roleSection = (label, items) => {
    if (!items.length) return;
    heading(label);
    for (const r of items) {
      entryHeader(r.role, formatRange(r.startDate, r.endDate, r.current), [r.organization, r.location].filter(Boolean).join(", "));
      if (r.description) description(r.description);
    }
  };
  roleSection("Work Experience", data.experience);
  roleSection("Internships", data.internships);

  if (data.projects.length) {
    heading("Projects");
    for (const pr of data.projects) {
      const subtitle = [pr.technologies, pr.link.replace(/^https?:\/\//, "")].filter(Boolean).join("  |  ");
      entryHeader(pr.name, formatRange(pr.startDate, pr.endDate), subtitle);
      description(pr.description);
    }
  }

  if (data.skills.length) {
    heading("Skills");
    paragraph(data.skills.join("  •  "));
  }

  if (data.certifications.length) {
    heading("Certifications");
    for (const c of data.certifications) {
      entryHeader(c.name, formatMonth(c.date), [c.issuer, c.url.replace(/^https?:\/\//, "")].filter(Boolean).join("  |  "));
    }
  }

  if (data.achievements.length) {
    heading("Achievements");
    data.achievements.forEach((a) => bullet(a));
  }

  if (data.languages.length) {
    heading("Languages");
    paragraph(data.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join("  •  "));
  }

  if (data.references.length) {
    heading("References");
    for (const r of data.references) {
      entryHeader(r.name, "", [r.designation, r.organization, r.relationship].filter(Boolean).join(", "));
      const contact = [r.email, r.phone].filter(Boolean).join("  |  ");
      if (contact) paragraph(contact, { color: MUTED });
    }
  }

  doc.end();
  return done;
}

module.exports = { renderResumePdf, formatRange };
