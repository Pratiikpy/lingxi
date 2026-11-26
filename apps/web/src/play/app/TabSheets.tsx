/**
 * P7: the game's tab sheets, out of PlayApp: the bag, the mail, the map, the collection, the quests, the mind, the spar,
 * the games, the pets and the Pet sheet with all it holds. Each panel's code still arrives only when it is wanted, and
 * every one says so while it is on the way and offers a Try again if it cannot be fetched (R33 for the tabs' panels; R35
 * for the Pet sheet's and the collection's, which showed a blank and then the whole game's crash screen). Those are not
 * warmed up at start: most visits never open them.
 */
import { useState } from "react";
import type { Pet } from "@lingxi/game";
import { useLang, useT } from "../../i18n";
import { play } from "../../game/sound";
import { OnChainNote } from "../../OnChainNote";
import { SiteFoot } from "../../SiteFoot";
import { AlbumPanel } from "../Album";
import { BadgeShelf } from "../Badges";
import { Lazy, deferredPanel } from "../Lazy";
import { MoreBehind } from "../MoreBehind";
import { TelegramCard } from "../Move";
import type { Tab } from "../parts";
import { SaveFileCard } from "../SaveFile";
import { EvolutionChart, MeSheetBody, MindPanel, Sheet } from "../Sheets";

const AdoptionPanel = deferredPanel(() => import("../Adoption").then((x) => x.AdoptionPanel), { warm: false });
const ArenaPanel = deferredPanel(() => import("../Arena").then((x) => x.ArenaPanel));
const BagPanel = deferredPanel(() => import("../WorldPanels").then((x) => x.BagPanel));
const ChainPanel = deferredPanel(() => import("../ChainPanel").then((x) => x.ChainPanel));
const CollectionPanel = deferredPanel(() => import("../Collection").then((x) => x.CollectionPanel), { warm: false });
const DiaryPanel = deferredPanel(() => import("../Diary").then((x) => x.DiaryPanel), { warm: false });
const ExtrasPanel = deferredPanel(() => import("../Extras").then((x) => x.ExtrasPanel), { warm: false });
const FamilyTree = deferredPanel(() => import("../Family").then((x) => x.FamilyTree), { warm: false });
const FashionMarketPanel = deferredPanel(() => import("../FashionMarket").then((x) => x.FashionMarketPanel), {
  warm: false,
});
const FriendsPanel = deferredPanel(() => import("../Friends").then((x) => x.FriendsPanel), { warm: false });
const GamesPanel = deferredPanel(() => import("../Games").then((x) => x.GamesPanel));
const HandheldPanel = deferredPanel(() => import("../Handheld").then((x) => x.HandheldPanel), { warm: false });
const HoldersPanel = deferredPanel(() => import("../Holders").then((x) => x.HoldersPanel), { warm: false });
const HomePanel = deferredPanel(() => import("../Home").then((x) => x.HomePanel));
const InvitePanel = deferredPanel(() => import("../Social").then((x) => x.InvitePanel), { warm: false });
const ItemShopPanel = deferredPanel(() => import("../ItemShop").then((x) => x.ItemShopPanel), { warm: false });
const MailboxPanel = deferredPanel(() => import("../Mailbox").then((x) => x.MailboxPanel));
const MapPanel = deferredPanel(() => import("../WorldPanels").then((x) => x.MapPanel));
const NeighboursPanel = deferredPanel(() => import("../Neighbours").then((x) => x.NeighboursPanel));
const Outings = deferredPanel(() => import("../Outings").then((x) => x.Outings));
const PetLetters = deferredPanel(() => import("../PetLetters").then((x) => x.PetLetters));
const PetsPanel = deferredPanel(() => import("../Family").then((x) => x.PetsPanel));
const QuestBook = deferredPanel(() => import("../Quests").then((x) => x.QuestBook));
const RedPacketPanel = deferredPanel(() => import("../RedPacket").then((x) => x.RedPacketPanel), { warm: false });
const RemindersPanel = deferredPanel(() => import("../Reminders").then((x) => x.RemindersPanel));
const RewindPanel = deferredPanel(() => import("../Rewind").then((x) => x.RewindPanel), { warm: false });
const SendGiftPanel = deferredPanel(() => import("../Gift").then((x) => x.SendGiftPanel), { warm: false });
const SitPanel = deferredPanel(() => import("../Sitting").then((x) => x.SitPanel), { warm: false });
const StudioPanel = deferredPanel(() => import("../Studio").then((x) => x.StudioPanel), { warm: false });
const TeachPanel = deferredPanel(() => import("../Teach").then((x) => x.TeachPanel));
const WardrobePanel = deferredPanel(() => import("../Wardrobe").then((x) => x.WardrobePanel));

