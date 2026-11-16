"""Builds src/data/world.json from the source world data and the room art on disk.

    python gen.py <folder holding the world data CSV files>
"""
import csv, io, json, os, re, sys
SOURCE = sys.argv[1]
ART = os.path.join(os.path.dirname(__file__), "..", "..", "..", "apps", "web", "public", "art")
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "world.json")

def rd(p):
    return list(csv.DictReader(io.StringIO(open(os.path.join(SOURCE, p), encoding="utf-8-sig").read())))

room_dirs = {int(d.split("_")[0]): d for d in os.listdir(os.path.join(ART, "rooms")) if d.split("_")[0].isdigit()}

def backgrounds(idx):
    d = room_dirs.get(idx)
    if not d:
        return None
    files = sorted(os.listdir(os.path.join(ART, "rooms", d, "backgrounds")))
    files = [f for f in files if (f.endswith(".png") or f.endswith(".gif")) and "christmas" not in f and "halloween" not in f and "wick" not in f and "frog" not in f and "-v2" not in f]
    def pick(*keys):
        for k in keys:
            for f in files:
                if re.search(k, f):
                    return f"art/rooms/{d}/backgrounds/{f}"
        return None
    day = pick(r"playtest-a\.png", r"room\d+a1?\.png", r"room\d+a\.png", r"original\.png", r"playtest\.png", r"room\d+\.png", r"room\d+a\.gif", r"room\d+\.gif") or (f"art/rooms/{d}/backgrounds/{files[0]}" if files else None)
    eve = pick(r"playtest-b\.png", r"room\d+b1?\.png", r"room\d+b\.png", r"room\d+b\.gif") or day
    night = pick(r"playtest-c\.png", r"room\d+c1?\.png", r"room\d+c\.png", r"room\d+c\.gif") or eve
    return {"day": day, "evening": eve, "night": night}

drops = {r["Name"]: list(zip([int(x) for x in r["Indices"].split(",")], [int(x) for x in r["Tiers"].split(",")])) for r in rd("rooms/droptables.csv")}
nodes = {int(r["Index"]): r for r in rd("rooms/nodes.csv") if r["Status"] == "In Game"}
items = {int(r["Index"]): r for r in rd("items/items.csv") if r["Status"] == "In Game"}

# art already chosen for the shipped items (files were later given neutral names): kept as it is
try:
    KEPT = {it["index"]: it for it in json.load(open(OUT, encoding="utf-8"))["items"]}
except (OSError, ValueError, KeyError):
    KEPT = {}
KEPT_ART = {i: it["art"] for i, it in KEPT.items()}
# the product never names the source: its own brand words stay out of the shipped names
BRAND = re.compile(r"pet|coin", re.I)

def art_for(name):
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    for ext in (".png", ".webp"):
        if os.path.exists(os.path.join(ART, "items", slug + ext)):
            return f"art/items/{slug}{ext}"
    return None

rooms = []
for r in rd("rooms/rooms.csv"):
    idx = int(r["Index"])
    if r["Status"] != "In Game" or idx == 0:
        continue
    bgs = backgrounds(idx)
    if not bgs or not bgs["day"]:
        continue
    node = nodes.get(idx)
    dl = drops.get(node["Drops"], []) if node else []
    rooms.append({
        "index": idx, "src": r["Name"],
        "x": int(r["X"]), "y": int(r["Y"]), "z": int(r["Z"]),
        "exits": [int(e) for e in r["Exits"].split(",") if e.strip().isdigit()],
        "bgs": bgs,
        "drops": [{"item": i, "weight": w} for i, w in dl if i in items],
        # plan 4.5: the room's affinity and what its familiarity bar costs (the source's scavenge cost)
        "affinity": (node["Affinity"] if node else "") or "",
        "scavCost": int(node["Scav Cost"]) if node and node["Scav Cost"].strip().isdigit() else 0,
    })

used = {d["item"] for rm in rooms for d in rm["drops"]}
foods = [i for i, r in items.items() if r["Type"] == "Food"]
recipes = []
for r in rd("crafting/recipes.csv"):
    if r["Status"] != "In Game":
        continue
    ins = [int(x) for x in r["Input Indices"].split(",") if x.strip()]
    amts = [int(x) for x in r["Input Amounts"].replace(" ", "").split(",") if x.strip()]
    out = int(r["Output Index"])
    if out in items and all(i in items for i in ins):
        recipes.append({
            "index": int(r["Index"]), "src": r["Name"], "out": out, "outAmount": int(r["Output Amount"] or 1),
            "ins": [{"item": i, "amount": a} for i, a in zip(ins, amts)],
            "stamina": int(r["Cost (Stamina)"] or 0),
            # plan 4.5: the source's XP, tool (held, never used up) and room (only 10002, room 11)
            "xp": int(r["XP Output"] or 0),
            "tool": int(r["Tool Index"]) if r["Tool Index"].strip().isdigit() else None,
            "room": int(r["Room Index"]) if r["Room Index"].strip().isdigit() else None,
        })
        if r["Tool Index"].strip().isdigit():
            used.add(int(r["Tool Index"]))
        used.add(out); used.update(ins)
used.update(foods)
# plan 4.5: every item type that can mean something in Lingxi (equipment, the source's own pets and tokens, tickets
# and badges are left out: see BUILD-STATUS 96)
ADOPT = {"Material", "Food", "Potion", "Consumable", "Tool", "Lootbox", "Key Item", "Spell Card"}
# the VIP pass belongs to the source's account system
SKIP = {2}
used.update(i for i, r in items.items() if r["Type"] in ADOPT and i not in SKIP)
item_rows = []
for i in sorted(used):
    r = items[i]
    art = KEPT_ART.get(i) or art_for(r["Name"])
    if not art:
        continue
    name = KEPT[i]["src"] if i in KEPT else ("" if BRAND.search(r["Name"]) else r["Name"])
    item_rows.append({"index": i, "src": name, "type": r["Type"], "rarity": r["Rarity"], "art": art})
have = {it["index"] for it in item_rows}
recipes = [rc for rc in recipes if rc["out"] in have and all(x["item"] in have for x in rc["ins"])]
for rm in rooms:
    rm["drops"] = [d for d in rm["drops"] if d["item"] in have]
# plan 4.5: lootbox tables (the item an allo row names), weights to be made 2^(tier-1) by the game
allos = {r["Name"]: r for r in rd("items/allos.csv")}
tables = {r["Name"]: list(zip([int(x) for x in r["Indices"].split(",")], [int(x) for x in r["Tiers"].replace(" ", "").split(",")])) for r in rd("items/droptables.csv")}
boxes = {}
for i, r in items.items():
    if r["Type"] != "Lootbox" and i != 21007:
        continue
    for eff in [e.strip() for e in r["Effects"].split(",") if e.strip()]:
        a = allos.get(eff)
        if a and a["Type"] == "ITEM_DROPTABLE" and a["Droptable"] in tables:
            boxes[str(i)] = [{"item": x, "tier": t} for x, t in tables[a["Droptable"]] if x in have]
json.dump({"rooms": rooms, "items": item_rows, "recipes": recipes, "boxes": boxes}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(boxes), "boxes:", {k: len(v) for k, v in boxes.items()})
print(len(rooms), "rooms,", len(item_rows), "items,", len(recipes), "recipes")
print("rooms without drops:", [r["index"] for r in rooms if not r["drops"]])
print("z levels:", sorted({r["z"] for r in rooms}))
