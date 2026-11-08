"""Build self-hosted, frequency-split Noto Sans SC fonts for reviewed publications.

python -I scripts/subset-publication-font.py /path/to/NotoSansSC.ttf
Requires fonttools and brotli; ordinary site builds only copy the vendored output.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
CJK = re.compile(r'[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]')


def ranges(points):
    groups = []
    start = end = points[0]
    for value in points[1:]:
        if value == end + 1:
            end = value
        else:
            groups.append((start, end))
            start = end = value
    groups.append((start, end))
    return ','.join(f'U+{a:X}' + (f'-{b:X}' if a != b else '') for a, b in groups)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    args = parser.parse_args()
    counts = Counter()
    for directory in ['data', 'lib', 'site']:
        for file in (ROOT / directory).rglob('*'):
            if file.suffix in {'.json', '.js', '.mjs', '.html'} and 'brand' not in file.parts:
                counts.update(CJK.findall(file.read_text()))
    font = TTFont(args.source)
    supported = font.getBestCmap()
    characters = [char for char, _ in counts.most_common() if ord(char) in supported]
    missing = [char for char in counts if ord(char) not in supported]
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.notdef_outline = True
    selection = subset.Subsetter(options=options)
    selection.populate(unicodes=[ord(char) for char in characters])
    selection.subset(font)
    font = instantiateVariableFont(font, {'wght': (400, 600)}, inplace=True, updateFontNames=True)
    serialized = io.BytesIO()
    font.save(serialized)
    source = serialized.getvalue()
    output = ROOT / 'site/brand'
    css = ["@font-face{font-family:'Inter Variable';font-style:normal;font-weight:100 900;font-display:swap;src:url('inter-latin.woff2') format('woff2');}"]
    records = []
    groups = [characters[:480]] + [characters[i:i+192] for i in range(480, len(characters), 192)]
    for index, chars in enumerate(groups):
        part = TTFont(io.BytesIO(source))
        selection = subset.Subsetter(options=options)
        selection.populate(unicodes=[ord(char) for char in chars])
        selection.subset(part)
        part.flavor = 'woff2'
        buffer = io.BytesIO()
        part.save(buffer)
        data = buffer.getvalue()
        digest = hashlib.sha256(data).hexdigest()[:12]
        name = f'noto-sans-sc-{index:02d}-{digest}.woff2'
        (output / name).write_bytes(data)
        unicode = ranges(sorted(ord(char) for char in chars))
        css.append("@font-face{font-family:'AgentHub Publication SC';font-style:normal;font-weight:400 600;font-display:swap;src:url('"+name+"') format('woff2');unicode-range:"+unicode+";}")
        records.append({'file': name, 'bytes': len(data), 'characters': ''.join(sorted(chars))})
        print(name, len(data), 'bytes', flush=True)
    (output / 'fonts.css').write_text('\n'.join(css)+'\n')
    (output / 'font-source.json').write_text(json.dumps({
        'family': 'Noto Sans SC', 'version': font['name'].getDebugName(5),
        'source': 'https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf',
        'sourceSHA256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
        'weights': [400, 600], 'glyphs': len(characters), 'unsupportedCharacters': missing,
        'partition': '480 most frequent characters, then disjoint groups of 192', 'files': records,
    }, ensure_ascii=False, indent=2)+'\n')
    print('Complete:', len(characters), 'characters,', len(groups), 'font subsets.', flush=True)


if __name__ == '__main__':
    main()
