const PDFDocument = require("pdfkit");

const SELLER = {
  name: process.env.INVOICE_SELLER_NAME || "InternArea",
  address: process.env.INVOICE_SELLER_ADDRESS || "India",
  email: process.env.INVOICE_SELLER_EMAIL || "",
};

// Amounts are stored in paise. The PDF fonts have no rupee sign, so "Rs." is used.
const money = (paise, currency = "INR") =>
  `${currency === "INR" ? "Rs." : currency} ${(paise / 100).toFixed(2)}`;

const formatDate = (date) =>
  new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

// Builds a simple payment invoice for a paid transaction.
function renderInvoicePdf(payment) {
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Invoice ${payment.invoice.number}` } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 50;
  const right = doc.page.width - 50;
  const width = right - left;

  doc.font("Helvetica-Bold").fontSize(22).fillColor("#1d4ed8").text(SELLER.name, left, 50);
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563").text(SELLER.address);
  if (SELLER.email) doc.text(SELLER.email);

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#111827").text("INVOICE", left, 50, { width, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor("#4b5563")
    .text(`Invoice no: ${payment.invoice.number}`, { width, align: "right" })
    .text(`Date: ${formatDate(payment.invoice.issuedAt)}`, { width, align: "right" })
    .text(`Status: ${payment.status === "refunded" ? "REFUNDED" : "PAID"}`, { width, align: "right" });
  if (payment.gateway === "mock") {
    doc.font("Helvetica-Bold").fillColor("#b45309").text("TEST INVOICE - NOT A REAL PAYMENT", { width, align: "right" });
  }

  doc.moveDown(2);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("Billed to", left);
  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  if (payment.name) doc.text(payment.name);
  if (payment.email) doc.text(payment.email);

  // Line items
  doc.moveDown(1.5);
  let y = doc.y;
  doc.save().rect(left, y, width, 22).fill("#f3f4f6").restore();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827");
  doc.text("Description", left + 8, y + 7);
  doc.text("Qty", left + width - 170, y + 7, { width: 40, align: "right" });
  doc.text("Amount", left + width - 110, y + 7, { width: 102, align: "right" });
  y += 30;
  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  doc.text(payment.description || payment.purpose, left + 8, y, { width: width - 190 });
  doc.text("1", left + width - 170, y, { width: 40, align: "right" });
  doc.text(money(payment.amount, payment.currency), left + width - 110, y, { width: 102, align: "right" });
  y = Math.max(doc.y, y + 14) + 10;
  doc.save().moveTo(left, y).lineTo(right, y).strokeColor("#e5e7eb").stroke().restore();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827");
  doc.text("Total paid", left + width - 260, y, { width: 140, align: "right" });
  doc.text(money(payment.amount, payment.currency), left + width - 110, y, { width: 102, align: "right" });
  if (payment.status === "refunded") {
    y += 18;
    doc.font("Helvetica").fontSize(10).fillColor("#b91c1c");
    doc.text("Refunded", left + width - 260, y, { width: 140, align: "right" });
    doc.text(`- ${money(payment.amount, payment.currency)}`, left + width - 110, y, { width: 102, align: "right" });
  }

  // Payment details
  doc.moveDown(3);
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text("Payment details", left);
  doc.font("Helvetica").fontSize(10).fillColor("#374151");
  doc.text(`Paid on: ${formatDate(payment.paidAt || payment.invoice.issuedAt)}`);
  doc.text(`Payment ID: ${payment.razorpayPaymentId}`);
  doc.text(`Order ID: ${payment.razorpayOrderId}`);
  if (payment.method) doc.text(`Method: ${payment.method}`);
  doc.text(payment.gateway === "mock" ? "Simulated test payment - no money was charged" : "Processed by Razorpay");

  doc.moveDown(3);
  doc.fontSize(9).fillColor("#6b7280").text("This is a computer-generated invoice and does not need a signature.", left, doc.y, { width, align: "center" });

  doc.end();
  return done;
}

module.exports = { renderInvoicePdf };