export function TabSheets({
  tab,
  close,
  pick,
  pet,
}: {
  tab: Tab;
  close: () => void;
  pick: (t: Tab) => void;
  pet: Pet;
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  return (
    <>
      <Sheet open={tab === "bag"} title={t("bag.title")} onClose={close}>
        <BagPanel onFed={close} />
      </Sheet>
      <Sheet open={tab === "mail"} title={lang === "zh" ? "邮件" : "Mail"} onClose={close}>
        <MailTabs />
      </Sheet>
      <Sheet open={tab === "map"} title={t("map.title")} onClose={close}>
        {/* R33: the map and its Outside and Indoors switch first; a walk or trip under way above it, new ones below */}
        <Outings pet={pet}>
          <MapPanel onGone={close} />
        </Outings>
      </Sheet>
      <Sheet open={tab === "collection"} title={lang === "zh" ? "收藏" : "Collection"} onClose={close}>
        <Lazy>
          <CollectionPanel />
        </Lazy>
      </Sheet>
      <Sheet open={tab === "quests"} title={t("quest.title")} onClose={close}>
        <QuestBook />
      </Sheet>
      <Sheet open={tab === "mind"} title={t("teach.title", { name: pet.name })} onClose={close}>
        <TeachPanel pet={pet} />
        <hr className="divider" />
        <p className="small">{t("mind.title", { name: pet.name })}</p>
        <MindPanel pet={pet} />
      </Sheet>

      <Sheet open={tab === "spar"} title={lang === "zh" ? "切磋" : "Spar"} onClose={close}>
        <ArenaPanel pet={pet} />
      </Sheet>

      <Sheet open={tab === "games"} title={lang === "zh" ? "一起玩" : "Play together"} onClose={close}>
        <GamesPanel pet={pet} onDone={close} onSchool={() => pick("mind")} />
      </Sheet>

      <Sheet open={tab === "pets"} title={lang === "zh" ? "你的宠物" : "Your pets"} onClose={close}>
        <PetsPanel onPicked={close} />
      </Sheet>

      <Sheet open={tab === "me"} title={t("me.title", { name: pet.name })} onClose={close}>
        {/* H5: the pet first (who it is, keeping it on X Layer, its days, its growth and family); everything else behind one entry */}
        <Lazy>
          <MeSheetBody pet={pet} />
        </Lazy>
        <hr className="divider" />
        <ChainPanel pet={pet} />
        <hr className="divider" />
        <Lazy>
          <DiaryPanel pet={pet} />
        </Lazy>
        <hr className="divider" />
        <Lazy>
          <RewindPanel pet={pet} />
        </Lazy>
        <hr className="divider" />
        <Lazy>
          <EvolutionChart pet={pet} />
        </Lazy>
        <hr className="divider" />
        <Lazy>
          <FamilyTree pet={pet} />
        </Lazy>
        <hr className="divider" />
        <MoreBehind>
          <SaveFileCard />
          <TelegramCard />
          <WardrobePanel pet={pet} />
          <hr className="divider" />
          <Lazy>
            <StudioPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <FashionMarketPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <ItemShopPanel />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <ExtrasPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <AdoptionPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <FriendsPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <NeighboursPanel />
          <hr className="divider" />
          <Lazy>
            <HoldersPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <AlbumPanel />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <InvitePanel />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <SitPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <HandheldPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <OnChainNote lang={lang} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <SendGiftPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <Lazy>
            <RedPacketPanel pet={pet} />
          </Lazy>
          <hr className="divider" />
          <BadgeShelf />
          <hr className="divider" />
          <RemindersPanel pet={pet} />
          <hr className="divider" />
          <HomePanel pet={pet} />
        </MoreBehind>
        {/* P6: privacy, terms and a contact, at the foot of the Pet sheet as at the foot of every page */}
        <SiteFoot lang={lang} />
      </Sheet>
    </>
  );
}

function MailTabs() {
  const lang = useLang((s) => s.lang) === "zh" ? "zh" : "en";
  const [which, setWhich] = useState<"lingxi" | "pets">("lingxi");
  return (
    <>
      <div className="mail-tabs" role="tablist" aria-label={lang === "zh" ? "邮件" : "Mail"}>
        <button
          type="button"
          role="tab"
          aria-selected={which === "lingxi"}
          className={which === "lingxi" ? "on" : ""}
          onClick={() => (play("tap"), setWhich("lingxi"))}
        >
          {lang === "zh" ? "灵犀的来信" : "From Lingxi"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={which === "pets"}
          className={which === "pets" ? "on" : ""}
          onClick={() => (play("tap"), setWhich("pets"))}
        >
          {lang === "zh" ? "宠物的信" : "Pet letters"}
        </button>
      </div>
      {which === "lingxi" ? <MailboxPanel /> : <PetLetters />}
    </>
  );
}
