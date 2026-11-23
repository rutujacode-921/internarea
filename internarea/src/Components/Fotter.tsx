import { Facebook, Twitter, Instagram } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageProvider";

export default function Footer() {
  const { t } = useLanguage();
  const item = (key: string) => t(`footer.items.${key}`);
  return (
    <footer className="bg-gray-800 text-white py-12">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          {/* City names are proper nouns and are intentionally not translated. */}
          <FooterSection title={t("footer.byPlaces")} items={["New York", "Los Angeles", "Chicago", "San Francisco", "Miami", "Seattle"]} />
          <FooterSection title={t("footer.byStream")} items={["aboutUs", "careers", "press", "news", "mediaKit", "contact"].map(item)} />
          <FooterSection title={t("footer.jobPlaces")} items={["blog", "newsletter", "events", "helpCenter", "tutorials", "support"].map(item)} links />
          <FooterSection title={t("footer.jobsByStreams")} items={["startups", "enterprise", "government", "saas", "marketplaces", "ecommerce"].map(item)} links />
        </div>

        <hr className="my-10 border-gray-600" />

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          <FooterSection title={t("footer.aboutUs")} items={[item("startups"), item("enterprise")]} links />
          <FooterSection title={t("footer.teamDiary")} items={[item("startups"), item("enterprise")]} links />
          <FooterSection title={t("footer.terms")} items={[item("startups"), item("enterprise")]} links />
          <FooterSection title={t("footer.sitemap")} items={[item("startups")]} links />
        </div>

        <div className="mt-10 flex flex-col sm:flex-row justify-between items-center">
          <p className="flex items-center gap-2 border border-white px-4 py-2 rounded-lg cursor-pointer hover:bg-gray-700">
            <i className="bi bi-google-play"></i> {t("footer.getApp")}
          </p>
          <div className="flex space-x-4 mt-4 sm:mt-0">
            <Facebook className="w-6 h-6 hover:text-blue-400 cursor-pointer" />
            <Twitter className="w-6 h-6 hover:text-blue-400 cursor-pointer" />
            <Instagram className="w-6 h-6 hover:text-pink-400 cursor-pointer" />
          </div>
          <p className="mt-4 sm:mt-0 text-sm text-gray-400">{t("footer.copyright", { year: 2025 })}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterSection({ title, items, links }: { title: string; items: string[]; links?: boolean }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-gray-300">{title}</h3>
      <div className="flex flex-col items-start mt-4 space-y-3">
        {items.map((item, index) =>
          links ? (
            <a key={index} href="/" className="text-gray-400 hover:text-blue-400 hover:underline">
              {item}
            </a>
          ) : (
            <p key={index} className="text-gray-400 hover:text-blue-400 hover:underline cursor-pointer">
              {item}
            </p>
          )
        )}
      </div>
    </div>
  );
}
