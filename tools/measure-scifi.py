"""Regenerate src/levels/scifi.ts from the packs in assets/scifi and assets/more-scifi.

Same measurement as tools/measure.py -- POSITION accessor min/max with the node
transforms composed down -- just pointed at the other kit and emitting the
TypeScript table rather than printing it.
"""
import glob, os, importlib.util

spec = importlib.util.spec_from_file_location('m', os.path.join(os.path.dirname(__file__), 'measure.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

# Both halves of the same pack. `more-scifi` ships the props -- crates, drums,
# lockers, dishes -- against the SAME trim sheets as the environment set (the
# texture files are byte-identical between the two folders), so it is one kit
# with one table, not a second style.
#
# One name appears in both: Prop_Chest, at two different sizes. Models are keyed
# by bare filename, so exactly one of them is ever loaded -- the environment
# pack's, which sorts last -- and the table has to carry that one's numbers or
# every Prop_Chest in a level comes out distorted against a size nothing is
# using.
DIRS = [f'assets/scifi/glTF/{d}' for d in
        ['Walls', 'Columns', 'Platforms', 'Props', 'Decals']] + ['assets/more-scifi/glTF']

# Keyed by bare filename with the LAST path winning, which is exactly what
# `import.meta.glob` does in models.ts: it sorts by full path and assigns into a
# basename map, so `assets/scifi/...` overwrites `assets/more-scifi/...`. The
# table has to agree with whichever file the game will actually load, or the
# only Prop_Chest in the game is measured against the size of the other one.
sizes = {}
for f in sorted(p for d in DIRS for p in glob.glob(f'{d}/*.gltf')):
    sizes[os.path.basename(f)[:-5]] = m.measure(f)

for name in sorted(sizes):
    print(name, sizes[name])
