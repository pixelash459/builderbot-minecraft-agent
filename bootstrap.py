"""Workspace-only runtime installer. No global installs or settings changes."""
import os, sys, pathlib, urllib.request, hashlib, zipfile, concurrent.futures, shutil, subprocess, json
ROOT=pathlib.Path(__file__).resolve().parent
sys.stdout.reconfigure(encoding='utf-8')
for name in ['downloads','runtime','models','cache/npm','temp','data','logs','test-server','blueprints']:
    (ROOT/name).mkdir(parents=True,exist_ok=True)
def download(url, name, checksum=None):
    dest=ROOT/'downloads'/name
    if not dest.exists():
        part=dest.with_suffix(dest.suffix+'.part')
        print('Downloading '+name,flush=True)
        with urllib.request.urlopen(url,timeout=120) as response, open(part,'wb') as output:
            total=0; checkpoint=0
            while chunk:=response.read(4*1024*1024):
                output.write(chunk); total+=len(chunk)
                if total-checkpoint>=256*1024*1024:
                    print(f'{name}: {total//1048576} MiB',flush=True);checkpoint=total
        part.replace(dest)
    if checksum:
        digest=hashlib.file_digest(open(dest,'rb'),'sha256').hexdigest()
        if digest!=checksum: raise RuntimeError('Checksum mismatch: '+name)
    return dest
def node():
    archive=download('https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip','node-v22.23.3-win-x64.zip','2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71')
    with zipfile.ZipFile(archive) as z:z.extractall(ROOT/'runtime')
    print('Portable Node ready',flush=True)
def llama():
    digests={'llama-b11505-bin-win-cuda-13.4-x64.zip':'848f7d30e26f29c88d4899bed716996cb2551dba6821cfb73110fd93243bf8ea','cudart-llama-bin-win-cuda-13.4-x64.zip':'738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668'}
    for name in ['llama-b11505-bin-win-cuda-13.4-x64.zip','cudart-llama-bin-win-cuda-13.4-x64.zip']:
        archive=download('https://github.com/ggml-org/llama.cpp/releases/download/b11505/'+name,name,digests[name])
        with zipfile.ZipFile(archive) as z:z.extractall(ROOT/'runtime/llama-cpp')
    print('Portable llama.cpp ready',flush=True)
def model():
    name='Qwen3-8B-Q4_K_M.gguf'
    destination=ROOT/'models'/name
    if destination.exists():return
    metadata=json.load(urllib.request.urlopen('https://huggingface.co/api/models/Qwen/Qwen3-8B-GGUF?blobs=true',timeout=60))
    entry=next(x for x in metadata['siblings'] if x['rfilename']==name)
    checksum=entry.get('lfs',{}).get('sha256')
    archive=download('https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/'+name,name,checksum)
    archive.replace(destination)
    print('Qwen3 model ready',flush=True)
def server():
    # Paper + ViaVersion/ViaBackwards are copied from an existing server folder on this machine:
    # set PAPER_SOURCE or paperSource in config.local.json (kept out of git).
    local=ROOT/'config.local.json'
    source=os.environ.get('PAPER_SOURCE') or (json.loads(local.read_text())['paperSource'] if local.exists() else None)
    if not source:raise SystemExit('Set PAPER_SOURCE or paperSource in config.local.json to a Paper server folder')
    source=pathlib.Path(source)
    target=ROOT/'test-server'
    shutil.copy2(source/'paper.jar',target/'paper.jar')
    for name in ['libraries','versions','cache']:
        if (source/name).exists():shutil.copytree(source/name,target/name,dirs_exist_ok=True)
    (target/'plugins').mkdir(exist_ok=True)
    for jar in (source/'plugins').glob('*.jar'):
        if 'viaversion' in jar.name.lower() or 'viabackwards' in jar.name.lower():shutil.copy2(jar,target/'plugins'/jar.name)
    # Existing server installation already accepted this same server license.
    shutil.copy2(source/'eula.txt',target/'eula.txt')
    properties='''server-ip=127.0.0.1
server-port=25569
online-mode=false
white-list=false
max-players=4
gamemode=survival
difficulty=peaceful
level-name=agent-test-world
level-type=minecraft:flat
generate-structures=false
generator-settings={"layers":[{"block":"minecraft:bedrock","height":1},{"block":"minecraft:dirt","height":2},{"block":"minecraft:grass_block","height":1}],"biome":"minecraft:plains"}
view-distance=6
simulation-distance=4
spawn-protection=0
motd=AI Agent Private Test World
enable-rcon=false
enable-query=false
pause-when-empty-seconds=-1
'''
    (target/'server.properties').write_text(properties,encoding='utf-8')
    print('Isolated test server copied; live worlds untouched',flush=True)
if __name__=='__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures=[pool.submit(fn) for fn in [node,llama,model,server]]
        for future in concurrent.futures.as_completed(futures):future.result()
    print('Runtime installation complete',flush=True)
