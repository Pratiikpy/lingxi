/**
 * What the proof page shows of a pet (P7: out of VerifyApp): the picture the registry serves for it and whether it is
 * the game's own, what X Layer holds about it (owner, brain, days, log hash, memory and meters, each marked proven or
 * only reported), and the place to replay its log.
 */
import { type ChainPet, lineOfState } from "@lingxi/chain";
import type { unpackState } from "@lingxi/game";
import { Named } from "../play/Named";
import { T, short, viaText } from "./verifyText";

type Lang = "en" | "zh";

export function PetFacts({
  lang,
  pet,
  state,
  meta,
  colour,
  gates,
  unsaved,
  starterOf,
  proven,
}: {
  lang: Lang;
  pet: ChainPet;
  /** the pet's saved state, unpacked */
  state: ReturnType<typeof unpackState>;
  /** the picture and name the registry serves; undefined while it is read, null when there is none */
  meta: { name: string; image?: string; same?: boolean } | null | undefined;
  colour: number;
  gates: number;
  /** a little one the Breeder hatched and nobody has saved (A33) */
  unsaved: boolean;
  /** the starter line whose brain it carries, when that is another line's (A136) */
  starterOf: number | null;
  /** a log has replayed to its saved memory on this page (A57) */
  proven: boolean;
}) {
  const t = T[lang];
  return (
    <>
      {meta === undefined && (
        <figure className="v-picture v-picture-wait" aria-hidden="true">
          <span className="v-picture-box" />
        </figure>
      )}
      {meta?.image && (
        <figure className="v-picture">
          <img src={meta.image} alt={meta.name} width={144} height={144} />
          <figcaption>
            <Named name={meta.name} colour={colour} />
            <span className="v-note">{t.pictureNote}</span>
            {meta.same !== undefined && (
              <span className={meta.same ? "v-ok" : "v-bad"}>{meta.same ? t.pictureSame : t.pictureDiff}</span>
            )}
            {/* a record whose line is not its state's (mainnet pet #2, A18) is said, not left for a reader to find */}
            {!unsaved && pet.line !== lineOfState(pet.state) && (
              <span className="v-note v-line">
                {t.lineMismatch
                  .replace("{recorded}", t.lines[pet.line] ?? `#${pet.line}`)
                  .replace("{state}", t.lines[lineOfState(pet.state)] ?? `#${lineOfState(pet.state)}`)}
              </span>
            )}
          </figcaption>
        </figure>
      )}
      <dl>
        <dt>{t.owner}</dt>
        <dd className="mono">{short(pet.owner)}</dd>
        <dt>{t.brain}</dt>
        <dd>
          <span className="mono">
            {short(pet.processor)} · #{pet.brainId.toString()} · {gates} {t.gates} · {pet.brainBits} {t.memory}
          </span>
          {starterOf !== null && (
            <span className="v-note v-other-starter" data-testid="other-starter">
              {t.otherStarter
                .replace("{starter}", t.lines[starterOf] ?? "")
                .replace("{line}", t.lines[pet.line] ?? `#${pet.line}`)}
            </span>
          )}
        </dd>
        <dt>{t.days}</dt>
        <dd>{pet.day}</dd>
        <dt>{t.log}</dt>
        <dd className="mono">{short(pet.logHash)}</dd>
        <dt>{t.meters}</dt>
        <dd>
          {/* proven only once a log has replayed to it on this page (A57) */}
          {proven ? (
            <span className="v-tag v-tag-proven">{t.proven}</span>
          ) : (
            <span className="v-tag v-tag-reported" title={t.savedOnlyNote}>
              {t.savedOnly}
            </span>
          )}{" "}
          <span className="mono" title={t.bitOrder}>
            {state.brain.join("")}
          </span>
          {!proven && <span className="v-note v-block">{t.savedOnlyNote}</span>}
          <br />
          {/* a little one never saved holds only its mixed memory: its zeros are said to be zeros, not shown as its state (A33) */}
          {unsaved ? (
            <span className="v-note v-block v-unsaved">
              {t.unsaved.replace("{a}", pet.parentA.toString()).replace("{b}", pet.parentB.toString())}
            </span>
          ) : (
            <>
              <span className="v-tag v-tag-reported">{t.reported}</span>{" "}
              {lang === "zh"
                ? `饱腹 ${state.meters.food} · 开心 ${state.meters.joy} · 精神 ${state.meters.energy} · 干净 ${state.meters.clean} · 经验 ${state.xp}`
                : `food ${state.meters.food} · joy ${state.meters.joy} · energy ${state.meters.energy} · clean ${state.meters.clean} · xp ${state.xp}`}
              <span className="v-note v-block">{t.reportedNote}</span>
            </>
          )}
        </dd>
      </dl>
    </>
  );
}

export function LogPanel({
  lang,
  name,
  result,
  passed,
  birth,
  hosts,
  onFile,
}: {
  lang: Lang;
  name: string | null;
  result: string | null;
  passed: boolean;
  /** the log runs from the pet's birth in the browser: neither a pass nor a failure (A66) */
  birth: boolean;
  hosts: ReadonlySet<string>;
  onFile: (file: File | undefined) => void;
}) {
  const t = T[lang];
  return (
    <div className="v-log">
      <p className="v-sub">{t.logTitle}</p>
      <p className="v-lede">{t.logHelp}</p>
      <div className="v-file">
        <label className="v-run v-pick">
          {t.logPick}
          <input
            type="file"
            accept="application/json"
            className="v-file-input"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
        <span className="v-note mono">{name ?? t.logNone}</span>
      </div>
      {result && (
        <p
          className={passed ? "v-ok" : birth ? "v-note" : "v-bad"}
          data-testid="log-result"
          data-result={passed ? "ok" : birth ? "birth" : "bad"}
        >
          {result}
        </p>
      )}
      {result && hosts.size > 0 && <p className="v-note mono">{viaText(hosts, lang)}</p>}
    </div>
  );
}
