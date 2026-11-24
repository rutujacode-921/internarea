import Footer from "@/Components/Fotter";
import Navbar from "@/Components/Navbar";
import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { store } from "../store/store";
import { Provider, useDispatch, useSelector } from "react-redux";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { auth } from "@/firebase/firebase";
import { login, logout, selectuser } from "@/Feature/Userslice";
import { api, PASSWORD_CHANGE_EVENT } from "@/lib/api";
import { applyPasswordUser, dropPasswordSession, getSessionToken } from "@/lib/session";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { LanguageProvider } from "@/i18n/LanguageProvider";

function AuthListener() {
  const dispatch = useDispatch();
  const router = useRouter();
  const user = useSelector(selectuser) as { mustChangePassword?: boolean } | null;

  useEffect(() => {
    // Email/mobile + password accounts: restore the session on page load.
    if (getSessionToken()) {
      api
        .get("/api/auth/me")
        .then(({ data }) => applyPasswordUser(data.user))
        .catch(() => {
          // A revoked session is cleared by the API client; when offline, keep it.
        });
    }
    // Google accounts.
    const unsubscribe = auth.onAuthStateChanged((authuser) => {
      if (authuser) {
        dropPasswordSession(); // Signing in with Google replaces a password session.
        dispatch(
          login({
            uid: authuser.uid,
            photo: authuser.photoURL,
            name: authuser.displayName,
            email: authuser.email,
            phoneNumber: authuser.phoneNumber,
            provider: "google",
          })
        );
      } else if (!getSessionToken()) {
        dispatch(logout());
      }
    });
    return unsubscribe;
  }, [dispatch]);

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
