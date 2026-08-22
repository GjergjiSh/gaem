"""Regenerate src/levels/city.ts's table from the pack in assets/city.

Same measurement as tools/measure.py -- POSITION accessor min/max with the node
transforms composed down -- pointed at the city kit.

This one is authored on a clean modular grid and it is worth knowing before you
place anything: a wall panel is 2 m wide by 3 m tall by 0.2 m thick, an inset is
4 m wide, a corner is 2x2, a sidewalk slab is 3 m, and a storey is 3 m. Panels
carry their thickness on Z, so a panel faces its own +Z and turning one to face
out of a wall is a yaw and nothing else -- the same convention as a door in the
sci-fi kit, and the opposite of that kit's `_Straight` wall pieces.
"""
import glob, os, importlib.util

spec = importlib.util.spec_from_file_location('m', os.path.join(os.path.dirname(__file__), 'measure.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

sizes = {}
for f in sorted(glob.glob('assets/city/**/*.gltf', recursive=True)):
    sizes[os.path.basename(f)[:-5]] = m.measure(f)

for name in sorted(sizes):
    w, h, d = sizes[name]
    print(f"  {name}: [{w}, {h}, {d}],")
