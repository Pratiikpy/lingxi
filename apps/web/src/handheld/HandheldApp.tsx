/**
 * The browser handheld (plan 4.14): the firmware's own app, compiled to WebAssembly, on a drawn Cardputer. The
 * screen is the app's 240x135 framebuffer as it is; the keys are the Cardputer's. A pet the game sent arrives through
 * local storage, its trip is kept across reloads (the packet and the log replay to the same bits), and "Bring home"
 * hands the game the packet back. The game decides whether the pet comes home, by replaying the whole trip.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import wasmUrl from "@lingxi/handheld/wasm/lingxi-handheld.wasm?url";
import { useLang } from "../i18n";
import { SiteFoot } from "../SiteFoot";
import { type StartersOnChain, useStartersOnChain } from "./startersOnChain";
import { usePageMeta } from "../i18n/pageMeta";
import { DEVICE_KEY, INBOX_KEY, RETURN_KEY, fromB64 } from "../game/handheldKeys";
import { gameIsOpen, handheldIsMine } from "../game/handheldLock";
import { startHandheldClock, wallBeat } from "./clock";
import "./handheld.css";

interface HH {
  memory: WebAssembly.Memory;
  hh_in(): number;
  hh_out(): number;
  hh_fb(): number;
  hh_init(now: number): number;
  hh_open(len: number): number;
  hh_resume(p: number, l: number): number;
  hh_tick(now: number, beat: number, present: number): void;
  hh_key(k: number): void;
  hh_draw(): void;
  hh_close(): number;
  hh_release(): void;
  hh_log(): number;
  hh_log_len(): number;
  hh_ready(): number;
  hh_selftest(): number;
}

type Lang = "en" | "zh";
type Words = Record<Lang, string>;
const W = 240;
const H = 135;

const b64 = (b: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

/** The keys a pet needs, laid out as the Cardputer's rows; each sends the code the firmware reads. */
const KEYS: Array<Array<{ k: string; code: number; en: string; zh: string; wide?: boolean }>> = [
  [
    { k: "`", code: 27, en: "back", zh: "返回" },
    { k: "1", code: 49, en: "", zh: "" },
    { k: "2", code: 50, en: "", zh: "" },
    { k: "3", code: 51, en: "", zh: "" },
    { k: "4", code: 52, en: "", zh: "" },
    { k: "?", code: 63, en: "keys", zh: "按键" },
  ],
  [
    { k: "F", code: 102, en: "feed", zh: "喂食" },
    { k: "P", code: 112, en: "play", zh: "玩耍" },
    { k: "C", code: 99, en: "clean", zh: "洗澡" },
    { k: "L", code: 108, en: "sleep", zh: "睡觉" },
    { k: "H", code: 104, en: "pet", zh: "摸摸" },
  ],
  [
    { k: "M", code: 109, en: "medicine", zh: "吃药" },
    { k: "T", code: 116, en: "talk", zh: "说话" },
    { k: "B", code: 98, en: "brain", zh: "电路" },
    { k: "G", code: 103, en: "go home", zh: "回家" },
    { k: "Z", code: 122, en: "中文", zh: "English" },
  ],
  [{ k: "space", code: 32, en: "", zh: "", wide: true }],
];

function keyCode(e: KeyboardEvent): number | null {
  if (e.key === "Escape" || e.key === "Backspace" || e.key === "`") return 27;
  if (e.key === "Enter") return 13;
  if (e.key === " ") return 32;
  if (e.key.length === 1) return e.key.toLowerCase().charCodeAt(0);
  return null;
}

/** Closes a tab the game opened; a tab the browser will not let a page close says the player may close it. */
function CloseTab({ lang }: { lang: Lang }) {
  const [refused, setRefused] = useState(false);
  if (refused)
    return <p className="hh-sub">{lang === "zh" ? "现在可以关掉这个标签页了。" : "You can close this tab now."}</p>;
  return (
    <button
      type="button"
      className="btn primary"
      onClick={() => {
        window.close();
        setTimeout(() => setRefused(!window.closed), 300);
      }}
    >
      {lang === "zh" ? "关闭这个标签页" : "Close this tab"}
    </button>
  );
}

