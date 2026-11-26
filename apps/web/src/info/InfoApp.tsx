/**
 * P6: the pages a finished product has: privacy and terms, each with a contact, in English and Chinese. Every
 * statement on the privacy page is what the code does (BUILD-STATUS section 326 lists where each was read from); when
 * the code changes what it keeps, this page changes with it.
 */
import { useLang } from "../i18n";
import { usePageMeta } from "../i18n/pageMeta";

type Kind = "privacy" | "terms";
type Section = { h: [string, string]; p: Array<[string, string]> };

const CONTACT: Section = {
  h: ["Contact", "联系我们"],
  p: [
    [
      "Questions, a correction, or a request about anything on this page: open an issue at github.com/Pratiikpy/lingxi/issues. The project is open source, and so is every answer.",
      "关于本页的问题、更正或请求：请在 github.com/Pratiikpy/lingxi/issues 提一个 issue。项目是开源的，回答也是公开的。",
    ],
  ],
};

const PRIVACY: Section[] = [
  {
    h: ["The short version", "简单说"],
    p: [
      [
        "Lingxi has no accounts, sets no cookies and sells nothing about you. Your pet lives in your browser. What reaches our server is what a feature needs to work, kept no longer than it needs it.",
        "灵犀没有账号，不设 cookie，也不出售任何关于你的信息。你的宠物住在你的浏览器里。到达我们服务器的，只有某个功能运作所需的内容，并且不会保存得比需要的更久。",
      ],
    ],
  },
  {
    h: ["On your device", "在你的设备上"],
    p: [
      [
        "Your pets, their memories, your choices and settings, and a key this device signs your pet's daily saves with are kept in this browser's own storage. They never leave it unless you send them: a save file you download, a link you share, or a pet you keep on X Layer.",
        "你的宠物、它们的记忆、你的选择和设置，以及这台设备用来签署宠物每日存档的密钥，都保存在这个浏览器自己的存储里。除非你主动发出（下载存档文件、分享链接、把宠物留在 X Layer 上），它们不会离开这里。",
      ],
      [
        "Clearing this browser's site data removes them. A save file, or keeping your pet on X Layer, is how you carry a pet across devices.",
        "清除这个浏览器的网站数据会删除它们。要在设备之间带上宠物，可以用存档文件，或者把宠物留在 X Layer 上。",
      ],
    ],
  },
  {
    h: ["What our server keeps, and why", "我们的服务器保存什么，为什么"],
    p: [
      [
        "Your pet's home, as you decorate it, so friends who drop by see it.",
        "你布置的宠物的家，好让来串门的朋友看到。",
      ],
      [
        "A pet you leave with a sitter, and what you pack for it, until you take it back.",
        "你托付给别人照看的宠物和你为它准备的行李，直到你接回它。",
      ],
      [
        "Pets you enter in the arena or the weekly season, with their names and the cards that describe them, for the standings.",
        "你送去竞技场或每周赛季的宠物，连同名字和描述它的卡片，用来排名。",
      ],
      [
        "Lessons you choose to share in the library, and diaries you choose to publish.",
        "你选择分享到课程库的课，以及你选择发布的日记。",
      ],
      [
        "Errors the game runs into: the error's message, where in the game's code it happened and which release, with addresses, keys, emails and long numbers taken out, so we can fix them. Nothing that says who you are is sent with it; the server keeps the latest few and a count for the hour, and writes each to its own log.",
        "游戏自己出的错：错误信息、出错的代码位置和版本，地址、密钥、邮箱和长数字都会被去掉，好让我们修好它。不会附带任何说明你是谁的信息；服务器只留最近几条和这一小时的次数，并把每一条写进它自己的日志。",
      ],
      [
        "Wallets you link to your home, by signing a message with each (no transaction, no cost), so visitors see the on-chain pieces those wallets hold. When the list is full, the home seen longest ago is let go.",
        "你用签名（不发交易、不花钱）关联到家里的钱包，好让来访的人看到这些钱包里的链上物件。名单满了时，最久没出现的那个家会被放下。",
      ],
      [
        "Adoption papers: when you offer a little one at the adoption centre, its full record as you post it, signed by your wallet, so the adopter's game can check it against X Layer before paying. When the store is full, the papers posted longest ago go first.",
        "领养资料：你在领养中心送养小宝宝时，由你的钱包签名发出的它的完整记录，好让领养人的游戏在付款前对照 X Layer 核对。存满时，最早发出的资料先被删掉。",
      ],
      [
        "Short duel links you make: the challenge or result each one carries (both pets' cards), under a short code so the link fits in a chat. Who made a link is kept only as the code described below, to limit how many one network makes. The links nobody has opened for longest go first.",
        "你生成的短切磋链接：每个链接带的挑战或结果（两只宠物的卡片），存在一个短代码下，好让链接放得进聊天消息。谁生成的链接，只以下面说的那种代码保存，用来限制一个网络能生成多少。最久没人打开的链接先被删掉。",
      ],
      [
        "Pets raised by AI agents through our agent API: the pet and how it is cared for and taught, a hash of the agent's secret token (never the token itself), and the code described below of the network that adopted it, so one network cannot take more than five.",
        "AI 智能体通过我们的智能体接口养的宠物：宠物本身和它被照顾、被教的经过，智能体密钥的哈希（从不保存密钥本身），以及领养它的网络的那种代码（见下文），好让一个网络最多只领五只。",
      ],
      [
        "If Lingxi keeps your pet on X Layer for you: the device address the pet was sent to, the pet, what sending it cost us, and the code described below of the network that asked, so each address gets one and the free keeps are shared fairly.",
        "如果灵犀替你把宠物留在 X Layer 上：宠物被发到的设备地址、这只宠物、发送花了我们多少，以及发出请求的网络的那种代码（见下文），好让每个地址只得一只，免费名额公平分配。",
      ],
      [
        "How many new minds each pet and wallet has asked Lingxi to tape out (pet numbers and wallet addresses, both already public on X Layer), so the free tape-outs are shared fairly.",
        "每只宠物、每个钱包请灵犀流片新心智的次数（宠物编号和钱包地址，在 X Layer 上本来就是公开的），好让免费流片公平分配。",
      ],
      [
        "Copies of what anyone can read on X Layer, so pages load quickly: pets, their saves and families, sales, circuits, breeding consents, red-packet claims, goals and the daily challenge's block; and the team's own wallets, so the numbers page can tell the team's activity from players'.",
        "任何人都能在 X Layer 上读到的内容的副本，好让页面打开得快：宠物、它们的存档和家族、交易、电路、繁育同意、红包领取记录、目标和每日挑战的区块；还有团队自己的钱包，好让数字页把团队的活动和玩家的分开。",
      ],
      [
        "If you turn reminders on: the address your browser gives for notifications and the times you chose, until you turn them off.",
        "如果你打开提醒：浏览器提供的通知地址和你选的时间，直到你关闭提醒。",
      ],
      [
        "To keep the service fair (how often a network may ask for things, how much of the day's language model it may use), a code made from your network address with a key only our server holds and never copies off it. Without that key the code cannot be turned back into the address. It is kept only beside what it limits (an arena or season entry, a pet left with a sitter, a reminder, the day's model use, a pet raised by an agent, a duel link, a lesson used or reported in the library, a pet kept for you) and goes when that does.",
        "为了让服务公平（一个网络多久能请求一次、能用掉当天多少语言模型额度），我们保存一个由你的网络地址加上只有我们服务器才有、也从不拷贝出去的密钥算出的代码。没有那把密钥，这个代码就无法还原成地址。它只和它所限制的东西放在一起（竞技场或赛季的报名、托付照看的宠物、提醒、当天的模型额度、智能体养的宠物、切磋链接、课程库里被使用或被举报的课程、替你留在链上的宠物），那些东西没了，它也就没了。",
      ],
      [
        "Everything above is backed up once a day: on the server's own disk for 14 days, and in a cloud drive for 30 days, so anything removed from the server is gone from every copy within a month. The key that makes the code above is never part of the cloud copy.",
        "以上所有内容每天备份一次：在服务器自己的硬盘上保留 14 天，在云端硬盘上保留 30 天，所以从服务器上删掉的东西，一个月内会从所有备份里消失。上面那个代码所用的密钥从不放进云端备份。",
      ],
    ],
  },
  {
    h: ["What goes to others", "什么会交给别人"],
    p: [
      [
        "Lessons you type in your own words, and the moment your pet is in when it speaks, go to Anthropic's Claude model, which turns them into a rule or a line for your pet. Nothing about you goes with them, and our server does not keep the words you typed.",
        "你用自己的话打出的课，以及宠物说话时所处的情形，会发给 Anthropic 的 Claude 模型，由它变成一条规则或宠物的一句话。不会附带任何关于你的信息，我们的服务器也不保存你打出的字。",
      ],
      [
        "Letters between pets travel through TapeRelay, sealed for the pet they are written to; the relay deletes a letter once it is read, and after 30 days at most.",
        "宠物之间的信通过 TapeRelay 传递，只有收信的宠物能打开；信一被读过就会从中转站删除，最多保留 30 天。",
      ],
      [
        "Anything you keep on X Layer (a pet, its daily saves, a purchase) is public and permanent, as everything on a blockchain is. The game reads X Layer through public nodes and links to the OKLink explorer.",
        "你留在 X Layer 上的一切（宠物、它的每日存档、一次购买）都是公开且永久的，区块链上的一切都是如此。游戏通过公共节点读取 X Layer，并链接到 OKLink 区块浏览器。",
      ],
      [
        "Page visits are counted with Cloudflare's own analytics, which sets no cookie and does not follow you to other sites. Played inside Telegram, Telegram passes the game the language you use there.",
        "页面访问用 Cloudflare 自己的统计来计数，它不设 cookie，也不会在其他网站跟踪你。在 Telegram 里玩时，Telegram 会把你在那里使用的语言告诉游戏。",
      ],
    ],
  },
  CONTACT,
];

