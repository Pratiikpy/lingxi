"""Builds src/data/world.json from the source game's world data and the room art on disk."""
import csv, io, json, os, re, sys
PET = r"<the source world data>"
ART = r"<repo>\apps\web\public\pet"
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "world.json")

def rd(p):
    return list(csv.DictReader(io.StringIO(open(os.path.join(PET, p), encoding="utf-8-sig").read())))

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
                    return f"pet/rooms/{d}/backgrounds/{f}"
        return None
    day = pick(r"playtest-a\.png", r"room\d+a1?\.png", r"room\d+a\.png", r"original\.png", r"playtest\.png", r"room\d+\.png", r"room\d+a\.gif", r"room\d+\.gif") or (f"pet/rooms/{d}/backgrounds/{files[0]}" if files else None)
    eve = pick(r"playtest-b\.png", r"room\d+b1?\.png", r"room\d+b\.png", r"room\d+b\.gif") or day
    night = pick(r"playtest-c\.png", r"room\d+c1?\.png", r"room\d+c\.png", r"room\d+c\.gif") or eve
    return {"day": day, "evening": eve, "night": night}

drops = {r["Name"]: list(zip([int(x) for x in r["Indices"].split(",")], [int(x) for x in r["Tiers"].split(",")])) for r in rd("rooms/droptables.csv")}
nodes = {int(r["Index"]): r for r in rd("rooms/nodes.csv") if r["Status"] == "In Game"}
items = {int(r["Index"]): r for r in rd("items/items.csv") if r["Status"] == "In Game"}

def art_for(name):
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    for ext in (".png", ".webp"):
        if os.path.exists(os.path.join(ART, "items", slug + ext)):
            return f"pet/items/{slug}{ext}"
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
        "index": idx, "src": r["Name"], "srcDesc": r["Description"],
        "x": int(r["X"]), "y": int(r["Y"]), "z": int(r["Z"]),
        "exits": [int(e) for e in r["Exits"].split(",") if e.strip().isdigit()],
        "bgs": bgs,
        "drops": [{"item": i, "weight": w} for i, w in dl if i in items],
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
        recipes.append({"index": int(r["Index"]), "src": r["Name"], "out": out, "outAmount": int(r["Output Amount"] or 1), "ins": [{"item": i, "amount": a} for i, a in zip(ins, amts)], "stamina": int(r["Cost (Stamina)"] or 0)})
        used.add(out); used.update(ins)
used.update(foods)
item_rows = []
for i in sorted(used):
    r = items[i]
    art = art_for(r["Name"])
    if not art:
        continue
    item_rows.append({"index": i, "src": r["Name"], "type": r["Type"], "rarity": r["Rarity"], "srcDesc": r["Description"], "art": art})
have = {it["index"] for it in item_rows}
recipes = [rc for rc in recipes if rc["out"] in have and all(x["item"] in have for x in rc["ins"])]
for rm in rooms:
    rm["drops"] = [d for d in rm["drops"] if d["item"] in have]
json.dump({"rooms": rooms, "items": item_rows, "recipes": recipes}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(rooms), "rooms,", len(item_rows), "items,", len(recipes), "recipes")
print("rooms without drops:", [r["index"] for r in rooms if not r["drops"]])
print("z levels:", sorted({r["z"] for r in rooms}))
