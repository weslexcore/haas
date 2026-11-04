import { useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN_PROFILES, findProfile, isBuiltInId, profileFileSchema, profileGroup, type PartialLook, type Profile } from "../../core/develop/profiles";
import type { EditRecipe } from "../../core/develop/recipe";
import { monotoneCurve } from "../../core/develop/tone-curve";
import type { PhotoRecord } from "../../core/state/types";
import { useAppState, useDispatch, useShortcut } from "../hooks";
import { useRuntime } from "../runtime-context";
import { ActionButton } from "../shell/ActionButton";
import { Kbd } from "../shell/Kbd";
import { toast } from "../toasts";
import { useThumbnail } from "../views/Thumb";
import { CurveEditor, Section, Slider } from "./controls";
import { editedThumbnailUrl } from "./edited-thumbs";
import styles from "./DevelopPanel.module.css";

const HUE_TRACK = "linear-gradient(90deg, #e5484d, #f5c542, #46a758, #3fc1c9, #3e7bfa, #d6409f, #e5484d)";
const CHANNELS = ["red", "green", "blue"] as const;

/** The photo with `recipe`, as a small image (the edited-thumbnail renderer and cache). */
function usePreview(photo: PhotoRecord, recipe: EditRecipe): string | null {
  const { services } = useRuntime();
  const { url: base } = useThumbnail(photo);
  const [url, setUrl] = useState<string | null>(null);
  const key = JSON.stringify(recipe);
  const needsBase = photo.placeholderHue === undefined;
  useEffect(() => {
    if (needsBase && !base) return;
    let live = true;
    const timer = setTimeout(() => {
      void editedThumbnailUrl(services.previews, photo, recipe, base).then((u) => live && setUrl(u));
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // Keyed on the recipe's content, not the object.
  }, [key, base, photo.id, needsBase, services]);
  return url;
}

function ProfileTile({ photo, recipe, label, selected, onSelect }: { photo: PhotoRecord; recipe: EditRecipe; label: string; selected: boolean; onSelect: () => void }) {
  const url = usePreview(photo, recipe);
  return (
    <button type="button" className={styles.profileTile} aria-pressed={selected} title={label} onClick={onSelect}>
      <span className={styles.tileImage}>{url && <img src={url} alt="" draggable={false} />}</span>
      <span className={styles.tileName}>{label}</span>
    </button>
  );
}

/** Reads a profiles file chosen by the user and imports it. */
async function readProfileFiles(files: FileList, dispatch: ReturnType<typeof useDispatch>): Promise<void> {
  for (const file of Array.from(files)) {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      toast(`${file.name} isn't a profiles file (not valid JSON).`, "error");
      continue;
    }
    const parsed = profileFileSchema.safeParse(json);
    if (!parsed.success) {
      toast(`${file.name} isn't a profiles file this app can read.`, "error");
      continue;
    }
    const r = await dispatch("develop.profiles.import", { file: parsed.data });
    if (!r.ok) {
      toast(r.message, "error");
      continue;
    }
    const { added, replaced, skipped } = r.value as { added: string[]; replaced: string[]; skipped: string[] };
    const parts = [added.length && `${added.length} added`, replaced.length && `${replaced.length} replaced`, skipped.length && `${skipped.length} already there`].filter(Boolean);
    toast(`Imported ${file.name}: ${parts.join(", ")}.`);
  }
}

/** Profile browser, amount, Auto, and managing the user's own profiles. */
export function ProfileSection({ photo, recipe }: { photo: PhotoRecord; recipe: EditRecipe }) {
  const dispatch = useDispatch();
  const userProfiles = useAppState((s) => s.develop.profiles);
  const selectionCount = useAppState((s) => s.selection.ids.length);
  const autoShortcut = useShortcut("develop.auto");
  const [browsing, setBrowsing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const current = recipe.profile;
  const currentProfile = current ? findProfile(current.id, userProfiles) : undefined;
  const editing = editingId ? userProfiles.find((p) => p.id === editingId) : undefined;
  // The edited profile was deleted (or undone away): close the editor.
  if (editingId && !editing) setEditingId(null);

  const groups = useMemo(
    () => [
      { title: "Color", profiles: BUILTIN_PROFILES.filter((p) => profileGroup(p) === "color") },
      { title: "Black & White", profiles: BUILTIN_PROFILES.filter((p) => profileGroup(p) === "bw") },
      { title: "Yours", profiles: userProfiles },
    ],
    [userProfiles],
  );
  const withProfile = (p: Profile | null): EditRecipe => {
    const { profile: _, ...rest } = recipe;
    return p ? { ...rest, profile: { id: p.id, name: p.name, amount: 100, look: p.look } } : rest;
  };

  const create = async (from?: string) => {
    const name = from ? `${findProfile(from, userProfiles)?.name ?? "Profile"} copy` : current ? `${current.name} copy` : "New Profile";
    const r = await dispatch("develop.profiles.create", { name, ...(from ? { from } : {}) });
    if (!r.ok) return toast(r.message, "error");
    const { id } = r.value as { id: string };
    // Preview it on this photo while editing.
    await dispatch("develop.profile.set", { profileId: id, photoIds: [photo.id] });
    setEditingId(id);
  };

  const edit = async (id: string) => {
    if (current?.id !== id) await dispatch("develop.profile.set", { profileId: id, photoIds: [photo.id] });
    setEditingId(id);
  };

  const remove = async (p: Profile) => {
    const r = await dispatch("develop.profiles.delete", { id: p.id });
    if (r.ok) toast(`Deleted “${p.name}”. Photos using it keep their look. ⌘Z to undo.`);
    else toast(r.message, "error");
  };

  const ownSelected = current && !isBuiltInId(current.id) && currentProfile ? currentProfile : undefined;

  return (
    <Section
      title="Profile"
      action={
        <button type="button" className={styles.reset} aria-expanded={browsing} onClick={() => setBrowsing(!browsing)}>
          {browsing ? "Close" : "Browse"}
        </button>
      }
    >
      <div className={styles.profileCurrent}>
        <span>{current ? current.name : "None"}</span>
        {current && !currentProfile && <span className={styles.hint}> (not in your profiles)</span>}
      </div>
      {current && (
        <Slider
          label="Amount"
          value={current.amount}
          min={0}
          max={200}
          step={1}
          resetValue={100}
          format={(v) => `${Math.round(v)}`}
          onChange={(amount) => void dispatch("develop.profile.set", { amount })}
        />
      )}

      <div className={styles.toolbar}>
        <ActionButton actionId="develop.auto" className={styles.tool}>
          Auto {autoShortcut && <Kbd strokes={autoShortcut.strokes} />}
        </ActionButton>
        <ActionButton actionId="develop.auto" params={{ include: ["wb"] }} className={styles.tool}>
          Auto WB
        </ActionButton>
      </div>
      {selectionCount > 1 && <p className={styles.hint}>Profile, amount and Auto apply to all {selectionCount} selected photos.</p>}

      {browsing && (
        <>
          <div className={styles.profileTiles} role="group" aria-label="Profiles">
            <ProfileTile photo={photo} recipe={withProfile(null)} label="None" selected={!current} onSelect={() => void dispatch("develop.profile.set", { profileId: "none" })} />
          </div>
          {groups.map(
            (g) =>
              (g.profiles.length > 0 || g.title === "Yours") && (
                <div key={g.title}>
                  <div className={styles.groupLabel}>{g.title}</div>
                  {g.profiles.length === 0 && <p className={styles.hint}>Create or import profiles to see them here.</p>}
                  <div className={styles.profileTiles} role="group" aria-label={`${g.title} profiles`}>
                    {g.profiles.map((p) => (
                      <ProfileTile
                        key={p.id}
                        photo={photo}
                        recipe={withProfile(p)}
                        label={p.name}
                        selected={current?.id === p.id}
                        onSelect={() => void dispatch("develop.profile.set", { profileId: p.id })}
                      />
                    ))}
                  </div>
                </div>
              ),
          )}
          <div className={styles.aspects}>
            <button type="button" className={styles.aspect} onClick={() => void create()}>
              New
            </button>
            {current && currentProfile && (
              <button type="button" className={styles.aspect} onClick={() => void create(current.id)}>
                Duplicate
              </button>
            )}
            {ownSelected && (
              <>
                <button type="button" className={styles.aspect} onClick={() => void edit(ownSelected.id)}>
                  Edit
                </button>
                <button type="button" className={styles.aspect} onClick={() => void dispatch("develop.profiles.export", { ids: [ownSelected.id] })}>
                  Export
                </button>
                <button type="button" className={styles.aspect} onClick={() => void remove(ownSelected)}>
                  Delete
                </button>
              </>
            )}
            <button type="button" className={styles.aspect} onClick={() => fileInput.current?.click()}>
              Import…
            </button>
            <ActionButton actionId="develop.profiles.export" className={styles.aspect}>
              Export all
            </ActionButton>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void readProfileFiles(e.target.files, dispatch);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}

      {editing && <ProfileEditor profile={editing} onDone={() => setEditingId(null)} onDelete={() => void remove(editing)} />}
    </Section>
  );
}

/** Edits one of the user's profiles; photos here that use it (including the one shown) update live. */
function ProfileEditor({ profile, onDone, onDelete }: { profile: Profile; onDone: () => void; onDelete: () => void }) {
  const dispatch = useDispatch();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("red");
  const [name, setName] = useState(profile.name);
  // Follow renames from elsewhere (undo, the AI).
  useEffect(() => setName(profile.name), [profile.name]);
  const look = profile.look;
  const update = (patch: PartialLook) => void dispatch("develop.profiles.update", { id: profile.id, look: patch });
  const curve = useMemo(() => monotoneCurve(look.curves[channel]), [look.curves, channel]);
  const mono = look.monochrome;
  const st = look.splitToning;
  const sid = (k: string) => `profile-${k}`;
  const hue = (v: number) => `${Math.round(v)}°`;

  const rename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== profile.name) void dispatch("develop.profiles.update", { id: profile.id, name: trimmed });
    else setName(profile.name);
  };

  return (
    <div className={styles.profileEditor} aria-label={`Edit profile ${profile.name}`} role="group">
      <label className={styles.groupLabel} htmlFor={sid("name")}>
        Name
      </label>
      <input
        id={sid("name")}
        className={styles.textInput}
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onBlur={rename}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />

      <div className={styles.groupLabel}>Color</div>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={!!mono} onChange={(e) => update({ monochrome: e.target.checked ? { red: 30, green: 59, blue: 11 } : null })} />
        Black &amp; white
      </label>
      {mono ? (
        (["red", "green", "blue"] as const).map((c) => (
          <Slider
            key={c}
            id={sid(`mono-${c}`)}
            label={`${c[0]!.toUpperCase()}${c.slice(1)} mix`}
            value={mono[c]}
            min={-200}
            max={200}
            step={1}
            resetValue={{ red: 30, green: 59, blue: 11 }[c]}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => update({ monochrome: { ...mono, [c]: v } })}
          />
        ))
      ) : (
        <Slider id={sid("saturation")} label="Saturation" value={look.saturation} min={-100} max={100} step={1} onChange={(saturation) => update({ saturation })} />
      )}
      <Slider id={sid("fade")} label="Fade" value={look.fade} min={0} max={100} step={1} onChange={(fade) => update({ fade })} />

      <div className={styles.groupLabel}>Split Toning</div>
      <Slider id={sid("sh-hue")} label="Shadow hue" value={st.shadowHue} min={0} max={360} step={1} track={HUE_TRACK} format={hue} onChange={(shadowHue) => update({ splitToning: { shadowHue } })} />
      <Slider id={sid("sh-sat")} label="Shadow amount" value={st.shadowSaturation} min={0} max={100} step={1} onChange={(shadowSaturation) => update({ splitToning: { shadowSaturation } })} />
      <Slider id={sid("hl-hue")} label="Highlight hue" value={st.highlightHue} min={0} max={360} step={1} track={HUE_TRACK} format={hue} onChange={(highlightHue) => update({ splitToning: { highlightHue } })} />
      <Slider id={sid("hl-sat")} label="Highlight amount" value={st.highlightSaturation} min={0} max={100} step={1} onChange={(highlightSaturation) => update({ splitToning: { highlightSaturation } })} />
      <Slider id={sid("balance")} label="Balance" value={st.balance} min={-100} max={100} step={1} onChange={(balance) => update({ splitToning: { balance } })} />

      <div className={styles.groupLabel}>Channel Curves</div>
      <div className={styles.tabs} role="tablist" aria-label="Curve channel">
        {CHANNELS.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={channel === c} className={styles.tab} onClick={() => setChannel(c)}>
            {c[0]!.toUpperCase() + c.slice(1)}
          </button>
        ))}
      </div>
      <CurveEditor points={look.curves[channel]} curve={curve} onChange={(points) => update({ curves: { [channel]: points } })} />

      <div className={styles.groupLabel}>Grain</div>
      <Slider id={sid("grain")} label="Amount" value={look.grain.amount} min={0} max={100} step={1} onChange={(amount) => update({ grain: { amount } })} />
      <Slider id={sid("grain-size")} label="Size" value={look.grain.size} min={0} max={100} step={1} resetValue={25} onChange={(size) => update({ grain: { size } })} />

      <div className={styles.aspects}>
        <button type="button" className={`${styles.aspect} ${styles.primaryLink}`} onClick={onDone}>
          Done
        </button>
        <button type="button" className={styles.aspect} onClick={() => void dispatch("develop.profiles.export", { ids: [profile.id] })}>
          Export
        </button>
        <button type="button" className={styles.aspect} onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className={styles.hint}>Changes apply to every photo in this folder that uses “{profile.name}”.</p>
    </div>
  );
}
