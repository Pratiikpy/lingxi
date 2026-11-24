/**
 * Telegram Mini App screens (PRD S11): continuing in the browser when a step needs
 * a wallet, moving pets back into Telegram, adding Lingxi to the home screen, and
 * the notes that say where the pets went or what arrived.
 */

import { useEffect, useState } from "react";
import { useLang } from "../i18n";
import { type MoveTo, moveAvailable, openMove, prepareMove, undoArrival, useMove } from "../game/move";
import { addToHomeScreen, homeScreenMissing, inTelegram } from "../game/telegram";
import { play } from "../game/sound";
import { TooBig, sizeNote } from "../game/sendSize";
import { Sheet } from "./Sheets";
import { useSaveFileUi } from "./SaveFile";

/** A code is fetched when the sheet opens and renewed before it expires, so the tap can open the link at once. */
const RENEW_MS = 10 * 60_000;

function usePreparedCode(active: boolean): { code: string | null; failed: boolean; big: TooBig | null } {
  const [code, setCode] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [big, setBig] = useState<TooBig | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const get = () =>
      prepareMove().then(
        (c) => live && (setCode(c), setFailed(false), setBig(null)),
        (e: unknown) => live && (setFailed(true), setBig(e instanceof TooBig ? e : null)),
      );
    void get();
    const id = setInterval(get, RENEW_MS);
    return () => {
      live = false;
      clearInterval(id);
      setCode(null);
    };
  }, [active]);
  return { code, failed, big };
}