const TERMS: Section[] = [
  {
    h: ["Playing", "游戏"],
    p: [
      [
        "Lingxi is free to play. Raising, teaching and caring for a pet costs nothing, and nothing you can buy makes a pet stronger.",
        "灵犀免费游玩。养育、教导和照顾宠物不花任何钱，也没有任何能买到的东西会让宠物变强。",
      ],
      [
        "Your pet lives in your browser. Keep a save file, or keep your pet on X Layer, if you want it safe from a cleared browser or a lost phone.",
        "你的宠物住在你的浏览器里。如果不想因清空浏览器或丢了手机而失去它，请保存存档文件，或把它留在 X Layer 上。",
      ],
    ],
  },
  {
    h: ["On X Layer", "在 X Layer 上"],
    p: [
      [
        "Keeping a pet on X Layer, saving its days and buying an outfit are transactions on a public blockchain: they cannot be undone, and network fees are paid to the network, not to us. BEM spent on outfits is burned. Nothing in the game is an investment, and nothing here is financial advice.",
        "把宠物留在 X Layer 上、保存它的每一天和购买服装，都是公共区块链上的交易：无法撤销，网络手续费付给网络，而不是我们。用来买服装的 BEM 会被销毁。游戏里没有任何东西是投资，这里的一切也不是理财建议。",
      ],
      [
        "The contracts are open and verified; the proof page checks your pet against them from your own browser.",
        "合约是公开并经过验证的；验证页面会在你自己的浏览器里对照合约核对你的宠物。",
      ],
    ],
  },
  {
    h: ["What you write", "你写的内容"],
    p: [
      [
        'Names, lessons, letters and diaries are yours. Do not use them to harass anyone, to share someone else\'s private information, or to break the law. What you publish (a diary, a shared lesson, a pet in the arena) can be seen by other players; offensive names are shown as "Pet".',
        "名字、课、信和日记都属于你。不要用它们骚扰他人、泄露他人隐私或违法。你发布的内容（日记、分享的课、竞技场里的宠物）其他玩家都能看到；冒犯性的名字会显示为“Pet”。",
      ],
    ],
  },
  {
    h: ["The service", "服务"],
    p: [
      [
        "Lingxi is built and run by a small team and offered as it is. We work to keep it up and correct, and we publish what we find wrong; we cannot promise it will never be down, and features may change. What is on X Layer stays there whatever happens to this site.",
        "灵犀由一个小团队打造和运营，按现状提供。我们努力让它稳定、正确，也会公开我们发现的问题；但我们无法保证它永不中断，功能也可能变化。无论这个网站发生什么，留在 X Layer 上的内容都会一直在那里。",
      ],
      [
        "The code is open source at github.com/Pratiikpy/lingxi, under the licence published there.",
        "代码在 github.com/Pratiikpy/lingxi 开源，按那里公布的许可使用。",
      ],
    ],
  },
  CONTACT,
];

