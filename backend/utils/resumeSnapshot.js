const { normalizeResumeData, normalizeDesign, findResumeIssues, contentHash } = require("./resumeData");

// Freezes a draft into the exact content that will be paid for and rendered.
function buildResumeSnapshot(resume) {
  const design = normalizeDesign(resume);
  const data = normalizeResumeData(resume.data);
  const snapshot = { title: resume.title, design, data, photo: resume.photo || null };
  return {
    snapshot,
    issues: findResumeIssues(data),
    contentHash: contentHash({ data, design, photo: snapshot.photo }),
  };
}

module.exports = { buildResumeSnapshot };
