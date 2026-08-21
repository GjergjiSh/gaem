"""Regenerate src/levels/scifi.ts from the pack in assets/scifi.

Same measurement as tools/measure.py -- POSITION accessor min/max with the node
transforms composed down -- just pointed at the other kit and emitting the
TypeScript table rather than printing it.
"""
import glob, os, importlib.util

spec = importlib.util.spec_from_file_location('m', os.path.join(os.path.dirname(__file__), 'measure.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

for d in ['Walls', 'Columns', 'Platforms', 'Props', 'Decals']:
    for f in sorted(glob.glob(f'assets/scifi/glTF/{d}/*.gltf')):
        print(os.path.basename(f)[:-5], m.measure(f))
