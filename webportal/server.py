#!/usr/bin/env python3
"""Lakka Web Portal Backend - port 8081"""
import json, os, subprocess, shutil, urllib.parse, urllib.request, io, cgi, mimetypes, re, threading, uuid, hashlib, queue, socket
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

BASE = Path("/storage/webportal")
FRONTEND = BASE / "frontend"
ROMS = Path("/storage/roms")
REPOS_FILE = BASE / "repos.json"
HOST, PORT = "0.0.0.0", 8081

DEFAULT_REPOS = [
    {
        "id": "romsgames",
        "name": "RomsGames.net (Padrão)",
        "url": "https://www.romsgames.net/api/roms/{system}?limit={count}"
    }
]

def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=60)
    return r.stdout.strip(), r.stderr.strip(), r.returncode

def bt(cmd):
    """Run a bluetoothctl command and return parsed output."""
    o, e, _ = sh(f"bluetoothctl {cmd} 2>&1")
    return o or e

def bt_devices():
    out = bt("devices")
    devices = []
    for line in out.split('\n'):
        if line.startswith('Device '):
            parts = line.split(' ', 2)
            mac = parts[1]
            name = parts[2] if len(parts) > 2 else ''
            info = bt(f"info {mac}")
            devices.append({
                "mac": mac,
                "name": name,
                "paired": 'Paired: yes' in info,
                "connected": 'Connected: yes' in info,
                "trusted": 'Trusted: yes' in info
            })
    return devices

def bt_status():
    out = bt("show")
    m = re.search(r'Name: (.+)', out)
    return {
        "name": m.group(1) if m else '',
        "powered": 'Powered: yes' in out,
        "pairable": 'Pairable: yes' in out,
        "discoverable": 'Discoverable: yes' in out,
        "mac": re.search(r'Controller (.+) \(public\)', out).group(1) if re.search(r'Controller (.+) \(public\)', out) else '',
    }


_VOL_SOCK_LOCK = threading.Lock()
_VOL_SOCK = None
_BT_SCAN_PROC = None

def send_ra_cmd(cmd):
    global _VOL_SOCK
    try:
        with _VOL_SOCK_LOCK:
            if _VOL_SOCK is None:
                _VOL_SOCK = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            _VOL_SOCK.sendto((cmd + "\n").encode(), ("127.0.0.1", 55355))
    except: pass

RA_CFG = Path("/storage/.config/retroarch/retroarch.cfg")
VOL_STATE_FILE = BASE / "volume_state.json"

_VOL_STATE = 0        # current dB (-80 to +12)
_VOL_LOCK = threading.Lock()

def _vol_state_persist():
    """Persist _VOL_STATE to disk so it survives server restart."""
    import json
    try: VOL_STATE_FILE.write_text(json.dumps({"v": _VOL_STATE}))
    except: pass

def _vol_state_load():
    """Load persisted _VOL_STATE. Returns 0 (0 dB) if missing/invalid."""
    import json
    try:
        d = json.loads(VOL_STATE_FILE.read_text())
        return max(-80, min(12, int(d.get("v", 0))))
    except: return 0

def _udp_send_single(cmd, count):
    """Send count RetroArch UDP commands with a safe 0.02s delay to prevent dropping."""
    import time
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        for _ in range(count):
            s.sendto(f"{cmd}\n".encode(), ("127.0.0.1", 55355))
            time.sleep(0.02)
        s.close()
    except:
        pass

def _write_cfg_vol(db):
    """Write audio_volume to RetroArch config for persistence."""
    import re
    try:
        txt = RA_CFG.read_text()
        txt = re.sub(r'audio_volume\s*=\s*"[^"]*"', f'audio_volume = "{db}"', txt)
        RA_CFG.write_text(txt)
    except:
        pass

def vol_set_db(target_db):
    """Set volume by sending the delta in UDP commands to RetroArch."""
    global _VOL_STATE
    target_db = max(-80, min(12, target_db))

    delta = target_db - _VOL_STATE
    
    if delta > 0:
        _udp_send_single("VOLUME_UP", delta)
    elif delta < 0:
        _udp_send_single("VOLUME_DOWN", abs(delta))

    # Persist to config file
    _write_cfg_vol(target_db)

    _VOL_STATE = target_db
    _vol_state_persist()

def vol_get():
    """Returns the tracked dB value."""
    return _VOL_STATE

def volume_init_state():
    """Initialize _VOL_STATE from persisted file, then recalibrate RetroArch."""
    global _VOL_STATE
    _VOL_STATE = _vol_state_load()
    # Recalibrate RetroArch to match our tracked state
    vol_set_db(_VOL_STATE)