function MoveButton({
  to,
  code,
  failed,
  big,
}: {
  to: MoveTo;
  code: string | null;
  failed: boolean;
  big: TooBig | null;
}) {
  const zh = useLang((s) => s.lang) === "zh";
  const label =
    to === "browser" ? (zh ? "在浏览器里打开" : "Open in my browser") : zh ? "在 Telegram 里打开" : "Open in Telegram";
  if (big) {
    // too large to move by the server: nothing was sent; from a browser, a save file carries it into Telegram instead
    const size = sizeNote(big, zh ? "zh" : "en");
    return to === "telegram" ? (
      <>
        <p className="small">
          {zh
            ? `你的存档太大，没法这样搬${size}。可以改用存档文件：在这里下载，然后在 Telegram 里打开灵犀，从“宠物 ▸ 存档文件”恢复。`
            : `Your save is too large to move this way ${size}. Use a save file instead: download it here, then open Lingxi in Telegram and restore it from Pet ▸ Save file.`}
        </p>
        <button type="button" className="btn primary" onClick={() => (play("tap"), useSaveFileUi.getState().show())}>
          {zh ? "存档文件" : "Save file"}
        </button>
      </>
    ) : (
      <p className="small">
        {zh
          ? `你的存档太大，没法这样搬${size}。什么都没有发出去，宠物都还在这里。`
          : `Your save is too large to move this way ${size}. Nothing was sent; your pets are all still here.`}
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn primary"
        disabled={!code}
        onClick={() => code && (play("success"), openMove(to, code))}
      >
        {code ? label : failed ? (zh ? "暂时无法搬家" : "Can't move right now") : zh ? "准备中……" : "Getting ready…"}
      </button>
      {failed && (
        <p className="small">
          {zh ? "服务器没有回应。稍后再打开这里试试。" : "The server didn't answer. Open this again in a little while."}
        </p>
      )}
    </>
  );
}

/** Shown when a step needs a wallet inside Telegram. */
export function MoveSheet() {
  const zh = useLang((s) => s.lang) === "zh";
  const ask = useMove((s) => s.ask);
  const close = useMove((s) => s.closeOffer);
  const { code, failed, big } = usePreparedCode(ask);
  return (
    <Sheet open={ask} title={zh ? "在浏览器里继续" : "Continue in your browser"} onClose={close}>
      <div className="move-card">
        <p>
          {zh
            ? "Telegram 里没有钱包，所以保存到链上、发布设计和领红包这些步骤要在手机浏览器里完成。你的宠物会一起搬过去。"
            : "Telegram has no wallet, so steps like saving on chain, publishing a design or opening a red packet happen in your phone's browser. Your pets come along."}
        </p>
        <ul className="move-facts">
          <li>{zh ? "搬家链接只能用一次，15 分钟内有效。" : "The move link works once, within 15 minutes."}</li>
          <li>
            {zh
              ? "浏览器里原来的宠物会留一份备份，可以撤销。"
              : "Any pets already in that browser are kept as a backup you can undo to."}
          </li>
          <li>
            {zh
              ? "自动保存的钥匙留在这台设备上，在浏览器里需要重新开启。"
              : "The auto-save key stays on this device; switch auto-save on again in the browser."}
          </li>
        </ul>
        <MoveButton to="browser" code={code} failed={failed} big={big} />
      </div>
    </Sheet>
  );
}

/** In the "me" sheet: Telegram's options, or moving pets into Telegram from a browser. */
export function TelegramCard() {
  const zh = useLang((s) => s.lang) === "zh";
  const offer = useMove((s) => s.offer);
  const [toTelegram, setToTelegram] = useState(false);
  const { code, failed, big } = usePreparedCode(toTelegram);
  const [homeMissing, setHomeMissing] = useState(false);
  const tg = inTelegram();
  useEffect(() => {
    if (tg) void homeScreenMissing().then(setHomeMissing);
  }, [tg]);
  if (!tg && !moveAvailable("telegram")) return null;
  return (
    <div className="move-card">
      <p className="label">Telegram</p>
      {tg ? (
        <>
          <p className="small">
            {zh
              ? "要用钱包的步骤在手机浏览器里完成，宠物可以一起搬过去。"
              : "Steps that need a wallet happen in your phone's browser, and your pets can move there."}
          </p>
          <div className="row">
            {moveAvailable("browser") && (
              <button type="button" className="btn" onClick={() => (play("tap"), offer())}>
                {zh ? "在浏览器里继续" : "Continue in browser"}
              </button>
            )}
            {homeMissing && (
              <button type="button" className="btn" onClick={() => (play("tap"), addToHomeScreen())}>
                {zh ? "添加到主屏幕" : "Add to home screen"}
              </button>
            )}
          </div>
        </>
      ) : toTelegram ? (
        <>
          <p className="small">
            {zh
              ? "宠物会搬进 Telegram 小程序。链接只能用一次，15 分钟内有效。"
              : "Your pets move into the Telegram Mini App. The link works once, within 15 minutes."}
          </p>
          <MoveButton to="telegram" code={code} failed={failed} big={big} />
        </>
      ) : (
        <>
          <p className="small">
            {zh
              ? "在 Telegram 里照顾宠物：通知、手势和聊天里随时打开。"
              : "Look after your pets inside Telegram, a tap away in any chat."}
          </p>
          <button type="button" className="btn" onClick={() => (play("tap"), setToTelegram(true))}>
            {zh ? "搬到 Telegram" : "Move my pets to Telegram"}
          </button>
        </>
      )}
    </div>
  );
}

/** What arrived on this visit, or a reminder that these pets moved away. */
export function MoveNotes() {
  const zh = useLang((s) => s.lang) === "zh";
  const { arrived, moved, hasBefore, stayHere, dismissArrival } = useMove();
  if (arrived) {
    const text =
      arrived === "ok"
        ? zh
          ? "你的宠物搬过来了，一切都在。"
          : "Your pets have arrived, everything with them."
        : arrived === "restored"
          ? zh
            ? "已从存档文件恢复，一切都回来了。"
            : "Restored from your save file: everything is back."
          : arrived === "gone"
            ? zh
              ? "这个搬家链接已经用过或过期了。回到原来的地方再搬一次。"
              : "That move link was already used or has expired. Move again from where your pets are."
            : zh
              ? "搬家没有完成，网络断了。回到原来的地方再试一次。"
              : "The move didn't finish; the connection dropped. Try again from where your pets are.";
    return (
      <div className="move-note" role="status">
        <p>{text}</p>
        <div className="row">
          {(arrived === "ok" || arrived === "restored") && hasBefore && (
            <button type="button" className="btn" onClick={() => undoArrival()}>
              {zh ? "撤销，换回原来的宠物" : "Undo: bring back the earlier pets"}
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => (play("tap"), dismissArrival())}>
            {zh ? "好的" : "OK"}
          </button>
        </div>
      </div>
    );
  }
  if (!moved) return null;
  const where = moved.to === "browser" ? (zh ? "你的浏览器" : "your browser") : "Telegram";
  return (
    <div className="move-note" role="status">
      <p>
        {zh
          ? `这些宠物已经搬到${where}了。在这里做的改动不会跟过去。`
          : `These pets moved to ${where}. Changes made here won't follow them.`}
      </p>
      <div className="row">
        <button type="button" className="btn" onClick={() => (play("tap"), stayHere())}>
          {zh ? "继续在这里玩" : "Keep playing here"}
        </button>
      </div>
    </div>
  );
}
