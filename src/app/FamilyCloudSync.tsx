"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { type Recipe } from "../lib/recipes";
import FamilyRecipeLibrary from "./FamilyRecipeLibrary";

export type FamilyPlanSnapshot = {
  step: number;
  choices: number[];
  included: boolean[];
  have: Record<string, boolean>;
  recipients: string;
  customRecipes?: Record<string, Recipe>;
};
type Household = { id: string; name: string };
type PlanRow = { state: unknown; revision: number };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const client: SupabaseClient | null = url && key ? createClient(url, key) : null;

function validPlan(x: unknown): x is FamilyPlanSnapshot {
  if (!x || typeof x !== "object") return false;
  const p = x as Partial<FamilyPlanSnapshot>;
  return Array.isArray(p.choices) && p.choices.length === 5 &&
    Array.isArray(p.included) && p.included.length === 5 &&
    !!p.have && typeof p.have === "object" &&
    typeof p.recipients === "string" && typeof p.step === "number";
}
function message(e: unknown): string {
  return e instanceof Error ? e.message : "An unexpected error occurred.";
}

export default function FamilyCloudSync({
  snapshot, onLoad, selected, onUseRecipe
}: {
  snapshot: FamilyPlanSnapshot;
  onLoad: (next: FamilyPlanSnapshot) => void;
  selected: Recipe[];
  onUseRecipe: (recipe: Recipe, slot: number) => void;
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
  const [syncReady, setSyncReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Waiting for family");
  const [conflict, setConflict] = useState(false);
  const [recipeRefresh, setRecipeRefresh] = useState(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const acknowledged = useRef("");
  const expectedRevision = useRef(0);
  const saving = useRef(false);
  const blocked = useRef(false);
  const hydrationTarget = useRef<string | null>(null);
  const generation = useRef(0);
  const active = useMemo(() => households.find(h => h.id === activeId), [households, activeId]);

  const refreshHouseholds = useCallback(async (s: SupabaseClient, preferred?: string) => {
    const { data, error } = await s.from("family_households")
      .select("id,name").order("created_at", { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as Household[];
    setHouseholds(list);
    setActiveId(prev => {
      if (preferred && list.some(x => x.id === preferred)) return preferred;
      return list.some(x => x.id === prev) ? prev : list[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    if (!client) return;
    const s = client;
    void s.auth.getUser().then(({ data }) => setUser(data.user ?? null));
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
    void refreshHouseholds(client).catch(err => setStatus(message(err)));
  }, [user?.id, refreshHouseholds]);

  const fetchPlan = useCallback(async (householdId: string): Promise<PlanRow> => {
    if (!client) throw new Error("Cloud unavailable.");
    const { data, error } = await client.from("family_plans")
      .select("state,revision").eq("household_id", householdId).single();
    if (error) throw error;
    return data as PlanRow;
  }, []);

  const applyRemote = useCallback((row: PlanRow) => {
    expectedRevision.current = row.revision;
    if (validPlan(row.state)) {
      const text = JSON.stringify(row.state);
      acknowledged.current = text;
      hydrationTarget.current = text;
      onLoadRef.current(row.state);
      setSyncStatus("Shared plan loaded");
    } else {
      acknowledged.current = "";
      hydrationTarget.current = null;
      setSyncStatus("Ready to save this browser's plan");
    }
    blocked.current = false;
    setConflict(false);
    setSyncReady(true);
  }, []);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    blocked.current = false;
    saving.current = false;
    setSyncReady(false);
    setConflict(false);
    setSyncStatus(activeId ? "Loading shared plan…" : "Waiting for family");
    if (!user || !activeId) return;
    void fetchPlan(activeId).then(row => {
      if (generation.current !== currentGeneration) return;
      applyRemote(row);
    }).catch(err => {
      if (generation.current !== currentGeneration) return;
      setSyncStatus("Unable to load shared plan");
      setStatus(message(err));
    });
    return () => { ++generation.current; };
  }, [user?.id, activeId, fetchPlan, applyRemote]);

  const checkRemote = useCallback(async (householdId: string) => {
    if (generation.current < 0 || !client || !syncReady || saving.current) return;
    try {
      const row = await fetchPlan(householdId);
      if (row.revision <= expectedRevision.current) return;
      if (acknowledged.current !== JSON.stringify(snapshotRef.current)) {
        blocked.current = true;
        setConflict(true);
        setSyncStatus("Conflicting edits — action required");
      } else {
        applyRemote(row);
        setSyncStatus("Updated from another device");
      }
    } catch (err) {
      setSyncStatus("Offline — local changes retained");
      setStatus(message(err));
    }
  }, [fetchPlan, applyRemote, syncReady]);

  useEffect(() => {
    if (!client || !user || !activeId || !syncReady) return;
    const s = client;
    const channel = s.channel("family-plan-" + activeId)
      .on("postgres_changes", { event: "UPDATE", schema: "public",
        table: "family_plans", filter: "household_id=eq." + activeId },
        () => { void checkRemote(activeId); })
      .subscribe();
    const interval = setInterval(() => void checkRemote(activeId), 12000);
    return () => { clearInterval(interval); void s.removeChannel(channel); };
  }, [user?.id, activeId, syncReady, checkRemote]);

  useEffect(() => {
    if (!client || !user || !activeId || !syncReady || blocked.current) return;
    const serialized = JSON.stringify(snapshot);
    if (hydrationTarget.current !== null) {
      if (serialized !== hydrationTarget.current) return;
      hydrationTarget.current = null;
    }
    if (serialized === acknowledged.current) return;
    const householdId = activeId;
    const userId = user.id;
    const run = async () => {
      if (!client || saving.current || blocked.current) return;
      saving.current = true;
      setSyncStatus("Saving…");
      try {
        while (!blocked.current && generation.current >= 0) {
          const latest = JSON.stringify(snapshotRef.current);
          if (latest === acknowledged.current) break;
          const { data, error } = await client.rpc("save_family_plan", {
            p_household: householdId,
            p_state: JSON.parse(latest),
            p_expected_revision: expectedRevision.current,
          });
          if (error) {
            if (error.code === "40001" || error.message.includes("VERSION_CONFLICT")) {
              blocked.current = true;
              setConflict(true);
              setSyncStatus("Conflicting edits — action required");
            } else {
              setSyncStatus("Not saved — will retry on next edit");
              setStatus(error.message);
            }
            break;
          }
          expectedRevision.current = Number(data);
          acknowledged.current = latest;
          setSyncStatus("All changes saved");
        }
      } catch (err) {
        setSyncStatus("Not saved — local copy retained");
        setStatus(message(err));
      } finally {
        saving.current = false;
      }
    };
    const timer = setTimeout(() => void run(), 950);
    return () => clearTimeout(timer);
  }, [snapshot, user?.id, activeId, syncReady]);

  const act = async (task: () => Promise<void>) => {
    setBusy(true);
    setStatus("");
    try { await task(); }
    catch (err) { setStatus(message(err)); }
    finally { setBusy(false); }
  };

  const useSharedVersion = () => void act(async () => {
    if (!activeId) return;
    applyRemote(await fetchPlan(activeId));
    setStatus("Loaded the latest shared version. Your unsaved local edits were discarded.");
  });

  const keepMyVersion = () => void act(async () => {
    if (!client || !activeId || !user) return;
    if (!window.confirm("Overwrite the family's newer plan with your changes?")) return;
    const remote = await fetchPlan(activeId);
    const snapshotToSave = snapshotRef.current;
    const { data, error } = await client.rpc("save_family_plan", {
      p_household: activeId, p_state: snapshotToSave,
      p_expected_revision: remote.revision,
    });
    if (error) throw error;
    expectedRevision.current = Number(data);
    acknowledged.current = JSON.stringify(snapshotToSave);
    hydrationTarget.current = null;
    blocked.current = false;
    setConflict(false);
    setSyncStatus("Your version saved");
  });

  if (!client) {
    return <section className="panel cloud-panel">
      <h2>Family cloud sync</h2>
      <p>Local meal planning is available; Supabase needs to be configured for shared access.</p>
    </section>;
  }
  return <section className="panel cloud-panel">
    <div className="cloud-between cloud-inline"><h2>Family cloud sync</h2>
      {user && activeId && <strong className={conflict ? "sync-conflict" : "sync-good"} role="status">
        {syncStatus}
      </strong>}
    </div>
    {!user ? <>
      <p>Sign in with an email link. Changes will then save automatically to your family's shared plan.</p>
      <form className="cloud-inline" onSubmit={e => {
        e.preventDefault();
        void act(async () => {
          const { error } = await client.auth.signInWithOtp({
            email: email.trim(),
            options: { emailRedirectTo: window.location.origin }
          });
          if (error) throw error;
          setStatus("Sign-in link requested. Check your email.");
        });
      }}>
        <input type="email" required placeholder="Your email address" value={email}
          onChange={e => setEmail(e.target.value)} />
        <button type="submit" disabled={busy}>Send sign-in link</button>
      </form>
    </> : <>
      <div className="cloud-inline cloud-between">
        <span>Signed in as <strong>{user.email}</strong></span>
        <button className="secondary" disabled={busy}
          onClick={() => void act(async () => {
            const { error } = await client.auth.signOut();
            if (error) throw error;
          })}>Sign out</button>
      </div>
      {households.length > 0 ? <>
        <label className="label" htmlFor="family-household">Shared family</label>
        <select className="wide" id="family-household" value={activeId}
          onChange={e => setActiveId(e.target.value)}>
          {households.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
        <p className="cloud-small">Changes save automatically after a short pause. Other devices update when online. If simultaneous edits conflict, choose which version to keep.</p>
        {conflict && <div className="cloud-warning" role="alert">
          <strong>Another device updated the menu while you were editing.</strong>
          <p>Your local edits are still on this screen. Choose how to resolve the conflict.</p>
          <div className="cloud-inline">
            <button className="secondary" onClick={useSharedVersion} disabled={busy}>Load their version</button>
            <button onClick={keepMyVersion} disabled={busy}>Keep my version</button>
          </div>
        </div>}
        <button className="secondary" disabled={busy || !syncReady}
          onClick={() => void act(async () => {
            if (acknowledged.current !== JSON.stringify(snapshotRef.current) &&
                !window.confirm("Discard your local unsaved edits and load the shared plan?")) return;
            applyRemote(await fetchPlan(activeId));
            setStatus("Shared plan refreshed.");
          })}>Refresh shared plan</button>
        <details>
          <summary>Invite a family member to {active?.name}</summary>
          <p>Invite the exact email address they will use to sign in.</p>
          <div className="cloud-inline">
            <input type="email" placeholder="Family member's email" value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)} />
            <button disabled={busy} onClick={() => void act(async () => {
              const { data, error } = await client.rpc("invite_family_member", {
                p_household: activeId, p_email: inviteEmail.trim()
              });
              if (error) throw error;
              setInviteCode(String(data));
              setStatus("Invitation created. Share its private code only with the recipient.");
            })}>Create invitation</button>
          </div>
          {inviteCode && <p>Invitation code (expires in 7 days): <code>{inviteCode}</code></p>}
        </details>
        <FamilyRecipeLibrary client={client} householdId={activeId}
          selectedRecipes={selected} refreshKey={recipeRefresh}
          onUse={onUseRecipe} onChanged={() => setRecipeRefresh(x => x + 1)}/>
      </> : <p>Create a family workspace or redeem an invitation to begin syncing.</p>}
      <details>
        <summary>Create another family workspace</summary>
        <div className="cloud-inline">
          <input value={householdName} onChange={e => setHouseholdName(e.target.value)}
            placeholder="Family name"/>
          <button disabled={busy} onClick={() => void act(async () => {
            const { data, error } = await client.rpc("create_family_household", { p_name: householdName.trim() });
            if (error) throw error;
            await refreshHouseholds(client, String(data));
            setStatus("Family workspace created.");
          })}>Create family</button>
        </div>
      </details>
      <details>
        <summary>Join a family using an invitation</summary>
        <div className="cloud-inline">
          <input placeholder="Invitation code" value={joinCode} onChange={e => setJoinCode(e.target.value)}/>
          <button disabled={busy} onClick={() => void act(async () => {
            const { data, error } = await client.rpc("accept_family_invite", { p_code: joinCode.trim() });
            if (error) throw error;
            await refreshHouseholds(client, String(data));
            setJoinCode("");
            setStatus("Joined the family workspace.");
          })}>Join family</button>
        </div>
      </details>
    </>}
    {status && <p className="notice" role="status">{status}</p>}
  </section>;
}