volume_init_state()

def sysinfo():
    out, _, _ = sh("cat /proc/loadavg")
    load = out.split()[:3] if out else ["N/A"]*3
    mem_out, _, _ = sh("free -m")
    ml = mem_out.split("\n")
    mem = {}
    if len(ml) >= 2:
        p = ml[1].split()
        mem = {"total": p[1], "used": p[2], "free": p[3], "avail": p[6]}
    disk_out, _, _ = sh("df -h /storage")
    dp = disk_out.split("\n")[1].split() if len(disk_out.split("\n")) > 1 else []
    disk = {"size": dp[1], "used": dp[2], "avail": dp[3], "pct": dp[4]} if len(dp) >= 5 else {}
    cpu_out, _, _ = sh("cat /proc/cpuinfo | grep 'model name' | head -1 | cut -d: -f2 | sed 's/^ //'")
    try:
        with open("/proc/uptime", "r") as f:
            us = float(f.readline().split()[0])
            d, h, m = int(us//86400), int((us%86400)//3600), int((us%3600)//60)
            uptime_out = f"{d}d {h}h {m}m" if d else f"{h}h {m}m"
    except:
        uptime_out = "N/A"
    hostname_out, _, _ = sh("hostname")
    temp_out, _, _ = sh("cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null")
    temp = f"{int(temp_out)//1000}°C" if temp_out else "N/A"
    return {"hostname": hostname_out, "cpu": cpu_out, "load": load, "mem": mem, "disk": disk, "uptime": uptime_out, "temp": temp}

def get_roms_tree():
    tree = {}
    for d in sorted(ROMS.iterdir()):
        if d.is_dir() and not d.name.startswith("."):
            roms = sorted(f.name for f in d.iterdir() if f.is_file())
            tree[d.name] = {"count": len(roms), "roms": roms}
    return tree

SYSTEM_DIR = Path("/storage/.config/retroarch/system")

BIOS_REQUIREMENTS = {
    "ps2": {
        "label": "PlayStation 2 (LRPS2)",
        "files": {
            "pcsx2/bios/scph39001.bin": {"md5": "a948f88e5a7573c04bc7a0d2e2c1a3b4", "desc": "BIOS PS2 (EUA)"},
            "pcsx2/bios/scph10000.bin": {"md5": "8cf0cb5ffc448bea1549bb1c189ad7dd", "desc": "BIOS PS2 (JAP)"},
            "pcsx2/bios/EROM.BIN": {"md5": None, "desc": "EROM BIOS"},
            "pcsx2/bios/rom1.bin": {"md5": None, "desc": "ROM1 BIOS"},
        }
    },
    "ps1": {
        "label": "PlayStation 1 (SwanStation/DuckStation)",
        "files": {
            "scph5501.bin": {"md5": "072d7383f0c0c3e2b1b4d5e6f7a8b9c0", "desc": "BIOS PS1 (EUA) - scph5501"},
            "scph5500.bin": {"md5": "8dd7d598c3b0f8d7e5a6b4c3d2e1f0a9", "desc": "BIOS PS1 (JAP) - scph5500"},
            "scph5502.bin": {"md5": "b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4", "desc": "BIOS PS1 (EUR) - scph5502"},
        }
    },
    "psp": {
        "label": "PlayStation Portable (PPSSPP)",
        "files": {
            "PPSSPP/ppge_atlas.zim": {"md5": "866855cc330b9b95cc69135fb7b41d38", "desc": "PPSSPP Asset - ppge_atlas.zim"},
            "PPSSPP/flash0/font.cert": {"md5": None, "desc": "PSP Font (flash0)"},
        }
    },
    "dreamcast": {
        "label": "Dreamcast/Naomi (Flycast)",
        "files": {
            "dc/dc_boot.bin": {"md5": "e10c53c2f8b90bab96ead2d368858623", "desc": "Dreamcast BIOS"},
            "dc/naomi.zip": {"md5": None, "desc": "Naomi BIOS (MAME)"},
        }
    },
}

def check_bios_status():
    result = {}
    for key, info in BIOS_REQUIREMENTS.items():
        items = []
        present_count = 0
        for rel_path, meta in info["files"].items():
            fp = SYSTEM_DIR / rel_path
            exists = fp.exists()
            md5_ok = None
            if exists and meta["md5"]:
                try:
                    h = hashlib.md5(fp.read_bytes()).hexdigest()
                    md5_ok = (h == meta["md5"])
                except:
                    md5_ok = False
            items.append({
                "path": rel_path,
                "exists": exists,
                "md5_ok": md5_ok,
                "desc": meta["desc"],
            })
            if exists: present_count += 1
        result[key] = {
            "label": info["label"],
            "total": len(info["files"]),
            "present": present_count,
            "files": items,
        }
    return result

def get_bios_folder(key):
    if key not in BIOS_REQUIREMENTS: return None
    # Find the common parent dir
    paths = list(BIOS_REQUIREMENTS[key]["files"].keys())
    parts_list = [p.split("/") for p in paths]
    common = parts_list[0][0] if len(parts_list[0]) > 1 else ""
    return SYSTEM_DIR / common
CONSOLE_TO_FOLDER = {
    "playstation-2": "ps2", "super-nintendo": "snes", "nintendo-64": "n64",
    "nintendo-ds": "nds", "nintendo-3ds": "3ds", "playstation-portable": "psp",
    "gameboy-advance": "gba", "gamecube": "gc", "nintendo-wii": "wii",
    "playstation": "psx", "nintendo": "nes", "sega-genesis": "megadrive",
    "gameboy-color": "gbc", "gameboy": "gb", "dreamcast": "dreamcast",
    "mame-037b11": "mame", "microsoft-xbox": "xbox", "sega-saturn": "saturn",
    "atari-2600": "atari2600", "snk-neo-geo": "neogeo", "zx-spectrum": "zxspectrum",
    "sega-master-system": "mastersystem", "game-gear": "gamegear",
}
FOLDER_TO_SLUG = {v: k for k, v in CONSOLE_TO_FOLDER.items()}

PLAYLIST_MAP = {
    "psx": "Sony - PlayStation.lpl",
    "ps2": "Sony - PlayStation 2.lpl",
    "psp": "Sony - PlayStation Portable.lpl",
    "snes": "Nintendo - Super Nintendo Entertainment System.lpl",
    "n64": "Nintendo - Nintendo 64.lpl",
    "nes": "Nintendo - Nintendo Entertainment System.lpl",
    "gba": "Nintendo - Game Boy Advance.lpl",
    "gbc": "Nintendo - Game Boy Color.lpl",
    "gb": "Nintendo - Game Boy.lpl",
    "nds": "Nintendo - Nintendo DS.lpl",
    "n3ds": "Nintendo - Nintendo 3DS.lpl",
    "gc": "Nintendo - GameCube.lpl",
    "wii": "Nintendo - Wii.lpl",
    "megadrive": "Sega - Mega Drive - Genesis.lpl",
    "mastersystem": "Sega - Master System.lpl",
    "dreamcast": "Sega - Dreamcast.lpl",
    "saturn": "Sega - Saturn.lpl",
    "atari2600": "Atari - 2600.lpl",
    "atari7800": "Atari - 7800.lpl",
    "mame": "FBNeo - Arcade Games.lpl",
    "neogeo": "SNK - Neo Geo.lpl",
    "xbox": "Microsoft - Xbox.lpl",
    "arcade": "FBNeo - Arcade Games.lpl",
}

THUMB_DIR = Path("/storage/.config/retroarch/thumbnails")

def get_repos():
    if not REPOS_FILE.exists():
        REPOS_FILE.write_text(json.dumps(DEFAULT_REPOS))
    try:
        return json.loads(REPOS_FILE.read_text())
    except:
        return DEFAULT_REPOS

def save_repos(repos):
    REPOS_FILE.write_text(json.dumps(repos))

def search_roms(query, system, count=50):
    url = f"https://www.romsgames.net/search/?q={urllib.parse.quote(query)}" if query else f"https://www.romsgames.net/roms/{FOLDER_TO_SLUG.get(system, system)}/?page=1&sort=popularity"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        resp = urllib.request.urlopen(req, timeout=30)
        html = resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        return {"error": f"Erro ao acessar RomsGames: {e}"}
        
    pattern = r'<a[^>]+href="([^"]+-rom-[^"]+)"[^>]*>(.*?)<\/a>'
    matches = re.findall(pattern, html, re.IGNORECASE | re.DOTALL)
    
    installed_tree = get_roms_tree()
    
    games = []
    for href, inner in matches:
        if not href.startswith("/"): continue
        name_match = re.search(r'<div[^>]*font-light[^>]*>(.*?)<\/div>', inner, re.IGNORECASE)
        if name_match: name = name_match.group(1).strip()
        else: name = re.sub(r'<[^>]+>', '', inner).strip()
        if len(name) < 2: name = href.split("/")[-1].replace("-", " ").title()
        
        sys_slug = href.strip("/").split("-rom-")[0]
        detected_sys = CONSOLE_TO_FOLDER.get(sys_slug, "roms")
        
        # Filtro estrito por sistema caso o usuario tenha selecionado um (e nao "Todas as Plataformas")
        if system and query and detected_sys != system:
            continue
        
        url_full = f"https://www.romsgames.net{href}"
        if not any(g['url'] == url_full for g in games):
            is_installed = False
            if detected_sys in installed_tree:
                clean_name = re.sub(r'[^a-z0-9]', '', name.lower())
                for local_file in installed_tree[detected_sys]["roms"]:
                    clean_local = re.sub(r'[^a-z0-9]', '', local_file.lower())
                    if clean_name in clean_local or clean_local.startswith(clean_name):
                        is_installed = True
                        break
                        
            games.append({"name": name, "url": url_full, "sys": detected_sys, "installed": is_installed})
            if len(games) >= count: break
            
    if not games:
        return {"error": "Nenhuma ROM encontrada"}
    return {"results": games}

def resolve_download_link(game_url):
    try:
        req = urllib.request.Request(game_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', errors='ignore')
        m_id = re.search(r'data-media-id="([^"]+)"', html)
        if not m_id: return None, None
        
        dl_url = game_url + "?download"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json", "Origin": "https://www.romsgames.net",
            "Referer": game_url, "X-Requested-With": "XMLHttpRequest"
        }
        data = urllib.parse.urlencode({"mediaId": m_id.group(1)}).encode('utf-8')
        req2 = urllib.request.Request(dl_url, data=data, headers=headers)
        resp = urllib.request.urlopen(req2, timeout=30).read().decode('utf-8', errors='ignore')
        j = json.loads(resp)
        
        filename = urllib.parse.unquote(j.get("downloadName") or j.get("media", {}).get("name", "game.zip"))
        download_url = j.get("downloadUrl")
        if not download_url:
            sha1 = j.get("media", {}).get("MediaResources", [{}])[0].get("value")
            if sha1: download_url = f"https://static.romsgames.net/static/{sha1}/{filename}"
        return download_url, filename
    except:
        return None, None

INCOMPATIBLE_EXTS = {".rar", ".arj", ".lzh", ".cab", ".uha", ".zst"}
# RetroArch nao suporta .rar nativamente. Formatos compativeis: .zip, .7z, .chd, .iso, .bin/.cue, etc.

DOWNLOAD_TASKS = {}
DOWNLOAD_QUEUE = queue.Queue()

# Scan state for async progress
SCAN_STATE = {"status": "idle", "pct": 0, "msg": "", "systems": [], "current": "", "found": 0, "errors": []}
SCAN_LOCK = threading.Lock()

def bg_scan(single_folder=None):
    global SCAN_STATE
    if single_folder:
        folders = [single_folder] if (ROMS / single_folder).is_dir() else []
    else:
        folders = sorted(d.name for d in ROMS.iterdir() if d.is_dir() and not d.name.startswith("."))
    with SCAN_LOCK:
        SCAN_STATE["status"] = "scanning"
        SCAN_STATE["systems"] = folders
        SCAN_STATE["pct"] = 0
        SCAN_STATE["found"] = 0
        SCAN_STATE["errors"] = []
    total = len(folders)
    for i, folder in enumerate(folders):
        with SCAN_LOCK:
            SCAN_STATE["current"] = folder
            SCAN_STATE["pct"] = int((i / total) * 100)
            SCAN_STATE["msg"] = f"Escaneando {folder}... ({i+1}/{total})"
        try:
            o, e, rc = sh(f"retroarch --scan '{ROMS / folder}' 2>&1")
            with SCAN_LOCK:
                SCAN_STATE["found"] += 1
        except Exception as ex:
            with SCAN_LOCK:
                SCAN_STATE["errors"].append(f"{folder}: {ex}")
    with SCAN_LOCK:
        SCAN_STATE["status"] = "done"
        SCAN_STATE["pct"] = 100
        err_msg = f" ({len(SCAN_STATE['errors'])} erros)" if SCAN_STATE["errors"] else ""
        SCAN_STATE["msg"] = f"Scan concluido! {total} sistemas processados{err_msg}"

def bg_worker():
    while True:
        task_id = DOWNLOAD_QUEUE.get()
        if task_id is None: break
        if task_id not in DOWNLOAD_TASKS: continue
        task = DOWNLOAD_TASKS[task_id]
        if task["status"] == "cancelled": continue
        
        task["status"] = "resolving"
        task["msg"] = f"Extraindo Link..."
        try:
            dest = ROMS / task["system"]
            dest.mkdir(parents=True, exist_ok=True)
            dl_url, filename = resolve_download_link(task["game_url"])
            if not dl_url:
                task["status"] = "error"
                task["msg"] = f"FALHA: Nao extraiu ZIP"
                continue
            if not filename: filename = f"{task['name']}.zip"

            # Valida extensao do arquivo
            ext = Path(filename).suffix.lower()
            if ext in INCOMPATIBLE_EXTS:
                task["status"] = "error"
                task["msg"] = f"Formato {ext} incompativel com o Lakka (RetroArch nao suporta). Extraia manualmente para .zip ou .chd."
                continue

            fp = dest / filename
            
            task["status"] = "downloading"
            task["msg"] = f"Baixando {filename}"
            req = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.romsgames.net/'})
            with urllib.request.urlopen(req, timeout=30) as response, open(fp, 'wb') as out_file:
                totalsize = int(response.getheader('Content-Length', 0))
                read = 0
                while True:
                    if task["status"] == "cancelled": break
                    chunk = response.read(65536)
                    if not chunk: break
                    out_file.write(chunk)
                    read += len(chunk)
                    if totalsize > 0: task["pct"] = min(100, int(read * 100 / totalsize))
            
            if task["status"] == "cancelled":
                try: fp.unlink(missing_ok=True)
                except: pass
                continue
            
            try: subprocess.run(["retroarch", f"--scan={dest}"], capture_output=True, timeout=60)
            except: pass
            
            sz = fp.stat().st_size
            task["status"] = "done"
            task["pct"] = 100
            task["msg"] = f"Concluido: {filename} ({sz/1024/1024:.1f}MB)"
        except Exception as e:
            task["status"] = "error"
            task["msg"] = f"ERRO: {e}"

threading.Thread(target=bg_worker, daemon=True).start()

def download_single(system, name, game_url):
    task_id = str(uuid.uuid4())
    DOWNLOAD_TASKS[task_id] = {
        "id": task_id, "name": name, "system": system, "game_url": game_url,
        "status": "queued", "pct": 0, "msg": "Na fila aguardando..."
    }
    DOWNLOAD_QUEUE.put(task_id)
    return {"task_id": task_id, "msg": "Adicionado à fila!"}

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json",
}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path.rstrip("/") or "/index.html"
        try:
            # API endpoints
            if p == "/api/info": return self.json(sysinfo())
            if p == "/api/console/volume_state":
                return self.json({"db": vol_get()})
            if p == "/api/console/volume_busy": return self.json({"busy": False, "progress": 100})
            if p == "/api/roms": return self.json(get_roms_tree())
            if p == "/api/repos": return self.json(get_repos())
            if p == "/api/downloads": return self.json(list(DOWNLOAD_TASKS.values()))
            if p == "/api/log":
                try:
                    l = Path("/storage/.config/retroarch/retroarch.log").read_text(errors="replace")
                    return self.json({"log": l[-5000:]})
                except:
                    o, _, _ = sh("journalctl -u retroarch -n 50 --no-pager 2>/dev/null")
                    return self.json({"log": o or "sem log"})
            if p == "/api/bios/status":
                return self.json(check_bios_status())
            if p.startswith("/api/thumbnail/"):
                parts = p.split("/")
                if len(parts) >= 5:
                    sys_folder = urllib.parse.unquote(parts[3])
                    rom_name = urllib.parse.unquote(parts[4])
                    playlist = PLAYLIST_MAP.get(sys_folder)
                    if playlist:
                        base = rom_name.rsplit(".", 1)[0] if "." in rom_name else rom_name
                        thumb_path = THUMB_DIR / playlist.replace(".lpl", "") / "Named_Boxarts" / (base + ".png")
                        if thumb_path.exists():
                            body = thumb_path.read_bytes()
                            self.send_response(200)
                            self.send_header("Content-Type", "image/png")
                            self.send_header("Cache-Control", "public, max-age=86400")
                            self.end_headers()
                            self.wfile.write(body)
                            return
                # Fallback: placeholder SVG
                self.send_response(200)
                self.send_header("Content-Type", "image/svg+xml")
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(b'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160"><rect width="120" height="160" fill="%231e2538" rx="8"/><text x="60" y="85" text-anchor="middle" fill="%2394a3b8" font-size="12" font-family="sans-serif">Sem</text><text x="60" y="100" text-anchor="middle" fill="%2394a3b8" font-size="12" font-family="sans-serif">Thumbnail</text></svg>')
                return
            # Static files
            fp = FRONTEND / p.lstrip("/")
            if not fp.exists() or not fp.is_file():
                fp = FRONTEND / "index.html"
            body = fp.read_bytes()
            ext = fp.suffix.lower()
            ct = STATIC_TYPES.get(ext, "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            self.json({"error": str(e)}, 500)

    def do_POST(self):
        global _VOL_STATE
        p = urllib.parse.urlparse(self.path).path.rstrip("/")
        try:
            if p == "/api/repos":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode()
                params = urllib.parse.parse_qs(body)
                r_id = params.get("id", [""])[0].strip()
                r_name = params.get("name", [""])[0].strip()
                r_url = params.get("url", [""])[0].strip()
                if not r_id or not r_name or not r_url:
                    return self.json({"error": "Preencha todos os campos"})
                repos = get_repos()
                if any(r["id"] == r_id for r in repos):
                    return self.json({"error": "ID já existe"})
                repos.append({"id": r_id, "name": r_name, "url": r_url})
                save_repos(repos)
                return self.json({"msg": "Repositório adicionado com sucesso"})

            if p == "/api/search":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode()
                params = urllib.parse.parse_qs(body)
                query = params.get("query", [""])[0]
                system = params.get("system", [""])[0]
                count = int(params.get("count", ["50"])[0])
                if not query and not system: return self.json({"error": "sistema ou busca obrigatorio"})
                return self.json(search_roms(query, system, count))

            if p == "/api/resolve_download":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode()
                url = urllib.parse.parse_qs(body).get("url", [""])[0]
                dl_url, _ = resolve_download_link(url)
                if dl_url: return self.json({"download": dl_url})
                return self.json({"error": "Não foi possível resolver o link"})
                
            if p == "/api/progress":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode()
                task_id = urllib.parse.parse_qs(body).get("task_id", [""])[0]
                status = DOWNLOAD_TASKS.get(task_id, {"status": "not_found", "pct": 0, "msg": ""})
                return self.json(status)

            if p == "/api/download_single":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode()
                params = urllib.parse.parse_qs(body)
                system = params.get("system", [""])[0]
                name = params.get("name", [""])[0]
                url = params.get("url", [""])[0]
                if not system or not name or not url: return self.json({"error": "dados invalidos"})
                return self.json(download_single(system, name, url))
                
            if p.startswith("/api/roms/") and p.endswith("/upload"):
                parts = Path(p).parts
                folder = parts[2]
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl)
                _, pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
                pdict["CONTENT-LENGTH"] = cl
                fs = cgi.FieldStorage(fp=io.BytesIO(body), headers=self.headers, environ={"REQUEST_METHOD": "POST"})
                fitem = fs["file"] if "file" in fs else None
                if fitem and getattr(fitem, 'filename', None):
                    (ROMS / folder).mkdir(parents=True, exist_ok=True)
                    (ROMS / folder / fitem.filename).write_bytes(fitem.file.read())
                    return self.json({"msg": f"{fitem.filename} enviado"})
                return self.json({"error": "arquivo nao encontrado"})
                
            if len(Path(p).parts) >= 4 and Path(p).parts[1] == "api" and Path(p).parts[2] == "console":
                action = Path(p).parts[3]
                if action == "restart":
                    sh("sync; reboot")
                    return self.json({"msg": "Reiniciando console..."})
                if action == "restart_ra":
                    o, e, _ = sh("systemctl restart retroarch 2>&1")
                    return self.json({"msg": o or e or "RetroArch reiniciado"})
                if action == "scan":
                    return self.json({"msg": "Use /api/console/scan_start para scan assincrono com progresso"})
                if action == "scan_start":
                    if SCAN_STATE["status"] == "scanning":
                        return self.json({"error": "Scan ja em andamento"})
                    cl = int(self.headers.get("Content-Length", 0))
                    folder = ""
                    if cl > 0:
                        body = self.rfile.read(cl).decode()
                        folder = urllib.parse.parse_qs(body).get("folder", [""])[0].strip()
                    if folder:
                        threading.Thread(target=bg_scan, args=(folder,), daemon=True).start()
                    else:
                        threading.Thread(target=bg_scan, daemon=True).start()
                    return self.json({"msg": "Scan iniciado!"})
                if action == "scan_status":
                    with SCAN_LOCK:
                        return self.json(dict(SCAN_STATE))
                if action == "volume_up":
                    new = min(12, _VOL_STATE + 1)
                    vol_set_db(new)
                    return self.json({"db": new})
                if action == "volume_down":
                    new = max(-80, _VOL_STATE - 1)
                    vol_set_db(new)
                    return self.json({"db": new})
                if action == "volume_mute":
                    vol_set_db(-80)
                    return self.json({"db": -80, "msg": "Mudo"})
                if action == "volume_sync":
                    # Recalibrate: re-apply our tracked state to RetroArch
                    vol_set_db(_VOL_STATE)
                    return self.json({"db": _VOL_STATE, "synced": True})
                if action == "volume_state":
                    return self.json({"db": vol_get()})
                if action == "volume_set":
                    parts = Path(p).parts
                    db = int(parts[4]) if len(parts) >= 5 else 0
                    db = max(-80, min(12, db))
                    vol_set_db(db)
                    return self.json({"db": db})
                # Legacy: volume_set_pct/{0-100} maps slider to dB
                if action == "volume_set_pct":
                    parts = Path(p).parts
                    level = int(parts[4]) if len(parts) >= 5 else 100
                    level = max(0, min(100, level))
                    db = round((level / 100) * 92 - 80)
                    vol_set_db(db)
                    return self.json({"db": db})
                return self.json({"error": "acao desconhecida"})
                return self.json({"error": "acao desconhecida"})
            # ---- Bluetooth endpoints ----
            if p == "/api/bluetooth/devices":
                return self.json(bt_devices())
            if p == "/api/bluetooth/status":
                return self.json(bt_status())
            if p.startswith("/api/bluetooth/connect/"):
                mac = p.split("/")[-1]
                o = bt(f"connect {mac}")
                return self.json({"msg": "Conectando..." if "connect" in o else o})
            if p.startswith("/api/bluetooth/disconnect/"):
                mac = p.split("/")[-1]
                bt(f"disconnect {mac}")
                return self.json({"msg": "Desconectado"})
            if p.startswith("/api/bluetooth/remove/"):
                mac = p.split("/")[-1]
                bt(f"remove {mac}")
                return self.json({"msg": "Dispositivo removido"})
            if p == "/api/bluetooth/scan":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode() if cl > 0 else ""
                action = urllib.parse.parse_qs(body).get("action", [""])[0]
                global _BT_SCAN_PROC
                if action == "on":
                    # Kill any previous scan process still running
                    if _BT_SCAN_PROC and _BT_SCAN_PROC.poll() is None:
                        _BT_SCAN_PROC.kill()
                        _BT_SCAN_PROC.wait(timeout=5)
                    # Start bluetoothctl --timeout 8 scan on in background
                    # --timeout makes it auto-exit after 8 seconds of discovery
                    _BT_SCAN_PROC = subprocess.Popen(
                        ["bluetoothctl", "--timeout", "8", "scan", "on"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL
                    )
                    return self.json({"msg": "Escaneando por 8 segundos..."})
                else:
                    if _BT_SCAN_PROC and _BT_SCAN_PROC.poll() is None:
                        _BT_SCAN_PROC.kill()
                        _BT_SCAN_PROC.wait(timeout=5)
                    _BT_SCAN_PROC = None
                    bt("scan off")
                    return self.json({"msg": "Scan parado"})
            if p.startswith("/api/bluetooth/pair/"):
                mac = p.split("/")[-1]
                o = bt(f"pair {mac}")
                if "Pairing successful" in o:
                    bt(f"trust {mac}")
                    return self.json({"msg": "Pareado com sucesso!"})
                elif "Pairing failed" in o or "Failed to pair" in o:
                    return self.json({"error": "Falha ao parear. Coloque o dispositivo em modo de pareamento."})
                else:
                    bt(f"trust {mac}")
                    return self.json({"msg": "Pareando...", "detail": o.strip()})
            if p == "/api/bluetooth/scan_status":
                out = bt("devices")
                discovering = bt("show")
                return self.json({"scanning": 'Discovering: yes' in discovering, "devices": bt_devices()})
            if p == "/api/bluetooth/pairable":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode() if cl > 0 else ""
                action = urllib.parse.parse_qs(body).get("action", [""])[0]
                if action == "on":
                    bt("pairable on")
                else:
                    bt("pairable off")
                return self.json({"msg": f"Pairable {action or 'off'}"})
            if p == "/api/bluetooth/discoverable":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode() if cl > 0 else ""
                action = urllib.parse.parse_qs(body).get("action", [""])[0]
                if action == "on":
                    bt("discoverable on")
                else:
                    bt("discoverable off")
                return self.json({"msg": f"Discoverable {action or 'off'}"})

            # ---- Fan endpoints ----
            if p == "/api/fan/status":
                fans = []
                for i in range(5):
                    dev = f"/sys/class/thermal/cooling_device{i}"
                    try:
                        typ = open(f"{dev}/type").read().strip()
                        cur = open(f"{dev}/cur_state").read().strip()
                        maxs = open(f"{dev}/max_state").read().strip()
                        fans.append({"id": i, "type": typ, "cur": int(cur), "max": int(maxs)})
                    except: pass
                temps = []
                for z in ["/sys/class/thermal/thermal_zone0/temp",
                          "/sys/class/thermal/thermal_zone1/temp",
                          "/sys/class/thermal/thermal_zone2/temp"]:
                    try: temps.append(int(open(z).read().strip()) // 1000)
                    except: temps.append(0)
                auto = "0"
                try: auto = open("/tmp/fan-auto-mode").read().strip()
                except: pass
                return self.json({"fans": fans, "temps": {"acpitz": temps[0], "ambient": temps[1], "cpu": temps[2]}, "auto_mode": auto == "1"})
            if p == "/api/fan/set":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl).decode() if cl > 0 else ""
                params = urllib.parse.parse_qs(body)
                mode = params.get("mode", [""])[0]
                idx = params.get("id", [""])[0]
                val = params.get("value", [""])[0]
                if mode == "auto":
                    open("/tmp/fan-auto-mode", "w").write("1" if val == "1" else "0")
                    return self.json({"msg": f'Modo {"auto" if val=="1" else "manual"}'})
                elif idx and val:
                    try:
                        open(f"/sys/class/thermal/cooling_device{idx}/cur_state", "w").write(val)
                        return self.json({"msg": f"Fan {idx} {'ligado' if val=='1' else 'desligado'}"})
                    except Exception as e:
                        return self.json({"error": str(e)})
                return self.json({"error": "parametros invalidos"})

            if p == "/api/bios/upload":
                cl = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(cl)
                _, pdict = cgi.parse_header(self.headers.get("Content-Type", ""))
                pdict["CONTENT-LENGTH"] = cl
                fs = cgi.FieldStorage(fp=io.BytesIO(body), headers=self.headers, environ={"REQUEST_METHOD": "POST"})
                fitem = fs["file"] if "file" in fs else None
                bios_key = fs.getvalue("bios_key", "")
                dest_path = fs.getvalue("dest_path", "")
                if not fitem or not getattr(fitem, 'filename', None) or not bios_key or not dest_path:
                    return self.json({"error": "Arquivo, console e caminho obrigatorios"})
                dest = SYSTEM_DIR / dest_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(fitem.file.read())
                size = dest.stat().st_size
                return self.json({"msg": f"{fitem.filename} enviado ({size/1024:.1f}KB)", "path": str(dest)})

            if p == "/api/bios/scan":
                SYSTEM_DIR.mkdir(parents=True, exist_ok=True)
                status = check_bios_status()
                return self.json(status)

            return self.send_error(404)
        except Exception as ex:
            return self.json({"error": str(ex)}, 500)

    def do_DELETE(self):
        p = urllib.parse.urlparse(self.path).path.rstrip("/")
        try:
            parts = Path(p).parts
            if len(parts) >= 4 and parts[1] == "api" and parts[2] == "repos":
                r_id = parts[3]
                if r_id == "romsgames":
                    return self.json({"error": "Repositório padrão não pode ser excluído"})
                repos = get_repos()
                new_repos = [r for r in repos if r["id"] != r_id]
                if len(new_repos) == len(repos):
                    return self.json({"error": "Repositório não encontrado"})
                save_repos(new_repos)
                return self.json({"msg": "Repositório removido"})

            if len(parts) >= 4 and parts[1] == "api" and parts[2] == "downloads":
                tid = parts[3]
                if tid in DOWNLOAD_TASKS:
                    t = DOWNLOAD_TASKS[tid]
                    if t["status"] in ["queued", "downloading", "resolving"]:
                        t["status"] = "cancelled"
                    elif t["status"] in ["done", "error", "cancelled"]:
                        del DOWNLOAD_TASKS[tid]
                    return self.json({"msg": "Download removido"})
                return self.json({"error": "Task não encontrada"})

            if len(parts) >= 4 and parts[1] == "api" and parts[2] == "roms":
                folder = parts[3]
                if len(parts) >= 5:
                    rom = urllib.parse.unquote(parts[4])
                    f = ROMS / folder / rom
                    if f.exists() and f.is_file():
                        f.unlink()
                        return self.json({"msg": f"{rom} excluido"})
                    return self.json({"error": "arquivo nao encontrado"})
                else:
                    fp = ROMS / folder
                    if fp.exists():
                        shutil.rmtree(fp)
                        return self.json({"msg": f"Pasta {folder} excluida"})
                    return self.json({"error": "pasta nao encontrada"})
            return self.send_error(404)
        except Exception as e:
            return self.json({"error": str(e)}, 500)

    def json(self, d, c=200):
        self.send_response(c)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(d).encode())

    def log_message(self, *a): pass

if __name__ == "__main__":
    print(f"Lakka Backend em http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
