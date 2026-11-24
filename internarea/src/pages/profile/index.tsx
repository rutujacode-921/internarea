import { selectuser } from "@/Feature/Userslice";
import { ExternalLink, Globe, KeyRound, Mail, Phone, User } from "lucide-react";
import Link from "next/link";
import React from "react";
import { useSelector } from "react-redux";
import { useLanguage } from "@/i18n/LanguageProvider";
import LanguageSwitcher from "@/Components/LanguageSwitcher";
import LanguageHistory from "@/Components/LanguageHistory";
import ResumeProfileCard from "@/Components/ResumeProfileCard";
import PasswordResetHistory from "@/Components/PasswordResetHistory";
import ActiveSessions from "@/Components/security/ActiveSessions";
import LoginHistory from "@/Components/security/LoginHistory";

const index = () => {
  const user = useSelector(selectuser);
  const { t } = useLanguage();

  if (!user) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-600">{t("profile.signInPrompt")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Profile Header */}
          <div className="relative h-32 bg-gradient-to-r from-blue-500 to-blue-600">
            <div className="absolute -bottom-12 left-1/2 transform -translate-x-1/2">
              {user?.photo ? (
                <img
                  src={user?.photo}
                  alt={user?.name}
                  className="w-24 h-24 rounded-full border-4 border-white shadow-lg"
                />
              ) : (
                <div className="w-24 h-24 rounded-full border-4 border-white shadow-lg bg-gray-200 flex items-center justify-center">
                  <User className="h-12 w-12 text-gray-400" />
                </div>
              )}
            </div>
          </div>

          {/* Profile Content */}
          <div className="pt-16 pb-8 px-6">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900">{user?.name}</h1>
              {user?.email && (
                <div className="mt-2 flex items-center justify-center text-gray-500">
                  <Mail className="h-4 w-4 mr-2" />
                  <span>{user?.email}</span>
                </div>
              )}
              {user?.phoneNumber && (
                <div className="mt-1 flex items-center justify-center text-gray-500">
                  <Phone className="h-4 w-4 mr-2" />
                  <span>{user?.phoneNumber}</span>
                </div>
              )}
            </div>

            {/* Profile Details */}
            <div className="space-y-6">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <span className="text-blue-600 font-semibold text-2xl">0</span>
                  <p className="text-blue-600 text-sm mt-1">{t("profile.activeApplications")}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <span className="text-green-600 font-semibold text-2xl">0</span>
                  <p className="text-green-600 text-sm mt-1">{t("profile.acceptedApplications")}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-center pt-4">
                <Link
                  href="/userapplication"
                  className="inline-flex items-center px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors duration-200"
                >
                  {t("profile.viewApplications")}
                  <ExternalLink className="ml-2 h-4 w-4" />
                </Link>
              </div>

              <ResumeProfileCard />

              {/* Language preference */}
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                      <Globe className="h-4 w-4 text-blue-600" />
                      {t("profile.languageSection")}
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">{t("profile.languageHelp")}</p>
                  </div>
                  <div className="sm:w-56">
                    <LanguageSwitcher fullWidth />
                  </div>
                </div>
              </div>

              <LanguageHistory />

              {/* Password & security (email/mobile + password accounts) */}
              {user?.provider === "password" && (
                <>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="flex items-center gap-2 font-semibold text-gray-900">
                          <KeyRound className="h-4 w-4 text-blue-600" />
                          {t("account.profile.security")}
                        </h2>
                        <p className="mt-1 text-sm text-gray-500">{t("account.profile.securityHelp")}</p>
                      </div>
                      <Link href="/change-password" className="inline-flex items-center justify-center rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50">
                        {t("account.change.title")}
                      </Link>
                    </div>
                  </div>
                  <PasswordResetHistory />
                </>
              )}

              {/* Login security (every account) */}
              <ActiveSessions />
              <LoginHistory />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default index;
