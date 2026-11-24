import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import {
  CheckCircle2,
  Copy,
  Crown,
  Download,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { selectuser } from "@/Feature/Userslice";
import { api, getApiError } from "@/lib/api";
import { useLanguage } from "@/i18n/LanguageProvider";
import PaymentFlowModal from "@/Components/PaymentFlowModal";
import { formatPaise } from "@/resume/config";
import {
  downloadGeneratedResume,
  downloadInvoice,
  fetchTransaction,
  forgetPendingPayment,
  isFinal,
  Plans,
  readBlobError,
  readPendingPayment,
  Transaction,
  viewGeneratedResume,
} from "@/resume/payments";

interface DraftSummary {
  id: string;
  title: string;
  template: string;
  color: string;
  version: number;
  updatedAt: string;
  issueCount: number;
}
interface GeneratedSummary {
  id: string;
  title: string;
  fileName: string;
  template: string;
  color: string;
  size: number;
  resumeVersion: number;
  downloadCount: number;
  lastDownloadedAt: string | null;
  createdAt: string;
  isDefault: boolean;
}
interface DownloadEntry {
  _id: string;
  title: string;
  kind: "download" | "shared_view";
  ip: string;
  browser: string;
  os: string;
  device: string;
  createdAt: string;
}

const TABS = ["drafts", "generated", "payments", "downloads"] as const;
type Tab = (typeof TABS)[number];

const STATUS_STYLES: Record<string, string> = {
  created: "bg-blue-100 text-blue-800",
  paid: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-gray-100 text-gray-700",
  expired: "bg-gray-100 text-gray-700",
  refunded: "bg-amber-100 text-amber-800",
};

export default function ResumeHome() {
  const user = useSelector(selectuser) as { uid: string; email?: string } | null;
  const { t, formatDate, locale } = useLanguage();
  const router = useRouter();
  const tab: Tab = TABS.includes(router.query.tab as Tab) ? (router.query.tab as Tab) : "drafts";

  const [plans, setPlans] = useState<Plans | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [generated, setGenerated] = useState<GeneratedSummary[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const dateTime = (value: string | null) =>
    formatDate(value, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const showError = useCallback(
    async (error: unknown) => {
      const err = getApiError(await readBlobError(error));
      toast.error(err.code === "NETWORK" ? t("errors.network") : err.message || t("errors.generic"));
    },
    [t]
  );

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [p, d, g, tx, dl] = await Promise.all([
        api.get("/api/payments/plans"),
        api.get("/api/resumes/drafts"),
        api.get("/api/resumes/generated"),
        api.get("/api/payments"),
        api.get("/api/resumes/downloads"),
      ]);
      setPlans(p.data);
      setDrafts(d.data.drafts);
      setGenerated(g.data.resumes);
      setTransactions(tx.data.transactions);
      setDownloads(dl.data.entries);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Pick up a payment that was interrupted (tab closed, connection lost).
  useEffect(() => {
    if (!user) return;
    const pending = readPendingPayment();
    if (!pending) return;
    fetchTransaction(pending.transactionId)
      .then((tx) => {
        if (!isFinal(tx)) return toast.info(t("resume.pay.stillConfirmingShort"));
        forgetPendingPayment(tx.transactionId);
        if (tx.status === "paid" || tx.status === "refunded") {
          toast.success(t("resume.pay.recovered"));
          load();
        }
      })
      .catch(() => {});
  }, [user, load, t]);

  const setTab = (next: Tab) => router.replace({ pathname: "/resume", query: { tab: next } }, undefined, { shallow: true });

  const createDraft = async (copyFrom?: string) => {
    setBusyId(copyFrom || "new");
    try {
      const { data } = await api.post("/api/resumes/drafts", copyFrom ? { copyFrom } : {});
      router.push(`/resume/${data.resume.id}`);
    } catch (error) {
      showError(error);
      setBusyId(null);
    }
  };

  const deleteDraft = async (draft: DraftSummary) => {
    if (!window.confirm(t("resume.drafts.confirmDelete", { title: draft.title }))) return;
    setBusyId(draft.id);
    try {
      await api.delete(`/api/resumes/drafts/${draft.id}`);
      setDrafts((list) => list.filter((d) => d.id !== draft.id));
      toast.success(t("resume.drafts.deleted"));
    } catch (error) {
      showError(error);
    } finally {
      setBusyId(null);
    }
  };

  const setDefault = async (id: string) => {
    setBusyId(id);
    try {
      await api.put("/api/resumes/default", { generatedResumeId: id });
      setGenerated((list) => list.map((g) => ({ ...g, isDefault: g.id === id })));
      toast.success(t("resume.generated.defaultSet"));
    } catch (error) {
      showError(error);
    } finally {
      setBusyId(null);
    }
  };

  const runFile = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    try {
      await action();
    } catch (error) {
      showError(error);
    } finally {
      setBusyId(null);
    }
  };

  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-600">{t("resume.signIn")}</p>
      </div>
    );
  }

  const premium = plans?.status;
  const premiumPrice = plans ? formatPaise(plans.premium.price, locale) : "";
  const resumePrice = plans ? formatPaise(plans.resume.price, locale) : "";

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t("resume.dashboard.title")}</h1>
            <p className="mt-1 text-gray-600">{t("resume.dashboard.subtitle")}</p>
          </div>
          {premium?.active && (
            <span className="inline-flex items-center gap-1 self-start rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-800">
              <Crown className="h-4 w-4" />
              {t("resume.premium.activeUntil", { date: formatDate(premium.until) })}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : loadFailed ? (
          <div className="rounded-xl bg-white p-8 text-center shadow">
            <p className="mb-4 text-gray-700">{t("resume.dashboard.loadFailed")}</p>
            <button onClick={load} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
              <RefreshCw className="h-4 w-4" />
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <>
            {plans?.mode === "mock" && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="note">
                {t("resume.pay.mock.banner")}
              </div>
            )}

            {/* Premium */}
            {plans && !premium?.active && (
              <div className="mb-8 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
                <div className="grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center md:p-8">
                  <div>
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1 text-sm font-medium">
                      <Crown className="h-4 w-4" />
                      {t("resume.premium.badge")}
                    </div>
                    <h2 className="text-2xl font-bold">{t("resume.premium.title")}</h2>
                    {premium?.until && <p className="mt-1 text-blue-100">{t("resume.premium.expired", { date: formatDate(premium.until) })}</p>}
                    <p className="mt-2 text-blue-50">{t("resume.premium.description", { days: plans.premium.durationDays })}</p>
                    <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                      {["templates", "customize", "preview", "versions", "default", "history"].map((key) => (
                        <li key={key} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          {t(`resume.premium.features.${key}`)}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-4 text-sm text-blue-100">{t("resume.premium.perResume", { price: resumePrice })}</p>
                  </div>
                  <div className="text-center">
                    <div className="text-4xl font-bold">{premiumPrice}</div>
                    <div className="mb-4 text-blue-100">{t("resume.premium.period", { days: plans.premium.durationDays })}</div>
                    <button
                      onClick={() => setUpgradeOpen(true)}
                      disabled={!plans.configured}
                      className="rounded-lg bg-white px-6 py-3 font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {t("resume.premium.upgrade", { price: premiumPrice })}
                    </button>
                    {!plans.configured && <p className="mt-2 text-xs text-blue-100">{t("resume.premium.notConfigured")}</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200" role="tablist">
              {TABS.map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${tab === key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900"}`}
                >
                  {t(`resume.tabs.${key}`)}
                </button>
              ))}
            </div>

            {tab === "drafts" && (
              <section>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-gray-600">{premium?.active ? t("resume.drafts.help", { price: resumePrice }) : t("resume.drafts.premiumOnly")}</p>
                  <div className="flex items-center gap-2">
                    {premium?.active && (
                      <button
                        onClick={() => setUpgradeOpen(true)}
                        disabled={!plans?.configured}
                        className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60"
                      >
                        {t("resume.premium.extend", { price: premiumPrice })}
                      </button>
                    )}
                    <button
                      onClick={() => createDraft()}
                      disabled={!premium?.active || busyId === "new"}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {t("resume.drafts.new")}
                    </button>
                  </div>
                </div>
                {drafts.length === 0 ? (
                  <EmptyState icon={<FileText className="h-10 w-10" />} text={t("resume.drafts.empty")} />
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {drafts.map((draft) => (
                      <div key={draft.id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 h-1.5 rounded-full" style={{ background: draft.color }} />
                        <h3 className="truncate font-semibold text-gray-900">{draft.title}</h3>
                        <p className="text-xs text-gray-500">
                          {t(`resume.builder.templates.${draft.template}.name`)} · {t("resume.drafts.version", { version: draft.version })} ·{" "}
                          {t("resume.drafts.updated", { date: formatDate(draft.updatedAt) })}
                        </p>
                        <p className={`mt-2 text-sm ${draft.issueCount ? "text-amber-700" : "text-green-700"}`}>
                          {draft.issueCount ? t("resume.drafts.incomplete", { count: draft.issueCount }) : t("resume.drafts.ready")}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link href={`/resume/${draft.id}`} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700">
                            <Pencil className="h-3.5 w-3.5" />
                            {premium?.active ? t("resume.drafts.edit") : t("resume.drafts.view")}
                          </Link>
                          <button
                            onClick={() => createDraft(draft.id)}
                            disabled={!premium?.active || busyId === draft.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {t("resume.drafts.duplicate")}
                          </button>
                          <button
                            onClick={() => deleteDraft(draft)}
                            disabled={busyId === draft.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("resume.drafts.delete")}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {tab === "generated" && (
              <section>
                <p className="mb-4 text-sm text-gray-600">{t("resume.generated.defaultHelp")}</p>
                {generated.length === 0 ? (
                  <EmptyState icon={<FileText className="h-10 w-10" />} text={t("resume.generated.empty")} />
                ) : (
                  <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                    {generated.map((g) => (
                      <li key={g.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: g.color }} />
                            <h3 className="truncate font-semibold text-gray-900">{g.title}</h3>
                            {g.isDefault && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                                <Star className="h-3 w-3" />
                                {t("resume.generated.default")}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500">
                            {t("resume.generated.createdOn", { date: dateTime(g.createdAt) })} · {t("resume.drafts.version", { version: g.resumeVersion })} ·{" "}
                            {t("resume.generated.downloads", { count: g.downloadCount })}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!g.isDefault && (
                            <button onClick={() => setDefault(g.id)} disabled={busyId === g.id} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                              {t("resume.generated.setDefault")}
                            </button>
                          )}
                          <button onClick={() => runFile(g.id, () => viewGeneratedResume(g.id))} disabled={busyId === g.id} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            <Eye className="h-3.5 w-3.5" />
                            {t("resume.generated.view")}
                          </button>
                          <button
                            onClick={() => runFile(g.id, async () => {
                              await downloadGeneratedResume(g.id);
                              setGenerated((list) => list.map((x) => (x.id === g.id ? { ...x, downloadCount: x.downloadCount + 1 } : x)));
                            })}
                            disabled={busyId === g.id}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {busyId === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            {t("resume.generated.download")}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {tab === "payments" && (
              <section>
                {transactions.length === 0 ? (
                  <EmptyState icon={<FileText className="h-10 w-10" />} text={t("resume.payments.empty")} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                        <tr>
                          <th className="px-4 py-3">{t("resume.payments.date")}</th>
                          <th className="px-4 py-3">{t("resume.payments.item")}</th>
                          <th className="px-4 py-3">{t("resume.payments.amount")}</th>
                          <th className="px-4 py-3">{t("resume.payments.status")}</th>
                          <th className="px-4 py-3">{t("resume.payments.reference")}</th>
                          <th className="px-4 py-3">{t("resume.payments.invoice")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {transactions.map((tx) => (
                          <tr key={tx.transactionId} className="align-top">
                            <td className="whitespace-nowrap px-4 py-3 text-gray-700">{dateTime(tx.paidAt || tx.createdAt)}</td>
                            <td className="px-4 py-3 text-gray-900">
                              <div className="font-medium">
                                {t(`resume.payments.purposes.${tx.purpose}`)}
                                {tx.gateway === "mock" && (
                                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">{t("resume.pay.mock.tag")}</span>
                                )}
                              </div>
                              {tx.resumeTitle && <div className="text-xs text-gray-500">{tx.resumeTitle}</div>}
                              {tx.duplicate && <div className="text-xs text-amber-700">{t("resume.payments.duplicateRefunded")}</div>}
                              {tx.refundStatus === "failed" && <div className="text-xs text-red-700">{t("resume.payments.refundPending")}</div>}
                              {tx.fulfillmentFailed && <div className="text-xs text-amber-700">{t("resume.payments.generating")}</div>}
                              {tx.failureReason && tx.status !== "paid" && <div className="text-xs text-gray-500">{tx.failureReason}</div>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-900">{formatPaise(tx.amount, locale)}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[tx.status]}`}>{t(`resume.payments.statuses.${tx.status}`)}</span>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-500">
                              <div>{tx.razorpayOrderId}</div>
                              {tx.razorpayPaymentId && <div>{tx.razorpayPaymentId}</div>}
                              {tx.method && <div className="font-sans">{tx.method}</div>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3">
                              {tx.invoiceNumber ? (
                                <button
                                  onClick={() => runFile(tx.transactionId, () => downloadInvoice(tx.transactionId))}
                                  disabled={busyId === tx.transactionId}
                                  className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 disabled:opacity-50"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                  {tx.invoiceNumber}
                                </button>
                              ) : (
                                <span className="text-gray-400">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {tab === "downloads" && (
              <section>
                {downloads.length === 0 ? (
                  <EmptyState icon={<Download className="h-10 w-10" />} text={t("resume.downloads.empty")} />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                        <tr>
                          <th className="px-4 py-3">{t("resume.downloads.date")}</th>
                          <th className="px-4 py-3">{t("resume.downloads.resume")}</th>
                          <th className="px-4 py-3">{t("resume.downloads.type")}</th>
                          <th className="px-4 py-3">{t("resume.downloads.device")}</th>
                          <th className="px-4 py-3">{t("resume.downloads.ip")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {downloads.map((d) => (
                          <tr key={d._id}>
                            <td className="whitespace-nowrap px-4 py-3 text-gray-700">{dateTime(d.createdAt)}</td>
                            <td className="px-4 py-3 text-gray-900">{d.title}</td>
                            <td className="px-4 py-3 text-gray-700">{t(`resume.downloads.kinds.${d.kind}`)}</td>
                            <td className="px-4 py-3 text-gray-700">
                              {d.browser} · {d.os} · {d.device}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.ip}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {upgradeOpen && plans && (
        <PaymentFlowModal
          purpose="premium"
          price={plans.premium.price}
          itemLabel={t("resume.premium.item", { days: plans.premium.durationDays })}
          onClose={() => setUpgradeOpen(false)}
          onCompleted={() => load()}
        />
      )}
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-400">
      {icon}
      <p className="text-gray-600">{text}</p>
    </div>
  );
}