export function InfoApp({ kind }: { kind: Kind }) {
  const { lang, toggle } = useLang();
  usePageMeta(kind);
  const L = (pair: [string, string]) => (lang === "zh" ? pair[1] : pair[0]);
  const sections = kind === "privacy" ? PRIVACY : TERMS;
  return (
    <main className="info">
      <header className="v-head">
        <a href="index.html" className="v-brand">
          Lingxi · 灵犀
        </a>
        <button type="button" className="v-lang" onClick={toggle}>
          {lang === "en" ? "中文" : "EN"}
        </button>
      </header>
      <h1>{kind === "privacy" ? L(["Privacy", "隐私"]) : L(["Terms", "条款"])}</h1>
      <p className="info-date">{L(["Last changed 26 November 2026", "最后更新：2026 年 11 月 26 日"])}</p>
      {sections.map((s) => (
        <section key={s.h[0]} className="v-card info-card">
          <h2>{L(s.h)}</h2>
          {s.p.map((p) => (
            <p key={p[0].slice(0, 32)}>{L(p)}</p>
          ))}
        </section>
      ))}
      <footer className="info-foot">
        <a href="play.html">{L(["Open the game", "打开游戏"])}</a> ·{" "}
        <a href={kind === "privacy" ? "terms.html" : "privacy.html"}>
          {kind === "privacy" ? L(["Terms", "条款"]) : L(["Privacy", "隐私"])}
        </a>{" "}
        · <a href="https://github.com/Pratiikpy/lingxi/issues">{L(["Contact", "联系我们"])}</a>
      </footer>
    </main>
  );
}
