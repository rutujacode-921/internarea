import React, { useEffect, useRef, useState } from "react";
import { BASE_SIZES, FONT_STACKS, formatMonth, formatRange, ResumeData, ResumeDesign } from "./config";

// HTML twin of backend/utils/resumePdf.js. Sizes are in PDF points (1pt = 1px
// here) on a 595 x 842 A4 page, scaled down to fit the available width.

const PAGE_W = 595;
const PAGE_H = 842;
const TEXT = "#111827";
const MUTED = "#4b5563";
const RULE = "#d1d5db";

interface Props {
  design: ResumeDesign;
  data: ResumeData;
  photo: string | null;
}

const stripScheme = (url: string) => url.replace(/^https?:\/\//, "");

function Description({ text, base }: { text: string; base: number }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return (
    <>
      {lines.map((line, i) => {
        const bullet = line.match(/^[-*•]\s*(.+)$/);
        return bullet ? (
          <div key={i} style={{ display: "flex", paddingLeft: 4, fontSize: base, lineHeight: 1.3 }}>
            <span style={{ width: 11, flexShrink: 0 }}>•</span>
            <span>{bullet[1]}</span>
          </div>
        ) : (
          <p key={i} style={{ fontSize: base, lineHeight: 1.3, margin: 0 }}>
            {line}
          </p>
        );
      })}
    </>
  );
}

export default function ResumePreview({ design, data, photo }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(PAGE_H);

  useEffect(() => {
    const wrap = wrapRef.current;
    const page = pageRef.current;
    if (!wrap || !page) return;
    const update = () => {
      setScale(Math.min(wrap.clientWidth / PAGE_W, 1.4));
      setHeight(Math.max(page.scrollHeight, PAGE_H));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    observer.observe(page);
    return () => observer.disconnect();
  }, []);

  const base = BASE_SIZES[design.fontSize];
  const accent = design.color;
  const { template } = design;
  const margin = template === "minimal" ? 44 : 48;
  const p = data.personal;
  const contact = [p.email, p.phone, p.location].filter(Boolean).join("  |  ");
  const links = data.links.map((l) => `${l.label}: ${stripScheme(l.url)}`).join("  |  ");
  const centered = template === "classic" && !photo;
  const executive = template === "executive";

  const header = (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0, textAlign: centered ? "center" : "left" }}>
        <div
          style={{
            fontWeight: 700,
            fontSize: base * 2.3,
            lineHeight: 1.15,
            color: executive ? "#fff" : template === "minimal" ? TEXT : accent,
          }}
        >
          {p.fullName || "Your Name"}
        </div>
        {p.headline && (
          <div style={{ fontSize: base * 1.15, marginTop: base * 0.15, color: executive ? "#fff" : TEXT }}>
            {p.headline}
          </div>
        )}
        <div style={{ fontSize: base * 0.92, marginTop: base * 0.3, color: executive ? "#f3f4f6" : MUTED, whiteSpace: "pre-wrap" }}>
          {contact && <div>{contact}</div>}
          {links && <div>{links}</div>}
        </div>
      </div>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo}
          alt=""
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            objectFit: "cover",
            flexShrink: 0,
            border: executive ? "2px solid #fff" : template === "modern" ? `2px solid ${accent}` : "none",
          }}
        />
      )}
    </div>
  );

  const Heading = ({ label }: { label: string }) => {
    if (template === "minimal") {
      return (
        <div style={{ marginTop: base * 0.9, marginBottom: base * 0.25, fontWeight: 700, fontSize: base * 0.95, color: accent, letterSpacing: 1.2, textTransform: "uppercase" }}>
          {label}
        </div>
      );
    }
    if (template === "modern") {
      return (
        <div style={{ marginTop: base * 0.9, marginBottom: 5 }}>
          <div style={{ fontWeight: 700, fontSize: base * 1.2, color: accent }}>{label}</div>
          <div style={{ width: 28, height: 2, background: accent, marginTop: 1 }} />
        </div>
      );
    }
    return (
      <div
        style={{
          marginTop: base * 0.9,
          marginBottom: 5,
          paddingBottom: 1,
          fontWeight: 700,
          fontSize: base * 1.12,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          color: executive ? TEXT : accent,
          borderBottom: `0.75px solid ${executive ? accent : RULE}`,
        }}
      >
        {label}
      </div>
    );
  };

  const Entry = ({ title, date, subtitle, children }: { title: string; date?: string; subtitle?: string; children?: React.ReactNode }) => (
    <div style={{ marginTop: base * 0.35 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontWeight: 700, fontSize: base * 1.02, color: TEXT }}>{title}</span>
        {date && <span style={{ fontSize: base * 0.92, color: MUTED, whiteSpace: "nowrap" }}>{date}</span>}
      </div>
      {subtitle && <div style={{ fontStyle: "italic", fontSize: base * 0.95, color: MUTED }}>{subtitle}</div>}
      <div style={{ marginTop: base * 0.15 }}>{children}</div>
    </div>
  );

  const roles = (label: string, items: ResumeData["experience"]) =>
    items.length > 0 && (
      <>
        <Heading label={label} />
        {items.map((r, i) => (
          <Entry key={i} title={r.role} date={formatRange(r.startDate, r.endDate, r.current)} subtitle={[r.organization, r.location].filter(Boolean).join(", ")}>
            {r.description && <Description text={r.description} base={base} />}
          </Entry>
        ))}
      </>
    );

  return (
    <div ref={wrapRef} className="w-full">
      <div style={{ height: height * scale, overflow: "hidden" }}>
        <div
          ref={pageRef}
          aria-label="Resume preview"
          style={{
            width: PAGE_W,
            minHeight: PAGE_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: `#fff repeating-linear-gradient(to bottom, transparent 0, transparent ${PAGE_H - 1}px, #e5e7eb ${PAGE_H - 1}px, #e5e7eb ${PAGE_H}px)`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            fontFamily: FONT_STACKS[design.font],
            color: TEXT,
            padding: `${executive ? 0 : margin}px ${margin}px ${margin}px`,
            boxSizing: "border-box",
            wordBreak: "break-word",
          }}
        >
          {executive ? (
            <div style={{ background: accent, margin: `0 -${margin}px 16px`, padding: `28px ${margin}px 18px` }}>{header}</div>
          ) : (
            <div
              style={{
                borderLeft: template === "modern" ? `4px solid ${accent}` : undefined,
                marginLeft: template === "modern" ? -14 : 0,
                paddingLeft: template === "modern" ? 10 : 0,
                borderBottom: template === "classic" ? `1.5px solid ${accent}` : undefined,
                paddingBottom: template === "classic" ? 6 : 0,
                marginBottom: 6,
              }}
            >
              {header}
            </div>
          )}

          {data.objective && (
            <>
              <Heading label="Career Objective" />
              <Description text={data.objective} base={base} />
            </>
          )}

          {data.education.length > 0 && (
            <>
              <Heading label="Education" />
              {data.education.map((e, i) => (
                <Entry
                  key={i}
                  title={[e.degree, e.field].filter(Boolean).join(", ")}
                  date={formatRange(e.startDate, e.endDate)}
                  subtitle={[e.institution, e.score].filter(Boolean).join("  |  ")}
                >
                  {e.description && <Description text={e.description} base={base} />}
                </Entry>
              ))}
            </>
          )}

          {roles("Work Experience", data.experience)}
          {roles("Internships", data.internships)}

          {data.projects.length > 0 && (
            <>
              <Heading label="Projects" />
              {data.projects.map((pr, i) => (
                <Entry
                  key={i}
                  title={pr.name}
                  date={formatRange(pr.startDate, pr.endDate)}
                  subtitle={[pr.technologies, stripScheme(pr.link)].filter(Boolean).join("  |  ")}
                >
                  {pr.description && <Description text={pr.description} base={base} />}
                </Entry>
              ))}
            </>
          )}

          {data.skills.length > 0 && (
            <>
              <Heading label="Skills" />
              <p style={{ fontSize: base, margin: 0, lineHeight: 1.3 }}>{data.skills.join("  •  ")}</p>
            </>
          )}

          {data.certifications.length > 0 && (
            <>
              <Heading label="Certifications" />
              {data.certifications.map((c, i) => (
                <Entry key={i} title={c.name} date={formatMonth(c.date)} subtitle={[c.issuer, stripScheme(c.url)].filter(Boolean).join("  |  ")} />
              ))}
            </>
          )}

          {data.achievements.length > 0 && (
            <>
              <Heading label="Achievements" />
              <Description text={data.achievements.map((a) => `- ${a}`).join("\n")} base={base} />
            </>
          )}

          {data.languages.length > 0 && (
            <>
              <Heading label="Languages" />
              <p style={{ fontSize: base, margin: 0 }}>
                {data.languages.map((l) => (l.proficiency ? `${l.name} (${l.proficiency})` : l.name)).join("  •  ")}
              </p>
            </>
          )}

          {data.references.length > 0 && (
            <>
              <Heading label="References" />
              {data.references.map((r, i) => (
                <Entry key={i} title={r.name} subtitle={[r.designation, r.organization, r.relationship].filter(Boolean).join(", ")}>
                  {(r.email || r.phone) && (
                    <p style={{ fontSize: base, color: MUTED, margin: 0 }}>{[r.email, r.phone].filter(Boolean).join("  |  ")}</p>
                  )}
                </Entry>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
