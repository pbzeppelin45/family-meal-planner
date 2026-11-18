"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export type FamilyPlanSnapshot = {
  step: number;
  choices: number[];
  included: boolean[];
  have: Record<string, boolean>;
  recipients: string;
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const client: SupabaseClient | null =
  url && anon ? createClient(url, anon) : null;

type Household = { id: string; name: string };

export default function FamilyCloudSync({
  snapshot,
  onLoad,
}: {
  snapshot: FamilyPlanSnapshot;
  onLoad: (next: FamilyPlanSnapshot) => void;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [activeId, setActiveId] = useState("");
  const [email, setEmail] = useState("");
  const [householdName, setHouseholdName] = useState("Our family");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const active = useMemo(
    () => households.find((h) => h.id === activeId),
    [households, activeId]
  );

  async function refreshHouseholds(s: SupabaseClient) {
    const { data, error } = await s
      .from("family_households")
      .select("id,name")
      .order("created_at", { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as Household[];
    setHouseholds(list);
    setActiveId((prev) =>
      list.some((h) => h.id === prev) ? prev : (list[0]?.id ?? "")
    );
  }

  useEffect(() => {
    if (!client) return;
    const s = client;
    s.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data } = s.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!client) return;
    if (!user) {
      setHouseholds([]);
      setActiveId("");
      return;
    }
    refreshHouseholds(client).catch((err: Error) => setStatus(err.message));
  }, [user?.id]);

  async function attempt(action: () => Promise<void>) {
    setStatus("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  }

  if (!client) {
    return (
      <section className="panel cloud-panel">
        <h2>Family cloud sync</h2>
        <p>Coming soon: shared menus across devices. This deployment still saves locally.</p>
        <small>Connect a Supabase project to enable family accounts and shared saving.</small>
      </section>
    );
  }

  return (
    <section className="panel cloud-panel">
      <h2>Family cloud sync</h2>
      {!user ? (
        <>
          <p>Sign in with an email link to save a shared family plan. You can keep planning locally without signing in.</p>
          <form
            className="cloud-inline"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                const { error } = await client.auth.signInWithOtp({
                  email: email.trim(),
                  options: { emailRedirectTo: window.location.origin },
                });
                if (error) throw error;
                setStatus("Sign-in link requested. Check your email.");
              });
            }}
          >
            <input type="email" value={email} placeholder="Your email address" required
              onChange={(e) => setEmail(e.target.value)} />
            <button type="submit" disabled={busy}>Send sign-in link</button>
          </form>
        </>
      ) : (
        <>
          <div className="cloud-inline cloud-between">
            <span>Signed in as <strong>{user.email}</strong></span>
            <button className="secondary" disabled={busy} onClick={() => void attempt(async () => {
              const { error } = await client.auth.signOut();
              if (error) throw error;
              setStatus("Signed out.");
            })}>Sign out</button>
          </div>
          {households.length > 0 ? (
            <>
              <label className="label" htmlFor="family-household">Shared family</label>
              <select id="family-household" className="wide" value={activeId}
                onChange={(e) => setActiveId(e.target.value)}>
                {households.map((h) => <option value={h.id} key={h.id}>{h.name}</option>)}
              </select>
              <div className="cloud-inline">
                <button disabled={!activeId || busy} onClick={() => void attempt(async () => {
                  const { error } = await client.from("family_plans").upsert({
                    household_id: activeId,
                    state: snapshot,
                    updated_by: user.id,
                    updated_at: new Date().toISOString(),
                  }, { onConflict: "household_id" });
                  if (error) throw error;
                  setStatus("Saved the current plan to the family database.");
                })}>Save current plan</button>
                <button className="secondary" disabled={!activeId || busy}
                  onClick={() => void attempt(async () => {
                    const { data, error } = await client
                      .from("family_plans")
                      .select("state")
                      .eq("household_id", activeId)
                      .single();
                    if (error) throw error;
                    const saved = data?.state as FamilyPlanSnapshot | undefined;
                    if (!saved || !Array.isArray(saved.choices) || saved.choices.length !== 5)
                      throw new Error("No saved menu yet. Save your current plan first.");
                    if (!window.confirm("Replace this browser's current menu with the shared saved version?")) return;
                    onLoad(saved);
                    setStatus("Loaded the shared family plan.");
                  })}>Load shared plan</button>
              </div>
              <p className="cloud-warning">This first version uses manual Save and Load. Saving replaces the previously saved family plan; check with other family members before overwriting changes.</p>
              <details>
                <summary>Invite a family member to {active?.name}</summary>
                <p>Create an invitation for the exact email address they will use to sign in.</p>
                <div className="cloud-inline">
                  <input type="email" placeholder="Family member's email" value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}/>
                  <button disabled={busy} onClick={() => void attempt(async () => {
                    const { data, error } = await client.rpc("invite_family_member", {
                      p_household: activeId, p_email: inviteEmail.trim(),
                    });
                    if (error) throw error;
                    setInviteCode(String(data));
                    setStatus("Invite created. Share this private code only with its intended recipient.");
                  })}>Create invitation</button>
                </div>
                {inviteCode && <p>Invitation code (expires in 7 days): <code>{inviteCode}</code></p>}
              </details>
            </>
          ) : (
            <p>No family workspace yet. Create one or redeem an invitation from your spouse.</p>
          )}
          <details>
            <summary>Create another family workspace</summary>
            <div className="cloud-inline">
              <input value={householdName} onChange={(e) => setHouseholdName(e.target.value)}
                placeholder="Family name" />
              <button disabled={busy} onClick={() => void attempt(async () => {
                const { error } = await client.rpc("create_family_household", {
                  p_name: householdName.trim(),
                });
                if (error) throw error;
                await refreshHouseholds(client);
                setStatus("Family workspace created.");
              })}>Create family</button>
            </div>
          </details>
          <details>
            <summary>Join a family using an invitation</summary>
            <div className="cloud-inline">
              <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Invitation code" />
              <button disabled={busy} onClick={() => void attempt(async () => {
                const { error } = await client.rpc("accept_family_invite", {
                  p_code: joinCode.trim(),
                });
                if (error) throw error;
                await refreshHouseholds(client);
                setJoinCode("");
                setStatus("Joined family workspace.");
              })}>Join family</button>
            </div>
          </details>
        </>
      )}
      {status && <p role="status" className="notice">{status}</p>}
    </section>
  );
}
