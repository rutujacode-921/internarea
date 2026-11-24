import Footer from "@/Components/Fotter";
import Navbar from "@/Components/Navbar";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { store } from "../store/store";
import { Provider, useDispatch, useSelector } from "react-redux";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/firebase/firebase";
import { logout, selectuser } from "@/Feature/Userslice";
import { api, PASSWORD_CHANGE_EVENT, SESSION_ENDED_EVENT } from "@/lib/api";
import { applySessionUser, getSessionToken } from "@/lib/session";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { LanguageProvider } from "@/i18n/LanguageProvider";

function AuthListener() {
  const dispatch = useDispatch();
  const router = useRouter();
  const user = useSelector(selectuser) as { mustChangePassword?: boolean } | null;

  useEffect(() => {
    // Every account (password or Google) has a server session: restore it.
    if (getSessionToken()) {
      api
        .get("/api/auth/me")
        .then(({ data }) => applySessionUser(data.user))
        .catch(() => {
          // An ended session is cleared by the API client; when offline, keep it.
        });
    } else {
      dispatch(logout());
    }
    // Firebase is only used for the Google popup. A Firebase sign-in left over
    // from before server sessions (or an unfinished popup) is cleared.
    auth.authStateReady().then(() => {
      if (auth.currentUser && !getSessionToken()) signOut(auth).catch(() => undefined);
    });
  }, [dispatch]);

  // Signed out by the server: from another device, mobile hours over, etc.
  useEffect(() => {
    const ended = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;
      toast.warn(message || "Your session has ended. Please sign in again.", { toastId: "session-ended" });
      if (!["/login", "/signup", "/forgot-password"].includes(router.pathname)) {
        router.push(`/login?next=${encodeURIComponent(router.asPath)}`);
      }
    };
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, [router]);

  // After a password reset, the user must change the password before anything else.
  useEffect(() => {
    const goChange = () => {
      if (router.pathname !== "/change-password") router.replace("/change-password");
    };
    if (user?.mustChangePassword) goChange();
    window.addEventListener(PASSWORD_CHANGE_EVENT, goChange);
    return () => window.removeEventListener(PASSWORD_CHANGE_EVENT, goChange);
  }, [user?.mustChangePassword, router]);

  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Provider store={store}>
      <AuthListener />
      <LanguageProvider>
        <div className="bg-white">
          <ToastContainer />
          <Navbar />
          <Component {...pageProps} />
          <Footer />
        </div>
      </LanguageProvider>
    </Provider>
  );
}
