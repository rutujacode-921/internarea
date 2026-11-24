import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api";
import SpaceLayout, { useSpace } from "@/space/SpaceLayout";
import { PostList } from "@/space/PostLists";
import Avatar from "@/space/Avatar";
import { RelationshipButtons } from "@/space/RelationshipButtons";
import { Modal } from "@/space/Dialogs";
import { errorText, Profile, Relationship } from "@/space/types";
import { useLanguage } from "@/i18n/LanguageProvider";

function ProfileView({ username }: { username: string }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const { refreshMe, setAllowance } = useSpace();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [relationship, setRelationship] = useState<Relationship | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api
      .get(`/api/space/users/${encodeURIComponent(username)}`)
      .then(({ data }) => {
        setProfile(data.profile);
        setRelationship(data.relationship);
      })
      .catch((e) => setError(errorText(e, t)));
  }, [username, t]);

  if (error) return <p className="rounded-xl bg-white p-8 text-center text-gray-700 shadow-sm">{error}</p>;
  if (!profile || !relationship) return <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />;

  const stat = (value: number | undefined, label: string) => (
    <div>
      <div className="font-semibold text-gray-900">{new Intl.NumberFormat(locale).format(value || 0)}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );

  return (
    <>
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar name={profile.name} photo={profile.photo} size={80} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-gray-900">{profile.name}</h1>
            <p className="text-sm text-gray-500">@{profile.username}</p>
            {profile.bio && <p className="mt-2 whitespace-pre-wrap text-gray-700">{profile.bio}</p>}
            <div className="mt-3 flex gap-6 text-center">
              {stat(profile.postCount, t("space.profile.posts"))}
              {stat(profile.friendCount, t("space.profile.friends"))}
              {stat(profile.followerCount, t("space.profile.followers"))}
              {stat(profile.followingCount, t("space.profile.following"))}
            </div>
            <div className="mt-4">
              {relationship.self ? (
                <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                  <Pencil className="h-4 w-4" />
                  {t("space.profile.edit")}
                </button>
              ) : (
                <RelationshipButtons
                  uid={profile.uid}
                  relationship={relationship}
                  onChange={(r, allowance) => {
                    setRelationship(r);
                    if (allowance) setAllowance(allowance);
                  }}
                />
              )}
              {relationship.followedBy && !relationship.self && <p className="mt-2 text-xs text-gray-500">{t("space.follow.followsYou")}</p>}
            </div>
          </div>
        </div>
      </section>
      <PostList url={`/api/space/users/${encodeURIComponent(profile.username)}/posts`} empty={t("space.profile.noPosts")} />
      {editing && (
        <EditProfile
          profile={profile}
          onClose={() => setEditing(false)}
          onSaved={(p) => {
            setProfile({ ...profile, ...p });
            refreshMe();
            if (p.username !== username) router.replace(`/space/u/${p.username}`);
          }}
        />
      )}
    </>
  );
}

function EditProfile({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: (p: Profile) => void }) {
  const { t } = useLanguage();
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio || "");
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.put("/api/space/me", { username, bio });
      toast.success(t("space.profile.saved"));
      onSaved(data.profile);
      onClose();
    } catch (err) {
      toast.error(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={t("space.profile.edit")} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <label className="block text-sm text-gray-700">
          {t("space.profile.username")}
          <div className="mt-1 flex items-center rounded-lg border border-gray-300 focus-within:ring-2 focus-within:ring-blue-500">
            <span className="pl-3 text-gray-400">@</span>
            <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} maxLength={20} className="w-full rounded-lg px-1 py-2 text-gray-900 focus:outline-none" />
          </div>
          <span className="mt-1 block text-xs text-gray-500">{t("space.profile.usernameHint")}</span>
        </label>
        <label className="block text-sm text-gray-700">
          {t("space.profile.bio")}
          <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
          <span className="block text-right text-xs text-gray-400">{bio.length}/160</span>
        </label>
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("space.profile.save")}
        </button>
      </form>
    </Modal>
  );
}

export default function UserPage() {
  const router = useRouter();
  const username = typeof router.query.username === "string" ? router.query.username.toLowerCase() : null;
  return <SpaceLayout>{username && <ProfileView username={username} />}</SpaceLayout>;
}