export function HandheldApp() {
  // the page's language, title and description, in the reader's language (A111)
  usePageMeta("handheld");
  const lang = useLang((s) => s.lang) as Lang;
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const canvas = useRef<HTMLCanvasElement>(null);
  const hh = useRef<HH | null>(null);
  const [selfTest, setSelfTest] = useState<number | null>(null);
  // the starters recorded in the firmware, compared with X Layer's own (startersOnChain.ts, A59)
  const onChain = useStartersOnChain();
  const [ready, setReady] = useState(false);
  // P6: until the firmware has started and looked for a pet, the page cannot say none is aboard; it said so for half
  // a second on every open, a pet waiting to come aboard included
  const [started, setStarted] = useState(false);
  const [coming] = useState(() => {
    try {
      return localStorage.getItem(INBOX_KEY) !== null || localStorage.getItem(DEVICE_KEY) !== null;
    } catch {
      return false;
    }
  });
  // kept in both languages, so a message shown before the language changes follows it
  const [problem, setProblem] = useState<Words | null>(null);
  const [sending, setSending] = useState(false);
  // A7: sent to the game open in another tab, and what became of it there
  const [sent, setSent] = useState<"no" | "toGame" | "home" | "refused">("no");
  // once the trip is sent the handheld stops: no more beats, keys or saves, so the log stays the one the game reads
  const stopped = useRef(false);
  // the handheld's own clock: milliseconds since this page started it
  const [t0] = useState(() => performance.now());
  const now = useCallback(() => Math.floor(performance.now() - t0), [t0]);

  /** keep the trip: the packet it started from and its log, which replay to the same pet */
  const keep = useCallback(() => {
    const x = hh.current;
    if (!x || !x.hh_ready() || stopped.current) return;
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return;
    const kept = JSON.parse(raw) as { packet: string; log: string };
    const log = new Uint8Array(x.memory.buffer, x.hh_log(), x.hh_log_len()).slice();
    // only the tab that runs the handheld writes its memory (P1)
    if (handheldIsMine()) localStorage.setItem(DEVICE_KEY, JSON.stringify({ packet: kept.packet, log: b64(log) }));
  }, []);

  /** a pet waiting in the inbox comes aboard, or the one aboard is taken up again after a reload */
  const takeAboard = useCallback(() => {
    const x = hh.current;
    if (!x) return;
    const put = (b: Uint8Array, at = 0) => new Uint8Array(x.memory.buffer).set(b, x.hh_in() + at);
    const kept = localStorage.getItem(DEVICE_KEY);
    if (kept && !x.hh_ready()) {
      const k = JSON.parse(kept) as { packet: string; log: string };
      const packet = fromB64(k.packet);
      const log = fromB64(k.log);
      put(packet);
      put(log, packet.length);
      const e = x.hh_resume(packet.length, log.length);
      if (e !== 0)
        setProblem({
          en: `The trip kept here could not be read (${e}). Bring the pet back from the game.`,
          zh: `这里保存的旅程读不出来（${e}）。请在游戏里把宠物叫回来。`,
        });
    }
    const inbox = localStorage.getItem(INBOX_KEY);
    if (inbox && !x.hh_ready()) {
      const packet = fromB64(inbox);
      put(packet);
      const e = x.hh_open(packet.length);
      if (e === 0) {
        localStorage.setItem(DEVICE_KEY, JSON.stringify({ packet: inbox, log: "" }));
        localStorage.removeItem(INBOX_KEY);
      } else setProblem({ en: `The pet's packet was refused (${e}).`, zh: `宠物的数据被拒收了（${e}）。` });
    }
    setReady(!!x.hh_ready());
  }, []);

  useEffect(() => {
    let alive = true;
    let ticker = 0;
    let frame = 0;
    void (async () => {
      // the pet lives by the game's clock (A6): the handheld's first beat waits for it, as the game's does
      const [{ instance }] = await Promise.all([
        WebAssembly.instantiateStreaming(fetch(wasmUrl), {}).catch(async () =>
          WebAssembly.instantiate(await (await fetch(wasmUrl)).arrayBuffer(), {}),
        ),
        startHandheldClock(),
      ]);
      if (!alive) return;
      const x = instance.exports as unknown as HH;
      hh.current = x;
      x.hh_init(now());
      if (useLang.getState().lang === "zh") x.hh_key(122);
      setSelfTest(x.hh_selftest());
      takeAboard();
      setStarted(true);
      const ctx = canvas.current?.getContext("2d");
      // the canvas is mounted with the page, so a missing one means this browser cannot draw it: said below as unreadable
      if (!ctx) throw new Error("the handheld's screen could not be drawn on");
      const img = ctx.createImageData(W, H);
      const draw = () => {
        x.hh_draw();
        const fb = new Uint16Array(x.memory.buffer, x.hh_fb(), W * H);
        const d = img.data;
        for (let i = 0; i < W * H; i++) {
          const v = fb[i] ?? 0;
          const r = (v >> 11) & 31,
            g = (v >> 5) & 63,
            b = v & 31;
          d[4 * i] = (r << 3) | (r >> 2);
          d[4 * i + 1] = (g << 2) | (g >> 4);
          d[4 * i + 2] = (b << 3) | (b >> 2);
          d[4 * i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      let lastKeep = 0;
      ticker = window.setInterval(() => {
        if (stopped.current) return;
        x.hh_tick(now(), wallBeat(), document.hidden ? 0 : 1);
        if (now() - lastKeep > 5000) {
          keep();
          lastKeep = now();
        }
      }, 250);
    })();
    const onStorage = (e: StorageEvent) => {
      // the game took the pet home (or sent one): follow it
      if (e.key === DEVICE_KEY && e.newValue === null && hh.current?.hh_ready()) {
        hh.current.hh_release();
        setReady(false);
      }
      if (e.key === INBOX_KEY && e.newValue) takeAboard();
      // the game read the packet this tab sent: the pet is home if the game cleared its place here, else it was refused
      if (e.key === RETURN_KEY && e.newValue === null)
        setSent((s) => (s === "toGame" ? (localStorage.getItem(DEVICE_KEY) === null ? "home" : "refused") : s));
    };
    const onHide = () => keep();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      alive = false;
      clearInterval(ticker);
      cancelAnimationFrame(frame);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      keep();
    };
  }, [now, keep, takeAboard]);

  const press = useCallback(
    (code: number) => {
      const x = hh.current;
      if (!x || stopped.current) return;
      x.hh_tick(now(), wallBeat(), 1);
      x.hh_key(code);
      // Z switches the handheld's language; the page around it follows
      if (code === 122) useLang.getState().toggle();
      keep();
    },
    [now, keep],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const c = keyCode(e);
      if (c === null) return;
      e.preventDefault();
      press(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  const bringHome = async () => {
    const x = hh.current;
    if (!x || !x.hh_ready()) return;
    setSending(true);
    x.hh_tick(now(), wallBeat(), 1);
    keep();
    const n = x.hh_close();
    if (!n) {
      setSending(false);
      setProblem({ en: "The trip's log is too long to send.", zh: "旅程日志太长，发不出去。" });
      return;
    }
    stopped.current = true;
    localStorage.setItem(RETURN_KEY, b64(new Uint8Array(x.memory.buffer, x.hh_out(), n).slice()));
    // the game open in another tab brings the pet home from there; this tab stays the handheld and follows it (A7)
    if (await gameIsOpen()) {
      setSending(false);
      setSent("toGame");
      return;
    }
    location.href = "play.html#handheld-home";
  };

  const passed = selfTest !== null && (selfTest & 0x100) !== 0 && onChain !== "differ";
  return (
    <main className="hh-page">
      <header className="hh-head">
        <a className="hh-back" href="play.html">
          {L("← Lingxi", "← 灵犀")}
        </a>
        <h1>{L("The handheld", "灵犀掌机")}</h1>
        <p className="hh-sub">
          {L(
            "The Cardputer's own firmware, running in your browser: the same C code, the same screen, and the same circuit the pet thinks with at home (read from X Layer when its mind is on chain).",
            "Cardputer 的固件原样跑在浏览器里：同一份 C 代码、同一块屏幕，宠物用的是它在家里思考的同一块电路（心智上链后从 X Layer 读取）。",
          )}
        </p>
      </header>

      <section className="hh-device" aria-label={L("Handheld", "掌机")}>
        <div className="hh-bezel">
          <canvas
            ref={canvas}
            className="hh-screen"
            width={W}
            height={H}
            aria-label={L("The handheld's screen", "掌机屏幕")}
          />
        </div>
        <div className="hh-keys">
          {KEYS.map((row, i) => (
            <div className="hh-row" key={i}>
              {row.map((key) => (
                <button
                  key={key.k}
                  type="button"
                  className={`hh-key${key.wide ? " wide" : ""}`}
                  onClick={() => press(key.code)}
                  aria-label={`${key.k}${key[lang] ? ` ${key[lang]}` : ""}`}
                >
                  <span className="hh-cap">
                    {key.k === "space" ? L("space", "空格") : key.k === "`" ? "esc" : key.k}
                  </span>
                  {key[lang] && <span className="hh-what">{key[lang]}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <StatusPanel
        lang={lang}
        selfTest={selfTest}
        onChain={onChain}
        passed={passed}
        problem={problem}
        sent={sent}
        sending={sending}
        onBringHome={bringHome}
        ready={ready}
        started={started}
        coming={coming}
      />
      <SiteFoot lang={lang} />
    </main>
  );
}

/**
 * What the handheld says under its screen: its self-test against the recorded starters and X Layer's, a problem, and
 * bringing the pet home to the game (A7), with what became of it there.
 */
function StatusPanel({
  lang,
  selfTest,
  onChain,
  passed,
  problem,
  sent,
  sending,
  onBringHome,
  ready,
  started,
  coming,
}: {
  lang: Lang;
  selfTest: number | null;
  onChain: StartersOnChain;
  passed: boolean;
  problem: Words | null;
  sent: "no" | "toGame" | "home" | "refused";
  sending: boolean;
  onBringHome: () => unknown;
  ready: boolean;
  started: boolean;
  coming: boolean;
}) {
  const L = (en: string, zh: string) => (lang === "zh" ? zh : en);
  return (
    <section className="hh-panel" aria-live="polite">
      {selfTest !== null && (
        <p className={passed ? "hh-ok" : "hh-bad"}>
          {!passed
            ? onChain === "differ"
              ? L(
                  "Self-test failed: X Layer now holds other starter circuits than this handheld was built with, so it takes no pets.",
                  "自检没通过：X Layer 上的初始电路和这台掌机构建时记录的不一样，所以它不接收宠物。",
                )
              : L("Self-test failed: this handheld takes no pets.", "自检没通过：这台掌机不接收宠物。")
            : onChain === "match"
              ? L(
                  "Self-test passed: its three starter brains match the netlists on X Layer (read just now), and pet #1's recorded mainnet log replays exactly.",
                  "自检通过：三个初始大脑与刚从 X Layer 读到的网表一致，1 号宠物记录的主网日志重放一致。",
                )
              : onChain === "unread"
                ? L(
                    "Self-test passed: its three starter brains match the hashes recorded from X Layer when it was built (X Layer couldn't be read just now), and pet #1's recorded mainnet log replays exactly.",
                    "自检通过：三个初始大脑与构建时从 X Layer 记录的哈希一致（暂时读不到 X Layer），1 号宠物记录的主网日志重放一致。",
                  )
                : L(
                    "Self-test passed against the record built into it; reading X Layer to confirm…",
                    "按内置记录自检通过，正在读取 X Layer 确认……",
                  )}
        </p>
      )}
      {problem && <p className="hh-bad">{problem[lang]}</p>}
      {sent === "toGame" ? (
        <p className="hh-sent">
          {L(
            "Sent home. Your game is open in another tab, and your pet is on its way there.",
            "已送回家。游戏在另一个标签页里开着，宠物正在回去的路上。",
          )}
        </p>
      ) : sent === "home" ? (
        <>
          <p className="hh-ok">{L("Home: your pet is back in your game.", "到家了：宠物已经回到游戏里。")}</p>
          <CloseTab lang={lang} />
        </>
      ) : sent === "refused" ? (
        <>
          <p className="hh-bad">
            {L(
              "The game kept your pet out here; its tab says why. It is still aboard.",
              "游戏没有接收宠物，原因在游戏的标签页里。它还在掌机上。",
            )}
          </p>
          <button type="button" className="btn" onClick={() => location.reload()}>
            {L("Back to the handheld", "回到掌机")}
          </button>
        </>
      ) : ready ? (
        <>
          <p>
            {L(
              "Everything that happens here is replayed by the game, step by step, before your pet comes home.",
              "这里发生的每一步，游戏都会在宠物回家前重放一遍。",
            )}
          </p>
          <button type="button" className="btn primary" disabled={sending} onClick={onBringHome}>
            {sending ? L("Sending…", "发送中……") : L("Bring home", "带回家")}
          </button>
        </>
      ) : !started ? (
        <p role="status">
          {coming
            ? L("Bringing your pet aboard…", "正在把宠物带上掌机……")
            : L("Waking the handheld…", "掌机正在启动……")}
        </p>
      ) : (
        <p>
          {L(
            "No pet aboard. In the game, open Pet and choose Take along.",
            "还没有宠物。在游戏里打开“宠物”，选“带出门”。",
          )}{" "}
          <a href="play.html">{L("Open the game", "打开游戏")}</a>
        </p>
      )}
    </section>
  );
}
