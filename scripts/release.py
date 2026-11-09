#!/usr/bin/env python3
"""构建 MyFlicker World 外网静态发布包，并逐字节校验线上产物。"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urljoin
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PUBLISHED = [
    'index.html',
    *[f'js/{p.name}' for p in sorted((ROOT / 'js').glob('*.js'))],
    'vendor/three.min.js',
]
# 内网专用 Appwrite SDK 不进入公开仓库与公开站点，云功能由 cloud.js 的主机名判断关闭。
INTERNAL_SDK = '<script src="vendor/appwrite-sdk.js"></script>'


def build():
    if 'index.html' not in PUBLISHED:
        raise RuntimeError('missing index.html')
    for name in PUBLISHED:
        if not (ROOT / name).is_file():
            raise RuntimeError(f'missing runtime file: {name}')
    output = ROOT / 'dist'
    if output.is_symlink():
        raise RuntimeError('dist must not be a symlink')
    if output.exists():
        shutil.rmtree(output)
    output.mkdir()
    hashes = {}
    for name in PUBLISHED:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        content = (ROOT / name).read_bytes()
        if name == 'index.html':
            text = content.decode()
            text = text.replace(INTERNAL_SDK + '\n', '').replace(INTERNAL_SDK, '')
            content = text.encode()
        target.write_bytes(content)
        hashes[name] = hashlib.sha256(content).hexdigest()
    html = (output / 'index.html').read_text()
    for link in re.findall(r'(?:src|href)=["\']([^"\']+)', html):
        if link.startswith(('http:', 'https:', 'data:', '#')):
            continue
        relative = link.split('#')[0].split('?')[0]
        if not (output / relative).is_file():
            raise RuntimeError(f'index.html references missing resource: {link}')
    manifest = {
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
        'files': hashes,
    }
    (output / 'release-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Built {len(PUBLISHED)} resources: {output}')
    return manifest


def verify(base):
    manifest = json.loads((ROOT / 'dist/release-manifest.json').read_text())
    for name, expected in manifest['files'].items():
        request = Request(urljoin(base.rstrip('/') + '/', name), headers={'Cache-Control': 'no-cache'})
        with urlopen(request, timeout=30) as response:
            actual = hashlib.sha256(response.read()).hexdigest()
        if actual != expected:
            raise RuntimeError(f'{name}: deployed hash mismatch')
    with urlopen(urljoin(base.rstrip('/') + '/', 'release-manifest.json'), timeout=30) as response:
        if json.load(response) != manifest:
            raise RuntimeError('deployed manifest differs')
    print(f'PASS: {len(manifest["files"])} resources + manifest match: {base}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'verify'])
    parser.add_argument('url', nargs='?')
    args = parser.parse_args()
    if args.command == 'build':
        build()
    elif args.url:
        verify(args.url)
    else:
        parser.error('verify requires a URL')
