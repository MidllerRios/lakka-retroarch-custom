import os
import subprocess

LAKKA_IP = "192.168.15.252"
LAKKA_USER = "root"
LAKKA_PASS = "root"

# Caminho de onde o backup local se encontra
BACKUP_DIR = r"C:\projetos\lakka\backup_lakka"

FOLDERS_TO_TRANSFER = [
    {"local": "bios", "remote": "/storage/system"},
    {"local": "roms", "remote": "/storage/roms"}
]

def transfer_local_backup():
    print("=== Iniciando transferencia do Backup Local para o Lakka ===")
    
    if not os.path.exists(BACKUP_DIR):
        print(f"[!] Erro: A pasta de backup não foi encontrada em: {BACKUP_DIR}")
        return

    for item in FOLDERS_TO_TRANSFER:
        local_folder_path = os.path.join(BACKUP_DIR, item["local"])
        remote_folder_path = item["remote"]
        
        print(f"\n[>] Processando pasta: {item['local'].upper()}")
        
        if not os.path.exists(local_folder_path):
            print(f"    - Pasta local '{local_folder_path}' não encontrada. Pulando...")
            continue
            
        print(f"    - Enviando arquivos da pasta '{item['local']}' para '{remote_folder_path}'...")
        
        # Garante que o diretorio remoto existe
        subprocess.run(["plink", "-ssh", "-batch", "-l", LAKKA_USER, "-pw", LAKKA_PASS, LAKKA_IP, f"mkdir -p {remote_folder_path}"])

        items_to_copy = os.listdir(local_folder_path)
        
        if not items_to_copy:
            print(f"    - A pasta local está vazia. Pulando...")
            continue
            
        for name in items_to_copy:
            item_path = os.path.join(local_folder_path, name)
            
            print(f"\n      => Enviando: {name}")
            
            if os.path.isdir(item_path):
                upload_cmd = [
                    "pscp", "-pw", LAKKA_PASS, "-r",
                    f"{item_path}",
                    f"{LAKKA_USER}@{LAKKA_IP}:{remote_folder_path}/"
                ]
            else:
                upload_cmd = [
                    "pscp", "-pw", LAKKA_PASS,
                    f"{item_path}",
                    f"{LAKKA_USER}@{LAKKA_IP}:{remote_folder_path}/"
                ]
                
            try:
                subprocess.run(upload_cmd, check=False)
            except Exception as e:
                print(f"      [!] Erro ao enviar {name}: {e}")

    print("\n=== Concluido! ===")
    print("Arquivos enviados com sucesso para o Lakka!")

if __name__ == "__main__":
    transfer_local_backup()
