import React from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { endSession } from "@/lib/session";
import { toast } from "react-toastify";
import { useSelector } from "react-redux";
import { selectuser } from "@/Feature/Userslice";
import { useLanguage } from "@/i18n/LanguageProvider";
import LanguageSwitcher from "./LanguageSwitcher";
import NotificationBell from "@/space/NotificationBell";

const Navbar = () => {
  const user = useSelector(selectuser);
  const { t } = useLanguage();

  const handlelogout = async () => {
    await endSession();
    toast.info(t("auth.logoutSuccess"));
  };
  return (
    <div className="relative">
      <nav className="bg-white shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            {/* Logo */}
            <div className="flex-shrink-0">
              <a href="/" className="text-xl font-bold text-blue-600">
                <img src={"/logo.png"} alt="InternArea" className="h-16" />
              </a>
            </div>
            {/* Navigation Links */}
            <div className="hidden md:flex items-center space-x-8">
              <button className="flex items-center space-x-1 text-gray-700 hover:text-blue-600">
                <Link href={"/internship"}>
                  <span>{t("nav.internships")}</span>
                </Link>
              </button>
              <button className="flex items-center space-x-1 text-gray-700 hover:text-blue-600">
                <Link href={"/job"}>
                  <span>{t("nav.jobs")}</span>
                </Link>
              </button>
              <button className="flex items-center space-x-1 text-gray-700 hover:text-blue-600">
                <Link href={"/space"}>
                  <span>{t("space.nav.link")}</span>
                </Link>
              </button>
              <button className="flex items-center space-x-1 text-gray-700 hover:text-blue-600">
                <Link href={"/resume"}>
                  <span>{t("resume.nav")}</span>
                </Link>
              </button>
              <button className="flex items-center space-x-1 text-gray-700 hover:text-blue-600">
                <Link href={"/plans"}>
                  <span>{t("plans.nav")}</span>
                </Link>
              </button>
              <div className="flex items-center bg-gray-100 rounded-full px-4 py-2">
                <Search size={16} className="text-gray-400" />
                <input
                  type="text"
                  placeholder={t("nav.searchPlaceholder")}
                  className="ml-2 bg-transparent focus:outline-none text-sm w-48"
                />
              </div>
            </div>

            {/* Language + Auth Buttons */}
            <div className="flex items-center space-x-4">
              <LanguageSwitcher />
              {user ? (
                <div className="relative flex items-center">
                  <NotificationBell />
                  <button className="flex items-center space-x-2" aria-label={t("nav.profile")}>
                    <Link href={"/profile"}>
                      {user.photo ? (
                        <img
                          src={user.photo}
                          alt={t("nav.profile")}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <span className="flex w-8 h-8 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">
                          {(user.name || "?").trim().charAt(0).toUpperCase()}
                        </span>
                      )}
                    </Link>
                  </button>
                  <button
                    className="flex items-center w-full px-4 py-2  text-gray-700  hover:bg-gray-200 rounded-lg"
                    onClick={handlelogout}
                  >
                    {t("nav.logout")}
                  </button>
                </div>
              ) : (
                <>
                  <Link href="/login" className="whitespace-nowrap rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">
                    {t("account.nav.login")}
                  </Link>
                  <Link href="/signup" className="whitespace-nowrap rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
                    {t("account.nav.signup")}
                  </Link>
                  <a
                    href="/adminlogin"
                    className="text-gray-600 hover:text-gray-800"
                  >
                    {t("nav.admin")}
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
};

export default Navbar;
